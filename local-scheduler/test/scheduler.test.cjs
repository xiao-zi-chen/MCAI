const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const Redis=require('ioredis');
const {Store}=require('../store.cjs');
const {summarizeReplay}=require('../driver.cjs');
const {Control}=require('../control.cjs');
const net=require('node:net');
const clients=[],prefixes=[];
function setup(){const redis=new Redis({host:'127.0.0.1',port:Number(process.env.TEST_REDIS_PORT||26379),maxRetriesPerRequest:1});const prefix='skyduel-test-'+crypto.randomUUID();clients.push(redis);prefixes.push(prefix);return new Store(redis,prefix);}
const entrant=(n,rounds=1)=>({id:'Test_'+n,model:n%2?'EmberAI':'BastionAI',style:n%2?'rush':'fortify',seed:n,rounds});
const result=m=>({match_id:m.id,arena_id:m.arena_id,status:'complete',winner_id:m.players[0].id});
after(async()=>{for(let i=0;i<clients.length;i++){const redis=clients[i];let cursor='0';do{const [next,keys]=await redis.scan(cursor,'MATCH',prefixes[i]+':*','COUNT',1000);cursor=next;if(keys.length)await redis.del(...keys);}while(cursor!=='0');await redis.quit();}});
test('1000 queued entrants: concurrent arena reservations never duplicate entrants or slots',async()=>{
 const store=setup();await Promise.all(Array.from({length:1000},(_,i)=>store.add(entrant(i))));const allocated=await Promise.all(Array.from({length:60},(_,i)=>store.allocate('arena-'+i%10)));const matches=allocated.filter(Boolean);assert.equal(matches.length,10);assert.equal(new Set(matches.flatMap(m=>m.players.map(p=>p.id))).size,20);
 const data=await store.snapshot();assert.equal(data.waiting.length,980);assert.equal(data.entrants.filter(e=>e.state==='reserved').length,20);
});
test('FIFO backfill admits late entrants, while an occupied arena retains its original match',async()=>{
 const store=setup();for(let i=1;i<=6;i++)await store.add(entrant(i));const a=await store.allocate('a'),b=await store.allocate('b');await store.add(entrant(7));await store.add(entrant(8));
 await store.saveResult(a,result(a));await store.release(a);const next=await store.allocate('a');assert.deepEqual(next.players.map(p=>p.id),['Test_5','Test_6']);assert.equal((await store.active('b')).id,b.id);
 await store.saveResult(next,result(next));await store.release(next);const late=await store.allocate('a');assert.deepEqual(late.players.map(p=>p.id),['Test_7','Test_8']);
});
test('duplicate result and release delivery awards one win and requeues each player once',async()=>{
 const store=setup();await store.add(entrant(1,3));await store.add(entrant(2,3));const m=await store.allocate('a');
 await Promise.all(Array.from({length:20},()=>store.saveResult(m,result(m))));await Promise.all(Array.from({length:20},()=>store.release(m)));
 const data=await store.snapshot();assert.equal(data.results.length,1);assert.equal(data.scores['Test_1:wins'],'1');assert.equal(data.scores['Test_2:played'],'1');assert.deepEqual(data.waiting,['Test_1','Test_2']);assert.equal(data.entrants[0].completed,1);
});
test('fences and durable result guard prevent premature reuse; withdrawal takes effect after current match',async()=>{
 const store=setup();await store.add(entrant(1,3));await store.add(entrant(2,3));const m=await store.allocate('a');
 await assert.rejects(store.release(m),/Result not committed/);await assert.rejects(store.saveResult({...m,token:'stale'},result(m)),/Stale match token/);assert.equal(await store.allocate('a'),null);
 await store.withdraw('Test_1');await store.saveResult(m,result(m));await store.release(m);const data=await store.snapshot();assert.equal(data.entrants.find(e=>e.id==='Test_1').state,'withdrawn');assert.deepEqual(data.waiting,['Test_2']);
});
test('restart recovers reservations and committed results from Redis using the same match identity',async()=>{
 const first=setup();await first.add(entrant(1));await first.add(entrant(2));const m=await first.allocate('a');await first.saveResult(m,result(m));
 const second=new Store(first.redis,first.prefix);assert.equal((await second.active('a')).token,m.token);assert.equal((await second.result(m.id)).match_id,m.id);await second.release(m);assert.equal(await first.active('a'),null);
});
test('replay identity, roster and score source are validated; aborted games award no winner',()=>{
 const m={id:'m',arena_id:'a',players:[{id:'A',name:'A'},{id:'B',name:'B'}]};const replay={match_id:'m',arena_id:'a',status:'complete',winner:'Red',events:[{type:'match_start',players:['B','A']}],frames:[{tick:100,players:[{name:'B',team:'Red'},{name:'A',team:'Blue'}]}]};
 assert.equal(summarizeReplay(replay,m).winner_id,'B');assert.throws(()=>summarizeReplay({...replay,arena_id:'other'},m),/reservation/);assert.throws(()=>summarizeReplay({...replay,events:[{type:'match_start',players:['X','A']}]},m),/entrants/);assert.equal(summarizeReplay({...replay,status:'aborted'},m).winner_id,'');
});
test('persistent control handles fragmented replies and rejects outstanding calls on disconnect',async()=>{
 const sockets=new Set();const server=net.createServer(socket=>{sockets.add(socket);socket.on('close',()=>sockets.delete(socket));let buffer='';socket.on('data',d=>{buffer+=d;let at;while((at=buffer.indexOf('\n'))>=0){const q=JSON.parse(buffer.slice(0,at));buffer=buffer.slice(at+1);if(q.op==='drop'){socket.destroy();return;}const reply=JSON.stringify({id:q.id,ok:true,data:{value:7}})+'\n';socket.write(reply.slice(0,12));setTimeout(()=>socket.write(reply.slice(12)),5);}});});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const control=new Control({port:server.address().port,timeoutMs:500});
 try{assert.deepEqual(await control.request('status'),{value:7});await assert.rejects(control.request('drop'),/lost|closed/);}finally{control.close();for(const s of sockets)s.destroy();await new Promise(r=>server.close(r));}
});

