<?php

namespace Tests\Feature\Visits;

use App\Models\QueueEntryHistory;
use App\Models\Visit;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\Feature\Appointments\SchedulingFixture;
use Tests\TestCase;

/** Owner's 2026-11-16 FIFO decision: bounded Clinical check-in evidence; Operations-wide reorder acceptance remains A-owned. */
final class ClinicalArrivalOrderingTest extends TestCase
{
    use RefreshDatabase, SchedulingFixture;

    public function test_scheduled_arrival_does_not_overtake_checked_in_walk_in_and_original_identities_and_history_survive(): void
    {
        $this->setUpSchedulingWorld();
        $appointment = $this->existing('B', 'd1', 'b1', 'svc1', '2026-09-28', '11:00')->fresh();
        $before = $appointment->getAttributes();
        $this->actingAsUser('staffB1');
        $walkIn = $this->postJson('/api/visits/walk-in', ['patient_id' => $this->p['A']->public_id, 'branch_ref' => 'b1', 'service_ref' => 'svc1', 'dentist_ref' => 'd1'],
            ['Idempotency-Key' => 'fifo-walk-in'])->assertCreated()->json('data');
        $this->assertSame($before, $appointment->fresh()->getAttributes(), 'Walk-in admission does not alter the scheduled reservation.');
        $payload = ['appointment_id' => $appointment->public_id, 'expected_revision' => 1, 'id_confirmed' => true];
        $scheduled = $this->postJson('/api/visits/check-in', $payload, ['Idempotency-Key' => 'fifo-scheduled'])->assertCreated()->json('data');
        $this->postJson('/api/visits/check-in', $payload, ['Idempotency-Key' => 'fifo-scheduled'])->assertCreated()->assertJsonPath('data.id', $scheduled['id']);
        $a = Visit::where('public_id', $walkIn['id'])->sole(); $b = Visit::where('public_id', $scheduled['id'])->sole();
        $this->assertSame([$this->p['A']->id, $this->b['b1']->id, null, 'walk_in'], [$a->patient_id, $a->branch_id, $a->appointment_id, $a->source]);
        $this->assertSame([$this->p['B']->id, $this->b['b1']->id, $appointment->id, 'appointment'], [$b->patient_id, $b->branch_id, $b->appointment_id, $b->source]);
        $this->assertSame($a->arrived_at->toIso8601String(), $b->arrived_at->toIso8601String(), 'Equal clock fixtures exercise the stable queue-number tie-breaker.');
        $positions = collect($this->getJson('/api/queue')->assertOk()->json('data'))->pluck('position', 'id');
        $this->assertSame(1, $positions[$walkIn['queue']['id']]);
        $this->assertSame(2, $positions[$scheduled['queue']['id']]);
        $this->assertSame(2, Visit::count());
        $this->assertSame(['queue.entered','queue.entered'], QueueEntryHistory::orderBy('id')->pluck('event')->all());
        $this->actingAsUser('staffB2');
        $this->assertSame([], $this->getJson('/api/queue')->assertOk()->json('data'));
        $this->expectException(\Illuminate\Database\QueryException::class);
        \Illuminate\Support\Facades\DB::table('queue_entry_history')->where('id', QueueEntryHistory::first()->id)->update(['event' => 'fictional_scheduled_first']);
    }
}
