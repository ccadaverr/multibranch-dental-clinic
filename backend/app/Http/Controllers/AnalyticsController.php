<?php

namespace App\Http\Controllers;

use App\Enums\Role;
use App\Http\Requests\Analytics\AnalyticsQueryRequest;
use App\Services\Analytics\AnalyticsService;
use App\Support\ClinicClock;
use Carbon\CarbonImmutable;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;
use Symfony\Component\HttpFoundation\StreamedResponse;

class AnalyticsController extends Controller
{
    public function __construct(
        private readonly AnalyticsService $analyticsService
    ) {}

    private function authorizeOwner(Request $request): void
    {
        abort_unless($request->user() && $request->user()->role === Role::Owner, 403, 'Executive analytics and reports are restricted to the clinic Owner.');
    }

    public function executiveSummary(AnalyticsQueryRequest $request): JsonResponse
    {
        $this->authorizeOwner($request);

        $summary = $this->analyticsService->getExecutiveSummary($request->period(), $request->branch(), $request->dateFrom(), $request->dateTo());

        return response()->json([
            'data' => $summary,
        ]);
    }

    public function branchPerformance(AnalyticsQueryRequest $request): JsonResponse
    {
        $this->authorizeOwner($request);

        $branches = $this->analyticsService->getBranchPerformance($request->period(), $request->dateFrom(), $request->dateTo(), $request->branch());

        return response()->json([
            'data' => $branches,
        ]);
    }

    public function dailyRevenue(AnalyticsQueryRequest $request): JsonResponse
    {
        $this->authorizeOwner($request);

        $trend = $this->analyticsService->getDailyRevenueTrend(
            $request->period(),
            $request->branch(),
            $request->dateFrom(),
            $request->dateTo()
        );

        return response()->json([
            'data' => $trend,
        ]);
    }

    public function weeklyRevenueHistogram(AnalyticsQueryRequest $request): JsonResponse
    {
        $this->authorizeOwner($request);

        $targetDate = null;
        if ($request->exists('date') && $request->input('date') !== null && $request->input('date') !== '') {
            $rawDate = $request->input('date');
            if (! is_string($rawDate) || ! ClinicClock::validDate($rawDate)) {
                throw ValidationException::withMessages([
                    'date' => ['Use a real calendar date in YYYY-MM-DD format.'],
                ]);
            }
            $targetDate = $rawDate;
        }

        $histogram = $this->analyticsService->getWeeklyRevenueHistogram($request->branch(), $targetDate);

        return response()->json([
            'data' => $histogram,
        ]);
    }

