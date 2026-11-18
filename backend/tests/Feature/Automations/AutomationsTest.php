<?php

namespace Tests\Feature\Automations;

use App\Mail\AppointmentReminderMail;
use App\Mail\InvoiceOverdueMail;
use App\Mail\NoShowRebookMail;
use App\Mail\OwnerDailySummaryMail;
use App\Mail\RecallMail;
use App\Mail\WaitlistOpeningMail;
use App\Models\Appointment;
use App\Models\AuditLog;
use App\Models\AutomationDelivery;
use App\Models\AutomationSetting;
use App\Models\Invoice;
use App\Models\MailDispatch;
use App\Models\MessageTemplate;
use App\Models\NoShowFlag;
use App\Models\Treatment;
use App\Models\UserNotification;
use App\Models\Visit;
use App\Models\WaitlistEntry;
use App\Services\Automations\AutomationLog;
use App\Services\Automations\AutomationRunner;
use App\Support\Ics;
use Carbon\CarbonImmutable;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Facades\Queue;
use Tests\Feature\Appointments\SchedulingFixture;
use Tests\TestCase;

/**
 * Scheduled automations A1–A6 with frozen time in Asia/Manila, including runs that cross midnight and the UTC date boundary
 * (Manila is UTC+8: 08:00 Manila is 00:00 UTC, so the UTC date changes at 08:00 Manila).
 */
class AutomationsTest extends TestCase
{
    use RefreshDatabase, SchedulingFixture;

    protected function setUp(): void
    {
        parent::setUp();
        Mail::fake();
        $this->setUpSchedulingWorld(); // frozen at Monday 2026-09-28 10:00 Asia/Manila; branches open 09:00–18:00 every day
        $this->u['patientA']->forceFill(['email' => 'patient.a@mailbox.ph', 'email_verified_at' => now()])->save();
        $this->u['owner']->forceFill(['email' => 'owner@mailbox.ph'])->save();
        $this->approveWordingAndSwitchOnDefaults();
    }

    /** The shipped state after the Owner (and, for recall, a Dentist) approved every wording and switched on the default-on automations. */
    private function approveWordingAndSwitchOnDefaults(): void
    {
        foreach (MessageTemplate::all() as $t) {
            $t->forceFill(['approved_at' => now(), 'approved_by_user_id' => $this->u['owner']->id] + ($t->needs_dentist ? ['dentist_approved_at' => now(), 'dentist_approved_by_user_id' => $this->u['dentist1']->id] : []))->save();
        }
        foreach (\App\Services\Automations\AutomationCatalog::definitions() as $key => $d) {
            if (! \App\Services\Automations\AutomationCatalog::isPolicy($key)) AutomationSetting::whereKey($key)->update(['enabled' => $d[3]]);
        }
    }

    private function at(string $manila): void
    {
        $this->travelTo(CarbonImmutable::parse($manila, 'Asia/Manila'));
    }

    private function runAutomations(array $only = []): array
    {
        return app(AutomationRunner::class)->run(null, $only);
    }

    private function bookWednesdayNine(): Appointment
    {
        $this->actingAsUser('patientA');
        $id = $this->book(['date' => '2026-09-30', 'start_time' => '09:00'])->assertCreated()->json('data.id');

        return Appointment::where('public_id', $id)->firstOrFail();
    }

    private function set(string $key, array $settings, ?bool $enabled = null): void
    {
        $row = AutomationSetting::findOrFail($key);
        $row->settings = array_merge($row->settings, $settings);
        if ($enabled !== null) $row->enabled = $enabled;
        $row->save();
    }

    // ---- A1 appointment reminders ------------------------------------------------------------------------------------

