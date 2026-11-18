<?php

namespace Tests\Feature\Automations;

use App\Mail\AppointmentReminderMail;
use App\Mail\ClosureNoticeMail;
use App\Mail\LateCheckMail;
use App\Mail\MoveUpOfferMail;
use App\Mail\NoShowRebookMail;
use App\Models\Appointment;
use App\Models\AppointmentResponse;
use App\Models\AuditLog;
use App\Models\AutomationSetting;
use App\Models\Branch;
use App\Models\MessageTemplate;
use App\Models\NoShowFlag;
use App\Models\QueueEntry;
use App\Models\SlotOffer;
use App\Models\SlotOpening;
use App\Models\UserNotification;
use App\Services\Automations\AutomationCatalog;
use App\Services\Automations\AutomationRunner;
use App\Services\Automations\OwnerSummaryData;
use App\Support\ActionLink;
use Carbon\CarbonImmutable;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Mail;
use Tests\Feature\Appointments\SchedulingFixture;
use Tests\TestCase;

/**
 * Interview round 2 (2026-10-19) features F1–F9 with frozen Asia/Manila time. The fixture starts on Monday 2026-09-28 10:00 Manila;
 * branches open 09:00–18:00 every day; svc1 takes 30 minutes, svc2 60.
 */
class InterviewRoundTwoTest extends TestCase
{
    use RefreshDatabase, SchedulingFixture;

    protected function setUp(): void
    {
        parent::setUp();
        Mail::fake();
        $this->setUpSchedulingWorld();
        [$this->u['patientC'], $this->p['C']] = $this->patient('PAT-0003');
        foreach (['patientA' => 'patient.a', 'patientB' => 'patient.b', 'patientC' => 'patient.c'] as $key => $box) {
            $this->u[$key]->forceFill(['email' => "$box@mailbox.ph", 'email_verified_at' => now()])->save();
        }
        $this->u['owner']->forceFill(['email' => 'owner@mailbox.ph'])->save();
    }

    private function at(string $manila): void
    {
        $this->travelTo(CarbonImmutable::parse($manila, 'Asia/Manila'));
    }

    private function runJobs(array $only = []): array
    {
        return app(AutomationRunner::class)->run(null, $only);
    }

    private function approveAll(): void
    {
        foreach (MessageTemplate::all() as $t) {
            $t->forceFill(['approved_at' => now(), 'approved_by_user_id' => $this->u['owner']->id] + ($t->needs_dentist ? ['dentist_approved_at' => now(), 'dentist_approved_by_user_id' => $this->u['dentist1']->id] : []))->save();
        }
        foreach (AutomationCatalog::definitions() as $key => $d) {
            if (! AutomationCatalog::isPolicy($key)) AutomationSetting::whereKey($key)->update(['enabled' => $d[3]]);
        }
    }

    private function set(string $key, array $settings): void
    {
        $row = AutomationSetting::findOrFail($key);
        $row->settings = array_merge($row->settings, $settings);
        $row->save();
    }

    /** The one-time links in a rendered email, by purpose. */
    private function links(string $html): array
    {
        preg_match_all('/#respond\/([A-Za-z0-9_\-]+\.[A-Za-z0-9_\-]+)/', $html, $m);
        $out = [];
        foreach (array_unique($m[1]) as $token) $out[ActionLink::parse($token)['purpose']] = $token;

        return $out;
    }

    // ---- F1 reminders, one-click answers and approved wording -------------------------------------------------------

