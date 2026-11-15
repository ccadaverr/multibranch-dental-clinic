#!/usr/bin/env python3
"""Only ID-only synthetic notification prerequisites in the verified owned demo profile."""
from pathlib import Path
import runpy
import subprocess
import sys
import fcntl
import json
import secrets

root = Path(__file__).resolve().parents[1]
runner = runpy.run_path(str(root / 'scripts/local-system.py'))
c, runtime = runner['target'](Path(sys.argv[1]))
runner['verify'](c, runtime, c['demo_database'])
runner['migrations'](c)
lock = open(runtime / (c['demo_database'] + '.lock'), 'a')
fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
runner['backup'](c, runtime, c['demo_database'])
env = runner['environment'](c, runtime, 'demo')
env['DENTALOPS_LOCAL_OPERATIONS_FIXTURE'] = '1'
env['DENTALOPS_LOCAL_OPERATIONS_RUN'] = secrets.token_hex(4)
result = subprocess.check_output([c['php'], 'tests/Support/local_operations_fixture.php'], cwd=root / 'backend', env=env, text=True)
data = json.loads(result)
manifest = runtime / 'operations-browser-fixture.json'
manifest.write_text(json.dumps(data))
manifest.chmod(0o600)
print('Synthetic notification fixture:', data['run_id'])