    public function export(AnalyticsQueryRequest $request): StreamedResponse
    {
        $this->authorizeOwner($request);

        $request->validate(['include_daily' => ['sometimes', 'boolean']]);
        $period = $request->period();
        $branch = $request->branch();
        $scope = $this->analyticsService->parsePeriod($period, $request->dateFrom(), $request->dateTo());
        // Resolve relative periods once so every section uses the same dates across Manila midnight.
        $from = $scope['from']?->toDateString();
        $to = $scope['to']?->toDateString();
        $summary = $this->analyticsService->getExecutiveSummary($period, $branch, $from, $to);
        $branches = $this->analyticsService->getBranchPerformance($period, $from, $to, $branch);
        $daily = $request->boolean('include_daily') ? $this->analyticsService->getDailyRevenueTrend($period, $branch, $from, $to) : null;

        $branchLabel = $branch === null ? 'all-branches' : (
            Str::limit(Str::slug($branch->branch_code ?: $branch->name), 48, '') ?: 'branch-'.strtolower($branch->public_id)
        );
        $rangeLabel = $from === null ? 'all-time' : ($from === $to ? $from : "{$from}_to_{$to}");
        $filename = "operational-analytics-{$branchLabel}-{$rangeLabel}-"
            .CarbonImmutable::now(ClinicClock::TIMEZONE)->format('Ymd-His').'.csv';

        $headers = [
            'Content-Type' => 'text/csv; charset=UTF-8',
            'Content-Disposition' => "attachment; filename=\"{$filename}\"",
            'Cache-Control' => 'no-store, no-cache',
        ];

        return response()->stream(function () use ($summary, $branches, $daily, $scope) {
            $handle = fopen('php://output', 'w');

            // BOM for UTF-8
            fputs($handle, "\xEF\xBB\xBF");

            $sanitize = function (?string $value): string {
                if ($value === null || $value === '') {
                    return '';
                }
                if (preg_match('/^(?:[\t\r\n]|[\p{Z}\s]*[=+\-@])/u', $value)) {
                    return "'" . $value;
                }
                return $value;
            };

            // Money is already an exact decimal string; a metric with no observations is written as text, never 0 or 100.
            $pct = fn (?int $v): string => $v === null ? 'No data' : $v.'%';

            // Section 1: Executive KPI Summary
            fputcsv($handle, ['EXECUTIVE OPERATIONAL SUMMARY']);
            fputcsv($handle, ['Reporting Period', $sanitize($scope['label'])]);
            fputcsv($handle, ['Branch Scope', $sanitize($summary['branch']['name'] ?? 'All Branches')]);
            fputcsv($handle, []);
            fputcsv($handle, ['Metric Category', 'Metric Name', 'Value (PHP / Count)']);
            fputcsv($handle, ['Financial', 'Total Revenue Collected', $summary['financials']['total_collected_php']]);
            fputcsv($handle, ['Financial', 'Gross Invoiced Amount', $summary['financials']['total_gross_php']]);
            fputcsv($handle, ['Financial', 'HMO Covered Amount', $summary['financials']['total_hmo_covered_php']]);
            fputcsv($handle, ['Financial', 'Outstanding Balance', $summary['financials']['outstanding_balance_php']]);
            fputcsv($handle, ['Financial', 'Paid Invoices Count', $summary['financials']['paid_invoices_count']]);
            fputcsv($handle, ['Scheduling', 'Total Appointments', $summary['scheduling']['total_appointments']]);
            fputcsv($handle, ['Scheduling', 'Completed Appointments', $summary['scheduling']['completed']]);
            fputcsv($handle, ['Scheduling', 'Completion Rate (%)', $pct($summary['scheduling']['completion_rate_pct'])]);
            fputcsv($handle, ['Patient Flow', 'Total Patient Visits', $summary['patient_flow']['total_visits']]);
            fputcsv($handle, ['Patient Flow', 'Served From Queue', $summary['patient_flow']['served_from_queue']]);
            fputcsv($handle, ['HMO Operations', 'Approved Claims Count', $summary['hmo']['approved']]);
            fputcsv($handle, ['HMO Operations', 'Approved Amount (PHP)', $summary['hmo']['approved_amount_php']]);
            fputcsv($handle, ['Automation', 'Automation Health Rate (%)', $pct($summary['automation']['health_rate_pct'])]);
            fputcsv($handle, []);

            // Section 2: Branch Comparative Performance
            fputcsv($handle, ['BRANCH COMPARATIVE BREAKDOWN']);
            fputcsv($handle, [
                'Branch Name',
                'Code',
                'City',
                'Revenue Collected (PHP)',
                'Appointments',
                'Completed Appointments',
                'Active Queue',
                'Capacity Threshold (%)',
                'Estimated Wait (min)',
            ]);

            foreach ($branches as $b) {
                fputcsv($handle, [
                    $sanitize($b['name']),
                    $sanitize($b['code']),
                    $sanitize($b['city']),
                    $b['revenue_collected_php'],
                    $b['total_appointments'],
                    $b['completed_appointments'],
                    $b['active_queue'],
                    $b['capacity_threshold'] ?? 'Not configured',
                    $b['estimated_wait_minutes'] ?? 'Not configured',
                ]);
            }

            if ($daily !== null) {
                fputcsv($handle, []);
                fputcsv($handle, ['DAILY CASH FLOW']);
                fputcsv($handle, ['Date basis', 'Payments recorded and refunds made (Asia/Manila)']);
                fputcsv($handle, ['From', $daily['date_from'], 'Through', $daily['date_to']]);
                fputcsv($handle, ['Date', 'Gross Collections (PHP)', 'Refunds (PHP)', 'Net Cash Flow (PHP)']);
                foreach ($daily['days'] as $day) {
                    fputcsv($handle, [$day['date'], $day['gross_collected_php'], $day['refunded_php'], $day['net_cash_flow_php']]);
                }
                $total = $daily['totals'];
                fputcsv($handle, ['Total', $total['gross_collected_php'], $total['refunded_php'], $total['net_cash_flow_php']]);
            }

            fclose($handle);
        }, 200, $headers);
    }
}
