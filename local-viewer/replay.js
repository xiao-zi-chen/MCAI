const scene=document.querySelector('#scene'),seek=document.querySelector('#seek'),play=document.querySelector('#play'),loading=document.querySelector('#loading');
const avatarLayer=new SpectatorActors(scene);
const camera=new SpectatorCamera(scene,{defaultMode:new URLSearchParams(location.search).get('view')||'auto',onStatus:s=>document.querySelector('#camera-status').textContent=s});camera.bind();
let pages,fetchingFrame=-1;
const frameAt=i=>pages?.get(i);
let rules,record,index=0,playing=false,last=0,clock=0,ready=false,timeline,renderView=null,loadSequence=0,lastDraw=-1,actors=new Set(),ReplayVec;
const fmt=s=>String(Math.floor(s/60)).padStart(2,'0')+':'+String(Math.floor(s%60)).padStart(2,'0');
const itemName=s=>({AIR:'空手',WOODEN_SWORD:'木剑',STONE_SWORD:'石剑',IRON_SWORD:'铁剑',DIAMOND_SWORD:'钻石剑',IRON_BOOTS:'铁护甲',CHAINMAIL_BOOTS:'锁链护甲',DIAMOND_BOOTS:'钻石护甲',LEATHER_BOOTS:'皮甲',GOLDEN_APPLE:'金苹果',BOW:'弓',TNT:'TNT',FIRE_CHARGE:'火球'}[s]||rules?.shop.find(i=>i.material.toUpperCase()===s)?.label||s?.toLowerCase()||'空手');
const upgradeName={forge:'熔炉',protection:'保护',sharpness:'锋利',haste:'急迫',heal_pool:'治疗池',trap:'陷阱'};
const teamName=s=>({Red:'红队',Blue:'蓝队',Green:'绿队',Yellow:'黄队'}[s]||s);
function pendingRespawn(player,tick){
  if(typeof player.respawn_pending==='boolean')return player.respawn_pending;
  const history=record.respawnHistory.get(player.name)||[];let lo=0,hi=history.length;
  while(lo<hi){const mid=(lo+hi)>>1;if(history[mid].tick<=tick)lo=mid+1;else hi=mid;}
  return lo>0&&history[lo-1].pending;
}
function error(message){loading.hidden=false;loading.textContent=message;playing=false;play.disabled=true;seek.disabled=true;document.querySelector('#retry-load').hidden=false;}
async function json(url,signal){const timeout=AbortSignal.timeout(20000);const r=await fetch(url,{signal:signal?AbortSignal.any([signal,timeout]):timeout});if(!r.ok)throw new Error('读取比赛失败（'+r.status+'）');return r.json();}
function jump(seconds){if(!ready)return;const target=Math.max(0,Math.min(record.duration_ticks,seconds*20));let lo=0,hi=record.frame_count-1;while(lo<hi){const mid=Math.ceil((lo+hi)/2);if(record.frame_ticks[mid]<=target)lo=mid;else hi=mid-1;}index=lo;clock=record.frame_ticks[index]/20;seek.value=index;camera.snap=true;lastDraw=-1;bufferFrame(index);}
function drawFrame(){
  const frame=frameAt(index);if(!frame)return;
  for(const b of timeline.at(frame.tick,frame.teams))renderView.viewer.setBlockStateId(new ReplayVec(...b.pos),b.stateId);

  ActorRoster.render(document.querySelector('#players'),frame.players.map(p=>{
    const profile=(record.actors||[]).find(a=>a.name===p.name)||{},team=frame.teams.find(t=>t.name===p.team);
    const waiting=pendingRespawn(p,frame.tick);
    return {...profile,name:p.name,team:p.team||profile.team,health:p.hp,role:p.mode==='SURVIVAL'?profile.preferred_role:waiting?'respawning':'eliminated',label:p.mode==='SURVIVAL'?Math.ceil(p.hp)+' HP · '+itemName(p.held_item):waiting?'等待复活'+(p.respawn_seconds>0?' '+Math.ceil(p.respawn_seconds)+'秒':''):'本局已淘汰'};
  }),name=>camera.focus(name));
  document.querySelector('#time').textContent=fmt(frame.tick/20)+' / '+fmt(record.duration_ticks/20);seek.value=index;
  const events=record.displayEvents.filter(e=>e.tick<=frame.tick).slice(-8),eventBox=document.querySelector('#events'),signature=JSON.stringify(events);
  if(eventBox.dataset.signature!==signature){eventBox.dataset.signature=signature;eventBox.replaceChildren(...events.map(e=>{const p=document.createElement('p');p.textContent=fmt(e.tick/20)+' '+(e.type==='bed_destroyed'?(e.player?`${e.player} 拆除了${teamName(e.team)}的床`:`阶段事件：${teamName(e.team)}床失效`):e.type==='death'?`${e.player} 死亡`:e.type==='explosion'?'爆炸发生':e.type==='upgrade'?`${e.player} 升级${upgradeName[e.upgrade]} ${e.level}`:e.type==='permanent_item'?`${e.player} 购买永久装备`:e.type==='phase'?`阶段更新：${e.phase}`:e.winner?`${teamName(e.winner)}获胜`:'平局');return p}));}
}
function drawActors(){
  const frame=frameAt(index),next=frameAt(index+1);if(!frame)return;
  const alpha=next?Math.max(0,Math.min(1,(clock*20-frame.tick)/(next.tick-frame.tick))):0;
  avatarLayer.renderObjects(frame,next,alpha);const players=PlayerMotion.interpolatePlayers(frame,next,alpha);
  window.syncProjectiles?.(frame.projectiles,clock*20,next?.projectiles,alpha);avatarLayer.render(players,clock*20);camera.setPlayers(players);
}
async function load(id){
  const sequence=++loadSequence;
  pages?.close();pages=null;fetchingFrame=-1;ready=false;playing=false;record=null;play.disabled=true;seek.disabled=true;loading.hidden=false;loading.textContent='正在载入比赛与真实地图…';document.querySelector('#retry-load').hidden=true;
  try{
    let data;const deadline=Date.now()+180000;
    for(;;){
      const response=await fetch('/api/replays/'+encodeURIComponent(id)+'/meta',{signal:AbortSignal.timeout(20000)});data=await response.json();if(sequence!==loadSequence)return;
      if(response.status===202){if(Date.now()>deadline)throw Error('录像准备超时，请点击重新加载');loading.textContent='正在准备完整录像'+(data.total?' '+Math.floor(data.processed*100/data.total)+'%':'，请稍候…');await new Promise(r=>setTimeout(r,750));continue;}
      if(!response.ok)throw Error(data.error||'录像索引无法读取');break;
    }
    if(!data.frame_count)throw new Error('这局没有可播放的画面记录。');
    pages=new PagedReplay(data,(chunk,signal)=>json('/api/replays/'+encodeURIComponent(id)+'/chunks/'+chunk+'?v='+data.web_format,signal));
    record=data;record.displayEvents=record.events.filter(e=>['bed_destroyed','death','result','upgrade','phase','permanent_item','explosion'].includes(e.type));const chosen=document.querySelector('#matches').selectedOptions[0];if(chosen&&chosen.textContent.includes('指定比赛'))chosen.textContent=(record.status==='test'?'动作 / 规则核对':'指定比赛')+' · '+fmt(record.duration_ticks/20);rules=record.rules||rules;index=0;
    const requested=sequence===1?Number(new URLSearchParams(location.search).get('t')):0;
    if(Number.isFinite(requested)&&requested>0){while(index+1<record.frame_count&&record.frame_ticks[index+1]/20<=requested)index++;}
    clock=record.frame_ticks[index]/20;lastDraw=-1;renderView=null;actors=new Set();
    avatarLayer.setMap(rules.map);camera.setMap(rules.map);camera.setPlayers([]);
    await pages.ensure(index);if(sequence!==loadSequence)return;
    record.actors=record.actors?.length?record.actors:frameAt(index).players.map(p=>({name:p.name,team:p.team}));avatarLayer.setProfiles(record.actors);camera.setProfiles(record.actors);
    record.respawnHistory=new Map();const lostBeds=new Set(),actorTeams=new Map(record.actors.map(p=>[p.name,p.team]));
    for(const event of record.events){
      if(event.type==='bed_destroyed')lostBeds.add(event.team);
      if(event.type==='death'||event.type==='respawn'){
        const history=record.respawnHistory.get(event.player)||[];
        history.push({tick:event.tick,pending:event.type==='death'&&event.final!==true&&!lostBeds.has(event.team||actorTeams.get(event.player))});record.respawnHistory.set(event.player,history);
      }
    }
    const upgrades=new Set();const highlights=document.querySelector('#highlights');highlights.replaceChildren(...record.events.filter(e=>e.type==='bed_destroyed'&&e.player||e.type==='result'||e.type==='phase'&&e.phase==='beds_gone'||e.type==='upgrade'&&!upgrades.has(e.team)&&upgrades.add(e.team)).map(e=>{
      const button=document.createElement('button');button.textContent=fmt(e.tick/20)+' · '+(e.type==='bed_destroyed'?teamName(e.team)+'床被拆':e.type==='phase'?'剩余床失效':e.type==='upgrade'?teamName(e.team)+'首次升级':'比赛结果');button.onclick=()=>jump(Math.max(0,e.tick/20-4));return button;
    }));
    const counts=type=>record.events.filter(e=>e.type===type).length;
    document.querySelector('#replay-summary').textContent=Object.keys(rules.map.teams).length+' 队 · '+record.actors.length+' 位 AI · '+fmt(record.duration_ticks/20)+'\n'+record.events.filter(e=>e.type==='bed_destroyed'&&e.player).length+' 次拆床 · '+counts('upgrade')+' 次升级 · '+counts('block_place')+' 次搭建';
    seek.max=record.frame_count-1;seek.value=index;
    document.querySelector('#result').textContent=record.status==='test'?'规则验收 · 非比赛':record.status!=='complete'?'对局中断':record.winner?teamName(record.winner)+'获胜':'平局';
    scene.src='/scene/?replay='+encodeURIComponent(id);
    const params=new URLSearchParams(location.search);params.set('match',id);history.replaceState(null,'','/replays?'+params);
    playing=params.get('autoplay')!=='0';play.textContent=playing?'暂停':'播放';
  }catch(e){if(sequence===loadSequence)error(e.message);}
}
seek.oninput=()=>{if(!ready)return;index=+seek.value;clock=record.frame_ticks[index]/20;camera.snap=true;lastDraw=-1;bufferFrame(index);};
play.onclick=()=>{if(!ready)return;if(index>=record.frame_count-1){index=0;clock=record.frame_ticks[0]/20;lastDraw=-1;camera.snap=true;}playing=!playing;play.textContent=playing?'暂停':'播放';};
document.querySelector('#back-five').onclick=()=>jump(clock-5);document.querySelector('#forward-five').onclick=()=>jump(clock+5);
document.querySelector('#team-camera').onchange=e=>{if(e.target.value)camera.setMode(e.target.value);};
document.querySelector('#retry-load').onclick=()=>{const id=document.querySelector('#matches').value;if(id)load(id);else refreshList().catch(e=>error(e.message));};
document.querySelector('#fullscreen').onclick=()=>{const action=document.fullscreenElement?document.exitFullscreen():document.querySelector('.playback').requestFullscreen();action.catch(()=>{});};
document.addEventListener('keydown',e=>{if(['INPUT','SELECT','TEXTAREA','BUTTON'].includes(e.target.tagName))return;if(e.code==='Space'){e.preventDefault();play.click();}else if(e.code==='ArrowLeft'){e.preventDefault();jump(clock-5);}else if(e.code==='ArrowRight'){e.preventDefault();jump(clock+5);}});
function bufferFrame(wanted){
 if(!pages||frameAt(wanted)&&frameAt(Math.min(record.frame_count-1,wanted+1)))return;
 if(fetchingFrame===wanted)return;fetchingFrame=wanted;const sequence=loadSequence;
 loading.hidden=false;loading.textContent='正在读取这一段录像…';
 pages.ensure(wanted).then(()=>{if(sequence===loadSequence){lastDraw=-1;if(ready)loading.hidden=true;}}).catch(e=>{if(sequence===loadSequence&&e.name!=='AbortError')error(e.message);}).finally(()=>{if(fetchingFrame===wanted)fetchingFrame=-1;});
}
function animate(now){
  const v=scene.contentWindow?.localView;
  if(record&&!ready&&v){
    if(v.error)error(v.error);
    else{const total=v.replay?.chunks||0,loaded=Object.keys(v.viewer.world.loadedChunks).length,pending=v.viewer.world.sectionsOutstanding.size;loading.textContent=total?'正在载入地图 '+loaded+' / '+total+(pending?' · 整理场景 '+pending+' 块':''):'正在连接录像场景…';}
    if(v.replay?.match_id===record.match_id&&Object.keys(v.viewer.world.loadedChunks).length>=v.replay.chunks&&v.viewer.world.sectionsOutstanding.size===0){
      ready=true;renderView=v;timeline=new ReplayTimeline(record,v.replay);const T=scene.contentWindow.THREE;
      ReplayVec=class extends T.Vector3{offset(x,y,z){return new ReplayVec(this.x+x,this.y+y,this.z+z)}};
      loading.hidden=true;play.disabled=false;seek.disabled=false;
    }
  }
  if(ready&&record){
    if(playing){const proposed=clock+Math.min((now-last)/1000,.15)*Number(document.querySelector('#speed').value);let next=index;while(next+1<record.frame_count&&record.frame_ticks[next+1]/20<=proposed)next++;
      if(frameAt(next)){clock=proposed;index=next;bufferFrame(Math.min(record.frame_count-1,index+1));}else bufferFrame(next);
      if(index===record.frame_count-1){playing=false;play.textContent='播放';}}
    if(!frameAt(index)){bufferFrame(index);last=now;requestAnimationFrame(animate);return;}
    if(lastDraw!==index){drawFrame();lastDraw=index;}
    drawActors();camera.tick(now);
  }
  last=now;requestAnimationFrame(animate);
}
requestAnimationFrame(animate);
async function refreshList(){
  const [r,list]=await Promise.all([json('/api/rules'),json('/api/replays')]);rules=r;const select=document.querySelector('#matches');
  const wanted=record?.match_id||new URLSearchParams(location.search).get('match');select.replaceChildren();
  if(wanted&&!list.some(m=>m.id===wanted))list.unshift({id:wanted,date:0,winner:'指定比赛',seconds:0});
  if(!list.length){select.add(new Option('尚无完整比赛记录',''));error('第一局结束后会生成回放');return;}
  for(const m of list)select.add(new Option((m.date?new Date(m.date).toLocaleString('zh-CN')+' · ':'')+teamName(m.winner||'平局')+' · '+fmt(m.seconds),m.id));
  select.onchange=()=>load(select.value);if(wanted)select.value=wanted;if(!record)await load(select.value);
}
document.querySelector('#refresh-recordings').onclick=()=>refreshList().catch(e=>error(e.message));
refreshList().catch(e=>error(e.message));
setInterval(()=>refreshList().catch(()=>{}),30000);
