const {memoryBudget,hasHeadroom,readyBackends}=require('./resources.cjs');
const fs=require('node:fs');
const fsp=fs.promises;
const path=require('node:path');
const os=require('node:os');
const http=require('node:http');
const crypto=require('node:crypto');
const {spawn}=require('node:child_process');
const Redis=require('ioredis');
const {Queue,Worker}=require('bullmq');
const {Store}=require('./store.cjs');
const {ControlPool}=require('./control-pool.cjs');
const {backendFor}=require('./backends.cjs');
const {Driver}=require('./driver.cjs');
const {renewOrAcquire}=require('./ownership.cjs');
const root=path.resolve(__dirname,'..');
const configPath=path.resolve(root,process.env.SKYDUEL_SCHEDULER_CONFIG||'configs/scheduler.local.json');
const config=JSON.parse(fs.readFileSync(configPath,'utf8'));
const connection={host:'127.0.0.1',port:config.redis_port||26379,maxRetriesPerRequest:null};
const redis=new Redis(connection);redis.on('error',e=>console.error('Redis',e.message));
const rules=require('../scripts/match-format.cjs').loadRules(config.rules_file||'competition/rules.json');
const format={teams:Object.keys(rules.map.teams),players_per_team:rules.match.players_per_team};
const modelProfiles=config.model_profiles_file?JSON.parse(fs.readFileSync(path.resolve(root,config.model_profiles_file),'utf8')).profiles:[];
if(modelProfiles.length&&(modelProfiles.length!==format.teams.length*format.players_per_team||new Set(modelProfiles.map(p=>p.id)).size!==modelProfiles.length))throw Error('Model profiles must provide one unique actor per seat');
const store=new Store(redis,config.namespace||'skyduel-local',format,modelProfiles.length?modelProfiles.map(p=>p.id):['EmberAI','BastionAI']);
const control=new ControlPool(config);
const driver=new Driver({root,config,store,control});
const owner=crypto.randomUUID(),queues=new Map(),workers=[],viewers=new Map();
const healthySince=new Map();
let requestShutdown;
let cached={arenas:[]},lastControlAt=0,lastError='',paused=false,maxActive=config.max_active||2,stopping=false,busy=false,leader=false,gate='starting',lastAdmission=0;
async function dispatch(){if(busy||stopping)return;busy=true;try{
 leader=await renewOrAcquire(redis,store.k('coordinator'),owner);if(!leader){gate='coordinator_lease_lost';return;}
 const settings=await redis.hmget(store.k('settings'),'paused','max_active');paused=settings[0]==='1';maxActive=settings[1]===null?(config.max_active||2):Number(settings[1]);
 cached=await control.request('status');lastControlAt=Date.now();lastError='';
 const budget=memoryBudget();
 const eligible=readyBackends(cached.performance.backends,config,healthySince);
 gate=paused?'paused':!hasHeadroom(budget,config)?'memory_pressure':!eligible.size?'tick_pressure':'open';
 let occupied=Object.keys(await redis.hgetall(store.k('slots'))).length;
 for(const arena of config.arenas){
  let m=await store.active(arena.id);const state=cached.arenas.find(a=>a.arena_id===arena.id),backendState=cached.performance.backends.find(s=>s.server_id===backendFor(config,arena.id).id);
  if(!m&&gate==='open'&&occupied<maxActive&&state?.state==='available'&&eligible.has(backendState?.server_id)&&Date.now()-lastAdmission>=(config.admission_interval_ms??5000)){
   // Reserve headroom before starting a process; stagger startups so real RSS can settle.
   if(!hasHeadroom(memoryBudget(),config,config.admission_reserve_mb??256)){gate='memory_headroom';continue;}
   m=await store.allocate(arena.id);if(m){occupied++;lastAdmission=Date.now();await store.event('match_reserved',{match_id:m.id,arena_id:arena.id,players:m.players.map(p=>p.id)});}
  }
  // Reconcile an allocation committed just before a process crash, using the same job ID.
  if(m){const q=queues.get(arena.id);if(!await q.getJob(m.id))await q.add('match',m,{jobId:m.id,attempts:5,backoff:{type:'fixed',delay:3000},removeOnComplete:{count:1000},removeOnFail:{count:1000}});}
 }
}catch(e){healthySince.clear();lastError=e.message;gate='control_unavailable';}finally{busy=false;}}
async function snapshot(){const data=await store.snapshot();return {...data,format,model_profiles:modelProfiles,title:rules.title,attribution:rules.map.attribution||'',namespace:config.namespace||'skyduel-local',now:Date.now(),paused,max_active:maxActive,capacity:config.arenas.length,gate,error:lastError,control_updated_at:lastControlAt,metrics:{...memoryBudget(),scheduler_rss_mb:Math.round(process.memoryUsage().rss/1048576),tps:cached.tps,mspt:cached.mspt,...cached.performance},arenas:config.arenas.map(a=>{const s=cached.arenas.find(s=>s.arena_id===a.id)||{};const {last_released,...safe}=s;return {...a,...safe};})};}
async function demo(count,rounds=1){if(!Number.isInteger(count)||count<1||count>1000||!Number.isInteger(rounds)||rounds<1||rounds>100)throw Error('Count 1–1000 and rounds 1–100 required');
 const values=[];for(let i=0;i<count;i++){const n=await redis.incr(store.k('entrant_seq'));const id='AI_'+String(n).padStart(5,'0'),profile=modelProfiles[i%modelProfiles.length];const model=profile?.id||(n%2?'EmberAI':'BastionAI'),style=profile?.style||(n%4<2?'rush':'fortify');values.push(await store.add({id,model,style,seed:1000+n*7919,rounds,label:profile?profile.display_name+' · '+profile.specialty:`${model==='EmberAI'?'余烬':'堡垒'} · ${style==='rush'?'突袭':'稳健'} ${n}`}));}await store.event('entrants_added',{count,rounds,ids:values.map(e=>e.id)});return values;}
