#!/usr/bin/env python3
"""Owner-approved grant proposal testing, only in a NEW disposable synthetic cluster. No existing-service cutover."""
import argparse
import fcntl
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import signal
import socket
import subprocess
import sys
import time

sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location('local_system', Path(__file__).with_name('local-system.py'))
local = importlib.util.module_from_spec(spec)
spec.loader.exec_module(local)
PROPOSAL = local.ROOT / 'docs/integration/proposals/2026_11_16_001000_add_conversation_dentist_grants.php'
REVIEWED_SHA256 = '9b53175b26d656c62c29524da742d7f654bc2a0ce1451704784bb101fae56612'


def wait_for(predicate, seconds=15):
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        if predicate(): return
        time.sleep(0.05)
    raise RuntimeError('Timed out waiting for real grant contention.')


def run(source, browser=False):
    os.umask(0o077)
    if hashlib.sha256(PROPOSAL.read_bytes()).hexdigest() != REVIEWED_SHA256:
        raise ValueError('Changed grant proposal requires a new separate review before execution.')
    c, runtime = local.target(source)
    local.verify(c, runtime, 'dental_clinic_test'); local.migrations(c)
    if local.sql(c, runtime, 'dental_clinic_test', 'SELECT count(*) FROM patients') != '0':
        raise ValueError('Use the empty owned test source. Nothing was reset.')
    with (runtime / (c['test_database']+'.lock')).open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        if local.sql(c, runtime, 'dental_clinic_test', 'SELECT count(*) FROM patients') != '0':
            raise ValueError('The source changed before snapshot; nothing was reset.')
        manifest = local.clone_test(c, runtime)
    lab, root = local.target(manifest)
    processes = []
    services = []
    try:
        local.verify(lab, root, 'dental_clinic_test')
        before = local.sql(lab, root, 'dental_clinic_test', 'SELECT migration FROM migrations ORDER BY migration').splitlines()
        if before != sorted(lab['selected_migrations']):
            raise ValueError('Unexpected migration ledger before grant proposal execution.')
        with (root / 'env/test.env').open('a') as env:
            env.write('DENTALOPS_CONVERSATION_GRANTS_ENABLED=true\nDENTALOPS_GRANT_LAB='+lab['cluster_id']+'\nLARAVEL_STORAGE_PATH='+str(root / 'storage')+'\nBROADCAST_CONNECTION=log\n')
        for directory in ['app/private', 'framework/cache/data', 'framework/views', 'framework/sessions', 'logs']:
            (root / 'storage' / directory).mkdir(parents=True, mode=0o700, exist_ok=True)
        lab['selected_migrations'] = sorted(before + [PROPOSAL.stem])
        lab['migration_hashes'][PROPOSAL.name] = REVIEWED_SHA256
        lab['reviewed_proposal'] = {'path': str(PROPOSAL.relative_to(local.ROOT)), 'sha256': REVIEWED_SHA256,
                                   'authorization': 'Owner approved NEW disposable cluster testing only'}
        manifest.write_text(json.dumps(lab, indent=2))
        paths = ['database/'+('compatibility/' if name.endswith('_preserve_queue_state_vocabulary') else 'migrations/')+name+'.php' for name in before]
        paths.append('../'+str(PROPOSAL.relative_to(local.ROOT)))
        # Only this exact reviewed file, only this newly created target; no default migration chain.
        with (root / 'logs/grant-schema.log').open('w') as log:
            subprocess.run([lab['php'], 'artisan', 'migrate', '--force'] + ['--path='+path for path in paths],
                           cwd=local.ROOT / 'backend', env=local.environment(lab, root, 'test', migrator=True), stdout=log, stderr=log, check=True)
        after = local.sql(lab, root, 'dental_clinic_test', 'SELECT migration FROM migrations ORDER BY migration').splitlines()
        if after != sorted(before + [PROPOSAL.stem]):
            raise ValueError('Grant proposal must be the only added migration.')
        # Runtime role is deliberately not the migrator. It can append/read grants, never update/delete grant history.
        local.sql(lab, root, 'dental_clinic_test', 'GRANT SELECT, INSERT ON conversation_dentist_grants TO dentalops_app; GRANT USAGE, SELECT ON SEQUENCE conversation_dentist_grants_id_seq TO dentalops_app;')
        lab['selected_migrations'] = after
        lab['reviewed_proposal'] = {'path': str(PROPOSAL.relative_to(local.ROOT)), 'sha256': REVIEWED_SHA256,
                                   'authorization': 'Owner approved NEW disposable cluster testing only'}
        manifest.write_text(json.dumps(lab, indent=2))
        with (root / 'logs/grant-tests.log').open('w') as log:
            result = subprocess.run([lab['php'], 'vendor/bin/phpunit', '-c', 'phpunit.xml', '--bootstrap', 'tests/Support/IsolatedTestBootstrap.php',
                                     '--do-not-cache-result', 'tests/Support/ConversationGrantLabTest.php'],
                                    cwd=local.ROOT / 'backend', env=local.environment(lab, root, 'test'), stdout=log, stderr=log)
        if result.returncode:
            raise RuntimeError('Grant acceptance failed; inspect private logs at '+str(root / 'logs'))
        test_env = local.environment(lab, root, 'test')
        test = [lab['php'], 'vendor/bin/phpunit', '-c', 'phpunit.xml', '--bootstrap', 'tests/Support/IsolatedTestBootstrap.php', '--do-not-cache-result']
        with (root / 'logs/grant-contention-prepare.log').open('w') as log:
            subprocess.run(test + ['tests/Support/ConversationGrantContentionFixtureTest.php'], cwd=local.ROOT / 'backend', env=test_env, stdout=log, stderr=log, check=True)

        def launch(tag, payload):
            (root / ('grant-request-'+tag+'.json')).write_text(json.dumps(payload))
            with (root / 'logs' / ('grant-'+tag+'.log')).open('w') as log:
                p = subprocess.Popen([lab['php'], 'tests/Support/conversation_grant_command.php', tag], cwd=local.ROOT / 'backend', env=test_env, stdout=log, stderr=log)
            processes.append(p)
            return p

        def finish(p, tag):
            if p.wait(timeout=25) != 0: raise RuntimeError('Grant process failed; inspect private '+tag+' log.')
            return json.loads((root / ('grant-result-'+tag+'.json')).read_text())

        def hold_conversation():
            with (root / 'logs/grant-row-lock.log').open('w') as log:
                p = subprocess.Popen([lab['pg_bin']+'/psql', '-X', '-v', 'ON_ERROR_STOP=1', '-d', 'dental_clinic_test'],
                                     env=local.pg_env(lab, root), stdin=subprocess.PIPE, stdout=log, stderr=log, text=True)
            processes.append(p)
            p.stdin.write('BEGIN; SELECT id FROM conversations FOR UPDATE;\n'); p.stdin.flush()
            wait_for(lambda: local.sql(lab, root, 'dental_clinic_test', "SELECT count(*) FROM pg_stat_activity WHERE usename='dentalops_dev' AND state='idle in transaction'") == '1')
            return p

        def waiting(n):
            return local.sql(lab, root, 'dental_clinic_test', "SELECT count(*) FROM pg_stat_activity WHERE usename='dentalops_app' AND wait_event_type='Lock'") == str(n)

        def release(p):
            p.stdin.write('COMMIT;\n\\q\n'); p.stdin.flush(); p.stdin.close()
            if p.wait(timeout=5) != 0: raise RuntimeError('Grant row-lock fixture failed.')

        lock = hold_conversation()
        payloads = [{'action':'assign','actor':'staffB1','dentist':'dentist1','revision':1,'key':'grant-race-a'},
                    {'action':'assign','actor':'staffBoth','dentist':'dentist2','revision':1,'key':'grant-race-b'}]
        workers = [launch('race-'+str(i), payload) for i, payload in enumerate(payloads)]
        wait_for(lambda: waiting(2)); release(lock)
        results = [finish(p, 'race-'+str(i)) for i,p in enumerate(workers)]
        if sorted(r['status'] for r in results) != [201,409]: raise RuntimeError('One assignment must commit and the stale competitor must conflict.')
        winner = next(i for i,r in enumerate(results) if r['status']==201)
        former = payloads[winner]['dentist']; next_dentist = payloads[1-winner]['dentist']
        lock = hold_conversation()
        change = launch('switch', {'action':'assign','actor':'staffB1','dentist':next_dentist,'revision':2,'key':'grant-revoke'})
        wait_for(lambda: waiting(1))
        delayed = launch('delayed-former', {'action':'send','actor':former,'key':'delayed-former-send'})
        wait_for(lambda: waiting(2)); release(lock)
        if finish(change, 'switch')['status'] != 201 or finish(delayed, 'delayed-former')['status'] != 403:
            raise RuntimeError('A former Dentist pending write must be denied after reassignment commits.')
        if local.sql(lab, root, 'dental_clinic_test', 'SELECT count(*) FROM conversation_messages') != '1':
            raise RuntimeError('Delayed revoked write changed immutable message history.')
        lock = hold_conversation()
        retry = {'action':'assign','actor':'staffB1','dentist':former,'revision':3,'key':'grant-lost-response'}
        a = launch('duplicate-a',retry); b = launch('duplicate-b',retry)
        wait_for(lambda: waiting(2)); release(lock)
        duplicates = [finish(a,'duplicate-a'), finish(b,'duplicate-b')]
        if [r['status'] for r in duplicates] != [201,201] or duplicates[0]['body'] != duplicates[1]['body'] or sum(r['replayed'] for r in duplicates) != 1:
            raise RuntimeError('Simultaneous original-key retries must return one persisted grant.')
        recovered = finish(launch('lost-response-recovery', retry), 'lost-response-recovery')
        if not recovered['replayed'] or recovered['body'] != duplicates[0]['body']:
            raise RuntimeError('Lost-response recovery did not return the original grant receipt.')
        if local.sql(lab, root, 'dental_clinic_test', 'SELECT count(*) FROM conversation_dentist_grants') != '3':
            raise RuntimeError('Concurrent retries created an unexpected grant count.')
        # Prove the append-only trigger even as the migrator; a missing trigger would still roll this no-op UPDATE back.
        immutable = subprocess.run([lab['pg_bin']+'/psql', '-X', '-v', 'ON_ERROR_STOP=1', '-d', 'dental_clinic_test', '-c',
            'BEGIN; UPDATE conversation_dentist_grants SET reason=reason WHERE id=(SELECT min(id) FROM conversation_dentist_grants); ROLLBACK;'],
            env=local.pg_env(lab, root), capture_output=True, text=True)
        (root / 'logs/grant-immutability.log').write_text(immutable.stdout+immutable.stderr)
        if immutable.returncode == 0 or 'Conversation Dentist grants are append-only' not in immutable.stderr:
            raise RuntimeError('The database append-only trigger did not reject an administrator UPDATE.')
        (root / 'grant-result.json').write_text(json.dumps({'cas_statuses':sorted(r['status'] for r in results), 'observed_lock_waiters':2,
            'delayed_former_write':403, 'concurrent_duplicate_statuses':[201,201], 'original_key_recovery':True,
            'grants':3, 'messages':1, 'admin_append_only_trigger_proven':True,
            'schema_migrations_added':[PROPOSAL.name], 'rollout':'NEW disposable test cluster only'}, indent=2))
        if browser:
            def free_port():
                with socket.socket() as sock:
                    sock.bind(('127.0.0.1', 0)); return sock.getsockname()[1]
            api_port, ui_port = free_port(), free_port()
            api_url, ui_url = 'http://127.0.0.1:'+str(api_port), 'http://127.0.0.1:'+str(ui_port)
            browser_env = {**test_env, 'APP_URL':api_url, 'FRONTEND_URL':ui_url, 'APP_DEBUG':'false',
                           'SANCTUM_STATEFUL_DOMAINS':'127.0.0.1:'+str(ui_port)+',127.0.0.1:'+str(api_port),
                           'SESSION_DRIVER':'database', 'SESSION_DOMAIN':'null', 'SESSION_COOKIE':'grant_lab_'+lab['cluster_id'][:8]}
            (root / 'env/.env').write_text('VITE_API_BASE_URL='+api_url+'\n')
            def service(argv, name):
                with (root / 'logs' / (name+'.log')).open('w') as log:
                    p = subprocess.Popen(argv, cwd=local.ROOT, env=browser_env, stdout=log, stderr=log, start_new_session=True)
                services.append(p)
            service([lab['php'], 'backend/artisan', 'serve', '--host=127.0.0.1', '--port='+str(api_port), '--no-reload'], 'browser-api')
            service(['node', 'scripts/local-ui.mjs', str(root), str(ui_port)], 'browser-vite')
            def listening(port):
                with socket.socket() as sock: return sock.connect_ex(('127.0.0.1',port)) == 0
            wait_for(lambda: listening(api_port) and listening(ui_port))
            browser_env.update(LOCAL_SYSTEM_BASE=ui_url, LOCAL_SYSTEM_API=api_url, LOCAL_SYSTEM_BROWSER_TIMEOUT_MS='60000',
                               LOCAL_SYSTEM_EVIDENCE=str(root / 'browser'), PLAYWRIGHT_MODULE=os.environ.get('PLAYWRIGHT_MODULE','playwright'))
            with (root / 'logs/grant-browser.log').open('w') as log:
                subprocess.run(['node', 'tests/conversation-grant-live.browser.mjs'], cwd=local.ROOT, env=browser_env, stdout=log, stderr=log, check=True)
            print('PASS: real isolated grant browser lifecycle:', root / 'browser/conversation-grant-live.json')
        print('PASS: separately reviewed grant schema and focused lifecycle:', root / 'logs/grant-tests.log')
        print('PASS: PostgreSQL CAS/revocation/duplicate/recovery contention:', root / 'grant-result.json')
    finally:
        for process in services:
            try: os.killpg(process.pid, signal.SIGTERM)
            except ProcessLookupError: pass
        for process in services:
            try: process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                try: os.killpg(process.pid, signal.SIGKILL)
                except ProcessLookupError: pass
                process.wait(timeout=5)
        for process in processes:
            if process.poll() is None: process.kill(); process.wait(timeout=5)
        with (root / 'logs/stop.log').open('w') as log:
            subprocess.run([lab['pg_bin']+'/pg_ctl', '-D', lab['data_directory'], '-m', 'fast', '-w', 'stop'], stdout=log, stderr=log, check=True)
        print('Disposable grant cluster stopped; evidence retained:', root)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--target', required=True)
    parser.add_argument('--browser', action='store_true', help='Also start isolated loopback Laravel/Vite and exercise the actual browser workflow')
    args = parser.parse_args()
    run(Path(args.target), args.browser)
