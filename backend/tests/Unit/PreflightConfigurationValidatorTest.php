<?php

namespace Tests\Unit;

use Illuminate\Config\Repository;
use Illuminate\Database\DatabaseManager;
use Illuminate\Database\PostgresConnection;
use Illuminate\Foundation\Application;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;
use RuntimeException;
use Tests\Support\PreflightConfigurationValidator;

final class PreflightConfigurationValidatorTest extends TestCase
{
    private static function configuration(): array
    {
        return ['database' => ['default' => 'pgsql', 'connections' => ['pgsql' => [
            'driver' => 'pgsql', 'database' => 'dental_clinic_scratch', 'host' => '127.0.0.1', 'port' => 5432,
            'url' => null, 'search_path' => 'public', 'charset' => 'utf8', 'prefix' => '',
            'prefix_indexes' => true, 'sslmode' => 'prefer',
        ]]]];
    }

    private function application(array $config, bool $testing = true, bool $cached = false): Application
    {
        $app = $this->createMock(Application::class);
        $app->method('environment')->with('testing')->willReturn($testing);
        $app->method('configurationIsCached')->willReturn($cached);
        $app->method('offsetGet')->with('config')->willReturn(new Repository($config));
        return $app;
    }

    private function manager(): DatabaseManager
    {
        $manager = $this->createMock(DatabaseManager::class);
        foreach (['connection', 'build', 'connectUsing', 'reconnect', 'disconnect', 'purge', '__call'] as $method) {
            $manager->expects($this->never())->method($method);
        }
        return $manager;
    }

    public static function rejectedConfigurations(): array
    {
        $valid = self::configuration();
        $single = 'Preflight rejected: exactly one named pgsql connection is required.';
        $target = 'Preflight rejected: unsupported scratch connection target.';
        $override = 'Preflight rejected: connection overrides or unknown options are unsupported.';
        $cases = ['no database config' => [[], $single]];
        foreach (['database.default' => null, 'database.connections' => null, 'database.connections.pgsql' => null] as $path => $value) {
            $config = new Repository($valid);
            $config->set($path, $value);
            $cases['missing '.$path] = [$config->all(), $single];
        }
        $config = $valid;
        $config['database']['default'] = 'mysql';
        $cases['wrong default'] = [$config, $single];
        $config = $valid;
        $config['database']['connections']['pgsql'] = 'postgresql://example.invalid/scratch';
        $cases['string connection URL'] = [$config, $single];
        foreach (['mysql', 'pgsql_alias'] as $name) {
            $config = $valid;
            $config['database']['connections'][$name] = $valid['database']['connections']['pgsql'];
            $cases['alternate '.$name] = [$config, $single];
        }
        foreach ([
            'driver' => ['mysql', 'postgres', null],
            'database' => ['dental_clinic', 'dental_clinic_demo', 'dental_clinic_test', null],
            'host' => ['localhost', ['127.0.0.1'], '192.0.2.10', null],
            'port' => [6543, '5432junk', 5432.0, null],
            'url' => ['postgresql://example.invalid/scratch', ' ', false, 0, []],
            'search_path' => ['private', ['public'], null],
        ] as $key => $values) {
            foreach ($values as $index => $value) {
                $config = $valid;
                $config['database']['connections']['pgsql'][$key] = $value;
                $cases[$key.' rejected variant '.$index] = [$config, $target];
            }
        }
        foreach (['read', 'write', 'direct'] as $key) {
            foreach ([null, [], false, ['host' => '192.0.2.10'], [['host' => '127.0.0.1'], ['host' => '192.0.2.10']]] as $index => $value) {
                $config = $valid;
                $config['database']['connections']['pgsql'][$key] = $value;
                $cases[$key.' override '.$index] = [$config, $override];
            }
        }
        foreach (['pooled' => true, 'connect_via_database' => 'other', 'connect_via_port' => 6543, 'options' => [], 'future_option' => null] as $key => $value) {
            $config = $valid;
            $config['database']['connections']['pgsql'][$key] = $value;
            $cases['unsupported '.$key] = [$config, $override];
        }
        foreach (['charset' => 'other', 'prefix' => 'other_', 'prefix_indexes' => false, 'sslmode' => 'disable'] as $key => $value) {
            $config = $valid;
            $config['database']['connections']['pgsql'][$key] = $value;
            $cases['unsupported setting '.$key] = [$config, 'Preflight rejected: unsupported connection settings.'];
        }
        foreach (['username', 'password'] as $key) {
            $config = $valid;
            $config['database']['connections']['pgsql'][$key] = [];
            $cases['malformed credential field '.$key] = [$config, 'Preflight rejected: credential fields must be strings.'];
        }
        return $cases;
    }

