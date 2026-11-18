<?php

namespace App\Services\Analytics;

use App\Models\Appointment;
use App\Models\AutomatedAction;
use App\Models\Branch;
use App\Models\HmoCase;
use App\Models\Invoice;
use App\Models\QueueEntry;
use App\Models\Visit;
use App\Support\ClinicClock;
use Carbon\CarbonImmutable;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;

// M21 read layer. Corrections in this pass (docs/M21_ANALYTICS_TECHNICAL_CORRECTIONS.md): the branch is a resolved Branch
// model (never a request integer); period windows are half-open [from, until) instants in Asia/Manila and are bound as
// ISO-8601 strings with an offset, so the database session time zone cannot shift a business day; money is aggregated
// by PostgreSQL in exact numeric and returned as decimal strings; "no observations" is null, never 100%.
class AnalyticsService
{
    /**
     * Parse a validated period into Asia/Manila boundaries. `from` is inclusive, `until` exclusive (the start of the
     * next business day), `to` is the last displayed day. A custom range requires both validated dates.
     */
    public function parsePeriod(?string $period, ?string $dateFrom = null, ?string $dateTo = null): array
    {
        $now = CarbonImmutable::now(ClinicClock::TIMEZONE);
        $norm = strtolower(trim((string) $period));

        if ($dateFrom !== null || $dateTo !== null) {
            if ($dateFrom === null || $dateTo === null || ! ClinicClock::validDate($dateFrom) || ! ClinicClock::validDate($dateTo) || $dateFrom > $dateTo) {
                throw new \InvalidArgumentException('A custom range needs a valid start and end date in order.');
            }
            $from = CarbonImmutable::createFromFormat('!Y-m-d', $dateFrom, ClinicClock::TIMEZONE);
            $to = CarbonImmutable::createFromFormat('!Y-m-d', $dateTo, ClinicClock::TIMEZONE);

            return $this->bounds($from, $to, "{$from->format('M d, Y')} – {$to->format('M d, Y')}", 'custom');
        }

        return match ($norm) {
            'today', '' => $this->bounds($now->startOfDay(), $now->startOfDay(), "Today ({$now->format('M d, Y')})", 'today'),
            'this week', 'week' => $this->bounds($now->startOfWeek(), $now->endOfWeek()->startOfDay(), "This Week ({$now->startOfWeek()->format('M d')} – {$now->endOfWeek()->format('M d, Y')})", 'week'),
            'this month', 'month' => $this->bounds($now->startOfMonth(), $now->endOfMonth()->startOfDay(), "This Month ({$now->format('F Y')})", 'month'),
            'this year', 'year' => $this->bounds($now->startOfYear(), $now->endOfYear()->startOfDay(), "This Year ({$now->format('Y')})", 'year'),
            'all', 'all time' => ['from' => null, 'until' => null, 'to' => null, 'label' => 'All Time', 'period' => 'all'],
            default => throw new \InvalidArgumentException('Unsupported analytics period.'),
        };
    }

    private function bounds(CarbonImmutable $firstDay, CarbonImmutable $lastDay, string $label, string $period): array
    {
        return ['from' => $firstDay, 'until' => $lastDay->addDay()->startOfDay(), 'to' => $lastDay, 'label' => $label, 'period' => $period];
    }

    /**
     * Apply the half-open window with offset-bearing ISO strings (independent of the DB session time zone).
     *
     * @param  \Illuminate\Database\Eloquent\Builder|\Illuminate\Database\Query\Builder  $query
     * @return \Illuminate\Database\Eloquent\Builder|\Illuminate\Database\Query\Builder
     */
    private function within($query, string $column, array $bounds)
    {
        if ($bounds['from'] && $bounds['until']) {
            $query->where($column, '>=', $bounds['from']->toIso8601String())->where($column, '<', $bounds['until']->toIso8601String());
        }

        return $query;
    }

