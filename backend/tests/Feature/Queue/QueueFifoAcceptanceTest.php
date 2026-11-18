<?php

namespace Tests\Feature\Queue;

use App\Models\AuditLog;
use App\Models\QueueEntry;
use App\Models\QueueEntryHistory;
use App\Models\UserBranchScope;
use App\Models\Visit;
use App\Services\Queue\QueueService;
use Carbon\CarbonImmutable;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\Feature\Appointments\SchedulingFixture;
use Tests\TestCase;

final class QueueFifoAcceptanceTest extends TestCase
{
    use RefreshDatabase, SchedulingFixture;

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpSchedulingWorld();
        [, $this->p['C']] = $this->patient('PAT-FIFO-C');
        [, $this->p['D']] = $this->patient('PAT-FIFO-D');
        $this->actingAsUser('staffBoth');
    }

    private function arrive(string $patient, string $dentist = 'd1', string $branch = 'b1'): QueueEntry
    {
        $this->postJson('/api/visits/walk-in', ['patient_id' => $this->p[$patient]->public_id,
            'branch_ref' => $branch, 'service_ref' => 'svc1', 'dentist_ref' => $dentist],
            ['Idempotency-Key' => 'fifo-'.$patient])->assertCreated();

        return QueueEntry::whereHas('visit', fn ($q) => $q->where('patient_id', $this->p[$patient]->id))->sole();
    }

    private function snapshot(QueueEntry $entry): array
    {
        return $this->getJson("/api/queue/{$entry->public_id}/order")->assertOk()->json('data');
    }

    private function move(QueueEntry $entry, ?QueueEntry $before, array $snapshot, string $key = 'move')
    {
        return $this->postJson("/api/queue/{$entry->public_id}/reorder", [
            'before_entry_id' => $before?->public_id, 'order_revision' => $snapshot['revision'],
            'expected_revision' => $entry->revision, 'reason' => 'Patient requested front desk accommodation',
        ], ['Idempotency-Key' => $key]);
    }

    public function test_two_scheduled_and_two_walk_ins_share_branch_arrival_fifo_across_dentists(): void
    {
        $a = $this->existing('A', 'd1', 'b1', 'svc1', '2026-09-28', '10:00');
        $c = $this->existing('C', 'd2', 'b1', 'svc1', '2026-09-28', '10:00');
        $b = $this->arrive('B', 'd2');
        $this->travelTo(CarbonImmutable::parse('2026-09-28T10:20:00+08:00'));
        foreach ([$a, $c] as $appointment) {
            $this->postJson('/api/visits/check-in', ['appointment_id' => $appointment->public_id, 'expected_revision' => 1],
                ['Idempotency-Key' => 'scheduled-'.$appointment->public_id])->assertCreated();
        }
        $d = $this->arrive('D'); // same timestamp: immutable Visit id breaks ties, not booking time or Dentist name
        $rows = $this->snapshot($b)['entries'];
        $this->assertSame(['B', 'A', 'C', 'D'], array_map(fn ($r) => array_search($r['patient']['id'], array_map(fn ($p) => $p->public_id, $this->p), true), $rows));
        $this->assertSame([1, 2, 3, 4], array_column($rows, 'branch_position'));
        $this->assertSame([1, 1, 2, 2], array_column($rows, 'position'));
        $this->assertSame(4, Visit::count());
        $this->assertSame(2, Visit::where('source', 'appointment')->count());
        $this->postJson('/api/visits/check-in', ['appointment_id' => $a->public_id, 'expected_revision' => 1],
            ['Idempotency-Key' => 'scheduled-'.$a->public_id])->assertCreated()->assertHeader('Idempotent-Replayed', 'true');
        $this->assertSame(4, QueueEntry::count());
        $this->assertSame('10:20', Visit::where('appointment_id', $a->id)->sole()->arrived_at->setTimezone('Asia/Manila')->format('H:i'));
    }

    public function test_explicit_move_is_audited_idempotent_and_does_not_rewrite_arrival_or_history(): void
    {
        $a = $this->arrive('A');
        $b = $this->arrive('B', 'd2');
        $c = $this->arrive('C');
        $before = Visit::orderBy('id')->pluck('arrived_at', 'id')->all();
        $history = QueueEntryHistory::orderBy('id')->get()->map->getRawOriginal()->all();
        $snapshot = $this->snapshot($a);
        $response = $this->move($c, $a, $snapshot)->assertOk()->assertJsonPath('data.branch_position', 1)
            ->assertJsonPath('meta.queue_order.from_position', 3)->assertJsonPath('meta.queue_order.to_position', 1);
        $this->move($c, $a, $snapshot)->assertOk()->assertHeader('Idempotent-Replayed', 'true')->assertExactJson($response->json());
        $rows = $this->getJson('/api/queue?branch_ref=b1')->assertOk()->json('data');
        $this->assertSame($c->public_id, $rows[0]['id']);
        $this->assertSame([1, 2, 3], array_column($rows, 'branch_position'));
        $this->assertSame([$c->public_id, $a->public_id, $b->public_id], array_column($this->snapshot($a)['entries'], 'id'));
        $this->assertEquals($before, Visit::orderBy('id')->pluck('arrived_at', 'id')->all());
        $this->assertSame($history, QueueEntryHistory::orderBy('id')->limit(3)->get()->map->getRawOriginal()->all());
        $audit = AuditLog::where('action', 'queue.reordered')->sole();
        $this->assertSame($this->b['b1']->id, $audit->branch_id);
        $this->assertSame($a->public_id, $audit->payload['before_entry_id']);
        $this->assertSame(1, QueueEntryHistory::where('event', 'queue.reordered')->count());
    }

    public function test_stale_snapshot_new_arrival_cross_branch_anchor_and_called_displacement_are_refused(): void
    {
        $a = $this->arrive('A');
        $b = $this->arrive('B');
        $snapshot = $this->snapshot($a);
        $c = $this->arrive('C');
        $this->move($b, $a, $snapshot)->assertStatus(409);
        $d = $this->arrive('D', 'd3', 'b2');
        $this->move($c, $d, $this->snapshot($a), 'foreign')->assertStatus(422);
        $this->postJson("/api/queue/{$a->public_id}/call", ['expected_revision' => 1], ['Idempotency-Key' => 'call'])->assertOk();
        $this->move($c, $b, $this->snapshot($a), 'behind-called')->assertOk();
        $this->move($b, $a, $this->snapshot($a), 'before-called')->assertStatus(422);
        $this->assertSame(1, AuditLog::where('action', 'queue.reordered')->count());
    }

    public function test_branch_isolation_and_revoked_authority_precede_reorder_receipt_replay(): void
    {
        $a = $this->arrive('A');
        $b = $this->arrive('B');
        $this->actingAsUser('staffB1');
        $snapshot = $this->snapshot($a);
        $this->move($b, $a, $snapshot)->assertOk();
        UserBranchScope::where('user_id', $this->u['staffB1']->id)->delete();
        $this->move($b, $a, $snapshot)->assertNotFound();
        $this->getJson("/api/queue/{$a->public_id}/order")->assertNotFound();
        $this->actingAsUser('staffB2');
        $this->getJson("/api/queue/{$a->public_id}/order")->assertNotFound();
        $this->getJson('/api/queue/01AAAAAAAAAAAAAAAAAAAAAAAA/order')->assertNotFound();
        foreach (['dentist1', 'patientA'] as $role) {
            $this->actingAsUser($role);
            $this->move($b, $a, $snapshot)->assertForbidden();
        }
        $this->actingAsUser('dentist1');
        $this->assertArrayNotHasKey('branch_position', $this->getJson('/api/queue')->assertOk()->json('data.0'));
    }

    public function test_moved_order_survives_anchor_treatment_start_and_historical_readback(): void
    {
        $a = $this->arrive('A');
        $b = $this->arrive('B');
        $c = $this->arrive('C');
        $d = $this->arrive('D');
        $this->move($d, $b, $this->snapshot($a))->assertOk();
        foreach ([$a, $d, $b] as $entry) {
            $this->postJson("/api/queue/{$entry->public_id}/call", ['expected_revision' => $entry->fresh()->revision],
                ['Idempotency-Key' => 'call-'.$entry->public_id])->assertOk();
        }
        $this->actingAsUser('dentist1');
        $visit = $b->visit;
        $this->postJson("/api/visits/{$visit->public_id}/treatment", ['expected_revision' => $visit->revision], ['Idempotency-Key' => 'start-b'])->assertCreated();
        $this->assertSame('Served', $b->fresh()->status);
        $this->assertSame('In Treatment', $visit->fresh()->status);
        $this->actingAsUser('staffBoth');
        $this->assertSame([$a->public_id, $d->public_id, $c->public_id], array_column($this->snapshot($a)['entries'], 'id'));
        $this->getJson("/api/queue/{$b->public_id}")->assertOk()->assertJsonPath('data.branch_position', null)
            ->assertJsonPath('data.history.2.event', 'queue.served');
        $this->assertSame(1, QueueEntryHistory::where('queue_entry_id', $d->id)->where('event', 'queue.reordered')->count());
    }

    public function test_stale_same_target_command_cannot_claim_success_and_revoked_service_replay_is_denied(): void
    {
        $a = $this->arrive('A');
        $actor = $this->u['staffBoth'];
        app(QueueService::class)->transition($actor, $a, 'call', 1, 'service-call');
        $this->postJson("/api/queue/{$a->public_id}/call", ['expected_revision' => 1], ['Idempotency-Key' => 'new-stale'])->assertStatus(409);
        $actor->fresh()->forceFill(['auth_version' => $actor->auth_version + 1])->save();
        try {
            app(QueueService::class)->transition($actor, $a, 'call', 1, 'service-call');
            $this->fail('Revoked actor replay must be refused.');
        } catch (\Symfony\Component\HttpKernel\Exception\HttpException $e) {
            $this->assertSame(403, $e->getStatusCode());
        }
        $this->assertSame(2, $a->fresh()->revision);
        $this->assertSame(2, QueueEntryHistory::where('queue_entry_id', $a->id)->count());
    }

    public function test_admission_on_each_side_of_manila_midnight_has_its_own_day_and_exact_utc_instant(): void
    {
        // Synthetic near-all-day hours, not a claim about clinic operating policy. Close remains exclusive.
        $this->b['b1']->update(['open_time' => '00:00', 'close_time' => '23:59']);
        $this->d['d1']->update(['shift_start' => '00:00', 'shift_end' => '23:59']);
        $before = CarbonImmutable::parse('2026-09-28T23:58:59+08:00');
        $after = CarbonImmutable::parse('2026-09-29T00:00:01+08:00');
        $this->travelTo($before);
        $a = $this->arrive('A');
        $this->travelTo($after);
        $b = $this->arrive('B');
        foreach ([[$a, $before], [$b, $after]] as [$entry, $instant]) {
            $this->assertSame($instant->getTimestamp(), $entry->visit->arrived_at->getTimestamp());
            $this->assertSame($instant->toDateString(), $entry->dentistQueue->clinic_date->format('Y-m-d'));
            $snapshot = $this->snapshot($entry);
            $this->assertSame([$entry->public_id], array_column($snapshot['entries'], 'id'));
            $this->assertSame(1, $snapshot['entries'][0]['branch_position']);
        }
        $this->assertSame(2, Visit::count());
        $this->assertSame(2, QueueEntryHistory::where('event', 'queue.entered')->count());
    }
}
