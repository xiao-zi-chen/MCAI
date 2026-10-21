// Console-controlled integration scenarios, always marked as test by the referee.
const fs=require('fs'),path=require('path'),assert=require('node:assert/strict');
const {promisify}=require('util'),run=promisify(require('child_process').execFile);
const {SkilledAgent:ClassicAgent,getMatch,rules}=require('./showcase-v2.cjs');
const Advanced=require('./advanced-tactics.cjs').extend(ClassicAgent,{getMatch,rules});
const {Vec3}=require('../bot-controller/node_modules/vec3');
const {baseX,bedX,footX}=require('./arena-geometry.cjs').forMap(rules.map);
const root=path.resolve(__dirname,'..'),sleep=ms=>new Promise(r=>setTimeout(r,ms));
const agents=[new Advanced('EmberAI','rush'),new Advanced('BastionAI','fortify')],a=agents[0],b=agents[1];
for(const agent of agents){clearInterval(agent.timer);if(process.env.SKYDUEL_TRACE)agent.bot.on('forcedMove',()=>console.log('correction',agent.name,JSON.stringify(agent.bot.entity.position),agent.bot.game.gameMode));agent.bot.once('spawn',()=>setTimeout(()=>agent.bot.chat('/bw join SkyDuel'),800));}
const report={started_at:new Date().toISOString(),tests:[]};
async function admin(...args){return(await run(path.join(root,'.venv/Scripts/python.exe'),[path.join(root,'scripts/bedwars-rcon.py'),...args.map(String)],{windowsHide:true,timeout:15000})).stdout.trim()}
async function until(fn,timeout=10000,label='condition'){const end=Date.now()+timeout;while(Date.now()<end){if(fn())return;await sleep(100)}throw new Error(label+' timed out')}
async function perform(fn){for(let i=0;i<4;i++)try{return await fn()}catch(e){if(i===3||!/goal was changed|interrupted/i.test(e.message))throw e;await sleep(300)}}
function me(agent=a){return getMatch().players?.find(p=>p.name===agent.name)}
function mark(name,data={}){report.tests.push({name,passed:true,...data});console.log('PASS',name,JSON.stringify(data));fs.writeFileSync('runs/tactics-verification.json',JSON.stringify(report,null,2));}
async function tp(agent,position){await admin('tp',agent.name,...position);await until(()=>agent.bot.entity.position.distanceTo(new Vec3(...position))<1.3,5000,'teleport');await sleep(200)}
async function purchase(agent,id,amount=1){const entry=rules.shop.find(i=>i.id===id);for(let n=0;n<4;n++){
 const key=id==='wool'?'wool':entry.material,old=agent.count(key);await perform(()=>agent.buy(id,amount,agent.token));await sleep(250);if(agent.count(key)>old||id.endsWith('_armor'))return;
 }throw new Error('purchase failed: '+id)}