async function watch(id){const arena=config.arenas.find(a=>a.id===id);if(!arena)throw Error('Unknown arena');const backend=backendFor(config,id);let child=viewers.get(id);
 const port=arena.viewer_port;const url=`http://127.0.0.1:${port}/`;
 let reuse=Boolean(child&&child.exitCode===null&&child.signalCode===null&&!child.killed);
 try{const response=await fetch(url+'status',{signal:AbortSignal.timeout(500)});if(response.ok){reuse=true;const status=await response.json();if(status.arena_id!==id||status.gameAddress!==`127.0.0.1:${backend.game_port}`){const error=Error('Viewer port belongs to another arena');error.foreignViewer=true;throw error;}if(status.connected)return {url};}}catch(e){if(e.foreignViewer)throw e;}
 if(!reuse){const logs=path.join(root,config.scheduler_root||'runs/scheduler');const out=fs.openSync(path.join(logs,`${id}-viewer.out.log`),'a'),err=fs.openSync(path.join(logs,`${id}-viewer.err.log`),'a');
 const viewerModules=process.env.BEDWARS_VIEWER_MODULES||(fs.existsSync(path.join(root,'local-viewer/node_modules'))?path.join(root,'local-viewer/node_modules'):'D:/codex-local-cache/skyduel-viewer/node_modules');
 child=spawn(process.execPath,[path.join(root,'local-viewer/server.cjs'),`--scheduler-config=${configPath}`,`--arena=${id}`],{cwd:root,windowsHide:true,stdio:['ignore',out,err],env:{...process.env,SKYDUEL_SCHEDULER_ROOT:path.resolve(root,config.scheduler_root||'runs/scheduler'),SKYDUEL_RULES_FILE:config.rules_file||'competition/rules.json',BEDWARS_VIEWER_MODULES:viewerModules,BEDWARS_VIEW_PORT:String(port),BEDWARS_PORT:String(backend.game_port),SKYDUEL_OBSERVER_PORT:String(arena.observer_port),SKYDUEL_CAMERA_NAME:`Camera_${id.replace(/-/g,'_')}`,SKYDUEL_WORLD:arena.world,SKYDUEL_ARENA_ID:id,SKYDUEL_SERVER_ROOT:backend.server_root,SKYDUEL_VIEWER_IDLE_MS:String(config.viewer_idle_ms??180000)}});
 fs.closeSync(out);fs.closeSync(err);child.on('error',e=>console.error(e.message));viewers.set(id,child);await fsp.writeFile(path.join(logs,`${id}-viewer.pid`),String(child.pid));}
 for(let attempt=0;attempt<120;attempt++){try{const r=await fetch(url+'status',{signal:AbortSignal.timeout(500)});if(r.ok&&(await r.json()).connected)return {url};}catch{}await new Promise(r=>setTimeout(r,500));}throw Error('Viewer did not become ready; inspect viewer log');}
