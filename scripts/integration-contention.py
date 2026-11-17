#!/usr/bin/env python3
"""Reviewable integration contention lanes: fresh synthetic clones only, no migration/reset/provider calls."""
import argparse,fcntl,importlib.util,json,subprocess
from pathlib import Path
spec=importlib.util.spec_from_file_location('local_system',Path(__file__).with_name('local-system.py'))
local=importlib.util.module_from_spec(spec);spec.loader.exec_module(local)

def run(target):
    c,r=local.target(target);local.verify(c,r,'dental_clinic_test');local.migrations(c)
    if json.loads(local.sql(c,r,'dental_clinic_test','SELECT json_build_array((SELECT count(*) FROM patients),(SELECT count(*) FROM jobs),(SELECT count(*) FROM mail_dispatches))')) != [0,0,0]:
        raise ValueError('Only an empty verified synthetic source may be cloned; nothing is reset.')
    cases=[('branch','test','tests/Feature/Reference/BranchCodeContentionTest.php'),
           ('inquiry','test','tests/Feature/Inquiries/InquiryAssignmentContentionTest.php'),
           ('roster','roster-publication-contention',None),('leave','leave-recovery-contention',None),
           ('arrival','arrival-concurrency',None),('encounter','encounter-concurrency',None),
           ('chart','chart-concurrency',None),('prescription','prescription-concurrency',None),('cash','billing-concurrency',None)]
    results=[]
    for name,action,file in cases:
        with (r/'dental_clinic_test.lock').open('a') as lock:
            fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
            clone=local.clone_test(c,r)
        cc,cr=local.target(clone)
        command=['python3',str(local.ROOT/'scripts/local-system.py'),'--target',str(clone),'--profile','test',action]+([file] if file else [])
        try:
            with (cr/('logs/integration-'+name+'.log')).open('w') as log:
                result=subprocess.run(command,stdout=log,stderr=log)
            results.append({'lane':name,'target':str(clone),'exit':result.returncode,'log':str(cr/('logs/integration-'+name+'.log'))})
            local.verify(cc,cr,'dental_clinic_test');local.backup(cc,cr,'dental_clinic_test')
        finally:
            with (cr/'logs/stop.log').open('w') as log:subprocess.run([cc['pg_bin']+'/pg_ctl','-D',cc['data_directory'],'-m','fast','-w','stop'],stdout=log,stderr=log,check=True)
        (r/'contention-results.json').write_text(json.dumps(results,indent=2)+'\n')
        print(name,'PASS' if result.returncode==0 else 'FAIL',flush=True)
    if any(row['exit'] for row in results):raise RuntimeError('One or more retained contention lanes failed; inspect their private logs.')
if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--target',required=True);run(p.parse_args().target)
