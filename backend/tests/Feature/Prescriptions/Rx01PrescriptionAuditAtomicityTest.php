<?php

namespace Tests\Feature\Prescriptions;

use App\Jobs\SendMailDispatch;
use App\Mail\PrescriptionReadyMail;
use App\Models\AuditLog;
use App\Models\MailDispatch;
use App\Models\Patient;
use App\Models\Person;
use App\Models\Prescription;
use App\Models\PrescriptionLine;
use App\Models\UserNotification;
use App\Models\Visit;
use App\Services\Audit\AuditService;
use App\Services\Intake\Guardianship;
use App\Services\Mail\MailOutbox;
use App\Services\Notifications\NotificationCenter;
use App\Support\ClinicClock;
use Closure;
use Illuminate\Foundation\Testing\DatabaseMigrations;
use Illuminate\Support\Facades\Bus;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Mail;
use RuntimeException;
use Tests\Feature\Appointments\SchedulingFixture;
use Tests\TestCase;

/**
 * RX-01: authored only. Inherits the existing local PostgreSQL scratch guard.
 * DatabaseMigrations supplies committed fixtures for after-commit assertions
 * and separate-process races. Requires exclusive use of the disposable DB.
 * No providers: parent mail/jobs are faked; race patients have no recipient.
 * PostgreSQL races additionally require approved RX01_RUN_CONCURRENCY=1.
 */
class Rx01PrescriptionAuditAtomicityTest extends TestCase
{
    use DatabaseMigrations, SchedulingFixture;

    private const MEDICINE = 'Synthetic medicine RX01';

    protected function setUp(): void
    {
        parent::setUp();
        Mail::fake();
        Bus::fake([SendMailDispatch::class]);
        $this->setUpSchedulingWorld();
        $this->d['d1']->update(['rx_license_no' => 'SYNTHETIC-RX01']);
    }

    private function visit(?Patient $patient = null): Visit
    {
        return Visit::create(['patient_id' => ($patient ?? $this->p['A'])->id, 'branch_id' => $this->b['b1']->id,
            'source' => 'walk_in', 'status' => 'Checked In', 'responsible_dentist_profile_id' => $this->d['d1']->id,
            'requested_service_id' => $this->svc['svc1']->id, 'arrived_at' => now(), 'clinic_date' => ClinicClock::today(),
            'revision' => 1, 'created_by_user_id' => $this->u['staffB1']->id, 'updated_by_user_id' => $this->u['staffB1']->id]);
    }

    private function lines(): array
    {
        return [['medicine' => self::MEDICINE, 'dosage' => 'Synthetic dosage', 'frequency' => 'Synthetic frequency',
            'duration' => 'Synthetic duration', 'instructions' => 'Synthetic instruction'], ['medicine' => 'Synthetic second medicine']];
    }

    private function draft(?Visit $visit = null): Prescription
    {
        $visit ??= $this->visit();
        $this->actingAsUser('dentist1');
        $id = $this->postJson('/api/prescriptions', ['visit_id' => $visit->public_id, 'lines' => $this->lines(), 'note' => 'Synthetic private note'])
            ->assertCreated()->assertJsonPath('data.revision', 1)->json('data.id');

        return Prescription::where('public_id', $id)->sole();
    }

    /** Direct fixtures only for corrupt/line-less Draft and committed race setup. */
    private function directDraft(Visit $visit, bool $withLine = true): Prescription
    {
        $p = Prescription::create(['visit_id' => $visit->id, 'patient_id' => $visit->patient_id, 'branch_id' => $visit->branch_id,
            'dentist_profile_id' => $this->d['d1']->id, 'created_by_user_id' => $this->u['dentist1']->id, 'status' => 'Draft']);
        if ($withLine) $p->lines()->create(['line_no' => 1, 'medicine' => self::MEDICINE]);

        return $p->fresh();
    }

    private function logs(string $action, ?Prescription $p = null)
    {
        return AuditLog::where('action', $action)->when($p, fn ($q) => $q->where('payload->prescription', $p->public_id));
    }

