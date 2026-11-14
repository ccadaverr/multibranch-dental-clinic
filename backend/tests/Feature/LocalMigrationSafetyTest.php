<?php

namespace Tests\Feature;

use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\DB;
use RuntimeException;
use Tests\TestCase;

/** Executes actual command boundaries under APP_ENV=testing, where Laravel omits Symfony command events. */
final class LocalMigrationSafetyTest extends TestCase
{
    public function test_default_chain_is_refused_and_destructive_commands_cannot_change_the_reviewed_schema(): void
    {
        if (! getenv('DENTALOPS_LOCAL_TARGET')) $this->markTestSkipped('Explicit owned local target required.');
        $snapshot = fn () => [DB::table('migrations')->orderBy('migration')->pluck('migration')->all(),
            DB::select("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename"),
            DB::table('queue_entry_history')->count()];
        $before = $snapshot();
        $privileges = DB::selectOne("SELECT has_table_privilege(current_user, 'queue_entry_history', 'TRUNCATE')::int AS can_truncate,
            has_table_privilege(current_user, 'migrations', 'DELETE')::int AS can_rewrite_ledger");
        $this->assertSame(0, (int) $privileges->can_truncate);
        $this->assertSame(0, (int) $privileges->can_rewrite_ledger);
        try {
            Artisan::call('migrate', ['--force' => true]);
            $this->fail('Default migration discovery must refuse the first held file.');
        } catch (RuntimeException $error) {
            $this->assertStringContainsString('held', $error->getMessage());
        }
        $this->assertEquals($before, $snapshot());
        foreach (['db:wipe','migrate:fresh','migrate:refresh','migrate:reset','migrate:rollback'] as $command) {
            $this->assertSame(1, Artisan::call($command, ['--force' => true]), $command);
            $this->assertEquals($before, $snapshot());
        }
    }
}
