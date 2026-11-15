#!/usr/bin/env python3
"""Create a NEW owned loopback cluster for local-system.py; never adopt an existing database."""
import argparse
import base64
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import secrets
import socket
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location('local_system', ROOT / 'scripts/local-system.py')
local = importlib.util.module_from_spec(spec)
spec.loader.exec_module(local)


def validate(runtime, port, php, pg_bin):
    runtime = runtime.expanduser().absolute()
    if runtime.exists() or runtime.is_symlink():
        raise ValueError('Runtime already exists; use status on its manifest, never reprovision it.')
    if ROOT == runtime.resolve() or ROOT in runtime.resolve().parents:
        raise ValueError('Runtime must be outside the source checkout.')
    if not 1024 <= port <= 65535 or port in [5432, 5195, 8104, 1026]:
        raise ValueError('Choose a separate unprivileged PostgreSQL port, never the shared5432 endpoint.')
    if any(character.isspace() for character in str(runtime)):
        raise ValueError('Use a runtime path without whitespace for the existing PostgreSQL start/stop runner.')
    if len(str(runtime / 'sockets' / ('.s.PGSQL.' + str(port))).encode()) > 100:
        raise ValueError('Choose a shorter runtime path for PostgreSQL Unix sockets.')
    for binary in [php, *(pg_bin / name for name in ['initdb', 'pg_ctl', 'psql', 'createdb', 'pg_dump', 'pg_restore'])]:
        if not binary.is_file() or not os.access(binary, os.X_OK):
            raise ValueError('Required executable missing; pass absolute PHP and PostgreSQL binary paths.')
    with socket.socket() as sock:
        sock.bind(('127.0.0.1', port))
    return runtime.resolve()


