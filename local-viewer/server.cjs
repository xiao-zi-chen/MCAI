// Read-only local spectator using PrismarineJS viewer/WorldView (MIT).
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const gzip=require('node:util').promisify(require('node:zlib').gzip);
const compressedAssets=new Map();
function asset(req,res,next,key,type,load){
 res.type(type);res.vary('Accept-Encoding');
 if(!req.acceptsEncodings('gzip')){load().then(data=>res.send(data)).catch(next);return;}
 if(!compressedAssets.has(key)){const pending=load().then(data=>gzip(data,{level:3}));compressedAssets.set(key,pending);pending.catch(()=>compressedAssets.delete(key));}
 compressedAssets.get(key).then(data=>res.set('Content-Encoding','gzip').send(data)).catch(next);
}
const net = require('node:net');
const { execFile } = require('node:child_process');
const { createRequire } = require('node:module');
const viewerRequire = process.env.BEDWARS_VIEWER_MODULES ? createRequire(path.join(process.env.BEDWARS_VIEWER_MODULES, '..', 'package.json')) : require;
const express = viewerRequire('express');
const { Server } = viewerRequire('socket.io');
const { WorldView } = viewerRequire('prismarine-viewer/viewer/lib/worldView');
const mineflayer = require('../scripts/minecraft-client.cjs');
const { Vec3 } = require('../bot-controller/node_modules/vec3');
const { ReplayWorld } = require('./replay-world.cjs');
const MapLoading=require('./map-loading.js');