    public function test_everything_ships_off_until_the_owner_approves_the_wording(): void
    {
        $this->assertSame(0, AutomationSetting::where('enabled', true)->whereNotIn('key', AutomationCatalog::POLICIES)->count());
        $this->actingAsUser('owner');
        $this->putJson('/api/automations/appointment_reminders', ['enabled' => true, 'expected_revision' => 1])
            ->assertStatus(422)->assertJsonPath('code', 'wording_not_approved');
        $t = $this->getJson('/api/message-templates')->assertOk()->json('data.0');
        $this->assertSame('appointment_reminder', $t['key']);
        $this->assertFalse($t['approved']);
        $this->postJson('/api/message-templates/appointment_reminder/approve', ['expected_revision' => $t['revision']])->assertOk()->assertJsonPath('data.approved', true);
        $this->putJson('/api/automations/appointment_reminders', ['enabled' => true, 'expected_revision' => 1])->assertOk();

        // Editing the wording clears the approval and switches the automation off again (audited).
        $this->putJson('/api/message-templates/appointment_reminder', ['subject' => 'See you at {time}', 'body' => 'Hi {fist_name}', 'expected_revision' => $t['revision']])
            ->assertStatus(422);
        $this->putJson('/api/message-templates/appointment_reminder', ['subject' => 'See you at {time}', 'body' => "Hello {first_name}, see you at {branch}.", 'expected_revision' => $t['revision']])
            ->assertOk()->assertJsonPath('data.approved', false);
        $this->assertFalse(AutomationSetting::find('appointment_reminders')->enabled);
        $this->assertTrue(AuditLog::where('action', 'message_template.updated')->exists());
        $preview = $this->postJson('/api/message-templates/appointment_reminder/preview', ['subject' => 'Draft {time}', 'body' => 'A draft line for {branch}.'])->assertOk();
        $this->assertStringContainsString('A draft line for', $preview->json('data.html'));

        // The runner never sends unapproved wording even if the switch were forced on.
        AutomationSetting::whereKey('appointment_reminders')->update(['enabled' => true]);
        $this->existing('A', 'd1', 'b1', 'svc1', '2026-09-28', '10:30');
        $this->assertSame('wording_not_approved', $this->runJobs(['appointment_reminders'])['appointment_reminders']['blocked']);
        Mail::assertNotSent(AppointmentReminderMail::class);
    }

    public function test_recall_wording_and_intervals_need_a_dentist(): void
    {
        $this->actingAsUser('owner');
        $t = MessageTemplate::find('recall_due');
        $this->postJson('/api/message-templates/recall_due/approve', ['expected_revision' => $t->revision])->assertOk()->assertJsonPath('data.approved', false);
        $this->assertEquals([['category' => 'General Dentistry', 'months' => 6]], AutomationSetting::find('recall')->settings['rules']); // suggested, off
        $this->putJson('/api/automations/recall', ['enabled' => true, 'expected_revision' => 1])->assertStatus(422);
        $this->actingAsUser('staffB1');
        $this->getJson('/api/message-templates')->assertForbidden();
        $this->actingAsUser('dentist1');
        $this->assertSame(['recall_due', 'followup_due'], array_column($this->getJson('/api/message-templates')->assertOk()->json('data'), 'key'));
        $this->postJson('/api/message-templates/recall_due/dentist-approve', ['expected_revision' => $t->revision])->assertOk()->assertJsonPath('data.approved', true);
        $this->actingAsUser('owner');
        $this->putJson('/api/automations/recall', ['enabled' => true, 'expected_revision' => 1])->assertOk();
        // New intervals: the Dentist approved the old ones, so recall goes off until they approve again.
        $this->putJson('/api/automations/recall', ['settings' => ['rules' => [['category' => 'General Dentistry', 'months' => 12]]], 'expected_revision' => 2])->assertOk();
        $this->assertFalse(AutomationSetting::find('recall')->enabled);
        $this->assertNull(MessageTemplate::find('recall_due')->dentist_approved_at);
    }

