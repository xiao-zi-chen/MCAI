const fs=require('node:fs'),os=require('node:os');
function memoryBudget(){
 const budget={free_mb:Math.round(os.freemem()/1048576)};
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
module.exports={memoryBudget,hasHeadroom};
