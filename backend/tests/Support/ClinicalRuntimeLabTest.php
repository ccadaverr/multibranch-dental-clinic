<?php

namespace Tests\Support;

use App\Models\Appointment;
use App\Models\Document;
use App\Models\MailDispatch;
use App\Models\Patient;
use App\Models\User;
use App\Models\Visit;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\DB;
use Tests\Feature\Appointments\SchedulingFixture;
use Tests\Support\IsolatedDatabaseGuard;
use Tests\TestCase;

/** Commits deliberately, exclusively in a newly cloned, explicitly marked disposable lab. No RefreshDatabase/reset. */
final class ClinicalRuntimeLabTest extends TestCase
{
    use SchedulingFixture;

    private string $runtime;

    protected function setUp(): void
    {
        parent::setUp();
        IsolatedDatabaseGuard::assertSafe($this->app);
        $target = IsolatedDatabaseGuard::manifest();
        $this->runtime = $target['runtime'];
        if (! str_starts_with(basename($this->runtime), 'contention-')
            || ! is_file($this->runtime.'/clinical-runtime-lab')
            || getenv('DENTALOPS_RUNTIME_LAB') !== $target['cluster_id']
            || config('filesystems.disks.local.root') !== $this->runtime.'/storage/app/private'
            || config('queue.default') !== 'database' || config('mail.default') !== 'local_capture') {
            throw new \RuntimeException('Use the disposable clinical-runtime-lab runner only.');
        }
    }

    public function test_prepare_committed_fixture(): void
    {
        $this->assertSame(0, Patient::count(), 'Refuse a clone containing existing Patient fixtures.');
        $this->assertSame(0, DB::table('jobs')->count());
        $this->assertSame(0, MailDispatch::count());
        $this->setUpSchedulingWorld();
        $this->u['patientA']->update(['email' => 'runtime-lab@example.test']);
        $this->p['A']->person->update(['email' => 'runtime-lab@example.test']);
        $this->actingAsUser('patientA');
        $id = $this->postJson('/api/appointments', ['branch_ref' => 'b1', 'service_ref' => 'svc1', 'date' => '2026-09-30', 'start_time' => '14:00'])
            ->assertCreated()->json('data.id');
        $appointment = Appointment::where('public_id', $id)->sole();
        $this->actingAsUser('staffB1');
        $visitId = $this->postJson('/api/visits/walk-in', ['patient_id' => $this->p['A']->public_id, 'branch_ref' => 'b1', 'service_ref' => 'svc1', 'dentist_ref' => 'd1'],
            ['Idempotency-Key' => 'runtime-lab-walkin'])->assertCreated()->json('data.id');
        $visit = Visit::where('public_id', $visitId)->sole();
        $pdf = "%PDF-1.4\n1 0 obj\n<< >>\nstream\nBT (Synthetic private restore witness) Tj ET\nendstream\nendobj\n%%EOF";
        $this->postJson('/api/documents', ['patient_id' => $this->p['A']->public_id, 'branch_id' => 'b1', 'visit_id' => $visitId,
            'category' => 'other', 'file' => UploadedFile::fake()->createWithContent('synthetic.pdf', $pdf)], ['Idempotency-Key' => 'runtime-lab-document'])
            ->assertCreated();
        $document = Document::sole();
        $this->assertSame([$this->p['A']->id, $this->b['b1']->id, $visit->id], [$document->patient_id, $document->branch_id, $document->visit_id]);
        $this->assertSame(hash('sha256', $pdf), $document->checksum_sha256);
        $this->assertSame(1, DB::table('jobs')->count());
        $this->assertSame(['pending', 0], [MailDispatch::sole()->status, MailDispatch::sole()->attempts]);
        $fixture = ['patient' => $this->p['A']->fresh()->getAttributes(), 'branch' => $this->b['b1']->fresh()->getAttributes(),
            'appointment' => $appointment->fresh()->getAttributes(), 'visit' => $visit->fresh()->getAttributes(), 'document' => $document->fresh()->getAttributes(),
            'users' => array_map(fn ($user) => $user->id, $this->u),
            'encrypted_witness' => Crypt::encryptString('Synthetic APP_KEY restore witness'),
            'financial_counts' => [DB::table('invoices')->count(), DB::table('payments')->count(), DB::table('receipts')->count()]];
        file_put_contents($this->runtime.'/clinical-fixture.json', json_encode($fixture, JSON_THROW_ON_ERROR));
        chmod($this->runtime.'/clinical-fixture.json', 0600);
    }

    public function test_restored_identifiers_bytes_key_and_access_boundaries(): void
    {
        $f = json_decode(file_get_contents($this->runtime.'/clinical-fixture.json'), true, flags: JSON_THROW_ON_ERROR);
        foreach (['patient' => Patient::class, 'branch' => \App\Models\Branch::class, 'appointment' => Appointment::class,
            'visit' => Visit::class, 'document' => Document::class] as $key => $model) {
            $expected = $f[$key];
            $actual = $model::findOrFail($f[$key]['id'])->getAttributes();
            ksort($expected); ksort($actual);
            $this->assertSame($expected, $actual, $key.' identifiers and state survive restore');
        }
        $this->assertSame('Synthetic APP_KEY restore witness', Crypt::decryptString($f['encrypted_witness']));
        $this->u = array_map(fn ($id) => User::findOrFail($id), $f['users']);
        $path = '/api/documents/'.$f['document']['public_id'].'/download';
        foreach (['patientA', 'staffB1', 'dentist1'] as $key) {
            $this->actingAsUser($key);
            $response = $this->get($path)->assertOk();
            $this->assertSame($f['document']['checksum_sha256'], hash('sha256', $response->streamedContent()));
            $this->assertStringContainsString('private', $response->headers->get('Cache-Control'));
            $this->assertStringContainsString('no-store', $response->headers->get('Cache-Control'));
        }
        foreach (['patientB', 'staffB2', 'dentist3', 'owner'] as $key) {
            $this->actingAsUser($key);
            $this->getJson($path)->assertForbidden();
        }
        $this->actingAsUser('staffB1');
        \App\Models\UserBranchScope::where('user_id', $f['users']['staffB1'])->update(['branch_id' => \App\Models\Branch::where('legacy_ref', 'b2')->sole()->id]);
        $this->getJson($path)->assertForbidden();
        $this->assertSame($f['financial_counts'], [DB::table('invoices')->count(), DB::table('payments')->count(), DB::table('receipts')->count()]);
        $this->assertSame('logged_only', MailDispatch::sole()->status);
        $this->assertNull(MailDispatch::sole()->delivery_confirmed_at);
    }
}
