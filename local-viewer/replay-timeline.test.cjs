const {test}=require('node:test');
const assert=require('node:assert/strict');
const {ReplayTimeline}=require('./replay-timeline.js');
const metadata={initial:{'1,64,0':0,'2,64,0':0,'3,65,0':20,'4,65,0':21},states:{'minecraft:red_wool':10,'minecraft:tnt':46},beds:{Red:[[3,65,0],[4,65,0]]}};
const record={events:[{type:'block_place',tick:4,pos:[1,64,0],block:'minecraft:red_wool'},{type:'block_place',tick:8,pos:[2,64,0],block:'minecraft:red_wool'},{type:'explosion',tick:12,blocks:[[1,64,0]]}]};
test('seeking backward restores a destroyed bridge and removes later construction',()=>{
 const t=new ReplayTimeline(record,metadata);t.at(12,[{name:'Red',bed:false}]);
 const changes=t.at(4,[{name:'Red',bed:true}]);
 assert.deepEqual(t.displayed,new Map([['1,64,0',10],['2,64,0',0],['3,65,0',20],['4,65,0',21]]));
 assert.equal(changes.length,4);
});
test('both bed halves are removed and restored when scrubbing',()=>{
 const t=new ReplayTimeline({events:[]},metadata);assert.equal(t.at(20,[{name:'Red',bed:false}]).length,2);
 assert.equal(t.at(10,[{name:'Red',bed:true}]).length,2);
 assert.equal(t.at(10,[{name:'Red',bed:true}]).length,0);
});
test('future bridge blocks never leak into a paused earlier frame',()=>{
 const t=new ReplayTimeline(record,metadata);assert.deepEqual(t.at(3),[]);assert.equal(t.at(4).length,1);
 assert.equal(t.displayed.get('2,64,0'),0);assert.deepEqual(t.at(4),[]);
});
test('primed TNT is not left behind as a permanent placed block',()=>{
 const t=new ReplayTimeline({events:[{type:'block_place',tick:1,pos:[1,64,0],block:'minecraft:tnt'}]},metadata);
 assert.deepEqual(t.at(1),[]);
});
test('bucket flow and sponge changes restore when the replay is rewound',()=>{
 const meta={initial:{'0,65,0':0},states:{'minecraft:water[level=0]':80,'minecraft:wet_sponge':90,'minecraft:air':0},beds:{}};
 const t=new ReplayTimeline({events:[{type:'block_state',tick:10,pos:[0,65,0],block:'minecraft:water[level=0]'},{type:'block_state',tick:20,pos:[0,65,0],block:'minecraft:wet_sponge'},{type:'block_state',tick:30,pos:[0,65,0],block:'minecraft:air'}]},meta);
 t.at(30);assert.deepEqual(t.at(15),[{pos:[0,65,0],stateId:80}]);assert.deepEqual(t.at(0),[{pos:[0,65,0],stateId:0}]);
});