    public function test_the_60_minute_reminder_and_its_links_work_once_expire_and_free_the_time(): void
    {
        $this->approveAll();
        $this->actingAsUser('patientA');
        $id = $this->book(['date' => '2026-09-30', 'start_time' => '09:00'])->assertCreated()->json('data.id');
        $a = Appointment::where('public_id', $id)->sole();
        $this->at('2026-09-30 07:59'); // Tue 23:59 UTC
        $this->runJobs();
        Mail::assertNotSent(AppointmentReminderMail::class);
        $this->at('2026-09-30 08:00'); // Wed 00:00 UTC: the UTC date changes exactly now
        $this->runJobs();
        $this->runJobs();
        Mail::assertSent(AppointmentReminderMail::class, 1);
        $html = Mail::sent(AppointmentReminderMail::class)->first()->render();
        $this->assertStringContainsString('9:00 AM', $html);
        $this->assertStringContainsString('I’ll be there', $html);
        $links = $this->links($html);
        $this->assertSame(['attend', 'cant_make_it'], array_keys($links));

        $this->getJson('/api/public/respond?token='.$links['attend'])->assertOk()->assertJsonPath('data.state', 'ready')->assertJsonMissingPath('data.appointment.service');
        $this->postJson('/api/public/respond', ['token' => $links['attend']])->assertOk()->assertJsonPath('data.state', 'done');
        $this->postJson('/api/public/respond', ['token' => $links['attend']])->assertStatus(422)->assertJsonPath('code', 'link_used');
        $this->assertSame('attending', AppointmentResponse::sole()->response);
        $this->getJson('/api/public/respond?token='.$links['attend'].'x')->assertNotFound(); // forged

        // "I can't make it" asks first, then cancels (a late cancellation: under 24 hours) and frees the time.
        $this->postJson('/api/public/respond', ['token' => $links['cant_make_it']])->assertStatus(422)->assertJsonPath('code', 'confirmation_required');
        $this->postJson('/api/public/respond', ['token' => $links['cant_make_it'], 'confirm' => true])->assertOk()->assertJsonPath('data.state', 'done');
        $this->assertSame('Cancelled', $a->fresh()->status);
        $this->assertTrue($a->fresh()->late_cancellation);
        $this->assertSame('cant_make_it', SlotOpening::sole()->source);

        // A link expires at the visit's start.
        $b = $this->existing('B', 'd2', 'b1', 'svc1', '2026-09-30', '08:30');
        $expired = ActionLink::make('attend', $b->public_id, 1, CarbonImmutable::instance($b->starts_at));
        $this->at('2026-09-30 08:30');
        $this->postJson('/api/public/respond', ['token' => $expired])->assertStatus(422)->assertJsonPath('code', 'link_expired');
    }

    // ---- F2 late arrivals -------------------------------------------------------------------------------------------

