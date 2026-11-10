<?php

namespace Tests\Support;

use Illuminate\Database\DatabaseManager;
use Illuminate\Foundation\Application;
use RuntimeException;

/**
 * Proposed test-runner profile only. Not installed in bootstrap, Artisan, or Tests\TestCase.
 * Inspects supplied configuration and manager metadata; never requests a connection.
 * Acceptance is a snapshot, not verification of the server, privileges, or isolation.
 */
final class PreflightConfigurationValidator
{
    public static function assertSafe(Application $app, DatabaseManager $manager): void
    {
        if (! $app->environment('testing')) {
            throw new RuntimeException('Preflight rejected: testing environment required.');
        }
        if ($app->configurationIsCached()) {
            throw new RuntimeException('Preflight rejected: cached configuration is unsupported.');
        }

        $config = $app['config'];
        $connections = $config->get('database.connections');
        if ($config->get('database.default') !== 'pgsql' || ! is_array($connections)
            || array_keys($connections) !== ['pgsql'] || ! is_array($connections['pgsql'])) {
            throw new RuntimeException('Preflight rejected: exactly one named pgsql connection is required.');
        }
        $pg = $connections['pgsql'];
        $allowed = ['driver', 'database', 'host', 'port', 'url', 'username', 'password',
            'charset', 'prefix', 'prefix_indexes', 'search_path', 'sslmode'];
        if (array_diff(array_keys($pg), $allowed) !== []) {
            // Reject even empty/null endpoint overrides; no recursive endpoint merging is supported.
            throw new RuntimeException('Preflight rejected: connection overrides or unknown options are unsupported.');
        }
        if (($pg['driver'] ?? null) !== 'pgsql' || ($pg['database'] ?? null) !== 'dental_clinic_scratch'
            || ($pg['host'] ?? null) !== '127.0.0.1' || ! in_array($pg['port'] ?? null, [5432, '5432'], true)
            || ! in_array($pg['url'] ?? null, [null, ''], true) || ($pg['search_path'] ?? null) !== 'public') {
            throw new RuntimeException('Preflight rejected: unsupported scratch connection target.');
        }
        foreach (['charset' => 'utf8', 'prefix' => '', 'prefix_indexes' => true, 'sslmode' => 'prefer'] as $key => $value) {
            if (array_key_exists($key, $pg) && $pg[$key] !== $value) {
                throw new RuntimeException('Preflight rejected: unsupported connection settings.');
            }
        }
        foreach (['username', 'password'] as $key) {
            if (array_key_exists($key, $pg) && ! is_string($pg[$key])) {
                throw new RuntimeException('Preflight rejected: credential fields must be strings.');
            }
        }
        // getConnections() returns the manager's existing array; it does not resolve a connection.
        if ($manager->getConnections() !== []) {
            throw new RuntimeException('Preflight rejected: resolved connection objects already exist.');
        }
    }
}
