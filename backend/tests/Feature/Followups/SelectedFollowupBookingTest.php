<?php

namespace Tests\Feature\Followups;

use App\Models\Appointment;
use App\Models\AppointmentCommandKey;
use App\Models\AppointmentHistory;
use App\Models\AuditLog;
use App\Models\FollowupTask;
use App\Models\UserBranchScope;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Str;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\Attributes\Group;
use Tests\Feature\Appointments\SchedulingFixture;
use Tests\TestCase;

/** AUTHORED, NOT EXECUTED for AUD-10. Requires an approved, already-provisioned disposable PostgreSQL schema.
 * No RefreshDatabase, migration runner or schema reset. The inherited scratch guard is mandatory.
 */
#[Group('aud10-postgres-acceptance')]
final class SelectedFollowupBookingTest extends TestCase
{
    use DatabaseTransactions, SchedulingFixture;

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpSchedulingWorld();
        $this->actingAsUser('staffB1');
    }

    private function task(array $overrides = []): FollowupTask
    {
        return FollowupTask::create($overrides + ['patient_id' => $this->p['A']->id, 'branch_id' => $this->b['b1']->id,
            'reason' => 'Synthetic acceptance task', 'due_on' => '2026-10-05', 'source' => 'front_desk', 'status' => 'Open',
            'revision' => 7, 'created_by_user_id' => $this->u['staffB1']->id]);
    }

    private function selected(FollowupTask $task, array $overrides = [], ?string $key = 'selected-attempt')
    {
        if ($key === null) $this->flushHeaders();
        return $this->staffBook($overrides + ['followup_task_id' => $task->public_id, 'followup_expected_revision' => 7],
            $key === null ? [] : ['Idempotency-Key' => $key]);
    }

    public static function eligibleStates(): array { return [['Open'], ['Contacted']]; }

    #[DataProvider('eligibleStates')]
    public function test_selected_non_oldest_task_is_the_only_task_linked_and_proof_matches_storage(string $status): void
    {
        $older = $this->task(['due_on' => '2026-09-30']);
        $chosen = $this->task(['status' => $status]);
        $response = $this->selected($chosen)->assertCreated();
        $chosen->refresh();
        self::assertSame('Open', $older->fresh()->status);
        self::assertNull($older->fresh()->appointment_id);
        self::assertSame(7, $older->fresh()->revision);
        self::assertSame('Booked', $chosen->status);
        self::assertSame(8, $chosen->revision);
        self::assertSame($response->json('data.id'), $chosen->appointment->public_id);
        self::assertSame(['task_id' => $chosen->public_id, 'appointment_id' => $chosen->appointment->public_id,
            'status' => 'Booked', 'revision' => 8], $response->json('meta.followup_link'));
        self::assertSame(1, AppointmentHistory::where('appointment_id', $chosen->appointment_id)->count());
        $audit = AuditLog::where('action', 'followup.booked')->latest('id')->firstOrFail();
        self::assertSame($this->u['staffB1']->id, $audit->actor_user_id);
        self::assertStringNotContainsString('Synthetic acceptance task', $audit->toJson());
    }

    public function test_authorized_other_branch_selection_and_assignment_do_not_introduce_exclusive_ownership(): void
    {
        $task = $this->task(['branch_id' => $this->b['b2']->id, 'assignee_user_id' => $this->u['staffB2']->id]);
        $this->actingAsUser('staffBoth');
        $this->selected($task, ['branch_ref' => 'b2', 'dentist_ref' => 'd3'])->assertCreated()
            ->assertJsonPath('meta.followup_link.task_id', $task->public_id);
    }

    public function test_missing_and_out_of_scope_task_share_scoped_404_without_fallback(): void
    {
        $this->task(); // An alternative task must NOT be selected.
        $foreign = $this->task(['branch_id' => $this->b['b2']->id]);
        $this->selected($foreign)->assertNotFound();
        $this->staffBook(['followup_task_id' => (string) Str::ulid(), 'followup_expected_revision' => 7], ['Idempotency-Key' => 'missing'])->assertNotFound();
        self::assertSame(0, Appointment::count());
        self::assertSame(0, AppointmentCommandKey::count());
    }

    public function test_patient_and_branch_mismatches_are_422_and_leave_no_appointment_or_key(): void
    {
        $task = $this->task();
        $this->selected($task, ['patient_id' => $this->p['B']->public_id])->assertUnprocessable()->assertJsonPath('code', 'followup_patient_mismatch');
        $this->actingAsUser('staffBoth');
        $this->selected($task, ['branch_ref' => 'b2', 'dentist_ref' => 'd3'])->assertUnprocessable()->assertJsonPath('code', 'followup_branch_mismatch');
        self::assertSame(0, Appointment::count());
        self::assertSame(0, AppointmentCommandKey::count());
        self::assertSame(7, $task->fresh()->revision);
    }

    public static function forbiddenActors(): array { return [['owner'], ['patientA'], ['dentist1'], ['staffNone']]; }

    #[DataProvider('forbiddenActors')]
    public function test_selected_mode_does_not_grant_new_role_or_branch_authority(string $actor): void
    {
        $task = $this->task();
        $this->actingAsUser($actor);
        $this->selected($task)->assertForbidden();
        self::assertSame(0, Appointment::count());
    }

    public function test_incomplete_fields_explicit_nulls_invalid_identity_and_missing_key_are_422(): void
    {
        $task = $this->task();
        foreach ([['followup_task_id' => $task->public_id], ['followup_expected_revision' => 7],
            ['followup_task_id' => null, 'followup_expected_revision' => null],
            ['followup_task_id' => '123', 'followup_expected_revision' => 7],
            ['followup_task_id' => $task->public_id, 'followup_expected_revision' => 0]] as $fields) {
            $this->staffBook($fields, ['Idempotency-Key' => 'invalid'])->assertUnprocessable();
        }
        $this->selected($task, key: null)->assertUnprocessable()->assertJsonValidationErrors('idempotency_key');
        self::assertSame(0, Appointment::count());
        self::assertSame(0, AppointmentCommandKey::count());
    }

    public function test_stale_revision_contacted_update_and_closure_refuse_without_fallback(): void
    {
        $alternative = $this->task();
        $task = $this->task();
        $this->patchJson('/api/followups/'.$task->public_id, ['action' => 'contacted'])->assertOk();
        $this->selected($task)->assertConflict()->assertJsonPath('code', 'followup_conflict');
        $this->patchJson('/api/followups/'.$task->public_id, ['action' => 'close', 'note' => 'Synthetic closure'])->assertOk();
        $this->selected($task, ['followup_expected_revision' => 9])->assertConflict();
        self::assertSame(0, Appointment::count());
        self::assertSame('Open', $alternative->fresh()->status);
        self::assertSame(0, AppointmentCommandKey::count());
    }

    public function test_same_key_replays_booked_task_proof_but_changed_intent_or_new_key_is_refused(): void
    {
        $task = $this->task();
        $other = $this->task();
        $first = $this->selected($task)->assertCreated();
        $replay = $this->selected($task)->assertCreated()->assertHeader('Idempotent-Replayed', 'true');
        self::assertSame($first->json(), $replay->json());
        $this->selected($other)->assertUnprocessable()->assertJsonPath('code', 'idempotency_key_reused');
        $this->selected($task, ['followup_expected_revision' => 8])->assertUnprocessable()->assertJsonPath('code', 'idempotency_key_reused');
        $this->selected($task, key: 'new-key-same-slot')->assertConflict()->assertJsonPath('code', 'followup_conflict');
        $this->selected($task, ['start_time' => '10:00'], 'different-key')->assertConflict()->assertJsonPath('code', 'followup_conflict');
        self::assertSame(1, Appointment::count());
        self::assertSame(1, AppointmentCommandKey::count());
        self::assertSame(8, $task->fresh()->revision);
        self::assertSame('Open', $other->fresh()->status);
    }

    public function test_replay_rechecks_current_role_and_task_scope_without_revalidating_booked_state(): void
    {
        $task = $this->task();
        $this->selected($task)->assertCreated();
        // Move the task outside this actor's scope; its previous proof is no longer readable through this command.
        $task->update(['branch_id' => $this->b['b2']->id]);
        $this->selected($task)->assertNotFound();
        $task->update(['branch_id' => $this->b['b1']->id]);
        $this->u['staffB1']->update(['role' => \App\Enums\Role::Owner]);
        $this->actingAsUser('staffB1');
        $this->selected($task)->assertForbidden();
        self::assertSame(1, Appointment::count());
    }

    public function test_scope_revocation_prevents_replay_and_disabled_account_is_rejected(): void
    {
        $task = $this->task();
        $this->selected($task)->assertCreated();
        UserBranchScope::where('user_id', $this->u['staffB1']->id)->where('branch_id', $this->b['b1']->id)->delete();
        $this->selected($task)->assertForbidden();
        $this->u['staffB1']->update(['account_status' => 'Inactive']);
        $this->actingAsUser('staffB1');
        $this->selected($task)->assertForbidden();
        self::assertSame(1, Appointment::count());
    }

    public function test_rejected_schedule_rolls_back_key_task_and_appointment_and_same_key_can_retry(): void
    {
        $task = $this->task();
        $this->selected($task, ['start_time' => '02:00'])->assertUnprocessable();
        self::assertSame(0, Appointment::count());
        self::assertSame(0, AppointmentHistory::count());
        self::assertSame(0, AppointmentCommandKey::count());
        self::assertSame(0, AuditLog::where('action', 'followup.booked')->count());
        self::assertSame('Open', $task->fresh()->status);
        self::assertSame(7, $task->fresh()->revision);
        $this->selected($task)->assertCreated();
    }

    public function test_existing_link_is_refused_even_if_task_still_has_an_eligible_status(): void
    {
        $appointment = $this->existing('A', 'd1', 'b1', 'svc1', '2026-09-30', '11:00');
        $task = $this->task(['appointment_id' => $appointment->id]);
        $this->selected($task)->assertConflict();
        self::assertSame(1, Appointment::count());
        self::assertSame($appointment->id, $task->fresh()->appointment_id);
    }

    public function test_failure_after_link_write_rolls_back_appointment_task_audit_history_and_key(): void
    {
        $task = $this->task();
        $audit = \Mockery::mock(\App\Services\Audit\AuditService::class)->makePartial();
        $audit->shouldReceive('record')->withArgs(fn (array $data) => $data['action'] === 'followup.booked')
            ->andThrow(new \RuntimeException('Synthetic linkage audit failure'));
        $this->app->instance(\App\Services\Audit\AuditService::class, $audit);
        $this->withoutExceptionHandling();
        try {
            $this->selected($task);
            self::fail('The failed transaction must propagate.');
        } catch (\RuntimeException $e) {
            self::assertSame('Synthetic linkage audit failure', $e->getMessage());
        }
        self::assertSame(0, Appointment::count());
        self::assertSame(0, AppointmentHistory::count());
        self::assertSame(0, AppointmentCommandKey::count());
        self::assertSame(0, AuditLog::whereIn('action', ['followup.booked', 'appointment.created'])->count());
        self::assertSame(['Open', 7, null], [$task->fresh()->status, $task->fresh()->revision, $task->fresh()->appointment_id]);
    }

    public function test_late_task_refusal_rolls_back_provisional_appointment_and_slot_claim(): void
    {
        $task = $this->task();
        $freed = $this->existing('B', 'd1', 'b1', 'svc1', '2026-09-29', '09:00', status: 'Cancelled');
        $opening = \App\Models\SlotOpening::create(['appointment_id' => $freed->id, 'appointment_revision' => 1,
            'branch_id' => $this->b['b1']->id, 'dentist_profile_id' => $this->d['d1']->id,
            'starts_at' => $freed->starts_at, 'ends_at' => $freed->ends_at, 'clinic_date' => '2026-09-29',
            'source' => 'cancelled', 'status' => 'open']);
        // Deterministic late-change fault injection, NOT a substitute for the separate real-process closure case.
        // In R1 this happens after its only validation, allowing an obsolete task to be linked. R2 must refuse.
        Appointment::created(function () use ($task) {
            $task->update(['status' => 'Closed', 'close_note' => 'Synthetic late closure', 'closed_at' => now(), 'revision' => 8]);
        });
        $this->selected($task)->assertConflict()->assertJsonPath('code', 'followup_conflict');
        self::assertSame(1, Appointment::count(), 'Only the pre-existing cancelled fixture remains.');
        self::assertSame(0, AppointmentHistory::count());
        self::assertSame(0, AppointmentCommandKey::count());
        self::assertSame(0, AuditLog::whereIn('action', ['appointment.created', 'followup.booked'])->count());
        self::assertSame(0, \App\Models\MailDispatch::count());
        self::assertSame(0, \App\Models\UserNotification::count());
        self::assertSame('open', $opening->fresh()->status);
        self::assertNull($opening->fresh()->filled_appointment_id);
        // This injected change was inside the refused transaction, so it rolls back too.
        self::assertSame(['Open', 7, null], [$task->fresh()->status, $task->fresh()->revision, $task->fresh()->appointment_id]);
    }

    public function test_selected_http_path_rejects_malformed_header_keys_without_business_writes(): void
    {
        $task = $this->task();
        foreach (["attempt\n", "\nattempt", "at\ntempt", "attempt\r\n", 'two words', str_repeat('a', 256)] as $key) {
            $this->selected($task, key: $key)->assertUnprocessable()->assertJsonValidationErrors('idempotency_key');
        }
        self::assertSame(0, Appointment::count());
        self::assertSame(0, AppointmentCommandKey::count());
        self::assertSame(7, $task->fresh()->revision);
    }

    public function test_selected_staff_booking_never_enters_the_online_payment_path(): void
    {
        $provider = \Mockery::mock(\App\Services\Payment\PayMongoService::class);
        $provider->shouldReceive('isConfigured')->zeroOrMoreTimes()->andReturn(true);
        $provider->shouldNotReceive('createAppointmentCheckoutSession');
        $this->app->instance(\App\Services\Payment\PayMongoService::class, $provider);
        $task = $this->task();
        $this->selected($task, ['pay_at_clinic' => false])->assertCreated()
            ->assertJsonPath('data.status', 'Confirmed')->assertJsonPath('data.booking_payment_status', 'unpaid');
        self::assertSame(0, \App\Models\PaymentCheckoutSession::count());
    }

    public function test_ordinary_staff_booking_keeps_automatic_matching_and_response_envelope(): void
    {
        $oldest = $this->task(['due_on' => '2026-09-30']);
        $other = $this->task();
        $response = $this->staffBook()->assertCreated();
        self::assertNull($response->json('meta.followup_link'));
        self::assertSame($response->json('data.id'), $oldest->fresh()->appointment->public_id);
        self::assertSame('Open', $other->fresh()->status);
    }

    public function test_ordinary_owner_and_patient_bookings_keep_existing_authority(): void
    {
        $this->actingAsUser('owner');
        $this->staffBook()->assertCreated()->assertJsonMissingPath('meta.followup_link');
        $this->actingAsUser('patientB');
        $this->book(['start_time' => '11:00', 'pay_at_clinic' => true])->assertCreated()->assertJsonMissingPath('meta.followup_link');
    }

    public function test_ordinary_guardian_booking_keeps_dependent_identity_and_automatic_matching(): void
    {
        $this->p['A']->person->update(['date_of_birth' => '1985-01-01']);
        $this->actingAsUser('patientA');
        $dependentId = $this->postJson('/api/me/dependents', ['first_name' => 'Synthetic', 'last_name' => 'Dependent',
            'date_of_birth' => '2016-02-02', 'relationship' => 'Daughter', 'consent' => true])->assertCreated()->json('data.id');
        $dependent = \App\Models\Patient::where('public_id', $dependentId)->firstOrFail();
        $task = $this->task(['patient_id' => $dependent->id]);
        $response = $this->book(['for_patient_id' => $dependentId, 'pay_at_clinic' => true])->assertCreated();
        self::assertSame($dependent->id, Appointment::where('public_id', $response->json('data.id'))->firstOrFail()->patient_id);
        self::assertSame($response->json('data.id'), $task->fresh()->appointment->public_id);
        self::assertNull($response->json('meta.followup_link'));
    }

    public static function settlementPaths(): array { return [['polling'], ['webhook']]; }

    #[DataProvider('settlementPaths')]
    public function test_ordinary_payment_hold_and_settlement_keep_automatic_matching_once(string $path): void
    {
        // Synthetic fixture values only; all provider traffic is faked and stray HTTP is refused.
        config(['services.paymongo.secret_key' => 'aud10_fake_provider_credential',
            'services.paymongo.webhook_secret' => 'aud10_fake_webhook_credential', 'services.paymongo.mode' => 'test',
            'services.paymongo.payment_method_types' => 'gcash', 'services.paymongo.base_url' => 'https://api.paymongo.com',
            'app.frontend_url' => 'http://localhost:5173']);
        \Illuminate\Support\Facades\Http::preventStrayRequests();
        \Illuminate\Support\Facades\Mail::fake();
        \App\Models\ServicePrice::create(['service_id' => $this->svc['svc1']->id, 'branch_id' => null, 'kind' => 'priced', 'amount' => '600.00',
            'effective_from' => '2026-09-28', 'source' => 'owner_confirmed', 'created_by_user_id' => $this->u['owner']->id]);
        \Illuminate\Support\Facades\Http::fake(['https://api.paymongo.com/v2/checkout_sessions' => \Illuminate\Support\Facades\Http::response([
            'data' => ['id' => 'cs_aud10_fixture', 'attributes' => ['checkout_url' => 'https://checkout.paymongo.com/cs_aud10_fixture', 'livemode' => false]],
        ])]);
        $oldest = $this->task(['due_on' => '2026-09-30']);
        $other = $this->task();
        $this->actingAsUser('patientA');
        $response = $this->book(['pay_at_clinic' => false])->assertCreated()->assertJsonPath('data.booking_payment_status', 'held');
        self::assertNull($response->json('meta.followup_link'));
        self::assertSame('Open', $oldest->fresh()->status, 'A payment hold must not claim a follow-up.');
        $appointment = Appointment::where('public_id', $response->json('data.id'))->firstOrFail();
        $session = ['reference_number' => $appointment->public_id, 'status' => 'active', 'livemode' => false,
            'payments' => [['id' => 'pay_aud10_fixture', 'attributes' => ['status' => 'paid', 'amount' => 60000, 'currency' => 'PHP', 'source' => ['type' => 'gcash']]]]];
        \Illuminate\Support\Facades\Http::fake(['https://api.paymongo.com/v1/checkout_sessions/cs_aud10_fixture' =>
            \Illuminate\Support\Facades\Http::response(['data' => ['id' => 'cs_aud10_fixture', 'attributes' => $session]])]);
        foreach ([1, 2] as $attempt) {
            if ($path === 'polling') {
                app(\App\Services\Payment\PayMongoService::class)->syncSessionForAppointment($appointment->fresh());
            } else {
                $raw = json_encode(['data' => ['id' => 'evt_aud10_'.$attempt, 'attributes' => ['type' => 'checkout_session.payment.paid',
                    'livemode' => false, 'data' => ['id' => 'cs_aud10_fixture', 'attributes' => $session]]]], JSON_THROW_ON_ERROR);
                $time = (string) time();
                $signature = hash_hmac('sha256', $time.'.'.$raw, 'aud10_fake_webhook_credential');
                $this->call('POST', '/api/webhooks/paymongo', [], [], [], ['CONTENT_TYPE' => 'application/json',
                    'HTTP_Paymongo_Signature' => 't='.$time.',te='.$signature.',li='], $raw)->assertOk();
            }
        }
        self::assertSame('paid', $appointment->fresh()->booking_payment_status);
        self::assertSame('Confirmed', $appointment->fresh()->status);
        self::assertSame('Settled', \App\Models\PaymentCheckoutSession::where('appointment_id', $appointment->id)->firstOrFail()->status);
        self::assertSame($appointment->id, $oldest->fresh()->appointment_id);
        self::assertSame(8, $oldest->fresh()->revision);
        self::assertSame('Open', $other->fresh()->status);
        self::assertSame(1, AuditLog::where('action', 'followup.booked')->count());
    }
}
