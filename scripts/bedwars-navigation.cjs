function defenseBoxes(map){return Object.values(map.teams).map(t=>{const head=t.bed[0],foot=head-Math.sign(head-map.mirror_plane_x);return {minX:Math.min(head,foot)-2,maxX:Math.max(head,foot)+2,minZ:t.bed[2]-2,maxZ:t.bed[2]+2};});}
function inside(p,b){return !!p&&Math.floor(p.x)>=b.minX&&Math.floor(p.x)<=b.maxX&&Math.floor(p.z)>=b.minZ&&Math.floor(p.z)<=b.maxZ;}
function navigationPenalty(p,target,origin,boxes){if(!p||!Number.isFinite(p.x)||!Number.isFinite(p.z))return 100;const box=boxes.find(b=>inside(p,b));if(!box||inside(target,box))return 0;return inside(origin,box)?10:100;}
module.exports={defenseBoxes,navigationPenalty};
