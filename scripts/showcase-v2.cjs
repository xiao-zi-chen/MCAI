// Classic BedWars reference strategies; melee is learned, economy/navigation are explicit.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {createRequire}=require('node:module');
const runtimeRequire=createRequire(path.join(process.env.SKYDUEL_RUNTIME_ROOT||(fs.existsSync(path.join(__dirname,'../bot-controller/node_modules/mineflayer-pathfinder'))?path.join(__dirname,'../bot-controller'):'D:/codex-local-cache/skyduel-runtime'),'package.json'));
const {pathfinder,Movements,goals}=runtimeRequire('mineflayer-pathfinder');
const {Vec3}=require('../bot-controller/node_modules/vec3');
const {defenseBoxes,navigationPenalty}=require('./bedwars-navigation.cjs');
const {Agent,run,getMatch,rules,root,logits}=require('./showcase-agents.cjs');
const modelDir=path.resolve(root,process.env.SKYDUEL_MODEL_DIR||'models/showcase');
const {baseX,bedX,footX,feetY,nearBase,home,approach}=require('./arena-geometry.cjs').forMap(rules.map);
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const sha=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const controllerSources=Object.fromEntries(['scripts/showcase-v2.cjs','scripts/showcase-agents.cjs','scripts/minecraft-client.cjs','scripts/advanced-tactics.cjs','scripts/bedwars-navigation.cjs','scripts/bedwars-skills.cjs','scripts/arena-geometry.cjs','scripts/strategy-planner.cjs','competition/rules.json'].map(f=>[f,sha(path.join(root,f))]));
const controllerHash=crypto.createHash('sha256').update(JSON.stringify(controllerSources)).digest('hex'),manifested=new Set();
const itemNames=i=>JSON.stringify({name:i.customName,nbt:i.nbt,components:i.components},(_,v)=>typeof v==='bigint'?String(v):v);