    private function assertAudit(string $action, Prescription $p): void
    {
        $log = $this->logs($action, $p)->sole();
        $this->assertSame($p->patient->public_id, $log->auditable_public_id);
        $this->assertSame('Patient', $log->auditable_type);
        $this->assertSame($this->u['dentist1']->id, $log->actor_user_id);
        $this->assertEquals(['prescription' => $p->public_id, 'number' => $p->number, 'branch' => $p->branch->legacy_ref,
            'status' => $p->status, 'lines' => $p->lines()->count()], $log->payload);
    }

    private function failingAudit(string $action, bool $afterInsert = false): void
    {
        $this->app->bind(AuditService::class, fn () => new class($action, $afterInsert) extends AuditService {
            public function __construct(private string $action, private bool $afterInsert) {}

            public function record(array $attributes): AuditLog
            {
                if ($attributes['action'] !== $this->action) return parent::record($attributes);
                if ($this->afterInsert) parent::record($attributes);
                throw new RuntimeException('Synthetic prescription audit failure');
            }
        });
    }

    private function assertFailure(Closure $command, string $message): void
    {
        $this->withoutExceptionHandling();
        try {
            $command();
            $this->fail('The required failure must propagate.');
        } catch (RuntimeException $e) {
            $this->assertSame($message, $e->getMessage());
        } finally {
            $this->withExceptionHandling();
        }
    }

    private function readyCounts(): array
    {
        return [UserNotification::where('kind', 'prescription_ready')->count(), MailDispatch::where('purpose', 'prescription_ready')->count()];
    }

    public function test_draft_creation_commits_lines_identity_order_and_required_audit(): void
    {
        $visit = $this->visit();
        $p = $this->draft($visit);
        $this->assertSame([$visit->id, $visit->patient_id, $visit->branch_id, 'Draft', 1], [$p->visit_id, $p->patient_id, $p->branch_id, $p->status, $p->revision]);
        $this->assertSame([1, 2], $p->lines->pluck('line_no')->all());
        $this->assertSame([self::MEDICINE, 'Synthetic second medicine'], $p->lines->pluck('medicine')->all());
        $this->assertSame('Synthetic dosage', $p->lines->first()->dosage);
        $this->assertAudit('prescription.created', $p);
        $this->assertNull($p->number);
        $this->assertSame([0, 0], $this->readyCounts());
    }

    public function test_line_insertion_failure_rolls_back_the_prescription_and_earlier_line(): void
    {
        $visit = $this->visit();
        $this->actingAsUser('dentist1');
        $originalEvents = PrescriptionLine::getEventDispatcher();
        PrescriptionLine::setEventDispatcher(clone $originalEvents);
        try {
            PrescriptionLine::creating(function (PrescriptionLine $line) {
                if ($line->line_no === 2) throw new RuntimeException('Synthetic line insertion failure');
            });
            $this->assertFailure(fn () => $this->postJson('/api/prescriptions', ['visit_id' => $visit->public_id, 'lines' => $this->lines()]), 'Synthetic line insertion failure');
        } finally {
            PrescriptionLine::setEventDispatcher($originalEvents);
        }
        $this->assertSame(0, Prescription::count());
        $this->assertSame(0, PrescriptionLine::count());
        $this->assertSame(0, $this->logs('prescription.created')->count());
    }

    public function test_creation_audit_failure_before_or_after_insert_leaves_no_partial_draft(): void
    {
        $visit = $this->visit();
        $this->actingAsUser('dentist1');
        foreach ([false, true] as $afterInsert) {
            $this->failingAudit('prescription.created', $afterInsert);
            $this->assertFailure(fn () => $this->postJson('/api/prescriptions', ['visit_id' => $visit->public_id, 'lines' => $this->lines()]), 'Synthetic prescription audit failure');
            $this->assertSame(0, Prescription::count());
            $this->assertSame(0, PrescriptionLine::count());
            $this->assertSame(0, $this->logs('prescription.created')->count());
        }
    }

