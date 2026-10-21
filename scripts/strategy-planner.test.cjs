const {test}=require('node:test'),assert=require('node:assert/strict');
const {Vec3}=require('../bot-controller/node_modules/vec3');
const {waypoints,forMap}=require('./arena-geometry.cjs');
const {resourceScore,counterPurchase,threatPenalty,safePearlTarget}=require('./strategy-planner.cjs');
const rules=require('../competition/rules.json');
test('opposite bases use bounded legs that cross the expanded public map',()=>{
 const {home}=forMap(rules.map),start=home(-1),target=home(1),route=waypoints(rules.map,start,target);
 assert(route.length>=4);let p=start;for(const q of route){assert(p.distanceTo(q)<40);p=q;}assert.deepEqual(p,target);
});
test('relocating bases changes assault and bed geometry without controller edits',()=>{
 const map=structuredClone(rules.map);map.teams.Red.base_block_x=-90;map.teams.Red.bed[0]=-88;
 const g=forMap(map);assert.equal(g.approach(-1).x,-84.5);assert.equal(g.footX(-1),-87);
 assert(g.nearBase(new Vec3(-92,65,3),-1));assert(!g.nearBase(new Vec3(-40,65,3),-1));
});
test('resources rotate away from just-emptied or threatened generators',()=>{
 const s={position:new Vec3(0,65,0),now:1000},a={position:[10,65,0]},b={position:[0,65,14]};
 assert(resourceScore({...s,spawner:a,lastVisit:990})>resourceScore({...s,spawner:b}));
 assert(resourceScore({...s,spawner:a,enemy:new Vec3(10,65,0)})>resourceScore({...s,spawner:b}));
});
test('a known obsidian defense requires the correct tool; glass does not waste TNT',()=>{
 const s={health:20,ownBed:true,style:'rush',armor:2,inventory:()=>false};
 assert.equal(counterPurchase({...s,materials:['obsidian']}),'diamond_pickaxe');
 assert.equal(counterPurchase({...s,materials:['white_stained_glass']}),null);
 assert.equal(counterPurchase({...s,materials:['oak_planks']}),'wooden_axe');
});
test('returning with diamonds avoids a recently seen enemy, not stale hidden positions',()=>{
 const s={enemy:new Vec3(3,65,0),now:200,seenAt:180,health:20,bedAlive:true,valuable:true};
 assert(threatPenalty({x:3,z:1},s)>0);assert.equal(threatPenalty({x:3,z:1},{...s,now:300}),0);
});
test('pearls require a safe landing area, enough health, clear trajectory and no cooldown',()=>{
 const s={origin:new Vec3(0,65,0),target:new Vec3(20,65,0),health:20,cooldown:0,solid:()=>true,clear:()=>true,raycast:()=>null};
 assert(safePearlTarget(s));assert(!safePearlTarget({...s,health:10}));assert(!safePearlTarget({...s,cooldown:1}));
 assert(!safePearlTarget({...s,solid:p=>p.z>=0}));assert(!safePearlTarget({...s,raycast:()=>({})}));
});
