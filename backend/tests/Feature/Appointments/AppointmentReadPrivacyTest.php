<?php

namespace Tests\Feature\Appointments;

use App\Enums\Role;
use App\Models\Appointment;
use App\Models\AppointmentHistory;
use App\Models\AuditLog;
use App\Models\UserBranchScope;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

class AppointmentReadPrivacyTest extends TestCase
{
    use RefreshDatabase, SchedulingFixture;

    private Appointment $own;
    private Appointment $foreign;
    private const MISSING = '01j00000000000000000000000';

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpSchedulingWorld();
        $this->own = $this->existing('A', 'd1', 'b1', 'svc1', '2026-10-01', '09:00');
        $this->foreign = $this->existing('B', 'd3', 'b2', 'svc1', '2026-10-01', '09:00');
        Http::fake();
    }

    public function test_exact_unauthorized_ids_are_indistinguishable_from_absent_ids_even_in_debug_mode(): void
    {
        config(['app.debug' => true]);
        $before = [$this->foreign->fresh()->getAttributes(), AppointmentHistory::count(), AuditLog::count()];
        foreach (['patientA', 'staffB1', 'staffNone', 'dentist1'] as $who) {
            $this->actingAsUser($who);
            $hidden = $this->getJson('/api/appointments/'.$this->foreign->public_id)->assertNotFound();
            $missing = $this->getJson('/api/appointments/'.self::MISSING)->assertNotFound();
            $this->assertSame(['message' => 'Appointment not found.'], $hidden->json());
            $this->assertSame($missing->getContent(), $hidden->getContent());
            $this->assertSame($missing->headers->get('Content-Type'), $hidden->headers->get('Content-Type'));
            $this->getJson('/api/appointments/'.$this->foreign->id)->assertNotFound()
                ->assertExactJson(['message' => 'Appointment not found.']);
        }
        $this->assertSame($before, [$this->foreign->fresh()->getAttributes(), AppointmentHistory::count(), AuditLog::count()]);
        Http::assertNothingSent();
    }

    public function test_authorized_reads_keep_exact_patient_branch_dentist_service_status_time_and_history(): void
    {
        AppointmentHistory::create(['appointment_id' => $this->own->id, 'event' => 'appointment.created',
            'from_status' => null, 'to_status' => 'Confirmed', 'revision' => 1, 'branch_id' => $this->own->branch_id,
            'dentist_profile_id' => $this->own->dentist_profile_id, 'starts_at' => $this->own->starts_at,
            'ends_at' => $this->own->ends_at, 'actor_user_id' => $this->u['staffB1']->id, 'actor_role' => 'staff', 'occurred_at' => now()]);
        $auditCount = AuditLog::count();
        foreach (['patientA', 'staffB1', 'staffBoth', 'dentist1', 'owner'] as $who) {
            $this->actingAsUser($who);
            $response = $this->getJson('/api/appointments/'.$this->own->public_id)->assertOk()
                ->assertJsonPath('data.id', $this->own->public_id)
                ->assertJsonPath('data.patient.id', $this->p['A']->public_id)
                ->assertJsonPath('data.patient.code', 'PAT-0001')
                ->assertJsonPath('data.branch.id', 'b1')->assertJsonPath('data.dentist.id', 'd1')
                ->assertJsonPath('data.service.id', 'svc1')->assertJsonPath('data.status', 'Confirmed')
                ->assertJsonPath('data.revision', 1)->assertJsonPath('data.date', '2026-10-01')
                ->assertJsonPath('data.start_time', '09:00')->assertJsonPath('data.ends_at', '2026-10-01T09:30:00+08:00')
                ->assertJsonCount(1, 'data.history')->assertJsonPath('data.history.0.event', 'appointment.created')
                ->assertJsonPath('data.history.0.actor_role', 'staff');
            $this->assertArrayNotHasKey('patient_id', $response->json('data'));
        }
        $this->assertSame(2, Appointment::count());
        $this->assertSame(1, AppointmentHistory::count());
        $this->assertSame($auditCount, AuditLog::count());
        Http::assertNothingSent();
    }

    public function test_revoked_branch_and_role_are_rechecked_for_an_exact_formerly_authorized_id(): void
    {
        $this->actingAsUser('staffB1');
        $this->getJson('/api/appointments/'.$this->own->public_id)->assertOk();
        // Reassign an existing membership rather than deleting historical/domain data.
        UserBranchScope::where('user_id', $this->u['staffB1']->id)->update(['branch_id' => $this->b['b2']->id]);
        $this->getJson('/api/appointments/'.$this->own->public_id)->assertNotFound()
            ->assertExactJson(['message' => 'Appointment not found.']);
        $this->u['owner']->update(['role' => Role::Staff]);
        $this->actingAsUser('owner'); // Middleware refetches current persisted role; stale in-memory role grants nothing.
        $hidden = $this->getJson('/api/appointments/'.$this->own->public_id)->assertNotFound();
        $missing = $this->getJson('/api/appointments/'.self::MISSING)->assertNotFound();
        $this->assertSame($missing->getContent(), $hidden->getContent());
        $this->assertSame('Confirmed', $this->own->fresh()->status);
    }

    public function test_inactive_and_stale_cookie_sessions_refuse_existing_and_missing_identifiers_identically(): void
    {
        foreach (['inactive', 'stale'] as $state) {
            $responses = [];
            foreach ([$this->own->public_id, self::MISSING] as $id) {
                $user = $this->u['patientA']->fresh();
                $user->update(['account_status' => 'Active']);
                Auth::forgetGuards();
                $this->postJson('/api/login', ['email' => $user->email, 'password' => 'Passw0rd!'])->assertOk();
                if ($state === 'inactive') $user->update(['account_status' => 'Inactive']);
                else $user->increment('auth_version');
                Auth::forgetGuards();
                $responses[] = $this->getJson('/api/appointments/'.$id)->assertForbidden()
                    ->assertJsonPath('code', 'session_revoked')->getContent();
                Auth::forgetGuards();
            }
            $this->assertSame($responses[0], $responses[1]);
        }
    }

    public function test_guest_refusals_do_not_disclose_existence_and_denied_reads_do_not_sync_payment(): void
    {
        $existing = $this->getJson('/api/appointments/'.$this->own->public_id)->assertUnauthorized();
        $missing = $this->getJson('/api/appointments/'.self::MISSING)->assertUnauthorized();
        $this->assertSame($existing->getContent(), $missing->getContent());
        $this->foreign->update(['booking_payment_status' => 'held', 'checkout_session_id' => 'synthetic-private-session']);
        $this->actingAsUser('patientA');
        $this->getJson('/api/appointments/'.$this->foreign->public_id)->assertNotFound()
            ->assertExactJson(['message' => 'Appointment not found.']);
        Http::assertNothingSent();
        $this->assertSame('held', $this->foreign->fresh()->booking_payment_status);
        $this->assertSame(0, AppointmentHistory::count());
    }
}
