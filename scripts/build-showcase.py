"""Create an offline HTML + MP4 showcase ZIP from an actual completed local replay."""
from __future__ import annotations
import argparse,json,re,shutil,subprocess,zipfile
from pathlib import Path
from PIL import Image

ROOT=Path(__file__).resolve().parents[1]
def command(args):subprocess.run([str(a) for a in args],check=True)
def main():
    p=argparse.ArgumentParser();p.add_argument('--recording',type=Path,required=True);p.add_argument('--map-image',type=Path,required=True);p.add_argument('--native-image',type=Path,required=True);p.add_argument('--output',type=Path,default=ROOT/'dist/MCAI-showcase-0.6.0');a=p.parse_args()
    recording=json.loads((a.recording/'recording.json').read_text(encoding='utf-8'));id=recording['match_id']
    if not re.fullmatch(r'[a-f0-9-]{36}',id):raise ValueError('Invalid match ID')
    record=json.loads((ROOT/f'runs/bedwars-local/plugins/SkyDuelReferee/replays/{id}.json').read_text(encoding='utf-8'))
    if record['status']!='complete':raise ValueError('Only completed normal matches can be published as matches')
    ffmpeg=shutil.which('ffmpeg');probe=shutil.which('ffprobe')
    if not ffmpeg or not probe:raise RuntimeError('Install FFmpeg with ffprobe first')
    out=a.output.resolve();assets=out/'assets';assets.mkdir(parents=True,exist_ok=True)
    raw=a.recording/recording['raw'];seconds=record['frames'][-1]['tick']/20
    duration=float(subprocess.check_output([probe,'-v','error','-show_entries','format=duration','-of','default=noprint_wrappers=1:nokey=1',str(raw)],text=True))
    start=max(0,duration-recording['play_seconds']-recording['tail_seconds'])
    speed_ratio=seconds/recording['play_seconds']
    if not .90<speed_ratio<1.03:raise ValueError('Recording fell too far behind match time; record again at a lower viewport size')
    command([ffmpeg,'-y','-v','warning','-ss',start,'-i',raw,'-t',recording['play_seconds'],'-vf',f'setpts={speed_ratio}*(PTS-STARTPTS),fps=25','-an','-c:v','libx264','-threads','2','-preset','medium','-crf','22','-pix_fmt','yuv420p','-movflags','+faststart',assets/'full-match.mp4'])
    chosen=[]
    for kind,label in [('damage','首次交战'),('item_consume','道具与补给'),('bed_destroyed','拆床时刻'),('result','最终胜负')]:
        event=next((e for e in record['events'] if e['type']==kind and (kind!='damage' or e.get('attacker'))),None)
        if event:chosen.append({'seconds':max(0,event['tick']/20-4),'label':label})
    segments=[]
    for c in chosen:
        begin=max(0,min(seconds-12,c['seconds']-2));end=min(seconds,begin+16)
        if segments and begin<segments[-1][1]:segments[-1][1]=max(segments[-1][1],end)
        else:segments.append([begin,end])
    filters=';'.join(f'[0:v]trim=start={begin}:end={end},setpts=PTS-STARTPTS[v{i}]' for i,(begin,end) in enumerate(segments))
    filters+=';'+''.join(f'[v{i}]' for i in range(len(segments)))+f'concat=n={len(segments)}:v=1:a=0[out]'
    command([ffmpeg,'-y','-v','warning','-i',assets/'full-match.mp4','-filter_complex',filters,'-map','[out]','-an','-c:v','libx264','-threads','2','-crf','22','-pix_fmt','yuv420p','-movflags','+faststart',assets/'highlights.mp4'])
    command([ffmpeg,'-y','-v','warning','-ss',chosen[0]['seconds'] if chosen else 0,'-i',assets/'full-match.mp4','-frames:v','1','-update','1','-q:v','3',assets/'poster.jpg'])
    for source,name in [(a.map_image,'map.jpg'),(a.native_image,'native.jpg')]:Image.open(source).convert('RGB').save(assets/name,quality=91)
    shutil.copy2(ROOT/'showcase/index.html',out/'index.html')
    rules=(ROOT/'competition/RULES.zh-CN.md').read_text(encoding='utf-8')
    page=(ROOT/'local-viewer/rules.html').read_text(encoding='utf-8')
    page=page.replace("fetch('/rules-source').then(r=>{if(!r.ok)throw Error('规则读取失败');return r.text()})",'Promise.resolve('+json.dumps(rules,ensure_ascii=False).replace('</','<\\/')+')')
    page=page.replace('href="/"','href="index.html"').replace('实时观战','返回展示').replace('href="/replays"','href="index.html#watch"')
    (out/'rules.html').write_text(page,encoding='utf-8')
    model_manifest=json.loads((ROOT/f'runs/showcase-selected/manifests/{id}.json').read_text(encoding='utf-8'))
    manifest={'version':'0.6.0','match_id':id,'rules_version':record['rules_version'],'map':record['rules']['map']['id'],'seconds':seconds,'winner':{'Red':'红队获胜','Blue':'蓝队获胜'}.get(record.get('winner'),'平局'),'checks':29,'chapters':[{'seconds':0,'label':'完整开局'},*chosen],'controller_sha256':model_manifest['controller_sha256'],'video_source':'actual server replay rendered in the local web viewer','audio':False,'highlights_intervals':segments}
    (out/'manifest.js').write_text('window.SHOWCASE = '+json.dumps(manifest,ensure_ascii=False,indent=2)+';\n',encoding='utf-8')
    (out/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    (out/'README.txt').write_text('MCAI · 悬空夺床 0.6 展示包\n\n1. 将整个 ZIP 解压。\n2. 双击 index.html，以 Edge、Chrome 或 Firefox 打开。\n3. 网页、完整视频、精彩片段和规则均可离线观看。assets 里的 MP4 也可单独发送。\n4. 可把整个目录上传到任意静态网站空间。不要只发送 index.html，必须保留 assets 和 manifest.js。\n\n完整视频来自实际 Minecraft 比赛记录的网页 3D 重建，无游戏音轨。它不是原版客户端录像，也不是能够自由旋转的离线 3D 回放。原版截图另附。\n源项目：https://github.com/xiao-zi-chen/MCAI （仓库访问权限由所有者管理）\n比赛与控制器摘要见 manifest.json。\n',encoding='utf-8-sig')
    archive=out.parent/(out.name+'.zip')
    with zipfile.ZipFile(archive,'w',zipfile.ZIP_DEFLATED,compresslevel=5) as z:
        for file in sorted(out.rglob('*')):
            if file.is_file():z.write(file,Path(out.name)/file.relative_to(out))
    print(json.dumps({'directory':str(out),'zip':str(archive),'bytes':archive.stat().st_size,'match_id':id},ensure_ascii=False))
if __name__=='__main__':main()