    public function test_the_5_10_and_15_minute_late_steps(): void
    {
        $this->approveAll();
        $a = $this->existing('A', 'd1', 'b1', 'svc1', '2026-09-28', '11:00');
        $b = $this->existing('B', 'd2', 'b1', 'svc1', '2026-09-28', '11:00', 60);
        $c = $this->existing('C', 'd1', 'b1', 'svc1', '2026-09-28', '11:30');
        $this->at('2026-09-28 11:04');
        $this->runJobs();
        Mail::assertNotSent(LateCheckMail::class);
        $this->at('2026-09-28 11:05');
        $this->runJobs();
        $this->runJobs();
        Mail::assertSent(LateCheckMail::class, 2); // A and B, once each
        $this->assertSame(2, UserNotification::where('kind', 'late_check')->count());
        $this->assertArrayHasKey('on_my_way', $this->links(Mail::sent(LateCheckMail::class)->first()->render()));

        $this->actingAsUser('patientA');
        $this->postJson("/api/appointments/{$a->public_id}/on-my-way")->assertOk();
        $this->at('2026-09-28 11:10');
        $this->actingAsUser('staffB1');
        $today = $this->getJson('/api/front-desk/today')->assertOk();
        $this->assertEqualsCanonicalizing([$a->public_id, $b->public_id], array_column($today->json('data.late'), 'appointment_id'));
        $this->assertSame('on_my_way', collect($today->json('data.late'))->firstWhere('appointment_id', $a->public_id)['reply']);

        // Owner-approved arrival FIFO supersedes the historical R2-07 late-arrival demotion.
        // A arrives late at 11:12, C at 11:13: A stays ahead. Clearing a late flag never rewrites arrival order.
        $this->at('2026-09-28 11:12');
        $this->postJson('/api/visits/check-in', ['appointment_id' => $a->public_id, 'expected_revision' => 1], ['Idempotency-Key' => 'ci-a'])->assertCreated();
        $this->at('2026-09-28 11:13');
        $this->postJson('/api/visits/check-in', ['appointment_id' => $c->public_id, 'expected_revision' => 1], ['Idempotency-Key' => 'ci-c'])->assertCreated();
        $entryA = QueueEntry::whereHas('visit', fn ($q) => $q->where('appointment_id', $a->id))->sole();
        $entryC = QueueEntry::whereHas('visit', fn ($q) => $q->where('appointment_id', $c->id))->sole();
        $this->assertTrue($entryA->late_arrival);
        $positions = app(\App\Services\Queue\QueueService::class)->positions([$entryA->dentist_queue_id]);
        $this->assertSame([1, 2], [$positions[$entryA->id], $positions[$entryC->id]]);
        $this->postJson("/api/queue/{$entryA->public_id}/late-order", ['reason' => 'Called ahead, was parking', 'expected_revision' => $entryA->revision], ['Idempotency-Key' => 'late-a'])->assertOk();
        $positions = app(\App\Services\Queue\QueueService::class)->positions([$entryA->dentist_queue_id]);
        $this->assertSame([1, 2], [$positions[$entryA->id], $positions[$entryC->id]]);
        $this->assertTrue(AuditLog::where('action', 'queue.late_order_restored')->exists());

        // 11:15: B never came: released automatically, rebook email, the rest of the hour is freed; the front desk can undo it.
        $this->at('2026-09-28 11:15');
        $this->runJobs(['no_show']);
        $this->assertSame('No-show', $b->fresh()->status);
        $this->assertSame('released', NoShowFlag::where('appointment_id', $b->id)->sole()->status);
        $this->assertSame(0, NoShowFlag::where('status', 'open')->count()); // nothing left for anyone to handle twice
        Mail::assertSent(NoShowRebookMail::class, fn ($m) => $m->hasTo('patient.b@mailbox.ph'));
        $opening = SlotOpening::where('appointment_id', $b->id)->sole();
        $this->assertSame('11:30', $opening->starts_at->setTimezone('Asia/Manila')->format('H:i'));
        $this->assertSame([$b->public_id], array_column($this->getJson('/api/front-desk/today')->json('data.released'), 'appointment_id'));
        $this->postJson("/api/front-desk/appointments/{$b->public_id}/undo-no-show", ['expected_revision' => $b->fresh()->revision])->assertOk();
        $this->assertSame('Confirmed', $b->fresh()->status);
        $this->assertSame('withdrawn', $opening->fresh()->status);
        $this->assertSame('system', DB::table('appointment_history')->where('appointment_id', $b->id)->where('event', 'appointment.no_show_released')->value('actor_role'));
    }

    // ---- F3 fill freed times ----------------------------------------------------------------------------------------

