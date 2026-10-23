const fs=require('node:fs'),os=require('node:os');
function memoryBudget(){
 const budget={free_mb:Math.round(os.freemem()/1048576)};
 if(process.platform==='linux')try{
  const available=/^MemAvailable:\s+(\d+) kB$/m.exec(fs.readFileSync('/proc/meminfo','utf8'));
  if(available)budget.free_mb=Math.floor(Number(available[1])/1024);
 }catch{}
 if(process.platform==='linux')try{
  const group=fs.readFileSync('/proc/self/cgroup','utf8').split('\n').find(s=>s.startsWith('0::'))?.slice(3);
  if(group&&group!=='/'){
   const base='/sys/fs/cgroup'+group,max=fs.readFileSync(base+'/memory.max','utf8').trim(),current=Number(fs.readFileSync(base+'/memory.current','utf8'));
   if(/^\d+$/.test(max)){budget.cgroup_free_mb=Math.max(0,Math.floor((Number(max)-current)/1048576));budget.cgroup_used_mb=Math.ceil(current/1048576);budget.cgroup_max_mb=Math.floor(Number(max)/1048576);}
  }
 }catch{}
 return budget;
}
function hasHeadroom(budget,config,reserve=0){return budget.free_mb>=(config.min_free_mb??512)+reserve&&(budget.cgroup_free_mb===undefined||budget.cgroup_free_mb>=(config.min_cgroup_free_mb??512)+reserve);}
function readyBackends(backends,config,healthySince,now=Date.now()){
 const ready=new Set(),present=new Set(backends.map(s=>s.server_id));
 for(const id of healthySince.keys())if(!present.has(id))healthySince.delete(id);
 for(const state of backends){
  const p95=state.performance?.tick_window?.p95_ms;
  const healthy=state.available&&Number.isFinite(state.mspt)&&state.mspt<=(config.max_mspt??35)
   &&(config.max_tick_p95_ms==null||Number.isFinite(p95)&&p95<=config.max_tick_p95_ms)
   &&(config.min_admission_tps==null||Number.isFinite(state.tps)&&state.tps>=config.min_admission_tps);
  if(!healthy){healthySince.delete(state.server_id);continue;}
  if(!healthySince.has(state.server_id))healthySince.set(state.server_id,now);
  if(now-healthySince.get(state.server_id)>=(config.admission_stable_ms??0))ready.add(state.server_id);
 }
 return ready;
}
module.exports={memoryBudget,hasHeadroom,readyBackends};
