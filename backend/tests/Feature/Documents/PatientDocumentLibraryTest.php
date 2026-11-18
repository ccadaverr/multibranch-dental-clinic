<?php

namespace Tests\Feature\Documents;

use App\Models\AuditLog;
use App\Models\Document;
use App\Services\Intake\Guardianship;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Tests\Feature\Appointments\SchedulingFixture;
use Tests\TestCase;

class PatientDocumentLibraryTest extends TestCase
{
    use RefreshDatabase, SchedulingFixture;

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpSchedulingWorld();
        Storage::fake('local');
    }

    public function test_optional_cursor_pages_are_complete_private_and_exactly_self_scoped(): void
    {
        $this->p['A']->person->update(['date_of_birth' => '1990-01-01']);
        $child = Guardianship::addDependent($this->p['A'], ['first_name' => 'Synthetic', 'last_name' => 'Child', 'date_of_birth' => '2015-01-01', 'relationship' => 'Child'], $this->u['patientA']);
        $rows = [];
        foreach (range(1, 103) as $n) {
            $rows[] = Document::create(['patient_id' => $n === 102 ? $child->id : ($n === 103 ? $this->p['B']->id : $this->p['A']->id),
                'category' => 'referral', 'title' => 'Synthetic library '.$n, 'original_filename' => 'synthetic.pdf', 'file_path' => 'synthetic/'.$n.'.pdf',
                'mime_type' => 'application/pdf', 'file_size_bytes' => 10, 'checksum_sha256' => str_repeat('a', 64), 'status' => 'Active', 'uploaded_by_user_id' => $this->u['patientA']->id]);
        }
        $this->actingAsUser('patientA');
        $legacy = $this->getJson('/api/documents/mine')->assertOk()->assertJsonCount(100, 'data');
        $this->assertArrayNotHasKey('meta', $legacy->json());
        $first = $this->getJson('/api/documents/mine?per_page=100')->assertOk()->assertJsonCount(100, 'data')->assertHeader('Cache-Control', 'no-store, private')
            ->assertJsonPath('meta.patient_id', $this->p['A']->public_id);
        $cursor = $first->json('meta.next_cursor');
        $this->assertSame($first->json('data.99.id'), $cursor);
        $last = $this->getJson('/api/documents/mine?per_page=100&cursor='.$cursor)->assertOk()->assertJsonCount(1, 'data')->assertJsonPath('meta.next_cursor', null);
        $all = array_merge($first->json('data'), $last->json('data'));
        $this->assertCount(101, array_unique(array_column($all, 'id')));
        foreach ($all as $row) {
            $this->assertSame($this->p['A']->public_id, $row['patient']['id']);
        }
        $this->getJson('/api/documents/mine?cursor='.$rows[102]->public_id)->assertUnprocessable();
        $this->getJson('/api/documents/mine?per_page=101')->assertUnprocessable();
        $this->getJson('/api/documents/mine?cursor=invalid')->assertUnprocessable();
        $this->actingAsUser('owner');
        $this->getJson('/api/documents/mine?per_page=100')->assertForbidden();
        $this->actingAsUser('dentist1');
        $this->getJson('/api/documents/mine?per_page=100')->assertForbidden();
    }

    public function test_download_confirms_identity_and_retry_does_not_duplicate_upload_or_retraction_evidence(): void
    {
        $content = "%PDF-1.4\n1 0 obj\n<< >>\nstream\nBT (Synthetic J03 file only) Tj ET\nendstream\nendobj\n%%EOF";
        $this->actingAsUser('patientA');
        $payload = ['file' => UploadedFile::fake()->createWithContent('synthetic.pdf', $content), 'category' => 'referral', 'title' => 'Synthetic test'];
        $key = ['Idempotency-Key' => 'j03-immutable-upload'];
        $a = $this->postJson('/api/documents', $payload, $key)->assertCreated()->json('data');
        $this->postJson('/api/documents', $payload, $key)->assertCreated()->assertJsonPath('data.id', $a['id']);
        $this->assertSame(1, Document::count());
        $this->postJson('/api/documents', array_merge($payload, ['title' => 'Changed intent']), $key)->assertConflict();
        $download = $this->get('/api/documents/'.$a['id'].'/download')->assertOk()->assertHeader('X-Document-Id', $a['id'])
            ->assertHeader('X-Patient-Id', $this->p['A']->public_id)->assertHeader('X-Content-Type-Options', 'nosniff');
        $this->assertSame($content, $download->streamedContent());
        $this->actingAsUser('patientB');
        $denied = $this->getJson('/api/documents/'.$a['id'].'/download')->assertNotFound();
        $missing = $this->getJson('/api/documents/01ARZ3NDEKTSV4RRFFQ69G5FAV/download')->assertNotFound();
        $this->assertSame($missing->json('message'), $denied->json('message'));
        $this->actingAsUser('patientA');
        $this->postJson('/api/documents/'.$a['id'].'/retract', ['reason' => 'Synthetic original reason'])->assertOk()->assertJsonPath('data.status', 'Retracted');
        $this->postJson('/api/documents/'.$a['id'].'/retract', ['reason' => 'Changed retry reason'])->assertUnprocessable()->assertJsonPath('code', 'already_retracted');
        $this->assertSame('Synthetic original reason', Document::sole()->retraction_reason);
        $this->assertSame(1, AuditLog::where('action', 'document.retracted')->count());
        Storage::disk('local')->assertExists(Document::sole()->file_path);
        $this->get('/api/documents/'.$a['id'].'/download')->assertGone();
        $this->app['auth']->forgetGuards();
        $this->actingAs($this->u['patientA']->fresh(), 'web');
        $this->getJson('/api/documents/mine?per_page=100')->assertOk();
        $this->u['patientA']->increment('auth_version');
        $this->getJson('/api/documents/mine?per_page=100')->assertForbidden()->assertJsonPath('code', 'session_revoked');
    }
}
