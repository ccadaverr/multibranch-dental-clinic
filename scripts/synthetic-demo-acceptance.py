#!/usr/bin/env python3
"""Real durable queue and process recovery checks on an already running NEW synthetic demo only."""
import argparse
import importlib.util
import json
import os
from pathlib import Path
import secrets
import signal
import subprocess
import time

spec=importlib.util.spec_from_file_location('demo',Path(__file__).with_name('synthetic-demo-runtime.py'))
demo=importlib.util.module_from_spec(spec);spec.loader.exec_module(demo)


def wait(predicate):
    end=time.monotonic()+15
    while time.monotonic()<end:
        if predicate():return
        time.sleep(0.1)
    raise RuntimeError('Synthetic acceptance condition timed out.')


def run(target):
    c,root=demo.owned(target);demo.local.verify(c,root,'dental_clinic_demo')
    env=demo.local.environment(c,root,'demo')
    state=lambda:json.loads((root/'services.json').read_text())
    first=state();assert first['cluster_id']==c['cluster_id'] and first['state']=='running'
    worker=first['services']['worker'];assert demo.start_ticks(worker['pid'])==worker['start_ticks']
    before=len(list((root/'mailbox').glob('*.eml')))
    nonce=secrets.token_hex(8)
    def probe():
        return json.loads(subprocess.check_output([c['php'],'tests/Support/synthetic_runtime_probe.php',nonce],
                         cwd=demo.local.ROOT/'backend',env=env,text=True))
    scheduler=first['services']['scheduler'];assert demo.start_ticks(scheduler['pid'])==scheduler['start_ticks']
    os.kill(worker['pid'],signal.SIGSTOP)
    os.kill(scheduler['pid'],signal.SIGSTOP)
    try:
        pending=probe();assert pending['status']=='pending' and pending['intent_count']==1 and pending['jobs']==1
        # The supervisor still sees this PID, but health must refuse a deliberately stopped worker.
        check=subprocess.run([c['php'],'artisan','demo:check','--local-only'],cwd=demo.local.ROOT/'backend',env=env,capture_output=True,text=True)
        assert 'FAIL  Queue worker is DOWN' in check.stdout
    finally:
        os.kill(worker['pid'],signal.SIGCONT)
        os.kill(scheduler['pid'],signal.SIGCONT)
    wait(lambda:demo.local.sql(c,root,'dental_clinic_demo',"SELECT status FROM mail_dispatches WHERE public_id='"+pending['id']+"'")=='logged_only')
    assert demo.local.sql(c,root,'dental_clinic_demo',"SELECT delivery_confirmed_at IS NULL FROM mail_dispatches WHERE public_id='"+pending['id']+"'")=='t'
    confirmed=probe();assert confirmed['intent_count']==1 and confirmed['attempts']==1 and confirmed['scheduled_commands']==1
    wait(lambda:len(list((root/'mailbox').glob('*.eml')))==before+1)
    for name in ['worker','scheduler']:
        old=state()['services'][name]
        assert demo.start_ticks(old['pid'])==old['start_ticks']
        os.kill(old['pid'],signal.SIGTERM)
        wait(lambda:state()['services'].get(name,{}).get('pid') not in [None,old['pid']])
    replay=probe();assert replay['id']==pending['id'] and replay['attempts']==1 and replay['intent_count']==1
    assert len(list((root/'mailbox').glob('*.eml')))==before+1
    assert demo.local.sql(c,root,'dental_clinic_demo','SELECT count(*) FROM jobs')=='0'
    report={'target':str(target),'new_intent':pending['id'],'pending_before_worker':True,'durable_readback':True,
            'one_local_capture':True,'duplicate_suppressed':True,'worker_restart':True,'scheduler_restart':True,
            'stopped_worker_health_refused':True,'registered_schedule':'mail:process-due only',
            'external_delivery':False,'historical_jobs_processed':0}
    demo.private(root/'acceptance.json',report)
    print(json.dumps(report,indent=2))


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--target',required=True)
    run(Path(parser.parse_args().target))
