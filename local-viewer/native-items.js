// Geometry from official 1.21 model/texture data. Assets are cached locally, not vendored.
class NativeItems {
 constructor(T){this.T=T;this.catalog=null;this.textures=new Map();this.cache=new Map();this.glints=new Map();this.ready=fetch('/api/native-items').then(r=>{if(!r.ok)throw new Error('Official item catalog unavailable');return r.json()}).then(d=>{this.catalog=d;return d});}
 glint(mesh){
  const T=this.T,map=mesh.material.map;if(!map)return null;
  if(!this.glints.has(map.uuid))this.glints.set(map.uuid,new T.ShaderMaterial({uniforms:{baseMap:{value:map},glintMap:{value:this.texture('misc/enchanted_glint_item')},time:{value:0}},vertexShader:'varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',fragmentShader:'uniform sampler2D baseMap;uniform sampler2D glintMap;uniform float time;varying vec2 vUv;void main(){if(texture2D(baseMap,vUv).a<0.1)discard;vec2 p=mat2(0.7648,-0.6442,0.6442,0.7648)*vUv*2.0+vec2(time*.03,time*.07);vec4 c=texture2D(glintMap,fract(p));gl_FragColor=vec4(c.rgb*.7,.45);}',transparent:true,depthWrite:false,depthFunc:T.EqualDepth,blending:T.AdditiveBlending,side:T.DoubleSide}));
  const overlay=new T.Mesh(mesh.geometry,this.glints.get(map.uuid));overlay.renderOrder=2;return overlay;
 }
 texture(name){
  if(this.textures.has(name))return this.textures.get(name);
  const T=this.T,tex=new T.TextureLoader().load('/native-assets/textures/'+name+'.png');tex.magFilter=T.NearestFilter;tex.minFilter=T.NearestFilter;tex.flipY=false;
  const info=this.catalog?.textures[name];if(info&&info.height>info.frame_height){tex.repeat.y=info.frame_height/info.height;tex.wrapT=T.RepeatWrapping;}
  this.textures.set(name,tex);return tex;
 }
 material(texture,tint=0xffffff){return new this.T.MeshLambertMaterial({map:this.texture(texture),color:tint,alphaTest:.1,transparent:/glass/.test(texture),side:this.T.DoubleSide});}
 quad(vertices,uvs,material){
  const T=this.T,g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(vertices.flat(),3));g.setAttribute('uv',new T.Float32BufferAttribute(uvs.flat(),2));g.setIndex([0,1,2,0,2,3]);g.computeVertexNormals();return new T.Mesh(g,material);
 }
 sprite(layer,tint){
  const T=this.T,group=new T.Group(),spec=this.catalog.textures[layer.texture],w=spec.width,h=spec.frame_height;
  const material=this.material(layer.texture,layer.tint?tint:0xffffff),front=8.5/16,back=7.5/16;
  group.add(this.quad([[0,0,front],[1,0,front],[1,1,front],[0,1,front]],[[0,1],[1,1],[1,0],[0,0]],material));
  group.add(this.quad([[1,0,back],[0,0,back],[0,1,back],[1,1,back]],[[1,1],[0,1],[0,0],[1,0]],material));
  const positions=[],uvs=[],indices=[];
  for(const [x,y,dx,dy]of spec.edges){
   const x0=x/w,x1=(x+1)/w,y0=1-(y+1)/h,y1=1-y/h;
   const points=dx?[[(dx<0?x0:x1),y0,back],[(dx<0?x0:x1),y0,front],[(dx<0?x0:x1),y1,front],[(dx<0?x0:x1),y1,back]]:[[x0,dy<0?y1:y0,back],[x1,dy<0?y1:y0,back],[x1,dy<0?y1:y0,front],[x0,dy<0?y1:y0,front]];
   const base=positions.length/3;positions.push(...points.flat());for(let i=0;i<4;i++)uvs.push((x+.5)/w,(y+.5)/h);indices.push(base,base+1,base+2,base,base+2,base+3);
  }
  const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(positions,3));g.setAttribute('uv',new T.Float32BufferAttribute(uvs,2));g.setIndex(indices);g.computeVertexNormals();group.add(new T.Mesh(g,material));return group;
 }
 elements(elements){
  const T=this.T,group=new T.Group();
  for(const e of elements){
   const [x0,y0,z0]=e.from.map(n=>n/16),[x1,y1,z1]=e.to.map(n=>n/16),part=new T.Group();
   const faces={north:[[x1,y0,z0],[x0,y0,z0],[x0,y1,z0],[x1,y1,z0]],south:[[x0,y0,z1],[x1,y0,z1],[x1,y1,z1],[x0,y1,z1]],west:[[x0,y0,z0],[x0,y0,z1],[x0,y1,z1],[x0,y1,z0]],east:[[x1,y0,z1],[x1,y0,z0],[x1,y1,z0],[x1,y1,z1]],up:[[x0,y1,z1],[x1,y1,z1],[x1,y1,z0],[x0,y1,z0]],down:[[x0,y0,z0],[x1,y0,z0],[x1,y0,z1],[x0,y0,z1]]};
   const defaults={north:[16-e.to[0],16-e.to[1],16-e.from[0],16-e.from[1]],south:[e.from[0],16-e.to[1],e.to[0],16-e.from[1]],west:[e.from[2],16-e.to[1],e.to[2],16-e.from[1]],east:[16-e.to[2],16-e.to[1],16-e.from[2],16-e.from[1]],up:[e.from[0],e.from[2],e.to[0],e.to[2]],down:[e.from[0],16-e.to[2],e.to[0],16-e.from[2]]};
   for(const [name,f]of Object.entries(e.faces)){
    const [u0,v0,u1,v1]=(f.uv||defaults[name]).map(n=>n/16),uv=[[u0,v1],[u1,v1],[u1,v0],[u0,v0]];
    for(let i=0;i<(f.rotation||0)/90;i++)uv.push(uv.shift());
    part.add(this.quad(faces[name],uv,this.material(f.texture)));
   }
   if(e.rotation){const pivot=new T.Group();pivot.position.set(...e.rotation.origin.map(n=>n/16));part.position.copy(pivot.position).multiplyScalar(-1);pivot.rotation[e.rotation.axis]=e.rotation.angle*Math.PI/180;pivot.add(part);group.add(pivot);}else group.add(part);
  }return group;
 }
 modelName(item,useTicks=0,using=false){
  const name=(typeof item==='string'?item:item?.id||'air').toLowerCase();if(!this.catalog?.items[name])return null;
  if(name==='bow'&&using){const overrides=this.catalog.items.bow.overrides;let model='bow';for(const o of overrides)if((o.predicate.pull||0)<=useTicks/20)model=o.model.split('/').at(-1);return model;}
  return name;
 }
 create(item,context='thirdperson_righthand',useTicks=0,using=false){
  const name=this.modelName(item,useTicks,using);if(!name)return new this.T.Group();
  const tint=typeof item==='object'?(item.tint??0x385dc6):0x385dc6,enchanted=!!item?.enchanted,key=name+':'+tint+':'+enchanted;
  let base=this.cache.get(key);
  if(!base){base=new this.T.Group();const spec=this.catalog.items[name];for(const layer of spec.layers)base.add(this.sprite(layer,tint));if(spec.elements.length)base.add(this.elements(spec.elements));if(enchanted){const meshes=[];base.traverse(o=>{if(o.isMesh)meshes.push(o)});for(const m of meshes){const shine=this.glint(m);if(shine)m.add(shine);}}this.cache.set(key,base);}
  const display=new this.T.Group(),spec=this.catalog.items[name].display,transform=spec[context]||spec[context.replace('lefthand','righthand')]||{};
  display.position.set(...(transform.translation||[0,0,0]).map(n=>n/16));display.rotation.set(...(transform.rotation||[0,0,0]).map(n=>n*Math.PI/180),'XYZ');display.scale.set(...(transform.scale||[1,1,1]));
  const model=base.clone(true);model.position.set(-.5,-.5,-.5);display.add(model);display.userData={nativeItem:true,model:name,context};return display;
 }
 animate(tick){for(const material of this.glints.values())material.uniforms.time.value=tick/20;for(const [name,tex]of this.textures){const spec=this.catalog?.textures[name];if(spec?.animation&&spec.height>spec.frame_height){const count=spec.height/spec.frame_height,frames=spec.animation.frames||Array.from({length:count},(_,i)=>i),index=Math.floor(tick/(spec.animation.frametime||1))%frames.length;tex.offset.y=(typeof frames[index]==='number'?frames[index]:frames[index].index)*spec.frame_height/spec.height;}}}
}
if(typeof module!=='undefined')module.exports={NativeItems};else window.NativeItems=NativeItems;
