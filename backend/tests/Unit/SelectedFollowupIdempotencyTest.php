<?php

namespace Tests\Unit;

use App\Enums\Role;
use App\Http\Controllers\Concerns\ReadsIdempotencyKey;
use App\Models\Appointment;
use App\Models\Branch;
use App\Models\DentistProfile;
use App\Models\Patient;
use App\Models\Service;
use App\Models\User;
use App\Services\Appointments\AppointmentCommandException;
use App\Services\Appointments\AppointmentService;
use App\Services\Scheduling\SchedulingService;
use App\Support\IdempotentCommand;
use Illuminate\Contracts\Routing\ResponseFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Foundation\Application;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Facade;
use Illuminate\Support\Facades\Validator;
use Illuminate\Translation\ArrayLoader;
use Illuminate\Translation\Translator;
use Illuminate\Validation\Factory;
use Illuminate\Validation\ValidationException;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

/** Real command journal control flow with an in-memory key store/transaction double; no database or kernel. */
final class SelectedFollowupIdempotencyTest extends TestCase
{
    private $previousApp;
    private $previousFacadeApp;
    private $previousDb;
    private $previousValidator;
    private User $actor;
    private int $executions = 0;

    protected function setUp(): void
    {
        parent::setUp();
        $this->previousApp = Application::getInstance();
        $this->previousFacadeApp = Facade::getFacadeApplication();
        $this->previousDb = DB::getFacadeRoot();
        $this->previousValidator = Validator::getFacadeRoot();
        $app = new Application(); // No bootstrap/providers, PDO or database configuration.
        Application::setInstance($app);
        Facade::setFacadeApplication($app);
        $response = $this->createMock(ResponseFactory::class);
        $response->method('json')->willReturnCallback(fn ($body, $status = 200) => new JsonResponse($body, $status));
        $app->instance(ResponseFactory::class, $response);
        $app->instance('request', Request::create('/api/appointments', 'POST'));
        DB::swap(new class {
            public function transaction(callable $work, int $attempts): array
            {
                $before = Aud10MemoryKey::$records;
                try { return $work(); }
                catch (\Throwable $e) { Aud10MemoryKey::$records = $before; throw $e; }
            }
        });
        Validator::swap(new Factory(new Translator(new ArrayLoader(), 'en')));
        Aud10MemoryKey::$records = [];
        $this->actor = new User();
        $this->actor->setRawAttributes(['id' => 4, 'role' => Role::Staff->value]);
    }

    protected function tearDown(): void
    {
        DB::clearResolvedInstance('db');
        Validator::clearResolvedInstance('validator');
        Facade::setFacadeApplication($this->previousFacadeApp);
        Application::setInstance($this->previousApp);
        if ($this->previousDb !== null) DB::swap($this->previousDb);
        if ($this->previousValidator !== null) Validator::swap($this->previousValidator);
        parent::tearDown();
    }

    private function command(array $payload, ?callable $work = null): JsonResponse
    {
        return IdempotentCommand::run(Aud10MemoryKey::class, $this->actor, 'stable-attempt', 'appointment.create', $payload,
            $work === null ? function () use ($payload) {
                $this->executions++;
                return [['data' => ['id' => '01ARZ3NDEKTSV4RRFFQ69G5FAA'], 'meta' => ['followup_link' => [
                    'task_id' => $payload['followup_task_id'], 'appointment_id' => '01ARZ3NDEKTSV4RRFFQ69G5FAA',
                    'status' => 'Booked', 'revision' => $payload['followup_expected_revision'] + 1,
                ]]], 201];
            } : \Closure::fromCallable($work),
            fn () => AppointmentCommandException::rule('idempotency_key_reused', 'Different request.', 'idempotency_key'));
    }

    private function payload(): array
    {
        return ['followup_task_id' => '01ARZ3NDEKTSV4RRFFQ69G5FAV', 'followup_expected_revision' => 7];
    }

    public function test_same_key_replays_original_linkage_proof_without_reentering_work(): void
    {
        $first = $this->command($this->payload());
        $replay = $this->command($this->payload(), fn () => self::fail('A replay cannot recheck Booked state or create again.'));
        self::assertSame($first->getData(true), $replay->getData(true));
        self::assertSame('true', $replay->headers->get('Idempotent-Replayed'));
        self::assertSame(8, $replay->getData(true)['meta']['followup_link']['revision']);
        self::assertSame(1, $this->executions);
    }

