// Pure team decisions shared by the reference controller and its regression tests.
function bedFoot(t){return t.bed_foot||[t.bed[0]-Math.sign(t.base_block_x),t.bed[1],t.bed[2]];}
function defenseCells(t){const head=t.bed,foot=bedFoot(t),occupied=new Set([head.join(','),foot.join(',')]),out=new Map();for(const p of [head,foot])for(const [dx,dy,dz]of [[1,0,0],[-1,0,0],[0,0,1],[0,0,-1],[0,1,0]]){const q=[p[0]+dx,p[1]+dy,p[2]+dz],key=q.join(',');if(!occupied.has(key))out.set(key,q);}return [...out.values()];}
function bridgeSteps(start,target){
 const origin={x:Math.floor(start.x),z:Math.floor(start.z)},end={x:Math.floor(target.x),z:Math.floor(target.z)},cell={...origin},steps=[];
 const dx=Math.abs(end.x-origin.x),dz=Math.abs(end.z-origin.z);
 if(dx+dz>512)throw Error('bridge_route_too_long');
 while(cell.x!==end.x||cell.z!==end.z){
  const x=cell.x!==end.x&&(cell.z===end.z||(Math.abs(cell.x-origin.x)+.5)/(dx||1)<=(Math.abs(cell.z-origin.z)+.5)/(dz||1));
  const axis=x?'x':'z';cell[axis]+=Math.sign(end[axis]-cell[axis]);steps.push({...cell,axis});
 }
 return steps;
}
function chooseTarget(map,teams,ownTeam,position){
 const own=map.teams[ownTeam],names=Object.keys(map.teams),order=names.indexOf(ownTeam);
 const candidates=teams.filter(t=>t.name!==ownTeam&&t.alive&&map.teams[t.name]),beds=candidates.filter(t=>t.bed);
 return (beds.length?beds:candidates).sort((a,b)=>{
  const score=t=>{const p=map.teams[t.name].bed;return Math.hypot(p[0]-(position?.x??own.bed[0]),p[2]-(position?.z??own.bed[2]))+((names.indexOf(t.name)-order+names.length)%names.length)*.01;};return score(a)-score(b);
 })[0]?.name||null;
}
function roleFor(players,name,bedAlive=true){
 const self=players.find(p=>p.name===name);if(!self)return 'attacker';
 if(self.mode!=='SURVIVAL')return bedAlive?'respawning':'eliminated';
 const active=players.filter(p=>p.team===self.team&&p.mode==='SURVIVAL').sort((a,b)=>(a.slot??0)-(b.slot??0)||a.name.localeCompare(b.name));
 return (bedAlive?['defender','collector','attacker','support']:['attacker','support','attacker','support'])[Math.max(0,active.findIndex(p=>p.name===name))]||'attacker';
}
module.exports={bedFoot,defenseCells,chooseTarget,roleFor,bridgeSteps};
