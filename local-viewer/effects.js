// Projectile appearance follows recorded entities and official 1.21 textures.
const projectileMeshes=new Map();let projectileView=null;const projectileTextures=new Map();
window.syncProjectiles=function(projectiles,tick=0,nextProjectiles=[],alpha=0){
 const frame=document.querySelector('#scene').contentWindow,view=frame.localView,T=frame.THREE;if(!view?.nativeItems?.catalog||!T)return;
 const dispose=e=>{e.mesh.parent?.remove(e.mesh);for(const g of e.ownedGeometry||[])g.dispose();for(const m of e.ownedMaterials||[])m.dispose();};
 if(projectileView!==view){for(const e of projectileMeshes.values())dispose(e);projectileMeshes.clear();projectileTextures.clear();projectileView=view;}
 const texture=path=>{if(!projectileTextures.has(path)){const t=new T.TextureLoader().load('/native-assets/textures/'+path+'.png');t.magFilter=T.NearestFilter;t.minFilter=T.NearestFilter;projectileTextures.set(path,t);}return projectileTextures.get(path);};
 const alive=new Set();
 for(const p of projectiles||[]){
  alive.add(p.id);let e=projectileMeshes.get(p.id);
  if(!e){
   const mesh=new T.Group();e={mesh,kind:p.kind,ownedGeometry:[],ownedMaterials:[]};
   if(p.kind==='TNT'){
    mesh.add(view.nativeItems.create('tnt','world'));
    const g=new T.BoxGeometry(1.003,1.003,1.003),m=new T.MeshBasicMaterial({color:0xffffff,transparent:true,opacity:.5,depthWrite:false});e.flash=new T.Mesh(g,m);mesh.add(e.flash);e.ownedGeometry.push(g);e.ownedMaterials.push(m);
   }else if(p.kind.includes('ARROW')){
    const g=new T.PlaneGeometry(.9,.225),uv=g.attributes.uv;for(let i=0;i<uv.count;i++){uv.setX(i,uv.getX(i)*.5);uv.setY(i,uv.getY(i)*.15625);}
    const m=new T.MeshLambertMaterial({map:texture('entity/projectiles/arrow'),alphaTest:.1,side:T.DoubleSide});
    for(const angle of [0,Math.PI/2]){const plane=new T.Mesh(g,m);plane.rotation.x=angle;mesh.add(plane);}e.ownedGeometry.push(g);e.ownedMaterials.push(m);
   }else{
    const pearl=p.kind.includes('PEARL'),m=new T.SpriteMaterial({map:texture(pearl?'item/ender_pearl':'item/fire_charge'),transparent:true,alphaTest:.1});const sprite=new T.Sprite(m),size=pearl?.25:1.5;sprite.scale.set(size,size,1);mesh.add(sprite);e.ownedMaterials.push(m);
   }
   view.viewer.scene.add(mesh);projectileMeshes.set(p.id,e);
  }
  const next=nextProjectiles?.find(q=>q.id===p.id),pos=next?p.pos.map((v,i)=>v+(next.pos[i]-v)*alpha):p.pos;
  e.mesh.position.set(pos[0],pos[1]+(p.kind==='TNT'?.49:0),pos[2]);
  if(p.kind==='TNT'){
   const fuse=p.fuse_ticks==null?null:p.fuse_ticks+(next?.fuse_ticks!=null?(next.fuse_ticks-p.fuse_ticks)*alpha:0);
   e.flash.visible=fuse!=null&&Math.floor(fuse/5)%2===0;const grow=fuse!=null?1+Math.pow(Math.max(0,1-fuse/10),4)*.3:1;e.mesh.scale.setScalar(grow);
  }else if(p.kind.includes('ARROW')){
   const v=p.velocity||next?.pos.map((n,i)=>n-p.pos[i]);if(v&&Math.hypot(...v)>.001)e.mesh.quaternion.setFromUnitVectors(new T.Vector3(1,0,0),new T.Vector3(...v).normalize());
  }
 }
 for(const [id,e]of projectileMeshes)if(!alive.has(id)){dispose(e);projectileMeshes.delete(id);}
};
