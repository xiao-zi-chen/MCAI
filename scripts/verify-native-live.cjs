// Marked test scenarios: actual Minecraft actions, timing and new-map traversal.
const fs=require('fs'),path=require('path'),assert=require('node:assert/strict');
const {promisify}=require('util'),exec=promisify(require('child_process').execFile);
const {SkilledAgent,getMatch,rules}=require('./showcase-v2.cjs');
const Agent=require('./advanced-tactics.cjs').extend(SkilledAgent,{getMatch,rules});
const {Vec3}=require('../bot-controller/node_modules/vec3');
const {baseX,bedX,footX}=require('./arena-geometry.cjs').forMap(rules.map);
const root=path.resolve(__dirname,'..'),sleep=ms=>new Promise(r=>setTimeout(r,ms));
const a=new Agent('EmberAI','rush'),b=new Agent('BastionAI','fortify'),agents=[a,b];
for(const agent of agents){clearInterval(agent.timer);agent.bot.once('spawn',()=>setTimeout(()=>agent.bot.chat('/bw join SkyDuel'),800));}
const report={started_at:new Date().toISOString(),rules_version:rules.version,cases:[],samples:[]};
const file='runs/showcase-v6/native-verification.json';
const me=agent=>getMatch().players?.find(p=>p.name===agent.name);
async function admin(...args){return(await exec(path.join(root,'.venv/Scripts/python.exe'),[path.join(root,'scripts/bedwars-rcon.py'),...args.map(String)],{windowsHide:true,timeout:15000})).stdout;}
async function until(fn,ms=10000,label='condition'){const end=Date.now()+ms;while(Date.now()<end){if(fn())return;await sleep(50);}throw Error(label+' timed out');}
async function tp(agent,p){await admin('tp',agent.name,...p);await until(()=>agent.bot.entity.position.distanceTo(new Vec3(...p))<1);await sleep(200);}
async function retry(fn){for(let i=0;i<3;i++)try{return await fn()}catch(e){if(i===2||!/interrupted|goal was changed/i.test(e.message))throw e;await sleep(250);}}
async function buy(agent,id,amount=1){const entry=rules.shop.find(i=>i.id===id),before=agent.count(id==='wool'?'wool':entry.material);for(let i=0;i<4;i++){await retry(()=>agent.buy(id,amount,agent.token));await sleep(150);if(agent.count(id==='wool'?'wool':entry.material)>before)return;}throw Error('Purchase failed: '+id);}
async function check(name,fn){const begin=getMatch().tick;const result=await fn();report.cases.push({name,passed:true,begin_tick:begin,end_tick:getMatch().tick,...result});fs.writeFileSync(file,JSON.stringify(report,null,2));console.log('PASS',name,JSON.stringify(result||{}));}
let timer,lastTick=-1;
(async()=>{try{
 await until(()=>getMatch().phase==='running'&&getMatch().players?.length===2,45000,'match start');await admin('skyduel','test');report.match_id=getMatch().match_id;
 for(const agent of agents){agent.side=me(agent).team==='Red'?-1:1;agent.currentMatch=report.match_id;agent.onMatch();for(const c of ['iron','gold','diamond','emerald'])await admin('skyduel','grant',agent.name,c,c==='iron'?256:128);}
 timer=setInterval(()=>{const s=getMatch();if(s.tick===lastTick)return;lastTick=s.tick;report.samples.push({tick:s.tick,players:s.players,projectiles:s.projectiles,events:s.events});},50);
 await buy(a,'wool',64);await buy(a,'bow');await buy(a,'arrow',32);await buy(a,'golden_apple');await buy(a,'speed_potion');await buy(a,'ender_pearl');await buy(a,'water_bucket');await buy(a,'sponge',4);await buy(a,'tnt');
 await check('base_roof_reached_and_descended_by_real_stairs',async()=>{
  const point=rules.map.tactical_positions.find(p=>p.team===a.ownTeam()&&p.kind==='high_ground');
  await retry(()=>a.route(new Vec3(...point.position),a.token));assert(a.bot.entity.position.y>=69.5);const reached=a.bot.entity.position.clone();
  await retry(()=>a.route(new Vec3(...a.teamConfig().spawn.slice(0,3)),a.token));assert(Math.abs(a.bot.entity.position.y-65)<.6);return {reached,returned:a.bot.entity.position};
 });
 await check('existing_roads_and_missing_bridge_cells',async()=>{const before=a.count('wool');await retry(()=>a.route(new Vec3(.5,65,2.5),a.token));assert(a.bot.entity.position.distanceTo(new Vec3(.5,65,2.5))<1.2);const used=before-a.count('wool');assert(used>0&&used<=20);return {wool_used:used};});
 await tp(b,[11.5,65,2.5]);
 await check('visible_opponent_causes_high_ground_decision',async()=>{
  a.lastVantage=-1000;const enemy=a.visibleEnemy();assert(enemy);assert(a.tacticalUpdate(enemy));await until(()=>!a.pendingTask,20000,'high ground task');assert(a.bot.entity.position.y>=67.8);assert(a.tactics.high_ground>=1);assert(a.visibleEnemy(),'high ground must retain target visibility');return {position:a.bot.entity.position,intent:a.intent};
 });
 await check('bow_native_charge_and_projectile_hit',async()=>{
  const before=b.bot.health,start=getMatch().tick;await a.shoot(a.visibleEnemy(),a.token);await until(()=>b.bot.health<before,5000,'arrow hit');
  const rows=report.samples.filter(s=>s.tick>=start),using=rows.flatMap(s=>s.players.filter(p=>p.name===a.name&&p.using_item));assert(using.some(p=>p.use_action==='BOW'&&p.use_ticks>=18));
  const shots=rows.flatMap(s=>s.events||[]).filter(e=>e.type==='bow_shot'&&e.player===a.name);assert(shots.some(e=>e.force>=.99));return {damage:before-b.bot.health,max_observed_charge:Math.max(...using.map(p=>p.use_ticks)),full_charge:true};
 });
 await tp(a,[.5,65,2.5]);
 await check('golden_apple_native_use_and_absorption',async()=>{
  const start=getMatch().tick,before=a.count('golden_apple');await a.equip('golden_apple');await a.bot.consume();await until(()=>me(a).absorption>=4);assert.equal(a.count('golden_apple'),before-1);
  const rows=report.samples.filter(s=>s.tick>=start),using=rows.flatMap(s=>s.players.filter(p=>p.name===a.name&&p.using_item));assert(using.length>=8);assert(using.every(p=>p.use_action==='EAT'));assert(using.some(p=>p.use_ticks+p.use_remaining_ticks===32));
  assert(me(a).effects.some(e=>e.name==='regeneration'&&e.amplifier===1));return {use_total_ticks:32,absorption:me(a).absorption};
 });
 await check('potion_drinks_then_leaves_glass_bottle',async()=>{
  const start=getMatch().tick,potion=a.bot.inventory.items().find(i=>i.name==='potion');assert(potion);await a.bot.equip(potion,'hand');await a.bot.consume();await until(()=>me(a).effects.some(e=>e.name==='speed'));
  const using=report.samples.filter(s=>s.tick>=start).flatMap(s=>s.players.filter(p=>p.name===a.name&&p.using_item));assert(using.every(p=>p.use_action==='DRINK'));assert(using.some(p=>p.held_stack.tint));assert(using.some(p=>p.use_ticks+p.use_remaining_ticks===32));assert(a.count('glass_bottle')>=1);
  const effect=me(a).effects.find(e=>e.name==='speed');assert.equal(effect.amplifier,1);assert(effect.ticks>850&&effect.ticks<=900);return {use_total_ticks:32,effect,glass_bottle:true};
 });
 await admin('effect','clear',a.name);await tp(a,[-a.side*29+.5,65,4.5]);
 await check('pearl_native_cooldown_and_landing_damage',async()=>{const start=getMatch().tick;await a.pearl(a.token);await until(()=>-a.side*a.bot.entity.position.x>46,5000,'pearl landing');const rows=report.samples.filter(s=>s.tick>=start);assert(rows.some(s=>s.players.find(p=>p.name===a.name)?.item_cooldowns?.ender_pearl>0));const damage=rows.flatMap(s=>s.events||[]).find(e=>e.type==='damage'&&e.player===a.name&&e.attacker===a.name&&e.raw_amount===5);assert(damage);assert.equal(damage.raw_amount,5);return {position:a.bot.entity.position,base_damage:damage.raw_amount,api_cause:damage.cause};});
 await tp(a,[.5,65,2.5]);await tp(b,[10.5,65,2.5]);
 await check('bucket_fluid_and_sponge_are_recorded',async()=>{await a.equip('water_bucket');await a.bot.lookAt(new Vec3(1.5,64,4.5),true);a.bot.activateItem();a.bot.swingArm('right');await until(()=>a.count('bucket')>0,4000,'empty bucket');await sleep(600);const start=getMatch().tick;await a.equip('sponge');await a.bot._genericPlace(a.bot.blockAt(new Vec3(1,64,3)),new Vec3(0,1,0),{forceLook:true,swingArm:'right'});await until(()=>a.bot.blockAt(new Vec3(1,65,3))?.name==='wet_sponge');await sleep(200);assert(report.samples.some(s=>(s.events||[]).some(e=>e.type==='block_state'&&e.block.startsWith('minecraft:water'))));assert(report.samples.filter(s=>s.tick>=start).some(s=>(s.events||[]).some(e=>e.type==='block_state'&&e.block==='minecraft:air')));return {fluid_changes_recorded:true};});
 await check('tnt_native_fuse_and_textured_projectile_data',async()=>{await a.equip('tnt');await a.bot._genericPlace(a.bot.blockAt(new Vec3(4,64,2)),new Vec3(0,1,0),{forceLook:true,swingArm:'right'});await until(()=>getMatch().projectiles.some(p=>p.kind==='TNT'));const tnt=getMatch().projectiles.find(p=>p.kind==='TNT');assert(tnt.fuse_ticks>70&&tnt.fuse_ticks<=80);await tp(a,[-10.5,65,2.5]);await until(()=>!getMatch().projectiles.some(p=>p.id===tnt.id),5500,'TNT explosion');return {first_fuse_ticks:tnt.fuse_ticks};});
 report.complete=true;
 }catch(error){report.complete=false;report.error=error.stack;console.error(error.stack);process.exitCode=1;}
 finally{clearInterval(timer);report.finished_at=new Date().toISOString();fs.writeFileSync(file,JSON.stringify(report,null,2));await admin('skyduel','abort');await admin('skyduel','lock');for(const agent of agents)agent.bot.quit();setTimeout(()=>process.exit(process.exitCode||0),700);}
})();