    public function test_a_freed_time_goes_to_a_later_patient_first_and_only_one_of_two_accepters_wins(): void
    {
        $this->approveAll();
        $x = $this->existing('A', 'd1', 'b1', 'svc1', '2026-09-29', '09:00');
        $y = $this->existing('B', 'd1', 'b1', 'svc1', '2026-09-29', '14:00');
        $z = $this->existing('C', 'd1', 'b1', 'svc1', '2026-09-29', '15:00');
        $this->actingAsUser('staffB1');
        $this->postJson("/api/appointments/{$x->public_id}/cancel", ['expected_revision' => 1, 'reason' => 'Synthetic cancellation'])->assertOk();
        $this->assertFalse($x->fresh()->late_cancellation); // the front desk's cancellation is never counted
        $this->runJobs(['fill_slots']);
        $this->runJobs(['fill_slots']);
        Mail::assertSent(MoveUpOfferMail::class, 2);
        [$offerY, $offerZ] = [SlotOffer::where('appointment_id', $y->id)->sole(), SlotOffer::where('appointment_id', $z->id)->sole()];
        $linkZ = $this->links(Mail::sent(MoveUpOfferMail::class, fn ($m) => $m->hasTo('patient.c@mailbox.ph'))->first()->render())['move_up'];

        $this->actingAsUser('patientB');
        $this->getJson('/api/slot-offers/mine')->assertOk()->assertJsonCount(1, 'data');
        $this->postJson("/api/slot-offers/{$offerY->public_id}/accept")->assertOk();
        $this->assertSame('09:00', $y->fresh()->starts_at->setTimezone('Asia/Manila')->format('H:i'));
        $this->actingAsUser('patientC');
        $this->postJson("/api/slot-offers/{$offerZ->public_id}/accept")->assertStatus(422)->assertJsonPath('code', 'offer_taken');
        $this->getJson('/api/public/respond?token='.$linkZ)->assertOk()->assertJsonPath('data.state', 'taken');
        $this->assertSame('15:00', $z->fresh()->starts_at->setTimezone('Asia/Manila')->format('H:i'));
        $this->assertSame(['accepted', 'lost'], [$offerY->fresh()->status, $offerZ->fresh()->status]);
        $this->assertSame('move_up', SlotOpening::where('appointment_id', $x->id)->sole()->filled_via);
        // The time Y left (14:00) is free now and offered in turn (Z is later that day).
        $this->assertSame('moved_up', SlotOpening::where('appointment_id', $y->id)->sole()->source);
        $this->assertSame(1, OwnerSummaryData::forDate('2026-09-28')['branches'][0]['refilled']['move_up']);
        // The database constraint is still the final guard: a direct double booking of 09:00 for d1 fails.
        $this->expectException(\Illuminate\Database\QueryException::class);
        $this->existing('C', 'd1', 'b1', 'svc1', '2026-09-29', '09:00');
    }

    // ---- F4 cancellation policy -------------------------------------------------------------------------------------

    public function test_late_cancellations_and_no_shows_count_toward_front_desk_confirmation(): void
    {
        $this->at('2026-09-28 12:00');
        $this->actingAsUser('patientA');
        $far = $this->book(['date' => '2026-10-05', 'start_time' => '09:00'])->assertCreated()->json('data.id');
        foreach (['09:00', '10:00', '11:00'] as $time) { // tomorrow, under 24 hours away
            $id = $this->book(['date' => '2026-09-29', 'start_time' => $time])->assertCreated()->json('data.id');
            $this->postJson("/api/appointments/$id/cancel", ['expected_revision' => 1, 'reason' => 'Synthetic cancellation'])->assertOk();
        }
        $this->assertSame(3, Appointment::where('late_cancellation', true)->count());
        $this->assertNotNull($this->p['A']->fresh()->confirmation_required_at);
        $this->assertSame('Confirmed', Appointment::where('public_id', $far)->sole()->status); // booked before the limit was reached
        $pending = $this->book(['date' => '2026-10-06', 'start_time' => '09:00'])->assertCreated()->assertJsonPath('data.status', 'Pending')->json('data.id');

        $this->actingAsUser('staffB1');
        $this->assertSame($pending, $this->getJson('/api/front-desk/today')->json('data.confirmations.0.appointment_id'));
        $this->postJson("/api/appointments/$pending/confirm", ['expected_revision' => 1])->assertOk()->assertJsonPath('data.status', 'Confirmed');
        $this->postJson("/api/patients/{$this->p['A']->public_id}/attendance/clear", ['reason' => 'Talked with the patient'])->assertOk();
        $this->actingAsUser('patientA');
        $this->book(['date' => '2026-10-07', 'start_time' => '09:00'])->assertCreated()->assertJsonPath('data.status', 'Confirmed');
        $this->postJson("/api/appointments/$far/cancel", ['expected_revision' => 1, 'reason' => 'Synthetic cancellation'])->assertOk();
        $this->assertFalse(Appointment::where('public_id', $far)->sole()->late_cancellation); // a week ahead is not late
        $this->assertStringContainsString('24 hours', \App\Services\Automations\AttendancePolicy::summary());
    }

