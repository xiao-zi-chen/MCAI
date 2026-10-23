"""Prepare an isolated Linux lab; EULA acceptance is an explicit optional flag."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tarfile

ROOT = Path(__file__).resolve().parents[1]
JAVA = {
    'version': '21.0.13+9',
    'url': 'https://github.com/adoptium/temurin21-binaries/releases/download/jdk-21.0.13%2B9/OpenJDK21U-jre_x64_linux_hotspot_21.0.13_9.tar.gz',
    'sha256': 'a535a1df9c6284d9618872984e026ae0352d1f7e9e0605425c0e6114f47351dd',
}
REDIS = {
    'version': '8.10.2',
    'url': 'https://download.redis.io/releases/redis-8.10.2.tar.gz',
    'sha256': 'b9ffee226b5eecdba98a679260dad764b2a4ebd90dce4ad5ac9e9f3eef9c02b3',
}


def child_path(value):
    result = (ROOT / value).resolve()
    if not result.is_relative_to(ROOT) or result == ROOT:
        raise ValueError('Path must remain inside the project: ' + str(value))
    return result


def fetch(spec, target):
    if not target.exists():
        partial = target.with_suffix(target.suffix + '.part')
        subprocess.run(['curl', '--fail', '--location', '--retry', '2',
                        '--connect-timeout', '15', '--max-time', '600',
                        '--limit-rate', '8M', '--output', str(partial), spec['url']], check=True)
        if hashlib.sha256(partial.read_bytes()).hexdigest() != spec['sha256']:
            raise ValueError('Download checksum mismatch: ' + target.name)
        partial.replace(target)
    if hashlib.sha256(target.read_bytes()).hexdigest() != spec['sha256']:
        raise ValueError('Cached download checksum mismatch: ' + target.name)


def run(args, **kwargs):
    subprocess.run([str(x) for x in args], check=True, cwd=ROOT, **kwargs)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--accept-eula', action='store_true',
                        help='Only use after the operator accepts the Minecraft EULA')
    parser.add_argument('--config', default='configs/scheduler.squads.json')
    args = parser.parse_args()
    config_path = child_path(args.config)
    config = json.loads(config_path.read_text(encoding='utf-8-sig'))
    child_path(config['server_root'])
    deps = ROOT / 'deps'
    deps.mkdir(exist_ok=True)
    (ROOT / 'runs').mkdir(exist_ok=True)
    os.environ['npm_config_cache'] = str(deps / 'npm-cache')
    os.environ['PIP_CACHE_DIR'] = str(deps / 'pip-cache')
    os.environ['npm_config_jobs'] = '1'
    os.environ['MAKEFLAGS'] = '-j1'
    print('Preparing project-local Java 21', flush=True)
    if not (deps / 'java/bin/java').exists():
        archive = deps / 'java.tar.gz'
        fetch(JAVA, archive)
        staging = deps / 'java-unpack'
        staging.mkdir(exist_ok=True)
        with tarfile.open(archive) as package:
            package.extractall(staging, filter='data')
        roots = [p for p in staging.iterdir() if (p / 'bin/java').exists()]
        if len(roots) != 1:
            raise ValueError('Expected one Java runtime in archive')
        roots[0].rename(deps / 'java')
    version = subprocess.run([str(deps / 'java/bin/java'), '-version'],
                             capture_output=True, text=True, check=True)
    if 'version "21.' not in version.stderr + version.stdout:
        raise ValueError('Project Java runtime must be Java 21')
    print('Preparing dedicated Redis', flush=True)
    redis_dir = deps / ('redis-' + REDIS['version'])
    if not (redis_dir / 'src/redis-server').exists():
        archive = deps / 'redis.tar.gz'
        fetch(REDIS, archive)
        with tarfile.open(archive) as package:
            package.extractall(deps, filter='data')
        run(['make', '-C', redis_dir, '-j1', 'MALLOC=libc', 'BUILD_TLS=no',
             'REDIS_CFLAGS=', 'REDIS_LDFLAGS=', 'redis-server'])
    print('Preparing project Python and pinned Node packages', flush=True)
    venv = deps / 'python'
    python = venv / 'bin/python'
    if not python.exists():
        run([sys.executable, '-m', 'venv', venv])
    run([python, '-m', 'pip', 'install', 'PyYAML==6.0.2', 'jsonschema==4.23.0', 'Pillow==10.4.0'])
    for component in ['bot-controller', 'local-scheduler', 'local-viewer']:
        run(['npm', 'ci', '--omit=dev', '--no-audit', '--no-fund', '--prefix', ROOT / component])
    run([python, ROOT / 'scripts/prepare-bedwars.py', '--apply-rules',
         '--scheduler-config', config_path])
    run([python, ROOT / 'scripts/prepare-native-items.py', '--rules-file',
         child_path(config.get('rules_file', 'competition/rules.json'))])
    server = child_path(config['server_root'])
    if args.accept_eula:
        (server / 'eula.txt').write_text('eula=true\n', encoding='utf-8')
    manifest = {'java': JAVA, 'redis': REDIS, 'python': str(python),
                'config': str(config_path), 'eula_changed': args.accept_eula}
    (ROOT / 'runs/deployment-dependencies.json').write_text(json.dumps(manifest, indent=2) + '\n')
    print('PRIVATE_PREPARATION_COMPLETE; EULA ' + ('explicitly accepted' if args.accept_eula else 'unchanged'), flush=True)


if __name__ == '__main__':
    main()