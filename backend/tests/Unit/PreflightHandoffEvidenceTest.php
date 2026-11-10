<?php

namespace Tests\Unit;

use Closure;
use Illuminate\Config\Repository;
use Illuminate\Database\DatabaseManager;
use Illuminate\Database\PostgresConnection;
use Illuminate\Foundation\Application;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;
use RuntimeException;
use Tests\Support\PreflightConfigurationValidator;
use Tests\Support\PreflightHandoffEvidence;

final class PreflightHandoffEvidenceTest extends TestCase
{
    private function world(): array
    {
        $state = (object) [
            'configuration' => new Repository(['database' => ['default' => 'pgsql', 'connections' => ['pgsql' => [
                'driver' => 'pgsql', 'database' => 'dental_clinic_scratch', 'host' => '127.0.0.1',
                'port' => 5432, 'url' => null, 'search_path' => 'public',
            ]]]]),
            'cached' => false, 'testing' => true, 'connections' => [], 'managerReads' => 0, 'onRead' => null,
        ];
        $app = $this->createMock(Application::class);
        $app->method('environment')->with('testing')->willReturnCallback(static fn (): bool => $state->testing);
        $app->method('configurationIsCached')->willReturnCallback(static fn (): bool => $state->cached);
        // No db/container binding resolution is permitted: provenance is of explicit caller arguments only.
        $app->method('offsetGet')->with('config')->willReturnCallback(static fn () => $state->configuration);
        $manager = $this->manager();
        $manager->method('getConnections')->willReturnCallback(static function () use ($state): array {
            $state->managerReads++;
            if ($state->onRead !== null) {
                ($state->onRead)();
            }
            return $state->connections;
        });
        return [$app, $manager, $state];
    }

    private function manager(): DatabaseManager
    {
        $manager = $this->createMock(DatabaseManager::class);
        foreach (['connection', 'build', 'connectUsing', 'reconnect', 'disconnect', 'purge', '__call'] as $method) {
            $manager->expects($this->never())->method($method);
        }
        return $manager;
    }

    private function assertRejectedBeforeHandoff(Closure $consume, string $message): void
    {
        $handoffs = 0;
        $rejection = null;
        try {
            $consume();
            $handoffs++; // Local simulation only; no callback, kernel or database operation is run.
        } catch (RuntimeException $exception) {
            $rejection = $exception;
        }
        self::assertNotNull($rejection, 'Stale evidence must not permit simulated execution.');
        self::assertSame($message, $rejection->getMessage());
        self::assertSame(0, $handoffs);
    }

    public static function drift(): array
    {
        return [
            'database' => ['database.connections.pgsql.database', 'unverified_fixture'],
            'host' => ['database.connections.pgsql.host', '192.0.2.10'],
            'port' => ['database.connections.pgsql.port', 6543],
            'URL' => ['database.connections.pgsql.url', 'postgresql://example.invalid/scratch'],
            'alias' => ['database.connections.alias', ['driver' => 'pgsql']],
            'read' => ['database.connections.pgsql.read', ['host' => '192.0.2.10']],
            'write' => ['database.connections.pgsql.write', ['host' => '192.0.2.10']],
            'direct' => ['database.connections.pgsql.direct', ['host' => '192.0.2.10']],
            'driver' => ['database.connections.pgsql.driver', 'mysql'],
            'profile-valid port type change' => ['database.connections.pgsql.port', '5432'],
            'profile-valid URL shape change' => ['database.connections.pgsql.url', ''],
            'profile-valid username addition' => ['database.connections.pgsql.username', 'synthetic_role'],
        ];
    }

    #[DataProvider('drift')]
    public function test_changed_snapshot_rejects_handoff_without_repair(string $path, mixed $value): void
    {
        [$app, $manager, $state] = $this->world();
        $evidence = PreflightHandoffEvidence::capture($app, $manager);
        $state->configuration->set($path, $value);
        $this->assertRejectedBeforeHandoff(
            fn () => $evidence->consumeBeforeSimulatedHandoff($app, $manager),
            'Preflight evidence configuration changed.'
        );
        self::assertSame($value, $state->configuration->get($path));
        self::assertSame(1, $state->managerReads);
    }

