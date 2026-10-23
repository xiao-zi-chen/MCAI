(function(root){
 const codec=typeof module==='object'?require('./replay-codec.js'):root.ReplayCodec;
 class PagedReplay{
  constructor(meta,load){this.meta=meta;this.load=load;this.cache=new Map();this.pending=new Map();this.wanted=0;this.closed=false;}
  get(index){if(index<0||index>=this.meta.frame_count)return null;return this.cache.get(Math.floor(index/this.meta.chunk_size))?.[index%this.meta.chunk_size]||null;}
  async page(number){
   if(this.closed)throw new DOMException('Replay closed','AbortError');
   if(number<0||number>=this.meta.chunks.length)return;
   if(this.cache.has(number))return this.cache.get(number);
   const active=this.pending.get(number);if(active&&!active.controller.signal.aborted)return active.promise;
   const controller=new AbortController();
   let job;
   const promise=Promise.resolve().then(()=>this.load(number,controller.signal)).then(payload=>{const frames=codec.decode(payload);
    if(this.closed||controller.signal.aborted)throw new DOMException('Replay request superseded','AbortError');
    const spec=this.meta.chunks[number];if(frames.length!==spec.count||frames[0]?.tick!==spec.first_tick||frames.at(-1)?.tick!==spec.last_tick)throw Error('录像分段不完整');
    this.cache.set(number,frames);
    const farthest=[...this.cache.keys()].sort((a,b)=>Math.abs(b-this.wanted)-Math.abs(a-this.wanted));while(this.cache.size>3)this.cache.delete(farthest.shift());return frames;
   }).finally(()=>{if(this.pending.get(number)===job)this.pending.delete(number);});
   job={controller,promise};this.pending.set(number,job);return promise;
  }
  async ensure(index){
   const number=Math.floor(index/this.meta.chunk_size);this.wanted=number;
   for(const [key,job] of this.pending)if(Math.abs(key-number)>1)job.controller.abort();
   await this.page(number);this.page(number+1).catch(()=>{});return this.get(index);
  }
  close(){this.closed=true;for(const job of this.pending.values())job.controller.abort();this.pending.clear();this.cache.clear();}
 }
 if(typeof module==='object')module.exports={PagedReplay};else root.PagedReplay=PagedReplay;
})(typeof window==='object'?window:globalThis);
