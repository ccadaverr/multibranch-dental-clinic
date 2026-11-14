<?php

namespace Tests\Unit;

use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;
use RuntimeException;
use Tests\Support\IsolatedDatabaseGuard;

require_once __DIR__.'/../Support/IsolatedDatabaseGuard.php';

final class IsolatedDatabaseGuardTest extends TestCase
{
    private function target(): array
    {
        return ['port' => 55488, 'app_user' => 'dentalops_app', 'cluster_id' => str_repeat('a', 32)];
    }

    private function connection(): array
    {
        return ['driver' => 'pgsql', 'host' => '127.0.0.1', 'port' => '55488',
            'database' => 'dental_clinic_test', 'username' => 'dentalops_app', 'url' => ''];
    }

    public static function changes(): array
    {
        return [['database','dental_clinic'], ['database','dental_clinic_demo'], ['database','dental_clinic_scratch'],
            ['host','localhost'], ['host','192.0.2.1'], ['port','5432'], ['port','55489'],
            ['username','dentalops_dev'], ['url','postgres://example.invalid/test'], ['driver','mysql']];
    }

    #[DataProvider('changes')]
    public function test_foreign_or_privileged_connections_are_refused_before_connecting(string $field, string $value): void
    {
        $this->expectException(RuntimeException::class);
        IsolatedDatabaseGuard::configuration([$field => $value] + $this->connection(), $this->target());
    }

    public function test_exact_unprivileged_connection_and_actual_marker_are_required(): void
    {
        IsolatedDatabaseGuard::configuration($this->connection(), $this->target());
        IsolatedDatabaseGuard::identity((object) ['database_name' => 'dental_clinic_test',
            'server_address' => '127.0.0.1', 'server_port' => 55488, 'cluster_id' => str_repeat('a',32)], $this->target());
        $this->addToAssertionCount(2);
        $this->expectException(RuntimeException::class);
        IsolatedDatabaseGuard::identity((object) ['database_name' => 'dental_clinic_test',
            'server_address' => '127.0.0.1', 'server_port' => 55488, 'cluster_id' => str_repeat('b',32)], $this->target());
    }
}
