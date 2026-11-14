<?php

// Only the explicit local runner uses this bootstrap. No default PHPUnit behavior is changed.
require __DIR__.'/../../vendor/autoload.php';
require_once __DIR__.'/IsolatedDatabaseGuard.php';

$target = \Tests\Support\IsolatedDatabaseGuard::manifest();
$pg = ['driver' => getenv('DB_CONNECTION'), 'host' => getenv('DB_HOST'), 'port' => getenv('DB_PORT'), 'database' => getenv('DB_DATABASE'),
    'username' => getenv('DB_USERNAME'), 'url' => getenv('DB_URL')];
\Tests\Support\IsolatedDatabaseGuard::configuration($pg, $target);
$pdo = new PDO('pgsql:host=127.0.0.1;port='.$target['port'].';dbname=dental_clinic_test',
    $pg['username'], getenv('DB_PASSWORD'), [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
\Tests\Support\IsolatedDatabaseGuard::identity($pdo->query(\Tests\Support\IsolatedDatabaseGuard::IDENTITY_SQL)->fetchObject(), $target);
$applied = $pdo->query('SELECT migration FROM migrations ORDER BY migration')->fetchAll(PDO::FETCH_COLUMN);
$expected = $target['selected_migrations'];
sort($expected);
if ($applied !== $expected) {
    throw new RuntimeException('Provision the exact reviewed local schema before testing; no automatic reset is permitted.');
}
// RefreshDatabase now starts/rolls back its usual transactions against the already verified schema.
// Its migrate:fresh path is not run; the runtime role cannot drop or alter the migrator-owned tables.
\Illuminate\Foundation\Testing\RefreshDatabaseState::$migrated = true;
unset($pdo);
