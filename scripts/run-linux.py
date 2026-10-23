"""Supervise only this project's Linux processes inside a bounded systemd cgroup."""
import argparse
from concurrent.futures import ThreadPoolExecutor
import json
import math
import os
import re
from pathlib import Path
import signal
import socket
import subprocess
import time
import urllib.request

ROOT = Path(__file__).resolve().parents[1]


def local_path(value, root=ROOT):
    root = root.resolve()
    result = (root / value).resolve()
    if result == root or not result.is_relative_to(root):
        raise ValueError('Path must be inside the project: ' + str(value))
    return result


def properties(file):
    return {key.strip(): value.strip() for key, value in
            (line.split('=', 1) for line in file.read_text().splitlines()
             if '=' in line and not line.lstrip().startswith(('#', '!')))}


def runtime_config(config, root=ROOT):
    backends = config.get('servers') or [dict(id='default', **{
        key: config.get(key) for key in ['server_root', 'game_port', 'control_port', 'rcon_port']})]
    ports = [config[key] for key in ['redis_port', 'web_port']]
    for backend in backends:
        local_path(backend['server_root'], root)
        ports.extend(backend.get(key) or 25578 for key in ['game_port', 'control_port', 'rcon_port'])
    for arena in config['arenas']:
        ports.extend(arena[key] for key in ['observer_port', 'viewer_port'])
    if any(type(port) is not int or not 1 <= port <= 65535 for port in ports) or len(set(ports)) != len(ports):
        raise ValueError('Invalid or overlapping configured ports')
    return backends, ports


def configured_cpu_cores(config):
    value = config.get('runtime_cpu_cores', 2)
    if type(value) not in (int, float) or not math.isfinite(value) or not 0 < value <= (os.cpu_count() or 1):
        raise ValueError('runtime_cpu_cores must be positive and no larger than the host CPU count')
    return value