    public function test_the_optional_reminder_is_sent_24_hours_before_in_manila_time_once(): void
    {
        $this->set('appointment_reminders', ['day_before' => true]);
        $appointment = $this->bookWednesdayNine(); // Wed 09:00 Manila = Wed 01:00 UTC
        $this->at('2026-09-29 08:59'); // Tue 00:59 UTC
        $this->runAutomations();
        Mail::assertNotSent(AppointmentReminderMail::class);

        $this->at('2026-09-29 09:00');
        $this->runAutomations();
        $this->runAutomations(); // a second scheduler run sends nothing more
        Mail::assertSent(AppointmentReminderMail::class, 1);
        Mail::assertSent(AppointmentReminderMail::class, function (AppointmentReminderMail $m) {
            $html = $m->render();
            return $m->hasTo('patient.a@mailbox.ph') && str_contains($html, 'Your visit is tomorrow') && str_contains($html, 'September 30, 2026')
                && str_contains($html, '9:00 AM') && str_contains($html, '123 St') && str_contains($html, '?appointment=')
                && ! str_contains($html, 'Service svc1') && ! str_contains($html, '₱');
        });
        $this->assertStringContainsString('DTSTART:20260930T010000Z', Ics::appointment($appointment));
        $this->assertSame(1, UserNotification::where('kind', 'appointment_reminder')->count());
        $this->assertSame(1, AutomationDelivery::where('automation', 'appointment_reminders')->where('outcome', 'queued')->count());
    }

    public function test_the_morning_of_reminder_crosses_midnight_and_the_utc_date(): void
    {
        $this->set('appointment_reminders', ['day_before' => true, 'morning_of' => true, 'morning_time' => '08:00']);
        $this->actingAsUser('patientA');
        $this->book(['date' => '2026-09-30', 'start_time' => '11:00'])->assertCreated();
        $this->at('2026-09-29 23:59'); // Tue 15:59 UTC: the 24-hour reminder is due, the morning one is not
        $this->runAutomations();
        $this->at('2026-09-30 07:59'); // Tue 23:59 UTC
        $this->runAutomations();
        Mail::assertSent(AppointmentReminderMail::class, fn ($m) => $m->kind === 'day');
        Mail::assertNotSent(AppointmentReminderMail::class, fn ($m) => $m->kind === 'morning');

        $this->at('2026-09-30 08:00'); // Wed 00:00 UTC
        $this->runAutomations();
        Mail::assertSent(AppointmentReminderMail::class, fn ($m) => $m->kind === 'morning' && str_contains($m->render(), 'Your visit is today'));
        Mail::assertSent(AppointmentReminderMail::class, 2);
        $this->at('2026-09-30 10:00'); // and the 60-minute reminder
        $this->runAutomations();
        Mail::assertSent(AppointmentReminderMail::class, 3);
    }

    public function test_a_rescheduled_appointment_gets_a_recalculated_reminder_and_the_old_one_is_dropped(): void
    {
        Queue::fake(); // hold the outbox job so the reschedule happens between queueing and sending
        $this->set('appointment_reminders', ['day_before' => true]);
        $appointment = $this->bookWednesdayNine();
        $this->at('2026-09-29 09:00');
        $this->runAutomations();
        $old = MailDispatch::where('purpose', 'appointment_reminder')->sole();

        $this->actingAsUser('staffB1');
        $this->postJson("/api/appointments/{$appointment->public_id}/reschedule", ['expected_revision' => 1, 'date' => '2026-10-01', 'start_time' => '10:00'])->assertOk();
        $this->assertSame('superseded', app(\App\Services\Mail\MailOutbox::class)->process($old->id));
        Mail::assertNotSent(AppointmentReminderMail::class);

        $this->runAutomations(); // Thursday 10:00 minus 24 h is Wednesday 10:00: not yet
        $this->assertSame(1, MailDispatch::where('purpose', 'appointment_reminder')->count());
        $this->at('2026-09-30 10:00');
        $this->runAutomations();
        $this->runAutomations();
        $new = MailDispatch::where('purpose', 'appointment_reminder')->where('subject_revision', 2)->sole();
        $this->assertSame('logged_only', app(\App\Services\Mail\MailOutbox::class)->process($new->id));
        Mail::assertSent(AppointmentReminderMail::class, fn ($m) => str_contains($m->render(), 'October 1, 2026') && str_contains($m->render(), '10:00 AM'));
        Mail::assertSent(AppointmentReminderMail::class, 1);
    }

