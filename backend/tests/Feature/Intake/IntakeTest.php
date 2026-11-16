<?php

namespace Tests\Feature\Intake;

use App\Mail\AppointmentConfirmationMail;
use App\Mail\OneTimeCodeMail;
use App\Models\Appointment;
use App\Models\AuditLog;
use App\Models\IntakeSubmission;
use App\Models\MailDispatch;
use App\Models\Patient;
use App\Models\PatientGuardian;
use App\Models\Person;
use App\Services\Intake\JoinCodes;
use App\Services\Mail\MailOutbox;
use Carbon\CarbonImmutable;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Mail;
use Tests\Feature\Appointments\SchedulingFixture;
use Tests\TestCase;

/**
 * Registration intake (R2-03, R2-05, R2-08, R2-12) and the demo fixes: the daily counter code, rate limits, the cross-branch
 * duplicate guard, minors and guardians, the own-account claim, that no ID image or number is stored, the fake-domain mail
 * guard and the calendar counting each dentist once. Frozen at Monday 2026-09-28 10:00 Asia/Manila.
 */
class IntakeTest extends TestCase
{
    use RefreshDatabase, SchedulingFixture;

    private const FAKE_ID_NUMBER = 'PSN-7777-0000-1234-5678';

    protected function setUp(): void
    {
        parent::setUp();
        Mail::fake();
        $this->setUpSchedulingWorld();
    }

    private function form(array $self = [], array $extra = []): array
    {
        return $extra + ['branch_ref' => 'b1', 'code' => JoinCodes::current($this->b['b1'])->code, 'consent' => true, 'join_queue' => true, 'channel' => 'phone',
            'self' => $self + ['first_name' => 'Joanna', 'last_name' => 'Specimen', 'date_of_birth' => '1990-05-17', 'sex' => 'Female', 'phone' => '0917 555 0101',
                'email' => null, 'address' => 'Bocaue, Bulacan', 'emergency_contact' => ['name' => 'Ramon Specimen', 'phone' => '0917 555 0102']],
            'scan' => ['id_type' => 'philid', 'fields' => ['first_name', 'last_name', 'date_of_birth']]];
    }

    private function submitForm(array $body, string $device = 'device-a')
    {
        return $this->withHeaders(['X-Device-Id' => $device])->postJson('/api/public/intake', $body);
    }

    public function test_the_daily_counter_code_is_required_changes_on_refresh_and_expires_at_midnight(): void
    {
        $this->submitForm($this->form([], ['code' => null]))->assertStatus(422)->assertJsonValidationErrors('code');
        $this->submitForm($this->form([], ['code' => 'WRONG1']))->assertStatus(422)->assertJsonValidationErrors('code');
        $this->actingAsUser('staffB1');
        $code = $this->getJson('/api/intake/code')->assertOk()->json('data.code');
        $this->app['auth']->forgetGuards();
        $this->submitForm($this->form([], ['code' => strtolower($code)]))->assertCreated()->assertJsonPath('data.join_queue', true);

        $this->actingAsUser('staffB1');
        $new = $this->postJson('/api/intake/code/refresh')->assertOk()->json('data.code');
        $this->assertNotSame($code, $new);
        $this->app['auth']->forgetGuards();
        $this->submitForm($this->form(['phone' => '0917 555 0199'], ['code' => $code]), 'device-b')->assertStatus(422);

        $this->travelTo(CarbonImmutable::parse('2026-09-29 00:00', 'Asia/Manila')); // the next clinic day
        $this->submitForm($this->form(['phone' => '0917 555 0198'], ['code' => $new]), 'device-c')->assertStatus(422);
        $this->assertTrue(AuditLog::where('action', 'intake.join_code_refreshed')->exists());
    }

    public function test_registrations_are_rate_limited_per_device(): void
    {
        for ($i = 0; $i < 4; $i++) $this->submitForm($this->form(['phone' => '0917 555 01'.(10 + $i)]))->assertCreated();
        $this->submitForm($this->form(['phone' => '0917 555 0120']))->assertStatus(429);
        $this->submitForm($this->form(['phone' => '0917 555 0121']), 'device-other')->assertCreated(); // another device is not blocked
    }

