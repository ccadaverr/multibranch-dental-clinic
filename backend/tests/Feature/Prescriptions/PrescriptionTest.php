<?php

namespace Tests\Feature\Prescriptions;

use App\Models\AuditLog;
use App\Models\MailDispatch;
use App\Models\Prescription;
use App\Models\UserNotification;
use App\Models\Visit;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Mail;
use Tests\Feature\Appointments\SchedulingFixture;
use Tests\TestCase;

/** M19 Prescriptions, frozen at Monday 2026-09-28 10:00 Asia/Manila (SchedulingFixture: d1, d2 at b1; d3 at b2). */
class PrescriptionTest extends TestCase
{
    use RefreshDatabase, SchedulingFixture;

    private const MED = 'Amoxicillin 500 mg capsule';

    protected function setUp(): void
    {
        parent::setUp();
        Mail::fake();
        $this->setUpSchedulingWorld();
    }

    private function visit(string $patient = 'A', string $branch = 'b1'): Visit
    {
        return Visit::create(['patient_id' => $this->p[$patient]->id, 'branch_id' => $this->b[$branch]->id, 'source' => 'walk_in', 'status' => 'Checked In', 'responsible_dentist_profile_id' => $this->d['d1']->id,
            'requested_service_id' => $this->svc['svc1']->id, 'arrived_at' => '2026-09-28 09:00:00', 'clinic_date' => '2026-09-28', 'revision' => 1, 'created_by_user_id' => $this->u['staffB1']->id, 'updated_by_user_id' => $this->u['staffB1']->id]);
    }

    private function draft(Visit $visit, string $who = 'dentist1')
    {
        $this->actingAsUser($who);

        return $this->postJson('/api/prescriptions', ['visit_id' => $visit->public_id, 'note' => 'Take after meals', 'lines' => [
            ['medicine' => self::MED, 'dosage' => '1 capsule', 'frequency' => 'every 8 hours', 'duration' => '7 days', 'instructions' => 'Finish the course'],
            ['medicine' => 'Mefenamic acid 500 mg', 'frequency' => 'as needed for pain']]]);
    }

    public function test_real_prescription_quota_refuses_the_31st_request_without_writes_and_recovers_next_minute(): void
    {
        $visit = $this->visit();
        for ($i = 0; $i < 30; $i++) {
            $this->draft($visit)->assertCreated();
        }
        $before = [Prescription::count(), AuditLog::count(), DB::table('command_keys')->count()];
        $this->draft($visit)->assertStatus(429);
        $this->assertSame($before, [Prescription::count(), AuditLog::count(), DB::table('command_keys')->count()]);
        $this->assertSame(30, Prescription::where('visit_id', $visit->id)->where('status', 'Draft')->count());
        $this->travel(61)->seconds();
        $this->draft($visit)->assertCreated();
        $this->assertSame(31, Prescription::where('visit_id', $visit->id)->where('status', 'Draft')->count());
    }

    public function test_only_a_dentist_at_the_branch_writes_issues_and_voids(): void
    {
        $visit = $this->visit();
        foreach (['staffB1', 'owner', 'patientA', 'dentist3'] as $who) $this->draft($visit, $who)->assertForbidden();
        $p = $this->draft($visit, 'dentist2')->assertCreated()->assertJsonPath('data.status', 'Draft'); // another dentist at that branch
        $this->actingAsUser('dentist3');
        $this->postJson("/api/prescriptions/{$p->json('data.id')}/issue", ['expected_revision' => 1])->assertForbidden();
        $this->actingAsUser('dentist1');
        $this->postJson("/api/prescriptions/{$p->json('data.id')}/issue", ['expected_revision' => 1])->assertOk()
            ->assertJsonPath('data.status', 'Issued')->assertJsonPath('data.number', 'RX-2026-000001');
    }

