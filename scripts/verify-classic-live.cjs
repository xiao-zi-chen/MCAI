// Real-client integration checks. Administrative setup is marked as a test by the referee.
const fs=require('node:fs'),path=require('node:path'),net=require('node:net'),assert=require('node:assert/strict');
const {execFile}=require('node:child_process');const {promisify}=require('node:util');
const mineflayer=require('./minecraft-client.cjs');const {Vec3}=require('../bot-controller/node_modules/vec3');
const rules=require('../competition/rules.json');const root=path.resolve(__dirname,'..');
const run=promisify(execFile),sleep=ms=>new Promise(r=>setTimeout(r,ms));
const report={started_at:new Date().toISOString(),rules_version:rules.version,tests:[]};
let state={phase:'waiting'};
const socket=net.createConnection(25600,'127.0.0.1');let buffer='';socket.on('data',d=>{buffer+=d;let n;while((n=buffer.indexOf('\n'))>=0){try{state=JSON.parse(buffer.slice(0,n))}catch{}buffer=buffer.slice(n+1)}});socket.on('error',console.error);
const clients=['RulesProbeA','RulesProbeB'].map(username=>mineflayer.createBot({host:'127.0.0.1',port:25567,username,auth:'offline',version:'1.21'}));
const bot=clients[0],other=clients[1];for(const [i,b]of clients.entries()){b.once('spawn',()=>setTimeout(()=>b.chat('/bw join SkyDuel'),1000+i*600));b.on('error',e=>console.error(b.username,e.message));b.on('kicked',r=>console.error(b.username,'kicked',r));}
async function admin(...args){return (await run(path.join(root,'.venv/Scripts/python.exe'),[path.join(root,'scripts/bedwars-rcon.py'),...args.map(String)],{windowsHide:true,timeout:15000})).stdout.trim()}
async function until(check,ms=10000,label='condition'){const end=Date.now()+ms;while(Date.now()<end){if(check())return;await sleep(100)}throw new Error(label+' timed out')}
function me(b=bot){return state.players?.find(p=>p.name===b.username)}
function count(name){return bot.inventory.items().filter(i=>i.name===name).reduce((n,i)=>n+i.count,0)}
function mark(name,data={}){report.tests.push({name,passed:true,...data});console.log('PASS',name,JSON.stringify(data));fs.writeFileSync(path.join(root,'runs/classic-verification.json'),JSON.stringify(report,null,2));}
async function teleport(b,x,y,z){await admin('tp',b.username,x,y,z);await until(()=>b.entity?.position.distanceTo(new Vec3(Number(x),Number(y),Number(z)))<1.2,5000,'teleport');await sleep(150)}
function names(item){return JSON.stringify({name:item.customName,nbt:item.nbt,components:item.components},(_,v)=>typeof v==='bigint'?String(v):v)}
async function shop(id){
 const entry=rules.shop.find(i=>i.id===id),loc=rules.map.teams[me().team].shop;
 await teleport(bot,loc[0],65,loc[2]+2);
 const npc=bot.nearestEntity(e=>e.name==='villager'&&e.position.distanceTo(new Vec3(loc[0],65,loc[2]))<1.5);assert(npc,'shop NPC exists');
 await bot.lookAt(npc.position.offset(0,1.4,0),true);await bot.activateEntity(npc);await until(()=>bot.currentWindow&&bot.currentWindow.slots.slice(0,bot.currentWindow.inventoryStart).some(Boolean),5000,'shop open');
 try{
  const slot=bot.currentWindow.slots.findIndex((i,n)=>n<bot.currentWindow.inventoryStart&&i&&(id==='wool'?i.name.endsWith('_wool'):i.name===entry.material)&&i.count===entry.amount&&(!entry.stack?.['display-name']||names(i).includes(entry.stack['display-name'])));
  if(slot<0){console.log('slots',bot.currentWindow.slots.map((i,n)=>i?{n,name:i.name,count:i.count,custom:i.customName}:null).filter(Boolean));throw new Error('Missing shop entry '+id)}
  await bot.clickWindow(slot,0,0);await sleep(400);
 }finally{if(bot.currentWindow)bot.closeWindow(bot.currentWindow)}
}
async function upgrade(id){
 const loc=rules.map.teams[me().team].upgrade_shop;await teleport(bot,loc[0],65,loc[2]+2);bot.chat('/teamshop');await until(()=>bot.currentWindow,5000,'team shop');
 const before=state.classic?.upgrades?.[me().team]?.[id]||0;
 try{const icon=rules.team_upgrades.find(u=>u.id===id).icon.toLowerCase();const slot=bot.currentWindow.slots.findIndex((i,n)=>n<27&&i?.name===icon);assert(slot>=0,'upgrade entry');await bot.clickWindow(slot,0,0);await until(()=>(state.classic?.upgrades?.[me().team]?.[id]||0)===before+1,4000,'upgrade applied');}finally{if(bot.currentWindow)bot.closeWindow(bot.currentWindow)}
}
async function consumePotion(id,effect){
 await shop(id);const entry=rules.shop.find(i=>i.id===id);const item=bot.inventory.items().find(i=>i.name==='potion'&&names(i).includes(entry.stack['display-name']));assert(item,'potion in inventory');
 await bot.equip(item,'hand');await bot.consume();await until(()=>me()?.effects?.some(e=>e.name===effect),5000,'potion effect');mark(id,{effect});
}
(async()=>{
 try{
  await until(()=>state.phase==='running'&&state.players?.length===2&&clients.every(b=>b.entity?.position.y<80),50000,'match start');report.match_id=state.match_id;
  await sleep(500);await admin('skyduel','test');assert(bot.inventory.slots[5]?.name==='leather_helmet');mark('initial_kit_and_two_teams',{teams:state.players.map(p=>p.team)});
  for(const currency of ['iron','gold','diamond','emerald'])await admin('skyduel','grant',bot.username,currency,128);
  await sleep(300);const gold=count('gold_ingot');await shop('iron_armor');await until(()=>bot.inventory.slots[8]?.name==='iron_boots');assert.equal(count('gold_ingot'),gold-12);mark('permanent_armor_purchase',{gold_spent:12});
  await shop('diamond_pickaxe');await until(()=>count('diamond_pickaxe')===1);mark('tool_purchase');
  await admin('kill',bot.username);await until(()=>me()?.mode==='SPECTATOR',4000,'death');await until(()=>me()?.mode==='SURVIVAL'&&bot.health===20,10000,'respawn');await until(()=>bot.inventory.slots[8]?.name==='iron_boots'&&count('iron_pickaxe')===1,5000,'persistent kit');mark('respawn_armor_retained_tool_downgraded',{position:me().pos});
  for(const currency of ['iron','gold','diamond','emerald'])await admin('skyduel','grant',bot.username,currency,128);
  for(const id of ['sharpness','protection','haste','forge','heal_pool','trap']){await upgrade(id);mark('team_'+id);}
  const sword=await admin('data','get','entity',bot.username,'Inventory[{Slot:0b}].components."minecraft:enchantments".levels."minecraft:sharpness"');const chest=await admin('data','get','entity',bot.username,'Inventory[{Slot:102b}].components."minecraft:enchantments".levels."minecraft:protection"');
  assert(/data: 1\b/.test(sword)&&/data: 1\b/.test(chest),sword+' / '+chest);mark('enchants_applied');
  await until(()=>me()?.effects?.some(e=>e.name==='haste'));mark('haste_effect');
  const spawn=rules.map.teams[me().team].spawn;await teleport(bot,...spawn.slice(0,3));await admin('damage',bot.username,8,'minecraft:generic');await until(()=>me()?.hp<20);const low=me().hp;await until(()=>me()?.hp>low,9000,'healing pool');mark('heal_pool_recovers_health',{initial_hp:low,after_hp:me().hp});
  await teleport(other,spawn[0]+2,65,spawn[2]);await until(()=>me(other)?.effects?.some(e=>e.name==='blindness'),4000,'trap trigger');assert.equal(state.classic.upgrades[me().team].trap,0);mark('trap_consumed_and_blindness_applied');const away=rules.map.teams[me(other).team].spawn;await teleport(other,...away.slice(0,3));
  await consumePotion('speed_potion','speed');await consumePotion('jump_potion','jump_boost');await consumePotion('invisibility_potion','invisibility');
  await shop('bow');await shop('arrow');assert(count('bow')===1&&count('arrow')>=8);mark('ranged_equipment_purchase');
  for(const id of ['tnt','fireball','water_bucket','ender_pearl','glass','ladder','shears']){await shop(id);assert(count(rules.shop.find(i=>i.id===id).material)>0,id+' received');mark('purchase_'+id);}
  await teleport(bot,.5,65,2.5);await bot.equip(bot.inventory.items().find(i=>i.name==='fire_charge'),'hand');await bot.look(0,1.1,true);const fireballs=count('fire_charge');bot.activateItem();await until(()=>count('fire_charge')<fireballs,5000,'fireball launched');mark('fireball_consumed_on_launch');
  await bot.equip(bot.inventory.items().find(i=>i.name==='ender_pearl'),'hand');await bot.lookAt(new Vec3(5.5,64.5,2.5),true);await sleep(150);const pearlStart=bot.entity.position.clone();const pearlCount=count('ender_pearl');bot.activateItem();await until(()=>count('ender_pearl')<pearlCount,3000,'pearl consumed');
  await sleep(1800);console.log('pearl landing',JSON.stringify({start:pearlStart,end:bot.entity.position,health:bot.health}));assert(bot.entity.position.distanceTo(pearlStart)>1,'pearl moved the player');mark('ender_pearl_teleports',{start:pearlStart,end:bot.entity.position});
  await teleport(bot,.5,65,2.5);await bot.equip(bot.inventory.items().find(i=>i.name==='water_bucket'),'hand');await bot.lookAt(new Vec3(.5,65,4.5),true);await sleep(150);bot.activateItem();await until(()=>bot.blockAt(new Vec3(0,65,4))?.name==='water',5000,'water placement');mark('water_bucket_placement');
  await teleport(bot,8.5,65,2.5);await bot.equip(bot.inventory.items().find(i=>i.name==='tnt'),'hand');await bot._genericPlace(bot.blockAt(new Vec3(8,64,4)),new Vec3(0,1,0),{forceLook:true});await until(()=>Object.values(bot.entities).some(e=>e.name==='tnt'),3000,'primed TNT');await teleport(bot,-8.5,65,2.5);await until(()=>state.events?.some(e=>e.type==='explosion'),8000,'TNT explosion');mark('tnt_auto_ignition_and_explosion');
  await admin('skyduel','phase','diamond_level');await until(()=>state.classic.stage==='diamond_level');mark('diamond_upgrade_phase');
  await admin('skyduel','phase','beds_gone');await until(()=>state.teams?.every(t=>!t.bed));mark('timed_bed_removal');
  await admin('skyduel','phase','sudden_death');await until(()=>state.classic.stage==='sudden_death');mark('sudden_death_border',{border:await admin('worldborder','get')});
  await admin('kill',other.username);await until(()=>state.winner===me().team,5000,'winner');mark('final_elimination');
  await until(()=>state.phase==='waiting',18000,'arena reset');mark('arena_reset');
  report.complete=true;report.finished_at=new Date().toISOString();
 }catch(error){report.complete=false;report.error=error.stack;console.error(error.stack);process.exitCode=1}
 finally{await admin('skyduel','lock');fs.writeFileSync(path.join(root,'runs/classic-verification.json'),JSON.stringify(report,null,2));for(const b of clients)b.quit();socket.destroy();setTimeout(()=>process.exit(process.exitCode||0),500)}
})();
