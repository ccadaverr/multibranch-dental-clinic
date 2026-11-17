<?php

namespace Tests\Feature\Queue;

use App\Models\QueueEntry;
use App\Models\Visit;
use App\Models\VisitHistory;
use App\Services\Queue\QueueBackfill;
use Carbon\CarbonImmutable;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Tests\Feature\Appointments\SchedulingFixture;
use Tests\TestCase;

final class QueueTimestampSemanticsTest extends TestCase
{
    use RefreshDatabase, SchedulingFixture;

    public function test_model_and_explicit_offset_history_preserve_the_same_instant_at_manila_midnight(): void
    {
        $this->setUpSchedulingWorld();
        foreach (['2026-09-28T23:59:59+08:00', '2026-09-29T00:00:01+08:00'] as $index => $value) {
            $instant = CarbonImmutable::parse($value);
            $visit = Visit::create([
                'patient_id' => $this->p[$index ? 'B' : 'A']->id, 'branch_id' => $this->b['b1']->id,
                'source' => 'walk_in', 'status' => 'In Treatment', 'responsible_dentist_profile_id' => $this->d['d1']->id,
                'arrived_at' => $instant->subMinute(), 'clinic_date' => $instant->subMinute()->toDateString(),
            ]);
            $data = ['visit_id' => $visit->id, 'event' => 'visit.treatment_started', 'from_status' => 'Checked In',
                'to_status' => 'In Treatment', 'revision' => 2, 'occurred_at' => $instant];
            if ($index) {
                // Query Builder does not use a model's offset-aware dateFormat.
                DB::table('visit_history')->insert(array_replace($data, ['occurred_at' => $instant->toIso8601String()]));
            } else {
                VisitHistory::create($data);
            }
            $event = VisitHistory::where('visit_id', $visit->id)->sole();
            $this->assertSame($instant->getTimestamp(), $event->occurred_at->getTimestamp());
            $before = $event->getRawOriginal();
            $this->assertSame(1, app(QueueBackfill::class)->run()['created']);
            $entry = QueueEntry::where('visit_id', $visit->id)->sole();
            $this->assertSame('Served', $entry->status);
            $this->assertSame($instant->getTimestamp(), $entry->closed_at->getTimestamp());
            $this->assertSame($before, $event->fresh()->getRawOriginal(), 'Backfill must never repair or rebase history.');
            $this->assertSame(0, app(QueueBackfill::class)->run()['created']);
        }
    }
}