def provision(runtime, port, php, pg_bin, operations=False):
    runtime = validate(runtime, port, php, pg_bin)
    os.umask(0o077)
    runtime.mkdir(mode=0o700, parents=True)
    for name in ['sockets', 'logs', 'backups', 'cache/demo', 'cache/test', 'env']:
        (runtime / name).mkdir(mode=0o700, parents=True)
    def private(name, text):
        path = runtime / name
        with path.open('x') as file:
            file.write(text)
        path.chmod(0o600)
    admin_password, app_password, login_password = (secrets.token_urlsafe(32) for _ in range(3))
    private('pg-password', admin_password + '\n')
    private('pgpass', f'127.0.0.1:{port}:*:dentalops_dev:{admin_password}\n')
    private('demo-login-password', login_password + '\n')
    files = sorted((ROOT / 'backend/database/migrations').glob('*.php')) + sorted((ROOT / 'backend/database/compatibility').glob('*.php'))
    if len(files) != 87 or not local.HELD <= {f.name for f in files}:
        raise ValueError('Migration inventory changed; review the preservation profile first.')
    extensions = local.OPERATIONS_MIGRATIONS if operations else []
    files += [ROOT / 'backend/database/operations' / name for name in extensions]
    manifest = runtime / 'target.json'
    state = {'root': str(ROOT), 'runtime': str(runtime), 'host': '127.0.0.1', 'port': port,
             'data_directory': str(runtime / 'postgres'), 'user': 'dentalops_dev', 'app_user': 'dentalops_app',
             'demo_database': 'dental_clinic_demo', 'test_database': 'dental_clinic_test',
             'cluster_id': secrets.token_hex(16), 'php': str(php), 'pg_bin': str(pg_bin),
             'migration_hashes': {f.name: hashlib.sha256(f.read_bytes()).hexdigest() for f in files},
             'selected_migrations': [f.stem for f in files if f.name not in local.HELD]}
    state['operations_migrations'] = extensions
    private('target.json', json.dumps(state, indent=2) + '\n')
    for profile in ['demo', 'test']:
        cache = runtime / 'cache' / profile
        values = {'APP_NAME': 'Dental Clinic local development', 'APP_ENV': 'testing' if profile == 'test' else 'local',
                  'APP_KEY': 'base64:' + base64.b64encode(secrets.token_bytes(32)).decode(), 'APP_DEBUG': 'false',
                  'APP_URL': 'http://127.0.0.1:8104', 'APP_TIMEZONE': 'Asia/Manila', 'LOG_CHANNEL': 'stderr',
                  'DB_CONNECTION': 'pgsql', 'DB_URL': '', 'DB_HOST': '127.0.0.1', 'DB_PORT': str(port),
                  'DB_DATABASE': state[profile + '_database'], 'DB_USERNAME': state['app_user'], 'DB_PASSWORD': app_password,
                  'DB_SSLMODE': 'disable', 'SESSION_DRIVER': 'database', 'SESSION_SECURE_COOKIE': 'false', 'SESSION_DOMAIN': '',
                  'CACHE_STORE': 'database', 'QUEUE_CONNECTION': 'database', 'MAIL_MAILER': 'local_capture',
                  'BROADCAST_CONNECTION': 'log', 'BCRYPT_ROUNDS': '4' if profile == 'test' else '10',
                  'FRONTEND_URL': 'http://127.0.0.1:5195',
                  'SANCTUM_STATEFUL_DOMAINS': '127.0.0.1:5195,localhost:5195,localhost:5173,127.0.0.1:5173',
                  'ASSISTANT_MODE': 'knowledge', 'PAYMONGO_MODE': 'test', 'PAYMONGO_PAYMENT_METHOD_TYPES': 'card,gcash',
                  'DEMO_ACCOUNT_PASSWORD': login_password, 'DENTALOPS_LOCAL_TARGET': str(manifest),
                  'MAIL_SCHEME': 'smtp', 'MAIL_HOST': '127.0.0.1', 'MAIL_PORT': '1026', 'MAIL_FROM_ADDRESS': 'clinic@example.test'}
        for key in ['ASSISTANT_API_KEY', 'ANTHROPIC_API_KEY', 'GEMINI_API_KEY', 'PAYMONGO_SECRET_KEY', 'PAYMONGO_PUBLIC_KEY',
                    'PAYMONGO_WEBHOOK_SECRET', 'RESEND_API_KEY', 'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY',
                    'POSTMARK_API_KEY', 'MAIL_USERNAME', 'MAIL_PASSWORD']:
            values[key] = ''
        for key, name in [('CONFIG', 'config'), ('SERVICES', 'services'), ('PACKAGES', 'packages'), ('ROUTES', 'routes'), ('EVENTS', 'events')]:
            values['APP_' + key + '_CACHE'] = str(cache / (name + '.php'))
        private('env/' + profile + '.env', ''.join(key + '=' + value + '\n' for key, value in values.items()))
    started = False
    # Logs are private; neither passwords nor SQL input are printed by this process.
    with (runtime / 'logs/provision.log').open('x') as log:
        def run(command, **kwargs):
            return subprocess.run(command, stdout=log, stderr=log, check=True, **kwargs)
        try:
            run([str(pg_bin / 'initdb'), '-D', state['data_directory'], '--username=dentalops_dev', '--encoding=UTF8',
                 '--locale=C', '--auth-local=scram-sha-256', '--auth-host=scram-sha-256', '--pwfile=' + str(runtime / 'pg-password')])
            run([str(pg_bin / 'pg_ctl'), '-D', state['data_directory'], '-l', str(runtime / 'logs/postgres.log'), '-w',
                 '-o', f'-h 127.0.0.1 -p {port} -k {runtime / "sockets"}', 'start'])
            started = True
            run([str(pg_bin / 'psql'), '-X', '-q', '-v', 'ON_ERROR_STOP=1', '-d', 'postgres'], env=local.pg_env(state, runtime),
                text=True, input="CREATE ROLE dentalops_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '" + app_password + "';")
            for database in [state['demo_database'], state['test_database']]:
                run([str(pg_bin / 'createdb'), '--maintenance-db=postgres', database], env=local.pg_env(state, runtime))
                run([str(pg_bin / 'psql'), '-X', '-q', '-v', 'ON_ERROR_STOP=1', '-d', database], env=local.pg_env(state, runtime), text=True,
                    input="CREATE SCHEMA local_development; CREATE TABLE local_development.identity(cluster_id text PRIMARY KEY); "
                    "INSERT INTO local_development.identity VALUES ('" + state['cluster_id'] + "'); "
                    "REVOKE ALL ON SCHEMA local_development FROM PUBLIC; GRANT USAGE ON SCHEMA local_development TO dentalops_app; "
                    "REVOKE ALL ON local_development.identity FROM PUBLIC; GRANT SELECT ON local_development.identity TO dentalops_app; "
                    "GRANT USAGE ON SCHEMA public TO dentalops_app;")
                local.verify(state, runtime, database)
            local.migrations(state)
        except Exception:
            if started:
                subprocess.run([str(pg_bin / 'pg_ctl'), '-D', state['data_directory'], '-m', 'fast', '-w', 'stop'], stdout=log, stderr=log)
            raise
    print('New owned local target:', manifest)
    print('No migrations/seeds executed. Credentials remain private; use local-system.py with this manifest.')
    return state


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--runtime', required=True, type=Path)
    parser.add_argument('--port', required=True, type=int)
    parser.add_argument('--php', required=True, type=Path)
    parser.add_argument('--pg-bin', required=True, type=Path)
    parser.add_argument('--operations', action='store_true', help='Opt into the reviewed additive Operations archive extension on this NEW private cluster.')
    args = parser.parse_args()
    provision(args.runtime, args.port, args.php.expanduser().resolve(), args.pg_bin.expanduser().resolve(), args.operations)


if __name__ == '__main__':
    try:
        main()
    except (ValueError, OSError, subprocess.CalledProcessError):
        print('Provisioning refused or failed. Existing targets were not adopted. Inspect only private local logs.', file=sys.stderr)
        sys.exit(1)