    // ---- F5 closed dates --------------------------------------------------------------------------------------------

    public function test_a_closed_date_blocks_booking_lists_the_affected_appointments_and_never_cancels(): void
    {
        $this->approveAll();
        $kept = $this->existing('B', 'd1', 'b1', 'svc1', '2026-09-30', '10:00');
        $this->actingAsUser('owner');
        $id = $this->postJson('/api/branch-closures', ['branch_ref' => 'b1', 'date' => '2026-09-30', 'reason' => 'Staff training'])->assertCreated()->json('data.id');
        $this->postJson('/api/branch-closures', ['branch_ref' => 'b1', 'date' => '2026-10-01', 'open_time' => '09:00', 'close_time' => '12:00', 'reason' => 'Half day'])->assertCreated();

        $this->actingAsUser('patientA');
        $this->book(['date' => '2026-09-30', 'start_time' => '09:00'])->assertStatus(422);
        $this->book(['date' => '2026-10-01', 'start_time' => '14:00'])->assertStatus(422);
        $this->book(['date' => '2026-10-01', 'start_time' => '10:00'])->assertCreated();
        $day = collect($this->getJson('/api/appointments/calendar?branch_ref=b1&service_ref=svc1&month=2026-09')->assertOk()->json('data.days'))->firstWhere('date', '2026-09-30');
        $this->assertSame(['closed', 'Staff training'], [$day['status'], $day['reason']]);
        $this->getJson('/api/public/closures')->assertOk()->assertJsonPath('data.0.reason', 'Staff training');

        $this->actingAsUser('staffB2');
        $this->getJson("/api/branch-closures/$id/affected")->assertOk()->assertJsonCount(0, 'data'); // not their branch
        $this->actingAsUser('staffB1');
        $this->getJson("/api/branch-closures/$id/affected")->assertOk()->assertJsonPath('data.0.id', $kept->public_id);
        $this->postJson("/api/branch-closures/$id/notify")->assertOk()->assertJsonPath('data.emailed', 1);
        $this->postJson("/api/branch-closures/$id/notify")->assertOk()->assertJsonPath('data.already', 1);
        Mail::assertSent(ClosureNoticeMail::class, 1);
        $this->assertSame('Confirmed', $kept->fresh()->status);

        // Holidays are suggestions only until the Owner confirms each one.
        $this->actingAsUser('owner');
        $this->postJson('/api/branch-closures/suggest-holidays')->assertOk();
        $suggestion = \App\Models\BranchClosure::where('closed_on', '2026-11-30')->sole();
        $this->assertSame('suggested', $suggestion->status);
        $b1 = Branch::where('legacy_ref', 'b1')->sole();
        $this->assertNotNull($b1->hoursOnDate('2026-11-30'));
        $this->patchJson("/api/branch-closures/{$suggestion->public_id}", ['action' => 'confirm'])->assertOk();
        app(\App\Services\Closures\ClosureCalendar::class)->flush();
        $this->assertNull($b1->hoursOnDate('2026-11-30'));
    }

    // ---- F6 calendar load -------------------------------------------------------------------------------------------

    public function test_the_calendar_shows_load_against_the_dentists_hours(): void
    {
        foreach (['09:00', '09:30', '10:00'] as $t) $this->existing('A', 'd1', 'b1', 'svc1', '2026-09-29', $t);
        $this->set('calendar_load', ['crowded_percent' => 50]);
        $this->actingAsUser('staffB1');
        $day = $this->getJson('/api/calendar/load?from=2026-09-29&to=2026-09-30')->assertOk()->json('data.days.0');
        $this->assertSame([90, 1080, 8, false], [$day['booked_minutes'], $day['capacity_minutes'], $day['percent'], $day['crowded']]); // 2 Dentists x 9 hours
        $this->actingAsUser('staffB2');
        $this->assertSame(['b2'], array_column($this->getJson('/api/calendar/load?from=2026-09-29&to=2026-09-29')->json('data.branches'), 'id'));
        $this->getJson('/api/calendar/load?branch_ref=b1&from=2026-09-29&to=2026-09-29')->assertForbidden();
    }

