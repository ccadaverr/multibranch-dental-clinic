#!/usr/bin/env python3
"""Prepare a fresh schema-only synthetic demo and supervise its target-bound services. No migrations/reset/adoption."""
import argparse
import base64
import fcntl
import importlib.util
import json
import os
from pathlib import Path
import secrets
import signal
import socket
import subprocess
import sys
import time
from urllib.parse import urlsplit

sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location('local_system', Path(__file__).with_name('local-system.py'))
local = importlib.util.module_from_spec(spec)
spec.loader.exec_module(local)


def private(path, value):
    temporary = path.with_suffix(path.suffix + '.tmp')
    temporary.write_text(json.dumps(value, indent=2) if not isinstance(value, str) else value)
    temporary.chmod(0o600)
    temporary.replace(path)


def port_number(value):
    number = int(value)
    if not 1024 <= number <= 65535:
        raise ValueError('Unprivileged loopback ports required.')
    return number


def empty_source(c, root):
    local.verify(c, root, 'dental_clinic_test')
    selected = local.migrations(c)
    names = local.sql(c, root, 'dental_clinic_test', 'SELECT migration FROM migrations ORDER BY migration').splitlines()
    if len(selected) != 87 or set(names) != {p.stem for p in selected}:
        raise ValueError('Only the reviewed87 preservation schema may be cloned.')
    counts = json.loads(local.sql(c, root, 'dental_clinic_test',
        'SELECT json_build_array((SELECT count(*) FROM patients),(SELECT count(*) FROM users),'
        '(SELECT count(*) FROM jobs),(SELECT count(*) FROM mail_dispatches),(SELECT count(*) FROM documents))'))
    if counts != [0, 0, 0, 0, 0]:
        raise ValueError('The test source contains records; nothing was reset or copied.')


