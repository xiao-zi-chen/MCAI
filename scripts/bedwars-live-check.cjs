// Developer smoke client for the dedicated local server; not a submitted strategy.
const mineflayer = require('../bot-controller/node_modules/mineflayer');
const readline = require('node:readline');
const bot = mineflayer.createBot({host:'127.0.0.1',port:25567,username:'BedProbe',auth:'offline',version:'1.21'});
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const count = suffix => bot.inventory.items().filter(i => i.name.endsWith(suffix)).reduce((a,i) => a+i.count,0);
async function until(check, ms=20000) { const end=Date.now()+ms; while(Date.now()<end){if(check())return;await delay(100)}throw new Error('Condition timed out'); }
function state(){return {position:bot.entity?.position,gameMode:bot.game?.gameMode,health:bot.health,inventory:bot.inventory.items().map(i=>({name:i.name,count:i.count})),beds:[-38,38].map(x=>({x,name:bot.blockAt(bot.entity.position.clone().set(x,65,0))?.name}))};}
async function walk(target){
  const end=Date.now()+15000;
  try { while(bot.entity.position.distanceTo(target)>0.7){
    if(Date.now()>end)throw new Error('Walk timed out');
    await bot.lookAt(target.offset(0,1.4,0),true);
    bot.setControlState('forward',true);
    await delay(100);
  }} finally {bot.clearControlStates()}
}
async function shop(){
  const side=Math.sign(bot.entity.position.x);
  const point=(x,y,z)=>bot.entity.position.clone().set(x,y,z);
  await walk(point(side<0?-44.5:45.5,65,3.5));
  await until(()=>count('iron_ingot')>=8,20000);
  const iron=count('iron_ingot');
  await walk(point(side<0?-40.5:40.5,65,-2.5));
  const villager=bot.nearestEntity(e=>e.name==='villager');
  if(!villager)throw new Error('Missing shop villager');
  await bot.lookAt(villager.position.offset(0,1.4,0),true);
  await bot.activateEntity(villager);
  await until(()=>bot.currentWindow,5000);
  const slot=bot.currentWindow.slots.findIndex(i=>i?.name.endsWith('_wool'));
  if(slot<0)throw new Error('Wool not listed');
  await bot.clickWindow(slot,0,0);
  await until(()=>count('_wool')>=16,5000);
  if(bot.currentWindow)bot.closeWindow(bot.currentWindow);
  console.log(JSON.stringify({test:'shop',passed:true,ironBefore:iron,ironAfter:count('iron_ingot'),wool:count('_wool')}));
}
bot.once('spawn',()=>setTimeout(()=>bot.chat('/bw join SkyDuel'),1500));
bot.on('spawn',()=>console.log('spawn',JSON.stringify(state())));
bot.on('messagestr',text=>console.log('chat',text));
bot.on('error',error=>console.error(error.message));
bot.on('end',reason=>{console.log('end',reason);process.exit()});
let chain=Promise.resolve();
readline.createInterface({input:process.stdin}).on('line',line=>{
 chain=chain.then(async()=>{
  if(line.trim()==='state')console.log(JSON.stringify(state()));
  else if(line.trim()==='shop')await shop();
  else if(line.trim()==='bed'){
   const bed=bot.findBlock({matching:b=>b.name.endsWith('_bed'),maxDistance:4});
   if(!bed)throw new Error('No bed within reach');
   await bot.dig(bed,true);await delay(500);console.log(JSON.stringify({test:'bed-break',block:bed.position,after:bot.blockAt(bed.position)?.name}));
  }else if(line.trim()==='quit')bot.quit();
 }).catch(error=>console.error('CHECK FAILED',error.stack));
});
