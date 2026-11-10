<?php

namespace Tests\Unit;

use Illuminate\Config\Repository;
use Illuminate\Database\DatabaseManager;
use Illuminate\Database\PostgresConnection;
use Illuminate\Foundation\Application;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;
use RuntimeException;
use Tests\Support\ScratchDatabaseGuard;

require_once __DIR__.'/../Support/ScratchDatabaseGuard.php';

/** No application bootstrap, PDO, real database manager or migration runner is constructed. */
final class ScratchDatabaseGuardRejectionTest extends TestCase
{
    private const TARGET_ERROR = 'Refusing test work: PostgreSQL must target local dental_clinic_scratch on 127.0.0.1:5432.';

    private const IDENTITY_ERROR = 'Refusing test work: the actual PostgreSQL server identity did not match the approved scratch target.';

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

    private static function configuration(): array
    {
        return ['database' => ['default' => 'pgsql', 'connections' => ['pgsql' => [
            'driver' => 'pgsql', 'database' => 'dental_clinic_scratch',
            'host' => '127.0.0.1', 'port' => '5432', 'url' => null,
        ]]]];
    }

    private function application(array $configuration, DatabaseManager $manager, string $environment = 'testing'): Application
    {
        $app = $this->createMock(Application::class);
        $app->method('environment')->with('testing')->willReturn($environment === 'testing');
        $app->method('offsetGet')->willReturnMap([
            ['config', new Repository($configuration)], ['db', $manager],
        ]);
        return $app;
    }

    public static function rejectedConfigurations(): array
    {
        $valid = self::configuration();
        $cases = [
            'production environment' => [$valid, 'production', 'Refusing database work outside the testing environment.'],
            'local environment' => [$valid, 'local', 'Refusing database work outside the testing environment.'],
            'missing database configuration' => [[], 'testing', 'Refusing test work: the default connection must be pgsql.'],
        ];
        foreach ([null, 'mysql', 'sqlite'] as $driver) {
            $config = $valid;
            $config['database']['default'] = $driver;
            $cases['default connection '.($driver ?? 'null')] = [$config, 'testing', 'Refusing test work: the default connection must be pgsql.'];
        }
        $config = $valid;
        unset($config['database']['connections']['pgsql']);
        $cases['missing pgsql connection'] = [$config, 'testing', self::TARGET_ERROR];
        foreach (['database', 'host', 'port'] as $field) {
            $config = $valid;
            unset($config['database']['connections']['pgsql'][$field]);
            $cases['missing '.$field] = [$config, 'testing', self::TARGET_ERROR];
        }
        foreach ([
            'database' => ['dental_clinic', 'dental_clinic_demo', 'dental_clinic_test', '', null],
            'host' => ['localhost', '192.0.2.10', '::1', '', null],
            'port' => ['5433', '6543', 0, '', null],
            'url' => ['postgresql://example.invalid/dental_clinic_scratch', ' ', false, 0, []],
        ] as $field => $values) {
            foreach ($values as $index => $value) {
                $config = $valid;
                $config['database']['connections']['pgsql'][$field] = $value;
                $cases[$field.' invalid variant '.$index] = [$config, 'testing', self::TARGET_ERROR];
            }
        }
        return $cases;
    }

    #[DataProvider('rejectedConfigurations')]
    public function test_invalid_configuration_never_requests_a_connection(array $configuration, string $environment, string $message): void
    {
        $manager = $this->createMock(DatabaseManager::class);
        $manager->expects($this->never())->method('connection');
        $app = $this->application($configuration, $manager, $environment);
        $this->expectException(RuntimeException::class);
        $this->expectExceptionMessage($message);
        ScratchDatabaseGuard::assertSafe($app);
    }

    public function test_invalid_expected_server_address_never_requests_a_connection(): void
    {
        putenv('TEST_SCRATCH_SERVER_ADDRESS=not-an-ip-address');
        $manager = $this->createMock(DatabaseManager::class);
        $manager->expects($this->never())->method('connection');
        $app = $this->application(self::configuration(), $manager);
        $this->expectException(RuntimeException::class);
        $this->expectExceptionMessage('Refusing test work: invalid expected scratch server address.');
        ScratchDatabaseGuard::assertSafe($app);
    }

    private static function identity(): array
    {
        return ['database_name' => 'dental_clinic_scratch', 'server_address' => '127.0.0.1', 'server_port' => 5432];
    }

    public static function rejectedIdentities(): array
    {
        $cases = ['no identity row' => [null]];
        foreach (['database_name' => 'dental_clinic', 'server_address' => '192.0.2.10', 'server_port' => 6543] as $field => $wrong) {
            foreach (['wrong' => $wrong, 'null' => null] as $variant => $value) {
                $row = self::identity();
                $row[$field] = $value;
                $cases[$field.' '.$variant] = [(object) $row];
            }
            $row = self::identity();
            unset($row[$field]);
            $cases[$field.' missing'] = [(object) $row];
        }
        return $cases;
    }

    private function identityApplication(?object $identity, ?RuntimeException $failure = null): Application
    {
        $connection = $this->createMock(PostgresConnection::class);
        // Only the identity SELECT is permitted. No write, transaction or PDO access is needed.
        foreach (['statement', 'unprepared', 'insert', 'update', 'delete', 'beginTransaction', 'getPdo'] as $method) {
            $connection->expects($this->never())->method($method);
        }
        $select = $connection->expects($this->once())->method('selectOne')->with($this->callback(
            static fn (string $sql): bool => preg_replace('/\s+/', ' ', trim($sql)) ===
                'SELECT current_database() AS database_name, host(inet_server_addr()) AS server_address, inet_server_port() AS server_port'
        ));
        if ($failure !== null) {
            $select->willThrowException($failure);
        } else {
            $select->willReturn($identity);
        }
        $manager = $this->createMock(DatabaseManager::class);
        $manager->expects($this->once())->method('connection')->with('pgsql')->willReturn($connection);
        return $this->application(self::configuration(), $manager);
    }

    #[DataProvider('rejectedIdentities')]
    public function test_invalid_identity_is_rejected_after_mock_connection_and_read(?object $identity): void
    {
        $app = $this->identityApplication($identity);
        $this->expectException(RuntimeException::class);
        $this->expectExceptionMessage(self::IDENTITY_ERROR);
        ScratchDatabaseGuard::assertSafe($app);
    }

    public function test_identity_read_failure_propagates_without_treating_target_as_safe(): void
    {
        $failure = new RuntimeException('Synthetic identity read failure.');
        $app = $this->identityApplication(null, $failure);
        $this->expectExceptionObject($failure);
        ScratchDatabaseGuard::assertSafe($app);
    }

    public function test_matching_mock_identity_is_accepted_as_a_positive_control(): void
    {
        ScratchDatabaseGuard::assertSafe($this->identityApplication((object) self::identity()));
    }
}