    public function test_issuance_allocates_one_number_and_exactly_one_required_audit(): void
    {
        $p = $this->draft();
        $this->postJson("/api/prescriptions/{$p->public_id}/issue", ['expected_revision' => 1])->assertOk()
            ->assertJsonPath('data.status', 'Issued')->assertJsonPath('data.number', 'RX-2026-000001')->assertJsonPath('data.revision', 2)
            ->assertJsonPath('data.license_no', 'SYNTHETIC-RX01');
        $this->assertAudit('prescription.issued', $p->fresh());
        $this->assertSame(1, (int) DB::table('prescription_counters')->where('year', 2026)->value('last_number'));
        $this->assertSame([1, 1], $this->readyCounts());
        Bus::assertDispatched(SendMailDispatch::class, 1);
        Mail::assertNothingSent(); // A queued intent is not delivery.
    }

    public function test_issue_audit_failure_restores_existing_counter_and_all_clinical_fields(): void
    {
        $p = $this->draft();
        $before = $p->getRawOriginal();
        $lines = $p->lines()->get()->map->getRawOriginal()->all();
        DB::table('prescription_counters')->insert(['year' => 2026, 'last_number' => 7]);
        foreach ([false, true] as $afterInsert) {
            $this->failingAudit('prescription.issued', $afterInsert);
            $this->assertFailure(fn () => $this->postJson("/api/prescriptions/{$p->public_id}/issue", ['expected_revision' => 1]), 'Synthetic prescription audit failure');
            $this->assertSame($before, $p->fresh()->getRawOriginal());
            $this->assertSame($lines, $p->lines()->get()->map->getRawOriginal()->all());
            $this->assertSame(7, (int) DB::table('prescription_counters')->where('year', 2026)->value('last_number'));
            $this->assertSame(0, $this->logs('prescription.issued')->count());
            $this->assertSame([0, 0], $this->readyCounts());
            Bus::assertNotDispatched(SendMailDispatch::class);
        }
        $this->app->bind(AuditService::class, fn () => new AuditService);
        $this->postJson("/api/prescriptions/{$p->public_id}/issue", ['expected_revision' => 1])->assertOk()->assertJsonPath('data.number', 'RX-2026-000008');
        $this->assertAudit('prescription.issued', $p->fresh());
    }

    public function test_failed_first_issue_rolls_back_the_new_counter_row(): void
    {
        $p = $this->draft();
        $this->failingAudit('prescription.issued', true);
        $this->assertFailure(fn () => $this->postJson("/api/prescriptions/{$p->public_id}/issue", ['expected_revision' => 1]), 'Synthetic prescription audit failure');
        $this->assertSame(0, DB::table('prescription_counters')->count());
        $this->assertSame('Draft', $p->fresh()->status);
        $this->assertSame([0, 0], $this->readyCounts());
    }

    public function test_outer_rollback_discards_issuance_and_notices_then_commit_sends_once(): void
    {
        $p = $this->draft();
        DB::beginTransaction();
        try {
            $this->postJson("/api/prescriptions/{$p->public_id}/issue", ['expected_revision' => 1])->assertOk();
            $this->assertSame([0, 0], $this->readyCounts());
            Bus::assertNotDispatched(SendMailDispatch::class);
        } finally {
            DB::rollBack();
        }
        $this->assertSame('Draft', $p->fresh()->status);
        $this->assertSame(0, $this->logs('prescription.issued')->count());
        $this->assertSame(0, DB::table('prescription_counters')->count());
        $this->assertSame([0, 0], $this->readyCounts());
        DB::beginTransaction();
        try {
            $this->postJson("/api/prescriptions/{$p->public_id}/issue", ['expected_revision' => 1])->assertOk()->assertJsonPath('data.number', 'RX-2026-000001');
            $this->assertSame([0, 0], $this->readyCounts());
            DB::commit();
        } finally {
            if (DB::transactionLevel() > 0) DB::rollBack();
        }
        $this->assertSame([1, 1], $this->readyCounts());
        $this->assertAudit('prescription.issued', $p->fresh());
    }