(async()=>{try{
 await until(()=>getMatch().phase==='running'&&getMatch().players?.length===2,45000,'start');await admin('skyduel','test');report.match_id=getMatch().match_id;
 for(const agent of agents){agent.currentMatch=report.match_id;agent.side=me(agent).team==='Red'?-1:1;agent.onMatch();for(const c of ['iron','gold','diamond','emerald'])await admin('skyduel','grant',agent.name,c,c==='iron'?256:64);}
 await purchase(a,'end_stone',12);await purchase(a,'wool',64);await purchase(a,'iron_armor');await purchase(a,'wooden_pickaxe');
 await perform(()=>a.layerDefense(1,'end_stone',a.token));assert(a.defensePositions(1).every(v=>a.bot.blockAt(v)?.boundingBox==='block'));mark('inner_defense_fully_closed');
 await perform(()=>a.layerDefense(2,'wool',a.token));assert(a.defensePositions(2).every(v=>a.bot.blockAt(v)?.boundingBox==='block'));mark('outer_defense_fully_closed');
 const before=a.count('gold_ingot');await a.chest(a.token);assert.equal(a.count('gold_ingot'),3);assert.equal(a.banked.gold,before-3);await a.chest(a.token,{gold:7});assert.equal(a.count('gold_ingot'),10);mark('ender_chest_deposit_and_withdraw');
 await purchase(a,'golden_apple');await tp(a,a.teamConfig().spawn.slice(0,3));await admin('damage',a.name,9,'minecraft:generic');await until(()=>a.bot.health<18);const apples=a.count('golden_apple');await a.heal(a.token,null);await until(()=>a.count('golden_apple')<apples&&me().effects.some(e=>e.name==='regeneration'),5000,'golden apple');mark('tactical_golden_apple_healing');
 await purchase(a,'speed_potion');const potion=a.bot.inventory.items().find(i=>i.name==='potion');await a.drink(potion,a.token);await until(()=>me().effects.some(e=>e.name==='speed'));mark('tactical_potion_consumption');
 await purchase(a,'fireball');await tp(a,[.5,65,2.5]);await tp(b,[10.5,65,2.5]);const fireballs=a.count('fire_charge');await a.fireball(a.bot.players[b.name].entity,a.token);await until(()=>a.count('fire_charge')<fireballs);mark('tactical_fireball_launch');
 await tp(a,a.teamConfig().spawn.slice(0,3));await purchase(a,'ender_pearl');await tp(a,[-a.side*29+.5,65,4.5]);const pearlStart=a.bot.entity.position.clone();await a.pearl(a.token);await until(()=>-a.side*a.bot.entity.position.x>46&&a.bot.entity.position.y>=64,5000,'pearl safe landing');mark('tactical_pearl_lands_on_island',{start:pearlStart,end:a.bot.entity.position});
 await tp(b,b.teamConfig().spawn.slice(0,3));await purchase(b,'end_stone',12);await perform(()=>b.layerDefense(1,'end_stone',b.token));await tp(b,b.teamConfig().spawn.slice(0,3));await purchase(a,'tnt');await tp(a,[baseX(-a.side)+a.side*5+.5,65,3.5]);const tnt=a.count('tnt');await a.assault(a.token);await until(()=>a.count('tnt')<tnt&&getMatch().events?.some(e=>e.type==='explosion'),5000,'TNT assault');mark('tactical_tnt_breach_and_retreat');
 await tp(a,a.teamConfig().spawn.slice(0,3));
 for(const [id,material,enchant]of [['knockback_stick','stick','knockback'],['power_bow','bow','power'],['punch_bow','bow','punch']]){
  await purchase(a,id);const value=await admin('data','get','entity',a.name,`Inventory[{id:"minecraft:${material}"}].components."minecraft:enchantments".levels."minecraft:${enchant}"`);assert(/data: 1\b/.test(value),value);mark('enchanted_'+id);
 }
 for(const id of ['stone_pickaxe','stone_axe','diamond_axe']){await purchase(a,id);assert(a.count(id)>0);mark('tool_'+id);}
 await purchase(a,'water_bucket');await purchase(a,'sponge',4);await tp(a,[.5,65,2.5]);await a.equip('water_bucket');await a.bot.lookAt(new Vec3(.5,65,4.5),true);await sleep(150);a.bot.activateItem();await until(()=>a.bot.blockAt(new Vec3(0,65,4))?.name==='water');await a.equip('sponge');await a.bot._genericPlace(a.bot.blockAt(new Vec3(1,64,4)),new Vec3(0,1,0),{forceLook:true});await until(()=>a.bot.blockAt(new Vec3(1,65,4))?.name==='wet_sponge'&&a.bot.blockAt(new Vec3(0,65,4))?.name!=='water');mark('sponge_removes_water');
 await tp(a,a.teamConfig().spawn.slice(0,3));await admin('kill',a.name);await until(()=>me()?.mode==='SPECTATOR',5000,'death');await until(()=>me()?.mode==='SURVIVAL',10000,'respawn');await until(()=>a.bot.inventory.slots[8]?.name==='iron_boots');
 const spawn=a.teamConfig().spawn,drops=await admin('execute','as',`@e[type=minecraft:item,x=${spawn[0]},y=65,z=${spawn[2]},distance=..6]`,'run','data','get','entity','@s','Item');assert(!/iron_boots|iron_leggings|leather_helmet|leather_chestplate|wooden_pickaxe/.test(drops),drops);mark('permanent_gear_respawns_without_ground_duplicates');
 report.complete=true;
 }catch(e){report.complete=false;report.error=e.stack;console.error(e.stack);process.exitCode=1}
 finally{await admin('skyduel','abort');await admin('skyduel','lock');report.finished_at=new Date().toISOString();fs.writeFileSync('runs/tactics-verification.json',JSON.stringify(report,null,2));for(const agent of agents)agent.bot.quit();setTimeout(()=>process.exit(process.exitCode||0),500)}
})();