    public function test_a_possible_existing_patient_from_another_branch_is_shown_and_never_auto_merged(): void
    {
        $existing = $this->p['B'];
        $existing->person->update(['first_name' => 'Joanna', 'last_name' => 'Specimen', 'date_of_birth' => '1990-05-17', 'phone' => '+639175550101']);
        $this->existing('B', 'd3', 'b2', 'svc1', '2026-09-20', '10:00', 30, 'Completed');
        $people = Person::count();
        $this->submitForm($this->form())->assertCreated();

        $this->actingAsUser('staffB1');
        $row = $this->getJson('/api/intake/submissions')->assertOk()->json('data.0');
        $this->assertSame('Self-registered', $row['channel'] === 'phone' ? 'Self-registered' : null);
        $this->assertSame($existing->public_id, $row['duplicates'][0]['patient_id']);
        $this->assertSame('Branch B2', $row['duplicates'][0]['found_from']); // "Record found from Branch X" (R2-08)
        $this->assertSame($people, Person::count()); // nothing created before staff decide

        $this->postJson("/api/intake/submissions/{$row['id']}/confirm", ['use_patient' => $existing->public_id, 'id_verified' => true, 'id_type' => 'philid'])
            ->assertOk()->assertJsonPath('data.patient.id', $existing->public_id);
        $this->assertSame($people, Person::count());
        $this->assertNotNull($existing->fresh()->id_verified_at);
        $this->assertSame(1, \App\Models\Visit::where('patient_id', $existing->id)->where('source', 'walk_in')->count()); // joined today's queue
        $audit = AuditLog::where('action', 'intake.confirmed')->sole();
        $this->assertTrue($audit->payload['used_existing_record']);
    }

    public function test_staff_confirm_or_correct_a_new_registration_and_corrections_are_audited(): void
    {
        $this->submitForm($this->form())->assertCreated();
        $this->actingAsUser('staffB2');
        $this->getJson('/api/intake/submissions')->assertOk()->assertJsonCount(0, 'data'); // another branch's staff
        $this->actingAsUser('staffB1');
        $id = $this->getJson('/api/intake/submissions')->json('data.0.id');
        $this->postJson("/api/intake/submissions/$id/confirm", ['corrections' => ['last_name' => 'Specimen-Cruz'], 'id_verified' => true, 'id_type' => 'drivers_license', 'id_last4' => '9999'])->assertOk();
        $patient = Patient::whereHas('person', fn ($q) => $q->where('last_name', 'Specimen-Cruz'))->sole();
        $this->assertSame('counter', $patient->registration_source);
        $this->assertNull($patient->id_last4); // the Owner did not turn on keeping the last 4 characters
        $this->assertSame(['last_name'], AuditLog::where('action', 'intake.confirmed')->sole()->payload['corrected_fields']);
        $this->assertSame(['confirmed' => true], IntakeSubmission::sole()->data); // the form is not kept once it is the record
        $this->postJson("/api/intake/submissions/$id/confirm", [])->assertStatus(422); // handled once
    }

    public function test_a_minor_needs_a_guardian_and_the_guardian_registers_the_child_in_the_same_form(): void
    {
        $this->submitForm($this->form(['date_of_birth' => '2012-01-01']))->assertStatus(422)->assertJsonValidationErrors('self.date_of_birth');
        $this->submitForm($this->form([], ['visit_for' => 'dependent:0', 'dependents' => [['first_name' => 'Ana', 'last_name' => 'Specimen', 'date_of_birth' => '2018-03-03', 'relationship' => 'Daughter']]]))->assertCreated();
        $this->actingAsUser('staffB1');
        $row = $this->getJson('/api/intake/submissions')->json('data.0');
        $this->assertTrue($row['dependents'][0]['minor']);
        $this->postJson("/api/intake/submissions/{$row['id']}/confirm", ['id_verified' => true, 'id_type' => 'umid'])->assertOk()->assertJsonPath('data.patient.name', 'Ana Specimen');
        $link = PatientGuardian::sole();
        $this->assertSame('Daughter', $link->relationship);
        $ana = $link->dependent;
        $this->assertNull($ana->person->email);
        $record = $this->getJson("/api/patients/{$ana->public_id}")->assertOk();
        $this->assertTrue($record->json('data.minor'));
        $this->assertSame('Joanna Specimen', $record->json('data.guardians.0.name')); // staff see "Minor: guardian Joanna Specimen"
    }

