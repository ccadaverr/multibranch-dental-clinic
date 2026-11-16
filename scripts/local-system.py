#!/usr/bin/env python3
"""Explicitly owned local development runner. Never discovers or reuses ambient database credentials."""
import argparse
import datetime
import fcntl
import hashlib
import json
import os
import secrets
import socket
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
HELD = {
    '2026_11_10_000100_remove_patient_feedback_table.php',
    '2026_11_15_000400_backfill_tooth_chart_branch.php',
    '2026_11_15_000500_add_critical_foreign_key_and_analytics_indexes.php',
    '2026_11_16_000500_update_queue_statuses_and_remove_urgent_priority.php',
}

def target(path):
    p = Path(path)
    if p.is_symlink() or not p.is_file() or p.stat().st_uid != os.getuid() or p.stat().st_mode & 0o077:
        raise ValueError('Use an owned private target manifest; never a shared/production target.')
    c = json.loads(p.read_text())
    runtime = Path(c['runtime'])
    if (c['host'] != '127.0.0.1' or not isinstance(c['port'], int) or not 1024 <= c['port'] <= 65535
            or c['demo_database'] != 'dental_clinic_demo' or c['test_database'] != 'dental_clinic_test'
            or Path(c['data_directory']).resolve() != runtime.resolve() / 'postgres'
            or runtime.stat().st_uid != os.getuid() or runtime.stat().st_mode & 0o077
            or Path(c['root']).resolve() != ROOT):
        raise ValueError('Invalid isolated local development target.')
    return c, runtime


def pg_env(c, runtime):
    return {'PATH': '/usr/bin:/bin', 'PGHOST': c['host'], 'PGPORT': str(c['port']),
            'PGUSER': c['user'], 'PGPASSFILE': str(runtime / 'pgpass')}


def sql(c, runtime, database, statement):
    return subprocess.check_output([c['pg_bin'] + '/psql', '-X', '-A', '-t', '-v', 'ON_ERROR_STOP=1',
                                    '-d', database, '-c', statement], env=pg_env(c, runtime), text=True).strip()


def verify(c, runtime, database):
    row = json.loads(sql(c, runtime, database, "SELECT json_build_object('database',current_database(),"
        "'host',host(inet_server_addr()),'port',inet_server_port(),'directory',current_setting('data_directory'),"
        "'cluster_id',(SELECT cluster_id FROM local_development.identity))"))
    if row != {'database': database, 'host': c['host'], 'port': c['port'],
               'directory': c['data_directory'], 'cluster_id': c['cluster_id']}:
        raise ValueError('Connected server identity differs from the owned target.')


def environment(c, runtime, profile, migrator=False):
    values = {}
    for line in (runtime / 'env' / (profile + '.env')).read_text().splitlines():
        if line and not line.startswith('#'):
            key, value = line.split('=', 1)
            values[key] = value
    values.update({'PATH': str(Path(c['php']).parent) + ':/usr/local/bin:/usr/bin:/bin',
                   'HOME': str(Path.home()), 'TZ': 'Asia/Manila'})
    if migrator:
        values.update(DB_USERNAME=c['user'], DB_PASSWORD=(runtime / 'pg-password').read_text().strip())
    return values


def migrations(c):
    files = sorted((ROOT / 'backend/database/migrations').glob('*.php'))
    files += sorted((ROOT / 'backend/database/compatibility').glob('*.php'))
    observed = {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in files}
    if observed != c['migration_hashes']:
        raise ValueError('Migration sources changed; review a new schema profile before executing it.')
    selected = [p for p in files if p.name not in HELD]
    if [p.stem for p in selected] != c['selected_migrations']:
        raise ValueError('Migration selection differs from the reviewed preservation profile.')
    return selected


def backup(c, runtime, database):
    timestamp = datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
    out = runtime / 'backups' / (database + '-' + timestamp + '.dump')
    subprocess.run([c['pg_bin'] + '/pg_dump', '-Fc', '-d', database, '-f', str(out)], env=pg_env(c, runtime), check=True)
    out.chmod(0o600)
    print('Recoverable local snapshot:', out.name)


