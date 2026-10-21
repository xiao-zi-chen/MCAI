// Analyze completed referee records without changing or choosing match outcomes.
const fs=require('node:fs'),path=require('node:path');
function analyze(record){
 const detailed=record.frames[0]?.players.some(p=>Object.hasOwn(p,'damage_tick'));
 const result={id:record.match_id,status:record.status,rules_version:record.rules_version,map:record.rules?.map.id,seconds:record.frames.at(-1)?.tick/20,winner:record.winner,events:{},players:{}};
 for(const e of record.events)result.events[e.type]=(result.events[e.type]||0)+1;
 for(const name of new Set(record.frames.flatMap(f=>f.players.map(p=>p.name)))){
  let previous=null,priorTick=0,still=0,longest=0,stillAt=null,travel=0,nearStill=0;
  for(const frame of record.frames){
   const p=frame.players.find(p=>p.name===name);if(!p)continue;
   if(p.mode==='SURVIVAL'&&previous?.mode==='SURVIVAL'){
    const dt=(frame.tick-priorTick)/20,d=Math.hypot(...p.pos.map((v,i)=>v-previous.pos[i]));
    if(d<6)travel+=Math.hypot(p.pos[0]-previous.pos[0],p.pos[2]-previous.pos[2]);
    if(d<.03){still+=dt;if(still>longest){longest=still;stillAt=p.pos;}const enemy=frame.players.find(q=>q.name!==name&&q.mode==='SURVIVAL');if(enemy&&Math.hypot(...p.pos.map((v,i)=>v-enemy.pos[i]))<3.2)nearStill+=dt;}else still=0;
   }else still=0;
   previous=p;priorTick=frame.tick;
  }
  const attacks=record.events.filter(e=>e.type==='damage'&&e.attacker===name&&e.cause==='ENTITY_ATTACK');
  const deaths=record.events.filter(e=>e.type==='death'&&e.player===name).map(e=>{
   const damage=record.events.filter(d=>d.type==='damage'&&d.player===name&&d.tick<=e.tick);
   return {tick:e.tick,killer:e.killer,last_cause:damage.at(-1)?.cause||'not_recorded',recent_opponent_hit:damage.some(d=>d.attacker&&e.tick-d.tick<120)};
  });
  result.players[name]={team:record.frames.find(f=>f.players.some(p=>p.name===name))?.players.find(p=>p.name===name)?.team,
   travel_blocks:+travel.toFixed(1),longest_still_seconds:+longest.toFixed(1),longest_still_position:stillAt,still_with_opponent_in_reach_seconds:+nearStill.toFixed(1),
   melee_hits:detailed?attacks.length:null,melee_damage:detailed?+attacks.reduce((n,e)=>n+e.amount,0).toFixed(1):null,deaths,
   bridge_blocks:record.events.filter(e=>e.type==='block_place'&&e.player===name&&e.pos[1]===record.rules.map.surface_y).length,
   sword_swings:detailed?record.events.filter(e=>e.type==='swing'&&e.player===name&&e.item.endsWith('_SWORD')).length:null};
 }
 return result;
}
if(require.main===module){const dir=path.join(__dirname,'../runs/bedwars-local/plugins/SkyDuelReferee/replays');for(const id of process.argv.slice(2)){if(!/^[a-f0-9-]{36}$/.test(id))throw new Error('Invalid match id');console.log(JSON.stringify(analyze(JSON.parse(fs.readFileSync(path.join(dir,id+'.json'),'utf8'))),null,2));}}
module.exports={analyze};
