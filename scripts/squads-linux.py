"""Manage a private, resource-limited four-team lab without changing system services."""
import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import time
import uuid

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('lab_runtime', ROOT / 'scripts/run-linux.py')
runtime = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runtime)


def unit_name(config_path, config):
    namespace = config.get('namespace', '')
    if not re.fullmatch(r'[a-zA-Z0-9_-]{1,50}', namespace):
        raise ValueError('Use an explicit alphanumeric namespace')
    digest = hashlib.sha256((str(ROOT) + '\0' + str(config_path)).encode()).hexdigest()[:8]
    return f'pvprobo-{namespace}-{digest}'


def unit_state(unit):
    result = subprocess.run(['systemctl', '--user', 'show', unit, '--no-pager',
                             '--property=LoadState,ActiveState,SubState,WorkingDirectory,MemoryCurrent,MemoryMax,MemorySwapMax,CPUQuotaPerSecUSec,ControlGroup,Result'],
                            capture_output=True, text=True)
    return dict(line.split('=', 1) for line in result.stdout.splitlines() if '=' in line)


def assert_owned(state):
    if state.get('LoadState') not in (None, 'not-found') and state.get('WorkingDirectory') != str(ROOT):
        raise ValueError('Existing unit belongs to another workspace; refusing to change it')


def doctor(config_path, config):
    run = runtime.local_path(config.get('scheduler_root', 'runs/scheduler'))
    run.mkdir(parents=True, exist_ok=True)
    return subprocess.run(['node', str(ROOT / 'scripts/scheduler-doctor.cjs'), f'--config={config_path}',
                           f'--java-home={ROOT / "deps/java"}', f'--redis-exe={ROOT / "deps/redis-8.10.2/src/redis-server"}',
                           '--memory-gb=2', f'--output={run / "doctor.json"}'], cwd=ROOT,
                          env={**os.environ, 'SKYDUEL_PYTHON': str(ROOT / 'deps/python/bin/python')}).returncode


def start_unit(unit, command, run, preparation=False, cpu_cores=2):
    state = unit_state(unit)
    assert_owned(state)
    if state.get('ActiveState') in ('active', 'activating', 'deactivating'):
        raise ValueError('This project operation is already active: ' + unit)
    props = {'WorkingDirectory': str(ROOT), 'Description': 'Private Minecraft lab: ' + str(ROOT),
             'CPUQuota': '100%' if preparation else f'{cpu_cores * 100:g}%', 'CPUWeight': '10', 'IOWeight': '10',
             'MemoryMax': '1536M' if preparation else '5120M', 'MemoryHigh': '1280M' if preparation else '4608M',
             'MemorySwapMax': '0', 'TasksMax': '384', 'Nice': '10', 'UMask': '0077',
             'NoNewPrivileges': 'yes', 'RestrictSUIDSGID': 'yes', 'KillMode': 'mixed',
             'TimeoutStopSec': '420', 'Restart': 'no',
             'StandardOutput': 'append:' + str(run / ('prepare.log' if preparation else 'supervisor.log')),
             'StandardError': 'inherit'}
    args = ['systemd-run', '--user', '--collect', '--unit=' + unit]
    args.extend('--property=' + key + '=' + value for key, value in props.items())
    subprocess.run(args + [str(x) for x in command], check=True, cwd=ROOT)



