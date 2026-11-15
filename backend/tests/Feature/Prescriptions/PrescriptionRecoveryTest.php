<?php

namespace Tests\Feature\Prescriptions;

use App\Models\AuditLog;
use App\Models\CommandKey;
use App\Models\Prescription;
use App\Models\Visit;
use App\Services\Audit\AuditService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Mail;
use Tests\Feature\Appointments\SchedulingFixture;
use Tests\TestCase;

class PrescriptionRecoveryTest extends TestCase
{
    use RefreshDatabase,SchedulingFixture;

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpSchedulingWorld();
        Mail::fake();
        Http::preventStrayRequests();
    }

    private function visit(): Visit
    {
        return Visit::create(['patient_id' => $this->p['A']->id, 'branch_id' => $this->b['b1']->id, 'source' => 'walk_in', 'status' => 'Checked In', 'responsible_dentist_profile_id' => $this->d['d1']->id, 'requested_service_id' => $this->svc['svc1']->id, 'arrived_at' => now(), 'clinic_date' => '2026-09-28', 'revision' => 1, 'created_by_user_id' => $this->u['staffB1']->id, 'updated_by_user_id' => $this->u['staffB1']->id]);
    }

    private function draft(): array
    {
        $this->actingAsUser('dentist1');

        return $this->postJson('/api/prescriptions', ['visit_id' => $this->visit()->public_id, 'note' => 'Private synthetic note', 'lines' => [['medicine' => 'Private synthetic medicine', 'dosage' => 'Synthetic dose']]], ['Idempotency-Key' => 'rx-create'])->assertCreated()->json('data');
    }

    public function test_durable_encrypted_journal_replays_create_edit_issue_and_void_without_duplicate_effects(): void
    {
        $v = $this->visit();
        $this->actingAsUser('dentist1');
        $body = ['visit_id' => $v->public_id, 'note' => 'Private synthetic note', 'lines' => [['medicine' => 'Private synthetic medicine']]];
        $p = $this->postJson('/api/prescriptions', $body, ['Idempotency-Key' => 'create'])->assertCreated()->json('data');
        $this->postJson('/api/prescriptions', $body, ['Idempotency-Key' => 'create'])->assertCreated()->assertHeader('Idempotent-Replayed', 'true')->assertJsonPath('data.id', $p['id']);
        $edit = ['expected_revision' => 1, 'note' => 'Private synthetic edited note', 'lines' => [['medicine' => 'Private synthetic edited medicine']]];
        $this->putJson('/api/prescriptions/'.$p['id'], $edit, ['Idempotency-Key' => 'edit'])->assertOk()->assertJsonPath('data.revision', 2);
        $this->putJson('/api/prescriptions/'.$p['id'], $edit, ['Idempotency-Key' => 'edit'])->assertOk()->assertHeader('Idempotent-Replayed', 'true')->assertJsonPath('data.revision', 2);
        $issue = '/api/prescriptions/'.$p['id'].'/issue';
        $issued = $this->postJson($issue, ['expected_revision' => 2], ['Idempotency-Key' => 'issue'])->assertOk()->json('data');
        $this->postJson($issue, ['expected_revision' => 2], ['Idempotency-Key' => 'issue'])->assertOk()->assertHeader('Idempotent-Replayed', 'true')->assertJsonPath('data.number', $issued['number']);
        $this->postJson($issue, ['expected_revision' => 3], ['Idempotency-Key' => 'issue'])->assertUnprocessable()->assertJsonValidationErrors('idempotency_key');
        $void = '/api/prescriptions/'.$p['id'].'/void';
        $body = ['reason' => 'Synthetic correction', 'expected_revision' => 3];
        $this->postJson($void, ['reason' => 'Synthetic correction'])->assertUnprocessable()->assertJsonValidationErrors('expected_revision');
        $this->postJson($void, array_replace($body, ['expected_revision' => 2]), ['Idempotency-Key' => 'stale-void'])->assertUnprocessable()->assertJsonValidationErrors('expected_revision');
        $this->postJson($void, $body, ['Idempotency-Key' => 'void'])->assertOk()->assertJsonPath('data.status', 'Void');
        $this->postJson($void, $body, ['Idempotency-Key' => 'void'])->assertOk()->assertHeader('Idempotent-Replayed', 'true')->assertJsonPath('data.revision', 4);
        $this->postJson($void, array_replace($body, ['reason' => 'Different correction']), ['Idempotency-Key' => 'void'])->assertUnprocessable()->assertJsonValidationErrors('idempotency_key');
        $this->assertSame(1, Prescription::count());
        $this->assertSame(1, DB::table('prescription_counters')->value('last_number'));
        foreach (['created', 'issued', 'voided'] as $event) {
            $this->assertSame(1, AuditLog::where('action', 'prescription.'.$event)->count());
        }
        foreach (CommandKey::where('command', 'like', 'prescription.%')->get() as $key) {
            $raw = DB::table('command_keys')->where('id', $key->id)->value('response_body');
            $this->assertStringNotContainsString('Private synthetic', $raw);
            $this->assertArrayHasKey('encrypted_prescription_response', $key->response_body);
            $this->assertIsArray(json_decode(Crypt::decryptString($key->response_body['encrypted_prescription_response']), true));
        }
        $this->actingAsUser('patientA');
        $this->getJson('/api/me/prescriptions')->assertOk()->assertJsonPath('data.0.status', 'Void');
        $this->get('/api/prescriptions/'.$p['id'].'/pdf')->assertOk()->assertHeader('Cache-Control', 'no-store, private')->assertHeader('X-Content-Type-Options', 'nosniff');
    }

    public function test_colleague_issuance_records_actual_issuer_and_revoked_writer_cannot_replay_clinical_content(): void
    {
        $p = $this->draft();
        $this->actingAsUser('dentist2');
        $this->postJson('/api/prescriptions/'.$p['id'].'/issue', ['expected_revision' => 1], ['Idempotency-Key' => 'colleague'])->assertOk()->assertJsonPath('data.dentist', 'Dr. '.$this->u['dentist2']->person->fullName());
        $row = Prescription::sole();
        $this->assertSame($this->d['d2']->id, $row->dentist_profile_id);
        $this->assertSame($this->u['dentist2']->id, $row->issued_by_user_id);
        $this->assertSame($this->u['dentist1']->id, $row->created_by_user_id);
        $this->d['d2']->branches()->detach($this->b['b1']->id);
        $this->postJson('/api/prescriptions/'.$p['id'].'/issue', ['expected_revision' => 1], ['Idempotency-Key' => 'colleague'])->assertForbidden();
        $this->get('/api/prescriptions/'.$p['id'].'/pdf')->assertNotFound();
    }

    public function test_invalid_or_forged_input_never_creates_or_issues_evidence(): void
    {
        $v = $this->visit();
        $this->actingAsUser('dentist1');
        foreach (['', '   '] as $blank) {
            $this->postJson('/api/prescriptions', ['visit_id' => $v->public_id, 'lines' => [['medicine' => $blank]]], ['Idempotency-Key' => 'blank'])->assertUnprocessable()->assertJsonValidationErrors('lines.0.medicine');
        }
        $this->postJson('/api/prescriptions', ['visit_id' => $v->public_id, 'patient_id' => $this->p['B']->public_id, 'lines' => [['medicine' => 'Synthetic']]])->assertUnprocessable()->assertJsonValidationErrors('patient_id');
        $this->assertSame(0, Prescription::count());
    }

    public function test_a_changed_browser_session_context_refuses_issue_and_even_journal_replay(): void
    {
        $p=$this->draft();
        $context=$this->getJson('/api/me')->assertOk()->json('data.clinical_context');
        $this->assertIsString($context);$this->assertSame(64,strlen($context));
        // The HTTP test client must carry the browser cookie between requests.
        $this->withCredentials()->withCookie(config('session.cookie'), app('session')->getId());
        $path='/api/prescriptions/'.$p['id'].'/issue';
        $this->postJson($path,['expected_revision'=>1],['Idempotency-Key'=>'context-issue','X-Clinical-Context'=>str_repeat('0',64)])->assertConflict();
        $this->assertSame('Draft',Prescription::sole()->status);
        $this->postJson($path,['expected_revision'=>1],['Idempotency-Key'=>'context-issue','X-Clinical-Context'=>$context])->assertOk();
        $this->postJson($path,['expected_revision'=>1],['Idempotency-Key'=>'context-issue','X-Clinical-Context'=>str_repeat('0',64)])->assertConflict();
        $this->assertSame(1,AuditLog::where('action','prescription.issued')->count());
    }

    public function test_issue_audit_failure_rolls_back_counter_status_and_retry_journal_together(): void
    {
        $p = $this->draft();
        $real = app(AuditService::class);
        $this->mock(AuditService::class, function ($mock) use ($real) {
            $mock->shouldReceive('recordAdministrative')->andReturnUsing(function ($action, ...$args) use ($real) {
                if ($action === 'prescription.issued') {
                    throw new \RuntimeException('Synthetic audit failure');
                }

return $real->recordAdministrative($action, ...$args);
            });
        });
        $this->withoutExceptionHandling();
        try {
            $this->postJson('/api/prescriptions/'.$p['id'].'/issue', ['expected_revision' => 1], ['Idempotency-Key' => 'failed-issue']);
            $this->fail('Expected audit failure');
        } catch (\RuntimeException $e) {
            $this->assertSame('Synthetic audit failure', $e->getMessage());
        }
        $this->assertSame('Draft',Prescription::sole()->status);
        $this->assertNull(Prescription::sole()->number);
        $this->assertSame(0,DB::table('prescription_counters')->count());
        $this->assertSame(0,CommandKey::where('idempotency_key','failed-issue')->count());
    }
}
