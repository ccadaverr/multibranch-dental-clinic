<?php

namespace Tests\Feature\Audit;

use App\Models\AuditLog;
use App\Models\Branch;
use App\Models\Patient;
use App\Models\Service;
use App\Models\User;
use App\Services\Audit\AuditService;
use Carbon\CarbonImmutable;
use Illuminate\Database\QueryException;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Route;
use InvalidArgumentException;
use RuntimeException;
use Tests\Feature\Appointments\SchedulingFixture;
use Tests\TestCase;

// M22 audit history: append-only at the database, one server-side writer, safe metadata, Owner-only validated reads with bounded
// cursor pagination. Clock frozen by SchedulingFixture (2026-09-28 10:00 Asia/Manila).
class AuditHardeningTest extends TestCase
{
    use RefreshDatabase, SchedulingFixture;

    private AuditService $audit;

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpSchedulingWorld();
        $this->audit = app(AuditService::class);
    }

    private function log(string $action = 'test.event', array $extra = []): AuditLog
    {
        return $this->audit->record($extra + ['action' => $action, 'category' => 'administrative', 'actor' => $this->u['owner']]);
    }

    // ---- append-only ----------------------------------------------------------------------------------------------

    public function test_the_database_refuses_to_update_or_delete_an_audit_row_by_any_path(): void
    {
        $log = $this->log('test.original');
        foreach ([
            fn () => AuditLog::query()->whereKey($log->id)->update(['action' => 'tampered.action']),
            fn () => AuditLog::query()->whereKey($log->id)->update(['payload' => ['x' => 1]]),
            fn () => AuditLog::query()->whereKey($log->id)->delete(),
            fn () => DB::table('audit_logs')->where('id', $log->id)->update(['actor_name' => 'someone else']),
            fn () => DB::table('audit_logs')->where('id', $log->id)->update(['created_at' => '2001-01-01 00:00:00+00']),
            fn () => DB::table('audit_logs')->where('id', $log->id)->delete(),
            fn () => DB::statement('DELETE FROM audit_logs'),
        ] as $attempt) {
            try {
                DB::transaction($attempt); // a savepoint, so the refused statement cannot poison the test transaction
                $this->fail('the database should have refused the change');
            } catch (QueryException $e) {
                $this->assertStringContainsString('append-only', $e->getMessage());
            }
        }
        try {
            DB::transaction(fn () => DB::statement('TRUNCATE audit_logs'));
            $this->fail('truncate should be refused');
        } catch (QueryException $e) {
            if ((string) $e->getCode() === '42501') {
                // A restricted application role is refused before the append-only trigger runs.
                $this->assertSame(0, (int) DB::scalar("SELECT has_table_privilege(current_user, 'audit_logs', 'TRUNCATE')"));
            } else {
                $this->assertStringContainsString('append-only', $e->getMessage());
            }
        }
        $this->assertSame('test.original', $log->fresh()->action);
        $this->assertSame(1, AuditLog::count());
    }

    public function test_the_model_refuses_update_delete_and_mass_assignment(): void
    {
        $log = $this->log();
        $loaded = AuditLog::findOrFail($log->id);
        $loaded->action = 'tampered.action';
        foreach ([fn () => $loaded->save(), fn () => $loaded->update(['action' => 'x.y']), fn () => $loaded->delete(), fn () => AuditLog::destroy($log->id)] as $attempt) {
            try {
                $attempt();
                $this->fail('the model should have refused the change');
            } catch (RuntimeException $e) {
                $this->assertStringContainsString('Audit logs are', $e->getMessage());
            }
        }
        $this->assertSame('test.event', $log->fresh()->action);
        $this->expectException(\Illuminate\Database\Eloquent\MassAssignmentException::class);
        (new AuditLog)->fill(['action' => 'forged.event', 'actor_name' => 'Forged', 'created_at' => '2000-01-01']); // nothing is mass-assignable
    }

    public function test_the_only_allowed_change_is_the_foreign_key_nulling_when_a_referenced_user_or_branch_is_removed(): void
    {
        $branch = Branch::create(['legacy_ref' => 'b9', 'branch_code' => 'BRC-9', 'name' => 'Branch 9', 'city' => 'X', 'address' => 'x', 'open_time' => '09:00', 'close_time' => '18:00', 'status' => 'Open', 'capacity_threshold' => 1]);
        $actor = $this->account(\App\Enums\Role::Staff, null);
        $log = $this->audit->record(['action' => 'test.durable', 'category' => 'administrative', 'actor' => $actor, 'branch_id' => $branch->id]);
        $name = $log->actor_name;

        $actor->forceDelete();
        $branch->delete();
        $kept = AuditLog::findOrFail($log->id);
        $this->assertNull($kept->actor_user_id);
        $this->assertNull($kept->branch_id);
        $this->assertSame([$name, 'staff', 'test.durable'], [$kept->actor_name, $kept->actor_role, $kept->action], 'history stays understandable');
    }

    public function test_there_is_no_http_path_that_creates_changes_or_deletes_audit_rows(): void
    {
        $audit = collect(Route::getRoutes()->getRoutes())->filter(fn ($r) => str_contains($r->uri(), 'audit'));
        $methods = $audit->flatMap(fn ($r) => $r->methods())->unique()->reject(fn ($m) => in_array($m, ['GET', 'HEAD']))->values()->all();
        $this->assertSame([], $methods, 'audit endpoints are read-only');
        $this->actingAsUser('owner');
        $row = $this->log();
        foreach (['putJson', 'patchJson', 'deleteJson', 'postJson'] as $verb) {
            $this->{$verb}('/api/audit-logs/'.$row->public_id, [])->assertStatus(405);
            $this->{$verb}('/api/audit-logs', [])->assertStatus(405);
        }
    }

    // ---- the single writer ------------------------------------------------------------------------------------------

    public function test_invalid_events_are_refused_explicitly(): void
    {
        foreach (['', 'nodot', 'Upper.case', '=cmd', 'a b.c', 'x.y z', str_repeat('a', 99).'.b'] as $bad) {
            try {
                $this->audit->record(['action' => $bad, 'category' => 'general']);
                $this->fail("'$bad' should be refused");
            } catch (InvalidArgumentException $e) {
                $this->assertStringContainsString('audit event key', $e->getMessage());
            }
        }
        foreach ([['category' => 'bogus'], ['severity' => 'error'], ['severity' => 'fatal']] as $bad) {
            $this->expectsInvalid(fn () => $this->audit->record($bad + ['action' => 'test.event']));
        }
        $this->expectsInvalid(fn () => $this->audit->record(['action' => 'test.event', 'payload' => 'a string']));
        $this->assertSame(0, AuditLog::count());
        $this->audit->record(['action' => 'automation.rule.R1_APPT_LIFECYCLE', 'category' => 'automation', 'actor' => null]); // a real existing key
        $this->assertSame(1, AuditLog::count());
    }

    private function expectsInvalid(\Closure $call): void
    {
        try {
            $call();
            $this->fail('expected an InvalidArgumentException');
        } catch (InvalidArgumentException) {
            $this->addToAssertionCount(1);
        }
    }

    public function test_actor_comes_from_the_authenticated_context_and_is_never_a_human_for_system_events(): void
    {
        $this->actingAsUser('staffB1');
        $fromContext = $this->audit->record(['action' => 'test.contextual', 'category' => 'general']);
        $this->assertSame([$this->u['staffB1']->id, 'staff'], [$fromContext->actor_user_id, $fromContext->actor_role]);

        $anonymous = $this->audit->record(['action' => 'auth.login_failed', 'category' => 'security', 'actor' => null]);
        $this->assertSame([null, 'anonymous'], [$anonymous->actor_user_id, $anonymous->actor_role]);

        // An automation rule fired inside a human's request is still a SYSTEM actor, never that human.
        $system = $this->audit->recordAutomation('automation.rule.R3_CAPACITY_ALERT', 'Automation Rule R3_CAPACITY_ALERT', ['status' => 'Succeeded']);
        $this->assertSame([null, 'system', 'Automation Rule R3_CAPACITY_ALERT'], [$system->actor_user_id, $system->actor_role, $system->actor_name]);
    }

    public function test_the_event_branch_is_never_guessed_from_the_actors_assignment(): void
    {
        $dentist = $this->u['dentist1'];
        $this->assertNotEmpty($dentist->person->dentistProfile->branches);
        $log = $this->audit->record(['action' => 'test.no_branch', 'category' => 'general', 'actor' => $dentist]);
        $this->assertNull($log->branch_id);
        $explicit = $this->audit->record(['action' => 'test.with_branch', 'category' => 'general', 'actor' => $dentist, 'branch_id' => $this->b['b2']->id]);
        $this->assertSame($this->b['b2']->id, $explicit->branch_id);
    }

    public function test_targets_are_public_ids_only_and_never_an_internal_key(): void
    {
        $withPublic = $this->audit->record(['action' => 'test.target', 'category' => 'general', 'actor' => $this->u['owner'], 'target' => $this->p['A']]);
        $this->assertSame(['Patient', $this->p['A']->public_id], [$withPublic->auditable_type, $withPublic->auditable_public_id]);
        $service = Service::first();
        $without = $this->audit->record(['action' => 'test.target', 'category' => 'general', 'actor' => $this->u['owner'], 'target' => $service]);
        $this->assertSame(['Service', null], [$without->auditable_type, $without->auditable_public_id], 'a model with no public id is never recorded by its bigint key');
    }

    public function test_the_timestamp_is_assigned_by_the_database_and_a_supplied_one_is_ignored(): void
    {
        $log = $this->audit->record(['action' => 'test.time', 'category' => 'general', 'actor' => $this->u['owner'], 'created_at' => '2001-02-03 04:05:06']);
        $dbNow = CarbonImmutable::parse(DB::selectOne('select now()::text as n')->n);
        $this->assertLessThan(10, abs($dbNow->diffInSeconds($log->created_at, false)), 'created_at is the database transaction time, not the supplied value');
        $this->assertGreaterThan(2020, $log->created_at->year);
        $this->actingAsUser('owner');
        $this->assertStringEndsWith('+08:00', $this->getJson('/api/audit-logs/'.$log->public_id)->assertOk()->json('data.created_at'));
    }

    public function test_metadata_is_minimized_credentials_by_whole_word_and_size_bounded(): void
    {
        $log = $this->audit->record(['action' => 'test.meta', 'category' => 'security', 'actor' => $this->u['owner'], 'payload' => [
            'password' => 'x', 'newPassword' => 'x', 'API-Key' => 'x', 'accessToken' => 'x', 'otp_code' => 'x', 'Authorization' => 'Bearer abc', 'session_id' => 'x', 'pin' => '1234', 'card_number' => '4111', 'client_secret' => 'x',
            'mapping' => 'kept', 'footprint' => 'kept', 'shipping' => 'kept', 'typing' => 'kept', 'fields' => ['phone', 'emergency_contact'], 'long' => str_repeat('a', 900),
            'nested' => ['refresh_token' => 'x', 'status' => 'Paid'],
        ]])->fresh();
        foreach (['password', 'newPassword', 'API-Key', 'accessToken', 'otp_code', 'Authorization', 'session_id', 'pin', 'card_number', 'client_secret'] as $key) {
            $this->assertSame('[REDACTED]', $log->payload[$key], "$key is redacted");
        }
        foreach (['mapping', 'footprint', 'shipping', 'typing'] as $key) {
            $this->assertSame('kept', $log->payload[$key], "$key is not a secret");
        }
        $this->assertSame(['phone', 'emergency_contact'], $log->payload['fields']);
        $this->assertSame('[REDACTED]', $log->payload['nested']['refresh_token']);
        $this->assertSame('Paid', $log->payload['nested']['status']);
        $this->assertStringEndsWith('[truncated]', $log->payload['long']);

        $big = $this->audit->record(['action' => 'test.big', 'category' => 'general', 'actor' => $this->u['owner'], 'payload' => array_fill_keys(array_map(fn ($i) => "k$i", range(1, 400)), str_repeat('v', 300))])->fresh();
        $this->assertTrue($big->payload['payload_truncated']);
        $this->assertLessThanOrEqual(20, count($big->payload['keys']));
    }

    // ---- authorization and enumeration ---------------------------------------------------------------------------------

    public function test_only_the_owner_reads_audit_history_and_guests_get_401(): void
    {
        $row = $this->log();
        foreach (['/api/audit-logs', '/api/audit-logs/'.$row->public_id, '/api/audit-logs/export'] as $url) {
            $this->getJson($url)->assertUnauthorized();
            foreach (['patientA', 'staffB1', 'staffBoth', 'staffNone', 'dentist1'] as $who) {
                $this->actingAsUser($who);
                $this->getJson($url)->assertForbidden();
            }
            $this->actingAsUser('owner');
            $this->getJson($url)->assertOk();
            $this->app['auth']->forgetGuards();
        }
    }

    public function test_events_resolve_by_public_id_only_and_expose_no_internal_ids(): void
    {
        $this->actingAsUser('staffB1');
        $row = $this->audit->record(['action' => 'test.target', 'category' => 'general', 'branch_id' => $this->b['b1']->id, 'target' => $this->p['A']]);
        $this->actingAsUser('owner');
        $json = $this->getJson('/api/audit-logs/'.$row->public_id)->assertOk()->assertJsonPath('data.branch.name', 'Branch B1'.'')->json();
        $this->getJson('/api/audit-logs/'.$row->id)->assertNotFound();
        $this->getJson('/api/audit-logs/not-a-ulid')->assertNotFound();
        $this->getJson('/api/audit-logs/01ARZ3NDEKTSV4RRFFQ69G5FAV')->assertNotFound();
        $text = json_encode($json);
        foreach (['actor_user_id', 'branch_id', '"user_id"'] as $leak) {
            $this->assertStringNotContainsString($leak, $text);
        }
        $this->assertSame($this->u['staffB1']->public_id, $json['data']['actor']['id']);
    }

    // ---- final security/integrity gate ----------------------------------------------------------------------------------

    public function test_the_foreign_key_exception_cannot_be_used_to_null_or_repoint_a_row_while_the_referenced_row_exists(): void
    {
        $actor = $this->account(\App\Enums\Role::Staff, null);
        $other = $this->account(\App\Enums\Role::Staff, null);
        $log = $this->audit->record(['action' => 'test.guarded', 'category' => 'administrative', 'actor' => $actor, 'branch_id' => $this->b['b1']->id]);

        foreach ([
            'null the actor' => ['actor_user_id' => null],
            'null the branch' => ['branch_id' => null],
            'null both' => ['actor_user_id' => null, 'branch_id' => null],
            'repoint the actor' => ['actor_user_id' => $other->id],
            'repoint the branch' => ['branch_id' => $this->b['b2']->id],
            'null and rename' => ['actor_user_id' => null, 'actor_name' => 'someone else'],
        ] as $what => $change) {
            try {
                DB::transaction(fn () => DB::table('audit_logs')->where('id', $log->id)->update($change));
                $this->fail("the database should refuse to $what");
            } catch (QueryException $e) {
                $this->assertStringContainsString('append-only', $e->getMessage(), $what);
            }
        }
        $kept = DB::table('audit_logs')->where('id', $log->id)->first();
        $this->assertSame([$actor->id, $this->b['b1']->id], [(int) $kept->actor_user_id, (int) $kept->branch_id], 'the row is untouched');
        $this->assertSame(1, DB::table('audit_logs')->where('id', $log->id)->update(['action' => 'test.guarded']), 'a no-op update is harmless');
    }

    public function test_the_referential_cleanup_still_works_only_when_the_referenced_row_is_really_deleted(): void
    {
        $actor = $this->account(\App\Enums\Role::Staff, null);
        $log = $this->audit->record(['action' => 'test.cleanup', 'category' => 'administrative', 'actor' => $actor]);
        $name = $log->actor_name;
        $actor->forceDelete();
        $row = DB::table('audit_logs')->where('id', $log->id)->first();
        $this->assertNull($row->actor_user_id);
        $this->assertSame([$name, 'test.cleanup'], [$row->actor_name, $row->action]);
        // And now that the user is gone, an application UPDATE of the same column is still refused (depth 1, not the FK action).
        try {
            DB::transaction(fn () => DB::table('audit_logs')->where('id', $log->id)->update(['actor_user_id' => $this->u['owner']->id]));
            $this->fail('re-pointing must be refused');
        } catch (QueryException $e) {
            $this->assertStringContainsString('append-only', $e->getMessage());
        }
    }

    public function test_the_created_at_column_is_a_timestamptz_with_a_database_default(): void
    {
        $column = DB::selectOne("select data_type, column_default from information_schema.columns where table_name = 'audit_logs' and column_name = 'created_at'");
        $this->assertSame('timestamp with time zone', $column->data_type);
        $this->assertStringContainsString('CURRENT_TIMESTAMP', strtoupper($column->column_default));
    }

    public function test_the_stored_instant_does_not_depend_on_the_database_session_timezone(): void
    {
        $original = DB::selectOne("select current_setting('TimeZone') as tz")->tz;
        $logs = [];
        try {
            foreach (['UTC', 'Asia/Manila', 'America/New_York', 'Pacific/Auckland'] as $zone) {
                DB::statement("SET TIME ZONE '{$zone}'");
                $log = $this->audit->record(['action' => 'test.zone', 'category' => 'general', 'actor' => $this->u['owner']]);
                $diff = DB::selectOne('select abs(extract(epoch from (now() - created_at))) as seconds from audit_logs where id = ?', [$log->id])->seconds;
                $this->assertLessThan(5, (float) $diff, "stored instant is wrong under session timezone $zone");
                $logs[$zone] = $log->id;
            }
            // Read every row back under a DIFFERENT session timezone: the instant is the same wherever it is read from.
            DB::statement("SET TIME ZONE 'America/Los_Angeles'");
            $epochs = DB::table('audit_logs')->whereIn('id', array_values($logs))->selectRaw('extract(epoch from created_at) as e')->pluck('e')->map(fn ($e) => (float) $e)->all();
            $this->assertLessThan(5, max($epochs) - min($epochs));
            $this->actingAsUser('owner');
            $at = [];
            foreach (['UTC', 'Pacific/Auckland'] as $zone) {
                DB::statement("SET TIME ZONE '{$zone}'");
                $created = $this->getJson('/api/audit-logs/'.AuditLog::find($logs['UTC'])->public_id)->assertOk()->json('data.created_at');
                $this->assertStringEndsWith('+08:00', $created, 'API output keeps an explicit clinic offset whatever the session timezone');
                $at[] = CarbonImmutable::parse($created)->getTimestamp();
            }
            $this->assertSame($at[0], $at[1], 'the same instant is returned under different session timezones');
        } finally {
            DB::statement("SET TIME ZONE '{$original}'");
        }
    }

    public function test_ordering_stays_deterministic_whatever_the_timestamps(): void
    {
        $ids = [];
        for ($i = 0; $i < 4; $i++) {
            $ids[] = $this->log("test.order_$i")->public_id; // same transaction => identical created_at
        }
        $this->assertSame(1, DB::table('audit_logs')->distinct()->count('created_at'), 'identical timestamps within one transaction');
        $this->actingAsUser('owner');
        $this->assertSame(array_reverse($ids), array_column($this->getJson('/api/audit-logs')->assertOk()->json('data'), 'id'));
    }
}