    // ---- F7 consultation first --------------------------------------------------------------------------------------

    public function test_a_consultation_first_service_books_the_consultation_instead(): void
    {
        $this->svc['svc3'] = $this->service('svc3', 30);
        $this->offer('b1', 'svc3');
        $this->d['d1']->services()->attach($this->svc['svc3']->id, ['is_authorized' => true]);
        $this->actingAsUser('owner');
        $this->patchJson('/api/services/svc3/online-booking', ['online_booking' => 'consultation_first', 'consultation_ref' => 'svc3'])->assertStatus(422);
        $this->patchJson('/api/services/svc3/online-booking', ['online_booking' => 'consultation_first', 'consultation_ref' => 'svc1'])->assertOk()
            ->assertJsonPath('data.consultation_service_id', 'svc1');
        $this->getJson('/api/public/services')->assertOk();
        $this->assertTrue(collect($this->getJson('/api/public/services')->json('data'))->firstWhere('id', 'svc3')['starts_with_consultation']);

        $this->actingAsUser('patientA');
        $this->book(['service_ref' => 'svc3'])->assertStatus(422)->assertJsonPath('code', 'service_not_bookable_online');
        $this->actingAsUser('staffB1');
        $this->staffBook(['service_ref' => 'svc3', 'consultation_acknowledged' => true])->assertCreated(); // the front desk still books it (staff-direct path; acknowledgement required since Batch 4B)

        $this->actingAsUser('owner');
        $this->patchJson('/api/services/svc3/online-booking', ['online_booking' => 'hidden'])->assertOk();
        $this->assertNull(collect($this->getJson('/api/public/services')->json('data'))->firstWhere('id', 'svc3'));
    }

    // ---- F8 HMO information -----------------------------------------------------------------------------------------

    public function test_only_verified_hmos_are_shown_and_patients_keep_their_own_member_number(): void
    {
        $this->actingAsUser('owner');
        $id = $this->postJson('/api/accepted-hmos', ['name' => 'Intellicare'])->assertCreated()->assertJsonPath('data.verified', false)->json('data.id');
        $this->getJson('/api/public/hmos')->assertOk()->assertJsonCount(0, 'data');
        $this->patchJson("/api/accepted-hmos/$id", ['verified' => true, 'expected_revision' => 1])->assertOk();
        $this->getJson('/api/public/hmos')->assertOk()->assertJsonPath('data.0.name', 'Intellicare');
        $this->getJson('/api/public/faq')->assertOk()->assertJsonPath('meta.accepted_hmos.0.name', 'Intellicare');

        $this->actingAsUser('patientA');
        $this->putJson('/api/me/hmo', ['hmo_provider_name' => 'Intellicare', 'hmo_member_number' => 'IC-12345'])->assertOk()->assertJsonPath('data.hmo_member_number', 'IC-12345');
        $this->assertNotSame('IC-12345', DB::table('patients')->where('id', $this->p['A']->id)->value('hmo_member_number')); // encrypted at rest
        $this->assertSame('IC-12345', $this->p['A']->fresh()->hmo_member_number);
    }

    // ---- F9 summary -------------------------------------------------------------------------------------------------

    public function test_the_owner_summary_counts_late_cancellations_and_releases_without_names(): void
    {
        $this->approveAll();
        $b = $this->existing('B', 'd2', 'b1', 'svc1', '2026-09-28', '11:00', 60);
        $this->at('2026-09-28 11:16');
        $this->runJobs(['no_show']);
        $row = OwnerSummaryData::forDate('2026-09-28')['branches'][0];
        $this->assertSame([1, 0, 0], [$row['released'], $row['late_cancellations'], $row['possible_no_shows']]);
        $this->assertSame('No-show', $b->fresh()->status);
    }
}
