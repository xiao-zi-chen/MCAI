// Ground-aware movement and combat execution for the public demonstration agents.
// The learned policy suggests footwork. Reach, cooldown and safe footing are enforced here.
const {Vec3}=require('../bot-controller/node_modules/vec3');
const {defenseBoxes,navigationPenalty}=require('./bedwars-navigation.cjs');
const {waypoints}=require('./arena-geometry.cjs');
const {threatPenalty}=require('./strategy-planner.cjs');
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));

class Heap {
 constructor(){this.a=[];}
 push(v){let i=this.a.length;this.a.push(v);while(i){const p=(i-1)>>1;if(this.a[p].f<=v.f)break;this.a[i]=this.a[p];i=p;}this.a[i]=v;}
 pop(){const first=this.a[0],v=this.a.pop();if(this.a.length){let i=0;while(i*2+1<this.a.length){let c=i*2+1;if(c+1<this.a.length&&this.a[c+1].f<this.a[c].f)c++;if(this.a[c].f>=v.f)break;this.a[i]=this.a[c];i=c;}this.a[i]=v;}return first;}
}

function planRoute({start,goal,cell,bounds,buildCost=9,maxNodes=10000,penalty=()=>0}){
 const source={x:Math.floor(start.x),z:Math.floor(start.z)},target={x:Math.floor(goal.x),z:Math.floor(goal.z)};
 const key=p=>p.x+','+p.z,h=p=>Math.abs(p.x-target.x)+Math.abs(p.z-target.z);
 const open=new Heap(),costs=new Map([[key(source),0]]),parents=new Map(),nodes=new Map([[key(source),source]]);
 open.push({...source,g:0,f:h(source)});let expanded=0;
 while(open.a.length&&expanded++<maxNodes){
  const p=open.pop(),pk=key(p);if(p.g!==costs.get(pk))continue;
  if(p.x===target.x&&p.z===target.z){const route=[];let k=pk;while(k){route.push(nodes.get(k));k=parents.get(k);}return route.reverse().map(p=>({...p,build:!cell(p.x,p.z).floor}));}
  for(const [dx,dz]of [[-1,0],[1,0],[0,-1],[0,1]]){
   const q={x:p.x+dx,z:p.z+dz};if(q.x<bounds.minX||q.x>bounds.maxX||q.z<bounds.minZ||q.z>bounds.maxZ)continue;
   const c=cell(q.x,q.z);if(!c?.known||!c.clear)continue;
   const g=p.g+(c.floor?1:buildCost)+penalty(q),qk=key(q);if(g>=(costs.get(qk)??Infinity))continue;
   costs.set(qk,g);parents.set(qk,pk);nodes.set(qk,q);open.push({...q,g,f:g+h(q)});
  }
 }
 return null;
}

function meleeChoice({distance,style,ready,safe,logits=[],strafe=1}){
 const result={forward:false,back:false,left:false,right:false,sprint:false,jump:false,sneak:false,attack:ready&&distance<=2.9};
 if(distance>2.65){result.forward=safe.forward;result.sprint=safe.wide&&distance>3.2;}
 else if(distance<1.65){result.back=safe.back;}
 else if(safe.wide){
  // Keep a stable strafe direction between decisions; no per-tick random stop/jump.
  const preferred=logits[7]>logits[8]+.2?-1:logits[8]>logits[7]+.2?1:strafe;
  result.left=preferred<0&&safe.left;result.right=preferred>0&&safe.right;
  if(!result.left&&!result.right){result.left=safe.left;result.right=!result.left&&safe.right;}
  if(style==='fortify'&&!ready&&distance<2.2)result.back=safe.back;
 }
 if(!safe.wide&&!result.forward&&!result.back&&!result.left&&!result.right)result.sneak=true;
 return result;
}

