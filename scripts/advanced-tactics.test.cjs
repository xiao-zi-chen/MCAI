const {test}=require('node:test');const assert=require('node:assert/strict');
const {tacticalPriority,escapeCandidates,extend}=require('./advanced-tactics.cjs');const rules=require('../competition/rules.json');
const {baseX,bedX,footX}=require('./arena-geometry.cjs').forMap(rules.map);
const base={health:20,enemyDistance:Infinity,bedAlive:true,invader:false,diamonds:0,emeralds:0};
test('heading to the enemy bed still routes around the friendly bed',()=>{
 const {defenseBoxes,navigationPenalty}=require('./bedwars-navigation.cjs'),boxes=defenseBoxes(rules.map);
 assert.equal(navigationPenalty({x:bedX(1),z:0},{x:bedX(-1)+3,z:2},{x:baseX(1)+4,z:-3},boxes),100);
 assert.equal(navigationPenalty({x:footX(-1),z:1},{x:bedX(-1)+3,z:2},{x:baseX(1)+4,z:-3},boxes),0);
});
test('a player already inside the bed perimeter can walk out',()=>{
 const {defenseBoxes,navigationPenalty}=require('./bedwars-navigation.cjs'),boxes=defenseBoxes(rules.map);
 assert.equal(navigationPenalty({x:footX(-1)+1,z:2},{x:baseX(-1)-1,z:2},{x:footX(-1)+1,z:1},boxes),10);
});
test('a visible invader overrides a lucrative resource trip',()=>assert.equal(tacticalPriority({...base,invader:true,diamonds:8}),'defend'));
test('critically low health does not become a suicidal defense command',()=>assert.equal(tacticalPriority({...base,health:4,enemyDistance:3,invader:true}),'retreat'));
test('escaping immediate danger does not send a critically injured player back to attack',()=>assert.equal(tacticalPriority({...base,health:4,enemyDistance:Infinity,absorption:0}),'recover'));
test('absorption already covering low health permits continuing the plan',()=>assert.equal(tacticalPriority({...base,health:7,enemyDistance:Infinity,absorption:4}),'develop'));
test('losing the bed changes resource gathering into survival first',()=>assert.equal(tacticalPriority({...base,bedAlive:false,health:10,emeralds:8}),'survive'));
test('valuable resources are converted into equipment instead of blindly carried into combat',()=>assert.equal(tacticalPriority({...base,diamonds:4}),'bank'));
test('retreat does not pick a distant destination reached by running through the enemy',()=>{
 const {Vec3}=require('../bot-controller/node_modules/vec3');const p=new Vec3(40,65,0),foe=new Vec3(36,65,0),home=new Vec3(45,65,0),center=new Vec3(0,65,0);
 assert.deepEqual(escapeCandidates(p,foe,[center,home]),[home]);
});
test('defense shells cover both bed halves without placing inside the bed',()=>{
 const Type=extend(class{}, {rules,getMatch:()=>({})});
 for(const side of [-1,1]){const agent=new Type();agent.side=side;const head=bedX(side),foot=footX(side);
  const first=new Set(agent.defensePositions(1).map(p=>p.toString()));
  for(const x of [head,foot])for(const [dx,dy,dz]of [[0,1,0],[0,0,-1],[0,0,1],[-side,0,0],[side,0,0]]){
   const p=new (require('../bot-controller/node_modules/vec3').Vec3)(x+dx,65+dy,dz);
   if(p.y===65&&p.z===0&&[head,foot].includes(p.x))assert(!first.has(p.toString()));else assert(first.has(p.toString()));
  }
  const outer=agent.defensePositions(2);assert(outer.length>first.size);assert(outer.every(p=>!first.has(p.toString())));
 }
});

