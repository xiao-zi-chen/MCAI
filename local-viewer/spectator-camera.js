// Camera controls shared by live viewing and recorded matches.
function chooseAutoPlayer(players,map){
  const active=players.filter(p=>p.mode==='SURVIVAL'&&p.pos?.[1]>(map?.surface_y??64)-5&&p.pos?.[1]<(map?.build_max?.[1]??100)+2);
  let best=null,score=-Infinity;
  for(const p of active){const opponent=active.filter(q=>q.team!==p.team).reduce((d,q)=>Math.min(d,Math.hypot(...p.pos.map((v,i)=>v-q.pos[i]))),Infinity),base=map?.teams?.[p.team];
    const travel=base?Math.hypot(p.pos[0]-base.base_block_x,p.pos[2]-base.base_block_z):0;
    const value=opponent<10?1000-opponent*20+(20-(p.hp??20))*2:travel;if(value>score){score=value;best=p;}
  }return best;
}
class SpectatorCamera {
  constructor(iframe,{defaultMode='follow-red',surfaceY=64,onStatus=()=>{}}={}) {
    this.iframe=iframe;this.mode=defaultMode;this.surfaceY=surfaceY;this.players=[];
    this.onStatus=onStatus;this.lastView=null;this.snap=true;this.lastTime=0;this.hiddenMesh=null;
    this.lastCollision=0;this.distanceFactor=1;this.lastPosition=null;
    this.profiles=new Map();this.focusName=null;this.autoName=null;this.lastAuto=0;
  }
  setMode(mode) {this.mode=mode;this.snap=true;this.lastPosition=null;this.lastCollision=0;this.updateButtons();}
  updateButtons() {document.querySelectorAll('[data-camera]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.camera===this.mode)));}
  bind() {document.querySelectorAll('[data-camera]').forEach(b=>b.onclick=()=>this.setMode(b.dataset.camera));this.updateButtons();}
  setPlayers(players) {this.players=players||[];}
  setProfiles(agents){
    this.profiles=new Map((agents||[]).map(a=>[a.name,a]));const select=typeof document==='object'?document.querySelector('#focus-player'):null;if(!select)return;
    const key=(agents||[]).map(a=>a.name+':'+a.display_name).join('|');if(select.dataset.roster===key)return;select.dataset.roster=key;
    select.replaceChildren(new Option('选择一位 AI 跟随',''),...(agents||[]).map(a=>new Option(a.display_name||a.name,a.name)));
    if(this.profiles.has(this.focusName))select.value=this.focusName;
    select.onchange=()=>{this.focusName=select.value||null;this.setMode(this.focusName?'follow-selected':'auto');};
  }
  focus(name){this.focusName=name;this.setMode('follow-selected');const select=document.querySelector('#focus-player');if(select)select.value=name;}
  setMap(map){this.map=map;this.surfaceY=map.surface_y;this.snap=true;}
  tick(now) {
    const frame=this.iframe.contentWindow,v=frame?.localView,T=frame?.THREE;
    if(!v||!T||!v.viewer.version)return;
    if(this.lastView!==v){this.lastView=v;this.snap=true;this.lastPosition=null;this.lastCollision=0;}
    if(this.hiddenMesh){this.hiddenMesh.visible=true;this.hiddenMesh=null;}
    const controls=v.controls,camera=v.viewer.camera;
    const automatic=this.mode==='auto',following=automatic||this.mode.startsWith('follow-')||this.mode.startsWith('pov-');
    const key=this.mode.split('-').at(-1);let team=({red:'Red',blue:'Blue',green:'Green',yellow:'Yellow'})[key]||this.profiles.get(this.focusName)?.team||'Red';
    if(automatic&&(now-this.lastAuto>5000||!this.players.some(p=>p.name===this.autoName&&p.mode==='SURVIVAL'&&p.pos?.[1]>this.surfaceY-5))){const chosen=chooseAutoPlayer(this.players,this.map);if(chosen?.name!==this.autoName)this.lastPosition=null;this.autoName=chosen?.name;this.lastAuto=now;}
    const p=this.players.find(p=>(automatic?p.name===this.autoName:key==='selected'?p.name===this.focusName:p.team===team)&&p.mode==='SURVIVAL'&&p.pos?.[1]<(this.map?.build_max?.[1]??90)+2);if(p)team=p.team;
    const firstPerson=this.mode.startsWith('pov-')&&p;
    v.povName=firstPerson?p.name:null;
    controls.enabled=!firstPerson;controls.enableDamping=false;
    controls.minDistance=firstPerson?.05:1.5;
    controls.minPolarAngle=firstPerson?.001:automatic||this.mode==='side'?.25:Math.PI*5/12;
    controls.maxPolarAngle=firstPerson?Math.PI-.001:automatic||this.mode==='side'?Math.PI*.49:Math.PI*7/12;
    controls.maxDistance=Math.max(180,Math.max(...(this.map?.build_max||[72,100,72]).filter((_,i)=>i!==1).map(Math.abs))*3);
    if(following&&p) {
      const position=new T.Vector3(...p.pos);
      if(this.lastPosition&&position.distanceTo(this.lastPosition)>12)this.snap=true;
      this.lastPosition=position.clone();
      const target=position.clone().add(new T.Vector3(0,1.35,0));
      let eye;
      if(firstPerson) {
        eye=position.clone().add(new T.Vector3(0,p.eye_height??(p.sneaking?1.27:1.62),0));
        const yaw=(p.yaw||0)*Math.PI/180,pitch=(p.pitch||0)*Math.PI/180;
        target.copy(eye).add(new T.Vector3(-Math.sin(yaw)*Math.cos(pitch),-Math.sin(pitch),Math.cos(yaw)*Math.cos(pitch)));
        const mesh=v.actorMeshes?.get(p.name)?.root||v.viewer.entities.entities[p.entity_id]||v.viewer.entities.entities['replay-'+p.name];
        if(mesh){mesh.visible=false;this.hiddenMesh=mesh;}
        camera.position.copy(eye);controls.target.copy(target);controls.update();
      } else {
        // Keep the camera close to eye level; a short ray prevents it entering walls.
        const preferred=team==='Red'?-4:4;
        if(now-this.lastCollision>(automatic?400:180)||this.snap) {
          const meshes=Object.values(v.viewer.world.sectionMeshs);let best=null;
          for(const candidate of (automatic?[[12,10,15],[-12,10,15],[12,10,-15],[-12,10,-15]]:[[preferred,1.05,8],[-preferred,1.05,8],[preferred,1.05,-8],[-preferred,1.05,-8]])){
            const offset=new T.Vector3(...candidate),side=new T.Vector3(offset.z,0,-offset.x).normalize().multiplyScalar(.7);let fraction=1;
            for(const n of [-1,0,1]){const probe=offset.clone().addScaledVector(side,n),ray=new T.Raycaster(target,probe.clone().normalize(),.15,probe.length()),hit=ray.intersectObjects(meshes,false)[0];if(hit)fraction=Math.min(fraction,Math.max(.14,(hit.distance-.45)/probe.length()));}
            const stable=this.followOffset?.equals(offset)?.04:0,score=fraction+stable;
            if(!best||score>best.score)best={offset,fraction,score};
          }
          this.followOffset=best.offset;this.distanceFactor=best.fraction;
          this.lastCollision=now;
        }
        eye=target.clone().add((this.followOffset||new T.Vector3(preferred,1.05,8)).clone().multiplyScalar(this.distanceFactor));
        const blend=this.snap?1:1-Math.exp(-Math.min(100,now-(this.lastTime||now))/90);
        camera.position.lerp(eye,blend);controls.target.lerp(target,blend);controls.update();
      }
      this.onStatus((firstPerson?'第一视角 · ':automatic?'导演视角 · ':'平视跟随 · ')+(this.profiles.get(p.name)?.display_name||p.name));
      this.snap=false;
    } else if(this.snap||following) {
      const overview=automatic||this.mode==='side',t=this.map?.teams[team],base=!overview&&(following||['red','blue','green','yellow'].includes(this.mode));
      const x=base?(t?.base_block_x??0)+.5:.5,z=base?(t?.base_block_z??0)+.5:.5;
      const halfWidth=Math.max(...(this.map?.build_max||[72,96,42]).filter((_,i)=>i!==1).map(Math.abs))+12;
      const height=this.surfaceY+2.2,distance=overview?Math.max(80,halfWidth*1.35/(Math.tan(camera.fov*Math.PI/360)*camera.aspect)):23;
      controls.target.set(x,height,z);camera.position.set(x-(overview?distance*.6:0),height+(overview?distance*.45:0),z+distance);controls.update();
      this.onStatus(automatic?'导演视角 · 等待选手':following?team+' 暂未在场 · 基地平视':overview?'地图总览':base?team+' 基地 · 平视':'中心岛 · 平视');
      this.snap=false;this.lastPosition=null;
    }
    this.lastTime=now;
  }
}
if(typeof module==='object')module.exports={SpectatorCamera,chooseAutoPlayer};else window.SpectatorCamera=SpectatorCamera;
