const fs=require('node:fs');
const fsp=fs.promises;
const path=require('node:path');
const {spawn}=require('node:child_process');
const {UnrecoverableError}=require('bullmq');
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function summarizeReplay(replay,m){
 if(replay.match_id!==m.id||replay.arena_id!==m.arena_id)throw Error('Replay does not match reservation');
 const started=replay.events?.find(e=>e.type==='match_start');
 if(started&&([...started.players].sort().join(',')!==m.players.map(p=>p.name).sort().join(',')))throw Error('Replay contains different entrants');
 const players=replay.frames?.find(f=>f.players?.length===2)?.players||[];
 const winner=players.find(p=>p.team===replay.winner);
 if(replay.status==='complete'&&replay.winner&&!winner)throw Error('Cannot determine winner identity');
 const counts={};for(const e of replay.events||[])counts[e.type]=(counts[e.type]||0)+1;
 return {match_id:m.id,arena_id:m.arena_id,status:replay.status,reason:replay.reason,winner:replay.winner,winner_id:replay.status==='complete'?winner?.name||'':'',duration_seconds:(replay.frames?.at(-1)?.tick||0)/20,event_counts:counts,players:m.players.map(p=>p.id),saved_at:Date.now(),rules_version:replay.rules_version};
}
class Driver{
 constructor({root,config,store,control}){this.root=root;this.config=config;this.store=store;this.control=control;this.children=new Map();}
 async arena(id){const data=await this.control.request('status');const a=data.arenas.find(a=>a.arena_id===id);if(!a)throw Error('Missing configured arena');return a;}
 async launch(m){
 const arena=this.config.arenas.find(a=>a.id===m.arena_id);const report=path.join(this.root,'runs/scheduler/matches',m.id);await fsp.mkdir(report,{recursive:true});
 const out=fs.openSync(path.join(report,'agents.out.log'),'a'),err=fs.openSync(path.join(report,'agents.err.log'),'a');
 const child=spawn(process.execPath,[path.join(this.root,'scripts/showcase-v2.cjs'),`--scheduler-match=${m.id}`],{cwd:this.root,windowsHide:true,detached:true,stdio:['ignore',out,err],env:{...process.env,SKYDUEL_ROSTER:JSON.stringify(m.players),SKYDUEL_MATCH_ID:m.id,SKYDUEL_ARENA_NAME:arena.name,SKYDUEL_OBSERVER_PORT:String(arena.observer_port),SKYDUEL_REPORT_DIR:report,BEDWARS_PORT:String(this.config.game_port),SKYDUEL_MAX_RUNTIME_MS:String(this.config.match_timeout_ms||2200000)}});
 fs.closeSync(out);fs.closeSync(err);child.on('error',e=>console.error('AI launch failed',m.id,e.message));child.unref();this.children.set(m.id,child);
 await fsp.writeFile(path.join(report,'process.json'),JSON.stringify({pid:child.pid,match_id:m.id,arena_id:m.arena_id,started_at:Date.now()}));
 await this.store.event('agents_launched',{match_id:m.id,arena_id:m.arena_id,names:m.players.map(p=>p.id),pid:child.pid});
 }
 async run(m){
 let a=await this.arena(m.arena_id);const prior=await this.store.result(m.id);
 if(prior&&a.state==='available'){if(a.last_released!==`${m.id}/${m.token}`)throw new UnrecoverableError('Saved result has no matching release receipt; reconcile arena');await this.store.release(m);return prior;}
 if(a.state==='available')a=await this.control.command('reserve',m,{players:m.players.map(p=>p.name)});
 if(a.task_id!==m.id||a.state==='quarantined')throw new UnrecoverableError(`Arena needs reconciliation: ${a.error||a.state}`);
 if(!a.launched){const grant=await this.control.command('launch',m);if(grant.granted)await this.launch(m);}
 let lastState='',result=prior,resetSince=0;
 for(;;){
  a=await this.arena(m.arena_id);
  if(a.task_id!==m.id)throw new UnrecoverableError('Arena task changed unexpectedly');
  if(a.state==='quarantined')throw new UnrecoverableError(a.error);
  if(a.state!==lastState){lastState=a.state;await this.store.setState(m,lastState);await this.store.event('arena_state',{match_id:m.id,arena_id:m.arena_id,state:lastState,players:a.players});}
  if(a.saved&&!result){const replay=JSON.parse(await fsp.readFile(path.resolve(this.root,this.config.server_root,'plugins/SkyDuelReferee/replays',m.id+'.json'),'utf8'));result=summarizeReplay(replay,m);await this.store.saveResult(m,result);resetSince=Date.now();}
  if(a.state==='ready_to_release'){
   if(!result)throw Error('Missing durable result');
   await this.control.command('release',m);await this.store.release(m);
   this.children.get(m.id)?.kill();this.children.delete(m.id);return result;
  }
  if(result&&!resetSince)resetSince=Date.now();
  if(resetSince&&Date.now()-resetSince>(this.config.reset_timeout_ms||120000)){
   await this.control.command('quarantine',m);throw new UnrecoverableError('Map reset did not complete; arena quarantined');
  }
  const age=Date.now()-m.created_at;
  if(!a.started_id&&age>(this.config.join_timeout_ms||90000))await this.control.command('abort',m);
  else if(age>(this.config.match_timeout_ms||2200000))await this.control.command('abort',m);
  await sleep(this.config.poll_ms||1000);
 }
 }
}
module.exports={Driver,summarizeReplay};
