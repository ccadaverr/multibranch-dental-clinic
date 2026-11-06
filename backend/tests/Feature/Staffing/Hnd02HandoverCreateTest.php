<?php

namespace Tests\Feature\Staffing;

use App\Models\AuditLog;
use App\Models\PatientHandover;
use App\Models\UserNotification;
use App\Services\Audit\AuditService;
use App\Services\Notifications\NotificationCenter;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Mail;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\Feature\Appointments\SchedulingFixture;
use Tests\TestCase;

class Hnd02HandoverCreateTest extends TestCase
{
    use RefreshDatabase, SchedulingFixture;

    private const SUMMARY = 'HND-02 private clinical summary';

    protected function setUp(): void
    {
        parent::setUp();
        Mail::fake();
        Http::preventStrayRequests();
        $this->setUpSchedulingWorld();
        $this->existing('A', 'd1', 'b1', 'svc1', '2026-09-21', '10:00', 30, 'Completed');
        $this->actingAsUser('staffB1');
    }

    private function send(array $extra = [])
    {
        return $this->postJson('/api/handovers', $extra + [
            'patient_id' => $this->p['A']->public_id, 'from_branch_ref' => 'b1', 'to_branch_ref' => 'b2',
            'to_dentist_ref' => 'd3', 'summary' => self::SUMMARY,
            'pending_treatment' => 'HND-02 private plan', 'notes' => 'HND-02 private notes',
        ], ['Idempotency-Key' => 'hnd02-retry-characterization']);
    }

    private function isolatedModelEvents(\Closure $work): void
    {
        $dispatcher = Model::getEventDispatcher();
        Model::setEventDispatcher(clone $dispatcher);
        try {
            $work();
        } finally {
            Model::setEventDispatcher($dispatcher);
        }
    }

    public function test_success_creates_audited_handover_with_identity_scoped_private_notices(): void
    {
        $id = $this->send()->assertCreated()->assertJsonPath('data.status', 'Sent')->json('data.id');
        $handover = PatientHandover::where('public_id', $id)->sole();
        $audit = AuditLog::where('action', 'handover.created')->sole();
        $this->assertSame($id, $audit->payload['handover']);
        $this->assertSame('Sent', $audit->payload['status']);
        $this->assertSame($this->u['staffB1']->id, $audit->actor_user_id);
        $expected = [$this->u['staffB2']->id, $this->u['staffBoth']->id, $this->u['dentist3']->id];
        sort($expected);
        $this->assertSame($expected, UserNotification::where('kind', 'handover_received')->orderBy('user_id')->pluck('user_id')->all());
        $this->assertSame([$id, $id, $id], UserNotification::where('kind', 'handover_received')->pluck('target_id')->all());
        $patientNotice = UserNotification::where('kind', 'record_shared')->sole();
        $this->assertSame($this->u['patientA']->id, $patientNotice->user_id);
        $this->assertSame('Your patient record was shared with Branch B2 so they can continue your care.', $patientNotice->body);
        $this->assertSame(4, UserNotification::count());
        foreach ([self::SUMMARY, 'HND-02 private plan', 'HND-02 private notes'] as $text) {
            $this->assertStringNotContainsString($text, $audit->toJson().UserNotification::all()->toJson());
        }
        $this->assertNotSame(self::SUMMARY, DB::table('patient_handovers')->where('id', $handover->id)->value('summary'));
        $this->actingAsUser('owner');
        $this->getJson("/api/handovers/{$id}")->assertOk()->assertJsonMissingPath('data.summary')
            ->assertJsonMissingPath('data.pending_treatment')->assertJsonMissingPath('data.notes')->assertJsonMissingPath('data.documents');
    }

    public function test_failure_after_handover_insert_leaves_no_row_audit_or_notifications(): void
    {
        $this->mock(NotificationCenter::class, function ($mock) {
            $mock->shouldNotReceive('staffNotice');
            $mock->shouldNotReceive('recordShared');
        });
        $this->isolatedModelEvents(function () {
            PatientHandover::created(fn () => throw new \RuntimeException('HND-02 insert failure fixture'));
            $this->withoutExceptionHandling();
            try {
                $this->send();
                $this->fail('The inserted row must roll back when creation fails.');
            } catch (\RuntimeException $exception) {
                $this->assertSame('HND-02 insert failure fixture', $exception->getMessage());
            }
        });
        $this->assertSame(0, PatientHandover::count());
        $this->assertSame(0, AuditLog::where('action', 'handover.created')->count());
        $this->assertSame(0, UserNotification::count());
    }

    public function test_audit_failure_rolls_back_handover_and_audit_without_notifying(): void
    {
        $this->mock(NotificationCenter::class, function ($mock) {
            $mock->shouldNotReceive('staffNotice');
            $mock->shouldNotReceive('recordShared');
        });
        $this->app->bind(AuditService::class, fn () => new class extends AuditService {
            public function record(array $attributes): AuditLog
            {
                parent::record($attributes);
                throw new \RuntimeException('HND-02 audit failure fixture');
            }
        });
        $this->withoutExceptionHandling();
        try {
            $this->send();
            $this->fail('An unaudited handover must not persist.');
        } catch (\RuntimeException $exception) {
            $this->assertSame('HND-02 audit failure fixture', $exception->getMessage());
        }
        $this->assertSame(0, PatientHandover::count());
        $this->assertSame(0, AuditLog::where('action', 'handover.created')->count());
        $this->assertSame(0, UserNotification::count());
    }

