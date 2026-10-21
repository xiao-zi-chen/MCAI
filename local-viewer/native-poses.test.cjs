const {test}=require('node:test');const assert=require('node:assert/strict');
const {pose,useAction,swingProgress,firstPersonOperations}=require('./native-poses.js');
const {NativeItems}=require('./native-items.js');
const catalog=require('../runs/native-assets-1.21/items.json');
test('potion use is drinking, and instant projectiles are not eating',()=>{
 assert.equal(useAction({held_item:'POTION',using_item:true}),'DRINK');
 assert.equal(useAction({held_item:'GOLDEN_APPLE',using_item:true}),'EAT');
 assert.equal(useAction({held_item:'ENDER_PEARL',using_item:false}),'NONE');
 assert.equal(useAction({held_item:'FIRE_CHARGE',using_item:true}),'NONE');
});
test('sword animation finishes independently of its longer attack cooldown',()=>{
 assert.equal(swingProgress({swing_tick:100,swing_duration:6},103),.5);
 assert.equal(swingProgress({swing_tick:100,swing_duration:6},106),0);
 assert.equal(swingProgress({swing_tick:100,swing_duration:4},102),.5);
 assert.equal(swingProgress({},120),0);
});
test('official bow predicates change at ticks 13 and 18, not six-tick intervals',()=>{
 const select=(ticks)=>NativeItems.prototype.modelName.call({catalog},'bow',ticks,true);
 assert.equal(select(0),'bow_pulling_0');assert.equal(select(12),'bow_pulling_0');assert.equal(select(13),'bow_pulling_1');assert.equal(select(17),'bow_pulling_1');assert.equal(select(18),'bow_pulling_2');
});
test('official held sword transforms differ from a generic flat inventory icon',()=>{
 const sword=catalog.items.stone_sword.display.thirdperson_righthand,apple=catalog.items.golden_apple.display.thirdperson_righthand;
 assert.deepEqual(sword.rotation,[0,-90,55]);assert.deepEqual(sword.translation,[0,4,.5]);assert.notDeepEqual(sword,apple);
 assert(catalog.textures['item/stone_sword'].edges.length>0);assert(catalog.items.tnt.elements.length>0);
});
test('potion colors use the official liquid layer without tinting the glass',()=>{
 assert.deepEqual(catalog.items.potion.layers.map(l=>[l.texture,l.tint]),[['item/potion_overlay',true],['item/potion',false]]);
});
test('first-person consumption advances with recorded ticks and freezes when paused',()=>{
 const p={held_item:'POTION',using_item:true,use_action:'DRINK',use_ticks:10,use_remaining_ticks:22,sample_tick:100};
 assert.notDeepEqual(firstPersonOperations(p,100),firstPersonOperations(p,110));
 assert.deepEqual(firstPersonOperations(p,110),firstPersonOperations(p,110));
});
test('third-person eating does not fabricate a bow-aiming arm pose',()=>{
 const p={held_item:'GOLDEN_APPLE',walk_speed:0,using_item:true,use_action:'EAT'};
 assert.equal(pose(p,100).action,'EAT');assert(pose(p,100).right[0]<.4);
 assert(pose({...p,held_item:'BOW',use_action:'BOW'},100).right[0]>1.5);
});