    public function test_a_guardian_books_and_is_reminded_for_a_dependent_and_loses_access_after_the_dependent_claims_at_18(): void
    {
        $this->u['patientA']->forceFill(['email' => 'guardian@mailbox.ph', 'email_verified_at' => now()])->save();
        $this->p['A']->person->update(['date_of_birth' => '1985-01-01']);
        $this->actingAsUser('patientA');
        $this->postJson('/api/me/dependents', ['first_name' => 'Ana', 'last_name' => 'Kid', 'date_of_birth' => '2016-02-02', 'relationship' => 'Daughter'], ['Idempotency-Key' => (string) \Illuminate\Support\Str::uuid()])->assertStatus(422); // consent
        $ana = $this->postJson('/api/me/dependents', ['first_name' => 'Ana', 'last_name' => 'Kid', 'date_of_birth' => '2016-02-02', 'relationship' => 'Daughter', 'consent' => true], ['Idempotency-Key' => (string) \Illuminate\Support\Str::uuid()])
            ->assertCreated()->assertJsonPath('data.minor', true)->json('data.id');
        $id = $this->book(['for_patient_id' => $ana, 'date' => '2026-09-30', 'start_time' => '09:00'])->assertCreated()->json('data.id');
        Mail::assertSent(AppointmentConfirmationMail::class, fn ($m) => $m->hasTo('guardian@mailbox.ph'));
        $this->getJson("/api/appointments/$id")->assertOk();
        $this->actingAsUser('patientB');
        $this->getJson("/api/appointments/$id")->assertForbidden();
        $this->book(['for_patient_id' => $ana])->assertForbidden();

        // Years later Ana is an adult: the guardian invites her, she claims her account, and the guardian's access ends.
        $kai = $this->p['A'];
        $this->actingAsUser('patientA');
        $adult = $this->postJson('/api/me/dependents', ['first_name' => 'Kai', 'last_name' => 'Kid', 'date_of_birth' => '2008-01-01', 'relationship' => 'Son', 'consent' => true], ['Idempotency-Key' => (string) \Illuminate\Support\Str::uuid()])->json('data.id');
        $this->postJson("/api/patients/$ana/claim-invite", ['email' => 'ana@mailbox.ph'])->assertStatus(422); // under 18
        $this->postJson("/api/patients/$adult/claim-invite", ['email' => 'kai@mailbox.ph'])->assertOk();
        $adultAppt = $this->book(['for_patient_id' => $adult, 'date' => '2026-10-01', 'start_time' => '10:00'])->assertCreated()->json('data.id');
        $this->app['auth']->forgetGuards();
        $this->postJson('/api/account/claim', ['email' => 'kai@mailbox.ph', 'date_of_birth' => '2008-01-01', 'password' => 'Secret123'])->assertStatus(422); // no password yet
        $this->postJson('/api/account/claim', ['email' => 'kai@mailbox.ph', 'date_of_birth' => '2008-01-01'])->assertCreated();
        $code = null;
        Mail::assertSent(OneTimeCodeMail::class, function (OneTimeCodeMail $m) use (&$code) { if ($m->hasTo('kai@mailbox.ph')) $code = $m->code; return (bool) $code; });
        $this->postJson('/api/account/claim/verify', ['email' => 'kai@mailbox.ph', 'otp' => $code, 'password' => 'Secret123', 'password_confirmation' => 'Secret123'])->assertOk();
        $this->assertSame('ended', PatientGuardian::whereHas('dependent', fn ($q) => $q->where('public_id', $adult))->sole()->status);
        $this->assertTrue(AuditLog::where('action', 'patient.guardian_access_ended')->exists());
        $this->actingAsUser('patientA');
        $this->getJson("/api/appointments/$adultAppt")->assertForbidden();
        $this->getJson("/api/appointments/$id")->assertOk(); // still the guardian of the child
        $this->assertSame([$ana], array_column($this->getJson('/api/me/dependents')->json('data'), 'id'));
    }

    public function test_no_id_image_or_id_number_is_stored_anywhere_after_a_scan_and_register_run(): void
    {
        // What the browser sends after a scan: only the name parts and the birth date, plus which fields came from the ID.
        $this->submitForm($this->form())->assertCreated();
        // An ID number or image is refused even if a page sent it by mistake.
        $this->submitForm($this->form([], ['id_number' => self::FAKE_ID_NUMBER]), 'device-x')->assertStatus(422);
        $this->submitForm($this->form([], ['scan' => ['id_type' => 'philid', 'image' => 'data:image/png;base64,iVBORw0KGgo=', 'number' => self::FAKE_ID_NUMBER]]), 'device-y')->assertStatus(422);
        $this->actingAsUser('staffB1');
        $id = $this->getJson('/api/intake/submissions')->json('data.0.id');
        $this->postJson("/api/intake/submissions/$id/confirm", ['id_verified' => true, 'id_type' => 'philid', 'id_last4' => '5678'])->assertOk();

        $needles = [self::FAKE_ID_NUMBER, '777700001234', 'iVBORw0KGgo', 'data:image'];
        $tables = collect(DB::select("select table_name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE'"))->pluck('table_name');
        foreach ($tables as $table) {
            foreach ($needles as $needle) {
                $hits = DB::selectOne("select count(*) as n from \"$table\" t where t::text ilike ?", ['%'.$needle.'%'])->n;
                $this->assertSame(0, (int) $hits, "$table contains $needle");
            }
        }
        $log = @file_get_contents(storage_path('logs/laravel.log')) ?: '';
        foreach ($needles as $needle) $this->assertStringNotContainsString($needle, $log);
        $this->assertSame(0, MailDispatch::count()); // nothing about the ID went to the outbox
        $this->assertNull(Patient::whereHas('person', fn ($q) => $q->where('last_name', 'Specimen'))->sole()->id_last4);
    }

