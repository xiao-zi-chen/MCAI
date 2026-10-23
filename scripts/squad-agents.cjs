const {Vec3}=require('../bot-controller/node_modules/vec3');
const {waypoints,boundedLegs}=require('./arena-geometry.cjs');
const {defenseCells,chooseTarget,roleFor,bridgeSteps}=require('./squad-planner.cjs');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
function extend(Base,{rules,getMatch,roster}){
 const bridgeOwners=new Map(),teamPlans=new Map();
 return class SquadAgent extends Base{
  constructor(name,style){super(name,style);this.member=roster.find(p=>p.name===name);this.profile=this.model?.profile||{};this.bridgeWidth=this.profile.bridge_width||3;this.routeNodeBudget=4500;this.bot.once('spawn',()=>{this.bot.pathfinder.tickTimeout=3;this.bot.pathfinder.searchRadius=72;this.bot.pathfinder.thinkTimeout=650;});}
  ownTeam(){return this.member?.team||roster.find(p=>p.name===this.name)?.team;}
  role(){return roleFor((getMatch().players||[]).map(p=>({...p,slot:roster.find(e=>e.name===p.name)?.slot})),this.name,getMatch().teams?.find(t=>t.name===this.ownTeam())?.bed!==false);}
  targetTeam(){
   const match=getMatch(),own=this.ownTeam(),enemies=(match.teams||[]).filter(t=>t.name!==own&&t.alive),prior=teamPlans.get(own),candidate=enemies.find(t=>t.name===prior?.target);
   if(prior&&prior.match===match.match_id&&prior.until>(match.tick||0)&&candidate&&(candidate.bed||!enemies.some(t=>t.bed)))return prior.target;
   const allies=(match.players||[]).filter(p=>p.team===own&&p.mode==='SURVIVAL'&&p.pos),front=allies.filter(p=>(roster.find(r=>r.name===p.name)?.slot??0)>=2),group=front.length?front:allies;
   const position=group.length?{x:group.reduce((s,p)=>s+p.pos[0],0)/group.length,z:group.reduce((s,p)=>s+p.pos[2],0)/group.length}:undefined;
   const target=chooseTarget(rules.map,match.teams||[],own,position);teamPlans.set(own,{match:match.match_id,until:(match.tick||0)+200,target});return target;
  }
  coveredByAlly(enemy){return enemy&&this.bot.health>=10&&(getMatch().players||[]).some(p=>p.name!==this.name&&p.team===this.ownTeam()&&p.mode==='SURVIVAL'&&p.hp>8&&p.pos&&new Vec3(...p.pos).distanceTo(enemy.position)<4.5);}
  exposedBed(target=this.targetTeam()){
   const team=rules.map.teams[target];if(!team)return null;
   const eye=this.bot.entity.position.offset(0,this.bot.entity.eyeHeight||1.62,0);
   return [team.bed,team.bed_foot].map(p=>this.bot.blockAt(new Vec3(...p))).find(b=>b?.name?.endsWith('_bed')&&eye.distanceTo(b.position.offset(.5,.5,.5))<=4.4&&this.bot.canSeeBlock(b));
  }
  breachHealthFloor(){return this.breachBlock?.endsWith('_bed')?4:8;}
  canContinueUtility(enemy){return this.breaching&&(this.coveredByAlly(enemy)||this.breachBlock?.endsWith('_bed')&&this.bot.health>4);}
  combatRange(enemy){const bed=getMatch().teams?.find(t=>t.name===this.ownTeam())?.bed;if(this.role()==='attacker'&&this.near(this.targetTeam())&&this.coveredByAlly(enemy))return 0;return bed&&this.near(this.ownTeam())&&enemy.position.distanceTo(new Vec3(...this.teamConfig().bed))<(this.profile.guard_radius||23)?16:!bed?12:(this.profile.combat_radius||8);}
  tacticalUpdate(enemy){
   if(this.retreating)return true;
   const bed=getMatch().teams?.find(t=>t.name===this.ownTeam())?.bed,p=this.bot.entity.position;
   const target=this.targetTeam(),targetBed=getMatch().teams?.find(t=>t.name===target)?.bed;
   const role=this.role(),distance=enemy?.position.distanceTo(p)??Infinity;
   const exposed=targetBed&&this.near(target)&&this.exposedBed(target);
   if(['attacker','support'].includes(role)&&targetBed&&this.near(target)&&(exposed&&(distance>2.6||this.coveredByAlly(enemy))||role==='attacker'&&(distance>5||this.coveredByAlly(enemy)))){
    if(this.pendingTask){if(this.taskToken===this.token)this.cancel();return true;}
    this.task(async t=>{this.breaching=true;this.usingItem=true;this.intent='协同破床';try{await this.assault(t);}finally{this.breaching=false;this.breachBlock=null;this.usingItem=false;this.intent='';}});return true;
   }
   if(!bed&&this.bot.health<=14&&this.item('golden_apple')&&this.steps-this.lastHeal>80){
    if(this.pendingTask){if(this.taskToken===this.token)this.cancel();return true;}this.task(t=>this.heal(t,enemy));return true;
   }
   if(!bed&&enemy&&this.bot.health<=(this.profile.retreat_health?this.profile.retreat_health*20:8)&&enemy.position.distanceTo(p)<7){
    const options=[[-4,0],[4,0],[0,-4],[0,4]].map(([x,z])=>p.offset(x,0,z)).filter(q=>q.distanceTo(enemy.position)>p.distanceTo(enemy.position)+2&&this.bot.blockAt(q.offset(0,-.2,0))?.boundingBox==='block'&&this.bot.blockAt(q.offset(0,.2,0))?.boundingBox==='empty');
    if(options.length){if(this.pendingTask){if(this.taskToken===this.token)this.cancel();return true;}this.task(async t=>{this.retreating=true;this.label='无床撤退，保存队伍战力';try{await this.walk(options[0],t,2500);}finally{this.retreating=false;}});return true;}
   }
   return false;
  }
  near(team){const p=this.bot.entity.position,t=rules.map.teams[team];return t&&Math.hypot(p.x-t.base_block_x-.5,p.z-t.base_block_z-.5)<27;}
  async place(position,item,token){
   if(this.widenRoute&&item==='wool'&&!this.count('wool')){this.needsWool=true;throw Error('route_needs_blocks');}
   await super.place(position,item,token);
   if(this.widenRoute&&item==='wool'&&this.count('wool')>8){
    const alongX=Math.abs(position.x-Math.floor(this.bot.entity.position.x))>0;
    for(const side of this.bridgeWidth===2?[1]:[-1,1]){
     const edge=position.offset(alongX?0:side,0,alongX?side:0);
     if(this.bot.blockAt(edge)?.boundingBox==='empty'&&this.bot.blockAt(edge.offset(0,1,0))?.boundingBox==='empty')await super.place(edge,item,token);
    }
   }
  }
  async route(target,token){
   this.routeGoal=target.toArray();
   if(this.bot.entity.position.y>rules.map.surface_y+1.7){
    const p=this.bot.entity.position,candidates=[];
    for(let x=-4;x<=4;x++)for(let z=-4;z<=4;z++){
     const q=new Vec3(Math.floor(p.x)+x+.5,rules.map.surface_y+1,Math.floor(p.z)+z+.5);
     if(this.bot.blockAt(q.offset(0,-1,0))?.boundingBox==='block'&&this.bot.blockAt(q)?.boundingBox==='empty'&&this.bot.blockAt(q.offset(0,1,0))?.boundingBox==='empty')candidates.push(q);
    }
    candidates.sort((a,b)=>a.distanceTo(p)-b.distanceTo(p));
    if(candidates.length){const movement=this.bot.pathfinder.movements,drop=movement.maxDropDown;movement.maxDropDown=3;try{await this.walk(candidates[0],token,5000);}finally{movement.maxDropDown=drop;}}
   }
   for(const next of boundedLegs(this.bot.entity.position,waypoints(rules.map,this.bot.entity.position,target),this.routeLegDistance||16)){
    this.routeWaypoint=next.toArray();
    this.check(token);
    try{await this.walk(next,token,5500);continue;}catch(e){this.check(token);if(!/path|timeout|stuck/i.test(e.message))throw e;}
    // Build a connected staircase in the x/z plane; diagonal cells never skip support.
    const bridgeKey=this.ownTeam()+':'+Math.floor(next.x)+','+Math.floor(next.z);
    const owner=bridgeOwners.get(bridgeKey);
    if(owner&&owner!==this.name){this.label='等待队友铺路';await sleep(600);this.check(token);throw Error('bridge_busy');}
    bridgeOwners.set(bridgeKey,this.name);
    try{
    if(this.routeLeg){this.widenRoute=true;try{await this.routeLeg(next,token);}finally{this.widenRoute=false;}continue;}
    // Advance an integer route cursor: pathfinder can finish a step before the
    // player's feet cross the block boundary, so flooring the feet can loop forever.
    for(const step of bridgeSteps(this.bot.entity.position,next)){
     this.check(token);const alongX=step.axis==='x',cell=new Vec3(step.x,rules.map.surface_y,step.z);
     if(this.bot.blockAt(cell)?.boundingBox!=='block'){if(!this.count('wool')){this.needsWool=true;throw Error('bridge_supply_empty');}await this.place(cell,'wool',token);}
     for(const side of [-1,1]){const edge=cell.offset(alongX?0:side,0,alongX?side:0);if(this.bot.blockAt(edge)?.boundingBox!=='block'&&this.count('wool')>4)await this.place(edge,'wool',token);}
     await this.walk(cell.offset(.5,1,.5),token,3500);
     if(Math.hypot(this.bot.entity.position.x-cell.x-.5,this.bot.entity.position.z-cell.z-.5)>1.3)throw Error('bridge_step_unreached');
    }
    await this.walk(next,token,4000);
    }finally{if(bridgeOwners.get(bridgeKey)===this.name)bridgeOwners.delete(bridgeKey);}
   }
  }
  async collect(resource,amount,token){
   this.label='收集'+rules.resources[resource].label;
   const currency={iron:'iron_ingot',gold:'gold_ingot',diamond:'diamond',emerald:'emerald'}[resource];
   let options=rules.map.spawners.filter(s=>s.resource===resource&&(s.team===this.ownTeam()||!s.team)&&(!s.requires_forge||(this.ownUpgrades().forge||0)>=s.requires_forge));
   const local=options.filter(s=>s.team===this.ownTeam()&&(s.lane==null||s.lane===this.member.slot));
   if(local.length)options=local;
   else if(this.count('wool')<32)return this.buy('wool',64,token);
   options.sort((a,b)=>new Vec3(...a.position).distanceTo(this.bot.entity.position)-new Vec3(...b.position).distanceTo(this.bot.entity.position));
   const spawn=options[0];if(!spawn)throw Error('resource_missing');
   await this.route(new Vec3(spawn.position[0],rules.map.surface_y+1,spawn.position[2]),token);
   const end=Date.now()+5500;while(this.count(currency)<amount&&Date.now()<end){this.check(token);await sleep(180);}
  }
  async defend(token){
   this.label='守家并加固床';const team=this.teamConfig();await this.route(new Vec3(...team.defense_stand),token);
   for(const p of defenseCells(team))await this.place(new Vec3(...p),'end_stone',token);
   this.defended=true;
  }
  async assault(token){
   const target=this.targetTeam();if(!target)return;const team=rules.map.teams[target];
   if(!this.near(target))return this.route(new Vec3(...team.approach),token);
   const enemyBed=getMatch().teams.find(t=>t.name===target)?.bed;
   if(!enemyBed){
    const enemy=this.visibleEnemy(16);if(enemy)return this.route(enemy.position.clone(),token);
    const points=[new Vec3(.5,rules.map.surface_y+1,.5),new Vec3(...team.approach),new Vec3(...team.home)];
    this.searchPoint??=0;if(this.bot.entity.position.distanceTo(points[this.searchPoint%points.length])<3)this.searchPoint++;
    this.label='协同搜索剩余对手';return this.route(points[this.searchPoint%points.length],token);
   }
   const covers=defenseCells(team).sort((a,b)=>new Vec3(...a).distanceTo(this.bot.entity.position)-new Vec3(...b).distanceTo(this.bot.entity.position));
   const cells=[team.bed,team.bed_foot,...covers];
   for(const pos of cells){this.check(token);const b=this.bot.blockAt(new Vec3(...pos));
    if(!b||!/(?:_bed|_wool|_planks|stained_glass)$/.test(b.name)&&!['end_stone','obsidian'].includes(b.name))continue;
    if(this.bot.entity.position.distanceTo(b.position.offset(.5,.5,.5))>4.4||!this.bot.canSeeBlock(b))continue;
    if(b.name==='obsidian'&&!this.item('diamond_pickaxe')){this.needDiamondPick=true;return;}
    this.label=b.name.endsWith('_bed')?'拆除'+target+'床':'破坏'+target+'床防御';
    this.breachBlock=b.name;const tool=this.bot.pathfinder.bestHarvestTool(b);if(tool)await this.bot.equip(tool,'hand');this.check(token);await this.bot.dig(b,true);return;
   }
   return this.route(new Vec3(...team.defense_stand),token);
  }
  async macro(token){
   const own=this.teamConfig(),atBase=this.near(this.ownTeam()),role=this.role(),bed=getMatch().teams?.find(t=>t.name===this.ownTeam())?.bed;
   if(this.needsWool){if(this.count('wool')>=96)this.needsWool=false;else return this.buy('wool',128,token);}
   if(role==='defender'&&bed&&atBase)this.defended=defenseCells(own).every(p=>this.bot.blockAt(new Vec3(...p))?.boundingBox==='block');
   if(getMatch().classic?.stage==='sudden_death')return this.route(new Vec3(.5,65,.5),token);
   if(this.needDiamondPick&&!this.item('diamond_pickaxe'))return this.buy('diamond_pickaxe',1,token);
   if(role==='defender'&&bed&&!this.defended){if(this.count('end_stone')<8)return this.buy('end_stone',12,token);return this.defend(token);}
   if(!this.item('stone_sword')&&!this.item('iron_sword')&&!this.item('diamond_sword'))return this.buy('stone_sword',1,token);
   if(atBase&&this.count('wool')<64)return this.buy('wool',128,token);
   if(!this.bestTool('pickaxe')&&role!=='defender')return this.buy('wooden_pickaxe',1,token);
   if(atBase&&this.profile.prefer_bow&&this.count('gold_ingot')>=12&&!this.item('bow'))return this.buy('bow',1,token);
   if(this.profile.prefer_bow&&this.item('bow')&&this.count('arrow')<4)return this.buy('arrow',16,token);
   if(atBase&&this.count('gold_ingot')>=12&&this.kitTier()<2)return this.buy('iron_armor',1,token);
   if(atBase&&this.count('gold_ingot')>=7&&!this.item('iron_sword')&&!this.item('diamond_sword'))return this.buy('iron_sword',1,token);
   if(atBase&&this.count('gold_ingot')>=3&&!this.item('golden_apple'))return this.buy('golden_apple',1,token);
   if(atBase&&role==='defender'&&this.count('gold_ingot')>=12&&!this.item('bow'))return this.buy('bow',1,token);
   if(atBase&&this.item('bow')&&this.count('arrow')<8&&this.count('gold_ingot')>=2)return this.buy('arrow',8,token);
   if(role==='collector'&&bed){
    const upgrades=this.ownUpgrades();
    const opening=this.profile.economic_upgrades?[['forge',1],['protection',1],['sharpness',1]]:[['protection',1],['sharpness',1],['forge',1]];
    const plan=[...opening,['trap',1],['protection',2],['forge',2],['protection',3],['forge',3],['protection',4],['forge',4]];
    const choice=plan.find(([id,level])=>(upgrades[id]||0)<level);
    const wanted=choice&&rules.team_upgrades.find(u=>u.id===choice[0]);
    if(wanted){const cost=wanted.costs[upgrades[wanted.id]||0];if(this.count('diamond')<cost)return this.collect('diamond',cost,token);return this.upgrade(wanted.id,token);}
   }
   if(role==='defender'&&bed){this.label='回防床前通路';const stand=new Vec3(...own.defense_stand);if(this.bot.entity.position.distanceTo(stand)>2.5)return this.route(stand,token);await sleep(600);return;}
   if(role==='support'&&!atBase){
    const allies=(getMatch().players||[]).filter(p=>p.name!==this.name&&p.team===this.ownTeam()&&p.mode==='SURVIVAL'&&p.pos),lead=allies.find(p=>(roster.find(r=>r.name===p.name)?.slot??-1)===2)||(!bed?allies[0]:null);
    if(lead){const target=new Vec3(...lead.pos),d=target.distanceTo(this.bot.entity.position);if(d>14&&d<40){this.label='集结并支援队友';return this.route(target,token);}}
   }
   if(this.count('wool')<6)return this.buy('wool',64,token);
   this.label=(role==='support'?'支援':'进攻')+(this.targetTeam()||'中心');return this.assault(token);
  }
  failure(error){if(['route_needs_blocks','bridge_supply_empty'].includes(error.message)){this.needsWool=true;this.label='补充搭桥方块';this.failUntil=Date.now()+300;return;}if(error.message==='bridge_busy'){this.failUntil=Date.now()+300;return;}super.failure(error);}
  status(){const role=this.role();return {...super.status(),...(role==='eliminated'?{label:'本局已淘汰'}:{}),team:this.ownTeam(),slot:this.member.slot,role,target_team:this.targetTeam(),route_goal:this.routeGoal,route_waypoint:this.routeWaypoint,breach_block:this.breaching?this.breachBlock:null,team_policy:'squads-coordinated-4',model_id:this.member.model,preferred_role:this.profile.role||role,display_name:this.profile.display_name||this.name,personality:this.profile.specialty||''};}
 };
}
module.exports={extend};