const webPort = Number(process.env.BEDWARS_VIEW_PORT || 3007);
const cameraName=process.env.SKYDUEL_CAMERA_NAME||'MapCamera';
const worldName=process.env.SKYDUEL_WORLD||'bedwars-v6';
const arenaId=process.env.SKYDUEL_ARENA_ID||'';
const gamePort = Number(process.env.BEDWARS_PORT || 25567);
const projectRoot = path.resolve(__dirname,'..');
const serverRoot=path.resolve(projectRoot,process.env.SKYDUEL_SERVER_ROOT||'runs/bedwars-local');
const replayDir = path.join(serverRoot,'plugins/SkyDuelReferee/replays');
const replayStore=new (require('./replay-store.cjs').ReplayStore)(replayDir,{reportsDirectory:path.resolve(projectRoot,process.env.SKYDUEL_SCHEDULER_ROOT||'runs/scheduler')});
const rulesPath=path.resolve(projectRoot,process.env.SKYDUEL_RULES_FILE||'competition/rules.json');
const localRules = JSON.parse(fs.readFileSync(rulesPath,'utf8'));
const replayWorld = new ReplayWorld({viewerRequire, directory:path.join(serverRoot,'replay-maps'), rules:localRules});
let refereeState = {phase:'waiting'};
function connectReferee() {
  const socket=net.createConnection({host:'127.0.0.1',port:Number(process.env.SKYDUEL_OBSERVER_PORT||25600)});let buffer='';
  socket.on('data',data=>{buffer+=data;let end;while((end=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,end);buffer=buffer.slice(end+1);try{refereeState=JSON.parse(line);io.to('live').emit('refereeFrame',refereeState)}catch{}}});
  socket.on('error',()=>{});socket.on('close',()=>setTimeout(connectReferee,1000));
}
connectReferee();
const app = express();
const server = http.createServer(app);
const io = new Server(server, { path: '/scene/socket.io' });
const assets = path.join(path.dirname(viewerRequire.resolve('prismarine-viewer')), 'public');
let bundle = fs.readFileSync(path.join(assets, 'index.js'), 'utf8');
const controlAnchor = 'new THREE.OrbitControls(u.camera,l.domElement);';
if (!bundle.includes(controlAnchor)) throw new Error('Pinned viewer bundle changed; review camera integration.');
bundle = bundle.replace(controlAnchor, controlAnchor + 'window.localView={viewer:u,controls:h,socket:o};o.on("replayReady",m=>window.localView.replay=m);o.on("replayError",m=>window.localView.error=m);u.camera.fov=65;u.camera.updateProjectionMatrix();h.minDistance=2;h.maxDistance=180;h.minPolarAngle=Math.PI*5/12;h.maxPolarAngle=Math.PI*7/12;');
bundle = bundle.replace('u.camera.position.set(t.x,t.y+20,t.z+20)', '(h.target.set(t.x,t.y+2.2,t.z),u.camera.position.set(t.x,t.y+2.2,t.z+95))');
bundle = bundle.replace('path:window.location.pathname+"socket.io"', 'path:window.location.pathname+"socket.io",query:{replay:new URLSearchParams(window.location.search).get("replay")||""}');
bundle = bundle.replace(/(\w+)\.position\.y\+=(\w+)\.height\+\.6/, '$1.position.y+=$2.height+.6;$1.scale.set(3.4,.68,1)');
app.get('/', (_req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/rules-source',(_req,res)=>{const source=path.join(path.dirname(rulesPath),'RULES.zh-CN.md');res.type('text/plain').sendFile(fs.existsSync(source)?source:path.join(projectRoot,'competition/RULES.zh-CN.md'));});
app.get('/rules', (_req,res)=>res.sendFile(path.join(__dirname,'rules.html')));
for(const file of ['effects.js','spectator-camera.js','replay.js','replay-timeline.js','player-motion.js','spectator-actors.js','world-objects.js','native-items.js','native-poses.js','map-loading.js','replay-codec.js','paged-replay.js','actor-roster.js','arena-ui.css']) app.get('/'+file, (_req,res)=>res.sendFile(path.join(__dirname,file)));
app.get('/api/native-items',(_req,res)=>res.sendFile(path.join(projectRoot,'runs/native-assets-1.21/items.json')));
app.use('/native-assets',express.static(path.join(projectRoot,'downloads/minecraft-assets-1.21/assets/minecraft')));
app.get('/favicon.ico', (_req,res)=>res.status(204).end());
app.get('/api/rules', (_req,res)=>res.sendFile(rulesPath));
app.get('/actions',(_req,res)=>res.sendFile(path.join(__dirname,'actions.html')));
app.get('/evidence/:kind', (req,res)=>{if(!['eat','drink','bow'].includes(req.params.kind))return res.sendStatus(404);res.sendFile(path.join(projectRoot,'runs/showcase-v5/official-client-'+req.params.kind+'.png'));});
app.get('/api/action-reference',(_req,res)=>{
 try{
  const visual=JSON.parse(fs.readFileSync(path.join(projectRoot,'runs/showcase-v5/visual-reference.json'),'utf8'));
  const native=JSON.parse(fs.readFileSync(path.join(projectRoot,'runs/showcase-v5/native-verification.json'),'utf8'));
  const team=id=>{const record=JSON.parse(fs.readFileSync(path.join(replayDir,id+'.json'),'utf8'));return record.frames[0].players.find(p=>p.name==='EmberAI')?.team==='Blue'?'blue':'red';};
  const url=(id,t,side)=>'/replays?match='+id+'&t='+Math.max(0,t/20)+'&view=follow-'+side+'&autoplay=1';
  const side=team(visual.match_id),nativeSide=team(native.match_id),labels={base_roof_reached_and_descended_by_real_stairs:'沿楼梯登上基地屋顶并返回',existing_roads_and_missing_bridge_cells:'补齐桥梁缺口',visible_opponent_causes_high_ground_decision:'观察敌人后选择高地',bow_native_charge_and_projectile_hit:'高地蓄力射击命中',golden_apple_native_use_and_absorption:'金苹果与吸收生命',potion_drinks_then_leaves_glass_bottle:'药水效果与玻璃瓶',pearl_native_cooldown_and_landing_damage:'珍珠落点、冷却与自身伤害',bucket_fluid_and_sponge_are_recorded:'水桶、流动的水与海绵',tnt_native_fuse_and_textured_projectile_data:'TNT 引信与爆炸'};
  res.json({examples:visual.cases.map(c=>({name:c.name,image:'/evidence/'+c.name,replay:url(visual.match_id,c.begin_tick,side)})),checks:native.cases.filter(c=>c.passed).map(c=>({label:labels[c.name]||c.name,replay:url(native.match_id,c.begin_tick,nativeSide)}))});
 }catch{res.status(503).json({error:'Reference recordings are not ready'});}
});
app.get('/replays', (_req,res)=>res.sendFile(path.join(__dirname,'replay.html')));
app.get('/api/replays', (_req,res)=>{
  if(!fs.existsSync(replayDir))return res.json([]);
  const files=fs.readdirSync(replayDir).filter(f=>/^[a-f0-9-]+\.json$/.test(f)).map(file=>({file,mtime:fs.statSync(path.join(replayDir,file)).mtimeMs})).sort((a,b)=>b.mtime-a.mtime);
  const list=[];
  for(const {file,mtime} of files){
    try{const d=JSON.parse(fs.readFileSync(fs.existsSync(path.join(replayDir,'results',file))?path.join(replayDir,'results',file):path.join(replayDir,file),'utf8'));if(d.status!=='complete')continue;list.push({id:d.match_id,date:mtime,status:d.status,winner:d.winner,reason:d.reason,rules_version:d.rules_version,seconds:(d.frames.at(-1)?.tick||0)/20,frames:d.frame_count||d.frames.length,events:d.events.length});if(list.length===20)break;}catch{}
  }
  res.json(list);
});
app.get('/api/replays/:id/meta', (req,res,next)=>{
 try{const id=req.params.id,meta=replayStore.ready(id);if(meta)return asset(req,res,next,'replay-meta-'+id+'-'+meta.web_format+'-'+meta.source_mtime_ms,'json',async()=>JSON.stringify(meta));
  const state=replayStore.progress(id);if(state.error)return res.status(500).json({error:state.error});
  replayStore.prepare(id).catch(error=>console.error('Replay indexing:',id,error.message));res.status(202).json(replayStore.progress(id));
 }catch(error){res.status(404).json({error:error.message});}
});
// Prepare the latest finished recording before a viewer clicks it. Builds are
// serialized by ReplayStore so multiple spectators cannot multiply memory use.
let warmingReplay=false;
async function warmLatestReplay(){
 if(warmingReplay)return;warmingReplay=true;
 try{
  const directory=path.join(replayDir,'results');
  if(!fs.existsSync(directory))return;
  const files=(await fs.promises.readdir(directory)).filter(f=>/^[a-f0-9-]{36}\.json$/.test(f));
  const newest=(await Promise.all(files.map(async file=>({file,mtime:(await fs.promises.stat(path.join(directory,file))).mtimeMs})))).sort((a,b)=>b.mtime-a.mtime);
  for(const {file}of newest){
   const summary=JSON.parse(await fs.promises.readFile(path.join(directory,file),'utf8'));if(summary.status!=='complete')continue;
   await replayStore.prepare(summary.match_id);break;
  }
 }catch(e){console.error('Replay preparation:',e.message);}finally{warmingReplay=false;}
}
setInterval(warmLatestReplay,15000).unref();
app.get('/api/replays/:id/chunks/:index', (req,res)=>{
 try{if(!/^\d+$/.test(req.params.index))return res.sendStatus(400);const file=replayStore.chunk(req.params.id,Number(req.params.index));
  res.type('application/json');res.set('Cache-Control','private, max-age=86400, immutable');res.vary('Accept-Encoding');
  if(req.acceptsEncodings('gzip'))res.set('Content-Encoding','gzip').sendFile(file);
  else fs.createReadStream(file).pipe(require('node:zlib').createGunzip()).pipe(res);
 }catch(error){res.status(404).json({error:error.message});}
});
app.get('/api/replays/:id', (req,res)=>{
  if(!/^[a-f0-9-]{36}$/.test(req.params.id))return res.sendStatus(400);
  const file=path.join(replayDir,req.params.id+'.json');if(!fs.existsSync(file))return res.sendStatus(404);res.sendFile(file);
});
app.get('/scene/index.js',(req,res,next)=>asset(req,res,next,'bundle','js',async()=>bundle));
app.get('/scene/worker.js',(req,res,next)=>asset(req,res,next,'worker','js',()=>fs.promises.readFile(path.join(assets,'worker.js'))));
app.get('/scene/blocksStates/:version.json',(req,res,next)=>{const v=req.params.version;if(!/^\d+\.\d+(?:\.\d+)?$/.test(v))return res.sendStatus(400);asset(req,res,next,'states-'+v,'json',()=>fs.promises.readFile(path.join(assets,'blocksStates',v+'.json')));});
app.use('/scene', express.static(assets));

const requiredColumns=MapLoading.requiredChunks(localRules.map);
const bot = mineflayer.createBot({host:'127.0.0.1',port:gamePort,username:cameraName,auth:'offline',version:'1.21',viewDistance:MapLoading.viewDistance(localRules.map)});
bot.physicsEnabled = false;
let ready = false;
let setupError='';
function mapProgress(){const loaded=new Set(requiredColumns.filter(key=>{const [x,z]=key.split(',').map(Number);return Boolean(bot.world?.getColumn(x/16,z/16));}));return MapLoading.progress(requiredColumns,loaded);}
const messages = [];
bot.on('messagestr', text => { messages.push(text); if (messages.length > 12) messages.shift(); });
bot.once('spawn', async () => {
  bot.physicsEnabled = false;
  ready = false;
  console.log('Spectator connected:',cameraName,worldName);
  const python = process.env.SKYDUEL_PYTHON||path.join(projectRoot,process.platform==='win32'?'.venv/Scripts/python.exe':'.venv/bin/python');
  const admin = path.join(__dirname, '../scripts/bedwars-rcon.py');
  const run=require('node:util').promisify(execFile);
  try{
    if(arenaId){
      const {stdout}=await run(python,[admin,'skyduel','spectate',arenaId,cameraName]);const result=JSON.parse(stdout.trim());
      if(!result.ok||result.arena_id!==arenaId||result.world!==worldName)throw Error(result.error||'Spectator world identity mismatch');
    }else{
      await run(python,[admin,'gamemode','spectator',cameraName]);
      const props=fs.readFileSync(path.join(serverRoot,'server.properties'),'utf8'),primary=/^level-name=(.*)$/m.exec(props)?.[1]?.trim();
      const dimension=process.env.SKYDUEL_WORLD_KEY||(worldName===primary?'minecraft:overworld':'minecraft:'+worldName);
      const {stdout}=await run(python,[admin,'execute','in',dimension,'run','tp',cameraName,'0.5',String(localRules.map.surface_y+26),'0.5','0','45']);
      if(!/Teleported/i.test(stdout))throw Error('Spectator teleport failed: '+stdout.trim());
    }
    const deadline=Date.now()+60000;
    while(Date.now()<deadline){
      const progress=mapProgress(),center=new Vec3(.5,localRules.map.surface_y+26,.5);
      if(bot.entity.position.distanceTo(center)<2&&progress.loaded===progress.total){ready=true;console.log('Complete spectator map:',progress.total,'columns');return;}
      await new Promise(resolve=>setTimeout(resolve,250));
    }
    throw Error('Spectator map did not finish loading');
  }catch(error){setupError=error.message;console.error('Could not configure spectator:',setupError);}
});
bot.on('end', reason => { ready = false; console.log('Spectator disconnected:', reason);if(arenaId){io.close();server.close(()=>process.exit(0));} });
bot.on('error', error => { console.error(error.message); });

app.get('/status', (_req, res) => {
  const bed = team => { if(!ready||!bot.world)return null;const b = bot.blockAt(new Vec3(...localRules.map.teams[team].bed)); return b ? b.name.endsWith('_bed') : null; };
  const players = Object.values(bot.entities || {}).filter(e => e.type === 'player' && e.username && e.username !== bot.username).map(e => ({name:e.username,x:e.position.x,y:e.position.y,z:e.position.z}));
  let demo=null;try{const liveFile=arenaId&&refereeState.match_id?path.join(process.env.SKYDUEL_SCHEDULER_ROOT||path.join(projectRoot,'runs/scheduler'),'matches',refereeState.match_id,'live.json'):path.join(projectRoot,'runs/showcase-live.json');demo=JSON.parse(fs.readFileSync(liveFile,'utf8'));if(Date.now()-Date.parse(demo.updated_at)>10000)demo=null}catch{}
  res.json({connected:ready,arena_id:arenaId,managed:Boolean(arenaId),map_loading:mapProgress(),map_columns:requiredColumns,setup_error:setupError,replay_map_ready:Boolean(replayWorld.read(localRules)),players,beds:Object.fromEntries(Object.keys(localRules.map.teams).map(t=>[t.toLowerCase(),bed(t)])),title:localRules.title,attribution:localRules.map.attribution||'',messages,referee:refereeState,demo,gameAddress:`127.0.0.1:${gamePort}`});
});
io.on('connection', async socket => {
  if (socket.handshake.query.replay) {
    try {
      const id=socket.handshake.query.replay;
      if(typeof id!=='string'||!/^[a-f0-9-]{36}$/.test(id))throw new Error('比赛编号无效');
      const summary=path.join(replayDir,'results',id+'.json');
      const record=JSON.parse(fs.readFileSync(fs.existsSync(summary)?summary:path.join(replayDir,id+'.json'),'utf8'));
      replayWorld.stream(socket,record);
    } catch(error) { socket.emit('replayError',error.message); }
    return;
  }
  const deadline=Date.now()+60000;while(!ready&&socket.connected&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,250));
  if(!socket.connected)return;if(!ready){socket.emit('replayError',setupError||'地图仍在加载，请稍后重试');return;}
  socket.join('live');
  // 1.21 and 1.21.1 share block states; the upstream fallback otherwise picks 1.21.4.
  socket.emit('version', '1.21.1');
  const center = new Vec3(0,64,0);
  const shown = new Set();
  const renderable = entity => {
    if (!entity) return false;
    if (entity.type === 'player') return false; // The spectator avatar layer renders authoritative player frames.
    // Fixed merchants are rendered from the public map, independently of the
    // stationary camera bot's entity tracking range at the distant bases.
    return false;
  };
  const stream = {
    on: socket.on.bind(socket),
    emit(event, payload) {
      if (event === 'entity') {
        if (payload.delete || !renderable(bot.entities[payload.id])) {
          if (shown.delete(payload.id)) socket.emit('entity', {id:payload.id,delete:true});
          return;
        }
        shown.add(payload.id);
      }
      socket.emit(event,payload);
    }
  };
  const viewRadius=Math.ceil(Math.max(...localRules.map.build_min.filter((_,i)=>i!==1).map(Math.abs),...localRules.map.build_max.filter((_,i)=>i!==1).map(Math.abs))/16)+1;
  const worldView = new WorldView(bot.world, viewRadius, center, stream);
  worldView.init(center).catch(console.error);
  worldView.listenToBot(bot);
  setTimeout(() => socket.emit('position', {pos:center,addMesh:false}), 250);
  const modes = setInterval(() => {
    for (const entity of Object.values(bot.entities || {})) {
      if (entity === bot.entity || entity.type !== 'player') continue;
      if (!renderable(entity)) stream.emit('entity',{id:entity.id,delete:true});
      else if (!shown.has(entity.id)) stream.emit('entity',{id:entity.id,name:entity.name,pos:entity.position,width:entity.width,height:entity.height,username:entity.username});
    }
  },200);
  socket.on('disconnect', () => { clearInterval(modes); worldView.removeListenersFromBot(bot); });
});
setInterval(()=>{if(ready&&bot.world)replayWorld.capture(bot,refereeState);},1000).unref();
server.listen(webPort, '127.0.0.1', () => console.log(`Local spectator: http://127.0.0.1:${webPort}`));
process.on('SIGINT', () => { bot.quit(); io.close(); server.close(() => process.exit(0)); });

if(Number(process.env.SKYDUEL_VIEWER_IDLE_MS)>0){let lastView=Date.now();setInterval(()=>{if(io.engine.clientsCount)lastView=Date.now();else if(Date.now()-lastView>Number(process.env.SKYDUEL_VIEWER_IDLE_MS)){bot.quit();io.close();server.close(()=>process.exit(0));}},10000).unref();}
