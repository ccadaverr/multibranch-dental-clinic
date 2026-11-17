<?php

namespace Tests\Feature\Analytics;

use App\Models\Appointment;
use App\Models\Branch;
use App\Models\Invoice;
use App\Models\Payment;
use App\Models\Treatment;
use App\Models\Visit;
use App\Services\Analytics\AnalyticsService;
use Carbon\CarbonImmutable;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\Feature\Appointments\SchedulingFixture;
use Tests\TestCase;

class AnalyticsTest extends TestCase
{
    use RefreshDatabase, SchedulingFixture;

    private AnalyticsService $analyticsService;

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpSchedulingWorld();
        $this->analyticsService = app(AnalyticsService::class);
    }

    public function test_unauthenticated_cannot_access_analytics_endpoints(): void
    {
        $this->getJson('/api/analytics/executive-summary')->assertStatus(401);
        $this->getJson('/api/analytics/branch-performance')->assertStatus(401);
        $this->get('/api/analytics/export')->assertStatus(401);
    }

    public function test_non_owner_roles_are_forbidden(): void
    {
        $this->actingAsUser('staffB1');
        $this->getJson('/api/analytics/executive-summary')->assertStatus(403);
        $this->getJson('/api/analytics/branch-performance')->assertStatus(403);

        $this->actingAsUser('dentist1');
        $this->getJson('/api/analytics/executive-summary')->assertStatus(403);

        $this->actingAsUser('patientA');
        $this->getJson('/api/analytics/executive-summary')->assertStatus(403);
    }

    public function test_owner_can_access_executive_summary(): void
    {
        $this->actingAsUser('owner');

        $response = $this->getJson('/api/analytics/executive-summary?period=today')
            ->assertStatus(200);

        $response->assertJsonStructure([
            'data' => [
                'period',
                'period_label',
                'branch',
                'financials' => [
                    'total_collected_php',
                    'total_gross_php',
                    'total_hmo_covered_php',
                    'outstanding_balance_php',
                    'invoices_count',
                    'paid_invoices_count',
                    'average_ticket_php',
                ],
                'scheduling' => [
                    'total_appointments',
                    'confirmed',
                    'completed',
                    'cancelled',
                    'no_show',
                    'in_treatment',
                    'completion_rate_pct',
                ],
                'patient_flow' => [
                    'total_visits',
                    'served_from_queue',
                    'current_waiting',
                ],
                'hmo' => [
                    'total_cases',
                    'approved',
                    'pending',
                    'withdrawn',
                    'rejected',
                    'approved_amount_php',
                ],
                'automation' => [
                    'total_actions',
                    'success',
                    'warning',
                    'failed',
                    'health_rate_pct',
                ],
            ],
        ]);
    }

    public function test_period_filter_respects_time_boundaries(): void
    {
        $this->actingAsUser('owner');

        $todayRes = $this->getJson('/api/analytics/executive-summary?period=today')->assertStatus(200);
        $this->assertEquals('today', $todayRes->json('data.period'));

        $weekRes = $this->getJson('/api/analytics/executive-summary?period=this+week')->assertStatus(200);
        $this->assertEquals('week', $weekRes->json('data.period'));

        $monthRes = $this->getJson('/api/analytics/executive-summary?period=this+month')->assertStatus(200);
        $this->assertEquals('month', $monthRes->json('data.period'));

        $allRes = $this->getJson('/api/analytics/executive-summary?period=all')->assertStatus(200);
        $this->assertEquals('all', $allRes->json('data.period'));
    }

    public function test_branch_filtering_narrows_scope(): void
    {
        $this->actingAsUser('owner');

        $response = $this->getJson('/api/analytics/executive-summary?period=all&branch_id=b1')
            ->assertStatus(200);

        $this->assertSame($this->b['b1']->public_id, $response->json('data.branch.public_id'));
    }

    public function test_owner_can_view_branch_performance(): void
    {
        $this->actingAsUser('owner');

        $response = $this->getJson('/api/analytics/branch-performance?period=today')
            ->assertStatus(200);

        $response->assertJsonStructure([
            'data' => [
                '*' => [
                    'public_id',
                    'name',
                    'code',
                    'city',
                    'revenue_collected_php',
                    'total_appointments',
                    'completed_appointments',
                    'active_queue',
                    'capacity_threshold',
                    'estimated_wait_minutes',
                    'is_open',
                ],
            ],
        ]);
    }

    public function test_csv_export_streams_with_formula_injection_protection(): void
    {
        $this->actingAsUser('owner');

        $response = $this->get('/api/analytics/export?period=today')
            ->assertStatus(200);

        $this->assertEquals('text/csv; charset=UTF-8', $response->headers->get('Content-Type'));
        $content = $response->streamedContent();

        $this->assertStringContainsString('EXECUTIVE OPERATIONAL SUMMARY', $content);
        $this->assertStringContainsString('BRANCH COMPARATIVE BREAKDOWN', $content);
        $this->assertStringNotContainsString('",=cmd', $content);
    }

    public function test_csv_keeps_one_manila_day_across_midnight_and_identifies_its_scope_safely(): void
    {
        $beforeMidnight = CarbonImmutable::parse('2026-11-17T23:59:59+08:00');
        $afterMidnight = $beforeMidnight->addSecond();
        $this->recordSettledPayment('b1', '125.51', $beforeMidnight, $beforeMidnight);
        $this->recordSettledPayment('b1', '987.65', $afterMidnight, $afterMidnight);
        $branch = $this->b['b1'];
        DB::table('branches')->where('id', $branch->id)->update(['name' => "\t=1+1", 'city' => " \t=2+2"]);

        // Keep the real PostgreSQL aggregation and move the clock only after the summary has finished.
        $service = $this->analyticsService;
        $this->partialMock(AnalyticsService::class, function ($mock) use ($service, $afterMidnight): void {
            $mock->shouldReceive('getExecutiveSummary')->once()->andReturnUsing(function (...$scope) use ($service, $afterMidnight) {
                $result = $service->getExecutiveSummary(...$scope);
                CarbonImmutable::setTestNow($afterMidnight);

                return $result;
            });
        });

        $this->actingAsUser('owner');
        CarbonImmutable::setTestNow($beforeMidnight);
        try {
            $response = $this->get('/api/analytics/export?period=today&include_daily=1&branch_id='.$branch->public_id)
                ->assertOk()
                ->assertHeader('Content-Disposition', 'attachment; filename="operational-analytics-brc-b1-2026-11-17-20261118-000000.csv"');
            $csv = $response->streamedContent();
            $this->assertStringContainsString('Today (Nov 17, 2026)', $csv);
            $this->assertStringContainsString('From,2026-11-17,Through,2026-11-17', $csv);
            $this->assertStringContainsString('Total,125.51,0.00,125.51', $csv);
            $this->assertStringContainsString("'	=1+1", $csv);
            $this->assertStringContainsString("' \t=2+2", $csv);
            $this->assertStringNotContainsString('987.65', $csv);
        } finally {
            CarbonImmutable::setTestNow();
        }
    }

    public function test_revenue_series_and_weekly_histogram_require_owner_authentication(): void
    {
        $this->getJson('/api/analytics/daily-revenue')->assertStatus(401);
        $this->getJson('/api/analytics/weekly-histogram')->assertStatus(401);

        foreach (['staffB1', 'dentist1', 'patientA'] as $roleUser) {
            $this->actingAsUser($roleUser);
            $this->getJson('/api/analytics/daily-revenue')->assertStatus(403);
            $this->getJson('/api/analytics/weekly-histogram')->assertStatus(403);
        }
    }

    public function test_operational_csv_can_include_the_scoped_daily_cash_chart_data(): void
    {
        $previousDay = CarbonImmutable::parse('2026-09-27T12:00:00Z');
        $firstInstant = CarbonImmutable::parse('2026-09-27T16:00:00Z'); // Midnight in Manila.
        $nextDay = CarbonImmutable::parse('2026-09-28T16:00:00Z');
        [$invoice, $payment] = $this->recordSettledPayment('b1', '1250.51', $previousDay, $firstInstant);
        $this->recordInvoiceRefund($invoice, $payment, '70.12', $nextDay->subSecond(), 'Synthetic refund');
        $this->recordSettledPayment('b1', '9.99', $firstInstant, $nextDay);
        $this->recordSettledPayment('b2', '4321.00', $firstInstant, $firstInstant);

        $this->actingAsUser('owner');
        $branch = $this->b['b1']->public_id;
        $query = '?branch_id='.$branch.'&date_from=2026-09-28&date_to=2026-09-28';
        $daily = $this->getJson('/api/analytics/daily-revenue'.$query)->assertOk()
            ->assertJsonPath('data.branch.public_id', $branch)
            ->assertJsonCount(1, 'data.days')
            ->assertJsonPath('data.days.0.net_cash_flow_php', '1180.39')->json('data.days.0');
        $csv = $this->get('/api/analytics/export'.$query.'&include_daily=1')->assertOk()->streamedContent();
        $this->assertStringContainsString('"Total Revenue Collected",9.99', $csv);
        $this->assertStringContainsString('DAILY CASH FLOW', $csv);
        $this->assertStringContainsString('From,2026-09-28,Through,2026-09-28', $csv);
        $this->assertStringContainsString(implode(',', [$daily['date'], $daily['gross_collected_php'], $daily['refunded_php'], $daily['net_cash_flow_php']]), $csv);
        $this->assertStringContainsString('Total,1250.51,70.12,1180.39', $csv);
        $this->assertStringNotContainsString('4321.00', $csv);
        $legacy = $this->get('/api/analytics/export'.$query)->assertOk()->streamedContent();
        $this->assertStringNotContainsString('DAILY CASH FLOW', $legacy);
        $this->getJson('/api/analytics/export'.$query.'&include_daily=unknown')->assertUnprocessable();

        foreach (['staffB1', 'dentist1', 'patientA'] as $actor) {
            $this->actingAsUser($actor);
            $this->getJson('/api/analytics/export'.$query.'&include_daily=1')->assertForbidden();
        }
    }

    public function test_custom_report_reads_and_csv_keep_the_same_manila_dates_branch_and_centavos(): void
    {
        foreach ([
            ['b1', '2026-09-27T16:00:00Z', '1250.51'],
            ['b1', '2026-09-28T15:59:59Z', '10.04'],
            ['b1', '2026-09-28T16:00:01Z', '99.99'],
            ['b2', '2026-09-28T01:00:00Z', '4321.00'],
        ] as [$branch, $instant, $amount]) {
            $time = CarbonImmutable::parse($instant);
            $this->recordSettledPayment($branch, $amount, $time, $time);
        }

        $this->actingAsUser('owner');
        $branch = $this->b['b1']->public_id;
        $query = '?branch_id='.$branch.'&date_from=2026-09-28&date_to=2026-09-28';
        $this->getJson('/api/analytics/executive-summary'.$query)->assertOk()
            ->assertJsonPath('data.period', 'custom')
            ->assertJsonPath('data.branch.public_id', $branch)
            ->assertJsonPath('data.financials.total_collected_php', '1260.55');
        $this->getJson('/api/analytics/branch-performance'.$query)->assertOk()->assertJsonCount(1, 'data')
            ->assertJsonPath('data.0.public_id', $branch)
            ->assertJsonPath('data.0.revenue_collected_php', '1260.55');
        $this->getJson('/api/analytics/daily-revenue'.$query)->assertOk()->assertJsonCount(1, 'data.days')
            ->assertJsonPath('data.days.0.date', '2026-09-28')
            ->assertJsonPath('data.days.0.gross_collected_php', '1260.55');
        $csv = $this->get('/api/analytics/export'.$query)->assertOk()->streamedContent();
        $this->assertStringContainsString('1260.55', $csv);
        $this->assertStringNotContainsString('4321.00', $csv);
        $this->assertStringNotContainsString('99.99', $csv);

        foreach (['staffB1', 'dentist1', 'patientA'] as $actor) {
            $this->actingAsUser($actor);
            $this->getJson('/api/analytics/executive-summary'.$query)->assertForbidden();
            $this->getJson('/api/analytics/export'.$query)->assertForbidden();
        }
    }

    public function test_daily_revenue_groups_by_payment_recorded_at_with_manila_boundaries_and_continuous_zero_days(): void
    {
        // Invoice created Sep 20, but payment settled Sep 26 at 23:45 Manila (15:45 UTC Sep 26) -> buckets on 2026-09-26
        $this->recordSettledPayment(
            branchKey: 'b1',
            amount: '1250.50',
            invoiceCreatedAt: CarbonImmutable::parse('2026-09-20 10:00:00', 'Asia/Manila'),
            paymentRecordedAt: CarbonImmutable::parse('2026-09-26 23:45:00', 'Asia/Manila')
        );

        // Payment settled Sep 28 at 00:15 Manila (16:15 UTC Sep 27) -> buckets on 2026-09-28 in Asia/Manila, leaving Sep 27 at zero
        $this->recordSettledPayment(
            branchKey: 'b2',
            amount: '3000.00',
            invoiceCreatedAt: CarbonImmutable::parse('2026-09-27 18:00:00', 'Asia/Manila'),
            paymentRecordedAt: CarbonImmutable::parse('2026-09-28 00:15:00', 'Asia/Manila')
        );

        $this->actingAsUser('owner');

        $res = $this->getJson('/api/analytics/daily-revenue?date_from=2026-09-25&date_to=2026-09-28')
            ->assertStatus(200);

        $this->assertSame('custom', $res->json('data.period'));
        $this->assertSame('Asia/Manila', $res->json('data.timezone'));
        $this->assertSame('payments.recorded_at', $res->json('data.date_basis.collections'));
        $this->assertSame('invoice_refunds.refunded_at', $res->json('data.date_basis.refunds'));
        $this->assertSame('4250.50', $res->json('data.totals.gross_collected_php'));
        $this->assertSame('0.00', $res->json('data.totals.refunded_php'));
        $this->assertSame('4250.50', $res->json('data.totals.net_cash_flow_php'));
        $this->assertSame(2, $res->json('data.totals.payments_count'));
        $this->assertSame(0, $res->json('data.totals.refunds_count'));

        $days = collect($res->json('data.days'))->keyBy('date');
        $this->assertCount(4, $days);

        // Zero-activity day (2026-09-25)
        $this->assertSame('0.00', $days['2026-09-25']['gross_collected_php']);
        $this->assertSame('0.00', $days['2026-09-25']['refunded_php']);
        $this->assertSame('0.00', $days['2026-09-25']['net_cash_flow_php']);
        $this->assertSame(0, $days['2026-09-25']['payments_count']);
        $this->assertSame(0, $days['2026-09-25']['refunds_count']);

        // 2026-09-26 late-night Manila payment
        $this->assertSame('1250.50', $days['2026-09-26']['gross_collected_php']);
        $this->assertSame('1250.50', $days['2026-09-26']['net_cash_flow_php']);
        $this->assertSame(1, $days['2026-09-26']['payments_count']);

        // Zero-activity gap day (2026-09-27)
        $this->assertSame('0.00', $days['2026-09-27']['gross_collected_php']);
        $this->assertSame(0, $days['2026-09-27']['payments_count']);

        // 2026-09-28 early-morning Manila payment (even though UTC date was Sep 27)
        $this->assertSame('3000.00', $days['2026-09-28']['gross_collected_php']);
        $this->assertSame('3000.00', $days['2026-09-28']['net_cash_flow_php']);
        $this->assertSame(1, $days['2026-09-28']['payments_count']);
    }

    public function test_daily_revenue_and_weekly_histogram_handle_refunds_on_different_days_and_multiple_partial_refunds_without_double_counting(): void
    {
        // Payment 1 on Monday 2026-09-28 for 5000.00 in b1, with TWO partial refunds:
        // - Refund 1a on Monday 2026-09-28 for 500.00
        // - Refund 1b on Wednesday 2026-09-30 for 750.25
        // Plus a second payment on Monday 2026-09-28 for 1000.00 in b1.
        [$inv1, $pay1] = $this->recordSettledPayment(
            branchKey: 'b1',
            amount: '5000.00',
            invoiceCreatedAt: CarbonImmutable::parse('2026-09-28 09:00:00', 'Asia/Manila'),
            paymentRecordedAt: CarbonImmutable::parse('2026-09-28 09:30:00', 'Asia/Manila')
        );
        $this->recordSettledPayment(
            branchKey: 'b1',
            amount: '1000.00',
            invoiceCreatedAt: CarbonImmutable::parse('2026-09-28 11:00:00', 'Asia/Manila'),
            paymentRecordedAt: CarbonImmutable::parse('2026-09-28 11:15:00', 'Asia/Manila')
        );
        $this->recordInvoiceRefund($inv1, $pay1, '500.00', CarbonImmutable::parse('2026-09-28 14:00:00', 'Asia/Manila'), 'Partial adjustment 1');
        $this->recordInvoiceRefund($inv1, $pay1, '750.25', CarbonImmutable::parse('2026-09-30 16:00:00', 'Asia/Manila'), 'Partial adjustment 2');

        // Payment in b2 on Tuesday 2026-09-29 for 2000.00
        $this->recordSettledPayment(
            branchKey: 'b2',
            amount: '2000.00',
            invoiceCreatedAt: CarbonImmutable::parse('2026-09-29 10:00:00', 'Asia/Manila'),
            paymentRecordedAt: CarbonImmutable::parse('2026-09-29 10:30:00', 'Asia/Manila')
        );

        $this->actingAsUser('owner');

        // Filter to b1 only (by public ULID)
        $b1Histogram = $this->getJson('/api/analytics/weekly-histogram?date=2026-09-28&branch_id='.$this->b['b1']->public_id)
            ->assertStatus(200);

        $this->assertSame($this->b['b1']->public_id, $b1Histogram->json('data.branch.public_id'));
        // Gross on Monday must be 6000.00 (5000 + 1000), never 11000.00 from joining 2 refund rows to the 5000 payment
        $this->assertSame('6000.00', $b1Histogram->json('data.totals.gross_collected_php'));
        $this->assertSame('1250.25', $b1Histogram->json('data.totals.refunded_php'));
        $this->assertSame('4749.75', $b1Histogram->json('data.totals.net_cash_flow_php'));
        $this->assertSame(2, $b1Histogram->json('data.totals.payments_count'));
        $this->assertSame(2, $b1Histogram->json('data.totals.refunds_count'));

        $buckets = collect($b1Histogram->json('data.buckets'))->keyBy('date');
        // Monday 2026-09-28: 6000.00 gross, 500.00 refunded, 5500.00 net
        $this->assertSame('6000.00', $buckets['2026-09-28']['gross_collected_php']);
        $this->assertSame('500.00', $buckets['2026-09-28']['refunded_php']);
        $this->assertSame('5500.00', $buckets['2026-09-28']['net_cash_flow_php']);
        $this->assertSame(2, $buckets['2026-09-28']['payments_count']);
        $this->assertSame(1, $buckets['2026-09-28']['refunds_count']);

        // Wednesday 2026-09-30: 0.00 gross, 750.25 refunded, -750.25 net
        $this->assertSame('0.00', $buckets['2026-09-30']['gross_collected_php']);
        $this->assertSame('750.25', $buckets['2026-09-30']['refunded_php']);
        $this->assertSame('-750.25', $buckets['2026-09-30']['net_cash_flow_php']);
        $this->assertSame(0, $buckets['2026-09-30']['payments_count']);
        $this->assertSame(1, $buckets['2026-09-30']['refunds_count']);

        // All-branches daily trend across 2026-09-28..2026-09-30 includes b2's 2000.00 on Tuesday
        $allTrend = $this->getJson('/api/analytics/daily-revenue?date_from=2026-09-28&date_to=2026-09-30')
            ->assertStatus(200);
        $this->assertNull($allTrend->json('data.branch'));
        $this->assertSame('8000.00', $allTrend->json('data.totals.gross_collected_php'));
        $this->assertSame('1250.25', $allTrend->json('data.totals.refunded_php'));
        $this->assertSame('6749.75', $allTrend->json('data.totals.net_cash_flow_php'));
    }

    public function test_weekly_histogram_returns_six_monday_to_saturday_buckets_excludes_sunday_and_tracks_finalization(): void
    {
        // Payment on Saturday 2026-10-03
        $this->recordSettledPayment(
            branchKey: 'b1',
            amount: '1500.00',
            invoiceCreatedAt: CarbonImmutable::parse('2026-10-03 10:00:00', 'Asia/Manila'),
            paymentRecordedAt: CarbonImmutable::parse('2026-10-03 11:00:00', 'Asia/Manila')
        );

        // Payment on Sunday 2026-10-04 (must be excluded from the Monday–Saturday histogram)
        $this->recordSettledPayment(
            branchKey: 'b1',
            amount: '9999.00',
            invoiceCreatedAt: CarbonImmutable::parse('2026-10-04 10:00:00', 'Asia/Manila'),
            paymentRecordedAt: CarbonImmutable::parse('2026-10-04 11:00:00', 'Asia/Manila')
        );

        $this->actingAsUser('owner');

        // 1. On Monday 2026-09-28 (frozen fixture clock), current week is not finalized
        $mondayView = $this->getJson('/api/analytics/weekly-histogram')
            ->assertStatus(200);
        $this->assertSame('2026-09-28', $mondayView->json('data.week_start_date'));
        $this->assertSame('2026-10-03', $mondayView->json('data.week_end_date'));
        $this->assertFalse($mondayView->json('data.is_finalized'));
        $buckets = $mondayView->json('data.buckets');
        $this->assertCount(6, $buckets);
        $this->assertSame(
            ['2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02', '2026-10-03'],
            array_column($buckets, 'date')
        );
        $this->assertSame([1, 2, 3, 4, 5, 6], array_column($buckets, 'day_of_week'));
        // Sunday 9999.00 is excluded; Saturday 1500.00 is included
        $this->assertSame('1500.00', $mondayView->json('data.totals.gross_collected_php'));

        // 2. On Saturday 2026-10-03 15:00 Manila, the Saturday reporting day has not ended yet -> is_finalized is still false
        $this->travelTo(CarbonImmutable::parse('2026-10-03 15:00:00', 'Asia/Manila'));
        $saturdayView = $this->getJson('/api/analytics/weekly-histogram?date=2026-10-03')
            ->assertStatus(200);
        $this->assertFalse($saturdayView->json('data.is_finalized'));

        // 3. On Sunday 2026-10-04 08:00 Manila, Saturday 2026-10-03 has passed -> is_finalized is true
        $this->travelTo(CarbonImmutable::parse('2026-10-04 08:00:00', 'Asia/Manila'));
        $sundayView = $this->getJson('/api/analytics/weekly-histogram?date=2026-09-30')
            ->assertStatus(200);
        $this->assertTrue($sundayView->json('data.is_finalized'));
    }

    public function test_daily_revenue_and_weekly_histogram_reject_invalid_dates_and_branch_identifiers(): void
    {
        $this->actingAsUser('owner');

        // Reversed custom range
        $this->getJson('/api/analytics/daily-revenue?date_from=2026-09-30&date_to=2026-09-25')
            ->assertStatus(422)
            ->assertJsonValidationErrors(['date_to']);

        // Impossible calendar date
        $this->getJson('/api/analytics/daily-revenue?date_from=2026-02-30&date_to=2026-03-01')
            ->assertStatus(422)
            ->assertJsonValidationErrors(['date_from']);

        // Invalid target date on weekly histogram
        $this->getJson('/api/analytics/weekly-histogram?date=2026-02-30')
            ->assertStatus(422)
            ->assertJsonValidationErrors(['date']);

        // Internal numeric branch id is rejected (never trusted)
        $numericBranchId = $this->b['b1']->id;
        $this->getJson("/api/analytics/daily-revenue?branch_id={$numericBranchId}")
            ->assertStatus(422)
            ->assertJsonValidationErrors(['branch_id']);

        $this->getJson("/api/analytics/weekly-histogram?branch_id={$numericBranchId}")
            ->assertStatus(422)
            ->assertJsonValidationErrors(['branch_id']);

        // Unknown branch reference is rejected
        $this->getJson('/api/analytics/weekly-histogram?branch_id=nonexistent-branch')
            ->assertStatus(422)
            ->assertJsonValidationErrors(['branch_id']);
    }

    /**
     * @return array{0: Invoice, 1: Payment}
     */
    private function recordSettledPayment(
        string $branchKey,
        string $amount,
        CarbonImmutable $invoiceCreatedAt,
        CarbonImmutable $paymentRecordedAt
    ): array {
        $branch = $this->b[$branchKey];
        $dentistKey = $branchKey === 'b2' ? 'd3' : 'd1';

        $visit = Visit::create([
            'patient_id' => $this->p['A']->id,
            'branch_id' => $branch->id,
            'appointment_id' => null,
            'source' => 'walk_in',
            'status' => 'Completed',
            'responsible_dentist_profile_id' => $this->d[$dentistKey]->id,
            'requested_service_id' => $this->svc['svc1']->id,
            'arrived_at' => $invoiceCreatedAt->subHour(),
            'clinic_date' => $invoiceCreatedAt->setTimezone('Asia/Manila')->toDateString(),
            'closed_at' => $invoiceCreatedAt,
            'revision' => 1,
            'created_by_user_id' => $this->u['owner']->id,
            'updated_by_user_id' => $this->u['owner']->id,
        ]);

        $treatment = Treatment::create([
            'visit_id' => $visit->id,
            'dentist_profile_id' => $this->d[$dentistKey]->id,
            'status' => 'Completed',
            'started_at' => $invoiceCreatedAt->subMinutes(45),
            'completed_at' => $invoiceCreatedAt,
            'revision' => 1,
            'created_by_user_id' => $this->u['owner']->id,
            'updated_by_user_id' => $this->u['owner']->id,
        ]);

        $invoice = new Invoice([
            'treatment_id' => $treatment->id,
            'visit_id' => $visit->id,
            'patient_id' => $this->p['A']->id,
            'branch_id' => $branch->id,
            'invoice_number' => 'INV-'.Str::upper(Str::random(10)),
            'status' => 'Paid',
            'revision' => 1,
            'gross_amount' => $amount,
            'discount_amount' => '0.00',
            'hmo_coverage_amount' => '0.00',
            'patient_responsibility_amount' => $amount,
            'paid_amount' => $amount,
            'issued_at' => $invoiceCreatedAt,
            'paid_at' => $paymentRecordedAt,
            'created_by_user_id' => $this->u['owner']->id,
            'updated_by_user_id' => $this->u['owner']->id,
        ]);
        $invoice->created_at = $invoiceCreatedAt;
        $invoice->updated_at = $paymentRecordedAt;
        $invoice->save();

        $payment = new Payment([
            'invoice_id' => $invoice->id,
            'amount' => $amount,
            'method' => 'Cash',
            'recorded_by_user_id' => $this->u['owner']->id,
            'recorded_at' => $paymentRecordedAt,
        ]);
        $payment->created_at = $paymentRecordedAt;
        $payment->updated_at = $paymentRecordedAt;
        $payment->save();

        return [$invoice, $payment];
    }

    private function recordInvoiceRefund(
        Invoice $invoice,
        Payment $payment,
        string $amount,
        CarbonImmutable $refundedAt,
        string $reason
    ): void {
        DB::table('invoice_refunds')->insert([
            'public_id' => (string) Str::ulid(),
            'invoice_id' => $invoice->id,
            'payment_id' => $payment->id,
            'provider_refund_id' => 'rfnd_'.Str::lower(Str::random(12)),
            'amount' => $amount,
            'reason' => $reason,
            'refunded_at' => $refundedAt->toIso8601String(),
            'created_by_user_id' => $this->u['owner']->id,
            'created_at' => $refundedAt->toIso8601String(),
        ]);
    }
}