    public function test_notice_and_mail_attempt_observe_committed_issuance_and_audit(): void
    {
        $p = $this->draft();
        $notice = app(NotificationCenter::class);
        $mail = app(MailOutbox::class);
        $check = function () use ($p) {
            $this->assertSame(0, DB::transactionLevel());
            $this->assertSame('Issued', $p->fresh()->status);
            $this->assertSame(1, $this->logs('prescription.issued', $p)->count());
        };
        $this->mock(NotificationCenter::class)->shouldReceive('staffNotice')->once()->andReturnUsing(function (...$args) use ($check, $notice) {
            $check();
            $notice->staffNotice(...$args);
        });
        $this->mock(MailOutbox::class)->shouldReceive('queue')->once()->andReturnUsing(function (...$args) use ($check, $mail) {
            $check();

            return $mail->queue(...$args);
        });
        $this->postJson("/api/prescriptions/{$p->public_id}/issue", ['expected_revision' => 1])->assertOk();
    }

    public function test_mail_attempt_failure_does_not_undo_an_audited_issuance(): void
    {
        $p = $this->draft();
        $this->mock(MailOutbox::class)->shouldReceive('queue')->once()->andThrow(new RuntimeException('Synthetic mail queue failure'));
        $this->postJson("/api/prescriptions/{$p->public_id}/issue", ['expected_revision' => 1])->assertOk()->assertJsonPath('data.status', 'Issued');
        $this->assertAudit('prescription.issued', $p->fresh());
        $this->assertSame([1, 0], $this->readyCounts());
    }

    public function test_stale_revision_and_line_less_draft_are_rejected_without_number_or_audit(): void
    {
        $p = $this->draft();
        $this->putJson("/api/prescriptions/{$p->public_id}", ['expected_revision' => 1, 'lines' => $this->lines()])->assertOk()->assertJsonPath('data.revision', 2);
        $before = $p->fresh()->getRawOriginal();
        $this->postJson("/api/prescriptions/{$p->public_id}/issue", ['expected_revision' => 1])->assertStatus(422)->assertJsonValidationErrors('expected_revision');
        $this->assertSame($before, $p->fresh()->getRawOriginal());
        $empty = $this->directDraft($this->visit(), false);
        $this->postJson("/api/prescriptions/{$empty->public_id}/issue", ['expected_revision' => 1])->assertStatus(422)->assertJsonValidationErrors('lines');
        $this->assertSame(0, DB::table('prescription_counters')->count());
        $this->assertSame(0, $this->logs('prescription.issued')->count());
        $this->assertSame([0, 0], $this->readyCounts());
    }

    public function test_duplicate_issue_and_edit_after_issue_preserve_number_and_immutable_lines(): void
    {
        $p = $this->draft();
        $this->postJson("/api/prescriptions/{$p->public_id}/issue", ['expected_revision' => 1])->assertOk();
        $before = $p->fresh()->getRawOriginal();
        $lines = $p->lines()->get()->map->getRawOriginal()->all();
        $this->postJson("/api/prescriptions/{$p->public_id}/issue", ['expected_revision' => 1])->assertStatus(422)->assertJsonValidationErrors('status');
        $this->putJson("/api/prescriptions/{$p->public_id}", ['expected_revision' => 2, 'lines' => [['medicine' => 'Synthetic forbidden edit']]])->assertStatus(422)->assertJsonValidationErrors('status');
        $this->assertSame($before, $p->fresh()->getRawOriginal());
        $this->assertSame($lines, $p->lines()->get()->map->getRawOriginal()->all());
        $this->assertSame(1, $this->logs('prescription.issued')->count());
        $this->assertSame(1, (int) DB::table('prescription_counters')->where('year', 2026)->value('last_number'));
        $this->assertSame([1, 1], $this->readyCounts());
    }

