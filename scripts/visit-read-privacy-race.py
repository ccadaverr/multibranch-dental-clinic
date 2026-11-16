#!/usr/bin/env python3
"""Prove direct Visit read denial during an independent Owner scope revocation. Fresh disposable clone only."""
import argparse
import fcntl
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import time

sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location('local_system', Path(__file__).with_name('local-system.py'))
local = importlib.util.module_from_spec(spec)
spec.loader.exec_module(local)


def run(manifest):
    os.umask(0o077)
    c, runtime = local.target(manifest)
    if not runtime.name.startswith('contention-'):
        raise ValueError('Only a new disposable clone is accepted; existing demo/test services are unchanged.')
    local.verify(c, runtime, 'dental_clinic_test')
    local.migrations(c)
    processes = []
    with (runtime / 'dental_clinic_test.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        if local.sql(c, runtime, 'dental_clinic_test', 'SELECT count(*) FROM patients') != '0':
            raise ValueError('Fresh empty synthetic target required; no reset is performed.')
        expected = sorted(c['selected_migrations'])
        if local.sql(c, runtime, 'dental_clinic_test', 'SELECT migration FROM migrations ORDER BY migration').splitlines() != expected:
            raise ValueError('Unexpected ledger; no migration is performed.')
        env = local.environment(c, runtime, 'test')
        env.update(DENTALOPS_VISIT_READ_RACE='1', MAIL_MAILER='array', QUEUE_CONNECTION='sync',
                   SESSION_DRIVER='array', CACHE_STORE='array', LOG_CHANNEL='stderr', LOG_LEVEL='critical', APP_DEBUG='false')
        command = [c['php'], str(local.ROOT / 'backend/tests/Support/visit_read_privacy_worker.php')]

        def worker(payload):
            process = subprocess.Popen(command, cwd=local.ROOT / 'backend', env=env,
                                       stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
            processes.append(process)
            process.stdin.write(json.dumps(payload)+'\n')
            process.stdin.close()
            return process

        def result(process):
            process.wait(timeout=25)
            output, errors = process.stdout.read(), process.stderr.read()
            if process.returncode:
                raise RuntimeError('Synthetic worker failed; no other target or migration was selected.')
            return json.loads(output)

        try:
            fixture = result(worker({'action': 'seed'}))
            results = {}
            for phase in ['before', 'after']:
                if phase == 'after':
                    assert result(worker({'action': 'grant', 'fixture': fixture}))['status'] == 200
                allowed = result(worker({'action': 'read', 'fixture': fixture}))
                assert allowed['status'] == 200 and allowed['exact_visit']
                reader = worker({'action': 'read', 'fixture': fixture, 'phase': phase})
                base = runtime / 'logs' / ('visit-read-'+phase)
                deadline = time.monotonic()+20
                while not base.with_suffix('.ready').is_file():
                    if reader.poll() is not None or time.monotonic() > deadline:
                        raise RuntimeError('Read did not reach the deterministic PostgreSQL barrier.')
                    time.sleep(0.02)
                reader_pid = int(base.with_suffix('.ready').read_text())
                revoker = result(worker({'action': 'revoke', 'fixture': fixture}))
                assert revoker['status'] == 200 and revoker['pid'] != reader_pid
                assert reader.poll() is None, 'Reader must still be in flight when revocation commits'
                base.with_suffix('.release').write_text('revocation committed\n')
                denied = result(reader)
                assert denied['status'] == 404 and denied['keys'] == ['message']
                assert denied['message'] == 'Visit not found.' and not denied['exact_visit']
                assert denied['barrier_observed'] and 'private' in denied['cache_control'] and 'no-store' in denied['cache_control']
                results[phase] = {'authorized_before': 200, 'owner_revoke': 200, 'read_after_commit': denied,
                                  'independent_postgresql_connections': True, 'revocation_committed_while_read_in_flight': True}
            results['schema_migrations_executed'] = 0
            results['scope'] = 'Real independent PHP/PostgreSQL processes; before lookup and after scoped lookup/before policy. Not an application lock-contention claim.'
            (runtime / 'logs/visit-read-race-result.json').write_text(json.dumps(results, indent=2)+'\n')
            print(json.dumps(results, indent=2))
        finally:
            for process in processes:
                if process.poll() is None:
                    process.terminate()
                    process.wait(timeout=5)
                for stream in [process.stdout, process.stderr]:
                    stream.close()
            # Stop only this verified, explicitly disposable cluster; retain fixtures/logs/backups privately.
            subprocess.run([c['pg_bin']+'/pg_ctl', '-D', c['data_directory'], '-w', 'stop', '-m', 'fast'],
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--target', required=True)
    args = parser.parse_args()
    try:
        run(args.target)
    except (ValueError, RuntimeError, OSError, subprocess.SubprocessError, AssertionError):
        print('Visit-read race refused or failed; no fallback, migration or external delivery.', file=sys.stderr)
        sys.exit(1)