    public static function changedIntent(): array
    {
        return [
            'task' => [['followup_task_id' => '01ARZ3NDEKTSV4RRFFQ69G5FAW']],
            'revision' => [['followup_expected_revision' => 8]],
        ];
    }

    #[DataProvider('changedIntent')]
    public function test_task_and_revision_are_bound_to_the_command_fingerprint(array $change): void
    {
        $this->command($this->payload());
        try {
            $this->command($change + $this->payload());
            self::fail('Changed intent must not replay or execute.');
        } catch (AppointmentCommandException $e) {
            self::assertSame('idempotency_key_reused', $e->errorCode);
            self::assertSame(422, $e->status);
        }
        self::assertSame(1, $this->executions);
    }

    public function test_refused_work_does_not_store_a_key_and_can_retry(): void
    {
        try {
            $this->command($this->payload(), fn () => throw new AppointmentCommandException(409, 'followup_conflict', 'Changed.'));
            self::fail('Refusal must propagate.');
        } catch (AppointmentCommandException $e) {
            self::assertSame(409, $e->status);
        }
        self::assertSame([], Aud10MemoryKey::$records);
        self::assertSame(201, $this->command($this->payload())->getStatusCode());
    }

    public function test_service_itself_rejects_missing_selected_mode_key_before_any_model_query(): void
    {
        $this->expectException(ValidationException::class);
        (new AppointmentService(new SchedulingService()))->create($this->actor, new Patient(), new Branch(), new Service(), null,
            $this->payload(), null);
    }

    public function test_body_field_cannot_substitute_for_a_missing_idempotency_header(): void
    {
        $this->expectException(ValidationException::class);
        (new AppointmentService(new SchedulingService()))->create($this->actor, new Patient(), new Branch(), new Service(), null,
            $this->payload() + ['idempotency_key' => 'body-is-not-the-header'], null);
    }

    public static function headers(): array
    {
        return [
            'missing' => [null, false], 'empty' => ['', false], 'space' => ['two words', false],
            'unicode' => ['clé', false], 'too long' => [str_repeat('a', 256), false],
            'trailing newline' => ["attempt\n", false], 'leading newline' => ["\nattempt", false],
            'embedded newline' => ["at\ntempt", false],
            'stable visible ASCII' => ['followup-attempt:01ARZ3NDEKTSV4RRFFQ69G5FAV', true],
        ];
    }

    #[DataProvider('headers')]
    public function test_existing_header_reader_enforces_required_selected_mode_key(?string $key, bool $valid): void
    {
        $reader = new class { use ReadsIdempotencyKey { idempotencyKey as public readKey; } };
        $request = Request::create('/api/appointments', 'POST');
        if ($key !== null) $request->headers->set('Idempotency-Key', $key);
        if (! $valid) $this->expectException(ValidationException::class);
        self::assertSame($key, $reader->readKey($request, true));
    }

    public function test_existing_header_reader_keeps_ordinary_booking_key_optional(): void
    {
        $reader = new class { use ReadsIdempotencyKey { idempotencyKey as public readKey; } };
        self::assertNull($reader->readKey(Request::create('/api/appointments', 'POST')));
    }

    public static function directServiceKeys(): array
    {
        return [
            'valid existing format' => ['followup-attempt:01ARZ3NDEKTSV4RRFFQ69G5FAV', true],
            'valid maximum length' => [str_repeat('a', 255), true],
            'trailing newline' => ["attempt\n", false],
            'leading newline' => ["\nattempt", false],
            'embedded newline' => ["at\ntempt", false],
            'trailing CRLF' => ["attempt\r\n", false],
            'embedded tab' => ["at\ttempt", false],
            'space' => ['two words', false],
            'unicode' => ['clé', false],
            'empty' => ['', false],
            'missing' => [null, false],
            'too long' => [str_repeat('a', 256), false],
        ];
    }