    public function test_void_and_required_audit_keep_issuance_evidence_and_lines(): void
    {
        $p = $this->draft();
        $this->postJson("/api/prescriptions/{$p->public_id}/issue", ['expected_revision' => 1])->assertOk();
        $issued = $p->fresh();
        $lines = $p->lines()->get()->map->getRawOriginal()->all();
        $this->postJson("/api/prescriptions/{$p->public_id}/void", ['reason' => 'Synthetic correction reason'])->assertOk()
            ->assertJsonPath('data.status', 'Void')->assertJsonPath('data.revision', 3);
        $void = $p->fresh();
        foreach (['number', 'issued_at', 'issued_by_user_id', 'license_no', 'visit_id', 'patient_id', 'branch_id', 'dentist_profile_id', 'note'] as $field) {
            $this->assertSame($issued->getRawOriginal($field), $void->getRawOriginal($field));
        }
        $this->assertSame($lines, $p->lines()->get()->map->getRawOriginal()->all());
        $this->assertAudit('prescription.voided', $void);
        $this->postJson("/api/prescriptions/{$p->public_id}/void", ['reason' => 'Synthetic repeat'])->assertStatus(422)->assertJsonValidationErrors('status');
        $this->assertSame($void->getRawOriginal(), $p->fresh()->getRawOriginal());
        $this->assertSame(1, $this->logs('prescription.voided')->count());
    }

    public function test_void_audit_failure_rolls_back_before_or_after_audit_insert(): void
    {
        $p = $this->draft();
        $this->postJson("/api/prescriptions/{$p->public_id}/issue", ['expected_revision' => 1])->assertOk();
        $before = $p->fresh()->getRawOriginal();
        foreach ([false, true] as $afterInsert) {
            $this->failingAudit('prescription.voided', $afterInsert);
            $this->assertFailure(fn () => $this->postJson("/api/prescriptions/{$p->public_id}/void", ['reason' => 'Synthetic correction reason']), 'Synthetic prescription audit failure');
            $this->assertSame($before, $p->fresh()->getRawOriginal());
            $this->assertSame(0, $this->logs('prescription.voided')->count());
            $this->assertSame([1, 1], $this->readyCounts());
        }
    }

    public function test_void_rejects_draft_or_missing_reason_without_mutation(): void
    {
        $p = $this->draft();
        $before = $p->getRawOriginal();
        $this->postJson("/api/prescriptions/{$p->public_id}/void", ['reason' => 'Synthetic reason'])->assertStatus(422)->assertJsonValidationErrors('status');
        $this->postJson("/api/prescriptions/{$p->public_id}/void", ['reason' => '  '])->assertStatus(422)->assertJsonValidationErrors('reason');
        $this->assertSame($before, $p->fresh()->getRawOriginal());
        $this->assertSame(0, $this->logs('prescription.voided')->count());
    }

    public function test_draft_edit_behavior_and_existing_event_set_are_unchanged(): void
    {
        $p = $this->draft();
        $line = ['medicine' => 'Synthetic edited medicine', 'dosage' => 'Synthetic edited dosage', 'instructions' => 'Synthetic edited instruction'];
        $this->putJson("/api/prescriptions/{$p->public_id}", ['expected_revision' => 1, 'lines' => [$line], 'note' => 'Synthetic edited note'])->assertOk()
            ->assertJsonPath('data.status', 'Draft')->assertJsonPath('data.revision', 2)->assertJsonPath('data.lines.0.dosage', $line['dosage']);
        $this->assertSame(['prescription.created'], AuditLog::where('action', 'like', 'prescription.%')->orderBy('id')->pluck('action')->all());
        $this->assertSame(0, DB::table('prescription_counters')->count());
    }

