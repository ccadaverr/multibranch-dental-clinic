<?php

namespace Tests\Feature\Analytics;

use App\Support\ClinicClock;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;

/** Aggregate-only browser evidence from real disposable PostgreSQL transactions, rolled back after the test. */
class OwnerRevenueAcceptanceEvidenceTest extends AnalyticsTest
{
    public function test_combined_saturday_sunday_evidence_matches_independent_payment_and_refund_queries(): void
    {
        parent::test_saturday_chart_summary_and_csv_keep_transaction_and_invoice_date_bases_distinct();
        $start = CarbonImmutable::parse('2026-10-31 00:00:00', ClinicClock::TIMEZONE);
        $sunday = $start->addDay();
        $cash = DB::table('payments')->where('recorded_at', '>=', $start->toIso8601String())
            ->where('recorded_at', '<', $sunday->toIso8601String())->sum('amount');
        $refunds = DB::table('invoice_refunds')->where('refunded_at', '>=', $start->toIso8601String())
            ->where('refunded_at', '<', $sunday->toIso8601String())->sum('amount');
        $this->assertSame('121.40', (string) $cash);
        $this->assertSame('5.02', (string) $refunds);

        $evidence = ['saturday' => '2026-10-31', 'sunday' => '2026-11-01', 'branches' => [], 'reports' => []];
        foreach (['all', 'b1', 'b2'] as $key) {
            $branch = $key === 'all' ? null : $this->b[$key];
            $scope = $branch ? '&branch_id='.$branch->public_id : '';
            if ($branch) {
                $evidence['branches'][] = ['id' => $key, 'publicId' => $branch->public_id, 'name' => $branch->name];
            }
            $this->travelTo($sunday->subSecond());
            $daily = $this->getJson('/api/analytics/daily-revenue?date_from=2026-10-26&date_to=2026-10-31'.$scope)->assertOk()->json('data');
            $weekly = $this->getJson('/api/analytics/weekly-histogram?date=2026-10-31'.$scope)->assertOk()->json('data');
            $this->assertSame($daily['totals'], $weekly['totals']);
            $summary = $this->getJson('/api/analytics/executive-summary?date_from=2026-10-31&date_to=2026-10-31'.$scope)->assertOk()->json('data');
            $csv = $this->get('/api/analytics/export?date_from=2026-10-31&date_to=2026-10-31&include_daily=1'.$scope)->assertOk()->streamedContent();
            $this->travelTo($sunday);
            $sundayDaily = $this->getJson('/api/analytics/daily-revenue?date_from=2026-11-01&date_to=2026-11-01'.$scope)->assertOk()->json('data');
            $finalWeekly = $this->getJson('/api/analytics/weekly-histogram?date=2026-11-01'.$scope)->assertOk()->json('data');
            $this->assertSame($weekly['totals'], $finalWeekly['totals']);
            $this->assertTrue($finalWeekly['is_finalized']);
            $evidence['reports'][$key] = compact('daily', 'weekly', 'summary', 'csv', 'sundayDaily', 'finalWeekly');
        }
        $this->assertSame('116.38', $evidence['reports']['all']['weekly']['totals']['net_cash_flow_php']);
        $this->assertSame('37.03', $evidence['reports']['all']['sundayDaily']['totals']['net_cash_flow_php']);
        $target = env('DENTALOPS_LOCAL_TARGET');
        $this->assertNotEmpty($target, 'Explicit owned test target required.');
        $path = dirname($target).'/own01-combined-evidence.json';
        file_put_contents($path, json_encode($evidence, JSON_THROW_ON_ERROR));
        chmod($path, 0600);
    }
}