    public function test_exact_visit_filter_preserves_patient_branch_and_role_boundaries(): void
    {
        $firstVisit = $this->visit();
        $first = $this->draft($firstVisit)->assertCreated()->json('data.id');
        $this->postJson("/api/prescriptions/$first/issue", ['expected_revision' => 1])->assertOk();
        $otherVisit = $this->visit('B');
        $other = $this->draft($otherVisit)->assertCreated()->json('data.id');
        $this->postJson("/api/prescriptions/$other/issue", ['expected_revision' => 1])->assertOk();
        $draft = $this->draft($firstVisit)->assertCreated()->json('data.id');
        $path = '/api/prescriptions?patient_id='.$this->p['A']->public_id.'&visit_id='.$firstVisit->public_id;
        $before = [Prescription::count(), AuditLog::count(), DB::table('command_keys')->count()];

        $this->assertSame([$draft, $first], array_column($this->getJson($path)->assertOk()->assertHeader('Cache-Control', 'no-store, private')->json('data'), 'id'));
        $this->getJson("/api/prescriptions/$first")->assertOk()->assertHeader('Cache-Control', 'no-store, private')->assertJsonPath('data.branch_id', 'b1')
            ->assertJsonPath('data.visit', $firstVisit->public_id)->assertJsonPath('data.patient.id', $this->p['A']->public_id);
        $this->getJson('/api/prescriptions?visit_id='.$otherVisit->public_id)->assertOk()->assertJsonCount(1, 'data')->assertJsonPath('data.0.id', $other);
        $this->getJson($path.'&status=Issued')->assertOk()->assertJsonCount(1, 'data')->assertJsonPath('data.0.id', $first);
        $this->getJson('/api/prescriptions?patient_id='.$this->p['B']->public_id.'&visit_id='.$firstVisit->public_id)->assertOk()->assertJsonCount(0, 'data');
        $this->getJson('/api/prescriptions?visit_id=unknown-visit')->assertOk()->assertJsonCount(0, 'data');
        $this->getJson('/api/prescriptions?visit_id[]=invalid')->assertUnprocessable();

        $this->actingAsUser('staffB1');
        $this->getJson($path)->assertOk()->assertJsonCount(1, 'data')->assertJsonPath('data.0.id', $first)->assertJsonPath('data.0.branch_id', 'b1');
        $this->actingAsUser('staffB2');
        $this->getJson($path)->assertOk()->assertJsonCount(0, 'data');
        $this->actingAsUser('dentist3');
        $this->getJson($path)->assertOk()->assertJsonCount(0, 'data');
        $this->actingAsUser('patientA');
        $this->getJson($path)->assertForbidden();
        $this->actingAsUser('owner');
        $meta = $this->getJson($path)->assertOk()->assertJsonCount(1, 'data')->json('data.0');
        foreach (['patient', 'visit', 'branch_id', 'lines', 'note'] as $private) $this->assertArrayNotHasKey($private, $meta);
        $this->assertSame($before, [Prescription::count(), AuditLog::count(), DB::table('command_keys')->count()]);
    }

    public function test_issuing_locks_it_a_void_keeps_its_history_and_numbers_continue(): void
    {
        $visit = $this->visit();
        $id = $this->draft($visit)->json('data.id');
        $this->putJson("/api/prescriptions/$id", ['expected_revision' => 1, 'lines' => [['medicine' => 'Paracetamol 500 mg']]])->assertOk(); // drafts can change
        $this->postJson("/api/prescriptions/$id/issue", ['expected_revision' => 2])->assertOk();
        $this->putJson("/api/prescriptions/$id", ['expected_revision' => 3, 'lines' => [['medicine' => 'Something else']]])->assertStatus(422);
        // Even the database refuses: the lines and the issued prescription are append-only.
        foreach ([fn () => DB::table('prescription_lines')->update(['dosage' => 'changed']), fn () => Prescription::whereKey(Prescription::first()->id)->update(['note' => 'changed'])] as $change) {
            try { DB::transaction($change); $this->fail('an issued prescription changed'); } catch (\Illuminate\Database\QueryException) {} // a savepoint keeps the test transaction usable
        }

        $this->postJson("/api/prescriptions/$id/void", ['reason' => 'Wrong dose', 'expected_revision' => 3])->assertOk()->assertJsonPath('data.status', 'Void')->assertJsonPath('data.voided.reason', 'Wrong dose');
        $this->postJson("/api/prescriptions/$id/void", ['reason' => 'Again', 'expected_revision' => 4])->assertStatus(422);
        $second = $this->draft($visit)->json('data.id');
        $this->postJson("/api/prescriptions/$second/issue", ['expected_revision' => 1])->assertOk()->assertJsonPath('data.number', 'RX-2026-000002');
        $this->assertSame(['Void', 'Issued'], Prescription::orderBy('id')->pluck('status')->all()); // the void one stays
        $this->assertTrue(AuditLog::where('action', 'prescription.voided')->exists());
        $this->expectException(\Illuminate\Database\QueryException::class);
        Prescription::query()->delete();
    }

