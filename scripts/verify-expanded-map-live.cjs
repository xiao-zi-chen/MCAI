// Real, explicitly marked test match. Exercises both resource flanks and final-life utilities.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {promisify}=require('node:util'),exec=promisify(require('node:child_process').execFile);
const {SkilledAgent,getMatch,rules}=require('./showcase-v2.cjs');
const Agent=require('./advanced-tactics.cjs').extend(SkilledAgent,{rules,getMatch});
const {Vec3}=require('../bot-controller/node_modules/vec3');
const root=path.resolve(__dirname,'..'),sleep=ms=>new Promise(r=>setTimeout(r,ms));
const agents=[new Agent('EmberAI','rush'),new Agent('BastionAI','fortify')],a=agents[0],b=agents[1];
for(const v of agents){clearInterval(v.timer);v.bot.once('spawn',()=>setTimeout(()=>v.bot.chat('/bw join SkyDuel'),800));}
const report={rules_version:rules.version,checks:[],complete:false},output=path.join(root,'runs/showcase-v6/map-verification.json');
const admin=async(...args)=>(await exec(path.join(root,'.venv/Scripts/python.exe'),[path.join(root,'scripts/bedwars-rcon.py'),...args.map(String)],{windowsHide:true,timeout:12000})).stdout;
async function until(fn,ms=10000){const end=Date.now()+ms;while(Date.now()<end){if(fn())return;await sleep(100);}throw Error('Live condition timed out');}
async function attempt(fn){for(let i=0;i<3;i++)try{return await fn()}catch(e){if(i===2||!/interrupted|goal was changed/i.test(e.message))throw e;await sleep(300);}}
async function check(name,fn){const result=await fn();report.checks.push({name,passed:true,...result});fs.writeFileSync(output,JSON.stringify(report,null,2));console.log('PASS',name,JSON.stringify(result||{}));}
(async()=>{try{
 await until(()=>getMatch().phase==='running'&&getMatch().players?.length===2,45000);await admin('skyduel','test');report.match_id=getMatch().match_id;
 for(const v of agents){v.side=getMatch().players.find(p=>p.name===v.name).team==='Red'?-1:1;v.currentMatch=report.match_id;v.onMatch();}
 await admin('skyduel','grant',a.name,'iron',256);await admin('skyduel','grant',a.name,'gold',32);
 for(let i=0;i<3;i++)await attempt(()=>a.buy('wool',64,a.token));
 await attempt(()=>a.buy('sponge',4,a.token));
 await check('north_and_south_diamond_islands_reachable',async()=>{
  const visited=[];for(const sign of [-1,1]){
   const s=rules.map.spawners.find(s=>s.resource==='diamond'&&!s.team&&Math.sign(s.position[0])===a.side&&Math.sign(s.position[2])===sign);
   const dest=new Vec3(s.position[0],65,s.position[2]);await attempt(()=>a.route(dest,a.token));
   assert(a.bot.entity.position.distanceTo(dest)<1.3);assert(a.bot.entity.onGround);visited.push(a.bot.entity.position.clone());
  }return {visited,wool_remaining:a.count('wool')};
 });
 await check('expanded_cross_map_route_reaches_opposite_shop',async()=>{
  const team=rules.map.teams[a.side<0?'Blue':'Red'],dest=new Vec3(team.shop[0],65,team.shop[2]+2);
  await attempt(()=>a.route(dest,a.token));assert(a.bot.entity.position.distanceTo(dest)<1.3);
  await attempt(()=>a.buy('stone_sword',1,a.token));assert(a.item('stone_sword'));return {position:a.bot.entity.position};
 });
 await check('reactive_sponge_restores_flooded_route',async()=>{
  await admin('tp',a.name,'.5','65','2.5');await sleep(500);await admin('setblock','0','65','2','water');await sleep(400);
  const before=a.count('sponge');assert(a.tacticalUpdate(null));await until(()=>!a.pendingTask);assert(a.count('sponge')<before);assert(a.tactics.sponge>=1);
  await until(()=>a.bot.blockAt(new Vec3(0,65,2))?.name!=='water');return {used:before-a.count('sponge')};
 });
 await check('visible_tnt_evaded_at_center_away_from_home',async()=>{
  await admin('tp',a.name,'.5','65','-1.5');await sleep(400);await admin('summon','tnt','.5','65','-1.5','{fuse:80}');
  await until(()=>getMatch().projectiles?.some(p=>p.kind==='TNT'));assert(a.tacticalUpdate(null));await until(()=>!a.pendingTask,5000);
  assert(a.tactics.tnt_dodge>=1);assert(a.bot.entity.position.distanceTo(new Vec3(.5,65,-1.5))>6.5);return {escaped:a.bot.entity.position};
 });
 report.complete=true;
}catch(e){report.error=e.stack;console.error(e.stack);process.exitCode=1;}
finally{fs.writeFileSync(output,JSON.stringify(report,null,2));await admin('skyduel','abort');await admin('skyduel','lock');for(const v of agents)v.bot.quit();setTimeout(()=>process.exit(process.exitCode||0),700);}
})();
