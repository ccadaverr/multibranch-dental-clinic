<?php

namespace Tests\Feature\Staffing;

use App\Models\AuditLog;
use App\Models\AutomationSetting;
use App\Models\LeaveRequest;
use App\Models\MailDispatch;
use App\Models\MessageTemplate;
use App\Models\StaffProfile;
use App\Models\UserNotification;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Mail;
use Tests\Feature\Appointments\SchedulingFixture;
use Tests\TestCase;

/** M15 Leave Management, frozen at Monday 2026-09-28 10:00 Asia/Manila (SchedulingFixture). */
class LeaveTest extends TestCase
{
    use RefreshDatabase, SchedulingFixture, \Tests\Support\ObservedLeaveCommands;

    private const NOTE = 'Family matter, please keep private';

    protected function setUp(): void
    {
        parent::setUp();
        Mail::fake();
        $this->setUpSchedulingWorld();
    }

    private function slots(string $date, ?string $dentist = 'd1'): \Illuminate\Support\Collection
    {
        return collect($this->getJson("/api/appointments/availability?branch_ref=b1&service_ref=svc1&date=$date".($dentist ? "&dentist_ref=$dentist" : ''))->assertOk()->json('data.slots'));
    }

    private function request(array $body = [])
    {
        return $this->postLeave('/api/leave', $body + ['type' => 'vacation', 'start_date' => '2026-09-30', 'end_date' => '2026-09-30', 'private_note' => self::NOTE]);
    }

    private function approverSetting(string $value): void
    {
        $this->actingAsUser('owner');
        $this->putJson('/api/automations/staffing', ['expected_revision' => AutomationSetting::find('staffing')->revision, 'settings' => ['leave_approver' => $value]])->assertOk();
    }

    public function test_approved_leave_blocks_slots_any_available_skips_the_dentist_and_cancelling_frees_them(): void
    {
        $this->actingAsUser('dentist1');
        $id = $this->request()->assertCreated()->assertJsonPath('data.status', 'Pending')->json('data.id');
        $this->actingAsUser('staffB1');
        $this->assertCount(18, $this->slots('2026-09-30')); // pending leave blocks nothing

        $this->actingAsUser('owner');
        $this->postLeave("/api/leave/$id/decide", ['decision' => 'approve'])->assertOk()->assertJsonPath('data.status', 'Approved');
        $this->actingAsUser('staffB1');
        $this->assertCount(0, $this->slots('2026-09-30'));
        $this->assertSame(['d2'], $this->slots('2026-09-30', null)->pluck('dentist.id')->unique()->values()->all()); // "any available" skips d1
        $this->assertCount(18, $this->slots('2026-10-01')); // the next day is free
        // The booking calendar shows the day as "no dentist working" (not "fully booked", no waitlist), without saying why.
        $day = collect($this->getJson('/api/appointments/calendar?branch_ref=b1&service_ref=svc1&dentist_ref=d1&month=2026-09')->assertOk()->json('data.days'))->firstWhere('date', '2026-09-30');
        $this->assertSame(['date' => '2026-09-30', 'status' => 'off', 'reason' => 'The dentist is not working this day.'], $day);
        // Booking d1 directly is refused with the leave reason.
        $this->postLeave('/api/appointments', ['patient_id' => $this->p['A']->public_id, 'branch_ref' => 'b1', 'service_ref' => 'svc1', 'dentist_ref' => 'd1', 'date' => '2026-09-30', 'start_time' => '10:00'])
            ->assertStatus(422);

        $this->actingAsUser('dentist1');
        $this->postLeave("/api/leave/$id/cancel")->assertOk()->assertJsonPath('data.status', 'Cancelled');
        $this->actingAsUser('staffB1');
        $this->assertCount(18, $this->slots('2026-09-30'));
    }

    public function test_partial_day_leave_blocks_only_those_hours(): void
    {
        $this->actingAsUser('dentist1');
        $id = $this->request(['start_time' => '13:00', 'end_time' => '15:00', 'type' => 'other'])->assertCreated()->json('data.id');
        $this->actingAsUser('owner');
        $this->postLeave("/api/leave/$id/decide", ['decision' => 'approve'])->assertOk();
        $this->actingAsUser('staffB1');
        $times = $this->slots('2026-09-30')->pluck('start_time')->all();
        $this->assertContains('12:30', $times);
        $this->assertNotContains('13:00', $times);
        $this->assertNotContains('14:30', $times);
        $this->assertContains('15:00', $times);

        // STF-08: partial-day leave across multiple dates is rejected; end_time <= start_time is rejected.
        $this->actingAsUser('dentist1');
        $this->request(['start_date' => '2026-10-01', 'end_date' => '2026-10-02', 'start_time' => '09:00', 'end_time' => '12:00'])
            ->assertStatus(422)->assertJsonValidationErrors('end_date');
        $this->request(['start_date' => '2026-10-01', 'end_date' => '2026-10-01', 'start_time' => '14:00', 'end_time' => '12:00'])
            ->assertStatus(422)->assertJsonValidationErrors('end_time');
    }

