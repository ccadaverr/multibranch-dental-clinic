<?php

namespace App\Support;

use Illuminate\Console\Events\CommandStarting;
use Illuminate\Support\Facades\DB;
use RuntimeException;

/** Blocks accidental default/reset migration commands only in the explicitly provisioned local environment. */
final class LocalMigrationProfile
{
    private static function target(): ?array
    {
        $file = env('DENTALOPS_LOCAL_TARGET');
        if (! $file) return null;
        if (! is_file($file) || is_link($file) || fileowner($file) !== posix_geteuid() || (fileperms($file) & 0077) !== 0) {
            throw new RuntimeException('An owned private local migration target is required.');
        }
        return json_decode(file_get_contents($file), true, flags: JSON_THROW_ON_ERROR);
    }

    public static function paths(array $target): array
    {
        $extensions = $target['operations_migrations'] ?? [];
        if (! in_array($extensions, [[], ['2026_11_18_000100_create_notification_archives.php']], true)) {
            throw new RuntimeException('Unreviewed Operations migration selection.');
        }

        return array_map(fn ($name) => 'database/'.(in_array($name.'.php', $extensions, true) ? 'operations/' : (str_ends_with($name, '_preserve_queue_state_vocabulary') ? 'compatibility/' : 'migrations/')).$name.'.php', $target['selected_migrations']);
    }

    public static function assertSelection(string $command, array $paths, array $target): void
    {
        $expected = self::paths($target);
        sort($expected);
        sort($paths);
        if ($command !== 'migrate' || $paths !== $expected || ! $paths) {
            throw new RuntimeException('Use the reviewed local-system migration profile. Default migrations, resets and broad rollbacks are held.');
        }
    }

    public static function starting(CommandStarting $event): void
    {
        if (! env('DENTALOPS_LOCAL_TARGET') || ! in_array($event->command, ['migrate','migrate:fresh','migrate:refresh','migrate:reset','migrate:rollback','db:wipe'], true)) {
            return;
        }
        $target = self::target();
        self::assertSelection($event->command, $event->input->hasOption('path') ? (array) $event->input->getOption('path') : [], $target);
        self::assertTarget($target);
    }

    public static function migration(\Illuminate\Database\Events\MigrationStarted $event): void
    {
        $target = self::target();
        if (! $target) return;
        $file = (new \ReflectionClass($event->migration))->getFileName();
        $allowed = array_map(fn ($path) => base_path($path), self::paths($target));
        if ($event->method !== 'up' || ! in_array($file, $allowed, true)) {
            throw new RuntimeException('This migration is held outside the reviewed local preservation profile.');
        }
        self::assertTarget($target);
    }

    private static function assertTarget(array $target): void
    {
        $pg = config('database.connections.pgsql');
        if (! in_array(app()->environment(), ['local','testing'], true) || config('database.default') !== 'pgsql'
            || ($target['host'] ?? null) !== '127.0.0.1' || ($pg['host'] ?? null) !== '127.0.0.1'
            || ! in_array($pg['database'] ?? null, ['dental_clinic_demo','dental_clinic_test'], true)
            || (string) $pg['port'] !== (string) $target['port'] || $pg['username'] !== $target['user']
            || ! in_array($pg['url'] ?? null, [null, ''], true)) {
            throw new RuntimeException('Refusing migrations outside the explicit local development target.');
        }
        foreach (self::paths($target) as $path) {
            if (hash_file('sha256', base_path($path)) !== ($target['migration_hashes'][basename($path)] ?? null)) {
                throw new RuntimeException('The reviewed migration bytes changed.');
            }
        }
        $identity = DB::selectOne("SELECT host(inet_server_addr()) AS address, inet_server_port() AS port,
            current_setting('data_directory') AS directory, (SELECT cluster_id FROM local_development.identity) AS cluster_id");
        if ($identity->address !== '127.0.0.1' || (int) $identity->port !== $target['port']
            || $identity->directory !== $target['data_directory'] || $identity->cluster_id !== $target['cluster_id']) {
            throw new RuntimeException('The server identity differs from the owned migration target.');
        }
    }
}
