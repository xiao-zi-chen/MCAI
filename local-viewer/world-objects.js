// Authoritative block entities and dropped stacks, shared by live viewing and replays.
// Textures come from the locally verified Minecraft client, never from bundled assets.
(function(root){
function bedStates(frame,map){
 if(frame.world_objects)return frame.world_objects.beds||[];
 // Old recordings contain team bed flags but no dropped-entity history.
 const result=[];
 for(const [name,t]of Object.entries(map?.teams||{})){
  if(!frame.teams?.find(x=>x.name===name)?.bed)continue;
  const sign=Math.sign(t.base_block_x),p=t.bed;
  for(const [part,pos]of [['head',p],['foot',t.bed_foot||[p[0]-sign,p[1],p[2]]]])result.push({pos,part,color:t.color.toLowerCase(),facing:t.bed_facing?.toLowerCase()||(sign>0?'east':'west')});
 }return result;
}
function dropStates(frame,next,alpha){
 const following=new Map((next?.world_objects?.drops||[]).map(x=>[x.id,x]));
 return (frame.world_objects?.drops||[]).map(d=>{
  const n=following.get(d.id),blend=n&&n.item.id===d.item.id?Math.max(0,Math.min(1,alpha)):0;
  return {...d,pos:d.pos.map((v,i)=>v+(n?n.pos[i]-v:0)*blend),age:d.age+(n?n.age-d.age:0)*blend};
 });
}
function stackCopies(count){return count>48?5:count>32?4:count>16?3:count>1?2:1;}
class SpectatorWorldObjects{
 constructor(view,T,native){this.view=view;this.T=T;this.native=native;this.beds=new Map();this.drops=new Map();this.textures=new Map();view.bedMeshes=this.beds;view.dropMeshes=this.drops;}
 texture(color){
  if(!this.textures.has(color)){const t=new this.T.TextureLoader().load('/native-assets/textures/entity/bed/'+color+'.png');t.magFilter=this.T.NearestFilter;t.minFilter=this.T.NearestFilter;t.flipY=false;this.textures.set(color,t);}
  return this.textures.get(color);
 }
 box(parent,size,center,rects,texture){
  const T=this.T,g=new T.BoxGeometry(...size.map(v=>v/16)),uv=g.attributes.uv;
  rects.forEach(([x,y,w,h,turn=0],f)=>{let points=[[x,y],[x+w,y],[x,y+h],[x+w,y+h]];if(turn===1)points=[points[2],points[0],points[3],points[1]];else if(turn===-1)points=[points[1],points[3],points[0],points[2]];else if(turn===2)points=[points[2],points[3],points[0],points[1]];points.forEach(([u,v],i)=>uv.setXY(f*4+i,u/64,v/64));});
  const mesh=new T.Mesh(g,new T.MeshLambertMaterial({map:texture}));mesh.position.set(...center.map(v=>v/16));parent.add(mesh);
 }
 bed(b){
  const T=this.T,g=new T.Group(),head=b.part==='head',v=head?6:28,tex=this.texture(b.color);
  // Bed collision height is 9/16: six-pixel mattress above three-pixel feet.
  this.box(g,[16,6,16],[0,6,0],[[22,v,6,16,1],[0,v,6,16,-1],[6,v,16,16],[28,v,16,16],[22,v-6,16,6,2],[6,v-6,16,6,2]],tex);
  for(const x of [-6.5,6.5])this.box(g,[3,3,3],[x,1.5,head?-6.5:6.5],[[56,3,3,3],[50,3,3,3],[53,0,3,3],[56,0,3,3],[53,3,3,3],[59,3,3,3]],tex);
  g.position.set(b.pos[0]+.5,b.pos[1],b.pos[2]+.5);g.rotation.y=({north:0,east:-Math.PI/2,south:Math.PI,west:Math.PI/2})[b.facing]||0;
  g.userData={kind:'bed',...b};this.view.viewer.scene.add(g);return g;
 }
 removeBed(g){g.traverse(o=>{o.geometry?.dispose();o.material?.dispose();});g.parent?.remove(g);}
 clear(){for(const g of this.beds.values())this.removeBed(g);for(const g of this.drops.values())g.parent?.remove(g);this.beds.clear();this.drops.clear();}
 sync(frame,next,alpha,map){
  if(this.match!==frame.match_id){this.clear();this.match=frame.match_id;}
  const beds=bedStates(frame,map),seenBeds=new Set();
  for(const b of beds){const id=b.pos.join(','),key=[b.color,b.part,b.facing].join(':');seenBeds.add(id);let g=this.beds.get(id);if(g&&g.userData.key!==key){this.removeBed(g);g=null;}if(!g){g=this.bed(b);g.userData.key=key;this.beds.set(id,g);}}
  for(const [id,g]of this.beds)if(!seenBeds.has(id)){this.removeBed(g);this.beds.delete(id);}
  const drops=dropStates(frame,next,alpha),seenDrops=new Set();let unsupported=0;
  for(const d of drops){
   if(!this.native.catalog)continue;
   if(!this.native.modelName(d.item)){unsupported++;continue;}
   seenDrops.add(d.id);const copies=stackCopies(d.item.count),key=JSON.stringify([d.item.id,d.item.tint,d.item.enchanted,copies]);let g=this.drops.get(d.id);
   if(g&&g.userData.key!==key){g.parent?.remove(g);g=null;}
   if(!g){g=new this.T.Group();for(let i=0;i<copies;i++){const item=this.native.create(d.item,'ground');item.position.x+=(i%2)*.08;item.position.z+=Math.floor(i/2)*.045;item.position.y+=i*.025;g.add(item);}this.view.viewer.scene.add(g);this.drops.set(d.id,g);g.userData.key=key;}
   const phase=(parseInt(d.id.replaceAll('-','').slice(0,6),16)||0)%628/100;
   g.position.set(d.pos[0],d.pos[1]+.225+Math.sin(d.age/10+phase)*.1,d.pos[2]);g.rotation.y=d.age/20+phase;g.userData.item=d.item;g.userData.entityId=d.entity_id;
  }
  for(const [id,g]of this.drops)if(!seenDrops.has(id)){g.parent?.remove(g);this.drops.delete(id);}
  this.view.worldObjectState={bed_parts:this.beds.size,drops:this.drops.size,drops_recorded:!!frame.world_objects,drops_total:frame.world_objects?.drops_total??0,truncated:!!frame.world_objects?.drops_truncated,unsupported};
 }
}
if(typeof module!=='undefined')module.exports={SpectatorWorldObjects,bedStates,dropStates,stackCopies};else root.SpectatorWorldObjects=SpectatorWorldObjects;
})(globalThis);
