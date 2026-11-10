<?php

namespace Tests\Unit;

use Illuminate\Cache\CacheServiceProvider;
use Illuminate\Cache\RateLimiter;
use Illuminate\Config\Repository;
use Illuminate\Container\Container;
use Illuminate\Database\Connectors\ConnectionFactory;
use Illuminate\Database\DatabaseManager;
use Illuminate\Database\PostgresConnection;
use Illuminate\Foundation\Application;
use PHPUnit\Framework\TestCase;
use RuntimeException;
use Tests\Support\ScratchDatabaseGuard;

require_once __DIR__.'/../Support/ScratchDatabaseGuard.php';

/** Characterizes coverage boundaries, not safe infrastructure. No Laravel boot or real connector/PDO. */
final class ScratchDatabaseGuardBoundaryTest extends TestCase
{
    private string|false $previousAddress;

    protected function setUp(): void
    {
        $this->previousAddress = getenv('TEST_SCRATCH_SERVER_ADDRESS');
        putenv('TEST_SCRATCH_SERVER_ADDRESS');
    }

    protected function tearDown(): void
    {
        putenv($this->previousAddress === false ? 'TEST_SCRATCH_SERVER_ADDRESS' : 'TEST_SCRATCH_SERVER_ADDRESS='.$this->previousAddress);
    }

    private function world(): array
    {
        $config = new Repository(['database' => ['default' => 'pgsql', 'connections' => ['pgsql' => [
            'driver' => 'pgsql', 'database' => 'dental_clinic_scratch', 'host' => '127.0.0.1', 'port' => 5432, 'url' => null,
        ]]]]);
        $app = $this->createMock(Application::class);
        $app->method('environment')->with('testing')->willReturn(true);
        $app->method('bound')->willReturn(false);
        $factory = $this->createMock(ConnectionFactory::class);
        // The real manager's cache/selection logic runs; every factory result is a mock.
        $manager = new DatabaseManager($app, $factory);
        $app->method('offsetGet')->willReturnMap([['config', $config], ['db', $manager]]);
        return [$app, $config, $manager, $factory];
    }

    private function connection(?string $identityDatabase = 'dental_clinic_scratch'): PostgresConnection
    {
        $connection = $this->createMock(PostgresConnection::class);
        $connection->method('setReadWriteType')->willReturnSelf();
        foreach (['getPdo', 'getReadPdo', 'getDirectPdo', 'statement', 'unprepared', 'insert', 'update', 'delete', 'transaction', 'beginTransaction'] as $method) {
            $connection->expects($this->never())->method($method);
        }
        if ($identityDatabase === null) {
            $connection->expects($this->never())->method('selectOne');
        } else {
            $connection->expects($this->once())->method('selectOne')->with($this->callback(
                static fn (string $sql): bool => preg_replace('/\s+/', ' ', trim($sql)) ===
                    'SELECT current_database() AS database_name, host(inet_server_addr()) AS server_address, inet_server_port() AS server_port'
            ))->willReturn((object) ['database_name' => $identityDatabase, 'server_address' => '127.0.0.1', 'server_port' => 5432]);
        }
        return $connection;
    }

    public function test_default_guard_does_not_validate_a_separately_named_connection(): void
    {
        [$app, $config, $manager, $factory] = $this->world();
        $config->set('database.connections.unverified', [
            'driver' => 'pgsql', 'database' => 'unverified_fixture', 'host' => '192.0.2.10', 'port' => 5433,
        ]);
        $default = $this->connection();
        $other = $this->connection(null);
        $factory->expects($this->exactly(2))->method('make')->willReturnCallback(
            static function (array $configuration, string $name) use ($default, $other) {
                self::assertContains($name, ['pgsql', 'unverified']);
                return $name === 'pgsql' ? $default : $other;
            }
        );
        ScratchDatabaseGuard::assertSafe($app);
        self::assertSame($other, $manager->connection('unverified'));
        // No identity SELECT on "unverified": default validation is not a manager-wide firewall.
    }

    public function test_cached_connection_is_reused_but_its_wrong_actual_identity_is_rejected(): void
    {
        [$app, $config, $manager, $factory] = $this->world();
        $config->set('database.connections.pgsql.database', 'unverified_fixture');
        $cached = $this->connection('unverified_fixture');
        $factory->expects($this->once())->method('make')->with($this->callback(
            static fn (array $configuration): bool => $configuration['database'] === 'unverified_fixture'
        ), 'pgsql')->willReturn($cached);
        self::assertSame($cached, $manager->connection('pgsql'));
        $config->set('database.connections.pgsql.database', 'dental_clinic_scratch');
        self::assertSame($cached, $manager->connection('pgsql'));
        $this->expectException(RuntimeException::class);
        $this->expectExceptionMessage('the actual PostgreSQL server identity did not match');
        ScratchDatabaseGuard::assertSafe($app);
    }

    public function test_nested_driver_is_not_a_guard_validation_field(): void
    {
        [$app, $config, , $factory] = $this->world();
        $config->set('database.connections.pgsql.driver', 'mysql');
        $connection = $this->connection();
        $factory->expects($this->once())->method('make')->with($this->callback(
            static fn (array $configuration): bool => $configuration['driver'] === 'mysql'
        ), 'pgsql')->willReturn($connection);
        // Synthetic identity is deliberate: this does not claim a real MySQL server can answer PostgreSQL SQL.
        ScratchDatabaseGuard::assertSafe($app);
    }

    public function test_database_backed_rate_limiter_resolves_connection_objects_without_identity_validation(): void
    {
        $container = new Container();
        $container->instance('config', new Repository(['cache' => [
            'default' => 'database', 'prefix' => '', 'stores' => ['database' => ['driver' => 'database', 'table' => 'cache']],
        ]]));
        $connection = $this->connection(null);
        $manager = $this->createMock(DatabaseManager::class);
        $manager->expects($this->exactly(2))->method('connection')->with(null)->willReturn($connection);
        $container->instance('db', $manager);
        (new CacheServiceProvider($container))->register();
        self::assertInstanceOf(RateLimiter::class, $container->make(RateLimiter::class));
        // This component is resolved during provider boot in the app. No guard or SQL was invoked here.
    }
}
