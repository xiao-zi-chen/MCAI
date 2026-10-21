const scene=document.querySelector('#scene'),seek=document.querySelector('#seek'),play=document.querySelector('#play'),loading=document.querySelector('#loading');
const avatarLayer=new SpectatorActors(scene);
const camera=new SpectatorCamera(scene,{defaultMode:new URLSearchParams(location.search).get('view')||'follow-red',onStatus:s=>document.querySelector('#camera-status').textContent=s});camera.bind();
let rules,record,index=0,playing=false,last=0,clock=0,ready=false,timeline,renderView=null,loadSequence=0,lastDraw=-1,actors=new Set(),ReplayVec;
const fmt=s=>String(Math.floor(s/60)).padStart(2,'0')+':'+String(Math.floor(s%60)).padStart(2,'0');
const itemName=s=>({AIR:'空手',WOODEN_SWORD:'木剑',STONE_SWORD:'石剑',IRON_SWORD:'铁剑',DIAMOND_SWORD:'钻石剑',IRON_BOOTS:'铁护甲',CHAINMAIL_BOOTS:'锁链护甲',DIAMOND_BOOTS:'钻石护甲',LEATHER_BOOTS:'皮甲',GOLDEN_APPLE:'金苹果',BOW:'弓',TNT:'TNT',FIRE_CHARGE:'火球'}[s]||rules?.shop.find(i=>i.material.toUpperCase()===s)?.label||s?.toLowerCase()||'空手');
const upgradeName={forge:'熔炉',protection:'保护',sharpness:'锋利',haste:'急迫',heal_pool:'治疗池',trap:'陷阱'};
const teamName=s=>({Red:'红队',Blue:'蓝队'}[s]||s);
function error(message){loading.hidden=false;loading.textContent=message;playing=false;play.disabled=true;seek.disabled=true;}
async function json(url){const r=await fetch(url);if(!r.ok)throw new Error('读取比赛失败（'+r.status+'）');return r.json();}
function drawFrame(){
  const frame=record.frames[index];
  for(const b of timeline.at(frame.tick,frame.teams))renderView.viewer.setBlockStateId(new ReplayVec(...b.pos),b.stateId);

  document.querySelector('#players').textContent=frame.players.map(p=>{
    const armor=p.armor?.find(i=>i.endsWith('_BOOTS'));
    const upgrades=Object.entries(frame.classic?.upgrades?.[p.team]||{}).filter(([,l])=>l>0).map(([k,l])=>upgradeName[k]+' '+l).join(' · ');
    const team=frame.teams.find(t=>t.name===p.team);
    return p.name+' · '+teamName(p.team)+' · '+(p.mode==='SURVIVAL'?Math.ceil(p.hp)+' HP'+(p.absorption?' + '+Math.ceil(p.absorption)+' 吸收':''):team?.bed?'等待复活':'已淘汰')+'\n'+itemName(armor)+' / '+itemName(p.held_item)+'\n'+(team?.bed?'床仍在':'床已被拆')+(upgrades?'\n'+upgrades:'');
  }).join('\n\n');
  document.querySelector('#time').textContent=fmt(frame.tick/20)+' / '+fmt(record.frames.at(-1).tick/20);seek.value=index;
  const events=record.events.filter(e=>e.tick<=frame.tick&&['bed_destroyed','death','result','upgrade','phase','permanent_item','explosion'].includes(e.type)).slice(-8);
  document.querySelector('#events').replaceChildren(...events.map(e=>{const p=document.createElement('p');p.textContent=fmt(e.tick/20)+' '+(e.type==='bed_destroyed'?`${e.player} 拆除了${teamName(e.team)}的床`:e.type==='death'?`${e.player} 死亡`:e.type==='explosion'?'爆炸发生':e.type==='upgrade'?`${e.player} 升级${upgradeName[e.upgrade]} ${e.level}`:e.type==='permanent_item'?`${e.player} 购买永久装备`:e.type==='phase'?`阶段更新：${e.phase}`:e.winner?`${teamName(e.winner)}获胜`:'平局');return p}));
}
function drawActors(){
  const frame=record.frames[index],next=record.frames[index+1];
  const alpha=next?Math.max(0,Math.min(1,(clock*20-frame.tick)/(next.tick-frame.tick))):0;
  const players=PlayerMotion.interpolatePlayers(frame,next,alpha);
  window.syncProjectiles?.(frame.projectiles,clock*20,next?.projectiles,alpha);avatarLayer.render(players,clock*20);camera.setPlayers(players);
}
async function load(id){
  const sequence=++loadSequence;
  ready=false;playing=false;record=null;play.disabled=true;seek.disabled=true;loading.hidden=false;loading.textContent='正在载入比赛与真实地图…';
  try{
    const data=await json('/api/replays/'+encodeURIComponent(id));if(sequence!==loadSequence)return;
    if(!data.frames?.length)throw new Error('这局没有可播放的画面记录。');
    record=data;const chosen=document.querySelector('#matches').selectedOptions[0];if(chosen&&chosen.textContent.includes('指定比赛'))chosen.textContent=(record.status==='test'?'动作 / 规则核对':'指定比赛')+' · '+fmt(record.frames.at(-1).tick/20);PlayerMotion.addDistances(record.frames);rules=record.rules||rules;index=0;
    const requested=sequence===1?Number(new URLSearchParams(location.search).get('t')):0;
    if(Number.isFinite(requested)&&requested>0){while(index+1<record.frames.length&&record.frames[index+1].tick/20<=requested)index++;}
    clock=record.frames[index].tick/20;lastDraw=-1;renderView=null;actors=new Set();
    avatarLayer.setMap(rules.map);camera.setMap(rules.map);camera.setPlayers([]);
    seek.max=record.frames.length-1;seek.value=index;
    document.querySelector('#result').textContent=record.status==='test'?'规则验收 · 非比赛':record.status!=='complete'?'对局中断':record.winner?teamName(record.winner)+'获胜':'平局';
    scene.src='/scene/?replay='+encodeURIComponent(id);
    const params=new URLSearchParams(location.search);params.set('match',id);history.replaceState(null,'','/replays?'+params);
    playing=params.has('autoplay');play.textContent=playing?'暂停':'播放';
  }catch(e){if(sequence===loadSequence)error(e.message);}
}
seek.oninput=()=>{if(!ready)return;index=+seek.value;clock=record.frames[index].tick/20;camera.snap=true;lastDraw=-1;};
play.onclick=()=>{if(!ready)return;if(index>=record.frames.length-1){index=0;clock=record.frames[0].tick/20;lastDraw=-1;camera.snap=true;}playing=!playing;play.textContent=playing?'暂停':'播放';};
function animate(now){
  const v=scene.contentWindow?.localView;
  if(record&&!ready&&v){
    if(v.error)error(v.error);
    if(v.replay?.match_id===record.match_id&&Object.keys(v.viewer.world.loadedChunks).length>=v.replay.chunks&&v.viewer.world.sectionsOutstanding.size===0){
      ready=true;renderView=v;timeline=new ReplayTimeline(record,v.replay);const T=scene.contentWindow.THREE;
      ReplayVec=class extends T.Vector3{offset(x,y,z){return new ReplayVec(this.x+x,this.y+y,this.z+z)}};
      loading.hidden=true;play.disabled=false;seek.disabled=false;
    }
  }
  if(ready&&record){
    if(playing){clock+=Math.min((now-last)/1000,.15)*Number(document.querySelector('#speed').value);while(index+1<record.frames.length&&record.frames[index+1].tick/20<=clock)index++;if(index===record.frames.length-1){playing=false;play.textContent='播放';}}
    if(lastDraw!==index){drawFrame();lastDraw=index;}
    drawActors();camera.tick(now);
  }
  last=now;requestAnimationFrame(animate);
}
requestAnimationFrame(animate);
Promise.all([json('/api/rules'),json('/api/replays')]).then(async([r,list])=>{
  rules=r;const select=document.querySelector('#matches');select.replaceChildren();
  const wanted=new URLSearchParams(location.search).get('match');
  if(wanted&&!list.some(m=>m.id===wanted))list.unshift({id:wanted,date:0,winner:'指定比赛',seconds:0});
  if(!list.length){select.add(new Option('尚无完整比赛记录',''));error('第一局结束后会生成回放');return;}
  for(const m of list)select.add(new Option((m.date?new Date(m.date).toLocaleString('zh-CN')+' · ':'')+teamName(m.winner||'平局')+' · '+fmt(m.seconds),m.id));
  select.onchange=()=>load(select.value);if(wanted)select.value=wanted;await load(select.value);
}).catch(e=>error(e.message));
