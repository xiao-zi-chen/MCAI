"""Prepare independent backend roots, reusing a stopped private lab's verified files."""
import argparse,json,shutil,socket,subprocess,sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
p=argparse.ArgumentParser(description=__doc__)
p.add_argument('--config',default='configs/scheduler.multi-48.json')
p.add_argument('--seed-root',default='runs/bedwars-local')
p.add_argument('--accept-eula',action='store_true')
a=p.parse_args();cfg=json.loads((ROOT/a.config).read_text());seed=(ROOT/a.seed_root).resolve()
if not a.accept_eula:raise SystemExit('Pass --accept-eula only after accepting the Minecraft EULA')
if not seed.is_relative_to(ROOT.resolve()):raise SystemExit('Seed must stay in this workspace')
props=dict(line.split('=',1) for line in (seed/'server.properties').read_text().splitlines() if '=' in line and not line.startswith('#'))
try:
 with socket.create_connection(('127.0.0.1',int(props['server-port'])),timeout=.3):raise SystemExit('Stop the seed server before copying worlds')
except OSError:pass
plans=[]
for s in cfg['servers']:
 target=(ROOT/s['server_root']).resolve()
 if not target.is_relative_to((ROOT/'runs').resolve()) or target==seed:raise SystemExit('Invalid backend root')
 if target.exists():raise SystemExit(f'Backend already exists: {target}. Preserve it and select a new root.')
 subset={**cfg,**s,'arenas':[arena for arena in cfg['arenas'] if arena['server_id']==s['id']]};subset.pop('servers')
 plans.append((s,target,subset))
for s,target,subset in plans:
 target.mkdir(parents=True)
 # Only immutable binaries/caches and restored worlds are copied, never lease/replay state.
 for relative in ['plugins','cache','libraries','versions','config']:
  source=seed/relative
  if not source.exists():continue
  if relative=='plugins':
   (target/'plugins').mkdir(exist_ok=True)
   for jar in source.glob('*.jar'):shutil.copy2(jar,target/'plugins'/jar.name)
  else:shutil.copytree(source,target/relative)
 for relative in ['bukkit.yml','spigot.yml']:
  if (seed/relative).exists():shutil.copy2(seed/relative,target/relative)
 for world in {arena['world'] for arena in subset['arenas']}:
  if (seed/world).exists():shutil.copytree(seed/world,target/world,ignore=shutil.ignore_patterns('session.lock'))
 generated=target/'scheduler.json';generated.write_text(json.dumps(subset,indent=2)+'\n')
 subprocess.run([sys.executable,str(ROOT/'scripts/prepare-bedwars.py'),'--scheduler-config',str(generated),'--apply-rules'],cwd=ROOT,check=True)
 (target/'eula.txt').write_text('eula=true\n')
 print(f'Prepared {s["id"]}: {len(subset["arenas"])} worlds, game port {s["game_port"]}',flush=True)