    public function test_the_mail_guard_never_sends_to_reserved_or_fake_domains(): void
    {
        config(['mail.default' => 'smtp', 'mail.mailers.smtp.transport' => 'smtp']);
        foreach (['someone@example.test', 'a@example.com', 'b@clinic.test', 'c@host.invalid', 'd@localhost'] as $i => $email) {
            $this->u['patientA']->forceFill(['email' => $email])->save();
            $a = $this->existing('A', 'd1', 'b1', 'svc1', '2026-10-0'.($i + 1), '09:00');
            $d = app(MailOutbox::class)->queue('appointment_confirmation', "guard-$i", $a, 1, $this->u['patientA'], null);
            app(MailOutbox::class)->process($d->id); // the worker (already run synchronously in tests: then this claims nothing)
            $this->assertSame('suppressed', $d->fresh()->status, $email);
        }
        Mail::assertNothingSent();
        $this->assertSame(5, MailDispatch::where('status', 'suppressed')->count());
        $this->u['patientA']->forceFill(['email' => 'real.person@mailbox.ph'])->save();
        $a = Appointment::where('patient_id', $this->p['A']->id)->first();
        $d = app(MailOutbox::class)->queue('appointment_confirmation', 'guard-ok', $a, 1, $this->u['patientA'], null);
        app(MailOutbox::class)->process($d->id);
        $this->assertSame('transport_accepted', $d->fresh()->status);
    }

    public function test_the_calendar_counts_a_dentist_working_at_two_branches_once_per_day_and_says_capacity_is_estimated(): void
    {
        $this->d['d1']->branches()->attach($this->b['b2']->id);
        $this->actingAsUser('owner');
        $day = $this->getJson('/api/calendar/load?from=2026-09-29&to=2026-09-29')->assertOk();
        $this->assertSame(3 * 540, $day->json('data.days.0.capacity_minutes')); // d1, d2, d3 once each, not d1 twice
        $this->assertStringContainsString('estimated', $day->json('data.capacity_note'));
    }

    public function test_a_confirmed_walk_in_enters_the_chosen_or_shortest_dentist_queue_and_a_booking_today_is_checked_in_instead(): void
    {
        // d1 already has one patient waiting; "any available" for svc1 at b1 picks d2 (shortest queue).
        $busy = $this->existing('B', 'd1', 'b1', 'svc1', '2026-09-28', '10:30');
        $this->actingAsUser('staffB1');
        $this->postJson('/api/visits/check-in', ['appointment_id' => $busy->public_id, 'expected_revision' => 1], ['Idempotency-Key' => 'ci-busy'])->assertCreated();
        $this->app['auth']->forgetGuards();
        $this->submitForm($this->form())->assertCreated();
        $this->actingAsUser('staffB1');
        $id = $this->getJson('/api/intake/submissions')->json('data.0.id');
        $this->postJson("/api/intake/submissions/$id/confirm", ['service_ref' => 'svc1'])->assertOk();
        $walkIn = \App\Models\Visit::where('source', 'walk_in')->sole();
        $this->assertSame($this->d['d2']->id, $walkIn->responsible_dentist_profile_id);
        $this->assertNotNull(\App\Models\QueueEntry::where('visit_id', $walkIn->id)->first());

        // A patient with an account and a booking today joins with the code: staff confirm checks in THAT booking.
        $booking = $this->existing('A', 'd1', 'b1', 'svc1', '2026-09-28', '11:00');
        $this->actingAsUser('patientA');
        $this->postJson('/api/intake/join', ['branch_ref' => 'b1', 'code' => JoinCodes::current($this->b['b1'])->code])->assertCreated();
        $this->actingAsUser('staffB1');
        $row = collect($this->getJson('/api/intake/submissions')->json('data'))->firstWhere('channel', 'account');
        $this->postJson("/api/intake/submissions/{$row['id']}/confirm", ['id_verified' => true, 'id_type' => 'umid'])->assertOk();
        $this->assertSame('Checked In', $booking->fresh()->status);
        $this->assertSame($this->d['d1']->id, \App\Models\Visit::where('appointment_id', $booking->id)->sole()->responsible_dentist_profile_id);
    }

    public function test_only_the_person_who_reads_the_emailed_code_sets_the_claimed_account_password(): void
    {
        $this->p['B']->person->update(['email' => 'owner.of.record@mailbox.ph', 'date_of_birth' => '1980-02-02']);
        $this->u['patientB']->forceDelete(); // a record registered at the counter: no account yet
        $claim = fn () => $this->postJson('/api/account/claim', ['email' => 'owner.of.record@mailbox.ph', 'date_of_birth' => '1980-02-02'])->assertCreated();
        $claim(); // someone else starts the claim first: it holds no password they chose, and they cannot read the code
        $this->postJson('/api/login', ['email' => 'owner.of.record@mailbox.ph', 'password' => 'Attacker123'])->assertStatus(422);
        $this->travel(2)->minutes();
        $claim(); // the real owner asks again (a fresh code)
        $code = null;
        Mail::assertSent(OneTimeCodeMail::class, function (OneTimeCodeMail $m) use (&$code) { if ($m->hasTo('owner.of.record@mailbox.ph')) $code = $m->code; return true; });
        $this->postJson('/api/account/claim/verify', ['email' => 'owner.of.record@mailbox.ph', 'otp' => '000000', 'password' => 'Attacker123', 'password_confirmation' => 'Attacker123'])->assertStatus(422);
        $this->postJson('/api/account/claim/verify', ['email' => 'owner.of.record@mailbox.ph', 'otp' => $code, 'password' => 'RealOwner123', 'password_confirmation' => 'RealOwner123'])->assertOk();
        $this->postJson('/api/account/claim/verify', ['email' => 'owner.of.record@mailbox.ph', 'otp' => $code, 'password' => 'Attacker123', 'password_confirmation' => 'Attacker123'])->assertStatus(422); // once only
        $this->postJson('/api/login', ['email' => 'owner.of.record@mailbox.ph', 'password' => 'RealOwner123'])->assertOk();
    }

