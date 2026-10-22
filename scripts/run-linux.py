"""Run this dedicated lab inside ONE externally resource-limited systemd unit."""
import argparse,json,os,signal,socket,subprocess,time,urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
p=argparse.ArgumentParser();p.add_argument('--config',default='configs/scheduler.server-test.json');p.add_argument('--java',default='deps/java/bin/java');p.add_argument('--redis',default='deps/redis-8.10.2/src/redis-server');p.add_argument('--heap-mb',type=int,default=3072);p.add_argument('--java-cpus',type=int,default=2);p.add_argument('--startup-seconds',type=int,default=600);a=p.parse_args()
cfg=json.loads((ROOT/a.config).read_text());servers=cfg.get('servers') or [dict(id='default',**{k:cfg.get(k) for k in ['server_root','game_port','control_port','rcon_port']})];run=ROOT/'runs/scheduler';run.mkdir(parents=True,exist_ok=True)
for backend in servers:
 server=(ROOT/backend['server_root']).resolve()
 if not server.is_relative_to(ROOT.resolve()):raise SystemExit('Server root must stay inside this workspace')
 if (server/'eula.txt').read_text().strip()!='eula=true':raise SystemExit('EULA acceptance missing')
ports=[cfg[k] for k in ['redis_port','web_port']]+[s[k] or 25578 for s in servers for k in ['game_port','control_port','rcon_port']]+[x[k] for x in cfg['arenas'] for k in ['observer_port','viewer_port']]
if len(ports)!=len(set(ports)):raise SystemExit('Configured ports overlap')
for port in ports:
 with socket.socket() as sock:
  sock.setsockopt(socket.SOL_SOCKET,socket.SO_REUSEADDR,1)
  try:sock.bind(('127.0.0.1',port))
  except OSError:raise SystemExit(f'Port {port} already occupied. No existing service will be changed.')
env={**os.environ,'SKYDUEL_SCHEDULER_CONFIG':str(ROOT/a.config),'SKYDUEL_SERVER_ROOT':servers[0]['server_root'],'SKYDUEL_RUNTIME_ROOT':str(ROOT/'bot-controller'),'BEDWARS_VIEWER_MODULES':str(ROOT/'local-viewer/node_modules'),'SKYDUEL_PYTHON':str(ROOT/'deps/python/bin/python')}
children=[];files=[];stopping=False;javas=[]

def launch(name,args,cwd):
 out=(run/(name+'.out.log')).open('ab');err=(run/(name+'.err.log')).open('ab');files.extend([out,err]);proc=subprocess.Popen([str(x) for x in args],cwd=cwd,env=env,stdout=out,stderr=err);children.append(proc);(run/(name+'.pid')).write_text(str(proc.pid));return proc

def wait(port,seconds=240):
 start=time.monotonic()
 while time.monotonic()-start<seconds:
  if stopping:raise RuntimeError('Stopping')
  if any(c.poll() is not None for c in children):raise RuntimeError('A dedicated child exited; inspect runs/scheduler logs')
  try:
   with socket.create_connection(('127.0.0.1',port),timeout=.3):return
  except OSError:time.sleep(.5)
 raise RuntimeError(f'Port {port} did not become ready')
def stop(*_):
 global stopping;stopping=True
signal.signal(signal.SIGTERM,stop);signal.signal(signal.SIGINT,stop)
redisdir=run/'redis';redisdir.mkdir(exist_ok=True);conf=redisdir/'redis.conf'
conf.write_text(f'bind 127.0.0.1\nprotected-mode yes\nport {cfg["redis_port"]}\ndir {redisdir}\nappendonly yes\nappendfsync always\nmaxmemory 256mb\nmaxmemory-policy noeviction\nsave 900 1\n')
try:
 launch('redis',[ROOT/a.redis,conf],redisdir);wait(cfg['redis_port'])
 # Start backends sequentially so cold world loading stays within the same quota.
 for backend in servers:
  server=ROOT/backend['server_root'];name='minecraft' if len(servers)==1 else 'minecraft-'+backend['id']
  java=launch(name,[ROOT/a.java,'-Xms512m',f'-Xmx{backend.get("heap_mb",a.heap_mb)}m',f'-XX:ActiveProcessorCount={backend.get("java_cpus",a.java_cpus)}','-Dterminal.jline=false','-Dterminal.ansi=false','-jar','paper.jar','--nogui'],server)
  javas.append(java);(server/'server.pid').write_text(str(java.pid));wait(backend['control_port'],a.startup_seconds)
 launch('scheduler',['node',ROOT/'local-scheduler/server.cjs'],ROOT);wait(cfg['web_port']);print('PRIVATE_LAB_READY',flush=True)
 while not stopping:
  if any(c.poll() is not None for c in children):raise RuntimeError('Owned service exited')
  time.sleep(1)
finally:
 try:
  request=urllib.request.Request(f'http://127.0.0.1:{cfg["web_port"]}/api/pause',data=b'{"paused":true}',headers={'Content-Type':'application/json'});urllib.request.urlopen(request,timeout=3).close()
 except Exception:pass
 def stop_backend(backend):
  try:subprocess.run([env['SKYDUEL_PYTHON'],str(ROOT/'scripts/bedwars-rcon.py'),'stop'],env={**env,'SKYDUEL_SERVER_ROOT':backend['server_root']},cwd=ROOT,timeout=15)
  except (OSError,subprocess.TimeoutExpired):pass
 with ThreadPoolExecutor(max_workers=len(servers)) as pool:list(pool.map(stop_backend,servers))
 # Keep the parent alive while all owned Java processes save their arena worlds.
 deadline=time.monotonic()+40
 while any(j.poll() is None for j in javas) and time.monotonic()<deadline:time.sleep(.5)
 for child in reversed(children):
  if child.poll() is None:child.terminate()
 for child in reversed(children):
  try:child.wait(timeout=8)
  except subprocess.TimeoutExpired:child.kill();child.wait(timeout=3)
 for file in files:file.close()
