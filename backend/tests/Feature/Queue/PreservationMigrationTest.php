<?php

namespace Tests\Feature\Queue;

use App\Models\QueueEntry;
use App\Models\QueueEntryHistory;
use App\Models\Visit;
use Illuminate\Support\Facades\DB;
use Tests\Feature\Appointments\SchedulingFixture;
use Tests\Support\IsolatedDatabaseGuard;
use Tests\TestCase;

/** Explicit, transactional migration-owner verification in the owned test cluster; never part of ordinary tests. */
final class PreservationMigrationTest extends TestCase
{
    use SchedulingFixture;

    public function test_compatibility_preserves_every_legacy_state_priority_reason_revision_link_and_history(): void
    {
        if (getenv('DENTALOPS_SCHEMA_VERIFICATION') !== '1') {
            $this->markTestSkipped('Use the explicit isolated verify-schema command.');
        }
        $target = IsolatedDatabaseGuard::manifest();
        $config = config('database.connections.pgsql');
        $config['username'] = $target['user'];
        $config['password'] = trim(file_get_contents($target['runtime'].'/pg-password'));
        config(['database.connections.schema_owner' => $config]);
        $connection = DB::connection('schema_owner');
        IsolatedDatabaseGuard::identity($connection->selectOne(IsolatedDatabaseGuard::IDENTITY_SQL), $target);
        DB::setDefaultConnection('schema_owner');
        $connection->beginTransaction();
        try {
            $this->setUpSchedulingWorld();
            $queue = DB::table('dentist_queues')->insertGetId(['branch_id' => $this->b['b1']->id,
                'dentist_profile_id' => $this->d['d1']->id, 'clinic_date' => '2026-09-28', 'next_number' => 5]);
            foreach (['Waiting','Called','Treatment Ready','Temporarily Away','Served'] as $index => $status) {
                $visit = Visit::create(['patient_id' => $this->p['A']->id, 'branch_id' => $this->b['b1']->id,
                    'source' => 'walk_in', 'status' => 'Completed', 'responsible_dentist_profile_id' => $this->d['d1']->id,
                    'arrived_at' => now(), 'clinic_date' => '2026-09-28', 'closed_at' => now()]);
                $entry = QueueEntry::create(['visit_id' => $visit->id, 'dentist_queue_id' => $queue, 'queue_number' => $index+1,
                    'status' => $status, 'priority' => $index === 0 ? 'Urgent' : 'Normal', 'priority_reason' => 'Synthetic preserved reason',
                    'revision' => 7, 'closed_at' => $status === 'Served' ? now() : null]);
                QueueEntryHistory::create(['queue_entry_id' => $entry->id, 'event' => 'synthetic.preservation',
                    'to_status' => $status, 'to_priority' => $entry->priority, 'revision' => 7, 'occurred_at' => now()]);
            }
            $snapshot = fn () => [DB::table('queue_entries')->orderBy('id')->get()->toJson(), DB::table('queue_entry_history')->orderBy('id')->get()->toJson()];
            $before = $snapshot();
            $migration = require base_path('database/compatibility/2026_11_17_000100_preserve_queue_state_vocabulary.php');
            $migration->down(); // All seeded rows/history are exactly legacy; narrowing must preserve them.
            $this->assertSame($before, $snapshot());
            $migration->up();
            $this->assertSame($before, $snapshot());
            $migration->up(); // The SQL sequence itself is repeatable without row changes.
            $this->assertSame($before, $snapshot());
            $first = QueueEntry::orderBy('id')->firstOrFail();
            $first->update(['status' => 'In Queue']);
            $current = $snapshot();
            try {
                $migration->down();
                $this->fail('Non-legacy current state must refuse narrowing.');
            } catch (\RuntimeException $error) {
                $this->assertStringContainsString('Cannot narrow', $error->getMessage());
            }
            $this->assertSame($current, $snapshot());
            $first->update(['status' => 'Waiting']);
            QueueEntryHistory::create(['queue_entry_id' => $first->id, 'event' => 'synthetic.historical-state',
                'from_status' => 'No-show', 'to_status' => 'Waiting', 'to_priority' => 'Normal', 'revision' => 8, 'occurred_at' => now()]);
            $current = $snapshot();
            try {
                $migration->down();
                $this->fail('Non-legacy historical state must also refuse narrowing.');
            } catch (\RuntimeException $error) {
                $this->assertStringContainsString('Cannot narrow', $error->getMessage());
            }
            $this->assertSame($current, $snapshot());
            // The privileged schema owner is still prevented by the append-only trigger.
            $connection->statement('SAVEPOINT history_probe');
            try {
                DB::table('queue_entry_history')->update(['event' => 'must-not-change']);
                $this->fail('History trigger must remain active.');
            } catch (\Illuminate\Database\QueryException $error) {
                $this->assertStringContainsString('append-only', $error->getMessage());
                $connection->statement('ROLLBACK TO SAVEPOINT history_probe');
            }
            $this->assertSame($current, $snapshot());
        } finally {
            $connection->rollBack();
            DB::setDefaultConnection('pgsql');
            DB::purge('schema_owner');
        }
    }
}
