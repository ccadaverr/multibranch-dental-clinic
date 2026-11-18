<?php

namespace Tests\Feature\Analytics;

use App\Models\Appointment;
use App\Models\Invoice;
use App\Models\QueueEntry;
use App\Models\Treatment;
use App\Models\Visit;
use App\Services\Automation\WorkflowAutomationService;
use Carbon\CarbonImmutable;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Tests\Feature\Appointments\SchedulingFixture;
use Tests\TestCase;

// M21 technical corrections: branch reference resolution (legacy_ref / public ULID, never an integer), no internal ids in
// responses, strict period/date validation, exact decimal money, current-clinic-day queue metrics, and "no data" as null.
class AnalyticsCorrectionsTest extends TestCase
{
    use RefreshDatabase, SchedulingFixture;

    private int $n = 0;

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpSchedulingWorld(); // frozen at 2026-09-28 10:00 Asia/Manila
    }

    /** A Paid/Issued invoice (direct rows, like the M11 tests) created at $createdAt. */
    private function invoice(string $branch, string $status, string $gross, string $hmo = '0.00', ?string $paid = null, string $createdAt = '2026-09-28 09:00:00+08'): Invoice
    {
        $n = ++$this->n;
        $when = '2026-09-28 09:00:00';
        $svc = $this->svc['svc1'];
        $visit = Visit::create(['patient_id' => $this->p['A']->id, 'branch_id' => $this->b[$branch]->id, 'source' => 'walk_in', 'status' => 'In Treatment', 'responsible_dentist_profile_id' => $this->d[$branch === 'b1' ? 'd1' : 'd3']->id, 'requested_service_id' => $svc->id, 'arrived_at' => $when, 'clinic_date' => '2026-09-28', 'revision' => 1, 'created_by_user_id' => $this->u['staffB1']->id, 'updated_by_user_id' => $this->u['staffB1']->id]);
        $treatment = Treatment::create(['visit_id' => $visit->id, 'dentist_profile_id' => $visit->responsible_dentist_profile_id, 'status' => 'In Treatment', 'procedure_summary' => 'x', 'started_at' => $when, 'revision' => 1, 'created_by_user_id' => $this->u['dentist1']->id, 'updated_by_user_id' => $this->u['dentist1']->id]);
        DB::transaction(function () use ($treatment, $visit, $when) {
            $visit->update(['status' => 'Completed', 'closed_at' => $when, 'revision' => 2]);
            $treatment->update(['status' => 'Completed', 'completed_at' => $when, 'revision' => 2]);
        });
        $responsibility = number_format((float) $gross - (float) $hmo, 2, '.', '');
        $invoice = Invoice::create(['treatment_id' => $treatment->id, 'visit_id' => $visit->id, 'patient_id' => $this->p['A']->id, 'branch_id' => $this->b[$branch]->id, 'invoice_number' => 'INV-T-'.$n, 'status' => $status, 'revision' => 2, 'gross_amount' => $gross, 'hmo_coverage_amount' => $hmo, 'patient_responsibility_amount' => $responsibility, 'paid_amount' => $paid ?? '0.00', 'created_by_user_id' => $this->u['staffB1']->id, 'updated_by_user_id' => $this->u['staffB1']->id]);
        DB::table('invoices')->where('id', $invoice->id)->update(['created_at' => $createdAt]);

        return $invoice;
    }

    private function summary(string $query = '')
    {
        return $this->getJson('/api/analytics/executive-summary'.($query ? "?{$query}" : ''));
    }

    // ---- E-1 / E-2: branch resolution and public identity --------------------------------------------------------

    public function test_branch_filter_accepts_legacy_ref_and_public_ulid_and_narrows_the_figures(): void
    {
        $this->invoice('b1', 'Paid', '100.00', '0.00', '100.00');
        $this->invoice('b2', 'Paid', '300.00', '0.00', '300.00');
        $this->actingAsUser('owner');

        $all = $this->summary('period=all')->assertOk();
        $this->assertSame('400.00', $all->json('data.financials.total_collected_php'));
        $this->assertNull($all->json('data.branch'));

        foreach (['b1' => '100.00', 'b2' => '300.00'] as $ref => $expected) {
            $byRef = $this->summary("period=all&branch_id={$ref}")->assertOk();
            $this->assertSame($expected, $byRef->json('data.financials.total_collected_php'), $ref);
            $ulid = $this->b[$ref]->public_id;
            foreach ([$ulid, strtoupper($ulid)] as $form) {
                $byUlid = $this->summary("period=all&branch_id={$form}")->assertOk();
                $this->assertSame($expected, $byUlid->json('data.financials.total_collected_php'), $form);
                $this->assertSame($ulid, $byUlid->json('data.branch.public_id'));
            }
        }
    }

    public function test_a_ulid_beginning_with_01_is_never_cast_to_branch_id_1(): void
    {
        $this->invoice('b1', 'Paid', '100.00', '0.00', '100.00');
        $this->invoice('b2', 'Paid', '300.00', '0.00', '300.00');
        $this->actingAsUser('owner');
        $this->assertStringStartsWith('01', $this->b['b2']->public_id);
        $this->assertSame('300.00', $this->summary('period=all&branch_id='.$this->b['b2']->public_id)->json('data.financials.total_collected_php'));
    }

    public function test_invalid_branch_references_are_422_and_never_widen_the_scope(): void
    {
        $this->actingAsUser('owner');
        foreach ([(string) $this->b['b1']->id, '0', 'b9', 'not a branch', '01ARZ3NDEKTSV4RRFFQ69G5FAV', 'B1 '] as $bad) {
            foreach (['/api/analytics/executive-summary', '/api/analytics/branch-performance'] as $url) {
                $r = $this->getJson($url.'?branch_id='.rawurlencode($bad))->assertStatus(422)->assertJsonValidationErrors('branch_id');
                $this->assertStringNotContainsString((string) $this->b['b1']->id.'"', json_encode($r->json()));
            }
        }
        $this->get('/api/analytics/export?branch_id=999')->assertStatus(422);
        $this->getJson('/api/analytics/executive-summary?branch_id[]=b1')->assertStatus(422);
    }

    public function test_all_branches_is_an_explicit_choice_and_absence_means_all(): void
    {
        $this->invoice('b1', 'Paid', '100.00', '0.00', '100.00');
        $this->invoice('b2', 'Paid', '300.00', '0.00', '300.00');
        $this->actingAsUser('owner');
        foreach (['', 'branch_id=all', 'branch_id=ALL', 'branch_id='] as $q) {
            $r = $this->summary('period=all&'.$q)->assertOk();
            $this->assertSame('400.00', $r->json('data.financials.total_collected_php'), $q);
            $this->assertNull($r->json('data.branch'));
        }
    }

    public function test_no_response_contains_an_internal_numeric_branch_id(): void
    {
        $this->actingAsUser('owner');
        $walk = function ($value, string $path = '') use (&$walk) {
            if (is_array($value)) {
                foreach ($value as $k => $v) {
                    $this->assertNotContains($k, ['branch_id', 'id'], "numeric identifier key at {$path}.{$k}");
                    $walk($v, "{$path}.{$k}");
                }
            }
        };
        $walk($this->summary('period=all&branch_id=b1')->assertOk()->json('data'));
        $rows = $this->getJson('/api/analytics/branch-performance?period=all')->assertOk()->json('data');
        $this->assertCount(2, $rows);
        foreach ($rows as $row) {
            $walk($row);
            $this->assertMatchesRegularExpression('/^[0-9a-z]{26}$/i', $row['public_id']);
        }
        $this->assertCount(1, $this->getJson('/api/analytics/branch-performance?period=all&branch_id=b2')->assertOk()->json('data'));
    }

    public function test_csv_export_uses_the_same_branch_resolution_and_labels_the_scope(): void
    {
        $this->invoice('b2', 'Paid', '300.00', '0.00', '300.00');
        $this->actingAsUser('owner');
        $csv = $this->get('/api/analytics/export?period=all&branch_id=b2')->assertOk()->streamedContent();
        $this->assertStringContainsString('"Branch Scope","Branch B2"', $csv);
        $this->assertStringContainsString('"Paid Invoice Amounts Applied",300.00', $csv);
        $this->assertStringNotContainsString('Branch B1', $csv);
        $all = $this->get('/api/analytics/export?period=all')->assertOk()->streamedContent();
        $this->assertStringContainsString('"Branch Scope","All Branches"', $all);
    }

    // ---- CR-01: period and date validation ------------------------------------------------------------------------

    public function test_every_preset_period_is_accepted(): void
    {
        $this->actingAsUser('owner');
        foreach (['today' => 'today', 'this week' => 'week', 'week' => 'week', 'this month' => 'month', 'month' => 'month', 'this year' => 'year', 'year' => 'year', 'all' => 'all', 'ALL TIME' => 'all', 'This Week' => 'week'] as $in => $out) {
            $this->summary('period='.rawurlencode($in))->assertOk()->assertJsonPath('data.period', $out);
        }
        $this->summary()->assertOk()->assertJsonPath('data.period', 'today');
    }

    public function test_invalid_period_and_dates_are_rejected_without_a_silent_fallback(): void
    {
        $this->actingAsUser('owner');
        $cases = [
            'period=forever',
            'period[]=today',
            'date_from=not-a-date&date_to=2026-09-28',
            'date_from=2026-13-45&date_to=2026-09-28',
            'date_from=2026-02-30&date_to=2026-03-02',
            'date_from=2026-9-1&date_to=2026-09-28',
            'date_from=2026-09-01&date_to=09/28/2026',
            'date_from=2026-09-01',
            'date_to=2026-09-28',
            'date_from=2026-09-28&date_to=2026-09-01',
            'date_from[]=2026-09-01&date_to=2026-09-28',
        ];
        foreach ($cases as $q) {
            foreach (['/api/analytics/executive-summary', '/api/analytics/branch-performance', '/api/analytics/export'] as $url) {
                $this->getJson($url.'?'.$q)->assertStatus(422);
            }
        }
    }

    public function test_a_valid_custom_range_is_applied_inclusively_in_manila_business_days(): void
    {
        $this->invoice('b1', 'Paid', '10.00', '0.00', '10.00', '2026-09-27 23:59:59+08');   // before
        $this->invoice('b1', 'Paid', '20.00', '0.00', '20.00', '2026-09-28 00:00:00+08');   // first instant of 28th
        $this->invoice('b1', 'Paid', '40.00', '0.00', '40.00', '2026-09-28 23:59:59+08');     // last second of the 28th
        $this->invoice('b1', 'Paid', '80.00', '0.00', '80.00', '2026-09-29 00:00:00+08');   // after
        $this->invoice('b1', 'Paid', '160.00', '0.00', '160.00', '2026-09-28 15:59:59+00'); // 23:59:59 Manila on the 28th
        $this->invoice('b1', 'Paid', '320.00', '0.00', '320.00', '2026-09-28 16:00:00+00'); // 00:00 Manila on the 29th
        $this->actingAsUser('owner');

        $r = $this->summary('date_from=2026-09-28&date_to=2026-09-28')->assertOk();
        $this->assertSame('custom', $r->json('data.period'));
        $this->assertSame('Sep 28, 2026 – Sep 28, 2026', $r->json('data.period_label'));
        $this->assertSame('220.00', $r->json('data.financials.total_collected_php'));
        $this->assertSame(3, $r->json('data.financials.paid_invoices_count'));

        $wide = $this->summary('date_from=2026-09-27&date_to=2026-09-29')->assertOk();
        $this->assertSame('630.00', $wide->json('data.financials.total_collected_php'));
        $this->assertSame('630.00', $this->summary('period=all')->json('data.financials.total_collected_php'));

        $this->assertSame('0.00', $this->summary('date_from=2026-01-01&date_to=2026-01-02')->assertOk()->json('data.financials.total_collected_php'));
        $branches = $this->getJson('/api/analytics/branch-performance?date_from=2026-09-28&date_to=2026-09-28')->assertOk()->json('data');
        $this->assertSame('220.00', collect($branches)->firstWhere('code', 'BRC-B1')['revenue_collected_php']);
    }

    public function test_the_window_does_not_depend_on_the_database_session_time_zone(): void
    {
        $this->invoice('b1', 'Paid', '50.00', '0.00', '50.00', '2026-09-28 00:30:00+08');
        $this->actingAsUser('owner');
        try {
            foreach (['UTC', 'Asia/Manila', 'America/New_York'] as $tz) {
                DB::statement("SET TIME ZONE '{$tz}'");
                $this->assertSame('50.00', $this->summary('date_from=2026-09-28&date_to=2026-09-28')->json('data.financials.total_collected_php'), $tz);
                $this->assertSame('0.00', $this->summary('date_from=2026-09-27&date_to=2026-09-27')->json('data.financials.total_collected_php'), $tz);
            }
        } finally {
            DB::statement('SET TIME ZONE DEFAULT');
        }
    }

    public function test_non_owner_roles_are_refused_before_validation(): void
    {
        foreach (['staffB1', 'dentist1', 'patientA'] as $who) {
            $this->actingAsUser($who);
            $this->getJson('/api/analytics/executive-summary?period=forever&branch_id=12')->assertStatus(403);
        }
    }

    // ---- E-3: exact money --------------------------------------------------------------------------------------------

    public function test_money_is_exact_decimal_strings_with_no_float_drift(): void
    {
        foreach (['0.10', '0.20', '19.99', '19.99', '0.29', '0.29'] as $amount) {
            $this->invoice('b1', 'Paid', $amount, '0.00', $amount);
        }
        $this->invoice('b1', 'Issued', '100.10', '50.05', '10.01');
        $this->actingAsUser('owner');
        $f = $this->summary('period=all')->assertOk()->json('data.financials');

        $this->assertSame('40.86', $f['total_collected_php']);
        $this->assertSame('140.96', $f['total_gross_php']);
        $this->assertSame('50.05', $f['total_hmo_covered_php']);
        $this->assertSame('40.04', $f['outstanding_balance_php']);
        $this->assertSame(7, $f['invoices_count']);
        $this->assertSame(6, $f['paid_invoices_count']);
        $this->assertSame('6.81', $f['average_ticket_php']);
        foreach (['total_collected_php', 'total_gross_php', 'total_hmo_covered_php', 'outstanding_balance_php', 'average_ticket_php'] as $key) {
            $this->assertIsString($f[$key], $key);
            $this->assertMatchesRegularExpression('/^\d+\.\d{2}$/', $f[$key], $key);
        }
        $row = collect($this->getJson('/api/analytics/branch-performance?period=all')->json('data'))->firstWhere('code', 'BRC-B1');
        $this->assertSame('40.86', $row['revenue_collected_php']);
    }

    public function test_average_ticket_rounds_half_away_from_zero_to_centavos(): void
    {
        $this->invoice('b1', 'Paid', '0.01', '0.00', '0.01');
        $this->invoice('b1', 'Paid', '0.02', '0.00', '0.02');
        $this->actingAsUser('owner');
        $this->assertSame('0.02', $this->summary('period=all')->json('data.financials.average_ticket_php')); // 0.015
    }

    public function test_hmo_figures_are_unchanged_in_meaning_and_exact(): void
    {
        $this->invoice('b1', 'Paid', '1000.00', '1000.00', '0.00'); // full HMO coverage: Paid with nothing collected
        $this->actingAsUser('owner');
        $f = $this->summary('period=all')->json('data.financials');
        $this->assertSame('0.00', $f['total_collected_php']);
        $this->assertSame('1000.00', $f['total_gross_php']);
        $this->assertSame('1000.00', $f['total_hmo_covered_php']);
    }

    // ---- CR-02: the current queue ----------------------------------------------------------------------------------

    private function walkIn(string $patient, string $dentist = 'd1', string $branch = 'b1'): QueueEntry
    {
        $this->actingAsUser($branch === 'b1' ? 'staffB1' : 'staffB2');
        $this->postJson('/api/visits/walk-in', ['patient_id' => $this->p[$patient]->public_id, 'branch_ref' => $branch, 'service_ref' => 'svc1', 'dentist_ref' => $dentist],
            ['Idempotency-Key' => 'a-'.(++$this->n)])->assertSuccessful();

        return QueueEntry::whereHas('visit', fn ($q) => $q->where('patient_id', $this->p[$patient]->id))->latest('id')->firstOrFail();
    }

    private function queueWorld(): void
    {
        [, $this->p['C']] = $this->patient('PAT-0003');
        [, $this->p['D']] = $this->patient('PAT-0004');
        [, $this->p['E']] = $this->patient('PAT-0005');
        [, $this->p['F']] = $this->patient('PAT-0006');
        $this->travelTo(CarbonImmutable::parse('2026-09-27 10:00:00', 'Asia/Manila'));
        $this->walkIn('A');                                  // yesterday's Waiting entry, never closed
        $this->travelTo(CarbonImmutable::parse('2026-09-28 10:00:00', 'Asia/Manila'));
        $this->walkIn('B');                                  // today's Waiting (b1)
        $away = $this->walkIn('C');                          // today, Temporarily Away
        $away->update(['status' => 'Temporarily Away']);
        $served = $this->walkIn('D');                        // today, Served
        $served->update(['status' => 'Served', 'closed_at' => now()]);
        $this->walkIn('E', 'd3', 'b2');                      // today's Waiting (b2)
        $called = $this->walkIn('F', 'd2');                  // today, Called (b1)
        $called->update(['status' => 'Called']);
    }

    public function test_current_queue_is_todays_position_holding_entries_and_summary_and_branch_report_agree(): void
    {
        $this->queueWorld();
        $this->actingAsUser('owner');

        $b1 = $this->summary('period=all&branch_id=b1')->assertOk();
        $this->assertSame(2, $b1->json('data.patient_flow.current_waiting')); // Waiting (B) + Called (F); not yesterday, away or served
        $this->assertSame(3, $this->summary('period=all')->json('data.patient_flow.current_waiting'));
        $this->assertSame(1, $this->summary('period=all&branch_id=b2')->json('data.patient_flow.current_waiting'));
        $this->assertSame(1, $b1->json('data.patient_flow.served_from_queue'));

        $rows = collect($this->getJson('/api/analytics/branch-performance?period=all')->assertOk()->json('data'))->keyBy('code');
        $this->assertSame(2, $rows['BRC-B1']['active_queue']);
        $this->assertSame(1, $rows['BRC-B2']['active_queue']);
        // The current queue does not follow the selected historical window.
        foreach (['today', 'this week', 'this year', 'all'] as $period) {
            $this->assertSame(3, $this->summary('period='.rawurlencode($period))->json('data.patient_flow.current_waiting'), $period);
            $this->assertSame(2, collect($this->getJson('/api/analytics/branch-performance?period='.rawurlencode($period))->json('data'))->firstWhere('code', 'BRC-B1')['active_queue'], $period);
        }
        // Old rows are untouched: no status change, no close.
        $this->assertSame('Waiting', QueueEntry::whereHas('visit', fn ($q) => $q->where('patient_id', $this->p['A']->id))->sole()->status);
    }

    public function test_the_clinic_day_follows_manila_midnight_not_utc(): void
    {
        [, $this->p['C']] = $this->patient('PAT-0003');
        $this->walkIn('B'); // admitted at 10:00 on 2026-09-28, Manila
        $this->travelTo(CarbonImmutable::parse('2026-09-28 00:30:00', 'Asia/Manila')); // 2026-09-27 16:30 UTC: UTC "today" would be the 27th
        $this->actingAsUser('owner');
        $this->assertSame(1, $this->summary('period=all')->json('data.patient_flow.current_waiting'));
        $this->travelTo(CarbonImmutable::parse('2026-09-28 23:59:59', 'Asia/Manila'));
        $this->actingAsUser('owner');
        $this->assertSame(1, $this->summary('period=all')->json('data.patient_flow.current_waiting'));
        $this->travelTo(CarbonImmutable::parse('2026-09-29 00:00:00', 'Asia/Manila'));
        $this->actingAsUser('owner');
        $this->assertSame(0, $this->summary('period=all')->json('data.patient_flow.current_waiting'));
    }

    public function test_wait_estimate_is_unavailable_until_the_clinic_approves_a_formula(): void
    {
        $this->queueWorld();
        $this->actingAsUser('owner');
        foreach ($this->getJson('/api/analytics/branch-performance?period=all')->json('data') as $row) {
            $this->assertNull($row['estimated_wait_minutes']);
        }
        $csv = $this->get('/api/analytics/export?period=all')->streamedContent();
        $this->assertStringContainsString('Not configured', $csv);
    }

    // ---- E-5: no data is not 100% ----------------------------------------------------------------------------------

    public function test_no_observations_are_null_never_a_fabricated_hundred_percent(): void
    {
        $this->actingAsUser('owner');
        $d = $this->summary('period=all')->assertOk()->json('data');
        $this->assertNull($d['scheduling']['completion_rate_pct']);
        $this->assertNull($d['automation']['health_rate_pct']);
        $this->assertNull($d['financials']['average_ticket_php']);
        $this->assertSame('0.00', $d['financials']['total_collected_php']);
        $this->assertSame(0, $d['automation']['total_actions']);
        $csv = $this->get('/api/analytics/export?period=all')->streamedContent();
        $this->assertStringContainsString('"Completion Rate (%)","No data"', $csv);
        $this->assertStringContainsString('"Automation Health Rate (%)","No data"', $csv);
    }

    public function test_a_genuine_zero_and_a_genuine_hundred_are_distinguished_from_no_data(): void
    {
        $this->existing('A', 'd1', 'b1', 'svc1', '2026-09-28', '09:00', 30, 'Cancelled');
        $this->actingAsUser('owner');
        $this->assertSame(0, $this->summary('period=all')->json('data.scheduling.completion_rate_pct'));
        $this->existing('B', 'd2', 'b1', 'svc1', '2026-09-28', '11:00', 30, 'Completed');
        $this->existing('B', 'd2', 'b1', 'svc1', '2026-09-28', '12:00', 30, 'Completed');
        $this->existing('B', 'd2', 'b1', 'svc1', '2026-09-28', '13:00', 30, 'Completed');
        $this->assertSame(75, $this->summary('period=all')->json('data.scheduling.completion_rate_pct')); // 3 of 4
        Appointment::where('status', 'Cancelled')->delete();
        $this->assertSame(100, $this->summary('period=all')->json('data.scheduling.completion_rate_pct'));
    }

    public function test_automation_health_is_null_without_actions_and_exact_with_them(): void
    {
        $this->actingAsUser('owner');
        $this->summary('period=all')->assertOk()
            ->assertJsonPath('data.automation.health_rate_pct', null)->assertJsonPath('data.automation.total_actions', 0);

        // Reports read persisted evaluations. The legacy monitor's manual HTTP dispatch was retired.
        $automation = app(WorkflowAutomationService::class);
        $recordCapacity = fn (string $branch, int $wait) => $automation->recordEvent([
            'event_type' => 'patientflow.capacity.updated',
            'idempotency_key' => 'analytics-capacity-'.$branch,
            'domain' => 'patientflow',
            'branch_id' => $this->b[$branch]->id,
            'payload' => ['estimated_wait_minutes' => $wait],
        ]);

        $this->assertSame('Success', $recordCapacity('b1', 10)->actions()->sole()->status);
        $this->summary('period=all')->assertOk()->assertJsonPath('data.automation.health_rate_pct', 100);
        $warning = $recordCapacity('b2', 99)->actions()->sole();
        $this->assertSame('Warning', $warning->status);
        $this->assertSame($warning->public_id, $recordCapacity('b2', 99)->actions()->sole()->public_id);
        $this->summary('period=all')->assertOk()
            ->assertJsonPath('data.automation.health_rate_pct', 50)->assertJsonPath('data.automation.total_actions', 2);
        $this->summary('period=all&branch_id='.$this->b['b1']->public_id)->assertOk()
            ->assertJsonPath('data.automation.health_rate_pct', 100)->assertJsonPath('data.automation.total_actions', 1);
        $this->summary('period=all&branch_id='.$this->b['b2']->public_id)->assertOk()
            ->assertJsonPath('data.automation.health_rate_pct', 0)->assertJsonPath('data.automation.total_actions', 1);
    }
}
