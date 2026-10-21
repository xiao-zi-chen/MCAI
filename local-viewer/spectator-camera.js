// Camera controls shared by live viewing and recorded matches.
class SpectatorCamera {
  constructor(iframe,{defaultMode='follow-red',surfaceY=64,onStatus=()=>{}}={}) {
    this.iframe=iframe;this.mode=defaultMode;this.surfaceY=surfaceY;this.players=[];
    this.onStatus=onStatus;this.lastView=null;this.snap=true;this.lastTime=0;this.hiddenMesh=null;
    this.lastCollision=0;this.distanceFactor=1;this.lastPosition=null;
  }
  setMode(mode) {this.mode=mode;this.snap=true;this.lastPosition=null;this.lastCollision=0;this.updateButtons();}
  updateButtons() {document.querySelectorAll('[data-camera]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.camera===this.mode)));}
  bind() {document.querySelectorAll('[data-camera]').forEach(b=>b.onclick=()=>this.setMode(b.dataset.camera));this.updateButtons();}
  setPlayers(players) {this.players=players||[];}
  setMap(map){this.map=map;this.surfaceY=map.surface_y;this.snap=true;}
  tick(now) {
    const frame=this.iframe.contentWindow,v=frame?.localView,T=frame?.THREE;
    if(!v||!T||!v.viewer.version)return;
    if(this.lastView!==v){this.lastView=v;this.snap=true;this.lastPosition=null;this.lastCollision=0;}
    if(this.hiddenMesh){this.hiddenMesh.visible=true;this.hiddenMesh=null;}
    const controls=v.controls,camera=v.viewer.camera;
    const following=this.mode.startsWith('follow-')||this.mode.startsWith('pov-');
    const team=this.mode.endsWith('blue')?'Blue':'Red';
    const p=this.players.find(p=>p.team===team&&p.mode==='SURVIVAL'&&p.pos?.[1]<(this.map?.build_max?.[1]??90)+2);
    const firstPerson=this.mode.startsWith('pov-')&&p;
    v.povName=firstPerson?p.name:null;
    controls.enabled=!firstPerson;controls.enableDamping=false;
    controls.minDistance=firstPerson?.05:1.5;
    controls.minPolarAngle=firstPerson?.001:Math.PI*5/12;
    controls.maxPolarAngle=firstPerson?Math.PI-.001:Math.PI*7/12;
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
        if(now-this.lastCollision>180||this.snap) {
          const meshes=Object.values(v.viewer.world.sectionMeshs);let best=null;
          for(const candidate of [[preferred,1.05,8],[-preferred,1.05,8],[preferred,1.05,-8],[-preferred,1.05,-8]]){
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
      this.onStatus((firstPerson?'第一视角 · ':'平视跟随 · ')+p.name);
      this.snap=false;
    } else if(this.snap||following) {
      const red=this.map?.teams.Red.base_block_x??-40,blue=this.map?.teams.Blue.base_block_x??40;
      const base=following?(team==='Red'?red:blue):({red,blue,center:0,side:0}[this.mode]||0);
      const halfWidth=Math.max(Math.abs(red),Math.abs(blue))+24;
      const height=this.surfaceY+2.2,distance=this.mode==='side'?Math.max(60,halfWidth/(Math.tan(camera.fov*Math.PI/360)*camera.aspect)):23;
      controls.target.set(base,height,.5);camera.position.set(base,height,distance);controls.update();
      this.onStatus(following?(team==='Red'?'红队':'蓝队')+'暂未在场 · 基地平视':({'side':'平视全景',red:'红队基地 · 平视',blue:'蓝队基地 · 平视',center:'中心岛 · 平视'}[this.mode]||'平视'));
      this.snap=false;this.lastPosition=null;
    }
    this.lastTime=now;
  }
}
window.SpectatorCamera=SpectatorCamera;