    public function test_notices_run_after_authoritative_transaction_with_audit_already_present(): void
    {
        // RefreshDatabase retains an outer test transaction; this verifies the application's inner boundary.
        $outerLevel = DB::transactionLevel();
        $observations = [];
        $check = function (...$arguments) use (&$observations) {
            $observations[] = [DB::transactionLevel(), PatientHandover::count(), AuditLog::where('action', 'handover.created')->count()];

            return true;
        };
        $this->mock(NotificationCenter::class, function ($mock) use ($check) {
            $mock->shouldReceive('staffNotice')->times(3)->withArgs($check);
            $mock->shouldReceive('recordShared')->once()->withArgs($check);
        });
        $this->send()->assertCreated();
        // Assert outside the best-effort callback so its catch cannot swallow assertion failures.
        $this->assertSame(array_fill(0, 4, [$outerLevel, 1, 1]), $observations);
    }

    public function test_outer_rollback_discards_scheduled_notices_and_authoritative_rows(): void
    {
        $this->mock(NotificationCenter::class, function ($mock) {
            $mock->shouldNotReceive('staffNotice');
            $mock->shouldNotReceive('recordShared');
        });
        DB::beginTransaction();
        try {
            $this->send()->assertCreated();
            $this->assertSame(1, PatientHandover::count());
            $this->assertSame(0, UserNotification::count());
        } finally {
            DB::rollBack();
        }
        $this->assertSame(0, PatientHandover::count());
        $this->assertSame(0, AuditLog::where('action', 'handover.created')->count());
        $this->assertSame(0, UserNotification::count());
    }

    public function test_notification_write_failure_keeps_audited_creation_and_other_notices(): void
    {
        $this->isolatedModelEvents(function () {
            UserNotification::creating(function (UserNotification $notice) {
                if ($notice->user_id === $this->u['staffB2']->id) {
                    throw new \RuntimeException('HND-02 notification write fixture');
                }
            });
            $this->send()->assertCreated();
        });
        $this->assertSame(1, PatientHandover::count());
        $this->assertSame(1, AuditLog::where('action', 'handover.created')->count());
        $this->assertFalse(UserNotification::where('user_id', $this->u['staffB2']->id)->exists());
        $this->assertSame(2, UserNotification::where('kind', 'handover_received')->count());
        $this->assertSame(1, UserNotification::where('user_id', $this->u['patientA']->id)->where('kind', 'record_shared')->count());
    }

    public function test_unexpected_notification_exception_does_not_report_committed_creation_as_failed(): void
    {
        $this->mock(NotificationCenter::class, function ($mock) {
            $mock->shouldReceive('staffNotice')->once()->andThrow(new \RuntimeException('HND-02 notice exception fixture'));
        });
        $this->send()->assertCreated();
        $this->assertSame(1, PatientHandover::count());
        $this->assertSame(1, AuditLog::where('action', 'handover.created')->count());
        $this->assertSame(0, UserNotification::count());
    }

    public static function unauthorizedSenders(): array
    {
        return [['staffB2'], ['staffNone'], ['dentist2'], ['owner'], ['patientA']];
    }

    #[DataProvider('unauthorizedSenders')]
    public function test_unauthorized_sender_cannot_create_effects(string $who): void
    {
        $this->actingAsUser($who);
        $this->send()->assertForbidden();
        $this->assertSame(0, PatientHandover::count());
        $this->assertSame(0, AuditLog::where('action', 'handover.created')->count());
        $this->assertSame(0, UserNotification::count());
    }

    public function test_wrong_branch_and_invalid_documents_or_recipient_create_no_effects(): void
    {
        $this->send(['from_branch_ref' => 'b2', 'to_branch_ref' => 'b1', 'to_dentist_ref' => 'd1'])->assertForbidden();
        $this->send(['patient_id' => $this->p['B']->public_id])->assertForbidden();
        $this->send(['document_ids' => ['01JXXXXXXXXXXXXXXXXXXXXXXX']])->assertStatus(422)->assertJsonValidationErrors('document_ids');
        $this->send(['to_dentist_ref' => 'd1'])->assertStatus(422)->assertJsonValidationErrors('to_dentist_ref');
        $this->assertSame(0, PatientHandover::count());
        $this->assertSame(0, AuditLog::where('action', 'handover.created')->count());
        $this->assertSame(0, UserNotification::count());
    }

    public function test_retry_after_a_lost_response_is_not_an_idempotent_creation_contract(): void
    {
        // Characterize the existing contract: even the same header/payload creates a new event.
        $first = $this->send()->assertCreated()->json('data.id');
        $second = $this->send()->assertCreated()->json('data.id');
        $this->assertNotSame($first, $second);
        $this->assertSame(2, PatientHandover::count());
        $this->assertSame(2, AuditLog::where('action', 'handover.created')->count());
        $this->assertSame(8, UserNotification::count());
    }
}
