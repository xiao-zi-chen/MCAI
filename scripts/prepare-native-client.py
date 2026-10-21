"""Cache verified Mojang 1.21 client resources for a separate local spectator.

No account files are read. This is separate from the headless AI/runtime stack.
"""
from __future__ import annotations
import concurrent.futures
import hashlib
import json
import platform
import urllib.request
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
CACHE=Path((ROOT/'downloads/native-cache.path').read_text(encoding='utf-8').strip()) if (ROOT/'downloads/native-cache.path').exists() else ROOT/'downloads/official-client-1.21'
MANIFEST='https://piston-meta.mojang.com/mc/game/version_manifest_v2.json'

def fetch(url,path,sha1=None):
    if path.exists() and (not sha1 or hashlib.sha1(path.read_bytes()).hexdigest()==sha1):return
    path.parent.mkdir(parents=True,exist_ok=True)
    req=urllib.request.Request(url,headers={'User-Agent':'SkyDuel-local-spectator/1.0'})
    with urllib.request.urlopen(req,timeout=40) as response:data=response.read()
    if sha1 and hashlib.sha1(data).hexdigest()!=sha1:raise ValueError(f'Hash mismatch: {path.name}')
    path.write_bytes(data)

def allowed(library):
    rules=library.get('rules');result=not rules
    for rule in rules or []:
        os_rule=rule.get('os',{})
        if os_rule.get('name','windows')!='windows':continue
        if os_rule.get('arch') and os_rule['arch'] not in ('x86_64','amd64'):continue
        if rule.get('features'):continue
        result=rule['action']=='allow'
    # This launcher targets the current Windows x64 workspace, not other CPUs.
    return result and not any(t in library['name'] for t in ('natives-windows-arm64','natives-windows-x86'))

def prepare():
    CACHE.mkdir(parents=True,exist_ok=True)
    manifest_path=CACHE/'version-manifest.json';fetch(MANIFEST,manifest_path)
    version=next(v for v in json.loads(manifest_path.read_text())['versions'] if v['id']=='1.21')
    meta_path=CACHE/'1.21.json';fetch(version['url'],meta_path,version['sha1']);meta=json.loads(meta_path.read_text())
    client=ROOT/'downloads/minecraft-client-1.21.jar';fetch(meta['downloads']['client']['url'],client,meta['downloads']['client']['sha1'])
    asset_index=CACHE/'assets/indexes'/f"{meta['assetIndex']['id']}.json"
    fetch(meta['assetIndex']['url'],asset_index,meta['assetIndex']['sha1'])
    jobs=[];classpath=[]
    for library in meta['libraries']:
        if not allowed(library):continue
        artifact=library.get('downloads',{}).get('artifact')
        if not artifact:continue
        target=CACHE/'libraries'/artifact['path'];classpath.append(str(target));jobs.append((artifact['url'],target,artifact['sha1']))
    objects=json.loads(asset_index.read_text())['objects']
    for spec in objects.values():
        digest=spec['hash'];jobs.append((f'https://resources.download.minecraft.net/{digest[:2]}/{digest}',CACHE/'assets/objects'/digest[:2]/digest,digest))
    jobs=list({str(j[1]):j for j in jobs}.values());failures=[]
    def download(job):
        for attempt in range(3):
            try:fetch(*job);return None
            except Exception as error:
                if attempt==2:return f'{job[1].name}: {error}'
    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
        for i,result in enumerate(pool.map(download,jobs),1):
            if result:failures.append(result)
            if i%150==0:print(f'Official client resources: {i}/{len(jobs)}',flush=True)
    if failures:raise RuntimeError('\n'.join(failures[:10]))
    classpath.append(str(client))
    result={'version':'1.21','main_class':meta['mainClass'],'classpath':classpath,'assets':str(CACHE/'assets'),'asset_index':meta['assetIndex']['id'],'client_sha1':meta['downloads']['client']['sha1'],'source':MANIFEST,'files':len(jobs)}
    launch=ROOT/'downloads/official-client-1.21/launch.json'
    launch.parent.mkdir(parents=True,exist_ok=True)
    launch.write_text(json.dumps(result,indent=2),encoding='utf-8')
    print(f'Official 1.21 client verified: {len(jobs)} resource files',flush=True)
    return result

if __name__=='__main__':prepare()