test('reset failure quarantines only its own arena; retry after reconciliation does not score again',async()=>{
 const {Driver}=require('../driver.cjs'),fsp=require('node:fs/promises'),path=require('node:path');
 const store=setup();for(let i=1;i<=4;i++)await store.add(entrant(i));const m=await store.allocate('a'),other=await store.allocate('b');
 const root=path.resolve(__dirname,'../../runs/scheduler-test-artifacts',crypto.randomUUID()),dir=path.join(root,'server/plugins/SkyDuelReferee/replays');await fsp.mkdir(dir,{recursive:true});
 await fsp.writeFile(path.join(dir,m.id+'.json'),JSON.stringify({match_id:m.id,arena_id:'a',status:'aborted',reason:'test',frames:[],events:[]}));
 const arena={arena_id:'a',task_id:m.id,launched:true,started_id:m.id,state:'resetting',saved:true};let quarantines=0,releases=0;
 const control={request:async()=>({arenas:[arena]}),command:async(op)=>{if(op==='quarantine'){quarantines++;arena.state='quarantined'}if(op==='release'){releases++;arena.state='available';arena.task_id='';arena.last_released=m.id+'/'+m.token}return arena}};
 const driver=new Driver({root,store,control,config:{server_root:'server',game_port:25567,arenas:[{id:'a'},{id:'b'}],reset_timeout_ms:20,poll_ms:5}});
 await assert.rejects(driver.run(m),/reset did not complete/);assert.equal(quarantines,1);assert.equal(releases,0);assert.equal((await store.active('b')).id,other.id);assert.equal((await store.active('a')).id,m.id);
 arena.state='ready_to_release';await driver.run(m);assert.equal(releases,1);assert.equal((await store.snapshot()).scores[m.players[0].id+':played'],'1');assert.equal(await store.active('a'),null);
});
test('a committed result without a matching release receipt cannot start a second game',async()=>{
 const {Driver}=require('../driver.cjs');const store=setup();await store.add(entrant(1));await store.add(entrant(2));const m=await store.allocate('a');await store.saveResult(m,result(m));let commands=0;
 const driver=new Driver({root:'.',config:{},store,control:{request:async()=>({arenas:[{arena_id:'a',state:'available',last_released:'another-match'}]}),command:async()=>commands++}});
 await assert.rejects(driver.run(m),/release receipt/);assert.equal(commands,0);
});

test('a coordinator reacquires an expired lease without stealing another live owner',async()=>{
 const {renewOrAcquire}=require('../ownership.cjs');const store=setup(),key=store.k('coordinator');
 assert.equal(await renewOrAcquire(store.redis,key,'first'),true);
 assert.equal(await renewOrAcquire(store.redis,key,'second'),false);
 await store.redis.pexpire(key,1);await new Promise(r=>setTimeout(r,20));
 assert.equal(await renewOrAcquire(store.redis,key,'first'),true);
 await store.redis.pexpire(key,1);await new Promise(r=>setTimeout(r,20));
 assert.equal(await renewOrAcquire(store.redis,key,'second'),true);
 assert.equal(await renewOrAcquire(store.redis,key,'first'),false);
});