    #[DataProvider('directServiceKeys')]
    public function test_direct_service_key_validation_finishes_before_any_database_lookup(?string $key, bool $valid): void
    {
        $actor = new class extends User {
            public function fresh($with = []) { throw new Aud10LookupReached(); }
        };
        $actor->role = Role::Staff;
        try {
            (new AppointmentService(new SchedulingService()))->create($actor, new Patient(), new Branch(), new Service(), null,
                $this->payload(), $key);
            self::fail('Valid input must reach the lookup sentinel; invalid input must be refused before it.');
        } catch (ValidationException $e) {
            self::assertFalse($valid);
            self::assertArrayHasKey('idempotency_key', $e->errors());
        } catch (Aud10LookupReached) {
            self::assertTrue($valid, 'A malformed key must never reach the task lookup.');
        }
    }

    public static function responseModes(): array { return [[false], [true]]; }

    #[DataProvider('responseModes')]
    public function test_actual_appointment_response_path_preserves_resource_and_only_adds_selected_metadata(bool $selected): void
    {
        // Only model refresh is stubbed. Production AppointmentResource and the command's serializer both execute.
        $appointment = new class extends Appointment {
            public int $fixtureRefreshCount = 0;
            public function fresh($with = []) { $this->fixtureRefreshCount++; return $this; }
        };
        $appointment->setRawAttributes(['id' => 11, 'public_id' => '01ARZ3NDEKTSV4RRFFQ69G5FAA', 'appointment_code' => 'APT-FIXTURE',
            'starts_at' => '2026-11-20 02:00:00+00:00', 'ends_at' => '2026-11-20 02:30:00+00:00',
            'status' => 'Confirmed', 'source' => 'front_desk', 'revision' => 1, 'duration_minutes' => 30]);
        $patient = new Patient();
        $patient->setRawAttributes(['id' => 12, 'public_id' => '01ARZ3NDEKTSV4RRFFQ69G5FAB', 'patient_code' => 'PAT-FIXTURE']);
        $patient->setRelation('person', null);
        $dentist = new DentistProfile();
        $dentist->setRawAttributes(['legacy_ref' => 'd1']);
        $dentist->setRelation('person', null);
        $appointment->setRelations(['patient' => $patient, 'branch' => new Branch(['legacy_ref' => 'b1']),
            'service' => new Service(['legacy_ref' => 'svc1']), 'dentist' => $dentist, 'activeCheckoutSession' => null]);
        $proof = ['task_id' => $this->payload()['followup_task_id'], 'appointment_id' => $appointment->public_id,
            'status' => 'Booked', 'revision' => 8];
        $work = fn () => [$appointment, 201, $selected ? ['followup_link' => $proof] : []];
        $response = (new \ReflectionMethod(AppointmentService::class, 'idempotent'))->invoke(
            new AppointmentService(new SchedulingService()), $this->actor, null, 'appointment.create', $this->payload(), $work);
        $body = $response->getData(true);
        self::assertSame(201, $response->getStatusCode());
        self::assertSame($appointment->public_id, $body['data']['id']);
        self::assertSame($patient->public_id, $body['data']['patient']['id']);
        self::assertSame('10:00', $body['data']['start_time']);
        self::assertSame(1, $appointment->fixtureRefreshCount);
        if ($selected) self::assertSame($proof, $body['meta']['followup_link']);
        else self::assertArrayNotHasKey('meta', $body);
    }
}

final class Aud10LookupReached extends \RuntimeException {}

/** Deliberately not an Eloquent persistence implementation; only the journal's key-store protocol. */
final class Aud10MemoryKey extends Model
{
    public static array $records = [];

    public static function where($column, $value): object
    {
        return new class($column, $value) {
            private array $conditions;
            public function __construct($column, $value) { $this->conditions = [$column => $value]; }
            public function where($column, $value): self { $this->conditions[$column] = $value; return $this; }
            public function first(): ?object
            {
                foreach (Aud10MemoryKey::$records as $row) {
                    if (array_intersect_assoc($row, $this->conditions) === $this->conditions) return (object) $row;
                }
                return null;
            }
        };
    }

    public static function create(array $attributes): object
    {
        $index = count(self::$records);
        self::$records[$index] = $attributes;
        return new class($index) {
            public function __construct(private int $index) {}
            public function update(array $attributes): void { Aud10MemoryKey::$records[$this->index] += $attributes; }
        };
    }
}