def prepare(source, api_port, frontend_url, capture_port, reference_data_only=False):
    c, root = local.target(source)
    # Snapshot the empty transactional schema only, never the populated demo or historical job tables.
    with (root / 'dental_clinic_test.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        empty_source(c, root)
        manifest = local.clone_test(c, root)
    new, runtime = local.target(manifest)
    try:
        subprocess.run([new['pg_bin']+'/createdb', '--maintenance-db=postgres', '--template=dental_clinic_test', 'dental_clinic_demo'],
                       env=local.pg_env(new, runtime), check=True)
        local.verify(new, runtime, 'dental_clinic_demo')
        (runtime / 'synthetic-runtime').write_text(new['cluster_id'])
        (runtime / 'synthetic-runtime').chmod(0o600)
        for folder in ['app/private', 'framework/cache/data', 'framework/sessions', 'framework/views', 'logs']:
            (runtime / 'storage' / folder).mkdir(parents=True, mode=0o700, exist_ok=True)
        password = secrets.token_urlsafe(32)
        private(runtime / 'demo-login-password', password+'\n')
        env = local.environment(new, runtime, 'test')
        for key in ['PATH', 'HOME', 'TZ']:
            env.pop(key, None)
        env.update(APP_ENV='local', APP_KEY='base64:'+base64.b64encode(secrets.token_bytes(32)).decode(),
                   DB_DATABASE='dental_clinic_demo', APP_URL='http://127.0.0.1:'+str(api_port), FRONTEND_URL=frontend_url,
                   AUTO_MIGRATE='false', DB_URL='', DENTALOPS_SYNTHETIC_RUNTIME='1',
                   DENTALOPS_LOCAL_TARGET=str(manifest), LARAVEL_STORAGE_PATH=str(runtime/'storage'),
                   DENTALOPS_LOCAL_CAPTURE_PORT=str(capture_port), DEMO_ACCOUNT_PASSWORD=password,
                   MAIL_MAILER='local_capture', QUEUE_CONNECTION='database',
                   SANCTUM_STATEFUL_DOMAINS=urlsplit(frontend_url).netloc+',127.0.0.1:5198,localhost:5198,127.0.0.1:5195,localhost:5195')
        # Private per-profile caches, never application bootstrap caches shared with another target.
        for key in ['CONFIG', 'SERVICES', 'PACKAGES', 'ROUTES', 'EVENTS']:
            env['APP_'+key+'_CACHE'] = str(runtime/'cache/demo'/(key.lower()+'.php'))
        (runtime/'cache/demo').mkdir(mode=0o700, exist_ok=True)
        private(runtime/'env/demo.env', ''.join(k+'='+v+'\n' for k, v in env.items()))
        private(runtime/'synthetic-config.json', {'api_port':api_port,'frontend_url':frontend_url,'capture_port':capture_port,
                                                'source_cluster':c['cluster_id'],'schema_entries':87})
        with (runtime/'logs/seed.log').open('w') as log:
            seeders = ['DatabaseSeeder']
            if not reference_data_only:
                seeders.append('DemoClinicSeeder')
            for seeder in seeders:
                subprocess.run([new['php'],'artisan','db:seed','--class='+seeder,'--no-interaction'], cwd=local.ROOT/'backend',
                               env=local.environment(new,runtime,'demo'), stdout=log, stderr=log, check=True)
        print('Prepared NEW synthetic target:', manifest, flush=True)
        print('No migrations run; private credentials retained. Seeded new synthetic records only.', flush=True)
        return manifest
    except BaseException:
        subprocess.run([new['pg_bin']+'/pg_ctl','-D',new['data_directory'],'-m','fast','-w','stop'],capture_output=True)
        raise


def owned(manifest):
    c, root = local.target(manifest)
    marker = root/'synthetic-runtime'
    if not marker.is_file() or marker.is_symlink() or marker.read_text().strip() != c['cluster_id']:
        raise ValueError('Refusing an existing/non-synthetic runtime.')
    local.migrations(c)
    return c,root


def start_ticks(pid):
    stat = Path('/proc/'+str(pid)+'/stat').read_text()
    return stat[stat.rfind(')')+2:].split()[19]


def run(manifest, seconds=0):
    c,root = owned(manifest)
    # Old toolchain images can start HTTP successfully but fail every branded PDF at first use.
    if subprocess.run([c['php'], '-r', "exit(extension_loaded('gd') ? 0 : 1);"], capture_output=True).returncode:
        print('Synthetic runtime requires PHP GD for prescription and billing PDFs. Rebuild the documented toolchain image.', file=sys.stderr)
        raise RuntimeError('Missing PHP GD; no runtime service was started.')
    # One supervisor per target. Lock survives child restarts; a second launcher cannot steal its services.
    lock=(root/'supervisor.lock').open('a')
    fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
    config=json.loads((root/'synthetic-config.json').read_text())
    env=local.environment(c,root,'demo')
    stopped=False
    def stop(*_):
        nonlocal stopped
        stopped=True
    for sig in [signal.SIGTERM,signal.SIGINT]:signal.signal(sig,stop)
    # It is safe to restart this newly owned cluster; never auto-adopt an ambient PostgreSQL server.
    if subprocess.run([c['pg_bin']+'/pg_ctl','-D',c['data_directory'],'status'],capture_output=True).returncode:
        subprocess.run([c['pg_bin']+'/pg_ctl','-D',c['data_directory'],'-w','-l',str(root/'logs/postgres.log'),
                       '-o','-h 127.0.0.1 -p '+str(c['port'])+' -k '+str(root/'sockets'),'start'],capture_output=True,check=True)
    local.verify(c,root,'dental_clinic_demo')
    api=config['api_port']; capture=config['capture_port']
    for port in [api,capture]:
        with socket.socket() as sock:sock.bind(('127.0.0.1',port))
    commands={
        'mailbox':['/usr/bin/python3',str(local.ROOT/'scripts/local-mailbox.py'),str(root),str(capture)],
        'api':[c['php'],'artisan','serve','--host=127.0.0.1','--port='+str(api),'--no-reload'],
        'worker':[c['php'],'artisan','queue:work','database','--queue=mail','--sleep=1','--tries=1','--timeout=60'],
        'scheduler':[c['php'],'artisan','schedule:work'],
    }
    children={};restarts={name:0 for name in commands}
    def launch(name):
        with (root/'logs'/(name+'.log')).open('a') as log:
            children[name]=subprocess.Popen(commands[name],cwd=local.ROOT/'backend',env=env,stdout=log,stderr=log,start_new_session=True)
    def state(status):
        services={}
        for name,p in children.items():
            if p.poll() is not None:continue
            try:services[name]={'pid':p.pid,'start_ticks':start_ticks(p.pid),'restarts':restarts[name]}
            except FileNotFoundError:continue  # A child exited during observation; the next loop restarts it.
        private(root/'services.json',{'cluster_id':c['cluster_id'],'state':status,'services':services,
            'supervisor':{'pid':os.getpid(),'start_ticks':start_ticks(os.getpid())},
            'frontend':'external caller-owned process: '+config['frontend_url']})
    begun=time.monotonic()
    try:
        for name in commands:launch(name)
        while not stopped and (not seconds or time.monotonic()-begun<seconds):
            for name,p in list(children.items()):
                if p.poll() is not None:
                    restarts[name]+=1
                    if restarts[name]>3:raise RuntimeError('Repeated service failure; inspect private logs.')
                    # Never leave an old API/server descendant behind during recovery.
                    try:os.killpg(p.pid,signal.SIGTERM)
                    except ProcessLookupError:pass
                    launch(name)
            state('running')
            time.sleep(0.2)
    finally:
        for p in children.values():
            try:os.killpg(p.pid,signal.SIGTERM)
            except ProcessLookupError:pass
        for p in children.values():
            try:p.wait(timeout=8)
            except subprocess.TimeoutExpired:os.killpg(p.pid,signal.SIGKILL);p.wait(timeout=5)
        state('stopped')
        with (root/'logs/stop.log').open('a') as log:
            subprocess.run([c['pg_bin']+'/pg_ctl','-D',c['data_directory'],'-m','fast','-w','stop'],stdout=log,stderr=log,check=True)
        print('Stopped only owned synthetic services/cluster; private records and evidence retained.',flush=True)


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    sub=parser.add_subparsers(dest='action',required=True)
    p=sub.add_parser('prepare');p.add_argument('--source',required=True)
    p.add_argument('--api-port',type=port_number,default=8104)
    p.add_argument('--capture-port',type=port_number,default=1027)
    p.add_argument('--frontend-url',default='http://127.0.0.1:5198')
    p.add_argument('--reference-data-only', action='store_true', help='Prepare accounts and reference data without the populated demo scenarios.')
    for name in ['run','check','stop']:
        p=sub.add_parser(name);p.add_argument('--target',required=True)
        if name=='run':p.add_argument('--seconds',type=int,default=0)
        elif name=='check':p.add_argument('--frontend-probe-url',help='Local container-to-host probe only; does not change browser CORS.')
    args=parser.parse_args()
    if args.action=='prepare':
        from urllib.parse import urlsplit
        url=urlsplit(args.frontend_url)
        if url.scheme!='http' or url.hostname not in ['127.0.0.1','localhost','host.docker.internal'] or url.username or url.password:
            raise ValueError('Only explicit local development frontend URLs are permitted.')
        prepare(args.source,args.api_port,args.frontend_url,args.capture_port,args.reference_data_only)
    elif args.action=='run':run(args.target,args.seconds)
    elif args.action=='stop':
        c,root=owned(args.target)
        state=json.loads((root/'services.json').read_text())
        if state.get('state')=='stopped':
            print('Owned synthetic runtime already stopped; nothing signalled.')
            return
        supervisor=state['supervisor'];pid=supervisor['pid']
        argv=Path('/proc/'+str(pid)+'/cmdline').read_bytes().split(b'\0')
        if start_ticks(pid)!=supervisor['start_ticks'] or os.fsencode(args.target) not in argv or b'run' not in argv:
            raise ValueError('Supervisor identity changed; no process was signalled.')
        os.kill(pid,signal.SIGTERM)
        deadline=time.monotonic()+20
        while Path('/proc/'+str(pid)).exists() and time.monotonic()<deadline:time.sleep(0.1)
        if Path('/proc/'+str(pid)).exists():raise RuntimeError('Shutdown timed out; inspect owned processes.')
        print('Owned supervisor and children stopped; cluster and files retained.')
    else:
        c,root=owned(args.target);local.verify(c,root,'dental_clinic_demo')
        env=local.environment(c,root,'demo')
        if args.frontend_probe_url:
            from urllib.parse import urlsplit
            url=urlsplit(args.frontend_probe_url)
            if url.scheme!='http' or url.hostname not in ['127.0.0.1','localhost','host.docker.internal'] or url.username or url.password:
                raise ValueError('Only an explicit local frontend probe is allowed.')
            env['FRONTEND_URL']=args.frontend_probe_url
        result=subprocess.run(['bash',str(local.ROOT/'scripts/predefense-check.sh'),'--local-only'],cwd=local.ROOT,env=env)
        sys.exit(result.returncode)


if __name__=='__main__':
    os.umask(0o077)
    try:main()
    except (ValueError,OSError,RuntimeError,subprocess.CalledProcessError):
        print('Synthetic runtime refused or failed; inspect private logs. No other target was selected.',file=sys.stderr)
        sys.exit(1)