    // ---- account claim hardening ------------------------------------------------------------------------------------

    private function counterRecord(?string $email, string $dob = '1980-02-02'): Patient
    {
        $p = $this->p['B'];
        $p->person->update(['email' => $email, 'date_of_birth' => $dob]);
        $this->u['patientB']->forceDelete();

        return $p->fresh(['person']);
    }

    private function codeFor(string $email): ?string
    {
        $code = null;
        Mail::assertSent(OneTimeCodeMail::class, function (OneTimeCodeMail $m) use (&$code, $email) { if ($m->hasTo($email)) $code = $m->code; return true; });

        return $code;
    }

    public function test_the_code_goes_only_to_the_stored_email_and_answers_are_identical_for_matching_and_non_matching_details(): void
    {
        $this->counterRecord('owner.of.record@mailbox.ph');
        $match = $this->postJson('/api/account/claim', ['email' => 'owner.of.record@mailbox.ph', 'date_of_birth' => '1980-02-02']);
        $wrongDob = $this->postJson('/api/account/claim', ['email' => 'owner.of.record@mailbox.ph', 'date_of_birth' => '1981-02-02']);
        $this->assertSame([$match->status(), $match->json()], [$wrongDob->status(), $wrongDob->json()]);
        // An attacker types their own email with the owner's birth date: nothing is created or sent to them.
        $other = $this->postJson('/api/account/claim', ['email' => 'attacker@mailbox.ph', 'date_of_birth' => '1980-02-02']);
        $this->assertSame([201, ['email', 'code_sent_if_matched', 'resend_available_at']], [$other->status(), array_keys($other->json('data'))]);
        Mail::assertNotSent(OneTimeCodeMail::class, fn ($m) => $m->hasTo('attacker@mailbox.ph'));
        $this->assertNull(\App\Models\User::where('email', 'attacker@mailbox.ph')->first());
        $this->assertNotNull($this->codeFor('owner.of.record@mailbox.ph')); // the owner is unaffected and got the code
    }

    public function test_a_record_without_an_email_is_claimed_only_through_a_staff_link_that_works_once_and_expires(): void
    {
        $record = $this->counterRecord(null);
        $this->existing('B', 'd1', 'b1', 'svc1', '2026-09-21', '10:00', 30, 'Completed'); // a visit at staff's branch
        $this->postJson('/api/account/claim', ['email' => 'walkin@mailbox.ph', 'date_of_birth' => '1980-02-02'])->assertCreated();
        Mail::assertNotSent(OneTimeCodeMail::class);

        $this->actingAsUser('staffB1');
        $record->person->update(['date_of_birth' => '2012-02-02']);
        $this->postJson("/api/patients/{$record->public_id}/offer-account", ['email' => 'walkin@mailbox.ph', 'id_type' => 'philid'])->assertStatus(422)->assertJsonValidationErrors('email'); // a minor
        Mail::assertNotSent(\App\Mail\AccountClaimInviteMail::class);
        $this->assertNull($record->fresh()->id_verified_at); // the refused offer left no ID check behind
        $record->person->update(['date_of_birth' => '1980-02-02']);
        $this->postJson("/api/patients/{$record->public_id}/offer-account", ['email' => 'walkin@mailbox.ph'])->assertStatus(422); // ID not checked yet
        $this->postJson("/api/patients/{$record->public_id}/offer-account", ['email' => 'walkin@mailbox.ph', 'id_type' => 'philid'])->assertOk();
        $this->assertTrue(AuditLog::where('action', 'patient.account_offered')->where('actor_user_id', $this->u['staffB1']->id)->exists());
        $token = null;
        Mail::assertSent(\App\Mail\AccountClaimInviteMail::class, function ($m) use (&$token) { $token = $m->token; return $m->hasTo('walkin@mailbox.ph'); });
        $this->app['auth']->forgetGuards();
        $this->postJson('/api/account/claim', ['token' => $token])->assertCreated()->assertJsonPath('data.email', 'w•••••@mailbox.ph');
        $this->postJson('/api/account/claim/verify', ['token' => $token, 'otp' => $this->codeFor('walkin@mailbox.ph'), 'password' => 'Walkin123', 'password_confirmation' => 'Walkin123'])->assertOk()
            ->assertJsonPath('data.email', 'walkin@mailbox.ph'); // the link names the account: no email retyped
        $this->postJson('/api/account/claim', ['token' => $token])->assertStatus(422); // used once
        $this->postJson('/api/login', ['email' => 'walkin@mailbox.ph', 'password' => 'Walkin123'])->assertOk();

        // A second record: a link expires after the Owner's setting (24 hours by default).
        [$otherUser, $other] = $this->patient('PAT-0009');
        $otherUser->forceDelete();
        $other->person->update(['date_of_birth' => '1985-04-04']); // an adult (the factory date is random)
        $this->p['X'] = $other;
        $this->existing('X', 'd1', 'b1', 'svc1', '2026-09-21', '11:00', 30, 'Completed');
        $this->flushSession();
        $this->app['auth']->forgetGuards();
        $this->actingAsUser('staffB1');
        $this->postJson("/api/patients/{$other->public_id}/offer-account", ['email' => 'late@mailbox.ph', 'id_type' => 'umid'])->assertOk();
        $late = null;
        Mail::assertSent(\App\Mail\AccountClaimInviteMail::class, function ($m) use (&$late) { if ($m->hasTo('late@mailbox.ph')) $late = $m->token; return true; });
        $this->app['auth']->forgetGuards();
        $this->travel(25)->hours();
        $this->postJson('/api/account/claim', ['token' => $late])->assertStatus(422);
        $this->assertTrue(AuditLog::where('action', 'account.claim_blocked')->exists());
    }