    public function test_a_cancelled_appointment_gets_no_reminder(): void
    {
        $appointment = $this->bookWednesdayNine();
        $this->actingAsUser('staffB1');
        $this->postJson("/api/appointments/{$appointment->public_id}/cancel", ['expected_revision' => 1, 'reason' => 'Synthetic cancellation'])->assertOk();
        $this->at('2026-09-29 09:00');
        $this->runAutomations();
        Mail::assertNotSent(AppointmentReminderMail::class);
        $this->assertSame(0, AutomationDelivery::count());
    }

    public function test_no_reminder_for_a_visit_booked_within_the_lead_time_or_without_a_verified_email(): void
    {
        $this->set('appointment_reminders', ['day_before' => true]);
        $this->at('2026-09-29 10:00');
        $this->actingAsUser('patientA');
        $this->book(['date' => '2026-09-30', 'start_time' => '09:00'])->assertCreated(); // 23 hours ahead
        $this->runAutomations();
        Mail::assertNotSent(AppointmentReminderMail::class);
        $this->assertSame('booked_within_lead_time', AutomationDelivery::sole()->reason);

        $this->u['patientA']->forceFill(['email_verified_at' => null])->save();
        $this->existing('A', 'd1', 'b1', 'svc1', '2026-10-02', '09:00');
        $this->at('2026-10-01 09:00');
        $this->runAutomations();
        Mail::assertNotSent(AppointmentReminderMail::class);
        $this->assertTrue(AutomationDelivery::where('reason', 'email_not_verified')->exists());
    }

    public function test_the_minutes_before_setting_is_respected(): void
    {
        $this->set('appointment_reminders', ['lead_minutes' => 120]);
        $this->bookWednesdayNine();
        $this->at('2026-09-30 06:59');
        $this->runAutomations();
        Mail::assertNotSent(AppointmentReminderMail::class);
        $this->at('2026-09-30 07:00');
        $this->runAutomations();
        Mail::assertSent(AppointmentReminderMail::class, 1);
    }

    // ---- A2 no-show detection ----------------------------------------------------------------------------------------

    public function test_in_ask_mode_a_possible_no_show_is_flagged_at_the_release_time_and_only_a_person_confirms_it(): void
    {
        $this->set('no_show', ['release_mode' => 'ask', 'release_minutes' => 30, 'rebook_email' => false]);
        $a = $this->existing('A', 'd1', 'b1', 'svc1', '2026-09-28', '11:00');
        $this->at('2026-09-28 11:29');
        $this->runAutomations();
        $this->assertSame(0, NoShowFlag::count());
        $this->at('2026-09-28 11:30');
        $this->runAutomations();
        $this->runAutomations();
        $flag = NoShowFlag::sole();
        $this->assertSame('Confirmed', $a->fresh()->status); // the system never finalizes a no-show

        $this->actingAsUser('staffB2');
        $this->getJson('/api/no-show-flags')->assertOk()->assertJsonCount(0, 'data'); // other branch
        $this->actingAsUser('staffB1');
        $this->getJson('/api/no-show-flags')->assertOk()->assertJsonPath('data.0.appointment.code', $a->fresh()->appointment_code);
        $this->postJson("/api/no-show-flags/{$flag->public_id}/confirm")->assertOk()->assertJsonPath('data.status', 'confirmed');
        $this->assertSame('No-show', $a->fresh()->status);
        $this->postJson("/api/no-show-flags/{$flag->public_id}/dismiss")->assertStatus(422);
        Mail::assertNotSent(NoShowRebookMail::class); // the rebook email was switched off here
    }

