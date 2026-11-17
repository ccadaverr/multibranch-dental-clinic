<?php

namespace Tests\Feature\Followups;

use App\Models\Appointment;
use App\Models\AppointmentCommandKey;
use App\Models\FollowupTask;
use App\Models\UserBranchScope;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Tests\Feature\Appointments\SchedulingFixture;
use Tests\TestCase;

final class SelectedFollowupRecoveryTest extends TestCase
{
    use DatabaseTransactions, SchedulingFixture;

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpSchedulingWorld();
        $this->actingAsUser('staffB1');
    }

    private function task(array $extra = []): FollowupTask
    {
        return FollowupTask::create($extra + ['patient_id' => $this->p['A']->id, 'branch_id' => $this->b['b1']->id,
            'dentist_profile_id' => $this->d['d1']->id, 'reason' => 'Synthetic private follow-up', 'due_on' => '2026-10-05',
            'source' => 'dentist', 'status' => 'Open', 'revision' => 7]);
    }

    private function selected(FollowupTask $task, array $extra = [])
    {
        return $this->staffBook($extra + ['followup_task_id' => $task->public_id, 'followup_expected_revision' => 7], ['Idempotency-Key' => 'recovery-key']);
    }

    private function receiptPath(FollowupTask $task): string { return '/api/followups/'.$task->public_id.'/booking-receipt'; }

    public function test_lost_response_recovers_original_journal_receipt_after_new_authentication(): void
    {
        $task = $this->task();
        $original = $this->selected($task)->assertCreated()->json();
        // Throw away the response and session; another authenticated lifetime for the same account reads the journal.
        $this->app['auth']->forgetGuards();
        $this->actingAsUser('staffB1');
        $response = $this->getJson($this->receiptPath($task))->assertOk()->assertJsonPath('meta.historical_receipt', true);
        self::assertSame($original, $response->json('data'));
        self::assertStringContainsString('no-store', $response->headers->get('Cache-Control'));
        self::assertStringNotContainsString('recovery-key', $response->getContent());
        self::assertSame(1, Appointment::count());
        self::assertSame(1, AppointmentCommandKey::count());
        self::assertSame('Booked', $task->fresh()->status);
        $this->selected($task)->assertCreated()->assertHeader('Idempotent-Replayed', 'true');
    }

    public function test_recovery_never_infers_a_receipt_from_patient_and_branch(): void
    {
        $task = $this->task();
        $this->staffBook()->assertCreated(); // Ordinary matching is a different command, even if it booked this task.
        $this->getJson($this->receiptPath($task))->assertNotFound();
    }

    public function test_other_account_and_other_roles_cannot_recover_the_staff_journal(): void
    {
        $task = $this->task();
        $this->selected($task)->assertCreated();
        foreach (['staffBoth', 'staffB2', 'owner', 'patientA', 'patientB', 'dentist1'] as $actor) {
            $this->actingAsUser($actor);
            $response = $this->getJson($this->receiptPath($task));
            if (in_array($actor, ['staffBoth', 'staffB2'])) $response->assertNotFound();
            else $response->assertForbidden();
            self::assertStringNotContainsString('Synthetic private follow-up', $response->getContent());
        }
    }

    public function test_recovery_rechecks_scope_and_patient_identity_before_disclosure(): void
    {
        $task = $this->task();
        $this->selected($task)->assertCreated();
        UserBranchScope::where('user_id', $this->u['staffB1']->id)->update(['branch_id' => $this->b['b2']->id]);
        $this->getJson($this->receiptPath($task))->assertNotFound();
        $this->actingAsUser('staffBoth');
        // The same actor cannot acquire another actor's receipt by matching a task.
        $this->getJson($this->receiptPath($task))->assertNotFound();
    }

    public function test_changed_patient_does_not_disclose_an_original_receipt(): void
    {
        $task = $this->task();
        $this->selected($task)->assertCreated();
        $task->update(['patient_id' => $this->p['B']->id]);
        $this->getJson($this->receiptPath($task))->assertNotFound();
    }

    public function test_receipt_remains_historical_after_task_closure(): void
    {
        $task = $this->task();
        $original = $this->selected($task)->assertCreated()->json();
        $this->patchJson('/api/followups/'.$task->public_id, ['action' => 'close', 'expected_revision' => 8])->assertOk()->assertJsonPath('data.status', 'Closed');
        $this->getJson($this->receiptPath($task))->assertOk()->assertJsonPath('data', $original);
        $this->getJson('/api/followups/'.$task->public_id)->assertOk()->assertJsonPath('data.status', 'Closed')->assertJsonPath('data.revision', 9);
    }

    public function test_selected_dentist_cannot_be_substituted_and_omission_uses_task_dentist(): void
    {
        $task = $this->task();
        $this->selected($task, ['dentist_ref' => 'd2'])->assertUnprocessable()->assertJsonPath('code', 'followup_dentist_mismatch');
        self::assertSame(0, Appointment::count());
        self::assertSame(0, AppointmentCommandKey::count());
        $this->selected($task, ['dentist_ref' => null])->assertCreated()->assertJsonPath('data.dentist.id', 'd1');
    }

    public function test_unavailable_task_dentist_is_not_replaced_by_available_colleague(): void
    {
        $task = $this->task();
        $this->d['d1']->update(['available' => false]);
        $this->selected($task, ['dentist_ref' => null])->assertUnprocessable();
        self::assertSame(0, Appointment::count());
        self::assertSame('Open', $task->fresh()->status);
    }

    public function test_patient_appointment_readback_isolated_and_contains_no_followup_reason(): void
    {
        $task = $this->task();
        $id = $this->selected($task)->assertCreated()->json('data.id');
        $this->actingAsUser('patientA');
        $own = $this->getJson('/api/appointments/'.$id)->assertOk()->assertJsonPath('data.id', $id);
        self::assertStringNotContainsString('Synthetic private follow-up', $own->getContent());
        $this->actingAsUser('patientB');
        $denied = $this->getJson('/api/appointments/'.$id)->assertNotFound();
        self::assertSame($denied->json(), $this->getJson('/api/appointments/'.str_repeat('0', 26))->assertNotFound()->json());
        self::assertStringNotContainsString($this->p['A']->public_id, $denied->getContent());
    }

    public function test_contact_and_close_preserve_observed_revision_and_reject_stale_actions(): void
    {
        $task = $this->task();
        $path = '/api/followups/'.$task->public_id;
        $this->patchJson($path, ['action' => 'contacted', 'expected_revision' => 7])->assertOk()->assertJsonPath('data.revision', 8);
        $this->patchJson($path, ['action' => 'close', 'expected_revision' => 7, 'note' => 'Synthetic closure'])->assertConflict()->assertJsonPath('code', 'followup_conflict');
        self::assertSame('Contacted', $task->fresh()->status);
        self::assertSame(8, $task->fresh()->revision);
        $this->getJson($path)->assertOk()->assertJsonPath('data.dentist.id', 'd1');
    }

    public function test_capability_defaults_closed_and_does_not_grant_other_roles_access(): void
    {
        $this->getJson('/api/followups/booking-capability')->assertOk()->assertJsonPath('data.contract', 'followup-booking.v1')->assertJsonPath('data.enabled', false);
        config(['clinic.selected_followup_booking_enabled' => true]);
        $this->getJson('/api/followups/booking-capability')->assertOk()->assertJsonPath('data.enabled', true);
        foreach (['patientA', 'dentist1', 'owner'] as $actor) {
            $this->actingAsUser($actor);
            $this->getJson('/api/followups/booking-capability')->assertForbidden();
        }
    }
}
