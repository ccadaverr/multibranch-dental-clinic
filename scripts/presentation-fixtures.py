#!/usr/bin/env python3
"""Prepare browser presentation prerequisites on an explicitly owned synthetic cluster."""

import argparse
import fcntl
import json
from pathlib import Path
import runpy
import subprocess


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--target', required=True)
    args = parser.parse_args()
    scripts = Path(__file__).resolve().parent
    private = runpy.run_path(str(scripts / 'local-system.py'))
    config, runtime = private['target'](args.target)
    with (runtime / 'dental_clinic_demo.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        prepare(private, config, runtime, scripts.parent / 'backend')


def prepare(private, config, runtime, backend):
    private['verify'](config, runtime, config['demo_database'])
    marker = runtime / 'synthetic-runtime'
    if not marker.is_file() or marker.is_symlink() or marker.read_text().strip() != config['cluster_id']:
        raise ValueError('Use a disposable synthetic runtime.')
    if (runtime / 'presentation-finance.json').exists():
        raise ValueError('Presentation fixtures have already been prepared.')

    private['backup'](config, runtime, config['demo_database'])
    env = private['environment'](config, runtime, 'demo')
    env['DENTALOPS_LOCAL_VISIT_FIXTURE'] = '1'
    env['DENTALOPS_PRESENTATION_FIXTURE'] = '1'
    visit_fixture = (backend / 'tests/Support/local_visit_fixture.php').read_text()
    primary_patient = "'sprint02.patient@example.test', 'Patient'"
    if visit_fixture.count(primary_patient) != 1:
        raise ValueError('The existing visit fixture changed. Verify the secondary fixture identity.')
    secondary = visit_fixture.replace(primary_patient, "'b13.second.synthetic@example.test', 'Second Patient'")
    for source, name in [(visit_fixture, 'visit-fixture.json'), (secondary, 'b13-second-visit-fixture.json')]:
        fixture = subprocess.check_output([config['php']], cwd=backend, env=env, text=True, input=source)
        path = runtime / name
        path.write_text(json.dumps(json.loads(fixture)))
        path.chmod(0o600)
    subprocess.run([config['php'], 'tests/Support/local_presentation_fixture.php'], cwd=backend, env=env, check=True)
    if not (runtime / 'presentation-finance.json').is_file():
        raise RuntimeError('The presentation finance fixture did not produce verified evidence.')
    print('Prepared authenticated presentation prerequisites on the owned synthetic target.')


if __name__ == '__main__':
    main()
