const {test}=require('node:test');const assert=require('node:assert/strict');
const {interpolatePlayers,addDistances}=require('./player-motion.js');
const player={name:'A',mode:'SURVIVAL',pos:[0,65,0],yaw:179,pitch:0,hp:20};
test('a walking frame interpolates its position and shortest facing arc',()=>{
 const frames=[{tick:0,players:[{...player}]},{tick:4,players:[{...player,pos:[1,65,0],yaw:-179}]}];addDistances(frames);
 const [p]=interpolatePlayers(...frames,.5);assert.equal(p.pos[0],.5);assert.equal(p.yaw,180);assert.equal(p.walk_distance,.5);assert.equal(p.walk_speed,5);
});
test('respawns are not interpolated as a flight between islands',()=>{
 const [p]=interpolatePlayers({tick:0,players:[player]},{tick:4,players:[{...player,pos:[40,65,0]}]},.5);assert.deepEqual(p.pos,player.pos);assert.equal(p.walk_speed,0);
});
test('spectator teleports do not count as walking distance',()=>{
 const frames=[{tick:0,players:[{...player}]},{tick:4,players:[{...player,mode:'SPECTATOR',pos:[40,92,12]}]},{tick:8,players:[{...player,pos:[-40,65,0]}]}];
 addDistances(frames);assert(frames.every(f=>f.players[0].walk_distance===0));
});