    public function test_undo_and_late_arrival_clear_the_flag_and_the_rebook_email_is_optional(): void
    {
        $this->set('no_show', ['release_mode' => 'ask', 'release_minutes' => 30, 'rebook_email' => true]);
        $a = $this->existing('A', 'd1', 'b1', 'svc1', '2026-09-28', '11:00');
        $b = $this->existing('A', 'd1', 'b1', 'svc1', '2026-09-28', '14:00');
        $this->at('2026-09-28 14:30');
        $this->runAutomations();
        [$fa, $fb] = [NoShowFlag::where('appointment_id', $a->id)->sole(), NoShowFlag::where('appointment_id', $b->id)->sole()];
        $this->actingAsUser('staffB1');
        $this->postJson("/api/no-show-flags/{$fa->public_id}/dismiss")->assertOk()->assertJsonPath('data.status', 'dismissed');
        $this->assertSame('Confirmed', $a->fresh()->status);
        $this->postJson("/api/no-show-flags/{$fb->public_id}/confirm")->assertOk();
        Mail::assertSent(NoShowRebookMail::class, fn ($m) => $m->hasTo('patient.a@mailbox.ph') && str_contains($m->render(), 'We missed you'));
        $this->assertTrue(AuditLog::where('action', 'automation.no_show_confirmed')->exists());
    }

    // ---- A3 overdue invoices -----------------------------------------------------------------------------------------

    private function issuedInvoice(string $issuedAt, string $amount = '1500.00'): Invoice
    {
        $when = '2026-09-28 09:00:00+08';
        $visit = Visit::create(['patient_id' => $this->p['A']->id, 'branch_id' => $this->b['b1']->id, 'source' => 'walk_in', 'status' => 'In Treatment', 'responsible_dentist_profile_id' => $this->d['d1']->id, 'requested_service_id' => $this->svc['svc1']->id, 'arrived_at' => $when, 'clinic_date' => '2026-09-28', 'revision' => 1, 'created_by_user_id' => $this->u['staffB1']->id, 'updated_by_user_id' => $this->u['staffB1']->id]);
        $treatment = Treatment::create(['visit_id' => $visit->id, 'dentist_profile_id' => $this->d['d1']->id, 'status' => 'In Treatment', 'procedure_summary' => 'x', 'started_at' => $when, 'revision' => 1, 'created_by_user_id' => $this->u['dentist1']->id, 'updated_by_user_id' => $this->u['dentist1']->id]);
        DB::transaction(function () use ($treatment, $visit, $when) {
            $visit->update(['status' => 'Completed', 'closed_at' => $when, 'revision' => 2]);
            $treatment->update(['status' => 'Completed', 'completed_at' => $when, 'revision' => 2]);
        });

        return Invoice::create(['treatment_id' => $treatment->id, 'visit_id' => $visit->id, 'patient_id' => $this->p['A']->id, 'branch_id' => $this->b['b1']->id, 'invoice_number' => 'INV-T-1', 'status' => 'Issued', 'revision' => 3, 'gross_amount' => $amount, 'hmo_coverage_amount' => '0.00', 'patient_responsibility_amount' => $amount, 'paid_amount' => '0.00', 'issued_at' => CarbonImmutable::parse($issuedAt, 'Asia/Manila'), 'created_by_user_id' => $this->u['staffB1']->id, 'updated_by_user_id' => $this->u['staffB1']->id]);
    }

