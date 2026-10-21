"""Build local viewer models from the verified, official Minecraft 1.21 resources.

The generated catalog and Mojang textures stay in downloads/runs, not source control.
"""
from __future__ import annotations
import hashlib,json,zipfile,urllib.request
from pathlib import Path
from PIL import Image

ROOT=Path(__file__).resolve().parents[1]
ASSETS=ROOT/'downloads/minecraft-assets-1.21/assets/minecraft'
OUT=ROOT/'runs/native-assets-1.21/items.json'
CLIENT_SHA1='0e9a07b9bb3390602f977073aa12884a4ce12431'
CLIENT_URL='https://piston-data.mojang.com/v1/objects/'+CLIENT_SHA1+'/client.jar'

def prepare():
    jar=ROOT/'downloads/minecraft-client-1.21.jar'
    if not jar.exists() or hashlib.sha1(jar.read_bytes()).hexdigest()!=CLIENT_SHA1:
        with urllib.request.urlopen(CLIENT_URL,timeout=45) as r:data=r.read()
        if hashlib.sha1(data).hexdigest()!=CLIENT_SHA1:raise ValueError('Official resource checksum mismatch')
        jar.parent.mkdir(parents=True,exist_ok=True);jar.write_bytes(data)
    if not (ASSETS/'models/item/handheld.json').exists():
        dest=ASSETS.parents[1]
        with zipfile.ZipFile(jar) as z:
            for name in z.namelist():
                if name.startswith('assets/minecraft/') and not name.endswith('/'):
                    target=dest/name;target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes(z.read(name))
    cache={}
    def model(name):
        name=name.removeprefix('minecraft:')
        if name in cache:return cache[name]
        if name=='builtin/generated':return {'generated':True,'textures':{},'display':{}}
        data=json.loads((ASSETS/'models'/f'{name}.json').read_text())
        parent=model(data['parent']) if data.get('parent') else {}
        result={**parent,**data,'textures':{**parent.get('textures',{}),**data.get('textures',{})},'display':{**parent.get('display',{}),**data.get('display',{})}}
        cache[name]=result;return result
    def texture(name,textures):
        seen=set()
        while name.startswith('#'):
            if name in seen:raise ValueError('Cyclic texture reference')
            seen.add(name);name=textures[name[1:]]
        return name.removeprefix('minecraft:')
    def sprite(tex):
        im=Image.open(ASSETS/'textures'/f'{tex}.png').convert('RGBA');w,h=im.size;frame_h=min(w,h)
        alpha=im.getchannel('A');edges=[]
        solid=lambda x,y:0<=x<w and 0<=y<frame_h and alpha.getpixel((x,y))>0
        # Front/back are full textured quads. Side faces follow the alpha silhouette.
        for y in range(frame_h):
            for x in range(w):
                if not solid(x,y):continue
                for dx,dy in [(-1,0),(1,0),(0,-1),(0,1)]:
                    if not solid(x+dx,y+dy):edges.append([x,y,dx,dy])
        spec={'width':w,'height':h,'frame_height':frame_h,'edges':edges}
        meta=ASSETS/'textures'/f'{tex}.png.mcmeta'
        if meta.exists():spec['animation']=json.loads(meta.read_text()).get('animation')
        return spec
    rules=json.loads((ROOT/'competition/rules.json').read_text(encoding='utf-8'))
    ids={i['material'].lower() for i in rules['shop']}|{'wooden_sword','red_wool','blue_wool','arrow','bow_pulling_0','bow_pulling_1','bow_pulling_2','glass_bottle','bucket','wet_sponge','iron_ingot','gold_ingot','diamond','emerald'}
    catalog={};textures={}
    for item in sorted(ids):
        data=model('item/'+item);layers=[]
        if data.get('generated'):
            for key,ref in sorted(data.get('textures',{}).items()):
                if not key.startswith('layer'):continue
                tex=texture(ref,data['textures']);textures.setdefault(tex,sprite(tex));layers.append({'texture':tex,'tint':item=='potion' and key=='layer0'})
        elements=[]
        if not data.get('generated'):
            for element in data.get('elements',[]):
                e={**element,'faces':{face:{**f,'texture':texture(f['texture'],data['textures'])} for face,f in element['faces'].items()}}
                elements.append(e)
        catalog[item]={'display':data.get('display',{}),'layers':layers,'elements':elements,'overrides':data.get('overrides',[])}
    result={'version':'1.21','client_sha1':CLIENT_SHA1,'source':CLIENT_URL,'items':catalog,'textures':textures}
    OUT.parent.mkdir(parents=True,exist_ok=True);OUT.write_text(json.dumps(result,separators=(',',':')),encoding='utf-8')
    print(f'Official item catalog: {len(catalog)} models, {len(textures)} sprite silhouettes; {OUT.stat().st_size} bytes')
    return result

if __name__=='__main__':prepare()
