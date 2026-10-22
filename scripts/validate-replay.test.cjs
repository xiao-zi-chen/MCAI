const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {validateReplay}=require('./validate-replay.cjs');
const match={id:'m',arena_id:'a',players:[{id:'RedAI'},{id:'BlueAI'}]};
async function fixture(fn){const dir=await fs.mkdtemp(path.join(os.tmpdir(),'mcai-replay-'));try{const file=path.join(dir,'m.json');await fs.mkdir(path.join(dir,'results'));await fs.writeFile(path.join(dir,'results/m.json'),JSON.stringify({match_id:'m',arena_id:'a',frame_count:2}));await fn(file);}finally{await fs.rm(dir,{recursive:true,force:true});}}
const record=(name='BlueAI',end=']}')=>'{{header},\n"frames":[\n{"players":[{"name":"RedAI"}]},\n{"players":[{"name":"'+name+'"}]}\n'+end+'\n';
const text=(name,end)=>record(name,end).replace('{header}','"match_id":"m","arena_id":"a"');
test('streamed replay validates every frame and rejects a foreign entrant',()=>fixture(async file=>{await fs.writeFile(file,text());assert.equal(await validateReplay(file,match),true);await fs.writeFile(file,text('ForeignAI'));assert.equal(await validateReplay(file,match),false);}));
test('truncated replay cannot pass using a valid summary',()=>fixture(async file=>{await fs.writeFile(file,text('BlueAI',''));assert.equal(await validateReplay(file,match),false);}));
test('legacy replay stays readable with identity checks',()=>fixture(async file=>{await fs.unlink(path.join(path.dirname(file),'results/m.json'));await fs.writeFile(file,JSON.stringify({match_id:'m',arena_id:'a',frames:[{players:[{name:'RedAI'}]}]}));assert.equal(await validateReplay(file,match),true);assert.equal(await validateReplay(file,{...match,arena_id:'b'}),false);}));