    public function test_staff_and_dentist_partial_leave_round_trip_in_manila_and_owner_can_decide(): void
    {
        StaffProfile::create(['legacy_ref' => 's-b1', 'person_id' => $this->u['staffB1']->person_id, 'title' => 'Front desk', 'branch_id' => $this->b['b1']->id,
            'shift_start' => '09:00', 'shift_end' => '18:00', 'available' => true]);

        $this->actingAsUser('dentist1');
        $dentist = $this->request(['start_time' => '13:00', 'end_time' => '15:00'])->assertCreated()
            ->assertJsonPath('data.starts_at', '2026-09-30T13:00:00+08:00')
            ->assertJsonPath('data.ends_at', '2026-09-30T15:00:00+08:00');
        $dentistId = $dentist->json('data.id');
        $this->getJson('/api/leave/mine')->assertOk()->assertJsonPath('data.0.ends_at', '2026-09-30T15:00:00+08:00');

        $this->actingAsUser('staffB1');
        $staffId = $this->request(['start_date' => '2026-10-01', 'end_date' => '2026-10-01', 'start_time' => '09:00', 'end_time' => '12:00'])
            ->assertCreated()->assertJsonPath('data.starts_at', '2026-10-01T09:00:00+08:00')
            ->assertJsonPath('data.ends_at', '2026-10-01T12:00:00+08:00')->json('data.id');
        $this->request(['start_date' => '2026-10-01', 'end_date' => '2026-10-01', 'start_time' => '11:00', 'end_time' => '13:00'])
            ->assertStatus(422)->assertJsonValidationErrors('start_date');
        $this->request(['start_date' => '2026-10-02', 'end_date' => '2026-10-02', 'start_time' => '12:00', 'end_time' => '12:00'])
            ->assertStatus(422)->assertJsonValidationErrors('end_time');
        $this->request(['start_date' => '2026-09-27', 'end_date' => '2026-09-27', 'start_time' => '09:00', 'end_time' => '12:00'])
            ->assertStatus(422)->assertJsonValidationErrors('start_date');

        $this->actingAsUser('owner');
        $this->postLeave('/api/leave', ['type' => 'vacation', 'start_date' => '2026-10-02', 'end_date' => '2026-10-02'])
            ->assertForbidden();
        $pending = collect($this->getJson('/api/leave?status=Pending')->assertOk()->json('data'))->keyBy('id');
        $this->assertSame('2026-09-30T13:00:00+08:00', $pending[$dentistId]['starts_at']);
        $this->assertSame('2026-10-01T12:00:00+08:00', $pending[$staffId]['ends_at']);
        $this->assertTrue($pending[$dentistId]['can_decide']);
        $this->assertTrue($pending[$staffId]['can_decide']);
        $this->postLeave("/api/leave/$dentistId/decide", ['decision' => 'approve'])
            ->assertOk()->assertJsonPath('data.status', 'Approved')
            ->assertJsonPath('data.ends_at', '2026-09-30T15:00:00+08:00');
        $this->postLeave("/api/leave/$staffId/decide", ['decision' => 'approve'])
            ->assertOk()->assertJsonPath('data.status', 'Approved');
    }

    public function test_approving_with_booked_appointments_lists_them_with_cover_and_never_cancels(): void
    {
        $booked = $this->existing('A', 'd1', 'b1', 'svc1', '2026-09-30', '11:00');
        $this->actingAsUser('dentist1');
        $id = $this->request()->assertCreated()->json('data.id');
        $this->actingAsUser('owner');
        $before = $this->getJson("/api/leave/$id/conflicts")->assertOk();
        $this->assertSame([$booked->public_id], array_column($before->json('data.appointments'), 'id'));
        $this->assertSame('d2', $before->json('data.appointments.0.cover.0.id'));
        $approved = $this->postLeave("/api/leave/$id/decide", ['decision' => 'approve'])->assertOk();
        $this->assertSame([$booked->public_id], array_column($approved->json('data.appointments'), 'id'));
        $this->assertSame('Confirmed', $booked->fresh()->status);

        $this->postLeave("/api/leave/$id/notify")->assertStatus(422)->assertJsonPath('code', 'wording_not_approved');
        MessageTemplate::where('key', 'dentist_unavailable_notice')->update(['approved_at' => now(), 'approved_by_user_id' => $this->u['owner']->id]);
        $sent = $this->postLeave("/api/leave/$id/notify")->assertOk();
        $this->assertSame(1, $sent->json('data.emailed') + $sent->json('data.in_app_only'));
        $this->assertSame('Confirmed', $booked->fresh()->status);

        // The front desk moves it to the suggested cover with the normal reschedule command.
        $this->actingAsUser('staffB1');
        $this->postLeave("/api/appointments/{$booked->public_id}/reschedule", ['expected_revision' => $booked->revision, 'date' => '2026-09-30', 'start_time' => '11:00', 'dentist_ref' => 'd2'])->assertOk();
        $this->actingAsUser('owner');
        $this->getJson("/api/leave/$id/conflicts")->assertOk()->assertJsonCount(0, 'data.appointments');
    }

