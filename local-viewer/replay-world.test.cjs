const {test}=require('node:test');const assert=require('node:assert/strict');
const {ReplayWorld}=require('./replay-world.cjs');const keys=Object.create(ReplayWorld.prototype);
test('a Bukkit snapshot with omitted null fields matches the same map',()=>{
 const a={map:{id:'same',spawners:[{team:null,position:[0,65,0]}],surface_y:64}};
 const b={map:{surface_y:64,spawners:[{position:[0,65,0]}],id:'same'}};
 assert.equal(keys.key(a),keys.key(b));
});
test('changed island geometry cannot reuse an old replay map snapshot',()=>{
 const a={map:{id:'same',islands:[{x:0,z:0,radius:12}]}};
 const b={map:{id:'same',islands:[{x:0,z:0,radius:14}]}};
 assert.notEqual(keys.key(a),keys.key(b));
});
test('serialized false block properties remain false in the Minecraft registry',()=>{
 const world=Object.create(ReplayWorld.prototype);world.data=require('../bot-controller/node_modules/minecraft-data')('1.21.1');world.Block=require('../bot-controller/node_modules/prismarine-block')('1.21.1');
 const id=world.stateId('minecraft:ladder[facing=north,waterlogged=false]');
 assert.deepEqual(world.Block.fromStateId(id,0).getProperties(),{facing:'north',waterlogged:false});
});
