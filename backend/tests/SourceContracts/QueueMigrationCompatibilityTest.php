<?php

namespace Tests\SourceContracts;

use App\Models\QueueEntry;
use App\Services\Queue\QueueService;
use PHPUnit\Framework\TestCase;

/**
 * Explicitly invoked audit checks, outside the default Unit/Feature suites.
 * Reads source and class constants only: no Laravel boot, migration include/eval,
 * SQL execution, database connection, or claim of PostgreSQL integration coverage.
 * Safety assertions intentionally fail while the audited incompatibilities remain.
 */
final class QueueMigrationCompatibilityTest extends TestCase
{
    private function source(string $path): string
    {
        $file = dirname(__DIR__, 2).'/'.$path;
        self::assertFileExists($file);
        return (string) file_get_contents($file);
    }

    private function migration(string $method): string
    {
        $source = $this->source('database/migrations/2026_11_16_000500_update_queue_statuses_and_remove_urgent_priority.php');
        $parts = explode('public function down(): void', $source, 2);
        self::assertCount(2, $parts);
        return $method === 'up' ? $parts[0] : $parts[1];
    }

    /** Extract only the literal status UPDATE shape used by this migration; never execute it. */
    private function mappings(string $method): array
    {
        preg_match_all("/UPDATE queue_entries SET status = '([^']+)'[^\"\n]*? WHERE status (?:IN \(([^)]+)\)|= '([^']+)')/", $this->migration($method), $matches, PREG_SET_ORDER);
        self::assertCount(3, $matches, 'Review this source parser if the migration SQL shape changes.');
        $map = [];
        foreach ($matches as $match) {
            preg_match_all("/'([^']+)'/", $match[2] ?: "'".$match[3]."'", $sources);
            foreach ($sources[1] as $from) {
                $map[$from] = $match[1];
            }
        }
        return $map;
    }

    public function test_forward_status_updates_replace_incompatible_legacy_checks_first(): void
    {
        $legacy = $this->source('database/migrations/2026_10_01_000100_create_queue_tables.php');
        self::assertStringContainsString("CHECK (status IN ('Waiting','Called','Treatment Ready','Temporarily Away','Served'))", $legacy);
        self::assertStringContainsString("CHECK ((status = 'Served') = (closed_at IS NOT NULL))", $legacy);
        $up = $this->migration('up');
        $update = strpos($up, 'UPDATE queue_entries SET status');
        foreach (['queue_entries_status_check', 'queue_entries_closed_check'] as $constraint) {
            $drop = strpos($up, 'DROP CONSTRAINT IF EXISTS '.$constraint);
            self::assertNotFalse($drop);
            self::assertLessThan($update, $drop, $constraint.' remains active during incompatible status conversion.');
        }
    }

    public function test_converted_states_remain_accepted_by_existing_named_commands(): void
    {
        $map = $this->mappings('up');
        $incompatible = [];
        foreach (QueueService::TRANSITIONS as $command => [$sources]) {
            foreach ($sources as $source) {
                $converted = $map[$source] ?? $source;
                if (! in_array($converted, $sources, true)) {
                    $incompatible[] = "$command: $source -> $converted";
                }
            }
        }
        self::assertSame([], $incompatible, 'Converted live entries lose their existing command paths.');
    }

    public function test_forward_and_reverse_mapping_preserve_each_original_status(): void
    {
        $down = $this->mappings('down');
        $losses = [];
        foreach ($this->mappings('up') as $original => $converted) {
            if (($down[$converted] ?? $converted) !== $original) {
                $losses[] = $original.' -> '.$converted.' -> '.($down[$converted] ?? $converted);
            }
        }
        self::assertSame([], $losses, 'A many-to-one conversion cannot be reversed from status alone.');
    }

    public function test_current_urgent_reason_is_not_erased_without_recovery_evidence(): void
    {
        self::assertStringNotContainsString(
            "SET priority = 'Normal', priority_reason = NULL WHERE priority = 'Urgent'",
            $this->migration('up'),
            'No per-entry original-value journal or restoration exists in this migration.'
        );
    }

    public function test_target_status_constraint_matches_model_vocabulary(): void
    {
        preg_match("/ADD CONSTRAINT queue_entries_status_check CHECK \(status IN \(([^)]+)\)/", $this->migration('up'), $constraint);
        self::assertNotEmpty($constraint);
        preg_match_all("/'([^']+)'/", $constraint[1], $statuses);
        self::assertSame(QueueEntry::STATUSES, $statuses[1]);
    }

    public function test_target_migration_contains_no_history_mutation_or_trigger_bypass(): void
    {
        $source = $this->migration('up').$this->migration('down');
        self::assertDoesNotMatchRegularExpression('/(?:UPDATE\s+queue_entry_history|DELETE\s+FROM\s+queue_entry_history|TRUNCATE\s+queue_entry_history|DISABLE\s+TRIGGER|DROP\s+TRIGGER)/i', $source);
    }

    public function test_rollback_checks_both_status_sources_before_any_mutation(): void
    {
        $down = $this->migration('down');
        $firstMutation = strpos($down, 'DB::statement(');
        self::assertNotFalse($firstMutation);
        foreach (['SELECT COUNT(*) FROM queue_entries', 'SELECT COUNT(*) FROM queue_entry_history', 'throw new \\RuntimeException'] as $guard) {
            $position = strpos($down, $guard);
            self::assertNotFalse($position);
            self::assertLessThan($firstMutation, $position);
        }
    }
}
