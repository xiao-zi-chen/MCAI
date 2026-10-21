(function(root){
 const distance=(a,b)=>Math.hypot(...a.map((v,i)=>v-b[i]));
 function interpolatePlayers(a,b,alpha){
  return(a.players||[]).map(p=>{
   const q=b?.players?.find(q=>q.name===p.name&&q.mode===p.mode);
   if(!q||p.mode!=='SURVIVAL'||distance(p.pos,q.pos)>6)return {...p,walk_speed:0};
   const dt=(b.tick-a.tick)/20;
   return {...p,pos:p.pos.map((v,i)=>v+(q.pos[i]-v)*alpha),yaw:p.yaw+((((q.yaw-p.yaw)%360+540)%360)-180)*alpha,pitch:p.pitch+(q.pitch-p.pitch)*alpha,
    body_yaw:Number.isFinite(p.body_yaw)&&Number.isFinite(q.body_yaw)?p.body_yaw+((((q.body_yaw-p.body_yaw)%360+540)%360)-180)*alpha:p.body_yaw,
    walk_distance:(p.walk_distance||0)+((q.walk_distance||0)-(p.walk_distance||0))*alpha,
    walk_speed:dt>0?Math.hypot(q.pos[0]-p.pos[0],q.pos[2]-p.pos[2])/dt:0};
  });
 }
 function addDistances(frames){
  const previous=new Map(),travel=new Map();
  for(const f of frames)for(const p of f.players||[]){
   const old=previous.get(p.name),continuous=old?.mode==='SURVIVAL'&&p.mode==='SURVIVAL',d=continuous?distance(old.pos,p.pos):Infinity;
   const amount=(travel.get(p.name)||0)+(d<6?Math.hypot(p.pos[0]-old.pos[0],p.pos[2]-old.pos[2]):0);
   p.walk_distance=amount;previous.set(p.name,p);travel.set(p.name,amount);
  }return frames;
 }
 const api={interpolatePlayers,addDistances};if(typeof module!=='undefined')module.exports=api;else root.PlayerMotion=api;
})(globalThis);
