// Shared public map geometry. Continuous positions are block centers.
const {Vec3}=require('../bot-controller/node_modules/vec3');
function forMap(map){
 const team=side=>map.teams[side<0?'Red':'Blue'];
 const baseX=side=>team(side).base_block_x;
 const bedX=side=>team(side).bed[0];
 const footX=side=>bedX(side)-side;
 const feetY=map.surface_y+1;
 const nearBase=(position,side)=>Math.abs(position.x-baseX(side))<=16&&Math.abs(position.z)<=16;
 const home=side=>new Vec3(baseX(side)+side+.5,feetY,2.5);
 const approach=side=>new Vec3(baseX(side)-side*5+.5,feetY,2.5);
 return {team,baseX,bedX,footX,feetY,nearBase,home,approach};
}
// Plan bounded legs so a distant destination does not require unloaded chunks.
function waypoints(map,start,target){
 const nodes=(map.navigation?.waypoints||[]).map(n=>({...n,p:new Vec3(...n.position)}));
 if(start.distanceTo(target)<40||!nodes.length)return [target];
 const nearest=p=>nodes.reduce((a,b)=>a.p.distanceTo(p)<b.p.distanceTo(p)?a:b);
 const first=nearest(start),last=nearest(target),cost=new Map([[first.id,0]]),previous=new Map(),open=[first];
 while(open.length){
  open.sort((a,b)=>cost.get(a.id)-cost.get(b.id));const n=open.shift();if(n.id===last.id)break;
  for(const [a,b]of map.navigation.links){const id=a===n.id?b:b===n.id?a:null;if(!id)continue;
   const next=nodes.find(v=>v.id===id),d=cost.get(n.id)+n.p.distanceTo(next.p);
   if(d>=(cost.get(id)??Infinity))continue;cost.set(id,d);previous.set(id,n.id);if(!open.includes(next))open.push(next);
  }
 }
 if(!cost.has(last.id))return [target];
 const route=[];let id=last.id;while(id){route.unshift(nodes.find(n=>n.id===id).p);id=previous.get(id);}
 return [...route.filter(p=>p.distanceTo(start)>2&&p.distanceTo(target)>2),target];
}
module.exports={forMap,waypoints};
