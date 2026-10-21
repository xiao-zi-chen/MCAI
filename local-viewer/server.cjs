// Read-only local spectator using PrismarineJS viewer/WorldView (MIT).
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
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

const webPort = Number(process.env.BEDWARS_VIEW_PORT || 3007);
const cameraName=process.env.SKYDUEL_CAMERA_NAME||'MapCamera';
const worldName=process.env.SKYDUEL_WORLD||'bedwars-v6';
const arenaId=process.env.SKYDUEL_ARENA_ID||'';
const gamePort = Number(process.env.BEDWARS_PORT || 25567);
const projectRoot = path.resolve(__dirname,'..');
const serverRoot=path.resolve(projectRoot,process.env.SKYDUEL_SERVER_ROOT||'runs/bedwars-local');
const replayDir = path.join(serverRoot,'plugins/SkyDuelReferee/replays');
const localRules = JSON.parse(fs.readFileSync(path.join(projectRoot,'competition/rules.json'),'utf8'));
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
app.get('/rules-source',(_req,res)=>res.type('text/plain').sendFile(path.join(projectRoot,'competition/RULES.zh-CN.md')));
app.get('/rules', (_req,res)=>res.sendFile(path.join(__dirname,'rules.html')));
for(const file of ['effects.js','spectator-camera.js','replay.js','replay-timeline.js','player-motion.js','spectator-actors.js','native-items.js','native-poses.js']) app.get('/'+file, (_req,res)=>res.sendFile(path.join(__dirname,file)));
app.get('/api/native-items',(_req,res)=>res.sendFile(path.join(projectRoot,'runs/native-assets-1.21/items.json')));
app.use('/native-assets',express.static(path.join(projectRoot,'downloads/minecraft-assets-1.21/assets/minecraft')));
app.get('/favicon.ico', (_req,res)=>res.status(204).end());
app.get('/api/rules', (_req,res)=>res.sendFile(path.join(projectRoot,'competition/rules.json')));
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
    try{const d=JSON.parse(fs.readFileSync(path.join(replayDir,file),'utf8'));if(d.status!=='complete')continue;list.push({id:d.match_id,date:mtime,status:d.status,winner:d.winner,reason:d.reason,rules_version:d.rules_version,seconds:(d.frames.at(-1)?.tick||0)/20,frames:d.frames.length,events:d.events.length});if(list.length===20)break;}catch{}
  }
  res.json(list);
});
app.get('/api/replays/:id', (req,res)=>{
  if(!/^[a-f0-9-]{36}$/.test(req.params.id))return res.sendStatus(400);
  const file=path.join(replayDir,req.params.id+'.json');if(!fs.existsSync(file))return res.sendStatus(404);res.sendFile(file);
});
app.get('/scene/index.js', (_req, res) => res.type('js').send(bundle));
app.use('/scene', express.static(assets));

const bot = mineflayer.createBot({host:'127.0.0.1',port:gamePort,username:cameraName,auth:'offline',version:'1.21',viewDistance:'far'});
bot.physicsEnabled = false;
let ready = false;
const messages = [];
bot.on('messagestr', text => { messages.push(text); if (messages.length > 12) messages.shift(); });
bot.once('spawn', () => {
  bot.physicsEnabled = false;
  ready = false;
  console.log('Spectator connected:',cameraName,worldName);
  const python = path.join(__dirname, '../.venv/Scripts/python.exe');
  const admin = path.join(__dirname, '../scripts/bedwars-rcon.py');
  execFile(python, [admin, 'gamemode', 'spectator', cameraName], error => {
    if (error) { console.error('Could not configure spectator:', error.message); return; }
    execFile(python, [admin, 'execute', 'in', 'minecraft:'+worldName, 'run', 'tp', cameraName, '0', '90', '0', '0', '45'], error => {
      if (error) console.error('Could not position spectator:', error.message);
      else setTimeout(()=>ready=true,500);
    });
  });
});
bot.on('end', reason => { ready = false; console.log('Spectator disconnected:', reason);if(arenaId){io.close();server.close(()=>process.exit(0));} });
bot.on('error', error => { console.error(error.message); });

app.get('/status', (_req, res) => {
  const bed = team => { if(!ready||!bot.world)return null;const b = bot.blockAt(new Vec3(...localRules.map.teams[team].bed)); return b ? b.name.endsWith('_bed') : null; };
  const players = Object.values(bot.entities || {}).filter(e => e.type === 'player' && e.username && e.username !== bot.username).map(e => ({name:e.username,x:e.position.x,y:e.position.y,z:e.position.z}));
  let demo=null;try{const liveFile=arenaId&&refereeState.match_id?path.join(projectRoot,'runs/scheduler/matches',refereeState.match_id,'live.json'):path.join(projectRoot,'runs/showcase-live.json');demo=JSON.parse(fs.readFileSync(liveFile,'utf8'));if(Date.now()-Date.parse(demo.updated_at)>10000)demo=null}catch{}
  res.json({connected:ready,arena_id:arenaId,managed:Boolean(arenaId),players,beds:{red:bed('Red'),blue:bed('Blue')},messages,referee:refereeState,demo,gameAddress:`127.0.0.1:${gamePort}`});
});
io.on('connection', socket => {
  if (socket.handshake.query.replay) {
    try {
      const id=socket.handshake.query.replay;
      if(typeof id!=='string'||!/^[a-f0-9-]{36}$/.test(id))throw new Error('比赛编号无效');
      const record=JSON.parse(fs.readFileSync(path.join(replayDir,id+'.json'),'utf8'));
      replayWorld.stream(socket,record);
    } catch(error) { socket.emit('replayError',error.message); }
    return;
  }
  if (!ready) { socket.disconnect(); return; }
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

if(process.env.SKYDUEL_VIEWER_IDLE_MS){let lastView=Date.now();setInterval(()=>{if(io.engine.clientsCount)lastView=Date.now();else if(Date.now()-lastView>Number(process.env.SKYDUEL_VIEWER_IDLE_MS)){bot.quit();io.close();server.close(()=>process.exit(0));}},10000).unref();}