    public function test_patient_sees_only_their_own_owner_metadata_front_desk_views_and_prints_and_nothing_leaks(): void
    {
        $id = $this->draft($this->visit('A'))->json('data.id');
        $this->actingAsUser('patientA');
        $this->assertSame([], $this->getJson('/api/me/prescriptions')->assertOk()->json('data')); // drafts are not shown
        $this->actingAsUser('dentist1');
        $this->postJson("/api/prescriptions/$id/issue", ['expected_revision' => 1])->assertOk();
        $otherId = $this->draft($this->visit('B'))->json('data.id');
        $this->postJson("/api/prescriptions/$otherId/issue", ['expected_revision' => 1])->assertOk();

        $this->actingAsUser('patientA');
        $mine = $this->getJson('/api/me/prescriptions')->assertOk();
        $this->assertSame([$id], array_column($mine->json('data'), 'id'));
        $this->assertSame(self::MED, $mine->json('data.0.lines.0.medicine'));
        $this->get("/api/prescriptions/$otherId/pdf")->assertNotFound();
        $pdf = $this->get("/api/prescriptions/$id/pdf")->assertOk();
        $this->assertSame('application/pdf', $pdf->headers->get('Content-Type'));

        $this->actingAsUser('owner');
        $meta = $this->getJson('/api/prescriptions')->assertOk();
        $this->assertSame(['id', 'number', 'status', 'issued_at', 'date', 'branch', 'dentist', 'revision'], array_keys($meta->json('data.0')));
        $this->assertStringNotContainsString('Amoxicillin', $this->getJson("/api/prescriptions/$id")->assertOk()->getContent());
        $this->get("/api/prescriptions/$id/pdf")->assertForbidden();

        $this->actingAsUser('staffB1');
        $this->getJson("/api/prescriptions/$id")->assertOk()->assertJsonPath('data.lines.0.medicine', self::MED);
        $this->get("/api/prescriptions/$id/pdf")->assertOk();
        $this->putJson("/api/prescriptions/$id", ['expected_revision' => 2, 'lines' => [['medicine' => 'x']]])->assertForbidden();
        $this->actingAsUser('staffB2');
        $this->getJson("/api/prescriptions/$id")->assertNotFound();

        // The patient is told, without the medicine; audit, notices and emails hold no medicine text.
        $this->assertTrue(UserNotification::where('user_id', $this->u['patientA']->id)->where('kind', 'prescription_ready')->exists());
        $this->assertTrue(MailDispatch::where('purpose', 'prescription_ready')->exists());
        $mail = (new \App\Mail\PrescriptionReadyMail('Ana'))->render();
        $haystack = AuditLog::where('action', 'like', 'prescription.%')->get()->toJson().UserNotification::all()->toJson().$mail.MailDispatch::all()->toJson();
        foreach (['Amoxicillin', 'Mefenamic', 'capsule', 'Take after meals', 'Finish the course'] as $text) $this->assertStringNotContainsString($text, $haystack);
        $this->assertSame(['prescription.created', 'prescription.issued', 'prescription.downloaded', 'prescription.viewed', 'prescription.downloaded'],
            AuditLog::where('action', 'like', 'prescription.%')->where('payload->prescription', $id)->orderBy('id')->pluck('action')->all());
        $this->assertNotSame(self::MED, DB::table('prescription_lines')->value('medicine')); // encrypted at rest
    }

    public function test_the_license_number_is_never_prefilled_and_appears_only_once_the_dentist_entered_it(): void
    {
        $visit = $this->visit();
        $this->actingAsUser('dentist1');
        $this->assertNull($this->getJson('/api/prescriptions/visits')->assertOk()->json('meta.license_no'));
        $this->assertSame('No allergies are recorded in the clinic system. Ask the patient before prescribing.', $this->getJson('/api/prescriptions/visits')->json('meta.allergy_notice'));
        $id = $this->draft($visit)->json('data.id');
        $this->postJson("/api/prescriptions/$id/issue", ['expected_revision' => 1])->assertOk()->assertJsonPath('data.license_no', null);
        $this->putJson('/api/me/prescription-license', ['rx_license_no' => '0123456'])->assertOk();
        $second = $this->draft($visit)->json('data.id');
        $this->postJson("/api/prescriptions/$second/issue", ['expected_revision' => 1])->assertOk()->assertJsonPath('data.license_no', '0123456');
    }

    public function test_custom_line_values_survive_draft_creation_retrieval_and_editing(): void
    {
        $visit = $this->visit();
        $this->actingAsUser('dentist1');
        $line = ['medicine' => 'Acceptance compound', 'dosage' => 'Test 5 units', 'frequency' => 'Test once weekly',
            'duration' => 'Test 2 weeks', 'instructions' => 'Test instruction'];

        $created = $this->postJson('/api/prescriptions', ['visit_id' => $visit->public_id, 'lines' => [$line]])
            ->assertCreated()->assertJsonPath('data.status', 'Draft');
        $id = $created->json('data.id');
        foreach ($line as $field => $value) {
            $this->assertSame($value, $created->json("data.lines.0.$field"));
        }

        $retrieved = $this->getJson("/api/prescriptions/$id")->assertOk();
        foreach ($line as $field => $value) {
            $this->assertSame($value, $retrieved->json("data.lines.0.$field"));
        }

        $edited = [...$line, 'dosage' => 'Test 6 units'];
        $this->putJson("/api/prescriptions/$id", ['expected_revision' => 1, 'lines' => [$edited]])
            ->assertOk()->assertJsonPath('data.revision', 2);
        $reopened = $this->getJson("/api/prescriptions/$id")->assertOk();
        foreach ($edited as $field => $value) {
            $this->assertSame($value, $reopened->json("data.lines.0.$field"));
        }
    }
}
