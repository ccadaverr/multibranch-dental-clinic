#!/usr/bin/env python3
"""Exercise committed synthetic queue/recovery fixtures in NEW owned PostgreSQL clusters only. Never migrate/reset."""
import argparse
import fcntl
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import shutil
import socket
import subprocess
import sys
import time

sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location('local_system', Path(__file__).with_name('local-system.py'))
local = importlib.util.module_from_spec(spec)
spec.loader.exec_module(local)


def wait_for(predicate, seconds=12):
    until = time.monotonic() + seconds
    while time.monotonic() < until:
        if predicate():
            return
        time.sleep(0.05)
    raise RuntimeError('Timed out waiting for the isolated runtime stage.')


def prepare(manifest):
    c, runtime = local.target(manifest)
    if not runtime.name.startswith('contention-'):
        raise ValueError('Only newly cloned contention targets may become disposable runtime labs.')
    local.verify(c, runtime, 'dental_clinic_test')
    local.migrations(c)
    (runtime / 'clinical-runtime-lab').write_text(c['cluster_id'])
    values = local.environment(c, runtime, 'test')
    for key in ['PATH', 'HOME', 'TZ']:
        values.pop(key, None)
    # Never inherit an ambient mail service, queue, storage root or destructive migration setting.
    with socket.socket() as sock:
        sock.bind(('127.0.0.1', 0))
        port = sock.getsockname()[1]
    values.update(APP_ENV='testing', APP_DEBUG='false', AUTO_MIGRATE='false', DB_URL='',
                  MAIL_MAILER='local_capture', QUEUE_CONNECTION='database',
                  DENTALOPS_LOCAL_CAPTURE_PORT=str(port), DENTALOPS_RUNTIME_LAB=c['cluster_id'],
                  LARAVEL_STORAGE_PATH=str(runtime / 'storage'))
    for folder in ['app/private', 'framework/cache/data', 'framework/sessions', 'framework/views', 'logs']:
        (runtime / 'storage' / folder).mkdir(parents=True, mode=0o700, exist_ok=True)
    (runtime / 'env/test.env').write_text(''.join(k + '=' + v + '\n' for k, v in values.items()))
    return c, runtime, local.environment(c, runtime, 'test'), port


