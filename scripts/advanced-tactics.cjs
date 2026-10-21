// Published BedWars tactics. Uses own state, public map/bed status and visible enemies.
const {Vec3}=require('../bot-controller/node_modules/vec3');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const currency={iron:'iron_ingot',gold:'gold_ingot',diamond:'diamond',emerald:'emerald'};
const {resourceScore,counterPurchase,safePearlTarget}=require('./strategy-planner.cjs');
const names=item=>JSON.stringify({name:item.customName,nbt:item.nbt,components:item.components},(_,v)=>typeof v==='bigint'?String(v):v);

function tacticalPriority(s){
 if(s.health<=6&&s.enemyDistance<7)return 'retreat';
 if(s.bedAlive&&s.invader)return 'defend';
 if(!s.bedAlive&&s.health<14)return 'survive';
 if(s.health<=8&&(s.absorption||0)<2&&s.enemyDistance>=7)return 'recover';
 if(s.diamonds>=4||s.emeralds>=4)return 'bank';
 return 'develop';
}
function escapeCandidates(origin,enemy,options){
 return options.filter(v=>!enemy||v.distanceTo(enemy)>origin.distanceTo(enemy)+2&&v.minus(origin).dot(origin.minus(enemy))>0).sort((a,b)=>a.distanceTo(origin)-b.distanceTo(origin));
}
module.exports={tacticalPriority,escapeCandidates,extend(Base,{rules,getMatch}){
 const {baseX,bedX,footX,feetY,nearBase,home,approach}=require('./arena-geometry.cjs').forMap(rules.map);
 return class TacticalAgent extends Base {
  onMatch(){
   this.resourceVisits={};this.observedDefense=[];this.routeAvoid=new Map();this.lastSweep=0;this.searchIndex=0;this.needBlocks=false;this.lastUtility=-1000;this.floodSeen=-1000;
   this.banked={};this.trip=null;this.lastTrip=-5000;this.lastBank=-5000;this.defenseTier=0;this.lastDefense=-1000;this.defenseRetryAt=0;this.lastPotion=-1000;this.lastPearl=-1000;this.lastSpecial=-1000;this.retreatUntil=0;this.lastThreat=-1000;this.tactics={};this.intent='准备开局';this.reason='根据可见局势规划';this.history=[];this.gapWatchSince=0;this.defenseSince=0;this.lastDodgedTnt=null;this.lastSeenEnemy=null;this.combatWeapon=null;this.edgeGuardActive=false;this.bedSound=null;this.lastInvestigation=-1000;this.lastVantage=-1000;
  }
  note(key,reason){this.intent=key;this.reason=reason;if(this.history.at(-1)?.intent!==key){this.history.push({tick:getMatch().tick,intent:key,reason});if(this.history.length>48)this.history.shift();}}
  tally(key){this.tactics[key]=(this.tactics[key]||0)+1;}
  ownBed(){return getMatch().teams?.find(t=>t.name===this.ownTeam())?.bed===true;}
  atBase(){return nearBase(this.bot.entity.position,this.side);}
  available(resource){return this.count(currency[resource])+(this.banked?.[resource]||0);}
  invader(enemy){return this.ownBed()&&enemy&&enemy.position.distanceTo(new Vec3(...this.teamConfig().bed))<19;}
  combatRange(enemy){return this.invader(enemy)||getMatch().teams?.some(t=>t.name!==this.ownTeam()&&!t.bed)?16:this.style==='fortify'?8:6.5;}
  selfEffects(){return getMatch().players?.find(p=>p.name===this.name)?.effects||[];}
  hasEffect(id){return this.selfEffects().some(e=>e.name===id&&e.ticks>40);}
  hasPotion(id){const label=rules.shop.find(i=>i.id===id).stack['display-name'];return this.bot.inventory.items().some(i=>i.name==='potion'&&names(i).includes(label));}
  bestSword(){const enemy=this.visibleEnemy?.();if(this.style==='fortify'&&this.item('stick')&&enemy&&enemy.position.distanceTo(this.bot.entity.position)<3.2&&[[-1,0],[1,0],[0,-1],[0,1]].some(([x,z])=>this.bot.blockAt(enemy.position.offset(x,-.2,z))?.boundingBox!=='block'))return 'stick';return super.bestSword();}
  async fight(enemy){this.note(this.invader(enemy)?'拦截床前敌人':'近战争夺通路','保留攻击冷却，危险时撤退或治疗');return super.fight(enemy);}
  guardedTask(fn){this.task(async token=>{this.usingItem=true;try{await fn(token)}finally{if(token===this.token)this.usingItem=false}});}
  interruptFor(fn){if(this.pendingTask){if(this.taskToken===this.token)this.cancel();return true;}if(this.engaging)this.cancel();this.guardedTask(fn);return true;}
  tacticalUpdate(enemy){
   const now=getMatch().tick||0,p=this.bot.entity.position,d=enemy?enemy.position.distanceTo(p):Infinity;
   const flooded=this.bot.blockAt(p.offset(0,.1,0))?.name==='water';if(flooded)this.floodSeen=now;
   if(flooded&&d>5&&this.item('sponge')&&now-this.lastUtility>100){
    this.note('清除通路积水','在可放置的水边使用海绵恢复通路');return this.interruptFor(t=>this.clearFlood(t));
   }
   if((Number(this.bot.entity.metadata?.[0]||0)&1)&&d>5&&this.item('water_bucket')&&now-this.lastUtility>100){
    this.note('用水熄灭身上的火','确认脚下有地面后使用水桶');return this.interruptFor(t=>this.extinguish(t));
   }
   if(this.invader(enemy))this.lastThreat=now;
   const priority=tacticalPriority({health:this.bot.health,absorption:getMatch().players?.find(v=>v.name===this.name)?.absorption||0,enemyDistance:d,bedAlive:this.ownBed(),invader:this.invader(enemy),diamonds:this.count('diamond'),emeralds:this.count('emerald')});
   this.priority=priority;
   const blast=getMatch().projectiles?.find(e=>e.kind==='TNT'&&new Vec3(...e.pos).distanceTo(p)<6.5);
   if(blast){
    const eye=p.offset(0,1.62,0),target=new Vec3(...blast.pos).offset(0,.5,0),ray=target.minus(eye),length=ray.norm();
    if(length>0&&!this.bot.world.raycast(eye,ray.scaled(1/length),length)){
     const candidates=[...[-1,0,1].flatMap(x=>[-1,0,1].map(z=>p.offset(x*7,0,z*7))),...(rules.map.tactical_positions||[]).filter(v=>v.kind==='cover').map(v=>new Vec3(...v.position))].filter(v=>this.bot.blockAt(v.offset(0,-.2,0))?.boundingBox==='block'&&this.bot.blockAt(v.offset(0,.2,0))?.boundingBox==='empty'&&v.distanceTo(target)>6.5&&v.distanceTo(p)<12&&v.minus(p).dot(p.minus(target))>=0).sort((a,b)=>a.distanceTo(p)-b.distanceTo(p));
     if(candidates.length){this.note('避开已点燃的TNT','先离开爆炸范围，再回防床位');return this.interruptFor(async t=>{this.lastDodgedTnt=blast.id;await this.walk(candidates[0],t,3000);this.tally('tnt_dodge');});}
    }
   }
   if(!enemy&&this.ownBed()&&this.bedSound&&now-this.bedSound.tick<60&&now-this.lastInvestigation>60&&this.atBase()){
    this.lastThreat=now;
    const head=bedX(this.side),points=[new Vec3(head+.5,65,3.5),new Vec3(head+.5,65,-3.5),new Vec3((baseX(this.side)+(this.side)*-6)+.5,65,.5)].filter(v=>v.distanceTo(p)>1.5&&this.bot.blockAt(v.offset(0,-.2,0))?.boundingBox==='block');
    points.sort((a,b)=>a.distanceTo(this.bedSound.position)-b.distanceTo(this.bedSound.position));
    if(points.length){this.note('检查床边挖掘声','从收到的方块音效寻找可观察的位置');if(this.pendingTask){if(this.taskToken===this.token)this.cancel();return true;}this.lastInvestigation=now;this.task(t=>this.walk(points[0],t,5000));return true;}
   }
   if(enemy&&d>=8&&this.item('bow')&&this.count('arrow')>0&&this.bot.health>=10&&now-this.lastVantage>240){
    const options=(rules.map.tactical_positions||[]).filter(v=>v.kind==='high_ground'&&(!v.team||v.team===this.ownTeam())).map(v=>new Vec3(...v.position)).filter(v=>v.distanceTo(p)>2&&v.distanceTo(p)<14&&this.bot.blockAt(v.offset(0,-.2,0))?.boundingBox==='block');
    options.sort((a,b)=>a.distanceTo(p)-b.distanceTo(p));
    const point=options.find(v=>{const eye=v.offset(0,1.62,0),ray=enemy.position.offset(0,1.2,0).minus(eye),length=ray.norm();return v.distanceTo(enemy.position)<15.3&&length<16&&!this.bot.world.raycast(eye,ray.scaled(1/length),length)});
    if(point&&!this.pendingTask){this.lastVantage=now;this.note('占据射击位置','沿楼梯到有视线的高处，保持退路');this.task(async t=>{await this.route(point,t);this.tally('high_ground');});return true;}
   }
   const enemyBase=-this.side*p.x;
   if(nearBase(p,-this.side)&&getMatch().teams?.some(t=>t.name!==this.ownTeam()&&t.bed)){
    const enemyTeam=rules.map.teams[this.side<0?'Blue':'Red'],head=new Vec3(...enemyTeam.bed),foot=head.offset(this.side,0,0);
    const exposed=[head,foot].map(v=>this.bot.blockAt(v)).find(block=>block?.name.endsWith('_bed')&&this.bot.canSeeBlock(block)&&block.position.offset(.5,.5,.5).distanceTo(p.offset(0,1.62,0))<=4.4);
    if(exposed&&d>2.6&&(this.bot.health>6||this.ownBed())){
     this.note('抓住拆床窗口','床已露出，优先完成目标而不是继续追人');return this.interruptFor(t=>this.assault(t));
    }
    if(d>4.5&&this.bot.health>8&&this.item('tnt')){
     this.note('把交战间隙用于破床','守卫暂时离开近战距离，使用已有爆破物');return this.interruptFor(t=>this.assault(t));
    }
   }
   // Vanilla invisibility leaves the mode's permanent armor visible; do not assume an unseen defender bypass.
   if(priority==='retreat'&&(!this.item('golden_apple')||this.steps-this.lastHeal<80)&&now>this.retreatUntil){
    this.note('紧急脱战','低血量避免继续换血');
    return this.interruptFor(t=>{this.retreatUntil=now+100;return this.withdraw(enemy,t)});
   }
   if(enemy&&d>=7&&d<=16&&this.item('fire_charge')&&now-this.lastSpecial>100){
    const floor=this.bot.blockAt(enemy.position.offset(0,-.2,0));
    if(floor?.name.endsWith('_wool')||this.invader(enemy)){this.note('火球拦截','敌人正在桥上或进入基地');return this.interruptFor(t=>this.fireball(enemy,t));}
   }
   const away=-this.side*p.x,enemyFront=Math.abs(baseX(-this.side))-18;
   if(away>enemyFront-24&&away<enemyFront+4&&now-this.lastPotion>10){
    const candidates=[['speed_potion','speed'],['jump_potion','jump_boost']];
    for(const [id,effect]of candidates){const entry=rules.shop.find(i=>i.id===id),item=this.bot.inventory.items().find(i=>i.name==='potion'&&names(i).includes(entry.stack['display-name']));if(item&&!this.hasEffect(effect)&&d>6){this.note('突袭前使用药水',entry.label);return this.interruptFor(t=>this.drink(item,t));}}
   }
   if(this.item('ender_pearl')&&now-this.lastPearl>200&&away>enemyFront-26&&away<enemyFront+3&&(this.hasEffect('invisibility')||!this.ownBed()||d<12)&&this.pearlTarget()){
    this.note('珍珠绕过桥头','落点选择公开地图上的敌方岛体');return this.interruptFor(t=>this.pearl(t));
   }
   if(enemy&&d>3.2&&d<16){
    const delta=enemy.position.minus(p);delta.y=0;let gap=false;
    for(let t=.5;t<delta.norm()-.2;t+=.4){const q=p.plus(delta.scaled(t/delta.norm()));q.y=rules.map.surface_y;if([[-.2,-.2],[-.2,.2],[.2,-.2],[.2,.2]].some(([x,z])=>this.bot.blockAt(q.offset(x,0,z))?.boundingBox!=='block')){gap=true;break;}}
    if(gap){
     if(this.pendingTask)return true;
     if(this.engaging){this.cancel();return true;}
     if(!this.gapWatchSince)this.gapWatchSince=now;
     if(this.style==='fortify'&&this.atBase()&&now-this.gapWatchSince<40){
      this.note('观察桥口威胁','短暂确认敌人动向后选择通路');this.bot.clearControlStates();this.bot.lookAt(enemy.position.offset(0,1.2,0),false).catch(()=>{});return true;
     }
     this.note('寻找接敌路线','优先沿已有道路，只为实际缺口补桥');
     this.task(t=>this.count('wool')<8?this.buy('wool',32,t):this.route(new Vec3(enemy.position.x,65,enemy.position.z),t));return true;
    }
   }
   this.gapWatchSince=0;
   return false;
  }
  async withdraw(enemy,token){
   this.tally('retreat');const p=this.bot.entity.position;
   const options=escapeCandidates(p,enemy?.position,[new Vec3(...this.teamConfig().spawn.slice(0,3)),...(rules.map.tactical_positions||[]).filter(v=>v.kind==='cover').map(v=>new Vec3(...v.position))]);
   if(options.length)try{await this.walk(options[0],token,5000)}catch(e){this.check(token)}
   if(this.atBase()&&this.bot.health<14){
    for(let i=0;i<3&&!this.item('golden_apple');i++){this.check(token);await this.buy('golden_apple',1,token);}
    if(this.item('golden_apple'))await this.heal(token,this.visibleEnemy());
   }
  }
  async heal(token,enemy){
   this.usingItem=true;
   try{
   this.note('掩护后治疗','用方块遮挡敌方视线并恢复血量');
   if(enemy&&this.count('wool')>=2&&enemy.position.distanceTo(this.bot.entity.position)>3.8){
    const delta=enemy.position.minus(this.bot.entity.position);delta.y=0;if(delta.norm()>0){delta.scale(1.8/delta.norm());const q=this.bot.entity.position.plus(delta).floored();q.y=65;
     if(this.bot.blockAt(q.offset(0,-1,0))?.boundingBox==='block')for(let y=0;y<2;y++)try{await this.place(q.offset(0,y,0),'wool',token)}catch(e){this.check(token)}
    }
   }
   const before=this.count('golden_apple');await super.heal(token,enemy);if(this.count('golden_apple')<before||this.hasEffect('regeneration'))this.tally('golden_apple');
   }finally{if(token===this.token)this.usingItem=false;}
  }
  async fireball(enemy,token){
   this.check(token);await this.equip('fire_charge');this.check(token);const seen=this.visibleEnemy();if(!seen)return;
   await this.bot.lookAt(seen.position.offset(0,.4,0),true);await sleep(150);this.check(token);this.bot.activateItem();this.bot.swingArm('right');this.lastSpecial=getMatch().tick;this.tally('fireball');await sleep(350);
  }
  async clearFlood(token){
   this.lastUtility=getMatch().tick;const p=this.bot.entity.position.floored();
   for(const [x,z]of [[1,0],[-1,0],[0,1],[0,-1]]){
    const q=p.offset(x,0,z),floor=this.bot.blockAt(q.offset(0,-1,0)),body=this.bot.blockAt(q);
    if(floor?.boundingBox!=='block'||!['water','air'].includes(body?.name))continue;
    await this.equip('sponge');this.check(token);await this.bot._genericPlace(floor,new Vec3(0,1,0),{forceLook:true,swingArm:'right'});await sleep(250);this.tally('sponge');return;
   }
  }
  async extinguish(token){
   this.lastUtility=getMatch().tick;const p=this.bot.entity.position.floored(),floor=this.bot.blockAt(p.offset(0,-1,0));if(floor?.boundingBox!=='block')return;
   await this.equip('water_bucket');await this.bot.lookAt(p.offset(.5,-.01,.5),true);this.check(token);this.bot.activateItem();await sleep(700);
   if(this.item('bucket')){await this.equip('bucket');await this.bot.lookAt(p.offset(.5,.2,.5),true);this.check(token);this.bot.activateItem();}
   this.tally('water_bucket');
  }
  async drink(item,token){
   await this.bot.equip(item,'hand');this.check(token);await sleep(150);this.check(token);await this.bot.consume();this.lastPotion=getMatch().tick;this.tally('potion');
  }
  pearlTarget(){
   const target=new Vec3((baseX(-this.side)+(-this.side)*-5)+.5,65.1,4.5),self=getMatch().players?.find(p=>p.name===this.name);
   return safePearlTarget({origin:this.bot.entity.position,target,health:this.bot.health+(self?.absorption||0),cooldown:self?.item_cooldowns?.ender_pearl||0,solid:v=>this.bot.blockAt(v)?.boundingBox==='block',clear:v=>this.bot.blockAt(v)?.boundingBox==='empty',raycast:(...a)=>this.bot.world.raycast(...a)})?target:null;
  }
  async pearl(token){
   const target=this.pearlTarget();if(!target)return;
   const d=target.distanceTo(this.bot.entity.position);
   await this.equip('ender_pearl');await this.bot.lookAt(target.offset(0,d*d*.0067,0),true);await sleep(150);this.check(token);this.bot.activateItem();this.bot.swingArm('right');this.lastPearl=getMatch().tick;this.tally('ender_pearl');await sleep(1600);
  }
  async chest(token,withdraw={}){
   const loc=Object.values(rules.map.teams).map(t=>t.ender_chest).sort((a,b)=>new Vec3(...a).distanceTo(this.bot.entity.position)-new Vec3(...b).distanceTo(this.bot.entity.position))[0];await this.route(new Vec3(loc[0]+.5,65,loc[2]-1.5),token);
   const block=this.bot.blockAt(new Vec3(...loc));this.check(token);const chest=await this.bot.openContainer(block);
   try{
    for(const [resource,id]of Object.entries(currency)){
     this.check(token);const held=this.count(id),available=chest.containerItems().filter(i=>i.name===id).reduce((n,i)=>n+i.count,0);const type=this.bot.registry.itemsByName[id].id;
     if(withdraw[resource]){const amount=Math.min(available,withdraw[resource]);if(amount>0){await chest.withdraw(type,null,amount);this.tally('withdraw');}}
     else if(!Object.keys(withdraw).length){const reserve={iron:24,gold:3,diamond:0,emerald:0}[resource];if(held>reserve){await chest.deposit(type,null,held-reserve);this.tally('deposit');}}
     this.banked[resource]=chest.containerItems().filter(i=>i.name===id).reduce((n,i)=>n+i.count,0);
    }
   }finally{chest.close();}
   this.lastBank=getMatch().tick;
  }
  async buy(id,quantity,token){
   const entry=rules.shop.find(i=>i.id===id),cost=entry.price*quantity/entry.amount,missing=cost-this.count(currency[entry.currency]);
   this.note('准备'+entry.label,missing>0?'补齐所需资源后出击':'把资源转换为当前需要的装备');
   if(missing>0&&this.banked[entry.currency]>0&&(nearBase(this.bot.entity.position,-1)||nearBase(this.bot.entity.position,1))){this.note('取回储备',entry.label);return this.chest(token,{[entry.currency]:missing});}
   return super.buy(id,quantity,token);
  }
  async upgrade(id,token){this.note('团队升级：'+rules.team_upgrades.find(u=>u.id===id).label,'优先提升本局持久战力');return super.upgrade(id,token);}
  defensePositions(layer){
   const head=bedX(this.side),foot=footX(this.side),positions=[];
   for(let x=Math.min(head,foot)-layer;x<=Math.max(head,foot)+layer;x++)for(let z=-layer;z<=layer;z++)for(let y=65;y<=65+layer;y++){
    if(Math.min(Math.abs(x-head),Math.abs(x-foot))+Math.abs(z)+(y-65)===layer)positions.push(new Vec3(x,y,z));
   }
   return positions;
  }
  async constructionStand(target,token){
   const movement=this.bot.pathfinder.movements,oldParkour=movement.allowParkour,oldSprint=movement.allowSprinting;
   const low=Math.min(bedX(this.side),footX(this.side))-2,high=Math.max(bedX(this.side),footX(this.side))+2;
   const avoid=block=>target.y===65&&block.position&&block.position.x>=low&&block.position.x<=high&&Math.abs(block.position.z)<=2?100:0;
   movement.exclusionAreasStep.push(avoid);movement.allowParkour=false;movement.allowSprinting=false;
   try{
    await this.walk(target,token,8000);
    const deadline=Date.now()+2500;
    while(Math.hypot(this.bot.entity.position.x-target.x,this.bot.entity.position.z-target.z)>.22){
     this.check(token);if(Date.now()>deadline)throw new Error('construction_stand_timeout');
     await this.bot.lookAt(new Vec3(target.x,this.bot.entity.position.y+1.5,target.z),true);this.bot.setControlState('forward',true);await sleep(50);
    }
   }finally{movement.exclusionAreasStep=movement.exclusionAreasStep.filter(f=>f!==avoid);movement.allowParkour=oldParkour;movement.allowSprinting=oldSprint;if(token===this.token)this.bot.clearControlStates();}
  }
  async layerDefense(layer,material,token){
   this.note(layer===1?'修复内层护床':'加固外层护床',material==='end_stone'?'末地石抵御快速挖掘':material==='white_stained_glass'?'防爆玻璃保留爆炸后的床前屏障':'用外层方块延缓拆床');
   const spots=this.defensePositions(layer).sort((a,b)=>a.y-b.y||Math.sign(a.z)-Math.sign(b.z)||a.x-b.x),head=bedX(this.side);
   for(const position of spots){
    this.check(token);if(this.bot.blockAt(position)?.boundingBox==='block')continue;if(!this.item(material))return;
    const candidates=[new Vec3(head+.5,65,3.5),new Vec3(head+.5,65,-3.5),new Vec3(head+this.side*3+.5,65,.5),new Vec3(head-this.side*4+.5,65,.5)].filter(v=>this.bot.blockAt(v.offset(0,-.1,0))?.boundingBox==='block').sort((a,b)=>a.distanceTo(position)-b.distanceTo(position));
    if(!candidates.length){this.defenseRetryAt=getMatch().tick+200;return;}
    if(process.env.SKYDUEL_TRACE)console.log(this.name,'defense placement',position.toString(),'stand',candidates[0].toString());
    await this.constructionStand(candidates[0],token);
    try{if(position.y>=67){this.bot.setControlState('jump',true);await sleep(250);}await this.place(position,material,token)}catch(e){this.check(token);this.defenseRetryAt=getMatch().tick+200;throw new Error('defense_place_'+position.toString()+':'+e.message);}finally{this.bot.setControlState('jump',false);}
   }
   this.defenseTier=Math.max(this.defenseTier,layer);this.defended=true;this.lastDefense=getMatch().tick;this.tally('defense_layer');
  }
  async resourceTrip(resource,amount,token){
   this.note(resource==='diamond'?'钻石升级路线':'中心资源路线',resource==='diamond'?'先提高保护与武器等级':'准备药水、珍珠或永久装备');
   if(this.count('wool')<48&&this.atBase())return this.buy('wool',64,token);
   if(!this.trip)this.trip={resource,amount,started:getMatch().tick};
   const candidates=rules.map.spawners.filter(s=>s.resource===resource&&!s.team);
   const seen=this.lastSeenEnemy,now=getMatch().tick;
   const score=spawn=>resourceScore({position:this.bot.entity.position,spawner:spawn,enemy:seen&&now-seen.tick<100?seen.position:null,now,lastVisit:this.resourceVisits[spawn.position.join(',')]});
   const spawn=candidates.sort((a,b)=>score(a)-score(b))[0];
   await this.route(new Vec3(spawn.position[0],65,spawn.position[2]),token);
   const deadline=Date.now()+2500;while(this.count(currency[resource])<amount&&Date.now()<deadline){this.check(token);await sleep(200)}
   this.resourceVisits[spawn.position.join(',')]=getMatch().tick;
   if(this.count(currency[resource])>=amount||!this.ownBed()||getMatch().tick-(this.trip.started||getMatch().tick)>400&&this.count(currency[resource])>0){this.trip={resource,returning:true};this.tally('resource_trip');}
  }
  async assault(token){
   if(getMatch().teams?.some(t=>t.name!==this.ownTeam()&&!t.bed)){
    this.note('终结无床对手','停止拆除无用床防，沿可见踪迹搜索对手');
    const visible=this.visibleEnemy(),recent=this.lastSeenEnemy&&getMatch().tick-this.lastSeenEnemy.tick<240;
    const points=[new Vec3((baseX(-this.side)+(-this.side)*4)+.5,65,3.5),new Vec3(.5,65,2.5),...rules.map.spawners.filter(s=>!s.team).map(s=>new Vec3(s.position[0],65,s.position[2]))];
    if(!visible&&!recent&&getMatch().tick-this.lastSweep>100){this.searchIndex=(this.searchIndex+1)%points.length;this.lastSweep=getMatch().tick;}
    const target=visible?.position.clone()||(recent&&this.bot.entity.position.distanceTo(this.lastSeenEnemy.position)>2?this.lastSeenEnemy.position.clone():points[this.searchIndex]);
    return this.route(target,token);
   }
   const side=-this.side,head=bedX(side),foot=footX(side),all=[];
   for(let x=Math.min(head,foot)-2;x<=Math.max(head,foot)+2;x++)for(let z=-2;z<=2;z++)for(let y=65;y<=67;y++){
    const b=this.bot.blockAt(new Vec3(x,y,z));if(b&&['end_stone','oak_planks','red_wool','blue_wool','obsidian','red_bed','blue_bed','white_stained_glass'].includes(b.name)&&this.bot.canSeeBlock(b)&&this.bot.entity.position.distanceTo(b.position.offset(.5,.5,.5))<4.4)all.push(b);
   }
   const bed=all.find(b=>b.name.endsWith('_bed'));if(bed){this.note('抓住拆床窗口','床已暴露');await this.bot.dig(bed,true);this.tally('bed_attempt');return;}
   if(all.length)this.observedDefense=[...new Set(all.filter(b=>!b.name.endsWith('_bed')).map(b=>b.name))];
   if(all.some(b=>b.name==='obsidian')&&!this.item('diamond_pickaxe')){this.needDiamondPick=true;this.note('调整拆床工具','发现黑曜石，准备钻石镐');return;}
   if(!this.item('tnt')&&all.some(b=>b.name==='oak_planks')&&!this.bestTool('axe')&&this.count('iron_ingot')>=10)return this.buy('wooden_axe',1,token);
   if(!this.item('tnt')&&all.some(b=>b.name.endsWith('_wool'))&&!this.item('shears')&&this.count('iron_ingot')>=20)return this.buy('shears',1,token);
   if(this.item('tnt')&&all.length&&getMatch().tick-this.lastSpecial>120&&!all.some(b=>['obsidian','white_stained_glass'].includes(b.name))){
    const ref=all.filter(b=>this.bot.blockAt(b.position.offset(0,1,0))?.name==='air').sort((a,b)=>a.position.distanceTo(this.bot.entity.position)-b.position.distanceTo(this.bot.entity.position))[0];
    if(ref){this.note('TNT打开床防','放置后撤离爆炸范围');this.usingItem=true;try{await this.equip('tnt');this.check(token);await this.bot._genericPlace(ref,new Vec3(0,1,0),{forceLook:true,swingArm:'right'});this.lastSpecial=getMatch().tick;this.tally('tnt');
     const fuseEnd=Date.now()+(rules.mechanics?.bedwars.tnt_fuse_ticks||80)*50+100;
     const safe=[new Vec3(baseX(side)+.5,65,7.5),new Vec3((baseX(side)+(side)*4)+.5,65,2.5),new Vec3(baseX(side)+.5,65,-7.5)].filter(v=>this.bot.blockAt(v.offset(0,-.2,0))?.boundingBox==='block'&&v.distanceTo(ref.position)>5).sort((a,b)=>a.distanceTo(this.bot.entity.position)-b.distanceTo(this.bot.entity.position));
     if(safe.length)try{await this.walk(safe[0],token,2500)}catch(e){this.check(token)}
     await this.equip(this.bestSword());this.lastAttack=this.steps;
     while(Date.now()<fuseEnd){this.check(token);const seen=this.visibleEnemy(6);if(seen&&seen.position.distanceTo(this.bot.entity.position)<4.5)await this.fight(seen);await sleep(100);}this.bot.clearControlStates();this.check(token);}finally{if(token===this.token)this.usingItem=false;}return;}
   }
   if(all.length){all.sort((a,b)=>{const cost=q=>(q.name==='obsidian'?50:q.name==='end_stone'?8:1)+q.position.distanceTo(new Vec3(foot,65,0))*.5;return cost(a)-cost(b)});const block=all[0];this.note('按材料选择工具','打开通向床的最短缺口');const tool=this.toolFor?this.toolFor(block):this.bot.pathfinder.bestHarvestTool(block);if(tool)await this.bot.equip(tool,'hand');this.check(token);await this.bot.dig(block,true);return;}
   return super.assault(token);
  }
  async macro(token){
   const tick=getMatch().tick||0,atBase=this.atBase(),ownBed=this.ownBed(),up=this.ownUpgrades(),p=this.bot.entity.position,enemy=this.visibleEnemy();
   if(this.needBlocks){if(this.count('wool')>=48)this.needBlocks=false;else return this.buy('wool',64,token);}
   if(this.priority==='recover'){
    this.note('补给后再出击','低血量先取得治疗，避免带着残血反复送掉装备');
    if(!atBase)return this.route(new Vec3(...this.teamConfig().spawn.slice(0,3)),token);
    if(!this.item('golden_apple'))return this.buy('golden_apple',1,token);
    return this.heal(token,enemy);
   }
   if(getMatch().classic?.stage==='sudden_death'){this.note('争夺决赛中心','缩圈阶段避免停留外侧');return this.route(new Vec3(.5,65,4.5),token);}
   if(this.trip?.returning){this.note('带资源回城','优先把资源兑换成持久优势');await this.route(new Vec3((baseX(this.side)+(this.side)*1)+.5,65,2.5),token);this.trip=null;this.lastTrip=tick;return;}
   if(this.priority==='bank'&&!atBase&&!this.trip&&-this.side*p.x<30){this.trip={returning:true};return;}
   if(this.needDiamondPick&&!this.item('diamond_pickaxe')){this.note('准备破黑曜石','返回补给并购买钻石镐');if(!atBase)return this.route(new Vec3((baseX(this.side)+(this.side)*1)+.5,65,2.5),token);return this.buy('diamond_pickaxe',1,token);}
   if(!ownBed&&this.bot.health<14&&!this.item('golden_apple')){this.note('无床生存','先补治疗，避免最终淘汰');return this.buy('golden_apple',1,token);}
   if(atBase&&this.style==='fortify'&&!['stone_sword','iron_sword','diamond_sword'].some(id=>this.item(id)))return this.buy('stone_sword',1,token);
   if(atBase&&ownBed&&this.defenseTier<1){const material=this.style==='fortify'?'white_stained_glass':'wool';if(this.count(material)<8)return this.buy(this.style==='fortify'?'glass':'wool',this.style==='fortify'?8:32,token);return this.layerDefense(1,material,token);}
   if(!this.item('stone_sword')&&!this.item('iron_sword')&&!this.item('diamond_sword'))return this.buy('stone_sword',1,token);
   if(!this.bestTool('pickaxe'))return this.buy('wooden_pickaxe',1,token);
   if(atBase&&this.count('wool')<24)return this.buy('wool',32,token);
   if(atBase&&this.available('gold')>=12&&this.kitTier()<2)return this.buy('iron_armor',1,token);
   if(atBase&&this.available('gold')>=3&&this.count('golden_apple')<1&&this.bot.health<18)return this.buy('golden_apple',1,token);
   if(atBase&&ownBed&&this.style==='fortify'&&this.defenseTier<2&&tick>2200&&tick-this.lastThreat>200&&tick>=this.defenseRetryAt)return this.layerDefense(2,'wool',token);
   // Defensive upgrades before generator greed, while rush banks TNT before extra weapons.
   if(atBase){
    if(tick-this.floodSeen<600&&!this.item('sponge')&&this.available('gold')>=3)return this.buy('sponge',4,token);
    if(!ownBed&&!this.item('water_bucket')&&this.available('gold')>=3&&this.item('golden_apple'))return this.buy('water_bucket',1,token);
    const counter=counterPurchase({materials:this.observedDefense,inventory:id=>this.item(id),enemyBed:getMatch().teams?.some(t=>t.name!==this.ownTeam()&&t.bed),health:this.bot.health,ownBed,style:this.style,armor:this.kitTier()});
    if(counter){const item=rules.shop.find(i=>i.id===counter);if(item&&this.available(item.currency)>=item.price)return this.buy(counter,item.amount,token);}
    for(const [id,max]of [['protection',2],['trap',1],['sharpness',1],['heal_pool',1],['haste',1],['forge',2]]){
     const level=up[id]||0,cost=rules.team_upgrades.find(u=>u.id===id).costs[level];if(level<max&&this.count('diamond')>=cost)return this.upgrade(id,token);
    }
    if(this.style==='rush'&&!this.item('tnt')&&this.available('gold')>=4&&getMatch().teams?.some(t=>t.name!==this.ownTeam()&&t.bed))return this.buy('tnt',1,token);
    if(this.available('gold')>=3&&this.count('golden_apple')<1)return this.buy('golden_apple',1,token);
    if(!this.item('iron_sword')&&!this.item('diamond_sword')&&this.available('gold')>=7&&(this.style!=='fortify'||this.kitTier()>=2||!ownBed))return this.buy('iron_sword',1,token);
    if(this.style==='fortify'&&!this.item('fire_charge')&&this.available('iron')>=40)return this.buy('fireball',1,token);

    if(this.style==='fortify'&&!this.item('bow')&&this.available('gold')>=12)return this.buy('bow',1,token);

    if(this.item('bow')&&this.count('arrow')<16&&this.available('gold')>=2)return this.buy('arrow',8,token);
    if(this.style==='fortify'&&this.item('bow')&&this.count('arrow')<8)return this.buy('arrow',8,token);
    if(this.style==='fortify'&&this.item('bow')&&!this.item('stick')&&this.available('gold')>=5)return this.buy('knockback_stick',1,token);
    if(this.needDiamondPick&&!this.item('diamond_pickaxe'))return this.buy('diamond_pickaxe',1,token);
    if(!ownBed&&this.available('emerald')>=4&&!this.item('ender_pearl'))return this.buy('ender_pearl',1,token);
    if(this.available('emerald')>=6&&this.kitTier()<3&&this.style==='fortify')return this.buy('diamond_armor',1,token);
    if(this.style==='rush'&&this.available('emerald')>=4&&!this.item('ender_pearl'))return this.buy('ender_pearl',1,token);
    if(this.available('emerald')>=1&&!this.hasPotion('speed_potion'))return this.buy('speed_potion',1,token);
    if(this.available('emerald')>=4&&!this.item('ender_pearl'))return this.buy('ender_pearl',1,token);
    if(this.available('emerald')>=4&&!this.item('diamond_sword'))return this.buy('diamond_sword',1,token);
    if(ownBed&&tick-this.lastDefense>400&&this.count('wool')>=8&&this.defensePositions(1).some(v=>this.bot.blockAt(v)?.boundingBox!=='block'))return this.layerDefense(1,'wool',token);
    if(tick-this.lastBank>400&&(this.count('iron_ingot')>32||this.count('gold_ingot')>5||this.count('diamond')||this.count('emerald'))){this.note('保存下次出击的物资','多余资源存入末影箱');return this.chest(token);}
   }
   if(this.invader(enemy)){this.note('回防拦截','优先阻止眼前的拆床威胁');return this.walk(enemy.position.clone(),token,5000);}
   if(this.trip){
    if(tick-this.trip.started>600){this.trip.returning=true;return;}
    return this.resourceTrip(this.trip.resource,this.trip.amount||4,token);
   }
   if(this.style==='fortify'&&tick>700&&tick-this.lastTrip>1800&&tick-this.lastThreat>240&&ownBed)return this.resourceTrip('diamond',up.protection?4:3,token);
   if(tick>1600&&tick-this.lastTrip>1600&&this.count('emerald')<4&&tick-this.lastThreat>160)return this.resourceTrip('emerald',4,token);
   if(nearBase(p,-this.side)){this.note('拆床与终结','根据实际可见防御切换工具和爆破');return this.assault(token);}
   this.note(ownBed?'施压与拆床':'谨慎终结','沿已有安全路线推进，交战时保留撤退条件');return this.advance(token);
  }
  status(){return {...super.status(),intent:this.intent,reason:this.reason,tactics:this.tactics||{},banked:this.banked||{},decisions:this.history||[]};}
  failure(error){if(error.message==='route_needs_blocks')this.needBlocks=true;return super.failure(error);}
 };
}};