    public function test_a_pending_claim_cannot_be_activated_by_sign_up_verification_resend_or_password_reset_and_codes_die_after_5_tries(): void
    {
        $this->counterRecord('owner.of.record@mailbox.ph');
        $this->postJson('/api/account/claim', ['email' => 'owner.of.record@mailbox.ph', 'date_of_birth' => '1980-02-02'])->assertCreated();
        $code = $this->codeFor('owner.of.record@mailbox.ph');
        $neutral = $this->postJson('/api/register/verify', ['email' => 'nobody@mailbox.ph', 'otp' => '123456']);
        $signup = $this->postJson('/api/register/verify', ['email' => 'owner.of.record@mailbox.ph', 'otp' => $code]);
        $this->assertSame([$neutral->status(), $neutral->json('code')], [$signup->status(), $signup->json('code')]);
        $this->postJson('/api/register/resend', ['email' => 'owner.of.record@mailbox.ph'])->assertOk();
        $this->postJson('/api/password/forgot', ['email' => 'owner.of.record@mailbox.ph'])->assertOk();
        Mail::assertSent(OneTimeCodeMail::class, 1); // only the claim code: no sign-up or reset code for a pending claim
        $this->assertNull(\App\Models\User::where('email', 'owner.of.record@mailbox.ph')->sole()->email_verified_at);

        // Resend within the 60-second cooldown: no new code.
        $this->postJson('/api/account/claim', ['email' => 'owner.of.record@mailbox.ph', 'date_of_birth' => '1980-02-02'])->assertCreated();
        Mail::assertSent(OneTimeCodeMail::class, 1);

        // Brute force: 5 wrong tries kill the code, even the right one fails afterwards.
        foreach (range(1, 5) as $i) $this->postJson('/api/account/claim/verify', ['email' => 'owner.of.record@mailbox.ph', 'otp' => str_pad((string) $i, 6, '0', STR_PAD_LEFT), 'password' => 'Owner1234', 'password_confirmation' => 'Owner1234'])->assertStatus(422);
        $this->postJson('/api/account/claim/verify', ['email' => 'owner.of.record@mailbox.ph', 'otp' => $code, 'password' => 'Owner1234', 'password_confirmation' => 'Owner1234'])->assertStatus(422);

        // Audit entries for claims carry no code, password or birth date.
        $audit = AuditLog::where('action', 'like', 'account.claim%')->get()->map(fn ($a) => json_encode($a->payload))->implode(' ');
        $this->assertNotSame('', $audit);
        foreach ([$code, 'Owner1234', '1980-02-02', '1980'] as $secret) $this->assertStringNotContainsString($secret, $audit);
    }

