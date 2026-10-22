const crypto=require('node:crypto');
const {backends,backendFor}=require('../local-scheduler/backends.cjs');
// Diagnostic management sampler, never part of the AI action loop.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {execFileSync}=require('node:child_process');
const root=path.resolve(__dirname,'..'),sleep=ms=>new Promise(r=>setTimeout(r,ms));
function options(args){const out={};for(const arg of args){const m=/^--([a-z-]+)=(.+)$/.exec(arg);if(!m)throw Error('Use --option=value');out[m[1]]=m[2];}return out;}
function percentile(values,q){if(!values.length)return null;const a=[...values].sort((x,y)=>x-y);return a[Math.max(0,Math.ceil(a.length*q)-1)];}
function summarize(samples,target){
 const steady=samples.filter(s=>s.steady&&s.active_arenas===target);
 return {samples:samples.length,steady_full_samples:steady.length,max_actual_ai:Math.max(0,...samples.map(s=>s.actual_ai)),min_free_mb:Math.min(...samples.map(s=>s.metrics.free_mb)),
  tps_min:steady.length?Math.min(...steady.map(s=>s.metrics.tps)):null,mean_mspt_p50:percentile(steady.map(s=>s.metrics.mspt),.5),
  tick_window_p95_max_ms:steady.length?Math.max(...steady.map(s=>s.metrics.tick_window?.p95_ms??Infinity)):null,
  tick_max_ms:steady.length?Math.max(...steady.map(s=>s.metrics.tick_window?.max_ms??Infinity)):null,
  tick_window_samples:steady[0]?.metrics.tick_window?.count||0,gates:[...new Set(samples.map(s=>s.gate))]};
}
function pressureReasons(row,config,args={}){
 const reasons=[];
 if(row.metrics.free_mb<Number(args['min-free']||config.min_free_mb||512))reasons.push('host_memory');
 if(row.metrics.cgroup_free_mb!==undefined&&row.metrics.cgroup_free_mb<512)reasons.push('cgroup_memory');
 if(row.host_cpu_percent>85)reasons.push('host_cpu');
 if(row.disk_free_gb<Number(args['min-disk-gb']||10))reasons.push('disk');
 if(row.control_age_ms>5000)reasons.push('control_stale');
 if(row.metrics.backends?.some(s=>!s.available))reasons.push('backend_unavailable');
 if(args.mode!=='overload'&&row.steady&&row.metrics.tick_window?.p95_ms>50)reasons.push('tick_latency');
 return reasons;
}
function ownedResources(config){
 const result={at:Date.now(),processes:[]};
 if(process.platform==='linux'){
  for(const id of fs.readdirSync('/proc').filter(x=>/^\d+$/.test(x))){
   try{const cwd=fs.realpathSync(`/proc/${id}/cwd`);if(cwd!==root&&!cwd.startsWith(root+'/'))continue;
    const stat=fs.readFileSync(`/proc/${id}/stat`,'utf8'),fields=stat.slice(stat.lastIndexOf(')')+2).split(' '),status=fs.readFileSync(`/proc/${id}/status`,'utf8');
    const command=fs.readFileSync(`/proc/${id}/cmdline`,'utf8').replaceAll('\0',' '),name=stat.slice(stat.indexOf('(')+1,stat.lastIndexOf(')'));
    const role=name==='java'?'minecraft':name.startsWith('redis')?'redis':command.includes('showcase-v2.cjs')?'ai':command.includes('local-scheduler/server.cjs')?'scheduler':command.includes('local-viewer/server.cjs')?'viewer':'diagnostic';
    result.processes.push({pid:Number(id),role,server_id:backends(config).find(s=>cwd===path.resolve(root,s.server_root))?.id,rss_mb:Number(/VmRSS:\s+(\d+)/.exec(status)?.[1]||0)/1024,cpu_seconds:(Number(fields[11])+Number(fields[12]))/100});
   }catch{}
  }
  try{const pid=fs.readFileSync(path.join(root,backends(config)[0].server_root,'server.pid'),'utf8').trim(),group=fs.readFileSync(`/proc/${pid}/cgroup`,'utf8').split('\n').find(s=>s.startsWith('0::'))?.slice(3),base='/sys/fs/cgroup'+group;
   if(group&&group!=='/')result.cgroup={memory_mb:Number(fs.readFileSync(base+'/memory.current','utf8'))/1048576,memory_peak_mb:Number(fs.readFileSync(base+'/memory.peak','utf8'))/1048576,memory_max:fs.readFileSync(base+'/memory.max','utf8').trim(),cpu_max:fs.readFileSync(base+'/cpu.max','utf8').trim(),cpu_stat:fs.readFileSync(base+'/cpu.stat','utf8').trim(),memory_events:fs.readFileSync(base+'/memory.events','utf8').trim()};
  }catch{}
 }else if(process.platform==='win32'){
  try{result.processes=JSON.parse(execFileSync('powershell',['-NoProfile','-ExecutionPolicy','Bypass','-File',path.join(root,'scripts/stress-resources.ps1'),'-Repo',root,'-ServerRoot',backends(config)[0].server_root],{encoding:'utf8',windowsHide:true,timeout:10000}));}catch(e){result.error=e.message;}
 }
 result.total_rss_mb=result.processes.reduce((n,p)=>n+p.rss_mb,0);return result;
}
let lastCpu;
function hostCpu(){const c=os.cpus().reduce((a,c)=>{a.idle+=c.times.idle;a.total+=Object.values(c.times).reduce((n,t)=>n+t,0);return a},{idle:0,total:0});const value=lastCpu?100*(1-(c.idle-lastCpu.idle)/(c.total-lastCpu.total)):0;lastCpu=c;return value;}
function benchmarkLock(file){
 fs.mkdirSync(path.dirname(file),{recursive:true});const token=crypto.randomUUID();
 for(let attempt=0;attempt<2;attempt++){
  try{fs.writeFileSync(file,JSON.stringify({pid:process.pid,token}),{flag:'wx'});return ()=>{try{if(JSON.parse(fs.readFileSync(file,'utf8')).token===token)fs.unlinkSync(file);}catch{}};}
  catch(e){if(e.code!=='EEXIST')throw e;const old=JSON.parse(fs.readFileSync(file,'utf8'));let alive=true;try{process.kill(old.pid,0);}catch(err){if(err.code==='ESRCH')alive=false;}
   if(alive)throw Error('Another benchmark is still sampling, draining or validating this coordinator');fs.unlinkSync(file);
  }
 }
 throw Error('Could not acquire benchmark lock');
}
async function main(){
 const args=options(process.argv.slice(2)),config=JSON.parse(fs.readFileSync(path.resolve(root,args.config||'configs/scheduler.stress.json'),'utf8'));
 const levels=(args.levels||'2,4,6,8').split(',').map(Number),seconds=Number(args.seconds||120),warmup=Number(args.warmup||30),minimum=Number(args['min-steady']||60),drain=Number(args['drain-seconds']||1200),count=Number(args.entrants||Math.max(...levels)*8);
 if(levels.some(n=>!Number.isInteger(n)||n<1||n>config.arenas.length)||seconds<minimum||minimum<10||warmup<0||count<2*Math.max(...levels)||count>1000)throw Error('Invalid benchmark options');
 const api=async(name,data)=>{const r=await fetch(`http://127.0.0.1:${config.web_port}/api/${name}`,{method:data?'POST':'GET',headers:data?{'Content-Type':'application/json'}:undefined,body:data?JSON.stringify(data):undefined,signal:AbortSignal.timeout(name==='watch'?25000:5000)});const d=await r.json();if(!r.ok)throw Error(d.error||r.status);return d;};
 let initial=await api('status');if(initial.namespace&&initial.namespace!==config.namespace)throw Error('Benchmark configuration does not match the running coordinator');const waitDeadline=Date.now()+Number(args['wait-drained']||0)*1000;
 if(initial.arenas.some(a=>a.task_id)&&args['wait-drained'])console.log(JSON.stringify({waiting_for_previous_matches:true,timeout_seconds:Number(args['wait-drained'])}));
 while(initial.arenas.some(a=>a.task_id)&&Date.now()<waitDeadline){await sleep(5000);initial=await api('status');}
 if(initial.arenas.some(a=>a.task_id)||initial.entrants.some(e=>e.state==='waiting'))throw Error('Start with drained arenas and no other waiting entrants');
 const mode=args.mode||'capacity';if(!['capacity','overload'].includes(mode))throw Error('Mode must be capacity or overload');
 const dir=path.join(root,'runs/stress',new Date().toISOString().replaceAll(/[:.]/g,'-'));fs.mkdirSync(dir,{recursive:true});
 const report={mode,started_at:new Date().toISOString(),platform:process.platform,cpu:os.cpus()[0]?.model,logical_cpus:os.cpus().length,total_ram_mb:os.totalmem()/1048576,config:path.relative(root,path.resolve(root,args.config||'configs/scheduler.stress.json')),parameters:{levels,seconds,warmup,minimum,count,drain},backends:backends(config),stages:[],invariant_errors:[],warnings:[],entrants:[],resources:[],transitions:[],stop_reason:'',completed:false};
 const save=()=>fs.writeFileSync(path.join(dir,'report.json'),JSON.stringify(report,null,2));const append=(file,row)=>fs.appendFileSync(path.join(dir,file),JSON.stringify(row)+'\n');
 let allocationRedis,allocationStore,lastForcedAdmission=0;
 if(mode==='overload'){const Redis=require('../local-scheduler/node_modules/ioredis');allocationRedis=new Redis({host:'127.0.0.1',port:config.redis_port,maxRetriesPerRequest:1});allocationStore=new (require('../local-scheduler/store.cjs').Store)(allocationRedis,config.namespace);}
 let owned=new Set(),previous=new Map(),signaled=false,lastResource=0,lastStatus=initial;process.on('SIGINT',()=>{signaled=true});process.on('SIGTERM',()=>{signaled=true});
 function inspect(s){
  const active=s.arenas.filter(a=>a.task_id&&a.assigned?.some(id=>owned.has(id))),players=active.flatMap(a=>a.players||[]);
  if(new Set(players).size!==players.length)report.invariant_errors.push({at:Date.now(),error:'duplicate player in active arenas'});
  for(const a of active){for(const id of a.players||[])if(!a.assigned.includes(id))report.invariant_errors.push({at:Date.now(),error:'foreign player',arena:a.id,player:id});}
  for(const m of s.matches.filter(m=>m.players.some(p=>owned.has(p.id))))if(previous.get(m.id)!==m.state){report.transitions.push({at:Date.now(),match_id:m.id,arena_id:m.arena_id,state:m.state,created_at:m.created_at});previous.set(m.id,m.state);}
  const running=active.filter(a=>a.state==='running'&&a.players?.length===2);
  return {active_arenas:running.length,actual_ai:running.reduce((n,a)=>n+a.players.length,0),occupied:active.length};
 }
 async function sample(stage,steady){
  const s=await api('status');lastStatus=s;const row={at:Date.now(),stage,steady,...inspect(s),metrics:s.metrics,gate:s.gate,control_age_ms:Date.now()-s.control_updated_at,host_cpu_percent:hostCpu(),matches:s.arenas.map(a=>({arena:a.id,state:a.state,id:a.task_id,players:a.players}))};
  row.ai_runtime=[];for(const a of s.arenas.filter(a=>a.state==='running'&&a.task_id))try{const live=JSON.parse(fs.readFileSync(path.join(root,'runs/scheduler/matches',a.task_id,'live.json'),'utf8'));row.ai_runtime.push({arena:a.id,age_ms:Date.now()-Date.parse(live.updated_at),...live.runtime});}catch{}
  const disk=fs.statfsSync(root);row.disk_free_gb=Number(disk.bavail)*Number(disk.bsize)/1073741824;append('samples.ndjson',row);
  if(Date.now()-lastResource>5000){const r=ownedResources(config);report.resources.push(r);append('resources.ndjson',r);lastResource=Date.now();}
  return row;
 }
 try{
  await api('pause',{paused:true});await api('capacity',{max_active:levels[0]});
  report.entrants=(await api('demo',{count,rounds:1})).entrants;owned=new Set(report.entrants.map(e=>e.id));save();
  if(mode!=='overload')await api('pause',{paused:false});console.log(JSON.stringify({report_dir:dir,entrants:count}));
  for(const [stageIndex,target] of levels.entries()){
   const watching=Boolean(args['watch-last']&&stageIndex===levels.length-1);
   if(watching)console.log(JSON.stringify({viewer_stage:await api('watch',{arena_id:args['watch-last']})}));
   console.log(JSON.stringify({stage_begin:target,watching}));
   await api('capacity',{max_active:target});const start=Date.now(),samples=[];let pressure=0;
   while(Date.now()-start<(seconds+warmup)*1000&&!signaled){
    const row=await sample(target,Date.now()-start>=warmup*1000);samples.push(row);
    const reasons=pressureReasons(row,config,{...args,mode});pressure=reasons.length?pressure+1:0;
    if(reasons.length)report.last_pressure={at:row.at,reasons};
    if(mode==='overload'&&!reasons.length&&row.occupied<target&&Date.now()-lastForcedAdmission>=(config.admission_interval_ms??5000)){
     if(lastStatus.entrants.some(e=>e.state==='waiting'&&!owned.has(e.id)))throw Error('Foreign waiting entrant appeared during overload test');
     const reserve=config.admission_reserve_mb??256,budget=row.metrics;
     if(budget.free_mb>=config.min_free_mb+reserve&&(budget.cgroup_free_mb===undefined||budget.cgroup_free_mb>=(config.min_cgroup_free_mb??512)+reserve)){
      const arena=lastStatus.arenas.find(a=>a.state==='available'&&!a.task_id);
      if(arena){const m=await allocationStore.allocate(arena.id);if(m){lastForcedAdmission=Date.now();await allocationStore.event('overload_test_reserved',{match_id:m.id,arena_id:m.arena_id,players:m.players.map(p=>p.id)});}}
     }
    }
    if(pressure>=10||row.metrics.free_mb<256){report.stop_reason='resource_protection';break;}
    if(lastStatus.arenas.some(a=>a.state==='quarantined')||report.invariant_errors.length){report.stop_reason='integrity_or_arena_failure';break;}
    if(samples.length%15===0){console.log(JSON.stringify({target,elapsed:Math.round((Date.now()-start)/1000),actual_ai:row.actual_ai,gate:row.gate,free_mb:row.metrics.free_mb,mspt:row.metrics.mspt,tick_p95:row.metrics.tick_window?.p95_ms}));save();}
    await sleep(1000);
   }
   const summary=summarize(samples,target);const full=samples.filter(s=>s.steady&&s.active_arenas===target),valid=full.filter(s=>s.control_age_ms<3000&&s.metrics.tick_window?.p95_ms<=50&&s.metrics.mspt<=35&&s.metrics.tps>=19&&s.ai_runtime.length===target&&s.ai_runtime.every(a=>a.age_ms<4000&&a.decision_hz>=7&&a.event_loop_p95_ms<=100));
   const ai=full.flatMap(s=>s.ai_runtime);
   const stage={watching,ai_decision_hz_p10:percentile(ai.map(a=>a.decision_hz),.1),ai_event_loop_p95_max_ms:ai.length?Math.max(...ai.map(a=>a.event_loop_p95_ms||0)):null,target_arenas:target,target_ai:target*2,started_at:start,...summary,valid_full_samples:valid.length,passed:!report.stop_reason&&!signaled&&valid.length>=minimum};report.stages.push(stage);save();console.log(JSON.stringify({stage}));
   if(report.stop_reason||signaled||(!stage.passed&&mode!=='overload')){report.stop_reason ||= signaled?'operator_interrupted':'target_not_sustained';break;}
  }
 }catch(e){report.stop_reason='error: '+e.message;report.warnings.push(e.stack);}
 finally{
  // Withdraw only this run's waiting entrants. Let already running games finish naturally.
  try{await api('pause',{paused:true});for(const id of owned)await api('withdraw',{id});const start=Date.now();
   while(Date.now()-start<drain*1000){const row=await sample('drain',false);if(row.occupied===0)break;await sleep(2000);}
   const final=await api('status');inspect(final);const matches=final.matches.filter(m=>m.players.some(p=>owned.has(p.id))),ids=new Set(matches.map(m=>m.id));
   report.results=final.results.filter(r=>ids.has(r.match_id));report.entrant_final=final.entrants.filter(e=>owned.has(e.id));report.unsettled=matches.filter(m=>m.state!=='settled').map(m=>({id:m.id,arena:m.arena_id,state:m.state}));
   const Redis=require('../local-scheduler/node_modules/ioredis'),redis=new Redis({host:'127.0.0.1',port:config.redis_port,maxRetriesPerRequest:1});
   try{const events=(await redis.xrange(`${config.namespace}:events`,'-','+')).map(([,v])=>JSON.parse(v[1])).filter(e=>ids.has(e.match_id));report.launch_counts=Object.fromEntries([...ids].map(id=>[id,events.filter(e=>e.type==='agents_launched'&&e.match_id===id).length]));}finally{await redis.quit();}
   for(const m of matches){
    if(report.launch_counts[m.id]!==1)report.invariant_errors.push({match_id:m.id,error:'launch_count',count:report.launch_counts[m.id]});
    const file=path.join(root,backendFor(config,m.arena_id).server_root,'plugins/SkyDuelReferee/replays',m.id+'.json');if(!fs.existsSync(file)){if(m.state==='settled')report.invariant_errors.push({match_id:m.id,error:'missing_replay'});continue;}
    const bad=!await require('./validate-replay.cjs').validateReplay(file,m);
    if(bad)report.invariant_errors.push({match_id:m.id,error:'cross_arena_replay'});
   }
   const settledIds=new Set(matches.filter(m=>m.state==='settled').map(m=>m.id));report.pending_result_releases=report.results.filter(r=>!settledIds.has(r.match_id)).map(r=>r.match_id);
   for(const e of report.entrant_final){const n=report.results.filter(r=>settledIds.has(r.match_id)&&r.players.includes(e.id)).length;if(e.completed!==n)report.invariant_errors.push({entrant:e.id,error:'completion_count',completed:e.completed,results:n});}
   report.result_status_counts=report.results.reduce((counts,r)=>{counts[r.status]=(counts[r.status]||0)+1;return counts;},{});report.natural_completed_matches=report.result_status_counts.complete||0;
   report.completed=report.unsettled.length===0;report.competition_completed=report.completed&&report.results.every(r=>r.status==='complete');report.restored_arenas=final.arenas.map(a=>({id:a.id,state:a.state,restored:a.restored}));
   await api('capacity',{max_active:Math.max(1,Math.min(initial.max_active,config.arenas.length))});
  }catch(e){report.warnings.push('Drain/report: '+e.message);}
  if(allocationRedis)await allocationRedis.quit();
  report.finished_at=new Date().toISOString();report.max_tested_ai=Math.max(0,...report.stages.map(s=>s.max_actual_ai));report.max_passed_ai=Math.max(0,...report.stages.filter(s=>s.passed).map(s=>s.target_ai));save();console.log(JSON.stringify({report_dir:dir,max_tested_ai:report.max_tested_ai,max_passed_ai:report.max_passed_ai,completed:report.completed,stop_reason:report.stop_reason,integrity_errors:report.invariant_errors.length}));
 }
}
if(require.main===module){let release;try{const args=options(process.argv.slice(2)),cfg=JSON.parse(fs.readFileSync(path.resolve(root,args.config||'configs/scheduler.stress.json'),'utf8'));release=benchmarkLock(path.join(root,'runs/stress',`coordinator-${cfg.web_port}.lock`));process.once('exit',release);main().catch(e=>{console.error(e.message);process.exitCode=1}).finally(release);}catch(e){console.error(e.message);process.exitCode=1;}}
module.exports={summarize,percentile,options,pressureReasons,benchmarkLock};