test('unloaded pathfinder blocks do not crash the navigation exclusion callback',()=>{
 const {defenseBoxes,navigationPenalty}=require('./bedwars-navigation.cjs'),boxes=defenseBoxes(rules.map);
 // Movements.getBlock returns an object without position before its chunk arrives.
 const unloaded={replaceable:false,safe:false,physical:false};
 assert.equal(navigationPenalty(unloaded.position,{x:bedX(1),z:0},{x:-40,z:0},boxes),100);
});

test('a destroyed enemy bed switches the attacker to pursuit instead of mining more defense',async()=>{
 const {Vec3}=require('../bot-controller/node_modules/vec3');let target;
 const Type=extend(class{}, {rules,getMatch:()=>({tick:200,teams:[{name:'Red',bed:true},{name:'Blue',bed:false}]})});
 const agent=new Type();agent.side=-1;agent.bot={entity:{position:new Vec3(20,65,2)}};agent.ownTeam=()=> 'Red';agent.note=()=>{};agent.visibleEnemy=()=>null;agent.lastSeenEnemy={tick:180,position:new Vec3(41,65,3)};agent.route=async v=>{target=v};
 await agent.assault(1);assert.deepEqual(target,new Vec3(41,65,3));
});

test('banked gold funds an armor upgrade instead of remaining unused forever',async()=>{
 const {Vec3}=require('../bot-controller/node_modules/vec3');let bought;
 const Type=extend(class{}, {rules,getMatch:()=>({tick:1000,teams:[{name:'Red',bed:true},{name:'Blue',bed:true}],classic:{}})});
 const a=new Type();a.bot={health:20,entity:{position:new Vec3(baseX(-1)-4.5,65,3.5)}};a.side=-1;a.onMatch();a.banked.gold=9;a.defenseTier=1;
 a.ownTeam=()=> 'Red';a.ownUpgrades=()=>({});a.visibleEnemy=()=>null;a.bestTool=()=> 'wooden_pickaxe';a.kitTier=()=>0;
 a.count=id=>({wool:64,gold_ingot:3}[id]||0);a.item=id=>id==='stone_sword'?{name:id}:null;a.buy=async id=>{bought=id};
 await a.macro(1);assert.equal(bought,'iron_armor');
});
test('an exposed enemy bed takes priority over chasing a nearby defender',async()=>{
 const {Vec3}=require('../bot-controller/node_modules/vec3');const match={tick:1000,teams:[{name:'Red',bed:true},{name:'Blue',bed:true}],players:[]};
 const Type=extend(class{}, {rules,getMatch:()=>match}),a=new Type();a.side=-1;a.onMatch();a.ownTeam=()=> 'Red';a.teamConfig=()=>rules.map.teams.Red;a.count=()=>0;a.item=()=>null;
 a.bot={health:12,entity:{position:new Vec3(baseX(1)-4.5,65,2.5)},blockAt:v=>({name:'blue_bed',position:v}),canSeeBlock:()=>true};let action;
 a.interruptFor=fn=>{action=fn;return true};let broke=false;a.assault=async()=>{broke=true};
 assert(a.tacticalUpdate({position:new Vec3(baseX(1)-.5,65,2.5)}));await action(1);assert(broke);assert.equal(a.intent,'抓住拆床窗口');
});

test('the defender arms itself before spending the opening on bed construction',async()=>{
 const {Vec3}=require('../bot-controller/node_modules/vec3');let bought;
 const Type=extend(class{}, {rules,getMatch:()=>({tick:200,teams:[{name:'Blue',bed:true},{name:'Red',bed:true}],classic:{}})});
 const a=new Type();a.side=1;a.style='fortify';a.bot={health:20,entity:{position:new Vec3(baseX(1)+4.5,65,3.5)}};a.onMatch();
 a.ownTeam=()=> 'Blue';a.ownUpgrades=()=>({});a.visibleEnemy=()=>null;a.item=id=>id==='wooden_sword'?{}:null;a.buy=async id=>{bought=id};
 await a.macro(1);assert.equal(bought,'stone_sword');
});
