// Build bounded replay pages after a match. Never load a full long match into RAM.
const fs=require('node:fs'),path=require('node:path'),readline=require('node:readline'),zlib=require('node:zlib');
const gzip=require('node:util').promisify(zlib.gzip);
const {addDistances}=require('./player-motion.js');
const {encode}=require('./replay-codec.js');
class ReplayStore{
 constructor(directory,{chunkSize=100,reportsDirectory}={}){this.directory=directory;this.chunkSize=chunkSize;this.reportsDirectory=reportsDirectory;this.jobs=new Map();this.queue=Promise.resolve();}
 paths(id){if(!/^[a-f0-9-]{36}$/.test(id))throw Error('Invalid replay ID');return {source:path.join(this.directory,id+'.json'),summary:path.join(this.directory,'results',id+'.json'),cache:path.join(this.directory,'web',id)};}
 ready(id){const p=this.paths(id),file=path.join(p.cache,'manifest.json');if(!fs.existsSync(file))return null;const m=JSON.parse(fs.readFileSync(file,'utf8')),s=fs.statSync(p.source);return m.source_bytes===s.size&&m.source_mtime_ms===s.mtimeMs&&m.web_format===3?m:null;}
 progress(id){const job=this.jobs.get(id);return {preparing:Boolean(job&&!job.error),processed:job?.processed||0,total:job?.total||0,error:job?.error||''};}
 prepare(id){const cached=this.ready(id);if(cached)return Promise.resolve(cached);if(this.jobs.has(id))return this.jobs.get(id).promise;const job={processed:0,total:0};this.jobs.set(id,job);job.promise=this.queue.then(()=>this.build(id,job)).then(meta=>{this.jobs.delete(id);return meta;}).catch(e=>{job.error=e.message;throw e;});this.queue=job.promise.catch(()=>{});return job.promise;}
 async build(id,job){
  const p=this.paths(id),stat=await fs.promises.stat(p.source),summary=JSON.parse(await fs.promises.readFile(p.summary,'utf8'));
  if(summary.match_id!==id||!summary.frame_count)throw Error('Replay is not finalized');
  job.total=summary.frame_count;await fs.promises.mkdir(p.cache,{recursive:true});
  const {frames:unused,...record}=summary,meta={...record,web_format:3,source_bytes:stat.size,source_mtime_ms:stat.mtimeMs,chunk_size:this.chunkSize,frame_count:0,frame_ticks:[],chunks:[]};
  if(this.reportsDirectory)try{const live=JSON.parse(await fs.promises.readFile(path.join(this.reportsDirectory,'matches',id,'live.json'),'utf8'));meta.actors=live.agents.map(a=>Object.fromEntries(['name','display_name','personality','team','slot','model_id','preferred_role','model_parameters','model_parameter_bytes','model_weights_sha256'].filter(k=>a[k]!==undefined).map(k=>[k,a[k]])));}catch{}
  const motion={previous:new Map(),travel:new Map()};let page=[],inFrames=false,closed=false,header=false;
  const flush=async()=>{
   if(!page.length)return;const number=meta.chunks.length,first=meta.frame_count-page.length;
   const filename=String(number).padStart(5,'0')+'.json.gz';
   const data=await gzip(JSON.stringify(encode(page)),{level:3});await fs.promises.writeFile(path.join(p.cache,filename),data);
   meta.chunks.push({index:number,first_frame:first,count:page.length,first_tick:page[0].tick,last_tick:page.at(-1).tick,bytes:data.length});page=[];
  };
  const input=fs.createReadStream(p.source),lines=readline.createInterface({input,crlfDelay:Infinity});
  try{for await(const line of lines){
   if(!header){const h=JSON.parse(line.replace(/,$/,'')+'}');if(h.match_id!==id)throw Error('Replay header identity mismatch');header=true;continue;}
   if(line==='"frames":['){inFrames=true;continue;}
   if(line===']}'){closed=true;continue;}
   if(inFrames&&!closed&&line){
    const source=JSON.parse(line.replace(/,$/,''));
    // Keep every recorded frame and every field consumed by the presentation.
    const frame=Object.fromEntries(['tick','players','teams','classic','projectiles','world_objects'].filter(k=>source[k]!==undefined).map(k=>[k,source[k]]));
    if(!Number.isFinite(frame.tick)||!Array.isArray(frame.players))throw Error('Malformed replay frame');
    addDistances([frame],motion);page.push(frame);meta.frame_ticks.push(frame.tick);meta.frame_count++;job.processed++;
    if(page.length===this.chunkSize)await flush();
   }else if(line)throw Error('Unexpected replay framing');
  }}finally{lines.close();input.destroy();}
  if(!closed||meta.frame_count!==summary.frame_count)throw Error('Replay frame count mismatch');
  await flush();meta.duration_ticks=meta.frame_ticks.at(-1);const temp=path.join(p.cache,'manifest.tmp');
  await fs.promises.writeFile(temp,JSON.stringify(meta));await fs.promises.rename(temp,path.join(p.cache,'manifest.json'));return meta;
 }
 chunk(id,index){if(!Number.isInteger(index)||index<0)throw Error('Invalid replay page');const meta=this.ready(id);if(!meta||!meta.chunks[index])throw Error('Replay page missing');return path.join(this.paths(id).cache,String(index).padStart(5,'0')+'.json.gz');}
}
module.exports={ReplayStore};