    public function test_spamming_self_service_cannot_block_a_staff_link_and_staff_not_a_guardian_change_a_stored_email(): void
    {
        $record = $this->counterRecord('owner.of.record@mailbox.ph');
        $this->existing('B', 'd1', 'b1', 'svc1', '2026-09-21', '10:00', 30, 'Completed');
        // A guardian cannot point an adult dependent's claim at another inbox when an email is on file.
        $this->p['A']->person->update(['date_of_birth' => '1975-05-05']); // an adult guardian (the factory date is random)
        \App\Services\Intake\Guardianship::link($record, $this->p['A'], 'Parent', $this->u['staffB1'], null);
        $this->actingAsUser('patientA');
        $this->postJson("/api/patients/{$record->public_id}/claim-invite", ['email' => 'guardian.inbox@mailbox.ph'])->assertStatus(422)->assertJsonValidationErrors('email');
        $this->assertSame('owner.of.record@mailbox.ph', $record->person->fresh()->email);
        $this->app['auth']->forgetGuards();
        foreach (range(1, 7) as $i) { // more than the per-record cap, from someone who knows the email and birth date
            $this->travel(2)->minutes();
            $this->withServerVariables(['REMOTE_ADDR' => "10.0.0.$i"])->postJson('/api/account/claim', ['email' => 'owner.of.record@mailbox.ph', 'date_of_birth' => '1980-02-02']);
        }
        $this->assertTrue(AuditLog::where('action', 'account.claim_blocked')->exists());
        $this->actingAsUser('staffB1');
        $this->postJson("/api/patients/{$record->public_id}/offer-account", ['email' => 'owner.of.record@mailbox.ph', 'id_type' => 'philid'])->assertOk();
        $token = null;
        Mail::assertSent(\App\Mail\AccountClaimInviteMail::class, function ($m) use (&$token) { $token = $m->token; return true; });
        $this->app['auth']->forgetGuards();
        $this->travel(2)->minutes();
        $before = Mail::sent(OneTimeCodeMail::class)->count();
        $this->withServerVariables(['REMOTE_ADDR' => '10.9.9.9'])->postJson('/api/account/claim', ['token' => $token])->assertCreated();
        $this->assertSame($before + 1, Mail::sent(OneTimeCodeMail::class)->count()); // the link still sends a code
    }

