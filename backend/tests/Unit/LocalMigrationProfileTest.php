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

    public function test_operations_directory_is_explicitly_opted_in_without_changing_original_paths(): void
    {
        $target = $this->target();
        $target['operations_migrations'] = ['2026_11_18_000100_create_notification_archives.php'];
        $target['selected_migrations'][] = '2026_11_18_000100_create_notification_archives';
        $paths = LocalMigrationProfile::paths($target);
        $this->assertSame('database/operations/2026_11_18_000100_create_notification_archives.php', $paths[2]);
        LocalMigrationProfile::assertSelection('migrate', $paths, $target);
        $target['operations_migrations'] = ['unreviewed.php'];
        $this->expectException(RuntimeException::class);
        LocalMigrationProfile::paths($target);
    }

    public function test_draft_extension_requires_explicit_paths_and_preserves_archive_opt_in(): void
    {
        foreach ([['2026_11_19_000100_create_staff_roster_drafts.php'], ['2026_11_18_000100_create_notification_archives.php','2026_11_19_000100_create_staff_roster_drafts.php']] as $extensions) {
            $target=$this->target(); $target['operations_migrations']=$extensions;
            foreach ($extensions as $file) $target['selected_migrations'][]=substr($file,0,-4);
            $paths=LocalMigrationProfile::paths($target);
            $this->assertSame('database/operations/2026_11_19_000100_create_staff_roster_drafts.php',end($paths));
            LocalMigrationProfile::assertSelection('migrate',$paths,$target);
            try { LocalMigrationProfile::assertSelection('migrate',array_slice($paths,0,-1),$target); $this->fail('Partial path selection must fail'); }
            catch (RuntimeException) { $this->addToAssertionCount(1); }
        }
    }

    public function test_leave_receipts_are_an_explicit_opt_in_with_all_original_paths_required(): void
    {
        $approved=['2026_11_18_000100_create_notification_archives.php','2026_11_19_000100_create_staff_roster_drafts.php','2026_11_20_000100_add_leave_command_recovery.php'];
        for($mask=0;$mask<8;$mask++){
            $extensions=[];foreach($approved as $i=>$file)if($mask&(1<<$i))$extensions[]=$file;
            $target=$this->target();$target['operations_migrations']=$extensions;
            foreach($extensions as $file)$target['selected_migrations'][]=substr($file,0,-4);
            $paths=LocalMigrationProfile::paths($target);
            $this->assertCount(2+count($extensions),$paths);LocalMigrationProfile::assertSelection('migrate',$paths,$target);
        }
        $target['operations_migrations'][]=$approved[0];
        $this->expectException(RuntimeException::class);LocalMigrationProfile::paths($target);
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