def run_lab(source):
    os.umask(0o077)
    c, runtime = local.target(source)
    local.verify(c, runtime, 'dental_clinic_test')
    local.migrations(c)
    empty = json.loads(local.sql(c, runtime, 'dental_clinic_test',
        "SELECT json_build_array((SELECT count(*) FROM patients),(SELECT count(*) FROM jobs),(SELECT count(*) FROM mail_dispatches),(SELECT count(*) FROM documents))"))
    if empty != [0, 0, 0, 0]:
        raise ValueError('The source test database must contain no existing fixtures; nothing was reset.')
    # Lock the source while taking its consistent initial snapshot. All subsequent writes are to a new cluster.
    with (runtime / (c['test_database']+'.lock')).open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        if json.loads(local.sql(c, runtime, 'dental_clinic_test',
                "SELECT json_build_array((SELECT count(*) FROM patients),(SELECT count(*) FROM jobs),(SELECT count(*) FROM mail_dispatches),(SELECT count(*) FROM documents))")) != [0,0,0,0]:
            raise ValueError('The source changed before snapshot; nothing was reset.')
        manifest = local.clone_test(c, runtime)
    lab, root, env, port = prepare(manifest)
    restored = None
    processes = []

    def launch(argv, name, process_env=env):
        with (root / 'logs' / (name + '.log')).open('w') as log:
            process = subprocess.Popen(argv, cwd=local.ROOT / 'backend', env=process_env, stdout=log, stderr=subprocess.STDOUT)
        processes.append(process)
        return process

    def finish(process):
        if process.wait(timeout=25) != 0:
            raise RuntimeError('A lab command failed; inspect private logs at '+str(root / 'logs'))

    def command(action, clock, name):
        return launch([lab['php'], 'tests/Support/clinical_runtime_command.php', action, clock], name)

    def state():
        return json.loads(local.sql(lab, root, 'dental_clinic_test',
            "SELECT json_build_object('status',status,'attempts',attempts,'confirmed',delivery_confirmed_at,'locked',locked_at) FROM mail_dispatches"))

    def captures():
        return list((root / 'mailbox').glob('*.eml'))

    def mailbox(hold=False):
        p = launch(['/usr/bin/python3', str(local.ROOT / 'scripts/local-mailbox.py'), str(root), str(port)]
                   + (['--hold-before-capture'] if hold else []), 'capture-held' if hold else 'capture')
        def listening():
            with socket.socket() as sock:
                return sock.connect_ex(('127.0.0.1', port)) == 0
        wait_for(listening)
        return p

    test = [lab['php'], 'vendor/bin/phpunit', '-c', 'phpunit.xml', '--bootstrap', 'tests/Support/IsolatedTestBootstrap.php',
            '--do-not-cache-result', 'tests/Support/ClinicalRuntimeLabTest.php']
    try:
        finish(launch(test + ['--filter', 'test_prepare_committed_fixture'], 'prepare'))
        assert state()['status'] == 'pending' and not captures()
        # No SMTP listener: actual queued worker records a failed attempt and schedules a bounded retry.
        finish(command('worker', '2026-09-28 10:00:00', 'worker-offline'))
        assert state()['status'] == 'retry_scheduled' and state()['attempts'] == 1 and not captures()
        finish(command('scheduler', '2026-09-28 10:00:30', 'scheduler-before-due'))
        assert state()['attempts'] == 1 and state()['status'] == 'retry_scheduled'
        held = mailbox(True)
        worker = command('worker', '2026-09-28 10:02:00', 'worker-interrupted')
        wait_for(lambda: (root / 'capture-blocked').is_file())
        assert state()['status'] == 'processing' and not captures()
        worker.kill(); worker.wait(timeout=5)
        held.kill(); held.wait(timeout=5)
        live = mailbox()
        finish(command('scheduler', '2026-09-28 10:03:00', 'scheduler-fresh-claim'))
        assert state()['status'] == 'processing' and not captures(), 'Fresh claims must not be stolen.'
        # Force two independent due-mail processors to wait on the SAME PostgreSQL row before releasing it.
        with (root / 'logs/contention-lock.log').open('w') as log:
            row_lock = subprocess.Popen([lab['pg_bin']+'/psql', '-X', '-v', 'ON_ERROR_STOP=1', '-d', 'dental_clinic_test'],
                                        env=local.pg_env(lab, root), stdin=subprocess.PIPE, stdout=log, stderr=log, text=True)
        processes.append(row_lock)
        row_lock.stdin.write('BEGIN; SELECT id FROM mail_dispatches FOR UPDATE;\n'); row_lock.stdin.flush()
        wait_for(lambda: int(local.sql(lab, root, 'dental_clinic_test',
                     "SELECT count(*) FROM pg_stat_activity WHERE usename='dentalops_dev' AND state='idle in transaction'")) == 1)
        workers = [command('due', '2026-09-28 10:13:00', 'due-contention-'+str(i)) for i in range(2)]
        wait_for(lambda: int(local.sql(lab, root, 'dental_clinic_test',
                     "SELECT count(*) FROM pg_stat_activity WHERE usename='dentalops_app' AND wait_event_type='Lock'")) == 2)
        row_lock.stdin.write('COMMIT;\n\\q\n'); row_lock.stdin.flush(); row_lock.stdin.close()
        finish(row_lock)
        for worker in workers:
            finish(worker)
        assert state()['status'] == 'logged_only' and state()['attempts'] == 2
        assert state()['confirmed'] is None and len(captures()) == 1
        finish(command('worker', '2026-09-28 10:15:00', 'worker-duplicate'))
        finish(command('scheduler', '2026-09-28 10:15:00', 'scheduler-duplicate'))
        assert len(captures()) == 1 and state()['attempts'] == 2
        assert local.sql(lab, root, 'dental_clinic_test', 'SELECT count(*) FROM jobs') == '0'
        live.terminate(); live.wait(timeout=5)
        # pg_dump/restore to a SECOND new cluster, not the original, then copy private object bytes.
        restored = local.clone_test(lab, root)
        rc, rr, re, _ = prepare(restored)
        shutil.copy2(root / 'clinical-fixture.json', rr / 'clinical-fixture.json')
        src = root / 'storage/app/private'
        dst = rr / 'storage/app/private'
        hashes = {}
        for path in src.rglob('*'):
            if path.is_symlink():
                raise ValueError('Refusing symlink in the private document backup.')
            if path.is_file():
                relative = path.relative_to(src)
                destination = dst / relative
                destination.parent.mkdir(parents=True, mode=0o700, exist_ok=True)
                shutil.copy2(path, destination)
                digest = hashlib.sha256(path.read_bytes()).hexdigest()
                assert hashlib.sha256(destination.read_bytes()).hexdigest() == digest
                hashes[str(relative)] = digest
        assert len(hashes) == 1
        assert env['APP_KEY'] == re['APP_KEY'], 'Encrypted fields require the preserved private test APP_KEY.'
        finish(launch(test + ['--filter', 'test_restored_identifiers_bytes_key_and_access_boundaries'], 'restore-check', re))
        assert not list((rr / 'mailbox').glob('*.eml')), 'Restore must not send mail.'
        report = {'source': str(source), 'lab': str(manifest), 'restore': str(restored), 'schema_migrations_executed': 0,
                  'worker_failure_retry': True, 'interrupted_before_transport_ack': True,
                  'fresh_claim_not_stolen': True, 'stale_claim_recovered': True,
                  'postgresql_processors_observed_waiting_on_lock': 2,
                  'terminal_duplicate_suppressed': True, 'local_captures': 1, 'external_delivery_confirmed': False,
                  'private_document_hashes': hashes, 'restored_access_and_key_verified': True,
                  'scheduler_scope': 'Source mail:process-due frequency only; clinical automations not executed',
                  'limitation': 'At-least-once transport; a crash after SMTP acceptance can legitimately duplicate delivery.'}
        (root / 'result.json').write_text(json.dumps(report, indent=2))
        print('PASS: private runtime and restore evidence:', root / 'result.json')
    finally:
        for process in processes:
            if process.poll() is None:
                process.kill(); process.wait(timeout=5)
        for owned in [manifest, restored]:
            if owned:
                sc, sr = local.target(owned)
                with (sr / 'logs/stop.log').open('w') as log:
                    subprocess.run([sc['pg_bin']+'/pg_ctl', '-D', sc['data_directory'], '-m', 'fast', '-w', 'stop'],
                                   stdout=log, stderr=log, check=True)
        print('Disposable clusters stopped; private evidence retained at', root)


if __name__ == '__main__':
    if not __debug__:
        raise RuntimeError('Acceptance assertions require Python without optimization.')
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--target', required=True)
    args = parser.parse_args()
    run_lab(Path(args.target))
