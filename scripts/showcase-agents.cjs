// Reference agents: public macro plans plus independently fine-tuned neural melee.
// No remote model service. This is a playtest driver, not the AGX submission sandbox.
const fs=require('node:fs');
const path=require('node:path');
const net=require('node:net');
const mineflayer=require('./minecraft-client.cjs');
const {Vec3}=require('../bot-controller/node_modules/vec3');
const rules=require('../competition/rules.json');
const root=path.resolve(__dirname,'..');
const roster=JSON.parse(process.env.SKYDUEL_ROSTER||'[{"name":"EmberAI","model":"EmberAI","style":"rush","seed":101},{"name":"BastionAI","model":"BastionAI","style":"fortify","seed":202}]');
const arenaName=process.env.SKYDUEL_ARENA_NAME||'SkyDuel';
const expectedMatch=process.env.SKYDUEL_MATCH_ID||'';
const managed=Boolean(expectedMatch);
const modelFor=name=>roster.find(p=>p.name===name)?.model||name;
const output=path.resolve(root,process.env.SKYDUEL_MODEL_DIR||'models/showcase');
let match={phase:'waiting',players:[],teams:[]};
const {baseX,bedX,footX,feetY,nearBase,home,approach}=require('./arena-geometry.cjs').forMap(rules.map);
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
function connectReferee(){
 const socket=net.createConnection({host:'127.0.0.1',port:Number(process.env.SKYDUEL_OBSERVER_PORT||25600)});let buffer='';
 socket.on('data',data=>{buffer+=data;let i;while((i=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,i);buffer=buffer.slice(i+1);try{match=JSON.parse(line)}catch{}}});
 socket.on('error',()=>{});socket.on('close',()=>setTimeout(connectReferee,1000));
}
connectReferee();
function logits(model,features){
 let x=features;
 for(const layer of model.layers){
  if(layer.type==='linear')x=layer.weight.map((row,i)=>row.reduce((sum,w,j)=>sum+w*x[j],layer.bias[i]));
  else if(layer.type==='relu')x=x.map(v=>Math.max(0,v));
  else if(layer.type==='tanh')x=x.map(Math.tanh);
  else throw new Error('Unknown layer');
 }
 return x;
}
class Agent{
 constructor(name,style){
  this.name=name;this.style=style;this.model=JSON.parse(fs.readFileSync(path.join(output,modelFor(name)+'.json'),'utf8'));
  this.bot=mineflayer.createBot({host:'127.0.0.1',port:Number(process.env.BEDWARS_PORT||25567),username:name,auth:'offline',version:'1.21'});
  this.token=0;this.busy=false;this.currentMatch='';this.label='等待开局';this.side=0;this.steps=0;this.lastAttack=-100;this.lastHurt=-100;this.lastEnemyHurt=-100;this.lastEnemySwing=-100;this.hits=0;this.taken=0;this.actions=Array(11).fill(0);this.lastQueue=0;this.defended=false;this.lastError='';this.errors=0;
  this.randomSeed=roster.find(p=>p.name===name)?.seed||(style==='rush'?101:202);
  this.bot.on('forcedMove',()=>{this.cancel();if(this.bot.entity?.velocity)this.bot.entity.velocity.set(0,0,0)});
  this.bot.on('game',()=>{this.bot.physicsEnabled=this.bot.game.gameMode==='survival';if(this.bot.game.gameMode!=='survival')this.cancel()});
  this.bot.on('entityHurt',e=>{if(e===this.bot.entity){this.lastHurt=this.steps;this.taken++}else if(e.type==='player'){this.lastEnemyHurt=this.steps;this.hits++}});
  this.bot.on('entitySwingArm',e=>{if(e!==this.bot.entity&&e.type==='player')this.lastEnemySwing=this.steps});
  this.bot.on('death',()=>{this.cancel();this.label='等待复活'});
  this.bot.on('messagestr',text=>{if(/购买|摧毁|胜利|死了|退出游戏/.test(text))console.log(this.name,text)});
  this.bot.on('error',e=>console.error(this.name,e.message));
  this.bot.on('end',r=>{console.log(this.name,'disconnected',r);this.ended=true});
  this.timer=setInterval(()=>this.update().catch(e=>this.failure(e)),100);
 }
 cancel(){this.token++;this.bot.clearControlStates();if(this.bot.targetDigBlock)this.bot.stopDigging();}
 joinArena(){if(!managed||!this.currentMatch)this.bot.chat('/bw join '+arenaName);}
 active(){return (!managed||match.match_id===expectedMatch)&&!this.ended&&this.bot.entity&&match.phase==='running'&&this.bot.game.gameMode==='survival'&&this.bot.entity.position.y>60&&this.bot.health>0;}
 check(token){if(token!==this.token||!this.active())throw new Error('interrupted');}
 count(id){return this.bot.inventory.items().filter(i=>id==='wool'?i.name.endsWith('_wool'):i.name===id).reduce((n,i)=>n+i.count,0)}
 item(id){return this.bot.inventory.items().find(i=>id==='wool'?i.name.endsWith('_wool'):i.name===id)}
 async equip(id){const item=this.item(id);if(item&&this.bot.heldItem?.type!==item.type)await this.bot.equip(item,'hand');}
 teamConfig(){return rules.map.teams[this.side<0?'Red':'Blue'];}
 visibleEnemy(){
  if(!this.bot.entity)return null;
  return this.bot.nearestEntity(e=>{
   if(e.type!=='player'||e.username===this.name||!roster.some(p=>p.name===e.username))return false;
   if(e.position.distanceTo(this.bot.entity.position)>6)return false;
   const own=match.players.find(p=>p.name===this.name),opp=match.players.find(p=>p.name===e.username);
   if(!own||!opp||own.team===opp.team||opp.mode!=='SURVIVAL')return false;
   const eye=this.bot.entity.position.offset(0,1.62,0),delta=e.position.offset(0,1.2,0).minus(eye),length=delta.norm();
   return length>0&&!this.bot.world.raycast(eye,delta.scaled(1/length),length);
  });
 }
 features(enemy){
  const me=this.bot.entity,rel=enemy.position.minus(me.position),vel=me.velocity||new Vec3(0,0,0),ov=enemy.velocity||new Vec3(0,0,0);
  const yaw=Math.PI-me.yaw,pitch=-me.pitch,oyaw=Math.PI-(enemy.yaw||0),elapsed=Math.min(1,(match.tick||0)/12000);
  return [this.bot.health/20,1,rel.x/20,rel.y/10,rel.z/20,vel.x,vel.y,vel.z,ov.x,ov.y,ov.z,Math.sin(yaw),Math.cos(yaw),Math.sin(pitch),Math.cos(pitch),Math.sin(oyaw),Math.cos(oyaw),Math.min(rel.norm()/20,1),1,Math.min(1,(this.steps-this.lastAttack)/6.25),Math.min(1,(this.steps-this.lastEnemySwing)/6.25),Math.max(0,1-(this.steps-this.lastHurt)/5),Math.max(0,1-(this.steps-this.lastEnemyHurt)/5),me.onGround?1:0,enemy.onGround?1:0,elapsed,Math.min(this.hits/6,1),Math.min(this.taken/6,1),0,0,1-elapsed];
 }
 async fight(enemy){
  if(this.busy)this.cancel();
  this.label='模型控制近战';
  await this.equip(this.bestSword?this.bestSword():this.item('iron_sword')?'iron_sword':this.item('stone_sword')?'stone_sword':'wooden_sword');
  const values=logits(this.model,this.features(enemy)),max=Math.max(...values),weights=values.map(v=>Math.exp((v-max)/0.6));
  this.randomSeed=(Math.imul(1664525,this.randomSeed)+1013904223)>>>0;
  let pick=(this.randomSeed/4294967296)*weights.reduce((a,b)=>a+b,0),action=0;
  for(;action<weights.length-1&&pick>weights[action];action++)pick-=weights[action];
  this.actions[action]++;
  this.bot.clearControlStates();
  await this.bot.lookAt(enemy.position.offset(0,1.2,0),true);
  const controls={forward:[2,3,5,6,9].includes(action),back:action===10,left:action===7,right:action===8,sprint:[3,6,9].includes(action),jump:action===9};
  const dir=enemy.position.minus(this.bot.entity.position);dir.y=0;const n=dir.norm();if(n)dir.scale(1/n);
  let dx=0,dz=0;if(controls.forward){dx+=dir.x;dz+=dir.z}if(controls.back){dx-=dir.x;dz-=dir.z}if(controls.left){dx+=dir.z;dz-=dir.x}if(controls.right){dx-=dir.z;dz+=dir.x}
  const support=this.bot.blockAt(this.bot.entity.position.offset(dx*1.2,-0.5,dz*1.2));
  const p=this.bot.entity.position;
  if([[-1,0],[1,0],[0,-1],[0,1]].some(([x,z])=>this.bot.blockAt(p.offset(x,-.5,z))?.boundingBox!=='block')){controls.sprint=false;controls.jump=false;}
  // Shared edge guard for both demonstration agents; knockback still follows the server.
  if(!support||support.boundingBox!=='block'){controls.forward=controls.back=controls.left=controls.right=controls.jump=false;controls.sneak=true;}
  for(const [key,value]of Object.entries(controls))this.bot.setControlState(key,value);
  const ready=this.attackReady?this.attackReady():this.steps-this.lastAttack>=6;
  if([4,5,6,7,8,9,10].includes(action)&&enemy.position.distanceTo(this.bot.entity.position)<2.9&&ready){this.bot.attack(enemy);this.lastAttack=this.steps;}
 }
 async walk(target,token,timeout=18000){
  const until=Date.now()+timeout;
  try{while(this.bot.entity.position.distanceTo(target)>0.45){
   this.check(token);if(Date.now()>until)throw new Error('walk_timeout');
   await this.bot.lookAt(target.offset(0,1.4,0),true);this.bot.setControlState('forward',true);await sleep(50);
  }}finally{this.bot.clearControlStates()}
 }
 async place(position,item,token){
  this.check(token);const current=this.bot.blockAt(position);
  if(current&&current.boundingBox==='block')return;
  if(!this.item(item))throw new Error('no_blocks');
  await this.equip(item);
  const offsets=[new Vec3(0,-1,0),new Vec3(-1,0,0),new Vec3(1,0,0),new Vec3(0,0,-1),new Vec3(0,0,1)];
  for(const off of offsets){
   const reference=this.bot.blockAt(position.plus(off));
   if(!reference||reference.boundingBox!=='block')continue;
   this.bot.setControlState('sneak',true);await sleep(100);this.check(token);
   try{await this.bot.placeBlock(reference,off.scaled(-1));await sleep(100);return}
   catch(e){if(this.bot.blockAt(position)?.boundingBox==='block')return;this.lastError=e.message}
   finally{this.bot.setControlState('sneak',false)}
  }
  throw new Error('place_failed');
 }
 async buy(id,quantity,token){
  const entry=rules.shop.find(i=>i.id===id),cost=entry.price*quantity/entry.amount;
  const currency={iron:'iron_ingot',gold:'gold_ingot',diamond:'diamond',emerald:'emerald'}[entry.currency];
  if(this.count(currency)<cost){
   this.label='收集基地资源';
   const spawn=rules.map.spawners.find(s=>s.team===(this.side<0?'Red':'Blue')&&s.resource===entry.currency);
   if(!spawn)throw new Error('resource_not_at_base');
   await this.walk(new Vec3(spawn.position[0],65,spawn.position[2]),token);
   const end=Date.now()+5000;while(this.count(currency)<cost&&Date.now()<end){this.check(token);await sleep(150)}return;
  }
  this.label='购买'+entry.label;
  const loc=this.teamConfig().shop;await this.walk(new Vec3(loc[0],65,loc[2]+2),token);
  const merchant=this.bot.nearestEntity(e=>e.name==='villager'&&e.position.distanceTo(this.bot.entity.position)<4);
  if(!merchant)throw new Error('shop_missing');
  await this.bot.lookAt(merchant.position.offset(0,1.4,0),true);await this.bot.activateEntity(merchant);
  const deadline=Date.now()+5000;while(!this.bot.currentWindow&&Date.now()<deadline){this.check(token);await sleep(50)}
  if(!this.bot.currentWindow)throw new Error('shop_window_timeout');
  try{
   const slot=this.bot.currentWindow.slots.findIndex(i=>i&&(id==='wool'?i.name.endsWith('_wool'):i.name===entry.material));
   if(slot<0)throw new Error('shop_item_missing');
   for(let i=0;i<quantity/entry.amount;i++){this.check(token);await this.bot.clickWindow(slot,0,0);await sleep(120)}
  }finally{if(this.bot.currentWindow)this.bot.closeWindow(this.bot.currentWindow)}
 }
 async defend(token){
  this.label='加固床防御';const head=bedX(this.side),foot=footX(this.side);
  await this.walk(new Vec3((baseX(this.side)+(this.side)*-1)+0.5,65,3.5),token);
  const places=[[head,65,1],[foot,65,1],[head+this.side,65,0],[head,65,-1],[foot,65,-1],[foot-this.side,65,0],[head,66,0],[foot,66,0]];
  for(const [x,y,z]of places){
   this.check(token);if(this.bot.blockAt(new Vec3(x,y,z))?.name==='end_stone')continue;
   if(!this.item('end_stone'))break;
   if(this.bot.entity.position.distanceTo(new Vec3(x+0.5,y+0.5,z+0.5))>4)await this.walk(new Vec3(foot+0.5,65,3.5),token);
   await this.place(new Vec3(x,y,z),'end_stone',token);
  }
  this.defended=true;
 }
 async advance(token){
  this.label='搭路进攻';
  // Both plans use the same published straight bridge primitive at z=2.
  const p=this.bot.entity.position;
  await this.walk(new Vec3(p.x,65,2.5),token);
  const direction=-this.side,target=(baseX(-this.side)+(-this.side)*-5);
  while(direction*(target-Math.floor(this.bot.entity.position.x))>0){
   this.check(token);const currentX=Math.floor(this.bot.entity.position.x),nextX=currentX+direction;
   const next=new Vec3(nextX,64,2);
   if(this.bot.blockAt(next)?.boundingBox!=='block')await this.place(next,'wool',token);
   await this.walk(new Vec3(nextX+0.5,65,2.5),token,5000);
  }
 }
 async assault(token){
  const enemySide=-this.side,head=bedX(enemySide),foot=footX(enemySide);
  this.label='拆除敌方床';
  const targets=[[foot,65,0],[head,65,0],[foot,65,1],[head,65,1],[foot-enemySide,65,0],[foot,66,0],[head,66,0]];
  for(const [x,y,z]of targets){
   this.check(token);const block=this.bot.blockAt(new Vec3(x,y,z));
   if(!block||!['end_stone','oak_planks','red_wool','blue_wool','obsidian','red_bed','blue_bed'].includes(block.name))continue;
   if(!this.bot.canSeeBlock(block)||this.bot.entity.position.distanceTo(block.position.offset(0.5,0.5,0.5))>4.4)continue;
   await this.equip(block.name==='end_stone'||block.name==='obsidian'?'wooden_pickaxe':'wooden_sword');
   await this.bot.dig(block,true);await sleep(150);return;
  }
  // Once the bed is gone, approach the last visible enemy through the base.
  const enemy=this.visibleEnemy();
  if(enemy)await this.walk(enemy.position.clone(),token,3000);
  else await this.walk(new Vec3(baseX(enemySide)+0.5,65,2.5),token,3000);
 }
 async macro(token){
  const hasSword=this.count('stone_sword')||this.count('iron_sword');
  if(this.style==='fortify'&&!this.defended){if(this.count('end_stone')<8)return this.buy('end_stone',12,token);return this.defend(token)}
  if(!hasSword)return this.buy('stone_sword',1,token);
  if(!this.count('wooden_pickaxe'))return this.buy('wooden_pickaxe',1,token);
  const enemyBase=-this.side*this.bot.entity.position.x>33;
  if(!enemyBase&&this.count('wool')<4)return this.buy('wool',64,token);
  if(!enemyBase)return this.advance(token);
  return this.assault(token);
 }
 async update(){
  if(this.ended||!this.bot.entity)return;
  this.steps++;
  if(!this.active()){
   if(this.busy)this.cancel();
   if(this.bot.game.gameMode==='survival'&&this.bot.entity.position.y>=100&&!this.bot.inventory.items().some(i=>i.name==='compass')&&Date.now()-this.lastQueue>10000){this.lastQueue=Date.now();this.joinArena()}
   return;
  }
  if(this.currentMatch!==match.match_id){this.cancel();this.currentMatch=match.match_id;this.side=Math.sign(this.bot.entity.position.x);this.defended=false;this.hits=this.taken=0;this.actions.fill(0);}
  if(!this.side)return;
  const enemy=this.visibleEnemy();
  if(enemy&&enemy.position.distanceTo(this.bot.entity.position)<4.3){await this.fight(enemy);return}
  if(this.busy)return;
  this.busy=true;const token=this.token;
  this.macro(token).catch(e=>this.failure(e)).finally(()=>{this.busy=false;if(token===this.token)this.bot.clearControlStates()});
 }
 failure(error){if(error.message==='interrupted')return;this.errors++;this.lastError=error.message;this.label='重新规划';console.error(this.name,error.message);this.bot.clearControlStates()}
 status(){return {name:this.name,style:this.style,label:this.label,health:this.bot.health,position:this.bot.entity?.position,inventory:this.bot.inventory.items().map(i=>({name:i.name,count:i.count})),actions:this.actions,last_error:this.lastError,errors:this.errors,match_id:this.currentMatch}}
}
function run(AgentType=Agent, reportDir=output) {
const agents=roster.map(p=>new AgentType(p.name,p.style));
for(const agent of agents)clearInterval(agent.timer);
let sequence=0;
const decisions=setInterval(()=>{const offset=sequence++%agents.length;for(let i=0;i<agents.length;i++){const agent=agents[(offset+i)%agents.length];if(agent.updating)continue;agent.updating=true;agent.update().catch(e=>agent.failure(e)).finally(()=>agent.updating=false);}},100);
const reports=setInterval(()=>{
 const data={updated_at:new Date().toISOString(),method:'trained_melee_with_public_macro_plans',agents:agents.map(a=>a.status())};
 for(const file of managed?[path.join(reportDir,'live.json')]:[path.join(reportDir,'live.json'),path.join(root,'runs/showcase-live.json')]){const temp=file+'.tmp';fs.writeFileSync(temp,JSON.stringify(data));fs.renameSync(temp,file);}
},2000);
function stop(){clearInterval(decisions);clearInterval(reports);for(const a of agents){a.cancel();a.bot.quit()}setTimeout(()=>process.exit(),500)}
if(managed){let started=false;const life=setInterval(()=>{if(match.match_id===expectedMatch&&match.phase==='running')started=true;if(started&&!['running','game_end_celebrating'].includes(match.phase)){clearInterval(life);stop()}},500);setTimeout(stop,Number(process.env.SKYDUEL_MAX_RUNTIME_MS||2400000)).unref();}
process.on('message',message=>{if(message==='stop')stop()});
process.on('SIGTERM',stop);
process.on('SIGINT',()=>{clearInterval(decisions);clearInterval(reports);for(const a of agents)a.bot.quit();setTimeout(()=>process.exit(),500)});
return agents;
}
module.exports={Agent,run,getMatch:()=>match,rules,root,logits,roster,modelFor};
if(require.main===module)run();
