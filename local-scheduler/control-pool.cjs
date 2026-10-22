const {Control}=require('./control.cjs');
const {backends,backendFor}=require('./backends.cjs');
class ControlPool{
 constructor(config,factory=s=>new Control({port:s.control_port,timeoutMs:3000})){
  this.config=config;this.servers=backends(config);this.clients=new Map(this.servers.map(s=>[s.id,factory(s)]));this.cache=new Map();
 }
 async status(id){
  const previous=this.cache.get(id);if(previous&&Date.now()-previous.at<200)return previous.promise;
  const entry={at:Date.now(),promise:this.clients.get(id).request('status')};this.cache.set(id,entry);
  try{return await entry.promise;}catch(e){if(this.cache.get(id)===entry)this.cache.delete(id);throw e;}
 }
 async arena(id){const s=backendFor(this.config,id),data=await this.status(s.id),a=data.arenas.find(a=>a.arena_id===id);if(!a)throw Error('Missing configured arena: '+id);return {...a,server_id:s.id};}
 async command(op,m,extra={}){const s=backendFor(this.config,m.arena_id);try{return await this.clients.get(s.id).command(op,m,extra);}finally{this.cache.delete(s.id);}}
 async request(op){
  if(op!=='status')throw Error('Pool commands require an arena reservation');
  const outcomes=await Promise.allSettled(this.servers.map(s=>this.status(s.id)));
  const shards=outcomes.map((r,i)=>r.status==='fulfilled'?{server_id:this.servers[i].id,available:true,...r.value}:{server_id:this.servers[i].id,available:false,error:r.reason.message,arenas:this.config.arenas.filter(a=>(a.server_id||this.servers[0].id)===this.servers[i].id).map(a=>({arena_id:a.id,state:'unavailable',error:r.reason.message}))});
  const live=shards.filter(s=>s.available);if(!live.length)throw Error('All Minecraft backends unavailable');
  const worst=[...live].sort((a,b)=>(b.performance?.tick_window?.p95_ms??Infinity)-(a.performance?.tick_window?.p95_ms??Infinity))[0];
  return {arenas:shards.flatMap(s=>s.arenas.map(a=>({...a,server_id:s.server_id}))),tps:Math.min(...live.map(s=>s.tps)),mspt:Math.max(...live.map(s=>s.mspt)),performance:{...worst.performance,metric_scope:this.servers.length>1?'worst_backend':'single_backend',tick_window_server_id:worst.server_id,backends:shards.map(({arenas,...s})=>s)}};
 }
 close(){for(const client of this.clients.values())client.close();}
}
module.exports={ControlPool};
