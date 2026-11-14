<?php

namespace Tests\Support;

final class ScratchDatabaseGuard
{
    public static function assertSafe($app): void
    {
        if (getenv('DENTALOPS_LOCAL_TARGET')) {
            require_once __DIR__.'/IsolatedDatabaseGuard.php';
            IsolatedDatabaseGuard::assertSafe($app);
            return;
        }
        if (! $app->environment('testing')) {
            throw new \RuntimeException('Refusing database work outside the testing environment.');
        }

        $config = $app['config'];
        // Docker publishes on localhost but PostgreSQL reports its container address.
        // Opt in only after independently inspecting the disposable container and its empty schema.
        // The client host, port, database and URL checks below remain mandatory.
        $serverAddress = getenv('TEST_SCRATCH_SERVER_ADDRESS') ?: '127.0.0.1';
        if (filter_var($serverAddress, FILTER_VALIDATE_IP) === false) {
            throw new \RuntimeException('Refusing test work: invalid expected scratch server address.');
        }

        if ($config->get('database.default') !== 'pgsql') {
            throw new \RuntimeException('Refusing test work: the default connection must be pgsql.');
        }

        $pg = $config->get('database.connections.pgsql', []);

        if (
            ($pg['database'] ?? null) !== 'dental_clinic_scratch' ||
            ($pg['host'] ?? null) !== '127.0.0.1' ||
            (string) ($pg['port'] ?? '') !== '5432' ||
            ! in_array($pg['url'] ?? null, [null, ''], true)
        ) {
            throw new \RuntimeException(
                'Refusing test work: PostgreSQL must target local dental_clinic_scratch on 127.0.0.1:5432.'
            );
        }

        // Connect only after the environment and configured target pass validation.
        $row = $app['db']->connection('pgsql')->selectOne(
            'SELECT current_database() AS database_name,
                    host(inet_server_addr()) AS server_address,
                    inet_server_port() AS server_port'
        );

        if (
            ($row->database_name ?? null) !== 'dental_clinic_scratch' ||
            ($row->server_address ?? null) !== $serverAddress ||
            (int) ($row->server_port ?? 0) !== 5432
        ) {
            throw new \RuntimeException(
                'Refusing test work: the actual PostgreSQL server identity did not match the approved scratch target.'
            );
        }
    }
}