async function body(req){let data='';for await(const chunk of req){data+=chunk;if(data.length>16384)throw Error('Request too large');}return JSON.parse(data||'{}');}
const server=http.createServer(async(req,res)=>{try{
 const url=new URL(req.url,'http://127.0.0.1');const host=`127.0.0.1:${config.web_port||3009}`;
 if(req.headers.host!==host&&req.headers.host!==`localhost:${config.web_port||3009}`){res.writeHead(403).end();return;}
 const json=value=>{res.writeHead(200,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(value));};
 if(req.method==='GET'&&url.pathname==='/'){res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});res.end(await fsp.readFile(path.join(__dirname,'index.html')));return;}
 if(req.method==='GET'&&url.pathname==='/api/status'){json(await snapshot());return;}
 if(req.method!=='POST'){res.writeHead(404).end();return;}
 if(!req.headers['content-type']?.startsWith('application/json')||(req.headers.origin&&!['http://'+host,`http://localhost:${config.web_port||3009}`].includes(req.headers.origin))){res.writeHead(403).end();return;}
 const data=await body(req);
 if(url.pathname==='/api/shutdown'){if(!requestShutdown)throw Error('Coordinator is not ready');json({stopping:true});setImmediate(()=>requestShutdown().catch(e=>{console.error(e);process.exitCode=1;}));return;}
 if(url.pathname==='/api/demo'){json({entrants:await demo(Number(data.count||2),Number(data.rounds||1))});return;}
 if(url.pathname==='/api/pause'){await redis.hset(store.k('settings'),'paused',data.paused?'1':'0');await store.event('admission_changed',{paused:Boolean(data.paused)});await dispatch();json({paused:Boolean(data.paused)});return;}
 if(url.pathname==='/api/capacity'){const n=Number(data.max_active);if(!Number.isInteger(n)||n<0||n>config.arenas.length)throw Error('Invalid capacity');await redis.hset(store.k('settings'),'max_active',n);await store.event('capacity_changed',{max_active:n});await dispatch();json({max_active:n});return;}
 if(url.pathname==='/api/withdraw'){json({withdrawn:Boolean(await store.withdraw(data.id))});return;}
 if(url.pathname==='/api/retry'){const m=await store.active(data.arena_id);if(!m)throw Error('No active reservation');const job=await queues.get(m.arena_id).getJob(m.id);if(await job?.getState()!=='failed')throw Error('Job is not failed');await job.retry();json({retried:m.id});return;}
 if(url.pathname==='/api/watch'){json(await watch(data.arena_id));return;}
 res.writeHead(404).end();
 }catch(e){res.writeHead(400,{'Content-Type':'application/json; charset=utf-8'}).end(JSON.stringify({error:e.message}));}});
async function main(){
 const deadline=Date.now()+18000;while(!await redis.set(store.k('coordinator'),owner,'PX',15000,'NX')){if(Date.now()>deadline)throw Error('Another scheduler owns this namespace');await new Promise(r=>setTimeout(r,500));}leader=true;
 const memory=await redis.config('GET','maxmemory-policy');if(memory[1]!=='noeviction')throw Error('Dedicated Redis must use noeviction');
 const persistence=await redis.config('GET','appendonly'),fsync=await redis.config('GET','appendfsync');if(persistence[1]!=='yes'||fsync[1]!=='always')throw Error('Local scheduler requires appendonly yes and appendfsync always');
 await fsp.mkdir(path.join(root,config.scheduler_root||'runs/scheduler'),{recursive:true});
 for(const a of config.arenas){const name=`bedwars-${a.id}`,prefix=`${store.prefix}-bull`;queues.set(a.id,new Queue(name,{connection,prefix}));
 const worker=new Worker(name,job=>driver.run(job.data),{connection,prefix,concurrency:1,lockDuration:30000,stalledInterval:15000,maxStalledCount:2});
 worker.on('error',e=>console.error('Worker',a.id,e.message));worker.on('failed',(job,e)=>{console.error('Match failed',job?.id,e.message);if(job)store.event('worker_failed',{match_id:job.id,arena_id:a.id,error:e.message}).catch(console.error)});workers.push(worker);}
 await store.event('scheduler_started',{pid:process.pid});
 await dispatch();const timer=setInterval(dispatch,1000);
 server.listen(config.web_port||3009,'127.0.0.1',()=>console.log(`Local scheduler: http://127.0.0.1:${config.web_port||3009}/`));
 async function shutdown(){if(stopping)return;stopping=true;clearInterval(timer);for(const child of viewers.values())child.kill();await Promise.all(workers.map(w=>w.pause(true)));await Promise.all(workers.map(w=>w.close()));await Promise.all([...queues.values()].map(q=>q.close()));await redis.eval(`if redis.call('GET',KEYS[1])==ARGV[1] then return redis.call('DEL',KEYS[1]) end;return 0`,1,store.k('coordinator'),owner);control.close();await redis.quit();server.close(()=>process.exit(0));}
 requestShutdown=shutdown;
 process.on('SIGINT',shutdown);process.on('SIGTERM',shutdown);
}
if(require.main===module)main().catch(e=>{console.error(e);process.exit(1)});
