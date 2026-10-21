const {test}=require('node:test');const assert=require('node:assert/strict');
const {planRoute,meleeChoice}=require('./bedwars-skills.cjs');
const bounds={minX:0,maxX:8,minZ:0,maxZ:6};
test('navigation prefers a complete detour to building a new bridge',()=>{
 const route=planRoute({start:{x:0,z:0},goal:{x:6,z:0},bounds,cell:(x,z)=>({known:true,clear:true,floor:x===0||x===6||z===2})});
 assert(route);assert.equal(route.filter(p=>p.build).length,0);assert(route.some(p=>p.z===2));
});
test('a broken bridge is repaired only in the missing cell',()=>{
 const route=planRoute({start:{x:0,z:0},goal:{x:6,z:0},bounds,cell:(x,z)=>({known:true,clear:z===0,floor:x!==3})});
 assert.deepEqual(route.filter(p=>p.build),[{x:3,z:0,build:true}]);
});
test('navigation routes around a solid bed defense instead of building through it',()=>{
 const route=planRoute({start:{x:0,z:2},goal:{x:8,z:2},bounds,cell:(x,z)=>({known:true,clear:!(x>=3&&x<=5&&z>=1&&z<=3),floor:true})});
 assert(route);assert(route.every(p=>!(p.x>=3&&p.x<=5&&p.z>=1&&p.z<=3)));
});
test('unloaded terrain is not treated as safe air to bridge across',()=>{
 assert.equal(planRoute({start:{x:0,z:0},goal:{x:6,z:0},bounds,cell:(x,z)=>({known:x<3,clear:true,floor:true})}),null);
});
const safe={forward:true,back:true,left:true,right:true,wide:true};
test('a high wait logit cannot prevent a charged attack in reach',()=>{
 const c=meleeChoice({distance:2.5,style:'rush',ready:true,safe,logits:[100,0,0,0,0,0,0,2,1]});assert(c.attack);assert(c.left);assert(!c.jump);
});
test('movement can continue while the sword recovers without early swings',()=>{
 const c=meleeChoice({distance:2.5,style:'fortify',ready:false,safe,strafe:-1});assert(!c.attack);assert(c.left);
});
test('bridge fighting suppresses sideways movement but retains a legal hit',()=>{
 const c=meleeChoice({distance:2.4,style:'rush',ready:true,safe:{...safe,left:false,right:false,wide:false},logits:[0,0,0,0,0,0,0,100,0]});assert(c.attack);assert(!c.left&&!c.right&&!c.jump&&!c.sprint);
});
test('an enemy across a gap cannot draw the fighter into the void',()=>{
 const c=meleeChoice({distance:4,style:'rush',ready:true,safe:{...safe,forward:false,wide:false}});assert(!c.forward&&!c.attack&&!c.sprint);
});
test('melee reach is measured to the target box across a height difference',()=>{
 const {closestHitPoint}=require('./bedwars-skills.cjs'),{Vec3}=require('../bot-controller/node_modules/vec3');
 const eye=new Vec3(0,68.62,0),target=new Vec3(2.5,65,0),hit=closestHitPoint(eye,target);
 assert(hit.distanceTo(eye)<3);assert.equal(hit.y,66.8);
 assert(closestHitPoint(eye,new Vec3(4,65,0)).distanceTo(eye)>3);
});
test('bow lead and gravity compensation intersect a moving target under native arrow physics',()=>{
 const {bowAim}=require('./bedwars-skills.cjs'),{Vec3}=require('../bot-controller/node_modules/vec3');
 const eye=new Vec3(0,66.62,0),target=new Vec3(0,66.1,14),movement=new Vec3(.2,0,0),aim=bowAim(eye,target,movement);
 assert(aim.x>eye.x);
 let position=eye.clone(),velocity=aim.minus(eye);velocity=velocity.scaled(3/velocity.norm());let closest=Infinity;
 for(let tick=1;tick<=12;tick++){position=position.plus(velocity);velocity=velocity.scaled(.99).offset(0,-.05,0);closest=Math.min(closest,position.distanceTo(target.plus(movement.scaled(tick))));}
 assert(closest<.8,'the prediction should pass within the moving player box');
});