    public function test_kiosk_channel_is_rejected_and_only_phone_and_account_are_allowed(): void
    {
        // Public API validation rejects 'kiosk'
        $this->submitForm($this->form([], ['channel' => 'kiosk']))
            ->assertStatus(422)
            ->assertJsonValidationErrors('channel');

        // Public API validation accepts 'phone'
        $this->submitForm($this->form(['phone' => '0917 555 0777'], ['channel' => 'phone']))
            ->assertCreated();

        // Database CHECK constraint rejects 'kiosk'
        $this->expectException(\Illuminate\Database\QueryException::class);
        DB::table('intake_submissions')->insert([
            'public_id' => 'intake_kiosk_test_public_id',
            'reference' => 'TESTREF12345',
            'branch_id' => $this->b['b1']->id,
            'channel' => 'kiosk',
            'status' => 'pending',
            'consent_at' => now(),
            'consent_version' => 'v1',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    public function test_verify_id_requires_staff_role(): void
    {
        $patient = $this->p['A'];

        $this->postJson("/api/patients/{$patient->public_id}/verify-id", [
            'id_type' => 'philid',
        ])->assertStatus(401);

        $this->actingAsUser('patientA');
        $this->postJson("/api/patients/{$patient->public_id}/verify-id", [
            'id_type' => 'philid',
        ])->assertStatus(403);

        $this->actingAsUser('dentist1');
        $this->postJson("/api/patients/{$patient->public_id}/verify-id", [
            'id_type' => 'philid',
        ])->assertStatus(403);
    }

    public function test_verify_id_requires_other_details_when_id_type_is_other(): void
    {
        $patient = $this->p['A'];
        $this->existing('A', 'd1', 'b1', 'svc1', '2026-09-29', '09:00');
        $this->actingAsUser('staffB1');

        $this->postJson("/api/patients/{$patient->public_id}/verify-id", [
            'id_type' => 'other',
        ])->assertStatus(422)->assertJsonValidationErrors('other_details');

        $this->postJson("/api/patients/{$patient->public_id}/verify-id", [
            'id_type' => 'other',
            'other_details' => '   ',
        ])->assertStatus(422)->assertJsonValidationErrors('other_details');
    }

    public function test_verify_id_stores_other_details_and_clears_stale_details_on_subsequent_standard_id(): void
    {
        $patient = $this->p['A'];
        $identity = [$patient->person_id, $patient->patient_code, $patient->consent, $patient->person->fullName()];
        $this->existing('A', 'd1', 'b1', 'svc1', '2026-09-29', '09:00');
        $this->actingAsUser('staffB1');

        // 1. Submit Other with specification
        $res = $this->postJson("/api/patients/{$patient->public_id}/verify-id", [
            'id_type' => 'other',
            'other_details' => 'PhilHealth Card',
        ])->assertOk();

        $this->assertSame('other', $res->json('data.id_type'));
        $this->assertSame('PhilHealth Card', $res->json('data.other_details'));
        $this->assertSame('other', $patient->fresh()->id_type);
        $this->assertSame('PhilHealth Card', $patient->fresh()->other_details);

        // 2. Resource exposes other_details when type is other
        $recordRes = $this->getJson("/api/patients/{$patient->public_id}")->assertOk();
        $this->assertSame('other', $recordRes->json('data.id_check.type'));
        $this->assertSame('PhilHealth Card', $recordRes->json('data.id_check.other_details'));

        // 3. Re-verifying with a standard ID type clears stale other_details
        $switchRes = $this->postJson("/api/patients/{$patient->public_id}/verify-id", [
            'id_type' => 'philid',
        ])->assertOk();

        $this->assertSame('philid', $switchRes->json('data.id_type'));
        $this->assertNull($switchRes->json('data.other_details'));
        $this->assertSame('philid', $patient->fresh()->id_type);
        $this->assertNull($patient->fresh()->other_details);
        $unchanged = $patient->fresh();
        $this->assertSame($identity, [$unchanged->person_id, $unchanged->patient_code, $unchanged->consent, $unchanged->person->fullName()]);

        $recordRes2 = $this->getJson("/api/patients/{$patient->public_id}")->assertOk();
        $this->assertSame('philid', $recordRes2->json('data.id_check.type'));
        $this->assertNull($recordRes2->json('data.id_check.other_details'));
    }

    public function test_confirm_intake_validates_other_details_when_id_verified_and_other(): void
    {
        $this->submitForm($this->form())->assertCreated();
        $this->actingAsUser('staffB1');
        $id = $this->getJson('/api/intake/submissions')->assertOk()->json('data.0.id');

        // Missing other_details on id_verified = true and id_type = other
        $this->postJson("/api/intake/submissions/{$id}/confirm", [
            'id_verified' => true,
            'id_type' => 'other',
        ])->assertStatus(422)->assertJsonValidationErrors('other_details');

        // Valid submission with other_details
        $this->postJson("/api/intake/submissions/{$id}/confirm", [
            'id_verified' => true,
            'id_type' => 'other',
            'other_details' => 'Company Health Card',
        ])->assertOk();

        $created = Patient::latest('id')->first();
        $this->assertSame('other', $created->id_type);
        $this->assertSame('Company Health Card', $created->other_details);
    }

    public function test_gen07_relationship_other_is_required_when_relationship_is_other(): void
    {
        $this->p['A']->person->update(['date_of_birth' => '1985-01-01']);
        $this->actingAsUser('patientA');

        // 1. Portal /api/me/dependents rejects Relationship = Other without relationship_other
        $this->postJson('/api/me/dependents', [
            'first_name' => 'Lia',
            'last_name' => 'Kid',
            'date_of_birth' => '2017-05-05',
            'relationship' => 'Other',
            'consent' => true,
        ], ['Idempotency-Key' => (string) \Illuminate\Support\Str::uuid()])->assertStatus(422)->assertJsonValidationErrors('relationship_other');

        // 2. Portal /api/me/dependents accepts Relationship = Other with relationship_other and persists both
        $res = $this->postJson('/api/me/dependents', [
            'first_name' => 'Lia',
            'last_name' => 'Kid',
            'date_of_birth' => '2017-05-05',
            'relationship' => 'Other',
            'relationship_other' => 'Niece',
            'consent' => true,
        ], ['Idempotency-Key' => (string) \Illuminate\Support\Str::uuid()])->assertCreated();

        $this->assertSame('Other', $res->json('data.relationship'));
        $this->assertSame('Niece', $res->json('data.relationship_other'));

        // 3. Intake submission rejects dependent with Relationship = Other and blank relationship_other
        $this->submitForm($this->form([], [
            'dependents' => [[
                'first_name' => 'Ben',
                'last_name' => 'Specimen',
                'date_of_birth' => '2018-03-03',
                'relationship' => 'Other',
                'relationship_other' => '   ',
            ]],
        ]))->assertStatus(422)->assertJsonValidationErrors('dependents.0.relationship_other');
    }

    public function test_gen07_intake_other_relationship_survives_staff_confirmation(): void
    {
        $body = $this->form([], ['dependents' => [[
            'first_name' => 'Lia', 'last_name' => 'Specimen', 'date_of_birth' => '2017-05-05',
            'relationship' => 'Other', 'relationship_other' => 'Niece',
        ]]]);
        $this->submitForm($body)->assertCreated();

        $this->actingAsUser('staffB2');
        $this->getJson('/api/intake/submissions')->assertOk()->assertJsonCount(0, 'data');
        $this->actingAsUser('staffB1');
        $row = $this->getJson('/api/intake/submissions')->assertOk()->json('data.0');
        $this->assertSame('Other', $row['dependents'][0]['relationship']);
        $this->assertSame('Niece', $row['dependents'][0]['relationship_other']);

        $this->postJson("/api/intake/submissions/{$row['id']}/confirm", ['id_verified' => true, 'id_type' => 'philid'])->assertOk();
        $link = PatientGuardian::where('relationship_other', 'Niece')->sole();
        $this->assertSame('Other', $link->relationship);
        $this->assertSame('Lia Specimen', $link->dependent->person->fullName());
        $this->assertSame('Joanna Specimen', $link->guardian->person->fullName());
    }
}