def bounded_cgroup(max_cpu_cores=2):
    group = next(line[3:] for line in Path('/proc/self/cgroup').read_text().splitlines() if line.startswith('0::'))
    base = Path('/sys/fs/cgroup') / group.lstrip('/')
    memory = (base / 'memory.max').read_text().strip()
    swap = (base / 'memory.swap.max').read_text().strip()
    quota, period = (base / 'cpu.max').read_text().split()
    if not memory.isdigit() or int(memory) > 5 * 1024**3 or swap != '0':
        raise ValueError('Runtime requires MemoryMax <= 5 GiB and MemorySwapMax=0')
    if not quota.isdigit() or int(quota) > max_cpu_cores * int(period):
        raise ValueError(f'Runtime requires CPUQuota <= {max_cpu_cores * 100:g}%')
    return {'path': str(base), 'memory_max_bytes': int(memory), 'swap_max_bytes': 0,
            'cpu_cores_max': int(quota) / int(period)}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--config', default='configs/scheduler.squads.json')
    parser.add_argument('--java', default='deps/java/bin/java')
    parser.add_argument('--redis', default='deps/redis-8.10.2/src/redis-server')
    parser.add_argument('--heap-mb', type=int, default=2048)
    parser.add_argument('--java-cpus', type=int, default=2)
    parser.add_argument('--startup-seconds', type=int, default=600)
    parser.add_argument('--require-cgroup', action='store_true')
    parser.add_argument('--launch-id', default='manual')
    parser.add_argument('--verify-rounds', type=int, choices=range(0, 11))
    args = parser.parse_args()
    config_path = local_path(args.config)
    cfg = json.loads(config_path.read_text(encoding='utf-8-sig'))
    backends, ports = runtime_config(cfg)
    run = local_path(cfg.get('scheduler_root', 'runs/scheduler'))
    run.mkdir(parents=True, exist_ok=True)
    limits = bounded_cgroup(configured_cpu_cores(cfg)) if args.require_cgroup else {}
    for backend in backends:
        server = local_path(backend['server_root'])
        eula = server / 'eula.txt'
        if not eula.exists() or properties(eula).get('eula', '').strip() != 'true':
            raise SystemExit('EULA acceptance missing; use --accept-eula in squads-linux.py only after you agree')
        if properties(server / 'server.properties').get('server-ip') != '127.0.0.1':
            raise SystemExit('Private instances must bind to 127.0.0.1')
    for port in ports:
        with socket.socket() as sock:
            sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            try:
                sock.bind(('127.0.0.1', port))
            except OSError:
                raise SystemExit(f'Port {port} is occupied; no existing process will be changed')
    env = {**os.environ, 'SKYDUEL_SCHEDULER_CONFIG': str(config_path),
           'SKYDUEL_SERVER_ROOT': backends[0]['server_root'], 'SKYDUEL_RUNTIME_ROOT': str(ROOT / 'bot-controller'),
           'BEDWARS_VIEWER_MODULES': str(ROOT / 'local-viewer/node_modules'),
           'SKYDUEL_PYTHON': str(ROOT / 'deps/python/bin/python')}
    subprocess.run(['node', str(ROOT / 'scripts/scheduler-doctor.cjs'), f'--config={config_path}',
                    f'--java-home={local_path(args.java).parent.parent}', f'--redis-exe={local_path(args.redis)}',
                    f'--memory-gb={args.heap_mb / 1024}', f'--output={run / "doctor.json"}'],
                   check=True, cwd=ROOT, env=env)
    children, files, javas = [], [], []
    stopping = False
    scheduler = None
    verifier = None
    verification_id = None
    ready_file = run / 'ready.json'

    def stop(*_):
        nonlocal stopping
        stopping = True

    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)

    def launch(name, command, cwd, console=False):
        out = (run / (name + '.out.log')).open('ab')
        err = (run / (name + '.err.log')).open('ab')
        files.extend([out, err])
        child = subprocess.Popen([str(x) for x in command], cwd=cwd, env=env, stdout=out, stderr=err,
                                 stdin=subprocess.PIPE if console else subprocess.DEVNULL)
        children.append(child)
        (run / (name + '.pid')).write_text(str(child.pid))
        return child

    def healthy():
        if stopping:
            raise RuntimeError('Startup interrupted')
        if any(child.poll() is not None for child in children):
            raise RuntimeError('An owned process exited; inspect ' + str(run))

    def wait_port(port):
        deadline = time.monotonic() + args.startup_seconds
        while time.monotonic() < deadline:
            healthy()
            try:
                with socket.create_connection(('127.0.0.1', port), timeout=.3):
                    return
            except OSError:
                time.sleep(.5)
        raise RuntimeError(f'Port {port} did not become ready')

    def api(route, data=None, timeout=5):
        request = urllib.request.Request(f'http://127.0.0.1:{cfg["web_port"]}/api/{route}',
                                         data=None if data is None else json.dumps(data).encode(),
                                         headers={'Content-Type': 'application/json'})
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return json.load(response)

    def rcon(backend, command):
        return subprocess.run([env['SKYDUEL_PYTHON'], str(ROOT / 'scripts/bedwars-rcon.py'), command],
                              cwd=ROOT, env={**env, 'SKYDUEL_SERVER_ROOT': backend['server_root']},
                              timeout=15, capture_output=True, text=True)

    redis_dir = run / 'redis'
    redis_dir.mkdir(exist_ok=True)
    conf = redis_dir / 'redis.conf'
    conf.write_text(f'bind 127.0.0.1\nprotected-mode yes\nport {cfg["redis_port"]}\ndir "{redis_dir}"\n'
                    'appendonly yes\nappendfsync always\nmaxmemory 256mb\nmaxmemory-policy noeviction\nsave 900 1\n')
    try:
        launch('redis', [local_path(args.redis), conf], redis_dir)
        wait_port(cfg['redis_port'])
        for backend in backends:
            server = local_path(backend['server_root'])
            name = 'minecraft' if len(backends) == 1 else 'minecraft-' + backend['id']
            java = launch(name, [local_path(args.java), '-Xms512m', f'-Xmx{backend.get("heap_mb", args.heap_mb)}m',
                                 f'-XX:ActiveProcessorCount={backend.get("java_cpus", args.java_cpus)}',
                                 '-Dterminal.jline=false', '-Dterminal.ansi=false', '-jar', server / 'paper.jar', '--nogui'], server, True)
            javas.append((java, backend))
            (server / 'server.pid').write_text(str(java.pid))
            wait_port(backend['control_port'])
        scheduler = launch('scheduler', ['node', ROOT / 'local-scheduler/server.cjs'], ROOT)
        wait_port(cfg['web_port'])
        deadline = time.monotonic() + args.startup_seconds
        while True:
            healthy()
            state = api('status')
            if state.get('namespace') != cfg['namespace']:
                raise RuntimeError('Coordinator identity mismatch')
            if state['arenas'] and all(a.get('state') == 'available' and a.get('beds_ready') for a in state['arenas']):
                break
            if time.monotonic() > deadline:
                raise RuntimeError('Arena and bed readiness timed out')
            time.sleep(1)
        if cfg.get('auto_viewer'):
            for arena in cfg['arenas']:
                api('watch', {'arena_id': arena['id']}, timeout=90)
                deadline = time.monotonic() + 30
                while time.monotonic() < deadline:
                    healthy()
                    with urllib.request.urlopen(f'http://127.0.0.1:{arena["viewer_port"]}/status', timeout=5) as response:
                        viewer = json.load(response)
                    if viewer.get('connected') and viewer.get('replay_map_ready'):
                        break
                    time.sleep(.5)
                else:
                    raise RuntimeError('Complete live and replay map did not become ready')
        ready = {'launch_id': args.launch_id, 'pid': os.getpid(), 'namespace': cfg['namespace'],
                 'ready_at': time.time(), 'limits': limits}
        temporary = ready_file.with_suffix('.tmp')
        temporary.write_text(json.dumps(ready, indent=2))
        temporary.replace(ready_file)
        print('PRIVATE_LAB_READY ' + json.dumps(ready), flush=True)
        if args.verify_rounds is not None:
            verifier = launch('verification', ['node', ROOT / 'scripts/verify-squads-live.cjs',
                              f'--config={config_path}', f'--normal-rounds={args.verify_rounds}',
                              f'--output={run / "live-verification.json"}'], ROOT)
        while not stopping:
            request_file = run / 'verify-request.json'
            if request_file.exists():
                request = json.loads(request_file.read_text())
                request_file.unlink()
                identity, rounds = request.get('id', ''), request.get('normal_rounds')
                if not re.fullmatch(r'[a-f0-9]{32}', identity) or type(rounds) is not int or not 0 <= rounds <= 10:
                    raise ValueError('Malformed local verification request')
                if verifier:
                    state = {'id': identity, 'state': 'rejected', 'error': 'Another verification is running'}
                else:
                    verification_id = identity
                    report = run / ('verification-' + identity + '.json')
                    verifier = launch('verification', ['node', ROOT / 'scripts/verify-squads-live.cjs',
                                      f'--config={config_path}', f'--normal-rounds={rounds}', f'--output={report}'], ROOT)
                    state = {'id': identity, 'state': 'running', 'report': str(report), 'pid': verifier.pid}
                state_path = run / 'verification-state.json'
                temp = state_path.with_suffix('.tmp')
                temp.write_text(json.dumps(state))
                temp.replace(state_path)
            if verifier and verifier.poll() is not None:
                children.remove(verifier)
                print('LIVE_VERIFICATION_EXIT=' + str(verifier.returncode), flush=True)
                temp = run / 'verification-state.tmp'
                temp.write_text(json.dumps({'id': verification_id, 'state': 'complete', 'exit_code': verifier.returncode}))
                temp.replace(run / 'verification-state.json')
                verifier = None
            if any(child.poll() is not None for child in children):
                raise RuntimeError('An owned service exited unexpectedly')
            time.sleep(.5)
    finally:
        if ready_file.exists():
            ready_file.unlink()
        if verifier and verifier.poll() is None:
            verifier.terminate()
            try:
                verifier.wait(timeout=20)
            except subprocess.TimeoutExpired:
                pass
        if scheduler and scheduler.poll() is None:
            try:
                api('pause', {'paused': True})
                for _, backend in javas:
                    rcon(backend, 'skyduel abort')
                deadline = time.monotonic() + cfg.get('reset_timeout_ms', 180000) / 1000
                while time.monotonic() < deadline:
                    if all(a.get('state') == 'available' for a in api('status')['arenas']):
                        break
                    time.sleep(1)
                api('shutdown', {})
                scheduler.wait(timeout=20)
            except Exception as exc:
                print('Coordinator shutdown: ' + str(exc), flush=True)
        def stop_java(item):
            java, backend = item
            if java.poll() is not None:
                return
            try:
                result = rcon(backend, 'stop')
                if result.returncode:
                    raise RuntimeError('RCON unavailable')
            except Exception:
                try:
                    java.stdin.write(b'stop\n')
                    java.stdin.flush()
                except (OSError, ValueError):
                    java.terminate()
            try:
                java.wait(timeout=120)
            except subprocess.TimeoutExpired:
                print('Java save timeout; sending SIGTERM to owned process', flush=True)
                java.terminate()
                try:
                    java.wait(timeout=20)
                except subprocess.TimeoutExpired:
                    print('Owned Java did not exit after save and termination timeouts', flush=True)
        with ThreadPoolExecutor(max_workers=max(1, len(javas))) as pool:
            list(pool.map(stop_java, javas))
        for child in reversed(children):
            if child.poll() is None:
                child.terminate()
        for child in reversed(children):
            try:
                child.wait(timeout=10)
            except subprocess.TimeoutExpired:
                child.kill()
                child.wait(timeout=5)
        for file in files:
            file.close()
        for file in run.glob('*.pid'):
            if file.read_text().strip() in {str(child.pid) for child in children}:
                file.unlink()
        for java, backend in javas:
            pidfile = local_path(backend['server_root']) / 'server.pid'
            if pidfile.exists() and pidfile.read_text().strip() == str(java.pid) and java.poll() is not None:
                pidfile.unlink()
        print('PRIVATE_LAB_STOPPED', flush=True)


if __name__ == '__main__':
    main()