    public function test_overdue_reminders_follow_the_steps_wait_for_opening_hours_and_stop_when_paid(): void
    {
        $invoice = $this->issuedInvoice('2026-09-28 17:30'); // day 3 = Thursday Oct 1
        $this->at('2026-09-30 23:00');
        $this->runAutomations();
        Mail::assertNotSent(InvoiceOverdueMail::class);
        $this->at('2026-10-01 08:30'); // day 3, but the branch opens at 09:00
        $this->runAutomations();
        Mail::assertNotSent(InvoiceOverdueMail::class);
        $this->at('2026-10-01 09:00');
        $this->runAutomations();
        $this->runAutomations();
        Mail::assertSent(InvoiceOverdueMail::class, 1);
        Mail::assertSent(InvoiceOverdueMail::class, function (InvoiceOverdueMail $m) {
            $html = $m->render();
            return str_contains($html, 'INV-T-1') && str_contains($html, '1,500.00') && str_contains($html, 'Pay online') && str_contains($html, '?invoice=') && ! str_contains($html, 'Service svc1');
        });

        $this->actingAsUser('staffB1');
        $this->postJson("/api/invoices/{$invoice->public_id}/payment", ['expected_revision' => $invoice->fresh()->revision, 'method' => 'Cash'], ['Idempotency-Key' => 'pay-1'])->assertOk();
        $this->at('2026-10-05 10:00'); // day 7
        $this->runAutomations();
        Mail::assertSent(InvoiceOverdueMail::class, 1);
    }

    public function test_a_missed_step_is_skipped_in_favour_of_the_latest_one(): void
    {
        $this->issuedInvoice('2026-09-28 10:00');
        $this->at('2026-10-06 10:00'); // day 8: steps 3 and 7 are due; only 7 is sent
        $this->runAutomations();
        Mail::assertSent(InvoiceOverdueMail::class, 1);
        $this->assertTrue(AutomationDelivery::where('reason', 'superseded_by_later_reminder')->where('dedupe_key', 'like', '%:d3')->exists());
        $this->assertSame(7, MailDispatch::where('purpose', 'invoice_overdue')->sole()->subject_revision);
    }

    // ---- A4 recall ---------------------------------------------------------------------------------------------------

    public function test_recall_ships_off_and_sends_once_per_interval_when_a_rule_exists(): void
    {
        $this->issuedInvoice('2026-09-28 10:00'); // creates a completed General Dentistry visit on 2026-09-28
        $this->at('2027-03-28 10:00');
        $this->runAutomations();
        Mail::assertNotSent(RecallMail::class);

        $this->set('recall', ['rules' => [['category' => 'General Dentistry', 'months' => 6]]], true);
        $this->at('2027-03-27 17:59');
        $this->runAutomations();
        Mail::assertNotSent(RecallMail::class);
        $this->at('2027-03-28 09:00');
        $this->runAutomations();
        $this->runAutomations();
        Mail::assertSent(RecallMail::class, 1);
        Mail::assertSent(RecallMail::class, fn ($m) => str_contains($m->render(), 'Time for your check-up') && ! str_contains($m->render(), 'Service svc1'));
    }

    // ---- A5 waitlist -------------------------------------------------------------------------------------------------

    public function test_a_waitlisted_patient_hears_when_a_cancellation_frees_a_time(): void
    {
        // Fill Tuesday for both b1 Dentists (09:00–18:00, 30-minute service).
        [$this->u['patientC'], $this->p['C']] = $this->patient('PAT-0003');
        $blocking = [];
        foreach (['d1' => 'B', 'd2' => 'C'] as $d => $patient) {
            for ($m = 9 * 60; $m < 18 * 60; $m += 30) $blocking[] = $this->existing($patient, $d, 'b1', 'svc1', '2026-09-29', sprintf('%02d:%02d', intdiv($m, 60), $m % 60));
        }
        $this->actingAsUser('patientA');
        $id = $this->postJson('/api/waitlist', ['branch_ref' => 'b1', 'service_ref' => 'svc1', 'date' => '2026-09-29'])->assertCreated()->json('data.id');
        $this->runAutomations(['waitlist']);
        Mail::assertNotSent(WaitlistOpeningMail::class);

        $this->actingAsUser('staffB1');
        $slot = $blocking[10];
        $this->postJson("/api/appointments/{$slot->public_id}/cancel", ['expected_revision' => 1, 'reason' => 'Synthetic cancellation'])->assertOk();
        // F3 order: patients booked later that day get the move-up offers first; the waitlist waits for their head start.
        $this->runAutomations(['fill_slots', 'waitlist']);
        Mail::assertNotSent(WaitlistOpeningMail::class);
        $this->assertGreaterThan(0, \App\Models\SlotOffer::count());
        $this->at('2026-09-28 10:30');
        $this->runAutomations(['fill_slots', 'waitlist']);
        $this->runAutomations(['waitlist']);
        Mail::assertSent(WaitlistOpeningMail::class, 1);
        Mail::assertSent(WaitlistOpeningMail::class, fn ($m) => $m->hasTo('patient.a@mailbox.ph') && str_contains($m->render(), 'first'));
        $this->assertSame('notified', WaitlistEntry::where('public_id', $id)->sole()->status);
        $this->assertSame(1, UserNotification::where('kind', 'waitlist_opening')->count());
    }