def submit_verification(run, request_id, rounds):
    temporary = run / ('verify-' + request_id + '.tmp')
    temporary.write_text(json.dumps({'id': request_id, 'normal_rounds': rounds}))
    try:
        # Publish a complete file atomically, without replacing another request.
        os.link(temporary, run / 'verify-request.json')
    finally:
        temporary.unlink()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('mode', choices=['prepare', 'doctor', 'start', 'verify', 'stop', 'status'])
    parser.add_argument('--config', default='configs/scheduler.squads.json')
    parser.add_argument('--accept-eula', action='store_true',
                        help='Explicitly confirm acceptance of the Minecraft EULA for this instance')
    parser.add_argument('--normal-rounds', type=int, default=1, choices=range(0, 11))
    args = parser.parse_args()
    if sys.platform != 'linux':
        raise SystemExit('Use squads.ps1 on Windows')
    config_path = runtime.local_path(args.config)
    config = json.loads(config_path.read_text(encoding='utf-8-sig'))
    backends, _ = runtime.runtime_config(config)
    run = runtime.local_path(config.get('scheduler_root', 'runs/scheduler'))
    run.mkdir(parents=True, exist_ok=True)
    unit = unit_name(config_path, config)
    state = unit_state(unit)
    assert_owned(state)
    if args.accept_eula and args.mode not in ('start', 'verify'):
        raise SystemExit('--accept-eula is only valid with start or verify')
    if args.mode == 'status':
        print(json.dumps({'unit': unit, 'root': str(ROOT), 'state': state, 'log_directory': str(run)}, indent=2))
        return 0
    if args.mode == 'doctor':
        return doctor(config_path, config)
    if args.mode == 'stop':
        if state.get('ActiveState') in ('active', 'activating', 'deactivating'):
            subprocess.run(['systemctl', '--user', 'stop', unit], check=True)
        print('Dedicated lab stopped; other units were not changed')
        return 0
    if args.mode == 'prepare':
        if state.get('ActiveState') in ('active', 'activating', 'deactivating'):
            raise SystemExit('Stop this lab before preparing its files')
        command = [sys.executable, ROOT / 'scripts/bootstrap-linux.py', '--config', config_path]
        start_unit(unit + '-prepare', command, run, preparation=True)
        print('Preparation running in a limited unit. Log: ' + str(run / 'prepare.log'))
        return 0
    if args.accept_eula:
        for backend in backends:
            server = runtime.local_path(backend['server_root'])
            if not (server / 'paper.jar').exists():
                raise SystemExit('Prepare this instance before accepting its EULA')
        for backend in backends:
            (runtime.local_path(backend['server_root']) / 'eula.txt').write_text('eula=true\n')
        print('Minecraft EULA accepted by explicit operator flag')
    if doctor(config_path, config):
        return 1
    if state.get('ActiveState') not in ('active', 'activating'):
        launch_id = uuid.uuid4().hex
        command = [sys.executable, ROOT / 'scripts/run-linux.py', '--config', config_path,
                   '--heap-mb=2048', '--java-cpus=2', '--require-cgroup', '--launch-id=' + launch_id]
        start_unit(unit, command, run, cpu_cores=runtime.configured_cpu_cores(config))
        deadline = time.monotonic() + 1200
        while time.monotonic() < deadline:
            ready_file = run / 'ready.json'
            if ready_file.exists() and json.loads(ready_file.read_text()).get('launch_id') == launch_id:
                break
            if unit_state(unit).get('ActiveState') not in ('active', 'activating'):
                raise SystemExit('Lab startup failed. Inspect ' + str(run / 'supervisor.log'))
            time.sleep(1)
        else:
            raise SystemExit('Startup timed out; inspect the dedicated unit and logs')
    print('Lab ready; dashboard 127.0.0.1:' + str(config['web_port']))
    if args.mode == 'verify':
        request_id = uuid.uuid4().hex
        submit_verification(run, request_id, args.normal_rounds)
        report = run / ('verification-' + request_id + '.json')
        deadline = time.monotonic() + (args.normal_rounds + 1) * (config.get('match_timeout_ms', 2400000) / 1000 + 300)
        print('Live acceptance running inside the same resource limit. Report: ' + str(report), flush=True)
        while time.monotonic() < deadline:
            state_file = run / 'verification-state.json'
            if state_file.exists():
                result = json.loads(state_file.read_text())
                if result.get('id') == request_id and result.get('state') == 'complete':
                    return int(result.get('exit_code', 1))
                if result.get('id') == request_id and result.get('state') == 'rejected':
                    raise SystemExit(result['error'])
            if unit_state(unit).get('ActiveState') != 'active':
                raise SystemExit('Lab exited during verification; inspect the report and logs')
            time.sleep(1)
        raise SystemExit('Verification wait timed out; inspect ' + str(report))
    return 0


if __name__ == '__main__':
    sys.exit(main())
