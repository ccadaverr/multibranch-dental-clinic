#!/usr/bin/env python3
"""Run each committed Operations scenario on its own NEW archive-only test clone."""
import argparse
import fcntl
import importlib.util
from pathlib import Path
import subprocess

spec = importlib.util.spec_from_file_location('local', Path(__file__).with_name('local-system.py'))
local = importlib.util.module_from_spec(spec)
spec.loader.exec_module(local)
SCENARIOS = [
    'test_branch_access_rechecks_actor_and_target_after_real_lock_waits',
    'test_real_locks_preserve_replay_stale_refusal_archive_read_and_revocation',
]


def run(source):
    config, runtime = local.target(source)
    local.verify(config, runtime, 'dental_clinic_test')
    local.migrations(config)
    if config.get('operations_migrations') != local.OPERATIONS_MIGRATIONS:
        raise ValueError('Use an independently provisioned archive-only test source.')
    with (runtime / 'dental_clinic_test.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        if local.sql(config, runtime, 'dental_clinic_test', 'SELECT count(*) FROM users') != '0':
            raise ValueError('Source test fixture must be empty; no reset or cleanup is performed.')
        for scenario in SCENARIOS:
            manifest = local.clone_test(config, runtime)
            command = ['python3', str(Path(__file__).with_name('local-system.py')), '--target', str(manifest), '--profile', 'test']
            try:
                subprocess.run([*command, '--filter', scenario, 'operations-contention'], check=True)
            finally:
                # Retain committed histories and credentials, even when a scenario fails.
                try:
                    subprocess.run([*command, 'backup'], check=True)
                finally:
                    subprocess.run([*command, 'stop'], check=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', required=True)
    args = parser.parse_args()
    try:
        run(args.source)
    except (ValueError, OSError, subprocess.CalledProcessError):
        raise SystemExit('Operations contention suite refused or failed; inspect retained private evidence.')
