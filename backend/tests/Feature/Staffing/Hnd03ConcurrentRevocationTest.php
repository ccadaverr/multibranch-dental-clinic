<?php

namespace Tests\Feature\Staffing;

use App\Models\AuditLog;
use App\Models\Document;
use App\Models\PatientHandover;
use App\Models\User;
use App\Services\Document\DocumentStorageService;
use Illuminate\Support\Facades\DB;
use Tests\Feature\Appointments\SchedulingFixture;
use Tests\Feature\Operations\OpsQa03SeparateConnectionHarness;
use Tests\TestCase;

require_once __DIR__.'/Hnd03CreationAuthorizationTest.php';
require_once __DIR__.'/../Operations/OpsQa03AdmissionRaceTest.php';

/** Deferred execution. Committed scratch fixtures and observed blocking, not timed simultaneous starts. */
class Hnd03ConcurrentRevocationTest extends TestCase
{
    use SchedulingFixture, Hnd03Fixture, OpsQa03SeparateConnectionHarness;

    protected function setUp(): void
    {
        parent::setUp();
        $this->prepareScratchWorld();
        $this->existing('A', 'd1', 'b1', 'svc1', '2026-09-21', '10:00', 30, 'Completed');
    }

    protected function tearDown(): void
    {
        try {
            $this->cleanScratchWorld();
        } finally {
            parent::tearDown();
        }
    }

    private function sendAfter(callable $blocker, callable $writer, array $payload = [], string $who = 'staffB1'): array
    {
        $spec = $this->requestSpec($who, '/api/handovers', $this->handoverPayload($payload));
        DB::beginTransaction();
        $blocker();
        $child = $this->launchRequest($spec);
        $this->awaitParentBlock($child);
        $writer();
        DB::commit();

        return $this->finishRequest($child);
    }

    public function test_scope_replacement_wins_before_creation_authorization_and_leaves_no_success(): void
    {
        $result = $this->sendAfter(
            fn () => User::whereKey($this->u['staffB1']->id)->lockForUpdate()->firstOrFail(),
            function () {
                $this->actingAsUser('owner');
                $this->putJson('/api/users/'.$this->u['staffB1']->public_id.'/branch-scopes', ['branch_refs' => []])->assertOk();
            });
        $this->assertSame(403, $result['status']);
        $this->assertNoSuccess();
        $this->assertSame(1, AuditLog::where('action', 'account.branch_scopes_changed')->count());
    }

    public function test_sending_dentist_membership_removal_is_observed_after_pivot_contention(): void
    {
        $result = $this->sendAfter(
            fn () => DB::table('dentist_branches')->where('dentist_profile_id', $this->d['d1']->id)->lockForUpdate()->get(),
            function () {
                $this->actingAsUser('owner');
                $this->patchJson('/api/dentists/d1', ['branch_ids' => ['b2']])->assertOk();
            }, who: 'dentist1');
        $this->assertSame(403, $result['status']);
        $this->assertNoSuccess();
    }

    public function test_receiving_dentist_removed_before_creation_is_refused(): void
    {
        $result = $this->sendAfter(
            fn () => DB::table('dentist_branches')->where('dentist_profile_id', $this->d['d3']->id)->lockForUpdate()->get(),
            function () {
                $this->actingAsUser('owner');
                $this->patchJson('/api/dentists/d3', ['branch_ids' => ['b1']])->assertOk();
            });
        $this->assertSame(422, $result['status']);
        $this->assertArrayHasKey('to_dentist_ref', $result['body']['errors']);
        $this->assertNoSuccess();
    }

    public function test_branch_closure_serializes_before_the_receiving_branch_check(): void
    {
        $result = $this->sendAfter(
            fn () => $this->b['b2']->newQuery()->whereKey($this->b['b2']->id)->lockForUpdate()->firstOrFail(),
            function () {
                $this->actingAsUser('owner');
                $this->patchJson('/api/branches/b2', ['status' => 'Closed'])->assertOk();
            });
        $this->assertSame(404, $result['status']);
        $this->assertNoSuccess();
    }

    public function test_document_retraction_committing_before_the_document_check_prevents_creation(): void
    {
        $document = $this->documentFixture();
        $result = $this->sendAfter(
            fn () => Document::whereKey($document->id)->lockForUpdate()->firstOrFail(),
            fn () => app(DocumentStorageService::class)->retract($this->u['staffB1'], $document, 'Synthetic retirement'),
            ['document_ids' => [$document->public_id]]);
        $this->assertSame(422, $result['status']);
        $this->assertArrayHasKey('document_ids', $result['body']['errors']);
        $this->assertNoSuccess();
    }

    public function test_scope_revocation_also_prevents_attachment_visibility_from_an_old_request(): void
    {
        $document = $this->documentFixture();
        $result = $this->sendAfter(
            fn () => User::whereKey($this->u['staffB1']->id)->lockForUpdate()->firstOrFail(),
            function () {
                $this->actingAsUser('owner');
                $this->putJson('/api/users/'.$this->u['staffB1']->public_id.'/branch-scopes', ['branch_refs' => ['b2']])->assertOk();
            }, ['document_ids' => [$document->public_id]]);
        $this->assertSame(403, $result['status']);
        $this->assertNoSuccess();
    }

    public function test_released_admin_boundary_allows_creation_and_later_revocation_preserves_history(): void
    {
        // This case proves wait/release and notification success, not simultaneous reverse-order replacement.
        $spec = $this->requestSpec('staffB1', '/api/handovers', $this->handoverPayload());
        DB::beginTransaction();
        User::whereKey($this->u['staffB1']->id)->lock('FOR NO KEY UPDATE')->firstOrFail();
        $child = $this->launchRequest($spec);
        $this->awaitParentBlock($child);
        // Roll back a no-change administrator blocker: waiting creation must finish normally, including afterCommit.
        DB::rollBack();
        $result = $this->finishRequest($child);
        $this->assertSame(201, $result['status']);
        $this->assertSame(1, PatientHandover::count());
        $this->assertSame(1, AuditLog::where('action', 'handover.created')->count());
        $this->assertSame(4, DB::table('user_notifications')->count());
        $this->actingAsUser('owner');
        $this->putJson('/api/users/'.$this->u['staffB1']->public_id.'/branch-scopes', ['branch_refs' => []])->assertOk();
        $this->assertSame(1, PatientHandover::count(), 'Subsequent scope revocation does not rewrite committed history.');
    }

    private function assertNoSuccess(): void
    {
        $this->assertSame(0, PatientHandover::count());
        $this->assertSame(0, AuditLog::where('action', 'handover.created')->count());
        $this->assertSame(0, DB::table('user_notifications')->whereIn('kind', ['handover_received', 'record_shared'])->count());
    }
}
