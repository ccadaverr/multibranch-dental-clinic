<?php

namespace Tests\Feature\Staffing;

use App\Models\AuditLog;
use App\Models\Document;
use App\Models\PatientHandover;
use App\Services\Audit\AuditService;
use App\Services\Notifications\NotificationCenter;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Mail;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\Feature\Appointments\SchedulingFixture;
use Tests\TestCase;

trait Hnd03Fixture
{
    protected function handoverPayload(array $extra = []): array
    {
        return $extra + ['patient_id' => $this->p['A']->public_id, 'from_branch_ref' => 'b1', 'to_branch_ref' => 'b2',
            'to_dentist_ref' => 'd3', 'summary' => 'HND03 private summary', 'notes' => 'HND03 private note'];
    }

    protected function documentFixture(array $extra = []): Document
    {
        return Document::create($extra + ['patient_id' => $this->p['A']->id, 'branch_id' => $this->b['b1']->id,
            'category' => 'other', 'title' => 'Synthetic reference', 'file_path' => 'synthetic/'.bin2hex(random_bytes(12)).'.pdf',
            'original_filename' => 'synthetic.pdf', 'mime_type' => 'application/pdf', 'file_size_bytes' => 12,
            'checksum_sha256' => str_repeat('a', 64), 'uploaded_by_user_id' => $this->u['staffB1']->id, 'status' => 'Active']);
    }
}

/** Source-authored only. Existing Hnd01/Hnd02 files remain unchanged and must run alongside this pack later. */
class Hnd03CreationAuthorizationTest extends TestCase
{
    use RefreshDatabase, SchedulingFixture, Hnd03Fixture;

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpSchedulingWorld();
        Mail::fake();
        Http::preventStrayRequests();
        $this->existing('A', 'd1', 'b1', 'svc1', '2026-09-21', '10:00', 30, 'Completed');
        $this->actingAsUser('staffB1');
    }

    private function send(array $extra = [])
    {
        return $this->postJson('/api/handovers', $this->handoverPayload($extra));
    }

    public function test_staff_and_treating_dentist_can_send_on_historical_care_evidence(): void
    {
        foreach (['staffB1', 'dentist1'] as $who) {
            $this->actingAsUser($who);
            $this->send()->assertCreated()->assertJsonPath('data.status', 'Sent');
        }
        $this->assertSame(2, PatientHandover::count());
        $this->assertSame(2, AuditLog::where('action', 'handover.created')->count());
        $this->assertSame(0, DB::table('visits')->count(), 'Historical care does not require an active Visit.');
    }

    public static function refusedSenders(): array
    {
        return [['staffB2'], ['staffNone'], ['dentist2'], ['owner'], ['patientA']];
    }

    #[DataProvider('refusedSenders')]
    public function test_unauthorized_senders_create_no_handover_or_success_audit(string $who): void
    {
        $this->actingAsUser($who);
        $this->send()->assertForbidden();
        $this->assertNoCreation();
    }

    public function test_revoked_memberships_closed_branch_and_no_care_evidence_are_refused(): void
    {
        $this->actingAsUser('dentist1');
        $this->d['d1']->branches()->detach($this->b['b1']->id);
        $this->send()->assertForbidden();
        $this->actingAsUser('staffB1');
        $this->d['d3']->branches()->detach($this->b['b2']->id);
        $this->send()->assertStatus(422)->assertJsonValidationErrors('to_dentist_ref');
        $this->b['b2']->update(['status' => 'Closed']);
        $this->send()->assertNotFound();
        $this->b['b2']->update(['status' => 'Open']);
        $this->send(['patient_id' => $this->p['B']->public_id])->assertForbidden();
        $this->assertNoCreation();
    }

    public function test_documents_require_active_owned_visible_records_and_duplicates_are_collapsed(): void
    {
        $active = $this->documentFixture();
        $retired = $this->documentFixture(['status' => 'Archived']);
        $foreign = $this->documentFixture(['patient_id' => $this->p['B']->id]);
        $hidden = $this->documentFixture(['branch_id' => $this->b['b2']->id]);
        foreach ([$retired->public_id, $foreign->public_id, $hidden->public_id, 'unknown'] as $id) {
            $this->send(['document_ids' => [$id]])->assertStatus(422)->assertJsonValidationErrors('document_ids');
        }
        $this->assertNoCreation();
        $this->send(['document_ids' => [$active->public_id, $active->public_id]])->assertCreated()
            ->assertJsonCount(1, 'data.documents')->assertJsonPath('data.documents.0.id', $active->public_id)
            ->assertJsonMissingPath('data.documents.0.file_path');
        $this->assertSame([$active->public_id], PatientHandover::sole()->document_ids);
    }

    public function test_owner_metadata_and_unrelated_dentist_content_isolation_remain_intact(): void
    {
        $id = $this->send()->assertCreated()->json('data.id');
        foreach (['staffB1', 'staffB2', 'dentist3'] as $who) {
            $this->actingAsUser($who);
            $this->getJson('/api/handovers/'.$id)->assertOk()->assertJsonPath('data.summary', 'HND03 private summary');
        }
        $this->actingAsUser('owner');
        $this->getJson('/api/handovers/'.$id)->assertOk()->assertJsonMissingPath('data.summary')->assertJsonMissingPath('data.notes')->assertJsonMissingPath('data.documents');
        $this->actingAsUser('dentist2');
        $this->getJson('/api/handovers/'.$id)->assertNotFound();
        $this->assertStringNotContainsString('HND03 private', AuditLog::all()->toJson());
    }

    public function test_audit_failure_rolls_back_creation_and_never_attempts_notifications(): void
    {
        $this->mock(NotificationCenter::class, function ($mock) {
            $mock->shouldNotReceive('staffNotice');
            $mock->shouldNotReceive('recordShared');
        });
        $this->app->bind(AuditService::class, fn () => new class extends AuditService {
            public function record(array $attributes): AuditLog
            {
                parent::record($attributes);
                throw new \RuntimeException('HND03 synthetic audit failure');
            }
        });
        $this->withoutExceptionHandling();
        try {
            $this->send();
            $this->fail('Expected audit rollback.');
        } catch (\RuntimeException $e) {
            $this->assertSame('HND03 synthetic audit failure', $e->getMessage());
        }
        $this->assertNoCreation();
    }

    private function assertNoCreation(): void
    {
        $this->assertSame(0, PatientHandover::count());
        $this->assertSame(0, AuditLog::where('action', 'handover.created')->count());
    }
}
