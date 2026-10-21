// Replay block state is rebuilt from the immutable initial map when seeking back.
(function(root){
class ReplayTimeline {
  constructor(record,metadata){this.events=record.events;this.meta=metadata;this.cursor=0;this.tick=-1;this.blocks=new Map(Object.entries(metadata.initial));this.displayed=new Map(Object.entries(metadata.initial));}
  at(tick,teams=[]) {
    if(tick<this.tick){this.cursor=0;this.blocks=new Map(Object.entries(this.meta.initial));}
    while(this.cursor<this.events.length&&this.events[this.cursor].tick<=tick) {
      const e=this.events[this.cursor++];
      if(e.type==='block_place'||e.type==='block_state') {
        // Primed TNT is animated from recorded projectile positions.
        this.blocks.set(e.pos.join(','),e.block==='minecraft:tnt'?0:this.meta.states[e.block]);
      } else if(e.type==='block_break')this.blocks.set(e.pos.join(','),0);
      else if(e.type==='explosion')for(const p of e.blocks||[])this.blocks.set(p.join(','),0);
    }
    const result=new Map(this.blocks);
    for(const team of teams)if(!team.bed)for(const p of this.meta.beds[team.name]||[])result.set(p.join(','),0);
    const changes=[];
    for(const [key,stateId]of result)if(this.displayed.get(key)!==stateId)changes.push({pos:key.split(',').map(Number),stateId});
    this.displayed=result;this.tick=tick;return changes;
  }
}
if(typeof module!=='undefined')module.exports={ReplayTimeline};else root.ReplayTimeline=ReplayTimeline;
})(globalThis);
