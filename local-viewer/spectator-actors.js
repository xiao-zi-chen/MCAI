// Read-only avatars driven by recorded movement, server swings, equipment and use state.
// Texture assets are supplied by the existing local Prismarine viewer installation.
class SpectatorActors {
 constructor(iframe){this.iframe=iframe;this.view=null;this.models=new Map();this.textures=new Map();this.buffer=[];this.travel=new Map();this.markers=[];this.npcs=[];this.map=null;}
 texture(url){
  if(this.textures.has(url))return this.textures.get(url);
  const T=this.T,texture=new T.TextureLoader().load(url);texture.magFilter=T.NearestFilter;texture.minFilter=T.NearestFilter;texture.flipY=false;this.textures.set(url,texture);return texture;
 }
 part(parent,size,center,uv,texture,inflate=0,color=0xffffff,texHeight=64){
  const T=this.T,scale=.9375/16,[w,h,d]=size,[u,v]=uv;
  const g=new T.BoxGeometry((w+inflate*2)*scale,(h+inflate*2)*scale,(d+inflate*2)*scale);
  const rects=[[u+d+w,v+d,d,h],[u,v+d,d,h],[u+d,v,w,d],[u+d+w,v,w,d],[u+2*d+w,v+d,w,h],[u+d,v+d,w,h]];
  const coords=g.attributes.uv;
  rects.forEach(([x,y,rw,rh],f)=>{const values=[[x,y],[x+rw,y],[x,y+rh],[x+rw,y+rh]];values.forEach(([a,b],i)=>coords.setXY(f*4+i,a/64,b/texHeight));});
  const material=new T.MeshLambertMaterial({map:this.texture(texture),transparent:true,alphaTest:.12,color});
  const mesh=new T.Mesh(g,material);mesh.position.set(...center.map(n=>n*scale));parent.add(mesh);return mesh;
 }
 textSprite(text,color='#ffffff'){
  const T=this.T,c=document.createElement('canvas');c.width=512;c.height=96;const ctx=c.getContext('2d');
  ctx.fillStyle='#101719dd';ctx.fillRect(0,0,512,96);ctx.font='bold 40px "Microsoft YaHei",sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillStyle=color;ctx.fillText(text,256,48);
  const texture=new T.CanvasTexture(c),sprite=new T.Sprite(new T.SpriteMaterial({map:texture,transparent:true,depthTest:true}));sprite.scale.set(2.1,.39,1);return sprite;
 }
 create(p){
  const T=this.T,root=new T.Group(),rig={},skin=[],s=.9375/16;root.scale.x=-1;
  const joint=(name,pos)=>{const g=new T.Group();g.position.set(...pos.map(n=>n*s));root.add(g);rig[name]=g;return g;};
  const tex='/native-assets/textures/entity/player/wide/steve.png';
  skin.push(this.part(joint('body',[0,24,0]),[8,12,4],[0,-6,0],[16,16],tex));
  skin.push(this.part(joint('head',[0,24,0]),[8,8,8],[0,4,0],[0,0],tex));
  skin.push(this.part(joint('leftArm',[5,22,0]),[4,12,4],[1,-4,0],[32,48],tex));
  skin.push(this.part(joint('rightArm',[-5,22,0]),[4,12,4],[-1,-4,0],[40,16],tex));
  skin.push(this.part(joint('leftLeg',[1.9,12,0]),[4,12,4],[0,-6,0],[16,48],tex));
  skin.push(this.part(joint('rightLeg',[-1.9,12,0]),[4,12,4],[0,-6,0],[0,16],tex));
  const label=this.textSprite(p.name,p.team==='Red'?'#ffb0a6':'#a1ceff');label.position.set(0,2.28,0);root.add(label);
  const health=new T.Mesh(new T.PlaneGeometry(.85,.055),new T.MeshBasicMaterial({color:0x7beba6,side:T.DoubleSide}));health.position.set(0,2.02,0);root.add(health);
  const absorption=new T.Mesh(new T.PlaneGeometry(.85,.04),new T.MeshBasicMaterial({color:0xf5ce57,side:T.DoubleSide}));absorption.position.set(0,2.1,0);root.add(absorption);
  const held=new T.Group();held.position.set(-s,-10*s,-2*s);held.rotation.set(Math.PI/2,Math.PI,0,'XYZ');held.scale.set(.9375,-.9375,.9375);rig.rightArm.add(held);
  const a={root,rig,skin,label,health,absorption,held,gear:[],armorKey:'',itemKey:'',team:p.team};this.view.viewer.scene.add(root);this.models.set(p.name,a);return a;
 }
 disposeObject(root){if(root.userData.nativeItem){root.parent?.remove(root);return;}root.traverse(o=>{o.geometry?.dispose();if(o.material)for(const m of Array.isArray(o.material)?o.material:[o.material])m.dispose();});root.parent?.remove(root);}
 armor(a,p){
  const key=JSON.stringify([p.team,p.armor,p.armor_stacks]);if(a.armorKey===key)return;a.armorKey=key;
  a.gear.forEach(m=>this.disposeObject(m));a.gear=[];
  const add=(slot,bone,size,center,uv,inflate,layer=1)=>{
   const item=(p.armor||[])[slot];if(!item||item==='AIR')return;
   const kind=item.split('_')[0].toLowerCase(),name=kind==='golden'?'gold':kind;
   const tint=kind==='leather'?(p.armor_stacks?.[slot]?.tint??(p.team==='Red'?0xc3443a:0x4169be)):0xffffff;
   const mesh=this.part(a.rig[bone],size,center,uv,'/native-assets/textures/models/armor/'+name+'_layer_'+layer+'.png',inflate,tint,32);if(p.armor_stacks?.[slot]?.enchanted){const shine=this.native.glint(mesh);if(shine)mesh.add(shine);}a.gear.push(mesh);
  };
  add(3,'head',[8,8,8],[0,4,0],[0,0],1);
  add(2,'body',[8,12,4],[0,-6,0],[16,16],1);
  add(2,'rightArm',[4,12,4],[-1,-4,0],[40,16],1);add(2,'leftArm',[4,12,4],[1,-4,0],[40,16],1);
  add(1,'body',[8,12,4],[0,-6,0],[16,16],.5,2);
  for(const bone of ['leftLeg','rightLeg']){add(1,bone,[4,12,4],[0,-6,0],[0,16],.5,2);add(0,bone,[4,12,4],[0,-6,0],[0,16],1);}
 }
 item(a,p){
  const item=p.held_stack||{id:(p.held_item||'AIR').toLowerCase()},id=this.native.modelName(item,p.use_ticks||0,p.using_item);
  const key=JSON.stringify([id,item.tint,item.enchanted]);if(a.itemKey===key)return;a.itemKey=key;
  for(const child of [...a.held.children])this.disposeObject(child);
  if(!id)return;
  a.held.add(this.native.create(item,'thirdperson_righthand',p.use_ticks||0,p.using_item));
 }

