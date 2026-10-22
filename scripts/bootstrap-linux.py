"""Install only project-local dependencies. Run inside a limited systemd service."""
import argparse,hashlib,json,os,subprocess,tarfile,urllib.request
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
p=argparse.ArgumentParser();p.add_argument('--accept-eula',action='store_true');p.add_argument('--config',default='configs/scheduler.server-test.json');a=p.parse_args()
if not a.accept_eula:raise SystemExit('Pass --accept-eula only after the operator accepted the Minecraft EULA')
DEPS=ROOT/'deps';DEPS.mkdir(exist_ok=True)
os.environ['npm_config_cache']=str(DEPS/'npm-cache');os.environ['PIP_CACHE_DIR']=str(DEPS/'pip-cache')
def fetch(url,file,checksum=None):
 if not file.exists():
  partial=file.with_suffix(file.suffix+'.part')
  subprocess.run(['curl','--fail','--location','--retry','2','--connect-timeout','15','--max-time','300','--output',str(partial),url],check=True)
  partial.replace(file)
 digest=hashlib.sha256(file.read_bytes()).hexdigest()
 if checksum and digest!=checksum:raise ValueError('Downloaded checksum mismatch: '+file.name)
 return digest
def run(args,**kw):subprocess.run([str(x) for x in args],check=True,cwd=ROOT,**kw)
manifest={}
if not (DEPS/'java/bin/java').exists():
 meta=json.loads(subprocess.check_output(['curl','--fail','--silent','--show-error','--max-time','45','https://api.adoptium.net/v3/assets/latest/21/hotspot?architecture=x64&image_type=jre&os=linux&vendor=eclipse']))[0]
 pkg=meta['binary']['package'];file=DEPS/'java.tar.gz';manifest['java']={'version':meta['version']['semver'],'sha256':fetch(pkg['link'],file,pkg['checksum']),'source':pkg['link']}
 with tarfile.open(file) as t:
  prefix=t.getmembers()[0].name.split('/')[0];t.extractall(DEPS,filter='data')
 (DEPS/prefix).rename(DEPS/'java')
version='8.10.2';redisdir=DEPS/('redis-'+version)
if not (redisdir/'src/redis-server').exists():
 file=DEPS/'redis.tar.gz';url=f'https://download.redis.io/releases/redis-{version}.tar.gz';manifest['redis']={'version':version,'sha256':fetch(url,file),'source':url}
 with tarfile.open(file) as t:t.extractall(DEPS,filter='data')
 run(['make','-C',redisdir,'-j1','MALLOC=libc','BUILD_TLS=no','REDIS_CFLAGS=','REDIS_LDFLAGS=','redis-server'])
venv=DEPS/'python';python=venv/'bin/python'
if not python.exists():
 result=subprocess.run(['python3','-m','venv',venv],cwd=ROOT)
 if result.returncode:
  run(['python3','-m','venv','--without-pip',venv]);pip=DEPS/'get-pip.py';fetch('https://bootstrap.pypa.io/get-pip.py',pip);run([python,pip])
run([python,'-m','pip','install','PyYAML==6.0.2','jsonschema==4.23.0'])
for component in ['bot-controller','local-scheduler','local-viewer']:run(['npm','ci','--omit=dev','--no-audit','--no-fund','--prefix',ROOT/component])
run([python,ROOT/'scripts/prepare-bedwars.py','--apply-rules','--scheduler-config',ROOT/a.config])
config=json.loads((ROOT/a.config).read_text());server=ROOT/config['server_root'];(server/'eula.txt').write_text('eula=true\n')
(ROOT/'runs/deployment-dependencies.json').write_text(json.dumps(manifest,indent=2))
print('PRIVATE_PREPARATION_COMPLETE',flush=True)