def clone_test(c, runtime):
    # Contention fixtures commit deliberately. Give them a separate cluster; never reset the regular test database.
    # macOS Unix-domain socket paths must fit 104 bytes, including PostgreSQL's socket filename.
    clone = runtime.with_name('contention-' + secrets.token_hex(4))
    clone.mkdir(mode=0o700)
    for name in ['sockets', 'logs', 'backups', 'cache', 'cache/test', 'env']:
        (clone / name).mkdir(mode=0o700)
    with socket.socket() as sock:
        sock.bind(('127.0.0.1', 0))
        port = sock.getsockname()[1]
    password, app_password = secrets.token_urlsafe(32), secrets.token_urlsafe(32)
    for name, content in [('pg-password', password + '\n'), ('pgpass', '127.0.0.1:' + str(port) + ':*:dentalops_dev:' + password + '\n')]:
        (clone / name).write_text(content)
        (clone / name).chmod(0o600)
    state = {**c, 'runtime': str(clone), 'data_directory': str(clone / 'postgres'), 'port': port, 'cluster_id': secrets.token_hex(16)}
    manifest = clone / 'target.json'
    manifest.write_text(json.dumps(state, indent=2)); manifest.chmod(0o600)
    with (clone / 'logs/init.log').open('w') as log:
        subprocess.run([c['pg_bin'] + '/initdb', '-D', state['data_directory'], '--username=dentalops_dev', '--encoding=UTF8',
                        '--locale=C', '--auth-local=scram-sha-256', '--auth-host=scram-sha-256', '--pwfile=' + str(clone / 'pg-password')], stdout=log, stderr=log, check=True)
        subprocess.run([c['pg_bin'] + '/pg_ctl', '-D', state['data_directory'], '-l', str(clone / 'logs/postgres.log'), '-w',
                        '-o', '-h 127.0.0.1 -p ' + str(port) + ' -k ' + str(clone / 'sockets'), 'start'], stdout=log, stderr=log, check=True)
    subprocess.run([c['pg_bin'] + '/psql', '-X', '-q', '-v', 'ON_ERROR_STOP=1', '-d', 'postgres'], env=pg_env(state, clone), text=True,
                   input="CREATE ROLE dentalops_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD '" + app_password + "';", check=True)
    subprocess.run([c['pg_bin'] + '/createdb', '--maintenance-db=postgres', 'dental_clinic_test'], env=pg_env(state, clone), check=True)
    snapshot = clone / 'backups/initial-test.dump'
    subprocess.run([c['pg_bin'] + '/pg_dump', '-Fc', '-d', 'dental_clinic_test', '-f', str(snapshot)], env=pg_env(c, runtime), check=True)
    snapshot.chmod(0o600)
    subprocess.run([c['pg_bin'] + '/pg_restore', '--exit-on-error', '-d', 'dental_clinic_test', str(snapshot)], env=pg_env(state, clone), check=True)
    sql(state, clone, 'dental_clinic_test', "UPDATE local_development.identity SET cluster_id='" + state['cluster_id'] + "'")
    values = environment(c, runtime, 'test')
    for key in ['PATH', 'HOME', 'TZ']:
        values.pop(key, None)
    values = {key: value.replace(str(runtime), str(clone)) for key, value in values.items()}
    values.update(DB_PORT=str(port), DB_PASSWORD=app_password, DENTALOPS_LOCAL_TARGET=str(manifest))
    (clone / 'env/test.env').write_text(''.join(key + '=' + value + '\n' for key, value in values.items()))
    (clone / 'env/test.env').chmod(0o600)
    verify(state, clone, 'dental_clinic_test')
    print('Isolated contention target:', manifest)
    return manifest


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--target', required=True, help='Private manifest for a newly provisioned, owned local cluster')
    parser.add_argument('--profile', choices=['demo', 'test'], default='demo')
    parser.add_argument('--filter', help='Optional PHPUnit test-name filter; explicit reviewed files remain required')
    parser.add_argument('--test-mail-profile', choices=['target', 'suite'], default='target',
                        help='For explicit test action only: target keeps queued capture; suite uses PHPUnit array/sync defaults')
    parser.add_argument('action', choices=['status', 'start', 'stop', 'backup', 'migrate', 'seed', 'seed-demo', 'visit-fixture', 'test', 'clone-test', 'concurrency', 'billing-concurrency', 'prescription-concurrency', 'arrival-concurrency', 'encounter-concurrency', 'profile-concurrency', 'chart-concurrency', 'dependent-concurrency', 'verify-schema', 'verify-guard', 'serve', 'ui', 'mailbox', 'worker', 'scheduler'])
    parser.add_argument('tests', nargs='*')
    args = parser.parse_args()
    if args.test_mail_profile != 'target' and (args.action != 'test' or args.profile != 'test'):
        raise ValueError('Suite mail defaults are available only for explicit test action and test profile.')
    c, runtime = target(args.target)
    database = c[args.profile + '_database']
    if args.action in ['start', 'stop']:
        command = [c['pg_bin'] + '/pg_ctl', '-D', c['data_directory'], '-w']
        command += ['start', '-l', str(runtime / 'logs/postgres.log'), '-o',
                    '-h 127.0.0.1 -p ' + str(c['port']) + ' -k ' + str(runtime / 'sockets')] if args.action == 'start' else ['stop', '-m', 'fast']
        subprocess.run(command, check=True)
        return
    verify(c, runtime, database)
    # Backups must remain possible even while a changed migration is awaiting review.
    selected = migrations(c) if args.action != 'backup' else []
    # Separate profiles may run independently. One profile never runs overlapping suites or schema/seed work.
    lock = None
    if args.action in ['migrate', 'seed', 'seed-demo', 'visit-fixture', 'test', 'clone-test', 'concurrency', 'billing-concurrency', 'prescription-concurrency', 'arrival-concurrency', 'encounter-concurrency', 'profile-concurrency', 'chart-concurrency', 'dependent-concurrency', 'verify-schema', 'verify-guard', 'backup']:
        lock = open(runtime / (database + '.lock'), 'a')
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise ValueError('Another operation owns this local database. Wait for it to finish.')
    if args.action == 'status':
        ledger = sql(c, runtime, database, "SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_name='migrations'")
        applied = sql(c, runtime, database, 'SELECT count(*) FROM migrations') if ledger == '1' else '0'
        print(json.dumps({'host': c['host'], 'port': c['port'], 'database': database, 'classification': 'owned isolated development',
                          'appliedMigrations': int(applied), 'selectedMigrations': len(selected), 'held': sorted(HELD)}))
    elif args.action == 'backup':
        backup(c, runtime, database)
    elif args.action == 'clone-test':
        if args.profile != 'test':
            raise ValueError('Clone only the isolated test profile.')
        clone_test(c, runtime)
    elif args.action == 'migrate':
        backup(c, runtime, database)
        command = [c['php'], 'artisan', 'migrate', '--force', '--no-interaction']
        command += ['--path=' + str(p.relative_to(ROOT / 'backend')) for p in selected]
        subprocess.run(command, cwd=ROOT / 'backend', env=environment(c, runtime, args.profile, True), check=True)
        sql(c, runtime, database, 'REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM dentalops_app; '
            'GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO dentalops_app; '
            'REVOKE INSERT, UPDATE, DELETE ON migrations FROM dentalops_app; '
            'GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO dentalops_app')
        print('Held migrations remain pending, never marked executed:', ', '.join(sorted(HELD)))
        backup(c, runtime, database)
    elif args.action == 'visit-fixture':
        if args.profile != 'demo':
            raise ValueError('Synthetic visit prerequisites belong only in the verified demo profile.')
        backup(c, runtime, database)
        fixture_env = environment(c, runtime, 'demo')
        fixture_env['DENTALOPS_LOCAL_VISIT_FIXTURE'] = '1'
        fixture_env['DENTALOPS_LOCAL_TARGET'] = str(Path(args.target).resolve())
        fixture = subprocess.check_output([c['php'], 'tests/Support/local_visit_fixture.php'],
                                         cwd=ROOT / 'backend', env=fixture_env, text=True)
        # Parse before publishing; no passwords, keys, tokens or financial outcomes are included.
        data = json.loads(fixture)
        output = runtime / 'visit-fixture.json'
        output.write_text(json.dumps(data, indent=2))
        output.chmod(0o600)
        print('Synthetic prerequisite manifest:', output)
    elif args.action in ['seed', 'seed-demo']:
        if args.profile != 'demo':
            raise ValueError('Demo seeding is never performed in the transactional test database.')
        backup(c, runtime, database)
        seeder = 'DemoClinicSeeder' if args.action == 'seed-demo' else 'DatabaseSeeder'
        subprocess.run([c['php'], 'artisan', 'db:seed', '--class=' + seeder, '--force', '--no-interaction'],
                       cwd=ROOT / 'backend', env=environment(c, runtime, args.profile), check=True)
    elif args.action in ['test', 'verify-schema', 'verify-guard', 'concurrency', 'billing-concurrency', 'prescription-concurrency', 'arrival-concurrency', 'encounter-concurrency', 'profile-concurrency', 'chart-concurrency', 'dependent-concurrency']:
        if args.action == 'verify-schema':
            args.tests = ['tests/Feature/Queue/PreservationMigrationTest.php']
        if args.action == 'verify-guard':
            args.tests = ['tests/Feature/LocalMigrationSafetyTest.php']
        if args.action == 'concurrency':
            if not runtime.name.startswith('contention-'):
                raise ValueError('Run committed contention fixtures only in a separate clone-test target.')
            args.tests = ['tests/Feature/Followups/SelectedFollowupConcurrencyTest.php']
        if args.action == 'billing-concurrency':
            if not runtime.name.startswith('contention-'):
                raise ValueError('Run settlement contention only in a separate clone-test target.')
            args.tests = ['tests/Feature/Billing/SettlementContentionTest.php']
        if args.action == 'prescription-concurrency':
            if not runtime.name.startswith('contention-'):
                raise ValueError('Run prescription contention only in a separate clone-test target.')
            args.tests = ['tests/Feature/Prescriptions/PrescriptionContentionTest.php']
        if args.action == 'arrival-concurrency':
            if not runtime.name.startswith('contention-'):
                raise ValueError('Run arrival contention only in a separate clone-test target.')
            args.tests = ['tests/Feature/Visits/ArrivalContentionTest.php']
        if args.action == 'encounter-concurrency':
            if not runtime.name.startswith('contention-'):
                raise ValueError('Run encounter contention only in a separate clone-test target.')
            args.tests = ['tests/Feature/Treatments/EncounterContentionTest.php']
        if args.action == 'profile-concurrency':
            if not runtime.name.startswith('contention-'):
                raise ValueError('Run profile contention only in a separate clone-test target.')
            args.tests = ['tests/Feature/Patients/ProfileSaveContentionTest.php']
        if args.action == 'chart-concurrency':
            if not runtime.name.startswith('contention-'):
                raise ValueError('Run chart contention only in a separate clone-test target.')
            args.tests = ['tests/Feature/Charts/ChartCommandContentionTest.php']
        if args.action == 'dependent-concurrency':
            if not runtime.name.startswith('contention-'):
                raise ValueError('Run dependent contention only in a separate clone-test target.')
            args.tests = ['tests/Feature/Intake/DependentCreationContentionTest.php']
        if args.profile != 'test' or not args.tests:
            raise ValueError('Choose test profile and explicit reviewed test paths; no blanket Feature/concurrency/reset suite.')
        for name in args.tests:
            file = (ROOT / 'backend' / name).resolve()
            if not file.is_relative_to(ROOT / 'backend/tests') or not file.name.endswith('Test.php'):
                raise ValueError('Expected explicit backend test files.')
            if (('migrate:fresh' in file.read_text() or 'use DatabaseMigrations' in file.read_text()) and args.action != 'verify-guard') or ('Concurren' in file.name and args.action != 'concurrency'):
                raise ValueError('This test requires a separately reviewed concurrency/reset runner.')
        test_env = environment(c, runtime, 'test')
        if args.test_mail_profile == 'suite':
            # phpunit.xml declares these defaults, but inherited target env wins over non-forced XML values.
            # Opt in explicitly; demo/capture/worker/concurrency behavior and all database guards stay unchanged.
            test_env.update(MAIL_MAILER='array', QUEUE_CONNECTION='sync')
        if args.action == 'verify-schema':
            test_env['DENTALOPS_SCHEMA_VERIFICATION'] = '1'
        if args.action == 'concurrency':
            test_env['AUD10_DISPOSABLE_POSTGRES_ACCEPTANCE'] = '1'
        if args.action == 'billing-concurrency':
            test_env['BILLING_DISPOSABLE_POSTGRES_ACCEPTANCE'] = '1'
        if args.action == 'prescription-concurrency':
            test_env['PRESCRIPTION_DISPOSABLE_POSTGRES_ACCEPTANCE'] = '1'
        if args.action == 'arrival-concurrency':
            test_env['ARRIVAL_DISPOSABLE_POSTGRES_ACCEPTANCE'] = '1'
        if args.action == 'encounter-concurrency':
            test_env['ENCOUNTER_DISPOSABLE_POSTGRES_ACCEPTANCE'] = '1'
        if args.action == 'profile-concurrency':
            test_env['PROFILE_DISPOSABLE_POSTGRES_ACCEPTANCE'] = '1'
        if args.action == 'chart-concurrency':
            test_env['CHART_DISPOSABLE_POSTGRES_ACCEPTANCE'] = '1'
        if args.action == 'dependent-concurrency':
            test_env['DEPENDENT_DISPOSABLE_POSTGRES_ACCEPTANCE'] = '1'
        subprocess.run([c['php'], 'vendor/bin/phpunit', '-c', 'phpunit.xml', '--bootstrap', 'tests/Support/IsolatedTestBootstrap.php',
                        '--cache-directory', str(runtime / 'cache/phpunit'), *(['--filter', args.filter] if args.filter else []), *args.tests],
                       cwd=ROOT / 'backend', env=test_env, check=True)
    elif args.action == 'serve':
        os.execve(c['php'], [c['php'], str(ROOT / 'backend/artisan'), 'serve', '--host=127.0.0.1', '--port=8104', '--no-reload'],
                  environment(c, runtime, args.profile))
    elif args.action == 'mailbox':
        if args.profile != 'demo':
            raise ValueError('Mailbox capture is a demo-only operation.')
        os.execve('/usr/bin/python3', ['python3', str(ROOT / 'scripts/local-mailbox.py'), str(runtime)], {'PATH': '/usr/bin:/bin'})
    elif args.action in ['worker', 'scheduler']:
        if args.profile != 'demo':
            raise ValueError('Background services run only against the owned demo database.')
        os.chdir(ROOT / 'backend')
        command = ['queue:work', '--queue=mail,default', '--sleep=1', '--tries=1'] if args.action == 'worker' else ['schedule:work']
        os.execve(c['php'], [c['php'], 'artisan', *command, '--no-interaction'], environment(c, runtime, 'demo'))
    elif args.action == 'ui':
        env = {'PATH': '/usr/local/bin:/usr/bin:/bin', 'HOME': str(Path.home()), 'VITE_API_BASE_URL': 'http://127.0.0.1:8104', 'TZ': 'Asia/Manila'}
        os.chdir(ROOT)
        os.execve('/usr/local/bin/node', ['node', str(ROOT / 'scripts/local-ui.mjs'), str(runtime)], env)


if __name__ == '__main__':
    try:
        main()
    except (ValueError, OSError, subprocess.CalledProcessError) as error:
        print('Local operation refused or failed; inspect the local logs. No other target was selected.', file=sys.stderr)
        sys.exit(1)