    public function test_patient_guardian_and_owner_access_and_notice_privacy_are_preserved(): void
    {
        $this->p['A']->person->update(['date_of_birth' => '1975-05-05']);
        $child = Guardianship::addDependent($this->p['A'], ['first_name' => 'Synthetic', 'last_name' => 'Dependent', 'date_of_birth' => '2018-02-02', 'relationship' => 'Daughter'], $this->u['patientA']);
        $p = $this->draft($this->visit($child));
        $this->actingAsUser('patientA');
        $this->assertSame([], $this->getJson('/api/me/prescriptions')->assertOk()->json('data'));
        $this->getJson("/api/prescriptions/{$p->public_id}")->assertNotFound();
        $this->actingAsUser('dentist1');
        $this->postJson("/api/prescriptions/{$p->public_id}/issue", ['expected_revision' => 1])->assertOk();
        $this->actingAsUser('patientA');
        $this->assertSame([$p->public_id], array_column($this->getJson('/api/me/prescriptions')->assertOk()->json('data'), 'id'));
        $this->getJson("/api/prescriptions/{$p->public_id}")->assertOk()->assertJsonPath('data.lines.0.medicine', self::MEDICINE);
        $this->assertSame(1, UserNotification::where('kind', 'prescription_ready')->where('user_id', $this->u['patientA']->id)->count());
        $this->actingAsUser('patientB');
        $this->getJson("/api/prescriptions/{$p->public_id}")->assertNotFound();
        $this->get("/api/prescriptions/{$p->public_id}/pdf")->assertNotFound();
        $this->actingAsUser('owner');
        $meta = $this->getJson("/api/prescriptions/{$p->public_id}")->assertOk()->json('data');
        $this->assertEqualsCanonicalizing(['id', 'number', 'status', 'issued_at', 'date', 'branch', 'dentist', 'revision'], array_keys($meta));
        $this->get("/api/prescriptions/{$p->public_id}/pdf")->assertForbidden();
        $haystack = AuditLog::where('action', 'like', 'prescription.%')->get()->toJson()
            .UserNotification::all()->toJson().MailDispatch::all()->toJson().(new PrescriptionReadyMail('Synthetic patient'))->render();
        foreach ([self::MEDICINE, 'Synthetic second medicine', 'Synthetic dosage', 'Synthetic frequency', 'Synthetic duration', 'Synthetic instruction', 'Synthetic private note'] as $text) {
            $this->assertStringNotContainsString($text, $haystack);
        }
    }

    public function test_patient_own_issued_and_void_records_are_read_only_and_drafts_stay_hidden(): void
    {
        $p = $this->draft();
        $this->actingAsUser('patientA');
        $this->assertSame([], $this->getJson('/api/me/prescriptions')->assertOk()->json('data'));
        $this->getJson("/api/prescriptions/{$p->public_id}")->assertNotFound();
        $this->actingAsUser('dentist1');
        $this->postJson("/api/prescriptions/{$p->public_id}/issue", ['expected_revision' => 1])->assertOk();
        $this->actingAsUser('patientA');
        $this->getJson("/api/prescriptions/{$p->public_id}")->assertOk()->assertJsonPath('data.lines.0.medicine', self::MEDICINE);
        $this->putJson("/api/prescriptions/{$p->public_id}", ['expected_revision' => 2, 'lines' => $this->lines()])->assertForbidden();
        $this->actingAsUser('dentist1');
        $this->postJson("/api/prescriptions/{$p->public_id}/void", ['reason' => 'Synthetic correction'])->assertOk();
        $this->actingAsUser('patientA');
        $this->getJson('/api/me/prescriptions')->assertOk()->assertJsonPath('data.0.id', $p->public_id)->assertJsonPath('data.0.status', 'Void');
    }

    public function test_branch_authorization_and_staff_access_remain_unchanged(): void
    {
        $visit = $this->visit();
        $p = $this->draft($visit);
        foreach (['dentist3', 'staffB1', 'owner', 'patientA'] as $actor) {
            $this->actingAsUser($actor);
            $this->postJson('/api/prescriptions', ['visit_id' => $visit->public_id, 'lines' => $this->lines()])->assertForbidden();
            $this->postJson("/api/prescriptions/{$p->public_id}/issue", ['expected_revision' => 1])->assertForbidden();
            $this->postJson("/api/prescriptions/{$p->public_id}/void", ['reason' => 'Synthetic reason'])->assertForbidden();
        }
        $this->assertSame('Draft', $p->fresh()->status);
        $this->assertSame(0, $this->logs('prescription.issued')->count());
        $this->actingAsUser('staffB1');
        $this->getJson("/api/prescriptions/{$p->public_id}")->assertNotFound();
        $this->actingAsUser('dentist1');
        $this->postJson("/api/prescriptions/{$p->public_id}/issue", ['expected_revision' => 1])->assertOk();
        $this->actingAsUser('staffB1');
        $this->getJson("/api/prescriptions/{$p->public_id}")->assertOk()->assertJsonPath('data.lines.0.medicine', self::MEDICINE);
        $this->actingAsUser('staffB2');
        $this->getJson("/api/prescriptions/{$p->public_id}")->assertNotFound();
    }