 ensure(){
  const v=this.iframe.contentWindow?.localView,T=this.iframe.contentWindow?.THREE;if(!v||!T||!v.viewer.version)return false;
  if(this.view!==v){this.view=v;this.T=T;this.models=new Map();this.textures=new Map();this.markers=[];this.npcs=[];this.pov=null;this.native=new NativeItems(T);v.nativeItems=this.native;v.actorMeshes=this.models;v.merchantMeshes=this.npcs;this.addMarkers();}
  return true;
 }
 setMap(map){this.map=map;if(this.view){for(const m of [...this.markers,...this.npcs])this.disposeObject(m);this.markers=[];this.npcs=[];this.view.merchantMeshes=this.npcs;this.addMarkers();}}
 merchant(position,kind){
  // These immobile shop NPCs are part of the public frozen arena definition.
  // The upstream viewer's villager has geometry.default but no textures.default,
  // which produces an empty Object3D. Use the installed official Java skin layers.
  const root=new this.T.Group(),s=.9375/16;root.position.set(...position.slice(0,3));root.rotation.y=Math.PI-(position[3]||0)*Math.PI/180;
  root.userData={kind:'villager',role:kind};
  const head=new this.T.Group();head.position.y=24*s;root.add(head);
  const arms=new this.T.Group();arms.position.y=22*s;arms.rotation.x=-.75;root.add(arms);
  const layers=['villager.png','type/plains.png','profession/farmer.png'];
  layers.forEach((file,layer)=>{
   const texture='/native-assets/textures/entity/villager/'+file,inflate=layer*.015;
   this.part(head,[8,10,8],[0,5,0],[0,0],texture,inflate);
   this.part(head,[2,4,2],[0,1,-5],[24,0],texture,inflate);
   this.part(root,[8,12,6],[0,18,0],[16,20],texture,inflate);
   this.part(root,[8,18,6],[0,15,0],[0,38],texture,.5+inflate);
   for(const x of [-2,2])this.part(root,[4,12,4],[x,6,0],[0,22],texture,inflate);
   this.part(arms,[8,4,4],[0,-4,0],[40,38],texture,inflate);
   for(const x of [-6,6])this.part(arms,[4,8,4],[x,-2,0],[44,22],texture,inflate);
  });
  this.view.viewer.scene.add(root);this.npcs.push(root);
 }
 addMarkers(){
  if(!this.map||!this.view)return;
  const add=(text,pos,color)=>{const s=this.textSprite(text,color);s.position.set(pos[0],pos[1]+2.6,pos[2]);s.scale.set(2.6,.48,1);this.view.viewer.scene.add(s);this.markers.push(s);};
  for(const t of Object.values(this.map.teams)){add('物品商店',t.shop,'#fff0bd');this.merchant(t.shop,'shop');if(t.upgrade_shop){add('团队升级',t.upgrade_shop,'#b8dcff');this.merchant(t.upgrade_shop,'upgrade_shop');}}
  for(const s of this.map.spawners){if(s.team&&s.resource!=='iron')continue;add(s.team?'铁 / 金':s.resource==='diamond'?'钻石':'绿宝石',s.position,s.resource==='emerald'?'#72efb7':s.resource==='diamond'?'#90ecff':'#fff0bd');}
 }
 render(players,tick){
  if(!this.ensure()||!this.native.catalog)return;this.native.animate(tick);
  const present=new Set();
  for(const p of players){
   if(p.mode!=='SURVIVAL'||p.pos[1]>=(this.map?.build_max?.[1]??90)+2)continue;present.add(p.name);
   const a=this.models.get(p.name)||this.create(p),pose=NativePoses.pose(p,tick);
   if(a.team!==p.team){this.disposeObject(a.label);a.label=this.textSprite(p.name,p.team==='Red'?'#ffb0a6':'#a1ceff');a.root.add(a.label);a.team=p.team;}
   a.root.visible=true;a.root.position.set(...p.pos);a.root.rotation.y=Math.PI-p.yaw*Math.PI/180;
   this.armor(a,p);this.item(a,p);
   const r=a.rig;r.head.rotation.x=pose.head;
   const bodyYaw=Number.isFinite(p.body_yaw)?p.body_yaw:p.yaw;
   // Head and torso turn independently; the clamped offset also handles old replays.
   const yawDelta=(((p.yaw-bodyYaw)%360+540)%360)-180;
   if(Math.abs(yawDelta)<80){a.root.rotation.y=Math.PI-bodyYaw*Math.PI/180;r.head.rotation.y=yawDelta*Math.PI/180;}else r.head.rotation.y=0;
   r.leftLeg.rotation.x=-pose.leg;r.rightLeg.rotation.x=pose.leg;
   r.leftArm.rotation.set(...pose.left,'ZYX');r.rightArm.rotation.set(...pose.right,'ZYX');r.body.rotation.y=pose.body;
   if(pose.action==='BOW'){r.leftArm.rotation.y+=r.head.rotation.y;r.rightArm.rotation.y+=r.head.rotation.y;}
   for(const [name,height]of [['head',24],['body',24],['leftArm',22],['rightArm',22]])r[name].position.y=height*.9375/16-(pose.sneak?(name==='head'?.225:.16):0);
   r.body.rotation.x=pose.sneak?.453786:0;r.body.position.z=pose.sneak?-.13:0;
   r.leftLeg.position.z=r.rightLeg.position.z=pose.sneak?-.2:0;
   if(pose.sneak){r.leftArm.rotation.x+=.4;r.rightArm.rotation.x+=.4;}
   const invisible=p.effects?.some(e=>e.name==='invisibility');
   for(const mesh of a.skin){mesh.material.color.setHex(pose.hurt?0xff8f8f:0xffffff);mesh.material.opacity=invisible?.13:1;mesh.material.alphaTest=invisible?.01:.12;}
   for(const mesh of a.gear)mesh.material.emissive.setHex(pose.hurt?0x660d0d:0x000000);
   a.label.position.y=2.28-(pose.sneak?.17:0);a.health.position.y=2.02-(pose.sneak?.17:0);
   a.health.scale.x=Math.max(.02,Math.min(1,p.hp/20));a.health.quaternion.copy(this.view.viewer.camera.quaternion).premultiply(a.root.quaternion.clone().invert());
   a.health.material.color.setHex(p.hp<=6?0xff6b60:0x7beba6);
   a.absorption.visible=(p.absorption||0)>0;a.absorption.scale.x=Math.min(1,(p.absorption||0)/20);a.absorption.quaternion.copy(a.health.quaternion);a.absorption.position.y=2.1-(pose.sneak?.17:0);
   this.foodParticles(a,p,tick,pose.action);
  }
  for(const [name,a]of this.models)if(!present.has(name))a.root.visible=false;
  const fighting=players.some((p,i)=>p.mode==='SURVIVAL'&&players.some((q,j)=>i!==j&&q.mode==='SURVIVAL'&&Math.hypot(...p.pos.map((v,k)=>v-q.pos[k]))<6));
  for(const marker of this.markers)marker.visible=!fighting&&marker.position.distanceTo(this.view.viewer.camera.position)<24;
  this.renderHand(players,tick);
 }
 foodParticles(a,p,tick,action){
  if(action!=='EAT'||(p.use_ticks||0)<8){if(a.crumbs)a.crumbs.visible=false;return;}
  const T=this.T,id=(p.held_item||'').toLowerCase(),texture=this.native.catalog.items[id]?.layers[0]?.texture;if(!texture)return;
  if(!a.crumbs){a.crumbs=new T.Group();a.root.add(a.crumbs);for(let i=0;i<8;i++){const g=new T.PlaneGeometry(.07,.07),uv=g.attributes.uv;for(let j=0;j<uv.count;j++){uv.setXY(j,.25+uv.getX(j)*.25,.25+uv.getY(j)*.25);}a.crumbs.add(new T.Mesh(g,new T.MeshLambertMaterial({map:this.native.texture(texture),alphaTest:.1,side:T.DoubleSide})));}}
  a.crumbs.visible=true;const elapsed=(p.use_ticks||0)+tick-(p.sample_tick??tick);
  a.crumbs.children.forEach((crumb,i)=>{const age=elapsed%4+Math.floor(i/2)*4,seed=Math.sin((Math.floor(elapsed/4)-Math.floor(i/2))*9.7+i*3.1);crumb.visible=age<12&&elapsed-age>=8;crumb.position.set(seed*(.08+age*.012),1.52+Math.abs(seed)*age*.018-age*age*.004,-.32-age*.009);crumb.quaternion.copy(this.view.viewer.camera.quaternion).premultiply(a.root.quaternion.clone().invert());});
 }
 renderHand(players,tick){
  const p=players.find(p=>p.name===this.view.povName&&p.mode==='SURVIVAL'),T=this.T;
  if(!p){if(this.pov)this.pov.visible=false;return;}
  if(!this.pov){
   this.pov=new T.Group();this.view.viewer.camera.add(this.pov);this.view.viewer.scene.add(this.view.viewer.camera);
   this.povArm=this.part(this.pov,[4,12,4],[-1,4,0],[40,16],'/native-assets/textures/entity/player/wide/steve.png');this.povArm.scale.setScalar(1/.9375);this.povArm.position.multiplyScalar(1/.9375);
   this.povItem=new T.Group();this.pov.add(this.povItem);this.povKey='';
  }
  const item=p.held_stack||{id:(p.held_item||'AIR').toLowerCase()},model=this.native.modelName(item,p.use_ticks||0,p.using_item),key=JSON.stringify([model,item.tint,item.enchanted]);
  if(key!==this.povKey){for(const child of [...this.povItem.children])this.disposeObject(child);this.povItem.add(this.native.create(item,'firstperson_righthand',p.use_ticks||0,p.using_item));this.povKey=key;}
  this.povArm.visible=item.id==='air';this.pov.visible=true;
  NativePoses.applyMatrix(T,this.pov,NativePoses.firstPersonOperations(p,tick));
 }