    public function test_the_private_note_is_seen_only_by_the_requester_and_approvers_and_never_in_audit_or_email(): void
    {
        MessageTemplate::whereIn('key', ['leave_requested', 'leave_decided'])->update(['approved_at' => now(), 'approved_by_user_id' => $this->u['owner']->id]);
        $this->actingAsUser('dentist1');
        $id = $this->request()->assertCreated()->assertJsonPath('data.private_note', self::NOTE)->json('data.id');
        $this->assertTrue(UserNotification::where('user_id', $this->u['owner']->id)->where('kind', 'leave_requested')->exists());
        $this->assertTrue(MailDispatch::where('purpose', 'leave_requested')->where('recipient_user_id', $this->u['owner']->id)->exists());

        // Owner only (default): the front desk cannot see or decide.
        $this->actingAsUser('staffB1');
        $this->getJson('/api/leave')->assertForbidden();
        $this->postLeave("/api/leave/$id/decide", ['decision' => 'approve'])->assertForbidden();
        // The team strip shows names and dates only.
        $strip = $this->getJson('/api/leave/calendar?from=2026-09-28&to=2026-10-04')->assertOk();
        $this->assertStringNotContainsString(self::NOTE, $strip->getContent());
        $this->assertStringNotContainsString('vacation', $strip->getContent());

        // Owner or branch front desk: staffB1 (b1) may decide and read the note; staffB2 (b2) may not.
        $this->approverSetting('owner_or_front_desk');
        $this->actingAsUser('staffB2');
        $this->assertSame([], $this->getJson('/api/leave')->assertOk()->json('data'));
        $this->actingAsUser('staffB1');
        $this->assertSame(self::NOTE, $this->getJson('/api/leave')->assertOk()->json('data.0.private_note'));
        $this->postLeave("/api/leave/$id/decide", ['decision' => 'decline'])->assertOk()->assertJsonPath('data.status', 'Declined');
        $this->assertTrue(UserNotification::where('user_id', $this->u['dentist1']->id)->where('kind', 'leave_decided')->exists());

        $this->assertStringNotContainsString(self::NOTE, AuditLog::where('action', 'like', 'leave.%')->get()->toJson());
        $this->assertStringNotContainsString(self::NOTE, UserNotification::all()->toJson());
        $this->assertNotSame(self::NOTE, \DB::table('leave_requests')->value('private_note')); // encrypted at rest
        $mail = new \App\Mail\LeaveMail(LeaveRequest::first(), 'leave_decided', 'Ana');
        $this->assertStringNotContainsString(self::NOTE, $mail->render());
    }

    public function test_nobody_approves_their_own_leave_and_staff_leave_does_not_touch_bookings(): void
    {
        StaffProfile::create(['legacy_ref' => 's-b1', 'person_id' => $this->u['staffB1']->person_id, 'title' => 'Front desk', 'branch_id' => $this->b['b1']->id,
            'shift_start' => '09:00', 'shift_end' => '18:00', 'available' => true]);
        $this->approverSetting('owner_or_front_desk');
        $this->actingAsUser('staffB1');
        $id = $this->request(['type' => 'sick'])->assertCreated()->json('data.id');
        $this->postLeave("/api/leave/$id/decide", ['decision' => 'approve'])->assertForbidden();
        $this->actingAsUser('owner');
        $this->postLeave("/api/leave/$id/decide", ['decision' => 'approve'])->assertOk()->assertJsonCount(0, 'data.appointments');
        $this->postLeave("/api/leave/$id/decide", ['decision' => 'decline'])->assertStatus(422); // decided once
        $this->actingAsUser('staffB1');
        $this->assertCount(18, $this->slots('2026-09-30'));
        $this->request(['start_date' => '2026-09-30', 'end_date' => '2026-10-02'])->assertStatus(422); // overlaps approved leave
        $this->expectException(\Illuminate\Database\QueryException::class);
        LeaveRequest::query()->delete();
    }
}