    #[DataProvider('rejectedConfigurations')]
    public function test_rejects_unsupported_configuration_without_resolving_connections(array $config, string $message): void
    {
        $manager = $this->manager();
        $manager->expects($this->never())->method('getConnections');
        $this->expectException(RuntimeException::class);
        $this->expectExceptionMessage($message);
        PreflightConfigurationValidator::assertSafe($this->application($config), $manager);
    }

    public function test_rejects_non_testing_environment_without_inspecting_manager(): void
    {
        $manager = $this->manager();
        $manager->expects($this->never())->method('getConnections');
        $this->expectException(RuntimeException::class);
        $this->expectExceptionMessage('Preflight rejected: testing environment required.');
        PreflightConfigurationValidator::assertSafe($this->application(self::configuration(), testing: false), $manager);
    }

    public function test_rejects_cached_configuration_without_inspecting_manager(): void
    {
        $manager = $this->manager();
        $manager->expects($this->never())->method('getConnections');
        $this->expectException(RuntimeException::class);
        $this->expectExceptionMessage('Preflight rejected: cached configuration is unsupported.');
        PreflightConfigurationValidator::assertSafe($this->application(self::configuration(), cached: true), $manager);
    }

    public static function resolvedNames(): array
    {
        return array_map(static fn (string $name): array => [$name], ['pgsql', 'other', 'pgsql::read', 'pgsql::write', 'pgsql::direct']);
    }

    #[DataProvider('resolvedNames')]
    public function test_rejects_existing_connection_objects_without_touching_them(string $name): void
    {
        $connection = $this->createMock(PostgresConnection::class);
        foreach (['selectOne', 'getPdo', 'getReadPdo', 'getDirectPdo', 'statement', 'unprepared', 'transaction', 'beginTransaction'] as $method) {
            $connection->expects($this->never())->method($method);
        }
        $manager = $this->manager();
        $manager->expects($this->once())->method('getConnections')->willReturn([$name => $connection]);
        $this->expectException(RuntimeException::class);
        $this->expectExceptionMessage('Preflight rejected: resolved connection objects already exist.');
        PreflightConfigurationValidator::assertSafe($this->application(self::configuration()), $manager);
    }

    public static function acceptedTargets(): array
    {
        $cases = [];
        foreach ([5432, '5432'] as $portIndex => $port) {
            foreach (['null', 'empty', 'absent'] as $urlShape) {
                $config = self::configuration();
                $config['database']['connections']['pgsql']['port'] = $port;
                if ($urlShape === 'absent') {
                    unset($config['database']['connections']['pgsql']['url']);
                } else {
                    $config['database']['connections']['pgsql']['url'] = $urlShape === 'empty' ? '' : null;
                }
                $cases['port '.$portIndex.' / URL '.$urlShape] = [$config];
            }
        }
        return $cases;
    }

    #[DataProvider('acceptedTargets')]
    public function test_accepts_only_the_proposed_cold_single_connection_profile(array $config): void
    {
        $app = $this->application($config);
        $manager = $this->manager();
        $manager->expects($this->once())->method('getConnections')->willReturn([]);
        PreflightConfigurationValidator::assertSafe($app, $manager);
        // Validation must not normalize or repair the caller's supplied snapshot.
        self::assertSame($config, $app['config']->all());
    }

    public function test_manager_inspection_exception_propagates_without_acceptance(): void
    {
        $failure = new RuntimeException('Synthetic manager inspection failure.');
        $manager = $this->manager();
        $manager->expects($this->once())->method('getConnections')->willThrowException($failure);
        try {
            PreflightConfigurationValidator::assertSafe($this->application(self::configuration()), $manager);
        } catch (RuntimeException $caught) {
            self::assertSame($failure, $caught);
            return;
        }
        self::fail('Preflight silently accepted an unavailable manager snapshot.');
    }
}
