<?php

namespace App\Support;

use Illuminate\Database\Connection;
use Illuminate\Support\Facades\DB;
use InvalidArgumentException;

final class SupabaseDevelopmentTarget
{
    private const INVENTORY = 'docs/coordination/OPERATIONS_SCHEMA_INVENTORY_ROUND8_20261116.json';
    private const INVENTORY_HASH = '6c7e91f869ee7df3c615c979a9a32a349953ce69e093120d00de417ddbf8ec65';

    public static function connection(string $project): Connection
    {
        if (preg_match('/\A[a-z0-9]{20}\z/', $project) !== 1 || ! app()->environment('local')
            || env('DENTALOPS_LOCAL_TARGET') || DB::getDefaultConnection() !== 'pgsql') {
            throw new InvalidArgumentException('Use a local Laravel environment configured for the exact Supabase development project.');
        }

        $db = DB::connection('pgsql');
        $config = $db->getConfig();
        if ($db->hasDirectConnection() || isset($config['read']) || isset($config['write'])
            || $db->getDatabaseName() !== 'postgres' || $db->getTablePrefix() !== ''
            || config('database.migrations.table') !== 'migrations' || ($config['search_path'] ?? null) !== 'public'
            || (string) ($config['port'] ?? '') !== '5432'
            || preg_match('/\Aaws-\d+-[a-z0-9-]+\.pooler\.supabase\.com\z/', (string) ($config['host'] ?? '')) !== 1
            || preg_match('/\A[a-z_][a-z0-9_]*\.'.preg_quote($project, '/').'\z/', (string) ($config['username'] ?? '')) !== 1
            || ! in_array($config['sslmode'] ?? null, ['require', 'verify-ca', 'verify-full'], true)) {
            throw new InvalidArgumentException('The database connection does not match the requested Supabase Session pooler project, public schema, or required TLS settings.');
        }

        return $db;
    }

    public static function inventory(): array
    {
        $file = base_path('../'.self::INVENTORY);
        if (! is_file($file) || hash_file('sha256', $file) !== self::INVENTORY_HASH) {
            throw new InvalidArgumentException('The reviewed Round 8 inventory is missing or has changed.');
        }

        $inventory = json_decode(file_get_contents($file), true, flags: JSON_THROW_ON_ERROR);
        $paths = [];
        $held = [];
        foreach (['selected', 'held'] as $group) {
            foreach ($inventory[$group] as $entry) {
                $path = base_path('../'.$entry['path']);
                if (! is_file($path) || hash_file('sha256', $path) !== $entry['sha256']) {
                    throw new InvalidArgumentException('Migration source differs from inventory: '.$entry['path']);
                }
                if ($group === 'selected') {
                    $paths[] = $path;
                } else {
                    $held[] = pathinfo($path, PATHINFO_FILENAME);
                }
            }
        }

        return [$paths, $held];
    }
}