    public function test_unchanged_evidence_is_revalidated_and_single_use(): void
    {
        [$app, $manager, $state] = $this->world();
        $evidence = PreflightHandoffEvidence::capture($app, $manager);
        $evidence->consumeBeforeSimulatedHandoff($app, $manager);
        self::assertSame(2, $state->managerReads);
        $this->assertRejectedBeforeHandoff(fn () => $evidence->consumeBeforeSimulatedHandoff($app, $manager), 'Preflight evidence is unavailable or already consumed.');
        self::assertSame(2, $state->managerReads);
    }

    public function test_replacement_manager_with_identical_settings_is_rejected(): void
    {
        [$app, $manager] = $this->world();
        $evidence = PreflightHandoffEvidence::capture($app, $manager);
        $replacement = $this->manager();
        $replacement->expects($this->never())->method('getConnections');
        $this->assertRejectedBeforeHandoff(fn () => $evidence->consumeBeforeSimulatedHandoff($app, $replacement), 'Preflight evidence dependency identity changed.');
    }

    public function test_replacement_application_is_rejected(): void
    {
        [$app, $manager] = $this->world();
        [$replacement] = $this->world();
        $evidence = PreflightHandoffEvidence::capture($app, $manager);
        $this->assertRejectedBeforeHandoff(fn () => $evidence->consumeBeforeSimulatedHandoff($replacement, $manager), 'Preflight evidence dependency identity changed.');
    }

    public function test_replacement_repository_with_equal_values_is_rejected(): void
    {
        [$app, $manager, $state] = $this->world();
        $evidence = PreflightHandoffEvidence::capture($app, $manager);
        $state->configuration = new Repository($state->configuration->all());
        $this->assertRejectedBeforeHandoff(fn () => $evidence->consumeBeforeSimulatedHandoff($app, $manager), 'Preflight evidence configuration changed.');
    }

    public function test_invalidating_old_evidence_allows_a_separate_new_capture_only(): void
    {
        [$app, $manager] = $this->world();
        $old = PreflightHandoffEvidence::capture($app, $manager);
        $old->invalidate();
        $new = PreflightHandoffEvidence::capture($app, $manager);
        $this->assertRejectedBeforeHandoff(fn () => $old->consumeBeforeSimulatedHandoff($app, $manager), 'Preflight evidence is unavailable or already consumed.');
        $new->consumeBeforeSimulatedHandoff($app, $manager);
    }

    public function test_rejected_attempt_cannot_be_reused_after_configuration_is_restored(): void
    {
        [$app, $manager, $state] = $this->world();
        $evidence = PreflightHandoffEvidence::capture($app, $manager);
        $state->configuration->set('database.connections.pgsql.host', '192.0.2.10');
        $this->assertRejectedBeforeHandoff(fn () => $evidence->consumeBeforeSimulatedHandoff($app, $manager), 'Preflight evidence configuration changed.');
        $state->configuration->set('database.connections.pgsql.host', '127.0.0.1');
        $this->assertRejectedBeforeHandoff(fn () => $evidence->consumeBeforeSimulatedHandoff($app, $manager), 'Preflight evidence is unavailable or already consumed.');
    }

    public function test_observable_cache_state_change_rejects_handoff(): void
    {
        [$app, $manager, $state] = $this->world();
        $evidence = PreflightHandoffEvidence::capture($app, $manager);
        $state->cached = true;
        $this->assertRejectedBeforeHandoff(fn () => $evidence->consumeBeforeSimulatedHandoff($app, $manager), 'Preflight rejected: cached configuration is unsupported.');
        self::assertSame(1, $state->managerReads);
    }

    public function test_environment_change_rejects_handoff(): void
    {
        [$app, $manager, $state] = $this->world();
        $evidence = PreflightHandoffEvidence::capture($app, $manager);
        $state->testing = false;
        $this->assertRejectedBeforeHandoff(fn () => $evidence->consumeBeforeSimulatedHandoff($app, $manager), 'Preflight rejected: testing environment required.');
    }

    public static function resolvedNames(): array
    {
        return [['pgsql'], ['other']];
    }

    #[DataProvider('resolvedNames')]
    public function test_newly_resolved_object_rejects_handoff_without_touching_object(string $name): void
    {
        [$app, $manager, $state] = $this->world();
        $evidence = PreflightHandoffEvidence::capture($app, $manager);
        $connection = $this->createMock(PostgresConnection::class);
        foreach (['selectOne', 'getPdo', 'getReadPdo', 'getDirectPdo', 'statement', 'unprepared', 'transaction', 'beginTransaction'] as $method) {
            $connection->expects($this->never())->method($method);
        }
        $state->connections = [$name => $connection];
        $this->assertRejectedBeforeHandoff(fn () => $evidence->consumeBeforeSimulatedHandoff($app, $manager), 'Preflight rejected: resolved connection objects already exist.');
    }