    public function test_the_waitlist_refuses_open_days_and_expires_after_the_date(): void
    {
        $this->actingAsUser('patientA');
        $this->postJson('/api/waitlist', ['branch_ref' => 'b1', 'service_ref' => 'svc1', 'date' => '2026-09-30'])->assertStatus(422); // times are open
        $entry = WaitlistEntry::create(['patient_id' => $this->p['A']->id, 'branch_id' => $this->b['b1']->id, 'service_id' => $this->svc['svc1']->id, 'clinic_date' => '2026-09-29', 'status' => 'waiting']);
        $this->at('2026-09-30 00:00'); // the day after (Tue 16:00 UTC)
        $this->runAutomations(['waitlist']);
        $this->assertSame('expired', $entry->fresh()->status);
        $this->expectException(\Illuminate\Database\QueryException::class);
        DB::table('waitlist_entries')->where('id', $entry->id)->delete(); // never deleted
    }

    // ---- A6 Owner daily summary --------------------------------------------------------------------------------------

    public function test_the_owner_summary_goes_once_at_the_send_time_with_numbers_and_no_patient_names(): void
    {
        $this->at('2026-09-29 00:30'); // Mon 16:30 UTC: belongs to Tuesday in Manila
        $this->actingAsUser('patientA');
        $this->book(['date' => '2026-09-30', 'start_time' => '09:00'])->assertCreated();
        $this->at('2026-09-29 20:29');
        $this->runAutomations(['owner_summary']);
        Mail::assertNotSent(OwnerDailySummaryMail::class);
        $this->at('2026-09-29 20:30');
        $this->runAutomations(['owner_summary']);
        $this->runAutomations(['owner_summary']);
        Mail::assertSent(OwnerDailySummaryMail::class, 1);
        $name = $this->u['patientA']->person->first_name;
        Mail::assertSent(OwnerDailySummaryMail::class, function (OwnerDailySummaryMail $m) use ($name) {
            $html = $m->render();
            preg_match('/Appointments booked.*?>(\d+)</s', $html, $booked);
            return $m->hasTo('owner@mailbox.ph') && str_contains($html, 'Tuesday, September 29, 2026') && ($booked[1] ?? null) === '1'
                && ! str_contains($html, $name) && ! str_contains($html, 'patient.a@mailbox.ph');
        });
    }

    // ---- Owner page, audit and safety --------------------------------------------------------------------------------

