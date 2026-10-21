// Reconstructed from recorded use state and official item displays. First-person
// transform ordering was checked against minecraft-renderer 0.1.99 (MIT).
(function(root){
 const clamp=(v,a=0,b=1)=>Math.max(a,Math.min(b,v));
 const rad=d=>d*Math.PI/180;
 function useAction(p){if(!p.using_item)return 'NONE';return p.use_action||({BOW:'BOW',POTION:'DRINK',MILK_BUCKET:'DRINK',HONEY_BOTTLE:'DRINK',GOLDEN_APPLE:'EAT'}[p.held_item]||'NONE');}
 function swingProgress(p,tick){const duration=p.swing_duration||6,age=tick-(p.swing_tick??-1000);return age>=0&&age<duration?age/duration:0;}
 function pose(p,tick){
  const progress=swingProgress(p,tick),walk=Math.cos((p.walk_distance||0)*4*.6662)*Math.min(1,(p.walk_speed||0)/5),head=rad(-(p.pitch||0));
  const body=Math.sin(Math.sqrt(progress)*Math.PI*2)*.2,eased=1-Math.pow(1-progress,4),arc=Math.sin(eased*Math.PI),headTerm=Math.sin(progress*Math.PI)*-(-head-.7)*.75;
  const held=(p.held_item||'AIR')!=='AIR',active=useAction(p);
  let right=[walk*(held?.5:1)+(held?Math.PI/10:0)+arc*1.2+headTerm,body*2,Math.sin(progress*Math.PI)*.4];
  let left=[-walk,0,0];
  if(active==='BOW'){right=[Math.PI/2+head,-.1,0];left=[Math.PI/2+head,.5,0];}
  // Vanilla third-person eating/drinking uses the held-item arm pose; food
  // particles and first-person transforms convey use, not a fabricated bow pose.
  return {progress,body,head,right,left,leg:-walk*1.4,action:active,sneak:!!p.sneaking,hurt:tick-(p.damage_tick??-1000)>=0&&tick-(p.damage_tick??-1000)<10};
 }
 function firstPersonOperations(p,tick,equip=0){
  const s=swingProgress(p,tick),root=Math.sqrt(s),action=useAction(p),ops=[];
  const t=(x,y,z)=>ops.push(['t',x,y,z]),rx=d=>ops.push(['x',rad(d)]),ry=d=>ops.push(['y',rad(d)]),rz=d=>ops.push(['z',rad(d)]);
  if((p.held_item||'AIR')==='AIR'){
   t(.64-.3*Math.sin(root*Math.PI),-.6-.6*equip+.4*Math.sin(root*Math.PI*2),-.72-.4*Math.sin(s*Math.PI));
   ry(45);ry(70*Math.sin(root*Math.PI));rz(-20*Math.sin(s*s*Math.PI));t(-1,3.6,3.5);rz(120);rx(200);ry(-135);t(5.6-5/16,2/16,0);
  }else if(action==='EAT'||action==='DRINK'){
   const remaining=Math.max(0,(p.use_remaining_ticks??(32-(p.use_ticks||0)))-(tick-(p.sample_tick??tick))),ratio=clamp(remaining/32),raise=1-Math.pow(ratio,27);
   if(ratio<.8)t(0,Math.abs(Math.cos(remaining/4*Math.PI)*.1),0);
   t(raise*.6,raise*-.5,0);ry(raise*90);rx(raise*10);rz(raise*30);t(.56,-.52-equip*.6,-.72);
  }else if(action==='BOW'){
   const elapsed=(p.use_ticks||0)+(tick-(p.sample_tick??tick)),pull=clamp(elapsed/20);
   t(.56,-.52-equip*.6,-.72);t(-.2785682,.18344387,.15731531);rx(-13.935);ry(35.3);rz(-9.785);
   if(pull>.1)t(0,Math.sin((elapsed-.1)*1.3)*(pull-.1)*.004,0);t(0,0,pull*.04);ops.push(['s',1,1,1+pull*.2]);ry(-45);
  }else{
   t(-.4*Math.sin(root*Math.PI),.2*Math.sin(root*Math.PI*2),-.2*Math.sin(s*Math.PI));t(.56,-.52-equip*.6,-.72);
   ry(45-20*Math.sin(s*s*Math.PI));rz(-20*Math.sin(root*Math.PI));rx(-80*Math.sin(root*Math.PI));ry(-45);
  }
  return ops;
 }
 function applyMatrix(T,group,operations){const matrix=new T.Matrix4(),m=new T.Matrix4();for(const [op,a,b,c]of operations){if(op==='t')m.makeTranslation(a,b,c);else if(op==='s')m.makeScale(a,b,c);else if(op==='x')m.makeRotationX(a);else if(op==='y')m.makeRotationY(a);else m.makeRotationZ(a);matrix.multiply(m);}group.matrixAutoUpdate=false;group.matrix.copy(matrix);group.matrixWorldNeedsUpdate=true;}
 const api={pose,useAction,swingProgress,firstPersonOperations,applyMatrix};if(typeof module!=='undefined')module.exports=api;else root.NativePoses=api;
})(globalThis);
