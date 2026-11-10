<?php

namespace Tests\Unit;

use Illuminate\Config\Repository;
use Illuminate\Database\DatabaseManager;
use Illuminate\Database\PostgresConnection;
use Illuminate\Database\QueryException;
use Illuminate\Foundation\Application;
use PDOException;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;
use RuntimeException;
use Tests\Support\ScratchDatabaseGuard;
use Throwable;

require_once __DIR__.'/../Support/ScratchDatabaseGuard.php';

/** Exercises the real guard with constructor-disabled mocks; never boots Laravel or constructs PDO. */
final class ScratchDatabaseGuardExceptionTest extends TestCase
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

    private function application(DatabaseManager $manager): Application
    {
        $config = new Repository(['database' => ['default' => 'pgsql', 'connections' => ['pgsql' => [
            'driver' => 'pgsql', 'database' => 'dental_clinic_scratch',
            'host' => '127.0.0.1', 'port' => 5432, 'url' => null,
        ]]]]);
        $app = $this->createMock(Application::class);
        $app->method('environment')->with('testing')->willReturn(true);
        $app->method('offsetGet')->willReturnMap([['config', $config], ['db', $manager]]);
        return $app;
    }

    private function manager(): DatabaseManager
    {
        $manager = $this->createMock(DatabaseManager::class);
        foreach (['reconnect', 'disconnect', 'purge', 'build', 'connectUsing', '__call'] as $method) {
            $manager->expects($this->never())->method($method);
        }
        return $manager;
    }

    private function readOnlyConnection(): PostgresConnection
    {
        $connection = $this->createMock(PostgresConnection::class);
        foreach ([
            'statement', 'unprepared', 'insert', 'update', 'delete', 'affectingStatement',
            'transaction', 'beginTransaction', 'commit', 'rollBack',
            'getPdo', 'getRawPdo', 'getReadPdo', 'select', 'cursor', 'reconnect',
        ] as $method) {
            $connection->expects($this->never())->method($method);
        }
        return $connection;
    }

    public static function exceptionKinds(): array
    {
        return ['manager/runtime exception' => ['runtime'], 'PDO exception' => ['pdo'], 'query exception' => ['query']];
    }

    private function failure(string $kind): Throwable
    {
        return match ($kind) {
            'runtime' => new RuntimeException('Synthetic connection failure.', 17),
            'pdo' => new PDOException('Synthetic PDO failure.', 18),
            // This constructor formats synthetic SQL only; it does not execute a query.
            'query' => new QueryException('pgsql', 'SELECT current_database()', [], new PDOException('Synthetic query failure.', 19)),
        };
    }

    private function assertSameFailureEscapes(Application $app, Throwable $failure): void
    {
        try {
            ScratchDatabaseGuard::assertSafe($app);
        } catch (Throwable $caught) {
            self::assertSame($failure, $caught, 'The original exception must escape unchanged, without acceptance or wrapping.');
            return;
        }
        self::fail('Guard returned normally after a simulated database failure.');
    }

    #[DataProvider('exceptionKinds')]
    public function test_acquisition_failure_propagates_without_query_retry_or_fallback(string $kind): void
    {
        $failure = $this->failure($kind);
        $connection = $this->readOnlyConnection();
        $connection->expects($this->never())->method('selectOne');
        $manager = $this->manager();
        // No connection is returned. A second request, alternative name or fallback fails the mock expectations.
        $manager->expects($this->once())->method('connection')->with('pgsql')->willThrowException($failure);
        $this->assertSameFailureEscapes($this->application($manager), $failure);
    }

    private function identityApplication(mixed $response = null, ?Throwable $failure = null): Application
    {
        $connection = $this->readOnlyConnection();
        $query = $connection->expects($this->once())->method('selectOne')->with($this->callback(
            static fn (string $sql): bool => preg_replace('/\s+/', ' ', trim($sql)) ===
                'SELECT current_database() AS database_name, host(inet_server_addr()) AS server_address, inet_server_port() AS server_port'
        ));
        if ($failure !== null) {
            $query->willThrowException($failure);
        } else {
            $query->willReturn($response);
        }
        $manager = $this->manager();
        $manager->expects($this->once())->method('connection')->with('pgsql')->willReturn($connection);
        return $this->application($manager);
    }

    #[DataProvider('exceptionKinds')]
    public function test_identity_query_failure_propagates_without_retry_or_fallback(string $kind): void
    {
        $failure = $this->failure($kind);
        $this->assertSameFailureEscapes($this->identityApplication(failure: $failure), $failure);
    }

    public static function unexpectedResponses(): array
    {
        return [
            'array instead of identity object' => [[
                'database_name' => 'dental_clinic_scratch', 'server_address' => '127.0.0.1', 'server_port' => 5432,
            ]],
            'unrelated success flag' => [(object) ['success' => true]],
            'false response' => [false],
        ];
    }

    #[DataProvider('unexpectedResponses')]
    public function test_unexpected_response_is_not_accepted_as_verified_identity(mixed $response): void
    {
        $app = $this->identityApplication($response);
        $this->expectException(RuntimeException::class);
        $this->expectExceptionMessage('Refusing test work: the actual PostgreSQL server identity did not match the approved scratch target.');
        ScratchDatabaseGuard::assertSafe($app);
    }
}
