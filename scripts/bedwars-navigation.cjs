function defenseBoxes(map){return Object.values(map.teams).map(t=>{const head=t.bed,foot=t.bed_foot||[head[0]-Math.sign(head[0]-map.mirror_plane_x),head[1],head[2]];return {minX:Math.min(head[0],foot[0])-2,maxX:Math.max(head[0],foot[0])+2,minZ:Math.min(head[2],foot[2])-2,maxZ:Math.max(head[2],foot[2])+2};});}
function inside(p,b){return !!p&&Math.floor(p.x)>=b.minX&&Math.floor(p.x)<=b.maxX&&Math.floor(p.z)>=b.minZ&&Math.floor(p.z)<=b.maxZ;}
function navigationPenalty(p,target,origin,boxes){if(!p||!Number.isFinite(p.x)||!Number.isFinite(p.z))return 100;const box=boxes.find(b=>inside(p,b));if(!box||inside(target,box))return 0;return inside(origin,box)?10:100;}
module.exports={defenseBoxes,navigationPenalty};
