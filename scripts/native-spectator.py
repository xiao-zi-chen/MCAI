"""Run the unmodified Java 1.21 client as a private localhost development spectator.

This never supplies observations to the AI and never reads launcher/account files.
The local server has offline-mode enabled; no public-server authentication is bypassed.
"""
from __future__ import annotations
import argparse,ctypes,json,os,socket,subprocess,sys,time,uuid,zipfile
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
RUN=ROOT/'runs/native-spectator'
NAME='VanillaView'

def rcon(*args):
    result=subprocess.run([sys.executable,str(ROOT/'scripts/bedwars-rcon.py'),*args],cwd=ROOT,capture_output=True,text=True,encoding='utf-8',errors='replace',timeout=12,creationflags=subprocess.CREATE_NO_WINDOW)
    return result.returncode==0,result.stdout

def client_alive(pid):
    if not pid:return True
    from ctypes import wintypes
    kernel=ctypes.windll.kernel32;kernel.OpenProcess.restype=wintypes.HANDLE;kernel.OpenProcess.argtypes=[wintypes.DWORD,wintypes.BOOL,wintypes.DWORD]
    kernel.GetExitCodeProcess.argtypes=[wintypes.HANDLE,ctypes.POINTER(wintypes.DWORD)];kernel.CloseHandle.argtypes=[wintypes.HANDLE]
    handle=kernel.OpenProcess(0x1000,False,pid)
    if not handle:return False
    code=wintypes.DWORD();kernel.GetExitCodeProcess(handle,ctypes.byref(code));kernel.CloseHandle(handle);return code.value==259

def watch(target,free=False,client_pid=0):
    # The observer is a separate Minecraft player; AI players remain headless.
    configured=False;last=None
    for attempt in range(100):
        if not client_alive(client_pid):return
        ok,players=rcon('list')
        if ok and NAME in players:
            rcon('gamemode','spectator',NAME);rcon('tp',NAME,'0.5','65','15.5','180','0');configured=True;break
        time.sleep(1)
    if not configured:raise RuntimeError('Native client did not join; inspect runs/native-spectator/client.log')
    print('Native Minecraft spectator connected',flush=True)
    if free:return
    while True:
        try:
            with socket.create_connection(('127.0.0.1',25600),timeout=10) as sock:
                sock.settimeout(None)
                for line in sock.makefile('r',encoding='utf-8'):
                    if not client_alive(client_pid):return
                    state=json.loads(line);p=next((p for p in state.get('players',[]) if p['name']==target and p['mode']=='SURVIVAL'),None)
                    key=(state.get('match_id'),p.get('entity_id')) if p and state.get('phase')=='running' else None
                    if key and key!=last:rcon('spectate',target,NAME);print('Following',target,flush=True)
                    if not key and last:
                        rcon('execute','as',NAME,'run','spectate');rcon('tp',NAME,'0.5','67','12.5','180','0')
                    last=key
        except (OSError,ValueError):time.sleep(2)

def launch(java,target,free=False):
    manifest=ROOT/'downloads/official-client-1.21/launch.json'
    if not manifest.exists():raise RuntimeError('Run scripts/prepare-native-client.py first')
    data=json.loads(manifest.read_text(encoding='utf-8'));RUN.mkdir(parents=True,exist_ok=True)
    native=RUN/'natives';native.mkdir(exist_ok=True)
    for library in data['classpath']:
        if 'natives-windows' not in library:continue
        with zipfile.ZipFile(library) as jar:
            for name in jar.namelist():
                if name.lower().endswith('.dll'):(native/Path(name).name).write_bytes(jar.read(name))
    options=RUN/'options.txt'
    if not options.exists():options.write_text('version:3953\nrenderDistance:7\nsimulationDistance:4\nmaxFps:60\nfullscreen:false\nenableVsync:true\nguiScale:2\nlang:zh_cn\nonboardAccessibility:false\nshowSubtitles:false\ntelemetryOptInExtra:false\n',encoding='utf-8')
    # A spectator should keep showing the match when another window has focus.
    option_lines=[line for line in options.read_text(encoding='utf-8').splitlines() if not line.startswith('pauseOnLostFocus:')]
    options.write_text('\n'.join([*option_lines,'pauseOnLostFocus:false'])+'\n',encoding='utf-8')
    player_uuid=uuid.UUID(bytes=__import__('hashlib').md5(('OfflinePlayer:'+NAME).encode()).digest(),version=3)
    args=[java,'-Xms256M','-Xmx1536M',f'-Djava.library.path={native}',f'-Dorg.lwjgl.librarypath={native}','-Dminecraft.launcher.brand=SkyDuel-local-dev','-Dminecraft.launcher.version=1','-cp',os.pathsep.join(data['classpath']),data['main_class'],
          '--username',NAME,'--uuid',str(player_uuid),'--accessToken','local-development','--userType','legacy','--version','1.21','--versionType','release','--gameDir',str(RUN),'--assetsDir',data['assets'],'--assetIndex',data['asset_index'],'--width','1280','--height','800','--quickPlayPath',str(RUN/'quickplay.json'),'--quickPlayMultiplayer','127.0.0.1:25567']
    with (RUN/'client.log').open('w',encoding='utf-8') as log:
        client=subprocess.Popen(args,cwd=RUN,stdout=log,stderr=subprocess.STDOUT,creationflags=subprocess.CREATE_NO_WINDOW)
    with (RUN/'observer.log').open('w',encoding='utf-8') as log:
        helper=subprocess.Popen([sys.executable,str(Path(__file__).resolve()),'--watch','--target',target,'--client-pid',str(client.pid),*(['--free'] if free else [])],cwd=ROOT,stdout=log,stderr=subprocess.STDOUT,creationflags=subprocess.CREATE_NO_WINDOW)
    (RUN/'processes.json').write_text(json.dumps({'client_pid':client.pid,'helper_pid':helper.pid,'username':NAME,'server':'127.0.0.1:25567','client_version':'1.21','target':target,'free_camera':free,'client_sha1':data['client_sha1']},indent=2),encoding='utf-8')
    print('Native Minecraft spectator launched:',client.pid)

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--java',default=r'E:\Java\jdk-21\bin\javaw.exe');parser.add_argument('--target',choices=['EmberAI','BastionAI'],default='EmberAI');parser.add_argument('--watch',action='store_true');parser.add_argument('--free',action='store_true');parser.add_argument('--client-pid',type=int,default=0);args=parser.parse_args()
    if args.watch:watch(args.target,args.free,args.client_pid)
    else:launch(args.java,args.target,args.free)
