<?php

namespace Tests\Feature\Prescriptions;

use App\Http\Controllers\PrescriptionController;
use App\Jobs\SendMailDispatch;
use App\Models\AuditLog;
use App\Models\Prescription;
use App\Models\Visit;
use Illuminate\Database\Events\TransactionCommitted;
use Illuminate\Foundation\Testing\DatabaseMigrations;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Bus;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Facades\Mail;
use Tests\Feature\Appointments\SchedulingFixture;
use Tests\TestCase;

/**
 * Authored only. Inherits TestCase's disposable-database guard. Do not execute
 * until DB testing is approved. Committed fixtures are required for this seam.
 * This is deterministic commit/response interleaving, NOT a parallel DB race.
 * Real PostgreSQL concurrent-process acceptance remains separately deferred.
 */
class Rx02AcceptedDraftRevisionTest extends TestCase
{
    use DatabaseMigrations, SchedulingFixture;

    protected function setUp(): void
    {
        parent::setUp();
        Mail::fake();
        Bus::fake([SendMailDispatch::class]);
        $this->setUpSchedulingWorld();
    }

    private function draft(): Prescription
    {
        $v = Visit::create(['patient_id' => $this->p['A']->id, 'branch_id' => $this->b['b1']->id, 'source' => 'walk_in',
            'status' => 'Checked In', 'responsible_dentist_profile_id' => $this->d['d1']->id, 'requested_service_id' => $this->svc['svc1']->id,
            'arrived_at' => now(), 'clinic_date' => '2026-09-28', 'revision' => 1,
            'created_by_user_id' => $this->u['staffB1']->id, 'updated_by_user_id' => $this->u['staffB1']->id]);
        $this->actingAsUser('dentist1');
        $id = $this->postJson('/api/prescriptions', ['visit_id' => $v->public_id, 'lines' => [['medicine' => 'Synthetic original']]])
            ->assertCreated()->assertJsonPath('data.revision', 1)->json('data.id');

        return Prescription::where('public_id', $id)->sole();
    }

    private function payload(string $label, int $revision): array
    {
        return ['expected_revision' => $revision, 'note' => "Synthetic note $label", 'lines' => [
            ['medicine' => "Synthetic medicine $label", 'dosage' => "Synthetic dosage $label", 'frequency' => "Synthetic frequency $label",
                'duration' => "Synthetic duration $label", 'instructions' => "Synthetic instruction $label"],
        ]];
    }

    public function test_accepted_response_contains_the_persisted_locked_content_and_revision(): void
    {
        $p = $this->draft();
        $body = $this->payload('A', 1);
        $response = $this->putJson("/api/prescriptions/{$p->public_id}", $body)->assertOk()
            ->assertJsonPath('data.id', $p->public_id)->assertJsonPath('data.revision', 2)->assertJsonPath('data.status', 'Draft')
            ->assertJsonPath('data.patient.id', $p->patient->public_id)->assertJsonPath('data.visit', $p->visit->public_id)
            ->assertJsonPath('data.note', $body['note']);
        $this->assertSame($body['lines'], $response->json('data.lines'));
        $p->refresh();
        $this->assertSame(2, $p->revision);
        $this->assertSame($body['note'], $p->note);
        $this->assertSame($body['lines'][0]['medicine'], $p->lines->sole()->medicine);
    }

    public function test_second_accepted_edit_between_first_commit_and_response_cannot_replace_first_snapshot(): void
    {
        $p = $this->draft();
        $armed = true;
        $second = null;
        // Runs after A releases its row lock, before A's transaction() returns.
        // The former post-transaction fresh() would adopt B's revision/content.
        Event::listen(TransactionCommitted::class, function (TransactionCommitted $event) use ($p, &$armed, &$second) {
            if (! $armed || $event->connection->transactionLevel() !== 0) return;
            $armed = false; // B commits too; never recurse.
            $request = Request::create("/api/prescriptions/{$p->public_id}", 'PUT', $this->payload('B', 2));
            $request->setUserResolver(fn () => $this->u['dentist2']);
            $second = app(PrescriptionController::class)->update($request, $p->fresh())->getData(true)['data'];
        });
        try {
            $first = $this->putJson("/api/prescriptions/{$p->public_id}", $this->payload('A', 1))->assertOk()
                ->assertJsonPath('data.revision', 2)->assertJsonPath('data.note', 'Synthetic note A')
                ->assertJsonPath('data.lines.0.medicine', 'Synthetic medicine A')->json('data');
            $this->assertFalse($armed, 'The commit/response interleaving seam must have run.');
            $this->assertSame(3, $second['revision']);
            $this->assertSame($this->payload('B', 2)['lines'], $second['lines']);
            $this->assertSame($this->payload('A', 1)['lines'], $first['lines']);
            $this->assertSame(3, $p->fresh()->revision);
            $this->assertSame('Synthetic medicine B', $p->fresh()->lines->sole()->medicine);
            $this->postJson("/api/prescriptions/{$p->public_id}/issue", ['expected_revision' => $first['revision']])
                ->assertUnprocessable()->assertJsonValidationErrors('expected_revision');
            $this->assertSame('Draft', $p->fresh()->status);
            $this->assertNull($p->fresh()->number);
        } finally {
            $armed = false;
            // Avoid removing unrelated framework listeners; the inert listener
            // is discarded with this test application's lifecycle.
        }
    }

    public function test_revision_conflicts_issue_lock_numbering_and_required_audits_remain_intact(): void
    {
        $p = $this->draft();
        $this->putJson("/api/prescriptions/{$p->public_id}", $this->payload('A', 1))->assertOk();
        $this->putJson("/api/prescriptions/{$p->public_id}", $this->payload('stale', 1))
            ->assertUnprocessable()->assertJsonValidationErrors('expected_revision');
        $this->postJson("/api/prescriptions/{$p->public_id}/issue", ['expected_revision' => 2])->assertOk()
            ->assertJsonPath('data.number', 'RX-2026-000001')->assertJsonPath('data.revision', 3);
        $this->putJson("/api/prescriptions/{$p->public_id}", $this->payload('locked', 3))
            ->assertUnprocessable()->assertJsonValidationErrors('status');
        $this->postJson("/api/prescriptions/{$p->public_id}/void", ['reason' => 'Synthetic correction'])->assertOk();
        $next = $this->draft();
        $this->postJson("/api/prescriptions/{$next->public_id}/issue", ['expected_revision' => 1])->assertOk()
            ->assertJsonPath('data.number', 'RX-2026-000002');
        foreach (['created', 'issued', 'voided'] as $action) {
            $log = AuditLog::where('action', "prescription.$action")->where('payload->prescription', $p->public_id)->sole();
            $this->assertStringNotContainsString('Synthetic medicine', json_encode($log->payload));
            $this->assertStringNotContainsString('Synthetic note', json_encode($log->payload));
        }
    }
}