 setLive(state){
  if(!state)return;
  const prior=this.buffer.at(-1);
  if(prior?.state.match_id===state.match_id&&prior.state.tick===state.tick&&prior.state.phase===state.phase)return;
  if(prior?.state.match_id!==state.match_id){this.buffer=[];this.travel.clear();}
  for(const p of state.players||[]){const old=prior?.state.players?.find(q=>q.name===p.name),d=old&&p.mode==='SURVIVAL'&&old.mode==='SURVIVAL'?Math.hypot(...p.pos.map((v,i)=>v-old.pos[i])):0;const amount=(this.travel.get(p.name)||0)+(d<6?d:0);p.walk_distance=amount;this.travel.set(p.name,amount);}
  this.buffer.push({state,at:performance.now()});if(this.buffer.length>3)this.buffer.shift();
 }
 renderLive(now){
  if(!this.buffer.length)return [];
  const when=now-125;let a=this.buffer[0],b=a;
  for(const entry of this.buffer){if(entry.at<=when)a=entry;if(entry.at>=when){b=entry;break;}b=entry;}
  const alpha=b.at>a.at?Math.max(0,Math.min(1,(when-a.at)/(b.at-a.at))):0;
  const players=PlayerMotion.interpolatePlayers(a.state,b.state,alpha);window.syncProjectiles?.(a.state.projectiles,a.state.tick,b.state.projectiles,alpha);this.render(players,(a.state.tick||0)+((b.state.tick||0)-(a.state.tick||0))*alpha);return players;
 }
}
window.SpectatorActors=SpectatorActors;