function closestHitPoint(eye,position,height=1.8){return new Vec3(Math.max(position.x-.3,Math.min(position.x+.3,eye.x)),Math.max(position.y,Math.min(position.y+height,eye.y)),Math.max(position.z-.3,Math.min(position.z+.3,eye.z)));}
function bowAim(eye,position,velocity=new Vec3(0,0,0)){
 const drag=.99,gravity=.05,speed=3;
 const required=t=>{const sum=(1-Math.pow(drag,t))/(1-drag),drop=gravity*(t-sum)/(1-drag),target=position.plus(velocity.scaled(t));return target.minus(eye).offset(0,drop,0).scaled(1/sum)};
 let low=.1,high=24;for(let i=0;i<24;i++){const t=(low+high)/2;if(required(t).norm()>speed)low=t;else high=t;}
 return eye.plus(required(high).scaled(8));
}

function extend(Base,{rules,getMatch,logits}){
 return class SkilledAgent extends Base {
  constructor(...args){
   super(...args);this.edgeGuardActive=false;
   this.bot.on('soundEffectHeard',(name,position)=>{
    if(!this.active()||!this.side||!/^block\..*\.(break|hit)$/.test(name))return;
    if(position.distanceTo(this.bot.entity.position)<=16&&position.distanceTo(new Vec3(...this.teamConfig().bed))<=4)this.bedSound={position:position.clone(),tick:getMatch().tick};
   });
   this.bot.on('spawn',()=>{this.bot.pathfinder.movements.allowParkour=false;});
   this.bot.on('physicsTick',()=>{
    if(!this.active()||!this.bot.entity.onGround)return;
    const p=this.bot.entity.position,v=this.bot.entity.velocity;if(!v||Math.hypot(v.x,v.z)<.025)return;
    const safe=[.5,1].every(t=>[-.22,.22].every(x=>[-.22,.22].every(z=>this.bot.blockAt(p.offset(v.x*4*t+x,-.2,v.z*4*t+z))?.boundingBox==='block')));
    if(!safe){this.bot.setControlState('sneak',true);this.bot.setControlState('sprint',false);this.bot.setControlState('jump',false);this.edgeGuardActive=true;}
    else if(this.edgeGuardActive&&!this.placing){this.bot.setControlState('sneak',false);this.edgeGuardActive=false;}
   });
  }
  async place(position,item,token){this.placing=true;try{return await super.place(position,item,token);}finally{this.placing=false;}}
  visibleEnemy(range=16){
   const enemy=super.visibleEnemy(range);if(enemy){const now=getMatch().tick,old=this.lastSeenEnemy;let velocity=old?.velocity||new Vec3(0,0,0);
    if(old&&now>old.tick){velocity=enemy.position.minus(old.position).scaled(1/(now-old.tick));velocity.y=0;if(velocity.norm()>.5)velocity=new Vec3(0,0,0);}
    if(!old||now>old.tick)this.lastSeenEnemy={position:enemy.position.clone(),tick:now,velocity};
   }return enemy;
  }
  toolFor(block){
   const kind=/wool/.test(block.name)?'shears':/planks|log|wood|_bed$/.test(block.name)?this.bestTool('axe'):this.bestTool('pickaxe');
   return this.item(kind)||this.item(this.bestSword());
  }
  async route(target,token){
   const legs=waypoints(rules.map,this.bot.entity.position,target);
   for(const leg of legs){
    for(let attempt=0;attempt<3;attempt++){
     try{await this.routeLeg(leg,token);break;}
     catch(e){this.check(token);if(attempt===2||!/path|timeout|stuck|place_failed/i.test(e.message))throw e;
      this.note?.('重新规划通路','当前通路受阻，短暂避开障碍并从实际站位重算');this.tally?.('replan');
      const q=this.routeNext;if(q){this.routeAvoid??=new Map();this.routeAvoid.set(Math.floor(q.x)+','+Math.floor(q.z),getMatch().tick+160);}
     }
    }
   }
  }
  async routeLeg(target,token){
   this.check(token);const y=rules.map.surface_y,origin=this.bot.entity.position.clone();
   if(Math.abs(origin.y-y-1)>.65||Math.abs(target.y-y-1)>.1)return this.walk(target,token,16000);
   const cache=new Map(),get=(x,z)=>{
    const k=x+','+z;if(cache.has(k))return cache.get(k);
    const floor=this.bot.blockAt(new Vec3(x,y,z)),low=this.bot.blockAt(new Vec3(x,y+1,z)),high=this.bot.blockAt(new Vec3(x,y+2,z));
    const value={known:!!floor&&!!low&&!!high,floor:floor?.boundingBox==='block',clear:low?.boundingBox==='empty'&&high?.boundingBox==='empty'&&!['lava','water'].includes(low?.name)};cache.set(k,value);return value;
   };
   const boxes=defenseBoxes(rules.map),[lo,hi]=[rules.map.build_min,rules.map.build_max];
   const tick=getMatch().tick,seen=this.lastSeenEnemy;
   const risk={enemy:seen?.position,seenAt:seen?.tick,now:tick,health:this.bot.health,bedAlive:this.ownBed?.()??true,valuable:this.count('diamond')>=4||this.count('emerald')>=4};
   const route=planRoute({start:origin,goal:target,cell:get,bounds:{minX:lo[0],maxX:hi[0],minZ:lo[2],maxZ:hi[2]},penalty:p=>navigationPenalty(p,target,origin,boxes)+threatPenalty(p,risk)+((this.routeAvoid?.get(p.x+','+p.z)||0)>tick?40:0)});
   if(!route)return this.walk(target,token,6000);
   const missing=route.filter(p=>p.build).length;
   if(missing>this.count('wool'))throw new Error('route_needs_blocks');
   if(!missing&&!this.usingItem)await this.equip(this.bestSword());
   this.routeStats={nodes:route.length,needed_blocks:missing,placed:0};
   let i=1;
   while(i<route.length){
    this.check(token);const p=route[i],floor=new Vec3(p.x,y,p.z),exists=this.bot.blockAt(floor)?.boundingBox==='block';
    this.routeNext=p;
    if(!exists){
     this.label='沿缺口搭桥';this.note?.('跨越通路缺口','只补缺失方块，连通后连续行走');
     const movement=this.bot.pathfinder.movements,parkour=movement.allowParkour,sprint=movement.allowSprinting;
     movement.allowParkour=false;movement.allowSprinting=false;
     try{await this.place(floor,'wool',token);this.routeStats.placed++;await this.walk(floor.offset(.5,1,.5),token,3500);}
     finally{movement.allowParkour=parkour;movement.allowSprinting=sprint;}
     i++;continue;
    }
    // Walk complete grounded sections in one path request, instead of stopping at every block.
    let end=i;const dx=p.x-route[i-1].x,dz=p.z-route[i-1].z;
    while(end+1<route.length&&end-i<15&&route[end+1].x-route[end].x===dx&&route[end+1].z-route[end].z===dz&&this.bot.blockAt(new Vec3(route[end+1].x,y,route[end+1].z))?.boundingBox==='block')end++;
    const dest=route[end],movement=this.bot.pathfinder.movements,oldSprint=movement.allowSprinting;
    const narrow=route.slice(i,end+1).some(p=>[[-1,0],[1,0],[0,-1],[0,1]].some(([dx,dz])=>!get(p.x+dx,p.z+dz).floor));
    if(narrow)movement.allowSprinting=false;
    try{await this.walk(new Vec3(dest.x+.5,y+1,dest.z+.5),token,16000);}finally{movement.allowSprinting=oldSprint;}
    i=end+1;
   }
   if(this.bot.entity.position.distanceTo(target)>.9)await this.walk(target,token,4000);
  }
  async bridgeTo(target,token){return this.route(target,token);}
  async fight(enemy){
   if(this.bot.pathfinder.goal||this.bot.pathfinder.isMoving())this.bot.pathfinder.setGoal(null);
   this.engaging=false;if(!this.combatStart)this.combatStart=this.steps;
   const desired=this.bestSword(),weapon=this.combatWeapon&&this.item(this.combatWeapon)&&this.steps-(this.weaponChangedAt||0)<12?this.combatWeapon:desired,changed=this.bot.heldItem?.name!==weapon;
   if(changed){await this.equip(weapon);this.lastAttack=this.steps;this.combatWeapon=weapon;this.weaponChangedAt=this.steps;}
   const p=this.bot.entity.position,delta=enemy.position.minus(p);delta.y=0;
   const distance=delta.norm(),direction=distance?delta.scaled(1/distance):new Vec3(0,0,1);
   const left=new Vec3(direction.z,0,-direction.x);
   const safeDirection=d=>[.4,.8,1.15].every(n=>{
    const q=p.plus(d.scaled(n));
    const floor=this.bot.blockAt(q.offset(0,-.35,0)),body=this.bot.blockAt(q.offset(0,.25,0));
    return floor?.boundingBox==='block'&&body?.boundingBox==='empty';
   });
   const safe={forward:safeDirection(direction),back:safeDirection(direction.scaled(-1)),left:safeDirection(left),right:safeDirection(left.scaled(-1))};
   safe.wide=safe.forward&&safe.back&&safe.left&&safe.right;
   const values=logits(this.model,this.features(enemy));
   const ready=!changed&&this.attackReady(),choice=meleeChoice({distance,style:this.style,ready,safe,logits:values,strafe:Math.floor((this.steps-this.combatStart)/9)%2?1:-1});
   const eye=this.bot.entity.position.offset(0,this.bot.entity.eyeHeight||1.62,0),appearance=getMatch().players?.find(p=>p.name===enemy.username),hit=closestHitPoint(eye,enemy.position,appearance?.sneaking?1.5:1.8);
   const aim=hit.distanceTo(eye)<.1?enemy.position.offset(0,1.15,0):hit;await this.bot.lookAt(aim,false);
   for(const [name,on]of Object.entries(choice))if(name!=='attack')this.bot.setControlState(name,on);
   const ray=aim.minus(eye),length=ray.norm();
   if(ready&&hit.distanceTo(eye)<=2.95&&length>0&&!this.bot.world.raycast(eye,ray.scaled(1/length),length)){
    this.bot.attack(enemy);this.lastAttack=this.steps;this.actions[choice.left?7:choice.right?8:choice.forward?5:4]++;
   }
   this.label=this.invader?.(enemy)?'拦截拆床者':this.style==='rush'?'压近并侧移攻击':'保持距离反击';
   this.note?.(this.label,'按实际距离和攻击冷却出手，边缘禁止危险横移');
  }
  async shoot(enemy,token){
   this.usingItem=true;this.note?.('蓄力并预判箭路','根据可见移动提前量和箭的下坠修正瞄准');
   try{
    await this.equip('bow');this.check(token);this.bot.activateItem();const started=Date.now();
    while(Date.now()-started<2400){
     this.check(token);const seen=this.visibleEnemy();
     if(!seen||seen.position.distanceTo(this.bot.entity.position)<3.5){await this.equip(this.bestSword());return;}
     const eye=this.bot.entity.position.offset(0,this.bot.entity.eyeHeight||1.62,0),aim=bowAim(eye,seen.position.offset(0,1.1,0),this.lastSeenEnemy?.velocity);
     await this.bot.lookAt(aim,false);
     const self=getMatch().players?.find(p=>p.name===this.name);
     if(self?.use_ticks!=null?self.use_ticks>=20:Date.now()-started>=1150)break;
     await sleep(50);
    }
    this.bot.deactivateItem();this.lastShot=this.steps;
   }finally{this.bot.deactivateItem();if(token===this.token)this.usingItem=false;}
  }
  async update(){
   if(this.active()&&!this.pendingTask&&!this.usingItem){const enemy=this.visibleEnemy(7);if(enemy&&!this.bot.heldItem?.name.endsWith('_sword')&&this.bot.heldItem?.name!=='stick'){await this.equip(this.bestSword());this.lastAttack=this.steps;}}
   return super.update();
  }
  status(){return {...super.status(),route:this.routeStats||null,melee_controller:'trained_footwork_with_reach_cooldown_and_terrain_guards'};}
 };
}
module.exports={planRoute,meleeChoice,closestHitPoint,bowAim,extend};
