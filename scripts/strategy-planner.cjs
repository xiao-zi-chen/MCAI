// Decisions depend on observed terrain, visible threats and public rules only.
function resourceScore({position,spawner,enemy,now,lastVisit=-Infinity}){
 const p=spawner.position,d=Math.hypot(p[0]-position.x,p[2]-position.z);
 const danger=enemy?Math.max(0,18-Math.hypot(p[0]-enemy.x,p[2]-enemy.z))*3:0;
 // Recently emptied generators are less useful than the next one on a circuit.
 const freshness=now-lastVisit<180?25:0;
 return d+danger+freshness;
}
function counterPurchase({materials,inventory,enemyBed=true,health,ownBed,style,armor}){
 if(health<14&&!inventory('golden_apple'))return 'golden_apple';
 if(!ownBed&&!inventory('ender_pearl'))return 'ender_pearl';
 if(enemyBed&&materials.includes('obsidian')&&!inventory('diamond_pickaxe'))return 'diamond_pickaxe';
 if(enemyBed&&materials.some(m=>m.includes('planks'))&&!['wooden','stone','iron','diamond'].some(t=>inventory(t+'_axe')))return 'wooden_axe';
 if(enemyBed&&materials.some(m=>m.endsWith('_wool'))&&!inventory('shears'))return 'shears';
 if(armor<2)return 'iron_armor';
 if(enemyBed&&materials.length&&!materials.some(m=>m==='obsidian'||m.includes('glass'))&&!inventory('tnt')&&style==='rush')return 'tnt';
 return null;
}
function threatPenalty(point,{enemy,health,bedAlive,valuable,now,seenAt}){
 if(!enemy||now-seenAt>80)return 0;
 const d=Math.hypot(point.x-enemy.x,point.z-enemy.z);
 // A final life or a valuable return trip should not walk into a known enemy.
 return (health<10||!bedAlive||valuable)&&d<9?(9-d)*2:0;
}
function safePearlTarget({origin,target,solid,clear,raycast,health,cooldown}){
 if(health<=11||cooldown>0)return false;
 const d=origin.distanceTo(target);if(d<7||d>32)return false;
 // Require a 3x3 landing and clear body volume, not one block at the edge.
 for(let x=-1;x<=1;x++)for(let z=-1;z<=1;z++)if(!solid(target.offset(x,-.2,z))||!clear(target.offset(x,.2,z))||!clear(target.offset(x,1.2,z)))return false;
 const eye=origin.offset(0,1.62,0),aim=target.offset(0,d*d*.0067,0),ray=aim.minus(eye),length=ray.norm();
 return !raycast(eye,ray.scaled(1/length),length);
}
module.exports={resourceScore,counterPurchase,threatPenalty,safePearlTarget};