    public function test_only_the_owner_manages_automations_and_every_change_is_audited_with_old_and_new_values(): void
    {
        $this->actingAsUser('staffB1');
        $this->getJson('/api/automations')->assertForbidden();
        $this->actingAsUser('owner');
        $list = $this->getJson('/api/automations')->assertOk();
        $this->assertSame(['appointment_reminders', 'no_show', 'fill_slots', 'overdue_invoices', 'recall', 'waitlist', 'owner_summary', 'attendance_policy', 'intake', 'staffing', 'followup_reminders', 'dental_chart', 'prescriptions', 'calendar_load'], array_column($list->json('data'), 'key'));
        $this->assertSame('R2-09', $list->json('data.0.defaults.sources.lead_minutes'));
        $this->assertNull($list->json('data.0.defaults.sources.day_before')); // recommended, not confirmed by the clinic
        $this->assertFalse($list->json('data.0.owner_saved'));
        $this->assertFalse($list->json('meta.demo'));

        $this->putJson('/api/automations/appointment_reminders', ['settings' => ['lead_minutes' => 999], 'expected_revision' => 1])->assertStatus(422);
        $this->putJson('/api/automations/appointment_reminders', ['settings' => ['typo' => 1], 'expected_revision' => 1])->assertStatus(422);
        $this->putJson('/api/automations/recall', ['settings' => ['rules' => [['category' => 'Nope', 'months' => 6]]], 'expected_revision' => 1])->assertStatus(422);
        $this->putJson('/api/automations/appointment_reminders', ['enabled' => false, 'settings' => ['lead_minutes' => 90], 'expected_revision' => 1])->assertOk();
        $this->putJson('/api/automations/appointment_reminders', ['enabled' => true, 'expected_revision' => 1])->assertStatus(409);
        $audit = AuditLog::where('action', 'automation.settings_updated')->sole();
        $this->assertEquals(['old' => 60, 'new' => 90], $audit->payload['changes']['settings.lead_minutes']);
        $this->assertEquals(['old' => true, 'new' => false], $audit->payload['changes']['enabled']);
        $this->assertSame($this->u['owner']->id, $audit->actor_user_id);

        $this->bookWednesdayNine();
        $this->at('2026-09-30 08:00');
        $this->runAutomations();
        Mail::assertNotSent(AppointmentReminderMail::class); // switched off
    }

    public function test_a_test_email_goes_only_to_the_signed_in_owner_and_the_demo_clock_is_refused_outside_the_demo_database(): void
    {
        $this->actingAsUser('owner');
        foreach (['appointment_reminders', 'no_show', 'fill_slots', 'overdue_invoices', 'recall', 'waitlist', 'owner_summary'] as $key) {
            $this->postJson("/api/automations/$key/test")->assertOk();
        }
        $this->postJson('/api/message-templates/no_show_rebook/test')->assertOk();
        foreach ([AppointmentReminderMail::class, \App\Mail\LateCheckMail::class, \App\Mail\MoveUpOfferMail::class, NoShowRebookMail::class, InvoiceOverdueMail::class, RecallMail::class, WaitlistOpeningMail::class, OwnerDailySummaryMail::class] as $class) {
            Mail::assertSent($class, fn ($m) => $m->hasTo('owner@mailbox.ph') && $m->test && str_starts_with($m->envelope()->subject, '[Test]'));
        }
        $this->postJson('/api/automations/demo-run', ['summary' => true])->assertNotFound();
        $this->assertSame(0, AutomationDelivery::count()); // tests never touch the automation log
    }

    public function test_the_log_is_append_only_and_one_key_never_sends_twice(): void
    {
        $appointment = $this->bookWednesdayNine();
        $key = 'appointment_reminder:'.$appointment->public_id.':r1:lead';
        $this->assertTrue(AutomationLog::queueEmail('appointment_reminders', $key, 'appointment_reminder', $appointment, 1, $this->u['patientA'], $this->b['b1']->id));
        $this->assertFalse(AutomationLog::queueEmail('appointment_reminders', $key, 'appointment_reminder', $appointment, 1, $this->u['patientA'], $this->b['b1']->id));
        $this->assertSame(1, MailDispatch::where('dedupe_key', $key)->count());
        $this->expectException(\Illuminate\Database\QueryException::class);
        DB::table('automation_deliveries')->update(['reason' => 'x']);
    }

    public function test_automation_test_endpoint_is_rate_limited(): void
    {
        $this->actingAsUser('owner');
        // Route has throttle:12,1 (allows 12 requests per minute, 13th is 429)
        for ($i = 0; $i < 12; $i++) {
            $this->postJson('/api/automations/appointment_reminders/test')->assertOk();
        }
        $this->postJson('/api/automations/appointment_reminders/test')->assertStatus(429);
    }
}