    public function test_snapshot_changes_during_capture_cannot_issue_evidence(): void
    {
        [$app, $manager, $state] = $this->world();
        $state->onRead = static fn () => $state->configuration->set('database.connections.pgsql.host', '192.0.2.10');
        $this->assertRejectedBeforeHandoff(fn () => PreflightHandoffEvidence::capture($app, $manager), 'Preflight evidence configuration changed.');
    }

    public function test_snapshot_changes_during_revalidation_reject_handoff(): void
    {
        [$app, $manager, $state] = $this->world();
        $evidence = PreflightHandoffEvidence::capture($app, $manager);
        $state->onRead = static fn () => $state->configuration->set('database.connections.pgsql.port', 6543);
        $this->assertRejectedBeforeHandoff(fn () => $evidence->consumeBeforeSimulatedHandoff($app, $manager), 'Preflight evidence configuration changed.');
    }

    public function test_restored_configuration_and_cache_state_have_no_observable_history(): void
    {
        [$app, $manager, $state] = $this->world();
        $evidence = PreflightHandoffEvidence::capture($app, $manager);
        $state->configuration->set('database.connections.pgsql.host', '192.0.2.10');
        $state->cached = true;
        $state->configuration->set('database.connections.pgsql.host', '127.0.0.1');
        $state->cached = false;
        $evidence->consumeBeforeSimulatedHandoff($app, $manager);
        self::assertSame(2, $state->managerReads); // Current snapshots cannot attest to unseen history.
    }

    public function test_new_capture_does_not_implicitly_revoke_other_evidence(): void
    {
        [$app, $manager, $state] = $this->world();
        $old = PreflightHandoffEvidence::capture($app, $manager);
        $new = PreflightHandoffEvidence::capture($app, $manager);
        $old->consumeBeforeSimulatedHandoff($app, $manager);
        $new->consumeBeforeSimulatedHandoff($app, $manager);
        self::assertSame(4, $state->managerReads); // No global ticket registry or automatic supersession exists.
    }

    public function test_caller_supplying_original_manager_cannot_reveal_an_unreported_replacement(): void
    {
        [$app, $manager, $state] = $this->world();
        $evidence = PreflightHandoffEvidence::capture($app, $manager);
        $replacement = $this->manager();
        $replacement->expects($this->never())->method('getConnections');
        $runnerReference = $replacement;
        // Deliberately supply the stale reference: the helper cannot inspect a runner-local variable.
        $evidence->consumeBeforeSimulatedHandoff($app, $manager);
        self::assertNotSame($manager, $runnerReference);
        self::assertSame(2, $state->managerReads);
    }

    public function test_evidence_cannot_be_serialized_into_a_persisted_token(): void
    {
        [$app, $manager] = $this->world();
        $evidence = PreflightHandoffEvidence::capture($app, $manager);
        $this->expectException(RuntimeException::class);
        $this->expectExceptionMessage('Preflight evidence cannot be serialized.');
        serialize($evidence);
    }

    public function test_plain_validator_recheck_also_rejects_current_drift_without_tracking_history(): void
    {
        [$app, $manager, $state] = $this->world();
        PreflightConfigurationValidator::assertSafe($app, $manager);
        $state->configuration->set('database.connections.pgsql.database', 'unverified_fixture');
        $this->assertRejectedBeforeHandoff(fn () => PreflightConfigurationValidator::assertSafe($app, $manager), 'Preflight rejected: unsupported scratch connection target.');
    }

    public function test_laravel_cached_false_marker_returns_without_rechecking_cache_path(): void
    {
        // Exercise Laravel's actual method while replacing only its container/path dependencies.
        $app = $this->getMockBuilder(Application::class)->disableOriginalConstructor()
            ->onlyMethods(['bound', 'make', 'getCachedConfigPath'])->getMock();
        $app->expects($this->once())->method('bound')->with('config_loaded_from_cache')->willReturn(true);
        $app->expects($this->once())->method('make')->with('config_loaded_from_cache')->willReturn(false);
        $app->expects($this->never())->method('getCachedConfigPath');
        self::assertFalse($app->configurationIsCached());
    }
}
