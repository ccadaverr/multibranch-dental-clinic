<?php

namespace Tests\Feature\Staffing;

use App\Models\BranchClosure;
use App\Support\ClinicClock;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Tests\Feature\Appointments\SchedulingFixture;
use Tests\TestCase;

/**
 * Focused read-path regression coverage for DW-02 and DW-10.
 * Query-count bounds catch per-Dentist/per-day N+1 regressions; live latency
 * remains an environment acceptance measurement, not a SQLite test assertion.
 */
class Dw02Dw10ReadPerformanceTest extends TestCase
{
    use RefreshDatabase, SchedulingFixture;

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpSchedulingWorld();
    }

    /** @return array{0:\Illuminate\Testing\TestResponse,1:int} */
    private function measuredRead(callable $read): array
    {
        $connection = DB::connection();
        $connection->flushQueryLog();
        $connection->enableQueryLog();
        try {
            $response = $read();
            $count = count($connection->getQueryLog());
        } finally {
            $connection->disableQueryLog();
        }

        return [$response, $count];
    }

    private function assertTimedPrivateRead($response): float
    {
        $response->assertHeader('Cache-Control', 'private, no-store');
        $header = (string) $response->headers->get('Server-Timing');
        $this->assertMatchesRegularExpression('/(?:^|,\s*)app;dur=\d+(?:\.\d+)?/', $header);
        preg_match('/(?:^|,\s*)app;dur=([\d.]+)/', $header, $matches);

        return (float) ($matches[1] ?? INF);
    }

    public function test_dedicated_duty_projection_is_scoped_timed_private_and_query_bounded(): void
    {
        $this->actingAsUser('staffB1');
        [$baseline, $baselineQueries] = $this->measuredRead(fn () => $this->getJson('/api/work-schedules/duty'));
        $baseline->assertOk();
        $this->assertTimedPrivateRead($baseline);
        $this->assertSame(['b1'], array_values(array_unique(array_column($baseline->json('data.duty.rows'), 'branch_id'))));
        $this->assertSame('2026-09-28', $baseline->json('data.duty.date'));

        // Grow the Dentist pool without changing the number of SQL round trips.
        // A per-Dentist lookup in WorkSchedules would make this count increase.
        for ($index = 1; $index <= 12; $index++) {
            $this->dentist('dw02-extra-'.$index, ['b1'], ['svc1'], false);
        }

        [$scaled, $scaledQueries] = $this->measuredRead(fn () => $this->getJson('/api/work-schedules/duty'));
        $scaled->assertOk();
        $serverDurationMs = $this->assertTimedPrivateRead($scaled);
        $this->assertLessThanOrEqual(2000, $serverDurationMs, 'The duty controller must complete within the agreed two-second server budget.');
        $this->assertSame($baselineQueries, $scaledQueries, 'Duty SQL round trips must not grow with the number of Dentists.');
        $this->assertLessThanOrEqual(10, $scaledQueries, 'The dedicated projection should remain a small bounded read.');
        $this->assertSame(['b1'], array_values(array_unique(array_column($scaled->json('data.duty.rows'), 'branch_id'))));
        $this->assertCount(14, $scaled->json('data.duty.rows'));
        $this->assertArrayNotHasKey('reason', $scaled->json('data.duty.rows.0'));
    }

    public function test_dedicated_duty_uses_the_current_authorized_branch_closure(): void
    {
        $this->actingAsUser('staffB1');
        BranchClosure::create([
            'branch_id' => $this->b['b1']->id,
            'closed_on' => ClinicClock::today(),
            'status' => 'active',
        ]);

        $response = $this->getJson('/api/work-schedules/duty')->assertOk();
        $rows = $response->json('data.duty.rows');
        $this->assertNotEmpty($rows);
        $this->assertSame(['b1'], array_values(array_unique(array_column($rows, 'branch_id'))));
        foreach ($rows as $row) {
            $this->assertFalse($row['on_duty_today']);
            $this->assertFalse($row['working_now']);
            $this->assertSame(0, $row['working_minutes']);
        }
    }

    public function test_calendar_capacity_is_complete_for_the_bounded_range_and_uses_batched_reads(): void
    {
        $this->actingAsUser('staffBoth');
        for ($index = 1; $index <= 12; $index++) {
            $this->dentist('dw10-extra-'.$index, ['b1'], ['svc1'], false);
        }

        [$response, $queries] = $this->measuredRead(fn () => $this->getJson(
            '/api/calendar/load?from=2026-09-29&to=2026-11-09'
        ));
        $response->assertOk();
        $this->assertTimedPrivateRead($response);
        $this->assertLessThanOrEqual(12, $queries, 'A six-week read must not issue per-day or per-Dentist queries.');
        $this->assertCount(42, $response->json('data.days'));
        $this->assertSame(['b1', 'b2'], array_column($response->json('data.branches'), 'id'));

        $expectedBranches = ['b1', 'b2'];
        foreach ($response->json('data.days') as $day) {
            $this->assertSame($expectedBranches, array_column($day['branches'], 'id'));
            $this->assertIsInt($day['appointments']);
            $this->assertIsInt($day['booked_minutes']);
            $this->assertIsInt($day['capacity_minutes']);
        }
    }

    public function test_calendar_capacity_cannot_be_requested_for_an_unassigned_staff_branch(): void
    {
        $this->actingAsUser('staffB1');
        $this->getJson('/api/calendar/load?branch_ref=b2&from=2026-09-29&to=2026-09-30')->assertForbidden();
    }

    public function test_patient_cannot_read_the_dedicated_dentist_duty_projection(): void
    {
        $this->actingAsUser('patientA');
        $this->getJson('/api/work-schedules/duty')->assertForbidden();
    }
}
