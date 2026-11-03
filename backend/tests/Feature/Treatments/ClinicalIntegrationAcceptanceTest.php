<?php

namespace Tests\Feature\Treatments;

use App\Models\AuditLog;
use App\Models\Treatment;
use App\Models\TreatmentHistory;
use App\Models\Visit;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Http;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\Feature\Appointments\SchedulingFixture;
use Tests\TestCase;

/** JOE-QA-02: real routes on synthetic PostgreSQL records; no provider traffic. */
class ClinicalIntegrationAcceptanceTest extends TestCase
{
    use RefreshDatabase, SchedulingFixture;

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpSchedulingWorld();
        Http::preventStrayRequests();
    }

    private function arrival(): Visit
    {
        $appointment = $this->existing('A', 'd1', 'b1', 'svc1', '2026-09-28', '11:00');
        $this->actingAsUser('staffB1');
        $id = $this->postJson('/api/visits/check-in', ['appointment_id' => $appointment->public_id, 'expected_revision' => 1],
            ['Idempotency-Key' => 'qa-arrival'])->assertCreated()->json('data.id');

        return Visit::where('public_id', $id)->sole();
    }

    public static function unreadyStates(): array
    {
        return [['Waiting'], ['In Queue'], ['Temporarily Away'], ['Cancelled'], ['No-show']];
    }

    #[DataProvider('unreadyStates')]
    public function test_unready_queue_states_cannot_start_or_write_clinical_history(string $state): void
    {
        $visit = $this->arrival();
        // Arrange persisted legacy states without pretending a public transition exists for them.
        $visit->queueEntry->update(['status' => $state]);
        $before = $visit->queueEntry->history()->count();
        $this->actingAsUser('dentist1');
        $this->postJson("/api/visits/{$visit->public_id}/treatment", ['expected_revision' => 1],
            ['Idempotency-Key' => 'qa-start'])->assertStatus(422)->assertJsonPath('code', 'queue_not_ready');
        $this->assertSame(['Checked In', 'Checked In', $state], [$visit->fresh()->status, $visit->appointment->fresh()->status, $visit->queueEntry->fresh()->status]);
        $this->assertSame($before, $visit->queueEntry->history()->count());
        $this->assertSame(0, Treatment::count());
        $this->assertSame(0, TreatmentHistory::count());
        $this->assertSame(0, AuditLog::where('action', 'treatment.started')->count());
    }

    public static function readyStates(): array
    {
        return [['Called'], ['Treatment Ready']];
    }

    #[DataProvider('readyStates')]
    public function test_call_and_ready_start_once_with_exact_state_revision_and_audit_propagation(string $state): void
    {
        $visit = $this->arrival();
        $entry = $visit->queueEntry;
        $this->postJson("/api/queue/{$entry->public_id}/call", ['expected_revision' => 1], ['Idempotency-Key' => 'qa-call'])->assertOk();
        if ($state === 'Treatment Ready') {
            $this->postJson("/api/queue/{$entry->public_id}/ready", ['expected_revision' => 2], ['Idempotency-Key' => 'qa-ready'])->assertOk();
        }
        $queueRevision = $entry->fresh()->revision;
        $this->actingAsUser('dentist1');
        $path = "/api/visits/{$visit->public_id}/treatment";
        $body = $this->postJson($path, ['expected_revision' => 1], ['Idempotency-Key' => 'qa-start'])->assertCreated()->json('data');
        $this->postJson($path, ['expected_revision' => 1], ['Idempotency-Key' => 'qa-start'])->assertCreated()
            ->assertHeader('Idempotent-Replayed', 'true')->assertJsonPath('data.id', $body['id']);
        $this->postJson($path, ['expected_revision' => 1], ['Idempotency-Key' => 'qa-other-start'])->assertStatus(409)->assertJsonPath('code', 'treatment_exists');
        $this->assertSame(['Served', $queueRevision + 1], [$entry->fresh()->status, $entry->fresh()->revision]);
        $this->assertSame(['In Treatment', 2], [$visit->fresh()->status, $visit->fresh()->revision]);
        $this->assertSame(['In Treatment', 3], [$visit->appointment->fresh()->status, $visit->appointment->fresh()->revision]);
        $this->assertSame(1, Treatment::count());
        $this->assertSame(1, TreatmentHistory::count());
        $this->assertSame(1, AuditLog::where('action', 'treatment.started')->count());
    }

    public static function nonCheckedInAppointments(): array
    {
        return [['Pending'], ['Confirmed'], ['Cancelled'], ['No-show'], ['Completed']];
    }

    #[DataProvider('nonCheckedInAppointments')]
    public function test_linked_appointment_must_be_checked_in_even_when_queue_is_called(string $state): void
    {
        $visit = $this->arrival();
        $visit->queueEntry->update(['status' => 'Called']);
        // Deliberately inconsistent synthetic linkage must be refused, never silently repaired.
        $visit->appointment->update(['status' => $state]);
        $this->actingAsUser('dentist1');
        $this->postJson("/api/visits/{$visit->public_id}/treatment", ['expected_revision' => 1],
            ['Idempotency-Key' => 'qa-mismatch'])->assertStatus(422)->assertJsonPath('code', 'appointment_mismatch');
        $this->assertSame(0, Treatment::count());
        $this->assertSame(['Checked In', 'Called', $state], [$visit->fresh()->status, $visit->queueEntry->fresh()->status, $visit->appointment->fresh()->status]);
    }

    public function test_direct_foreign_visit_and_forged_branch_do_not_bypass_authorization(): void
    {
        $visit = $this->arrival();
        foreach (['dentist2', 'dentist3', 'staffB2', 'patientB', 'owner'] as $actor) {
            $this->actingAsUser($actor);
            $this->postJson("/api/visits/{$visit->public_id}/treatment", ['expected_revision' => 1],
                ['Idempotency-Key' => 'qa-foreign-'.$actor])->assertForbidden();
        }
        $this->actingAsUser('dentist1');
        $this->postJson("/api/visits/{$visit->public_id}/treatment", ['expected_revision' => 1, 'branch_ref' => 'b2'],
            ['Idempotency-Key' => 'qa-forged'])->assertUnprocessable()->assertJsonValidationErrors('branch_ref');
        $this->assertSame(0, Treatment::count());
    }

    public function test_no_check_in_means_no_visit_to_start(): void
    {
        $appointment = $this->existing('A', 'd1', 'b1', 'svc1', '2026-09-28', '11:00');
        $this->actingAsUser('dentist1');
        $this->postJson("/api/visits/{$appointment->public_id}/treatment", ['expected_revision' => 1],
            ['Idempotency-Key' => 'qa-no-visit'])->assertNotFound();
        $this->assertSame(0, Visit::count());
        $this->assertSame(0, Treatment::count());
        $this->assertSame('Confirmed', $appointment->fresh()->status);
    }
}
