"""Download pinned public dependencies; does not start a server or accept its EULA."""
import hashlib,json,urllib.request,zipfile
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
def main():
    for item in json.loads((ROOT/'configs/bedwars-downloads.json').read_text(encoding='utf-8')):
        target=ROOT/item['path']
        valid=lambda: target.exists() and hashlib.new(item['algorithm'],target.read_bytes()).hexdigest()==item['hash']
        if not valid():
            target.parent.mkdir(parents=True,exist_ok=True)
            request=urllib.request.Request(item['url'],headers={'User-Agent':'MCAI-local-bedwars/0.6.0'})
            with urllib.request.urlopen(request,timeout=120) as response:data=response.read()
            if hashlib.new(item['algorithm'],data).hexdigest()!=item['hash']:raise ValueError('Checksum mismatch: '+item['id'])
            target.write_bytes(data)
        print('Verified '+item['id'],flush=True)
        if item['id']=='gradle' and not (ROOT/'downloads/tools/gradle-8.7/bin/gradle.bat').exists():
            with zipfile.ZipFile(target) as archive:archive.extractall(ROOT/'downloads/tools')
if __name__=='__main__':main()