    /** Separate PostgreSQL connections; no recipient or provider activity in children. */
    public function test_concurrent_duplicate_and_distinct_issues_keep_gapless_numbers_and_one_audit_each(): void
    {
        if (getenv('RX01_RUN_CONCURRENCY') !== '1' || ! function_exists('proc_open')) {
            $this->markTestSkipped('PostgreSQL race execution deferred; requires approved isolated execution and RX01_RUN_CONCURRENCY=1.');
        }
        $this->assertSame('pgsql', DB::connection()->getDriverName());
        $this->assertSame('dental_clinic_scratch', DB::connection()->getDatabaseName());
        $this->assertSame(0, DB::transactionLevel());
        $this->travelBack(); // The existing child harness uses the real Manila year.
        $noContact = Patient::create(['person_id' => Person::factory()->create()->id, 'patient_code' => Patient::nextCode(), 'consent' => true]);
        $visit = $this->visit($noContact);
        $a = $this->directDraft($visit);
        $results = $this->race([$a, $a]);
        $statuses = array_column($results, 'status'); sort($statuses);
        $this->assertSame([200, 422], $statuses);
        $this->assertSame(1, $this->logs('prescription.issued', $a)->count());
        $b = $this->directDraft($visit); $c = $this->directDraft($visit);
        $results = $this->race([$b, $c]);
        $this->assertSame([200, 200], array_column($results, 'status'));
        $year = (int) ClinicClock::now()->format('Y');
        $this->assertSame(array_map(fn ($n) => sprintf('RX-%d-%06d', $year, $n), [1, 2, 3]), Prescription::orderBy('number')->pluck('number')->all());
        $this->assertSame(3, (int) DB::table('prescription_counters')->where('year', $year)->value('last_number'));
        foreach ([$a, $b, $c] as $p) $this->assertAudit('prescription.issued', $p->fresh());
        $this->assertSame([0, 0], $this->readyCounts());
    }

    private function race(array $prescriptions): array
    {
        $token = $this->u['dentist1']->createToken('rx01-concurrency')->plainTextToken;
        $startAt = microtime(true) + 2;
        $children = [];
        try {
            foreach ($prescriptions as $p) {
                $process = proc_open([PHP_BINARY, base_path('tests/Support/concurrent_request.php'), $token,
                    "/api/prescriptions/{$p->public_id}/issue", json_encode(['expected_revision' => 1]), (string) $startAt],
                    [1 => ['pipe', 'w'], 2 => ['pipe', 'w']], $pipes, base_path(),
                    array_merge(getenv(), ['APP_ENV' => 'testing', 'DB_CONNECTION' => 'pgsql', 'DB_DATABASE' => 'dental_clinic_scratch', 'DB_URL' => '',
                        'CACHE_STORE' => 'array', 'SESSION_DRIVER' => 'array', 'QUEUE_CONNECTION' => 'sync', 'MAIL_MAILER' => 'array',
                        'PGOPTIONS' => '-c lock_timeout=5000 -c statement_timeout=10000']));
                if (! is_resource($process)) $this->fail('Could not start isolated RX-01 worker.');
                $children[] = [$process, $pipes];
            }
            $results = [];
            foreach ($children as [$process, $pipes]) {
                $out = stream_get_contents($pipes[1]);
                stream_get_contents($pipes[2]); // Never print worker diagnostics or authentication material.
                $result = json_decode($out, true);
                $this->assertIsArray($result, 'RX-01 worker returned no JSON result.');
                $this->assertArrayHasKey('status', $result);
                $results[] = $result;
            }

            return $results;
        } finally {
            foreach ($children as [$process, $pipes]) {
                foreach ($pipes as $pipe) if (is_resource($pipe)) fclose($pipe);
                if (is_resource($process)) { proc_terminate($process); proc_close($process); }
            }
        }
    }
}
