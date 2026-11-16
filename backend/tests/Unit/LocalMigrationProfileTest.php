<?php

namespace Tests\Unit;

use App\Support\LocalMigrationProfile;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;
use RuntimeException;

final class LocalMigrationProfileTest extends TestCase
{
    private function target(): array
    {
        return ['selected_migrations' => ['2026_01_01_000000_sample', '2026_11_17_000100_preserve_queue_state_vocabulary']];
    }

    public function test_exact_profile_requires_all_explicit_paths_and_supports_compatibility_directory(): void
    {
        $paths = LocalMigrationProfile::paths($this->target());
        $this->assertSame(['database/migrations/2026_01_01_000000_sample.php',
            'database/compatibility/2026_11_17_000100_preserve_queue_state_vocabulary.php'], $paths);
        LocalMigrationProfile::assertSelection('migrate', array_reverse($paths), $this->target());
        $this->addToAssertionCount(1);
    }

    public static function denied(): array
    {
        return [['migrate', []], ['migrate', ['database/migrations']], ['migrate:fresh', []],
            ['migrate:refresh', []], ['migrate:reset', []], ['migrate:rollback', []], ['db:wipe', []],
            ['migrate', ['database/migrations/2026_11_16_000500_update_queue_statuses_and_remove_urgent_priority.php']]];
    }

    #[DataProvider('denied')]
    public function test_default_held_or_destructive_commands_are_refused(string $command, array $paths): void
    {
        $this->expectException(RuntimeException::class);
        LocalMigrationProfile::assertSelection($command, $paths, $this->target());
    }

    public function test_unreviewed_proposal_paths_bytes_and_regular_runtimes_are_refused_before_environment_access(): void
    {
        $proposal = ['path' => 'docs/integration/proposals/2026_11_16_001000_add_conversation_dentist_grants.php',
            'sha256' => '9b53175b26d656c62c29524da742d7f654bc2a0ce1451704784bb101fae56612'];
        foreach ([['path' => 'unreviewed.php'], ['sha256' => str_repeat('0',64)], []] as $patch) {
            try {
                LocalMigrationProfile::paths($this->target()+['reviewed_proposal' => array_replace($proposal,$patch), 'runtime' => '/private/tmp/regular-demo']);
                $this->fail('An unreviewed or non-disposable proposal target must be refused.');
            } catch (RuntimeException $e) {
                $this->assertStringContainsString('new explicit disposable test cluster', $e->getMessage());
            }
        }
    }
}
