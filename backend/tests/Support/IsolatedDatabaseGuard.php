<?php

namespace Tests\Support;

use RuntimeException;

/** Explicit opt-in for the locally owned development cluster; legacy scratch guards remain unchanged. */
final class IsolatedDatabaseGuard
{
    public static function manifest(): array
    {
        $path = getenv('DENTALOPS_LOCAL_TARGET');
        if (! is_string($path) || ! is_file($path) || is_link($path)
            || (fileperms($path) & 0077) !== 0 || fileowner($path) !== posix_geteuid()) {
            throw new RuntimeException('An owned, private local development target is required.');
        }
        $target = json_decode(file_get_contents($path), true, flags: JSON_THROW_ON_ERROR);
        if (($target['host'] ?? null) !== '127.0.0.1' || ! is_int($target['port'] ?? null)
            || $target['port'] < 1024 || $target['port'] > 65535
            || ($target['test_database'] ?? null) !== 'dental_clinic_test'
            || ($target['demo_database'] ?? null) !== 'dental_clinic_demo'
            || ($target['app_user'] ?? null) !== 'dentalops_app'
            || ! is_string($target['cluster_id'] ?? null) || ! preg_match('/\A[a-f0-9]{32}\z/', $target['cluster_id'])
            || realpath($target['data_directory'] ?? '') !== ($target['runtime'] ?? '').'/postgres'
            || ! is_file(($target['data_directory'] ?? '').'/PG_VERSION')) {
            throw new RuntimeException('The isolated development target is invalid.');
        }
        return $target;
    }

    public static function configuration(array $pg, array $target): void
    {
        if (($pg['driver'] ?? null) !== 'pgsql' || ($pg['host'] ?? null) !== '127.0.0.1' || ($pg['database'] ?? null) !== 'dental_clinic_test'
            || (string) ($pg['port'] ?? '') !== (string) $target['port']
            || ($pg['username'] ?? null) !== $target['app_user']
            || ! in_array($pg['url'] ?? null, [null, ''], true)) {
            throw new RuntimeException('Refusing tests outside the isolated local test database.');
        }
    }

    public static function identity(object $row, array $target): void
    {
        if (($row->database_name ?? null) !== 'dental_clinic_test'
            || ($row->server_address ?? null) !== '127.0.0.1'
            || (int) ($row->server_port ?? 0) !== $target['port']
            || ($row->cluster_id ?? null) !== $target['cluster_id']) {
            throw new RuntimeException('The connected server is not the owned isolated test target.');
        }
    }

    public const IDENTITY_SQL = "SELECT current_database() AS database_name, host(inet_server_addr()) AS server_address,
        inet_server_port() AS server_port, (SELECT cluster_id FROM local_development.identity) AS cluster_id";

    public static function assertSafe($app): void
    {
        $target = self::manifest();
        if (! $app->environment('testing') || $app['config']->get('database.default') !== 'pgsql') {
            throw new RuntimeException('The isolated test target requires testing and pgsql.');
        }
        self::configuration($app['config']->get('database.connections.pgsql', []), $target);
        self::identity($app['db']->connection('pgsql')->selectOne(self::IDENTITY_SQL), $target);
    }
}
