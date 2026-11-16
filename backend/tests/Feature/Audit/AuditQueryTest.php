<?php

namespace Tests\Feature\Audit;

use App\Models\AuditLog;
use App\Services\Audit\AuditService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Tests\Feature\Appointments\SchedulingFixture;
use Tests\TestCase;

// M22 read API: validated allowlisted filters, bounded keyset pagination, deterministic order, honest export bounds.
class AuditQueryTest extends TestCase
{
    use RefreshDatabase, SchedulingFixture;

    private AuditService $audit;

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpSchedulingWorld();
        $this->audit = app(AuditService::class);
        $this->actingAsUser('owner');
    }

    private function emit(string $action, string $category = 'administrative', string $severity = 'info', array $extra = []): AuditLog
    {
        return $this->audit->record($extra + ['action' => $action, 'category' => $category, 'severity' => $severity, 'actor' => $this->u['owner']]);
    }

    public function test_filters_are_validated_and_allowlisted(): void
    {
        $bad = [
            'category=bogus', 'severity=fatal', 'severity=error', 'date_from=yesterday', 'date_to=2026-13-40', 'date_from=2026-09-30&date_to=2026-09-01',
            'per_page=0', 'per_page=101', 'per_page=abc', 'per_page[]=5', 'cursor=short', 'action=bad action!', 'action[]=x', 'search[]=x', 'search='.str_repeat('a', 101),
            'branch_id=nope', 'branch_id='.$this->b['b1']->id, 'branch_id[]=b1', "branch_id=b1'+OR+1=1--",
        ];
        foreach ($bad as $query) {
            $this->getJson('/api/audit-logs?'.$query)->assertStatus(422);
            $this->get('/api/audit-logs/export?'.str_replace('per_page', 'x', $query))->assertStatus(in_array(explode('=', $query)[0], ['per_page', 'per_page[]', 'cursor']) ? 200 : 422);
        }
        $this->getJson('/api/audit-logs?sort=actor_name;DROP TABLE audit_logs&order=desc&columns=password')->assertOk(); // unknown params are ignored, never executed
        $this->assertSame(0, AuditLog::count());
    }

    public function test_exact_filters_by_category_severity_action_branch_and_date(): void
    {
        $this->emit('billing.payment_recorded', 'financial', 'info', ['branch_id' => $this->b['b1']->id]);
        $this->emit('auth.login_failed', 'security', 'warning', ['branch_id' => $this->b['b2']->id]);
        $this->emit('patient.profile.updated', 'clinical');
        $ids = fn (string $q) => array_column($this->getJson('/api/audit-logs?'.$q)->assertOk()->json('data'), 'action');

        $this->assertSame(['billing.payment_recorded'], $ids('category=financial'));
        $this->assertSame(['auth.login_failed'], $ids('severity=warning'));
        $this->assertSame(['patient.profile.updated'], $ids('action=patient.profile.updated'));
        $this->assertSame([], $ids('action=patient.profile'), 'the action filter is exact');
        $this->assertSame(3, count($ids('category=all&severity=all')));
        $this->assertSame(['billing.payment_recorded'], $ids('branch_id=b1'), 'branch by legacy_ref');
        $this->assertSame(['auth.login_failed'], $ids('branch_id='.$this->b['b2']->public_id), 'branch by ULID public id');
        $day = DB::selectOne("select (now() at time zone 'Asia/Manila')::date::text as d")->d;
        $this->assertCount(3, $ids("date_from=$day&date_to=$day"));
        $this->assertCount(0, $ids('date_to=2020-01-01'));
        $this->assertCount(0, $ids('date_from=2999-01-01'));
    }

    public function test_search_treats_wildcards_literally_and_matches_the_documented_fields(): void
    {
        $this->emit('billing.payment_recorded', 'financial');
        $this->emit('auth.login_failed', 'security', 'warning', ['actor' => null, 'actor_name' => 'Anonymous']);
        $search = fn (string $term) => array_column($this->getJson('/api/audit-logs?search='.urlencode($term))->assertOk()->json('data'), 'action');
        $this->assertSame(['auth.login_failed'], $search('Anonym'));
        $this->assertSame(['billing.payment_recorded'], $search('payment_rec'));
        $this->assertSame([], $search('%'), 'a percent sign is a literal, not "match everything"');
        $this->assertSame([], $search('pay_ent'), 'an underscore is a literal character, not a one-character wildcard');
        $this->assertSame([], $search('pay%rec'));
        $this->assertSame([], $search("x' OR '1'='1"));
    }

    public function test_pagination_is_bounded_cursor_based_and_deterministic(): void
    {
        $made = [];
        for ($i = 1; $i <= 5; $i++) {
            $made[] = $this->emit("test.event_$i")->public_id;
        }
        $newestFirst = array_reverse($made);

        $page1 = $this->getJson('/api/audit-logs?per_page=2')->assertOk();
        $this->assertSame(array_slice($newestFirst, 0, 2), array_column($page1->json('data'), 'id'));
        $this->assertSame(2, $page1->json('meta.per_page'));
        $cursor = $page1->json('meta.next_cursor');
        $this->assertSame($newestFirst[1], $cursor);
        $page2 = $this->getJson("/api/audit-logs?per_page=2&cursor=$cursor")->assertOk();
        $this->assertSame(array_slice($newestFirst, 2, 2), array_column($page2->json('data'), 'id'));
        $page3 = $this->getJson('/api/audit-logs?per_page=2&cursor='.$page2->json('meta.next_cursor'))->assertOk();
        $this->assertSame([$newestFirst[4]], array_column($page3->json('data'), 'id'));
        $this->assertNull($page3->json('meta.next_cursor'), 'the last page has no cursor');

        // A row written between page requests never shifts or duplicates rows already paged through.
        $this->emit('test.late_arrival');
        $again = $this->getJson("/api/audit-logs?per_page=2&cursor=$cursor")->assertOk();
        $this->assertSame(array_slice($newestFirst, 2, 2), array_column($again->json('data'), 'id'));

        $this->assertCount(0, $this->getJson('/api/audit-logs?cursor=01ARZ3NDEKTSV4RRFFQ69G5FAV')->json('data'), 'an unknown cursor is an empty page, not an error or a leak');
        $this->assertCount(6, $this->getJson('/api/audit-logs')->json('data'));
        $this->assertSame(50, $this->getJson('/api/audit-logs')->json('meta.per_page'));
    }

    public function test_history_and_csv_use_event_time_even_when_insertion_ids_arrive_out_of_order(): void
    {
        $target = 'audit-history-001';
        $fixtures = [
            'history.newer' => '2026-11-15T16:01:00Z',
            'history.early' => '2026-11-15T16:00:00Z',
            'history.previous_day' => '2026-11-15T15:59:59Z',
            'history.tie' => '2026-11-15T16:01:00Z',
        ];
        $ids = [];
        foreach ($fixtures as $action => $instant) {
            $ids[$action] = strtolower((string) \Illuminate\Support\Str::ulid());
            DB::table('audit_logs')->insert([
                'public_id' => $ids[$action],
                'action' => $action,
                'branch_id' => $this->b['b1']->id,
                'auditable_type' => 'UserNotification',
                'auditable_public_id' => $target,
                'created_at' => $instant,
            ]);
        }
        $filter = '?branch_id=b1&date_from=2026-11-16&date_to=2026-11-16&target_type=UserNotification&target_id='.$target;
        $ordered = ['history.tie', 'history.newer', 'history.early'];
        $cursor = null;
        foreach ($ordered as $action) {
            $query = $filter.'&per_page=1'.($cursor === null ? '' : '&cursor='.$cursor);
            $page = $this->getJson('/api/audit-logs'.$query)->assertOk()
                ->assertJsonCount(1, 'data')->assertJsonPath('data.0.id', $ids[$action])->json();
            $cursor = $page['meta']['next_cursor'];
        }
        $this->assertNull($cursor);

        $csv = $this->get('/api/audit-logs/export'.$filter)->assertOk()->streamedContent();
        $lines = array_slice(explode("\n", trim($csv)), 1);
        $this->assertSame($ordered, array_map(fn ($line) => str_getcsv($line, escape: '')[2], $lines));
    }

    public function test_the_page_size_can_never_exceed_the_bound(): void
    {
        DB::table('audit_logs')->insert(array_map(fn ($i) => [
            'public_id' => strtolower((string) \Illuminate\Support\Str::ulid()), 'actor_role' => 'system', 'actor_name' => 'Bulk', 'action' => 'test.bulk', 'category' => 'general', 'severity' => 'info',
        ], range(1, 150)));
        $this->assertCount(100, $this->getJson('/api/audit-logs?per_page=100')->assertOk()->json('data'));
        $this->assertCount(50, $this->getJson('/api/audit-logs')->json('data'));
    }

    public function test_the_export_is_validated_filtered_bounded_and_says_when_it_was_cut(): void
    {
        $this->emit('billing.payment_recorded', 'financial');
        $this->emit('test.other', 'general');
        $csv = $this->get('/api/audit-logs/export?category=financial')->assertOk()
            ->assertHeader('X-Audit-Export-Truncated', 'false')->assertHeader('X-Audit-Export-Limit', '5000')->assertHeader('X-Content-Type-Options', 'nosniff');
        $content = $csv->streamedContent();
        $this->assertStringContainsString('billing.payment_recorded', $content);
        $this->assertStringNotContainsString('test.other', $content);
        $this->assertMatchesRegularExpression('/audit_trail_\d{8}_\d{6}\.csv/', $csv->headers->get('Content-Disposition'));
        $this->assertStringContainsString('+08:00', $content);

        $rows = array_map(fn ($i) => ['public_id' => strtolower((string) \Illuminate\Support\Str::ulid()), 'actor_role' => 'system', 'actor_name' => 'Bulk', 'action' => 'test.bulk', 'category' => 'general', 'severity' => 'info'], range(1, 5001));
        foreach (array_chunk($rows, 1000) as $chunk) {
            DB::table('audit_logs')->insert($chunk);
        }
        $big = $this->get('/api/audit-logs/export?action=test.bulk')->assertOk()->assertHeader('X-Audit-Export-Truncated', 'true');
        $this->assertCount(5001, array_filter(explode("\n", $big->streamedContent())), '5000 rows plus the header, never the whole history');
    }

    public function test_the_export_truncation_headers_are_exposed_to_the_cross_origin_spa(): void
    {
        $this->assertEqualsCanonicalizing(['X-Audit-Export-Limit', 'X-Audit-Export-Truncated'], config('cors.exposed_headers'));
        $origin = config('cors.allowed_origins')[0];
        $response = $this->withHeaders(['Origin' => $origin])->get('/api/audit-logs/export')->assertOk();
        $exposed = (string) $response->headers->get('Access-Control-Expose-Headers');
        $this->assertStringContainsString('X-Audit-Export-Truncated', $exposed);
    }
}
