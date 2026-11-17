<?php

namespace App\Support;

use Illuminate\Support\Facades\DB;

/** An opt-in mail-only schedule for NEW owned disposable runtimes. Never an authorization grant. */
final class SyntheticRuntime
{
    public static function active(): bool
    {
        if (getenv('DENTALOPS_SYNTHETIC_RUNTIME') !== '1') {
            return false;
        }
        $file = getenv('DENTALOPS_LOCAL_TARGET');
        if (! $file || is_link($file) || ! is_file($file) || ! function_exists('posix_geteuid')
            || fileowner($file) !== posix_geteuid() || (fileperms($file) & 0077) !== 0) {
            throw new \RuntimeException('A private owned synthetic target is required.');
        }
        $target = json_decode(file_get_contents($file), true, flags: JSON_THROW_ON_ERROR);
        $root = $target['runtime'] ?? '';
        if (! app()->environment('local') || ($target['host'] ?? null) !== '127.0.0.1'
            || realpath($target['root'] ?? '') !== realpath(base_path('..'))
            || ! is_file($root.'/synthetic-runtime') || is_link($root.'/synthetic-runtime')
            || trim(file_get_contents($root.'/synthetic-runtime')) !== ($target['cluster_id'] ?? null)
            || config('database.connections.pgsql.database') !== 'dental_clinic_demo'
            || config('database.connections.pgsql.host') !== '127.0.0.1'
            || (int) config('database.connections.pgsql.port') !== ($target['port'] ?? null)
            || config('mail.default') !== 'local_capture' || config('queue.default') !== 'database'
            || config('filesystems.disks.local.root') !== $root.'/storage/app/private') {
            throw new \RuntimeException('Refusing an unverified synthetic runtime.');
        }
        $actual = DB::selectOne('SELECT current_database() AS db, host(inet_server_addr()) AS host, inet_server_port() AS port, (SELECT cluster_id FROM local_development.identity) AS marker');
        if ($actual->db !== 'dental_clinic_demo' || $actual->host !== '127.0.0.1'
            || (int) $actual->port !== $target['port'] || $actual->marker !== $target['cluster_id']) {
            throw new \RuntimeException('Synthetic database identity mismatch.');
        }

        return true;
    }

    /** PID/start-time and exact target binding prevent another database's worker from satisfying predefense. */
    public static function serviceRunning(string $name): bool
    {
        if (! self::active()) {
            return false;
        }
        $target = json_decode(file_get_contents(getenv('DENTALOPS_LOCAL_TARGET')), true, flags: JSON_THROW_ON_ERROR);
        $path = $target['runtime'].'/services.json';
        if (! is_file($path) || is_link($path) || fileowner($path) !== posix_geteuid() || (fileperms($path) & 0077) !== 0) {
            return false;
        }
        $state = json_decode(file_get_contents($path), true, flags: JSON_THROW_ON_ERROR);
        $service = $state['services'][$name] ?? [];
        $pid = $service['pid'] ?? null;
        if (($state['cluster_id'] ?? null) !== $target['cluster_id'] || ($state['state'] ?? null) !== 'running'
            || ! is_int($pid) || $pid <= 1 || ! is_file('/proc/'.$pid.'/stat')) {
            return false;
        }
        $stat = file_get_contents('/proc/'.$pid.'/stat');
        $fields = preg_split('/\s+/', substr($stat, strrpos($stat, ')') + 2));
        $cmd = str_replace("\0", ' ', file_get_contents('/proc/'.$pid.'/cmdline'));
        // Environment is inspected only in memory; never logged or serialized.
        $env = explode("\0", file_get_contents('/proc/'.$pid.'/environ'));
        $needle = ['worker' => 'artisan queue:work', 'scheduler' => 'artisan schedule:work', 'api' => 'artisan serve'][$name] ?? null;
        if ($needle === null) {
            return false;
        }

        return in_array($fields[0] ?? '', ['R', 'S', 'D', 'I'], true)
            && ($fields[19] ?? '') === ($service['start_ticks'] ?? null)
            && str_contains($cmd, $needle)
            && in_array('DENTALOPS_LOCAL_TARGET='.getenv('DENTALOPS_LOCAL_TARGET'), $env, true)
            && in_array('DB_PORT='.$target['port'], $env, true)
            && in_array('DB_DATABASE=dental_clinic_demo', $env, true)
            && in_array('DENTALOPS_SYNTHETIC_RUNTIME=1', $env, true);
    }
}