class ClassicAgent extends Agent {
 constructor(name,style){
  super(name,style);this.model=JSON.parse(fs.readFileSync(path.join(modelDir,name+'.json'),'utf8'));
  this.modelHash=sha(path.join(modelDir,name+'.json'));this.bot.loadPlugin(pathfinder);
  this.bridgeWidth=style==='rush'?2:3;this.usingItem=false;this.lastHeal=-1000;this.lastShot=-1000;this.lastSpecial=-1000;this.diamondTrip=false;this.diamondTripDone=false;this.needDiamondPick=false;this.engaging=false;this.failUntil=0;
  this.bot.once('spawn',()=>{const m=new Movements(this.bot);m.canDig=false;m.allow1by1towers=false;m.allowParkour=true;m.maxDropDown=1;m.scafoldingBlocks=[];this.bot.pathfinder.setMovements(m);this.bot.pathfinder.thinkTimeout=1200;this.bot.pathfinder.tickTimeout=8;this.bot.pathfinder.searchRadius=128;});
 }
 cancel(){super.cancel();this.bot.pathfinder?.setGoal(null);if(this.bot.currentWindow)this.bot.closeWindow(this.bot.currentWindow);if(this.usingItem)this.bot.deactivateItem();this.usingItem=false;this.engaging=false;this.busy=Boolean(this.pendingTask);}
 task(fn){
  if(this.pendingTask)return;
  const token=this.token;this.taskToken=token;this.busy=true;
  const job=Promise.resolve().then(()=>{this.check(token);return fn(token)});this.pendingTask=job;
  job.catch(e=>{if(token===this.token)this.failure(e)}).finally(()=>{
   if(this.pendingTask===job){this.pendingTask=null;this.busy=false;}
   if(token===this.token){this.bot.pathfinder.setGoal(null);this.bot.clearControlStates()}
  });
 }
 active(){return super.active()&&this.bot.entity.position.y<rules.map.build_max[1]+2;}
 kitTier(){const boots=this.bot.inventory.slots[8]?.name||'';return boots.startsWith('diamond')?3:boots.startsWith('iron')?2:boots.startsWith('chainmail')?1:0;}
 bestTool(kind){return ['diamond','iron','stone','wooden'].map(t=>t+'_'+kind).find(id=>this.item(id));}
 bestSword(){return ['diamond_sword','iron_sword','stone_sword','wooden_sword'].find(id=>this.item(id));}
 attackReady(){return (getMatch().players?.find(p=>p.name===this.name)?.attack_cooldown||0)>=.99&&this.steps-this.lastAttack>=6;}
 ownTeam(){return this.side<0?'Red':'Blue';}
 ownUpgrades(){return getMatch().classic?.upgrades?.[this.ownTeam()]||{};}
 visibleEnemy(range=16){
  return this.bot.nearestEntity(e=>{
   if(e.type!=='player'||e.username===this.name||!['EmberAI','BastionAI'].includes(e.username))return false;
   const p=getMatch().players?.find(p=>p.name===e.username);if(!p||p.mode!=='SURVIVAL'||p.team===this.ownTeam())return false;
   const distance=e.position.distanceTo(this.bot.entity.position);if(distance>range)return false;
   // Invisible skin does not hide worn armor or a held item in this Java mode.
   if((Number(e.metadata?.[0]||0)&0x20)&&!e.equipment?.some(i=>i?.type>0)&&distance>2)return false;
   const eye=this.bot.entity.position.offset(0,1.62,0),delta=e.position.offset(0,1.2,0).minus(eye),n=delta.norm();return n>0&&!this.bot.world.raycast(eye,delta.scaled(1/n),n);
  });
 }
 features(enemy){
  const f=super.features(enemy),own=getMatch().players?.find(p=>p.name===this.name),other=getMatch().players?.find(p=>p.name===enemy.username);
  f[1]=1;f[20]=1;f[26]=f[27]=f[28]=f[29]=0;
  if(own){if(own.velocity)f.splice(5,3,...own.velocity);if(own.attack_cooldown!=null)f[19]=own.attack_cooldown;if(own.hurt_time!=null)f[21]=own.hurt_time/10;f[23]=own.on_ground?1:0;}
  if(other){if(other.velocity)f.splice(8,3,...other.velocity);f[24]=other.on_ground?1:0;}
  const elapsed=Math.min(1,(this.steps-(this.combatStart||this.steps))*2/600);f[25]=elapsed;f[30]=1-elapsed;return f;
 }
 async fight(enemy){
  if(!this.combatStart)this.combatStart=this.steps;
  this.bot.pathfinder.setGoal(null);this.engaging=false;
  const sword=this.bestSword();if(this.bot.heldItem?.name!==sword){await this.equip(sword);this.lastAttack=this.steps;}
  await super.fight(enemy);
 }
 async walk(target,token,timeout=18000){
  this.check(token);let timer;
  const movement=this.bot.pathfinder.movements;
  const boxes=defenseBoxes(rules.map),origin=this.bot.entity.position.clone();
  const avoid=block=>Math.floor(target.y)===rules.map.surface_y+1?navigationPenalty(block.position,target,origin,boxes):0;
  movement.exclusionAreasStep.push(avoid);
  try{
   const task=this.bot.pathfinder.goto(new goals.GoalBlock(Math.floor(target.x),Math.floor(target.y),Math.floor(target.z)));
   const deadline=Date.now()+timeout;let checkpoint=this.bot.entity.position.clone(),progress=Date.now();
   const abort=new Promise((_,reject)=>{timer=setInterval(()=>{
    if(token!==this.token||!this.active())return reject(new Error('interrupted'));
    if(this.bot.entity.position.distanceTo(checkpoint)>.5){checkpoint=this.bot.entity.position.clone();progress=Date.now();}
    if(Date.now()-progress>4500)return reject(new Error('walk_stuck'));
    if(Date.now()>deadline)reject(new Error('walk_timeout'));
   },100)});
   await Promise.race([task,abort]);this.check(token);
  }finally{clearInterval(timer);movement.exclusionAreasStep=movement.exclusionAreasStep.filter(f=>f!==avoid);if(token===this.token){this.bot.pathfinder.setGoal(null);this.bot.clearControlStates()}}
 }
 async bridgeTo(target,token){
  this.label='修建安全通路';
  const axis=Math.abs(target.x-this.bot.entity.position.x)>1?'x':'z';
  while(Math.abs(this.bot.entity.position[axis]-target[axis])>0.8){
   this.check(token);const p=this.bot.entity.position,current=Math.floor(p[axis]),direction=Math.sign(target[axis]-p[axis]);
   const x=axis==='x'?current+direction:Math.floor(target.x),z=axis==='z'?current+direction:Math.floor(target.z);
   const center=new Vec3(x,64,z);
   if(this.bot.blockAt(center)?.boundingBox!=='block')await this.place(center,'wool',token);
   for(const side of this.bridgeWidth===3?[-1,1]:[1]){
    const edge=center.offset(axis==='z'?side:0,0,axis==='x'?side:0);
    if(this.bot.blockAt(edge)?.boundingBox!=='block')await this.place(edge,'wool',token);
   }
   await this.walk(new Vec3(x+0.5,65,z+0.5),token,5000);
  }
 }
 async route(target,token){
  try{await this.walk(target,token,14000);return}catch(e){this.check(token);if(!/path|timeout/i.test(e.message))throw e;}
  // Public axis-aligned bridge route, shared by both profiles.
  const p=this.bot.entity.position;
  if(Math.abs(p.z-2.5)>0.7&&Math.abs(p.x)>16)await this.walk(new Vec3(p.x,65,2.5),token);
  if(Math.abs(this.bot.entity.position.x-target.x)>1)await this.bridgeTo(new Vec3(target.x,65,this.bot.entity.position.z),token);
  if(Math.abs(this.bot.entity.position.z-target.z)>1)await this.bridgeTo(target,token);
  await this.walk(target,token,5000);
 }
 async collect(resource,amount,token){
  this.label='收集'+rules.resources[resource].label;
  const currency={iron:'iron_ingot',gold:'gold_ingot',diamond:'diamond',emerald:'emerald'}[resource];
  let spawn=rules.map.spawners.find(s=>s.team===this.ownTeam()&&s.resource===resource&&(!s.requires_forge||(this.ownUpgrades().forge||0)>=s.requires_forge));
  if(!spawn)spawn=rules.map.spawners.filter(s=>s.resource===resource&&!s.team).sort((a,b)=>new Vec3(...a.position).distanceTo(this.bot.entity.position)-new Vec3(...b.position).distanceTo(this.bot.entity.position))[0];
  const target=new Vec3(spawn.position[0],65,spawn.position[2]);
  if(!spawn.team){
   if(this.count('wool')<32){await this.buy('wool',64,token);return;}
   await this.route(new Vec3(.5,65,2.5),token);
   await this.route(target,token);
  }else await this.route(target,token);
  const deadline=Date.now()+6000;while(this.count(currency)<amount&&Date.now()<deadline){this.check(token);await sleep(150)}
 }
 async buy(id,quantity,token){
  const entry=rules.shop.find(i=>i.id===id);if(!entry)throw new Error('unknown_shop_item');
  const currency={iron:'iron_ingot',gold:'gold_ingot',diamond:'diamond',emerald:'emerald'}[entry.currency];
  const cost=entry.price*quantity/entry.amount;
  if(this.count(currency)<cost)return this.collect(entry.currency,cost,token);
  this.label='购买'+entry.label;
  const stores=Object.values(rules.map.teams).map(t=>t.shop).sort((a,b)=>new Vec3(a[0],65,a[2]).distanceTo(this.bot.entity.position)-new Vec3(b[0],65,b[2]).distanceTo(this.bot.entity.position));
  const loc=stores[0];await this.route(new Vec3(loc[0],65,loc[2]+2),token);
  const npc=this.bot.nearestEntity(e=>e.name==='villager'&&e.position.distanceTo(new Vec3(loc[0],65,loc[2]))<1.5);
  if(!npc)throw new Error('shop_missing');await this.bot.lookAt(npc.position.offset(0,1.4,0),true);await this.bot.activateEntity(npc);
  const deadline=Date.now()+4000;while(!this.bot.currentWindow&&Date.now()<deadline){this.check(token);await sleep(50)}
  if(!this.bot.currentWindow)throw new Error('shop_window_timeout');
  try{
   const end=this.bot.currentWindow.inventoryStart;
   const slot=this.bot.currentWindow.slots.findIndex((item,index)=>index<end&&item&&(id==='wool'?item.name.endsWith('_wool'):item.name===entry.material)&&item.count===entry.amount&&(!entry.stack?.['display-name']||itemNames(item).includes(entry.stack['display-name'])));
   if(slot<0)throw new Error('shop_item_missing:'+id);
   for(let i=0;i<quantity/entry.amount;i++){this.check(token);await this.bot.clickWindow(slot,0,0);await sleep(160)}
  }finally{if(this.bot.currentWindow)this.bot.closeWindow(this.bot.currentWindow)}
 }
 async upgrade(id,token){
  this.label='升级'+rules.team_upgrades.find(u=>u.id===id).label;const loc=this.teamConfig().upgrade_shop;
  await this.route(new Vec3(loc[0],65,loc[2]+2),token);this.bot.chat('/teamshop');
  const end=Date.now()+4000;while(!this.bot.currentWindow&&Date.now()<end){this.check(token);await sleep(50)}
  if(!this.bot.currentWindow)throw new Error('upgrade_shop_timeout');
  try{const icon=rules.team_upgrades.find(u=>u.id===id).icon.toLowerCase();const slot=this.bot.currentWindow.slots.findIndex((i,n)=>n<27&&i?.name===icon);if(slot<0)throw new Error('upgrade_missing');await this.bot.clickWindow(slot,0,0);await sleep(250)}finally{if(this.bot.currentWindow)this.bot.closeWindow(this.bot.currentWindow)}
 }
 async heal(token,enemy){
  this.label='撤退并治疗';this.usingItem=true;
  try{
   if(enemy){
    const away=this.bot.entity.position.minus(enemy.position);away.y=0;if(away.norm())away.scale(3/away.norm());
    const goal=this.bot.entity.position.plus(away),floor=this.bot.blockAt(goal.offset(0,-.1,0));
    if(floor?.boundingBox==='block')try{await this.walk(new Vec3(goal.x,65,goal.z),token,1800)}catch(e){this.check(token)}
   }
   this.check(token);await this.equip('golden_apple');this.check(token);await sleep(150);this.check(token);
   if(this.bot.heldItem?.name!=='golden_apple')throw new Error('apple_not_selected');
   await this.bot.consume();this.lastHeal=this.steps;
  }finally{if(token===this.token)this.usingItem=false;}
 }
 async shoot(enemy,token){
  this.label='弓箭压制';this.usingItem=true;
  try{await this.equip('bow');this.bot.activateItem();for(let i=0;i<11;i++){this.check(token);const seen=this.visibleEnemy();if(!seen||seen.position.distanceTo(this.bot.entity.position)<4.5)break;const distance=seen.position.distanceTo(this.bot.entity.position);await this.bot.lookAt(seen.position.offset(0,1.1+distance*distance*0.001,0),true);await sleep(100)}this.bot.deactivateItem();this.lastShot=this.steps;}finally{this.bot.deactivateItem();this.usingItem=false}
 }
 async defend(token){
  if(this.style==='fortify')return super.defend(token);
  this.label='轻量护床';const head=bedX(this.side),foot=footX(this.side);await this.walk(new Vec3((baseX(this.side)+(this.side)*-1)+.5,65,3.5),token);
  for(const p of [[head,65,1],[foot,65,1],[head+this.side,65,0],[head,65,-1],[foot,65,-1],[foot-this.side,65,0],[head,66,0],[foot,66,0]])await this.place(new Vec3(...p),'wool',token);
  this.defended=true;
 }
 async advance(token){this.label='进攻敌方基地';await this.route(new Vec3((baseX(-this.side)+(-this.side)*-5)+.5,65,2.5),token);}
 async assault(token){
  const enemySide=-this.side,head=bedX(enemySide),foot=footX(enemySide);
  const candidates=[[foot,65,0],[head,65,0],[foot,65,1],[head,65,1],[foot-enemySide,65,0],[foot,66,0],[head,66,0]];
  for(const xyz of candidates){
   this.check(token);const block=this.bot.blockAt(new Vec3(...xyz));if(!block||!['end_stone','oak_planks','red_wool','blue_wool','obsidian','red_bed','blue_bed','white_stained_glass'].includes(block.name)||!this.bot.canSeeBlock(block)||this.bot.entity.position.distanceTo(block.position.offset(.5,.5,.5))>4.4)continue;
   if(block.name==='obsidian'&&!this.item('diamond_pickaxe')){this.needDiamondPick=true;return;}
   this.label=block.name.endsWith('_bed')?'拆除敌方床':'破坏床防御';
   const tool=this.toolFor?this.toolFor(block):this.bot.pathfinder.bestHarvestTool(block);if(tool)await this.bot.equip(tool,'hand');await this.bot.dig(block,true);return;
  }
  const enemy=this.visibleEnemy();if(enemy)await this.walk(enemy.position.clone(),token,3000);else await this.walk(new Vec3(baseX(enemySide)+.5,65,2.5),token,4000);
 }
 async macro(token){
  const atBase=nearBase(this.bot.entity.position,this.side);
  const ownBed=getMatch().teams?.find(t=>t.name===this.ownTeam())?.bed;
  if(getMatch().classic?.stage==='sudden_death')return this.route(new Vec3(.5,65,2.5),token);
  if(this.needDiamondPick&&!this.item('diamond_pickaxe'))return this.buy('diamond_pickaxe',1,token);
  if(!this.defended&&ownBed&&atBase){const material=this.style==='fortify'?'end_stone':'wool';if(this.count(material)<8)return this.buy(material,this.style==='fortify'?12:64,token);return this.defend(token);}
  if(!this.item('stone_sword')&&!this.item('iron_sword')&&!this.item('diamond_sword'))return this.buy('stone_sword',1,token);
  if(!this.bestTool('pickaxe'))return this.buy('wooden_pickaxe',1,token);
  if(atBase&&this.style==='fortify'&&this.kitTier()<2)return this.buy('iron_armor',1,token);
  if(atBase&&this.style==='rush'&&this.kitTier()<1&&((getMatch().tick||0)>1800||!ownBed))return this.buy('chainmail_armor',1,token);
  if(atBase&&this.kitTier()<3&&this.count('emerald')>=6)return this.buy('diamond_armor',1,token);
  if(atBase&&!this.item('diamond_sword')&&this.count('emerald')>=4)return this.buy('diamond_sword',1,token);
  const desired=this.style==='fortify'?112:64;
  if(this.count('wool')<desired&&atBase)return this.buy('wool',Math.min(64,Math.ceil((desired-this.count('wool'))/16)*16),token);
  if(atBase&&this.count('gold_ingot')>=7&&!this.item('iron_sword')&&!this.item('diamond_sword'))return this.buy('iron_sword',1,token);
  if(atBase&&this.count('gold_ingot')>=3&&this.count('golden_apple')<2)return this.buy('golden_apple',1,token);
  const upgrades=this.ownUpgrades();
  if(atBase&&this.count('diamond')>=2&&!(upgrades.forge>=1))return this.upgrade('forge',token);
  if(atBase&&this.count('diamond')>=2&&!(upgrades.protection>=1))return this.upgrade('protection',token);
  if(atBase&&this.count('diamond')>=1&&!(upgrades.trap>=1))return this.upgrade('trap',token);
  if(atBase&&this.count('diamond')>=4&&!(upgrades.sharpness>=1))return this.upgrade('sharpness',token);
  if(atBase&&this.count('diamond')>=1&&!(upgrades.heal_pool>=1)&&this.bot.health<18)return this.upgrade('heal_pool',token);
  if(this.style==='fortify'&&!this.diamondTripDone&&ownBed){
   if(this.count('diamond')<6)return this.collect('diamond',6,token);
   this.diamondTripDone=true;return this.route(new Vec3(baseX(this.side)+.5,65,2.5),token);
  }
  if(atBase&&this.style==='fortify'&&!this.item('bow')&&this.count('gold_ingot')>=12)return this.buy('bow',1,token);
  if(atBase&&this.item('bow')&&this.count('arrow')<16&&this.count('gold_ingot')>=2)return this.buy('arrow',8,token);
  if(this.count('wool')<3&&-this.side*this.bot.entity.position.x<28)return this.buy('wool',64,token);
  if(-this.side*this.bot.entity.position.x>33)return this.assault(token);
  return this.advance(token);
 }
 failure(error){if(/interrupted|goal was changed|path was stopped|Digging aborted|consum.*interrupt/i.test(error.message))return;this.failUntil=Date.now()+500;super.failure(error);}
 async update(){
  if(this.ended||!this.bot.entity)return;this.steps++;
  const match=getMatch();
  if(!this.active()){
   if(this.busy||this.engaging)this.cancel();
   if(this.bot.game.gameMode==='survival'&&this.bot.entity.position.y>=100&&!this.bot.inventory.items().some(i=>i.name==='compass')&&Date.now()-this.lastQueue>10000){this.lastQueue=Date.now();this.bot.chat('/bw join SkyDuel')}
   return;
  }
  if(this.currentMatch!==match.match_id){this.cancel();this.currentMatch=match.match_id;this.side=match.players?.find(p=>p.name===this.name)?.team==='Red'?-1:1;this.defended=false;this.diamondTripDone=false;this.needDiamondPick=false;this.combatStart=0;this.hits=this.taken=0;this.actions.fill(0);this.onMatch?.();}
  if(!this.side||Date.now()<this.failUntil)return;
  const enemy=this.visibleEnemy();
  if(this.usingItem){
   // Bow/potion/cover use may be interrupted by a real approaching opponent.
   // Do not interrupt a nearly finished apple or the immediate TNT evacuation.
   const distance=enemy?.position.distanceTo(this.bot.entity.position)??Infinity;
   const self=match.players?.find(p=>p.name===this.name);
   if(distance<2.8&&this.intent!=='TNT打开床防'&&this.intent!=='避开已点燃的TNT'&&!(self?.use_action==='EAT'&&self.use_remaining_ticks<10))this.cancel();
   return;
  }
  const healThreshold=this.style==='fortify'?12:8;
  if(this.bot.health<=healThreshold&&this.item('golden_apple')&&this.steps-this.lastHeal>80){if(this.pendingTask){if(this.taskToken===this.token)this.cancel();return;}if(this.engaging)this.cancel();this.task(t=>this.heal(t,enemy));return;}
  if(this.tacticalUpdate?.(enemy))return;
  if(enemy){
   const distance=enemy.position.distanceTo(this.bot.entity.position);
   if(distance<3.15){if(this.pendingTask){if(this.taskToken===this.token)this.cancel();return;}await this.fight(enemy);return;}
   if(this.item('bow')&&this.count('arrow')&&distance>=6&&this.steps-this.lastShot>15){if(this.pendingTask){if(this.taskToken===this.token)this.cancel();return;}if(this.engaging)this.cancel();this.task(t=>this.shoot(enemy,t));return;}
   if(distance<(this.combatRange?this.combatRange(enemy):5.5)){
    if(this.pendingTask){if(this.taskToken===this.token)this.cancel();return;}this.label='接近交战';if(!this.engaging||(!this.bot.pathfinder.isMoving()&&this.steps%10===0)){this.engaging=true;this.bot.pathfinder.setGoal(new goals.GoalFollow(enemy,1.8),true)}return;
   }
  }
  if(this.engaging)this.cancel();this.combatStart=0;
  if(this.pendingTask)return;this.task(t=>this.macro(t));
 }
 status(){return {...super.status(),model_sha256:this.modelHash,controller_sha256:controllerHash,armor:this.bot.inventory.slots.slice(5,9).map(i=>i?.name||'empty'),upgrades:this.ownUpgrades()};}
}
const SkilledAgent=require('./bedwars-skills.cjs').extend(ClassicAgent,{rules,getMatch,logits});
function runDemo(){
const RuntimeBase=process.env.SKYDUEL_SKILLS==='classic'?ClassicAgent:SkilledAgent;
const AgentType=process.env.SKYDUEL_TACTICS==='classic'?ClassicAgent:require('./advanced-tactics.cjs').extend(RuntimeBase,{rules,getMatch});
const reportDir=path.join(root,'runs/showcase-selected');fs.mkdirSync(reportDir,{recursive:true});
const archived=path.join(reportDir,'controllers',controllerHash);fs.mkdirSync(archived,{recursive:true});
for(const source of Object.keys(controllerSources)){const dest=path.join(archived,source);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.copyFileSync(path.join(root,source),dest);}
const agents=run(AgentType,reportDir);
setInterval(()=>{const match=getMatch();if(match.phase!=='running'||manifested.has(match.match_id))return;manifested.add(match.match_id);const dir=path.join(reportDir,'manifests');fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,match.match_id+'.json'),JSON.stringify({match_id:match.match_id,rules_version:rules.version,controller_sha256:controllerHash,controller_sources:controllerSources,agents:agents.map(a=>({name:a.name,style:a.style,model_sha256:a.modelHash}))},null,2));},1000);

return agents;
}
module.exports={ClassicAgent,SkilledAgent,runDemo,getMatch,rules};
if(require.main===module)runDemo();