    /** Current Manila clinic day, position-holding queue entries only (Waiting / Called / Treatment Ready). */
    private function currentQueue(?int $branchId = null): Builder
    {
        return QueueEntry::query()
            ->whereIn('status', QueueEntry::POSITIONAL)
            ->whereHas('dentistQueue', function ($q) use ($branchId) {
                $q->where('clinic_date', ClinicClock::today());
                if ($branchId !== null) {
                    $q->where('branch_id', $branchId);
                }
            });
    }

    /** A percentage, or null when there are no observations (never a fabricated 100). */
    private function rate(int $part, int $whole): ?int
    {
        return $whole > 0 ? (int) round(($part / $whole) * 100) : null;
    }

    /**
     * Compute authoritative executive summary KPIs. Monetary values are exact decimal strings (PostgreSQL numeric).
     */
    public function getExecutiveSummary(
        ?string $period = 'today',
        ?Branch $branch = null,
        ?string $dateFrom = null,
        ?string $dateTo = null
    ): array {
        $bounds = $this->parsePeriod($period, $dateFrom, $dateTo);
        $branchId = $branch?->id;

        // 1. Invoices & Financials (M11). Definitions unchanged: invoices created in the window; "collected" is the paid_amount
        // of Paid invoices (not a payment-date report).
        $invoiceQuery = Invoice::query();
        if ($branchId) {
            $invoiceQuery->where('branch_id', $branchId);
        }
        $this->within($invoiceQuery, 'created_at', $bounds);
        $fin = $invoiceQuery->toBase()->selectRaw("
            COUNT(*) AS invoices_count,
            COUNT(*) FILTER (WHERE status = 'Paid') AS paid_count,
            COALESCE(SUM(paid_amount) FILTER (WHERE status = 'Paid'), 0)::numeric(16,2)::text AS collected,
            COALESCE(SUM(gross_amount) FILTER (WHERE status IN ('Issued','Paid')), 0)::numeric(16,2)::text AS gross,
            COALESCE(SUM(hmo_coverage_amount) FILTER (WHERE status IN ('Issued','Paid')), 0)::numeric(16,2)::text AS hmo,
            COALESCE(SUM(patient_responsibility_amount - paid_amount) FILTER (WHERE status = 'Issued'), 0)::numeric(16,2)::text AS outstanding,
            ROUND(AVG(paid_amount) FILTER (WHERE status = 'Paid'), 2)::text AS average_ticket
        ")->first();

        // 2. Appointments & Scheduling (M6)
        $apptQuery = Appointment::query();
        if ($branchId) {
            $apptQuery->where('branch_id', $branchId);
        }
        $this->within($apptQuery, 'starts_at', $bounds);
        $apptCounts = $apptQuery->toBase()->selectRaw('status, COUNT(*) AS n')->groupBy('status')->pluck('n', 'status');
        $count = fn (string $status): int => (int) ($apptCounts[$status] ?? 0);
        $totalAppts = (int) $apptCounts->sum();
        $completedAppts = $count('Completed');
        $cancelledAppts = $count('Cancelled');
        $noShowAppts = $count('No-show');
        $terminalAppts = $completedAppts + $cancelledAppts + $noShowAppts;

        // 3. Queue & Patient Flow (M9/M10). Visits and Served are historical counts in the window; "currently waiting" is
        // the live position-holding queue of the current Manila clinic day and does not follow the selected period.
        $visitQuery = Visit::query();
        if ($branchId) {
            $visitQuery->where('branch_id', $branchId);
        }
        $this->within($visitQuery, 'arrived_at', $bounds);
        $totalVisits = (clone $visitQuery)->count();

        $servedQuery = QueueEntry::query()->where('status', 'Served');
        if ($branchId) {
            $servedQuery->whereHas('visit', fn ($q) => $q->where('branch_id', $branchId));
        }
        $this->within($servedQuery, 'created_at', $bounds);
        $servedQueueCount = $servedQuery->count();
        $waitingQueueCount = $this->currentQueue($branchId)->count();

        // 4. HMO Processing (M12)
        $hmoQuery = HmoCase::query();
        if ($branchId) {
            $hmoQuery->where('branch_id', $branchId);
        }
        $this->within($hmoQuery, 'created_at', $bounds);
        $hmo = $hmoQuery->toBase()->selectRaw("
            COUNT(*) AS total,
            COUNT(*) FILTER (WHERE status = 'Approved') AS approved,
            COUNT(*) FILTER (WHERE status IN ('Pending','Escalated')) AS pending,
            COUNT(*) FILTER (WHERE status = 'Withdrawn') AS withdrawn,
            COUNT(*) FILTER (WHERE status = 'Rejected') AS rejected,
            COALESCE(SUM(approved_amount) FILTER (WHERE status = 'Approved'), 0)::numeric(16,2)::text AS approved_amount
        ")->first();

        // 5. Automation Health (M23)
        $actionQuery = AutomatedAction::query();
        if ($branchId) {
            $actionQuery->whereHas('event', fn ($q) => $q->where('branch_id', $branchId));
        }
        $this->within($actionQuery, 'executed_at', $bounds);
        $actionCounts = $actionQuery->toBase()->selectRaw('status, COUNT(*) AS n')->groupBy('status')->pluck('n', 'status');
        $totalActions = (int) $actionCounts->sum();
        $successActions = (int) ($actionCounts['Success'] ?? 0);

        return [
            'period' => $bounds['period'],
            'period_label' => $bounds['label'],
            'branch' => $branch ? ['public_id' => $branch->public_id, 'name' => $branch->name] : null,
            'financials' => [
                // Legacy alias for consumers of the invoice-cohort contract.
                'total_collected_php' => $fin->collected,
                'invoice_payments_applied_php' => $fin->collected,
                'cash_flow' => $this->cashFlowTotals($bounds, $branchId),
                'total_gross_php' => $fin->gross,
                'total_hmo_covered_php' => $fin->hmo,
                'outstanding_balance_php' => $fin->outstanding,
                'invoices_count' => (int) $fin->invoices_count,
                'paid_invoices_count' => (int) $fin->paid_count,
                // Null when no invoice is Paid in the window; rounded half away from zero to centavos by PostgreSQL ROUND.
                'average_ticket_php' => $fin->average_ticket,
            ],
            'scheduling' => [
                'total_appointments' => $totalAppts,
                'confirmed' => $count('Confirmed'),
                'completed' => $completedAppts,
                'cancelled' => $cancelledAppts,
                'no_show' => $noShowAppts,
                'in_treatment' => $count('In Treatment'),
                // Null when no appointment in the window is Completed, Cancelled or No-show.
                'completion_rate_pct' => $this->rate($completedAppts, $terminalAppts),
            ],
            'patient_flow' => [
                'total_visits' => $totalVisits,
                'served_from_queue' => $servedQueueCount,
                'current_waiting' => $waitingQueueCount,
            ],
            'hmo' => [
                'total_cases' => (int) $hmo->total,
                'approved' => (int) $hmo->approved,
                'pending' => (int) $hmo->pending,
                'withdrawn' => (int) $hmo->withdrawn,
                'rejected' => (int) $hmo->rejected,
                'approved_amount_php' => $hmo->approved_amount,
            ],
            'automation' => [
                'total_actions' => $totalActions,
                'success' => $successActions,
                'warning' => (int) ($actionCounts['Warning'] ?? 0),
                'failed' => (int) ($actionCounts['Failed'] ?? 0),
                // Null when no automated action ran in the window.
                'health_rate_pct' => $this->rate($successActions, $totalActions),
            ],
        ];
    }

    /**
     * Per-branch comparative performance breakdown (all branches, or only the selected one). Branches are identified
     * by public ULID only. estimated_wait_minutes is null: the former "15 minutes per position" formula was never
     * approved by the clinic (M10 wait-time policy is unresolved).
     */
    public function getBranchPerformance(
        ?string $period = 'today',
        ?string $dateFrom = null,
        ?string $dateTo = null,
        ?Branch $branch = null
    ): Collection {
        $bounds = $this->parsePeriod($period, $dateFrom, $dateTo);

        $branches = Branch::query()->when($branch, fn ($q) => $q->where('id', $branch->id))->orderBy('name')->get();

        return $branches->map(function (Branch $b) use ($bounds) {
            $revenue = $this->within(Invoice::query()->where('branch_id', $b->id)->where('status', 'Paid'), 'created_at', $bounds)
                ->toBase()->selectRaw('COALESCE(SUM(paid_amount), 0)::numeric(16,2)::text AS v')->value('v');

            $apptsQuery = $this->within(Appointment::query()->where('branch_id', $b->id), 'starts_at', $bounds);
            $totalAppts = (clone $apptsQuery)->count();
            $completedAppts = (clone $apptsQuery)->where('status', 'Completed')->count();

            return [
                'public_id' => $b->public_id,
                'name' => $b->name,
                'code' => $b->branch_code,
                'city' => $b->city,
                'revenue_collected_php' => $revenue, // Legacy invoice-date alias.
                'invoice_payments_applied_php' => $revenue,
                'cash_flow' => $this->cashFlowTotals($bounds, $b->id),
                'total_appointments' => $totalAppts,
                'completed_appointments' => $completedAppts,
                'active_queue' => $this->currentQueue($b->id)->count(),
                'capacity_threshold' => $b->capacity_threshold,
                'estimated_wait_minutes' => null,
                'is_open' => $b->status === 'Open',
            ];
        });
    }

    /**
     * OWN-01 daily collection & refund time-series in Asia/Manila.
     * Aggregates payments by payments.recorded_at and refunds by invoice_refunds.refunded_at independently
     * so multiple partial refunds on one payment can never duplicate payment amounts.
     */
    public function getDailyRevenueTrend(
        ?string $period = 'today',
        ?Branch $branch = null,
        ?string $dateFrom = null,
        ?string $dateTo = null
    ): array {
        $bounds = $this->parsePeriod($period, $dateFrom, $dateTo);
        $aggregated = $this->aggregateCollectionsAndRefundsByDate($bounds, $branch?->id);
        $paymentsByDate = $aggregated['payments'];
        $refundsByDate = $aggregated['refunds'];

        $today = CarbonImmutable::createFromFormat('!Y-m-d', ClinicClock::today(), ClinicClock::TIMEZONE);
        $firstDay = $bounds['from']?->startOfDay();
        $lastDay = $bounds['to']?->startOfDay();

        if (! $firstDay || ! $lastDay) {
            $activityDates = array_unique(array_merge(array_keys($paymentsByDate), array_keys($refundsByDate)));
            sort($activityDates);
            if ($activityDates !== []) {
                $earliest = CarbonImmutable::createFromFormat('!Y-m-d', $activityDates[0], ClinicClock::TIMEZONE);
                $latest = CarbonImmutable::createFromFormat('!Y-m-d', $activityDates[count($activityDates) - 1], ClinicClock::TIMEZONE);
                $firstDay = $earliest->lessThan($today) ? $earliest : $today;
                $lastDay = $latest->greaterThan($today) ? $latest : $today;
            } else {
                $firstDay = $today;
                $lastDay = $today;
            }
        }

        $days = [];
        $totalGrossCentavos = 0;
        $totalRefundedCentavos = 0;
        $totalPaymentsCount = 0;
        $totalRefundsCount = 0;

        $cursor = $firstDay;
        while ($cursor->lessThanOrEqualTo($lastDay)) {
            $dateStr = $cursor->toDateString();
            $grossCentavos = $paymentsByDate[$dateStr]['gross_centavos'] ?? 0;
            $paymentsCount = $paymentsByDate[$dateStr]['payments_count'] ?? 0;
            $refundedCentavos = $refundsByDate[$dateStr]['refunded_centavos'] ?? 0;
            $refundsCount = $refundsByDate[$dateStr]['refunds_count'] ?? 0;

            $totalGrossCentavos += $grossCentavos;
            $totalRefundedCentavos += $refundedCentavos;
            $totalPaymentsCount += $paymentsCount;
            $totalRefundsCount += $refundsCount;

            $days[] = [
                'date' => $dateStr,
                'label' => $cursor->format('M d'),
                'day_of_week' => $cursor->dayOfWeekIso,
                'day_name' => $cursor->format('D'),
                'gross_collected_php' => $this->formatCentavos($grossCentavos),
                'refunded_php' => $this->formatCentavos($refundedCentavos),
                'net_cash_flow_php' => $this->formatCentavos($grossCentavos - $refundedCentavos),
                'payments_count' => $paymentsCount,
                'refunds_count' => $refundsCount,
            ];

            $cursor = $cursor->addDay();
        }

        return [
            'period' => $bounds['period'],
            'period_label' => $bounds['label'],
            'timezone' => ClinicClock::TIMEZONE,
            'date_basis' => [
                'collections' => 'payments.recorded_at',
                'refunds' => 'invoice_refunds.refunded_at',
                'booking_collections' => 'appointments.booking_paid_at',
                'booking_refunds' => 'appointments.booking_refunded_at',
            ],
            'date_from' => $firstDay->toDateString(),
            'date_to' => $lastDay->toDateString(),
            'branch' => $branch ? ['public_id' => $branch->public_id, 'name' => $branch->name] : null,
            'totals' => [
                'gross_collected_php' => $this->formatCentavos($totalGrossCentavos),
                'refunded_php' => $this->formatCentavos($totalRefundedCentavos),
                'net_cash_flow_php' => $this->formatCentavos($totalGrossCentavos - $totalRefundedCentavos),
                'payments_count' => $totalPaymentsCount,
                'refunds_count' => $totalRefundsCount,
            ],
            'days' => $days,
        ];
    }

    /**
     * OWN-01 Monday–Saturday (6-bucket) weekly collection & refund histogram in Asia/Manila.
     * Excludes Sunday. `is_finalized` is true only after the target week's Saturday has passed in Asia/Manila.
     */
    public function getWeeklyRevenueHistogram(
        ?Branch $branch = null,
        ?string $targetDate = null
    ): array {
        $referenceDateStr = ($targetDate !== null && $targetDate !== '') ? $targetDate : ClinicClock::today();
        if (! ClinicClock::validDate($referenceDateStr)) {
            throw new \InvalidArgumentException('Use a real calendar date in YYYY-MM-DD format.');
        }

        $referenceDate = CarbonImmutable::createFromFormat('!Y-m-d', $referenceDateStr, ClinicClock::TIMEZONE);
        $monday = $referenceDate->startOfWeek(CarbonImmutable::MONDAY)->startOfDay();
        $saturday = $monday->addDays(5)->startOfDay();

        $bounds = $this->bounds($monday, $saturday, "{$monday->format('M d')} – {$saturday->format('M d, Y')}", 'week');
        $aggregated = $this->aggregateCollectionsAndRefundsByDate($bounds, $branch?->id);
        $paymentsByDate = $aggregated['payments'];
        $refundsByDate = $aggregated['refunds'];

        $buckets = [];
        $totalGrossCentavos = 0;
        $totalRefundedCentavos = 0;
        $totalPaymentsCount = 0;
        $totalRefundsCount = 0;

        for ($offset = 0; $offset < 6; $offset++) {
            $cursor = $monday->addDays($offset);
            $dateStr = $cursor->toDateString();
            $grossCentavos = $paymentsByDate[$dateStr]['gross_centavos'] ?? 0;
            $paymentsCount = $paymentsByDate[$dateStr]['payments_count'] ?? 0;
            $refundedCentavos = $refundsByDate[$dateStr]['refunded_centavos'] ?? 0;
            $refundsCount = $refundsByDate[$dateStr]['refunds_count'] ?? 0;

            $totalGrossCentavos += $grossCentavos;
            $totalRefundedCentavos += $refundedCentavos;
            $totalPaymentsCount += $paymentsCount;
            $totalRefundsCount += $refundsCount;

            $buckets[] = [
                'date' => $dateStr,
                'label' => $cursor->format('D, M d'),
                'day_of_week' => $cursor->dayOfWeekIso,
                'day_name' => $cursor->format('l'),
                'short_day' => $cursor->format('D'),
                'gross_collected_php' => $this->formatCentavos($grossCentavos),
                'refunded_php' => $this->formatCentavos($refundedCentavos),
                'net_cash_flow_php' => $this->formatCentavos($grossCentavos - $refundedCentavos),
                'payments_count' => $paymentsCount,
                'refunds_count' => $refundsCount,
            ];
        }

        return [
            'reference_date' => $referenceDate->toDateString(),
            'week_start_date' => $monday->toDateString(),
            'week_end_date' => $saturday->toDateString(),
            'week_label' => $bounds['label'],
            'timezone' => ClinicClock::TIMEZONE,
            'date_basis' => [
                'collections' => 'payments.recorded_at',
                'refunds' => 'invoice_refunds.refunded_at',
                'booking_collections' => 'appointments.booking_paid_at',
                'booking_refunds' => 'appointments.booking_refunded_at',
            ],
            'is_finalized' => ClinicClock::today() > $saturday->toDateString(),
            'branch' => $branch ? ['public_id' => $branch->public_id, 'name' => $branch->name] : null,
            'totals' => [
                'gross_collected_php' => $this->formatCentavos($totalGrossCentavos),
                'refunded_php' => $this->formatCentavos($totalRefundedCentavos),
                'net_cash_flow_php' => $this->formatCentavos($totalGrossCentavos - $totalRefundedCentavos),
                'payments_count' => $totalPaymentsCount,
                'refunds_count' => $totalRefundsCount,
            ],
            'buckets' => $buckets,
        ];
    }

    /**
     * Bucket payments, booking captures, and confirmed refunds by their original Manila dates.
     *
     * @return array{
     *   payments: array<string, array{gross_centavos: int, payments_count: int}>,
     *   refunds: array<string, array{refunded_centavos: int, refunds_count: int}>
     * }
     */
    private function aggregateCollectionsAndRefundsByDate(array $bounds, ?int $branchId): array
    {
        $tz = ClinicClock::TIMEZONE;

        // Existing full-deposit invoice rows are historical allocation projections. Match the
        // original capture by appointment and reference before excluding them from cash flow.
        $paymentQuery = DB::table('payments')
            ->join('invoices', 'invoices.id', '=', 'payments.invoice_id')
            ->whereNotExists(function ($q) {
                $q->selectRaw('1')->from('visits')
                    ->join('appointments', 'appointments.id', '=', 'visits.appointment_id')
                    ->whereColumn('visits.id', 'invoices.visit_id')
                    ->whereColumn('appointments.branch_id', 'invoices.branch_id')
                    ->whereColumn('appointments.patient_id', 'invoices.patient_id')
                    ->where('invoices.settlement_type', 'booking_deposit')
                    ->whereColumn('appointments.booking_payment_ref', 'payments.external_reference')
                    ->whereIn('appointments.booking_payment_status', ['paid', 'refunded', 'partially_refunded', 'forfeited'])
                    ->where('appointments.booking_fee_php', '>', 0)
                    ->whereNotNull('appointments.booking_paid_at');
            });
        $invoiceRefunds = DB::table('invoice_refunds')
            ->join('invoices', 'invoices.id', '=', 'invoice_refunds.invoice_id');
        $bookingPayments = DB::table('appointments')
            ->whereIn('booking_payment_status', ['paid', 'refunded', 'partially_refunded', 'forfeited'])
            ->where('booking_fee_php', '>', 0)
            ->whereNotNull('booking_payment_ref')
            ->whereNotNull('booking_paid_at');
        $bookingRefunds = (clone $bookingPayments)->where('booking_payment_status', 'refunded')
            ->whereNotNull('booking_refund_ref')->whereNotNull('booking_refunded_at');
        if ($branchId !== null) {
            $paymentQuery->where('invoices.branch_id', $branchId);
            $invoiceRefunds->where('invoices.branch_id', $branchId);
            $bookingPayments->where('appointments.branch_id', $branchId);
            $bookingRefunds->where('appointments.branch_id', $branchId);
        }
        $this->within($paymentQuery, 'payments.recorded_at', $bounds);
        $this->within($bookingPayments, 'booking_paid_at', $bounds);
        $this->within($invoiceRefunds, 'invoice_refunds.refunded_at', $bounds);
        $this->within($bookingRefunds, 'booking_refunded_at', $bounds);

        $collections = $paymentQuery->selectRaw('payments.recorded_at AS occurred_at, payments.amount AS amount')
            ->unionAll($bookingPayments->selectRaw('booking_paid_at AS occurred_at, booking_fee_php AS amount'));
        $refunds = $invoiceRefunds->selectRaw('invoice_refunds.refunded_at AS occurred_at, invoice_refunds.amount AS amount')
            ->unionAll($bookingRefunds->selectRaw('booking_refunded_at AS occurred_at, booking_fee_php AS amount'));
        $bucket = "to_char(occurred_at AT TIME ZONE '{$tz}', 'YYYY-MM-DD')";
        $paymentsByDate = $refundsByDate = [];
        foreach (DB::query()->fromSub($collections, 'collections')->selectRaw("{$bucket} AS bucket_date, COUNT(*) AS count, SUM(amount)::numeric(16,2)::text AS total")->groupByRaw($bucket)->get() as $row) {
            $paymentsByDate[(string) $row->bucket_date] = [
                'gross_centavos' => $this->toCentavos((string) $row->total),
                'payments_count' => (int) $row->count,
            ];
        }
        foreach (DB::query()->fromSub($refunds, 'refunds')->selectRaw("{$bucket} AS bucket_date, COUNT(*) AS count, SUM(amount)::numeric(16,2)::text AS total")->groupByRaw($bucket)->get() as $row) {
            $refundsByDate[(string) $row->bucket_date] = [
                'refunded_centavos' => $this->toCentavos((string) $row->total),
                'refunds_count' => (int) $row->count,
            ];
        }

        return [
            'payments' => $paymentsByDate,
            'refunds' => $refundsByDate,
        ];
    }

    private function cashFlowTotals(array $bounds, ?int $branchId): array
    {
        $flows = $this->aggregateCollectionsAndRefundsByDate($bounds, $branchId);
        $gross = array_sum(array_column($flows['payments'], 'gross_centavos'));
        $refunds = array_sum(array_column($flows['refunds'], 'refunded_centavos'));

        return [
            'gross_collected_php' => $this->formatCentavos($gross),
            'refunded_php' => $this->formatCentavos($refunds),
            'net_cash_flow_php' => $this->formatCentavos($gross - $refunds),
        ];
    }

    private function toCentavos(string $amount): int
    {
        $negative = str_starts_with($amount, '-');
        $clean = ltrim($amount, '+-');
        [$whole, $frac] = array_pad(explode('.', $clean, 2), 2, '0');

        $cents = ((int) $whole * 100) + (int) substr(str_pad($frac, 2, '0'), 0, 2);

        return $negative ? -$cents : $cents;
    }

    private function formatCentavos(int $centavos): string
    {
        $sign = $centavos < 0 ? '-' : '';
        $abs = abs($centavos);

        return sprintf('%s%d.%02d', $sign, intdiv($abs, 100), $abs % 100);
    }
}
