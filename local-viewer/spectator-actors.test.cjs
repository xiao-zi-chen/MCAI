const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
test('an empty managed arena can be observed before the first match and between assignments',()=>{
 let tick=0;const context={window:{},performance:{now:()=>++tick}};vm.runInNewContext(fs.readFileSync(path.join(__dirname,'spectator-actors.js'),'utf8'),context);
 const actors=new context.window.SpectatorActors({});actors.setLive({phase:'waiting'});actors.setLive({phase:'waiting'});assert.equal(actors.buffer.length,1);
 actors.setLive({phase:'running',match_id:'one',tick:0,players:[]});assert.equal(actors.buffer.length,1);assert.equal(actors.buffer[0].state.match_id,'one');
 actors.setLive({phase:'waiting'});assert.equal(actors.buffer.length,1);actors.setLive({phase:'running',match_id:'two',tick:0,players:[]});assert.equal(actors.buffer[0].state.match_id,'two');
});
