// Exact page-local deltas: every frame is retained; unchanged equipment is shared.
(function(root){
 function delta(value,previous){
  const set={},drop=[];
  for(const key of Object.keys(previous))if(!(key in value))drop.push(key);
  for(const [key,v]of Object.entries(value))if(!(key in previous)||JSON.stringify(v)!==JSON.stringify(previous[key]))set[key]=v;
  return {set,drop};
 }
 function apply(previous,patch){const value={...previous,...patch.set};for(const key of patch.drop||[])delete value[key];return value;}
 function collectionWriter(){
  const slots=new Map(),previous=new Map();
  return list=>{
   if(!Array.isArray(list)||list.some(v=>!v||typeof v!=='object'||v.id==null)||new Set(list.map(v=>v.id)).size!==list.length)return null;
   const order=[],changes=[];
   for(const value of list){
    if(!slots.has(value.id))slots.set(value.id,slots.size);
    const slot=slots.get(value.id),patch=delta(value,previous.get(slot)||{});order.push(slot);
    if(Object.keys(patch.set).length||patch.drop.length)changes.push([slot,patch.set,patch.drop]);
    previous.set(slot,value);
   }
   return {order,changes};
  };
 }
 function collectionReader(){
  const values=new Map();
  return patch=>{
   for(const [slot,set,drop]of patch.changes)values.set(slot,apply(values.get(slot)||{},{set,drop}));
   return patch.order.map(slot=>{if(!values.has(slot))throw Error('Missing replay entity');return values.get(slot);});
  };
 }
 function encode(frames){
  let previous={},players=new Map();const data=[],drops=collectionWriter(),projectiles=collectionWriter();
  for(const frame of frames){
   const {players:roster,...top}=frame,next=new Map();
   const entities={};
   const dropPatch=drops(top.world_objects?.drops),projectilePatch=projectiles(top.projectiles);
   if(dropPatch){entities.drops=dropPatch;top.world_objects={...top.world_objects};delete top.world_objects.drops;}
   if(projectilePatch){entities.projectiles=projectilePatch;delete top.projectiles;}
   const list=roster.map(p=>{const change=delta(p,players.get(p.name)||{});next.set(p.name,p);return {name:p.name,...change};});
   data.push({...delta(top,previous),players:list,entities});previous=top;players=next;
  }
  return {encoding:'delta-2',data};
 }
 function decode(payload){
  if(Array.isArray(payload))return payload;
  if(!['delta-1','delta-2'].includes(payload?.encoding)||!Array.isArray(payload.data))throw Error('Unsupported replay encoding');
  let previous={},players=new Map();const drops=collectionReader(),projectiles=collectionReader();return payload.data.map(patch=>{
   const top=apply(previous,patch),next=new Map();
   const roster=patch.players.map(change=>{const player=apply(players.get(change.name)||{},change);if(player.name!==change.name)throw Error('Replay player identity mismatch');next.set(player.name,player);return player;});
   previous=top;players=next;const frame={...top,players:roster};
   if(patch.entities?.drops)frame.world_objects={...frame.world_objects,drops:drops(patch.entities.drops)};
   if(patch.entities?.projectiles)frame.projectiles=projectiles(patch.entities.projectiles);
   return frame;
  });
 }
 const api={encode,decode};if(typeof module==='object')module.exports=api;else root.ReplayCodec=api;
})(typeof window==='object'?window:globalThis);
