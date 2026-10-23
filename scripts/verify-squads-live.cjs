// Local integration acceptance: real clients, scoped test mechanics, then normal complete games.
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const {Control} = require('../local-scheduler/control.cjs');
const {Store} = require('../local-scheduler/store.cjs');
const {matchDirectory} = require('../local-scheduler/paths.cjs');
const {startupBudget} = require('./scheduler-doctor.cjs');
const {validateReplay} = require('./validate-replay.cjs');
const Redis = require('../local-scheduler/node_modules/ioredis');
const root = path.resolve(__dirname, '..');
const sleep = ms => new Promise(r => setTimeout(r, ms));
function assertRoster(players, reserved) {
 assert.equal(players.length, reserved.length, 'Full reserved roster must be present');
 assert.deepEqual(players.map(p => p.name).sort(), reserved.map(p => p.name).sort());
 for (const p of players) assert.equal(p.team, reserved.find(e => e.name === p.name).team, 'Reserved team must not change');
}
function assertBeds(beds, rules) {
 assert.equal(beds.length, 8, 'Four real beds must each have two blocks');
 const keys = beds.map(b => b.pos.join(','));
 assert.equal(new Set(keys).size, 8, 'Bed positions must be unique');
 for (const [name, team] of Object.entries(rules.map.teams)) for (const [key, part] of [['bed', 'head'], ['bed_foot', 'foot']]) {
  const actual = beds.find(b => b.pos.join(',') === team[key].join(','));
  assert(actual, 'Missing ' + name + ' ' + part);
  assert.equal(actual.color, name.toLowerCase());
  assert.equal(actual.part, part);
  assert.equal(actual.facing, team.bed_facing.toLowerCase());
 }
}
function exploredTeams(players, rules) {
 return [...new Set(players.filter(p => {
  const base = rules.map.teams[p.team];
  return base && p.mode === 'SURVIVAL' && p.on_ground && p.pos?.[1] >= rules.map.surface_y && Math.hypot(p.pos[0]-base.base_block_x-.5,p.pos[2]-base.base_block_z-.5)>30;
 }).map(p=>p.team))];
}
function summarizePerformance(samples) {
 const percentile = (values, p) => {const sorted = values.filter(Number.isFinite).sort((a,b) => a-b); return sorted.length ? sorted[Math.max(0, Math.ceil(sorted.length * p) - 1)] : null;};
 return {samples: samples.length, tps_p05: percentile(samples.map(s => s.tps), .05), mspt_p95: percentile(samples.map(s => s.mspt), .95),
  free_mb_min: percentile(samples.map(s => s.free_mb), 0), ai_event_loop_p95_ms: percentile(samples.map(s => s.ai?.event_loop_p95_ms), .95), ai_rss_max_mb: percentile(samples.map(s => s.ai?.rss_mb), 1)};
}
async function main(args = process.argv.slice(2)) {
 const options = Object.fromEntries(args.map(arg => {const m = /^--([a-z-]+)=(.*)$/.exec(arg); if (!m) throw Error('Use --option=value'); return [m[1],m[2]];}));
 const config = JSON.parse(fs.readFileSync(path.resolve(root, options.config || process.env.SKYDUEL_SCHEDULER_CONFIG || 'configs/scheduler.squads.json'), 'utf8'));
 const rules = JSON.parse(fs.readFileSync(path.resolve(root, config.rules_file), 'utf8'));
 const normalRounds = Number(options['normal-rounds'] ?? 1);
 assert(Number.isInteger(normalRounds) && normalRounds >= 0 && normalRounds <= 10, 'normal-rounds must be 0..10');
 assert.equal(rules.match.teams, 4); assert.equal(rules.match.players_per_team, 4);
 const output = path.resolve(root, options.output || 'runs/squads-validation.json');
 const report = {complete: false, kind: 'live_acceptance', started_at: new Date().toISOString(), rules_version: rules.version, normal_rounds_requested: normalRounds, acceptance_scope: normalRounds ? 'controlled_and_normal_matches' : 'controlled_only', checks: [], matches: []};
 let state = {}, observerError, socket, redis, store, control, currentMatch, originalPaused, admissionChanged = false, heartbeat;
 const owned = new Set(), owner = crypto.randomUUID();
 let lockKey, lockOwned = false, cancelling = false, lastProgress = 0;
 function save() {fs.mkdirSync(path.dirname(output), {recursive: true}); const temp = output + '.tmp'; fs.writeFileSync(temp, JSON.stringify(report, null, 2) + '\n'); fs.renameSync(temp, output);}
 function pass(name, details = {}) {report.checks.push({name, passed: true, ...details}); save(); console.log('PASS', name);}
 async function api(route, data) {
  const r = await fetch(`http://127.0.0.1:${config.web_port}/api/${route}`, {method: data === undefined ? 'GET' : 'POST', headers: {'Content-Type':'application/json'}, body: data === undefined ? undefined : JSON.stringify(data), signal: AbortSignal.timeout(10000)});
  const value = await r.json(); if (!r.ok) throw Error(value.error || `HTTP ${r.status}`); return value;
 }
 async function until(label, predicate, timeout = 25000, {cleanup = false} = {}) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
   if (!cleanup && (cancelling || observerError)) throw Error(cancelling ? 'Verification interrupted; cleaning up its own reservation' : observerError);
   if (await predicate()) return;
   if (Date.now() - lastProgress > 10000) {lastProgress = Date.now(); console.log('WAIT', label, `phase=${state.phase || 'connecting'} tick=${state.tick || 0}`);}
   await sleep(500);
  }
  throw Error('Timed out: ' + label);
 }
 function readLive(match) {
  try {const row = JSON.parse(fs.readFileSync(path.join(matchDirectory(root,config,match.id),'live.json'),'utf8')); return Date.now()-Date.parse(row.updated_at)<10000 ? row : null;} catch {return null;}
 }
 const onSignal = () => {cancelling = true;};
 process.on('SIGINT', onSignal); process.on('SIGTERM', onSignal);
 async function startRound(kind) {
  await api('pause', {paused: true});
  const idle = await api('status');
  assert(!idle.arenas.some(a => a.task_id) && !idle.entrants.some(e => e.state === 'waiting'), 'Verification needs an empty waiting queue and arena');
  const roster = (await api('demo', {count: 16, rounds: 1})).entrants;
  roster.forEach(e => owned.add(e.id)); const names = new Set(roster.map(e => e.name));
  await api('pause', {paused: false});
  await until('reservation', async () => {
   const found = await store.active(config.arenas[0].id);
   if (!found) return false;
   assert(found.players.every(p => names.has(p.name)), 'An unrelated roster was reserved');
   currentMatch = found;
   const status = (await control.request('status')).arenas.find(a => a.arena_id === found.arena_id);
   return status?.task_id === found.id;
  }, config.join_timeout_ms || 180000);
  // Prevent admission of another round while saving/resetting this one.
  await api('pause', {paused: true});
  if (kind === 'controlled') await control.command('validation_start', currentMatch);
  await until('16 clients in running game', () => state.match_id === currentMatch.id && state.phase === 'running' && state.players?.length === 16, config.join_timeout_ms || 180000);
  assertRoster(state.players, currentMatch.players);
  report.matches.push({id: currentMatch.id, kind}); save();
  return currentMatch;
 }
 async function finishRound(match) {
  await until('durable result', async () => Boolean(await store.result(match.id)), 60000);
  const result = await store.result(match.id);
  const replay = path.resolve(root, config.server_root, 'plugins/SkyDuelReferee/replays', match.id + '.json');
  assert(fs.existsSync(replay) && fs.statSync(replay).size > 0, 'Full replay file must be saved');
  assert(await validateReplay(replay,match),'Every replay frame and the final frame count must validate');
  await until('in-place arena restoration', async () => !(await store.active(match.arena_id)), config.reset_timeout_ms || 180000);
  const released = (await control.request('status')).arenas.find(a => a.arena_id === match.arena_id);
  assert.equal(released.state, 'available'); assert.equal(released.beds_ready, true);
  assert.equal(released.last_released, match.id + '/' + match.token, 'Matching release receipt is required');
  Object.assign(report.matches.find(m => m.id === match.id), {result, replay, released: true});
  currentMatch = null; save(); return result;
 }
 try {
  redis = new Redis({host:'127.0.0.1',port:config.redis_port,maxRetriesPerRequest:1,connectTimeout:3000,retryStrategy:() => null}); redis.on('error', () => {});
  store = new Store(redis, config.namespace, {teams: Object.keys(rules.map.teams), players_per_team: 4});
  lockKey = store.k('verification');
  lockOwned = Boolean(await redis.set(lockKey, owner, 'PX', 90000, 'NX'));
  assert(lockOwned, 'Another verification owns this instance');
  heartbeat = setInterval(() => redis.eval("if redis.call('GET',KEYS[1])==ARGV[1] then return redis.call('PEXPIRE',KEYS[1],90000) end;return 0",1,lockKey,owner).then(ok => {if(!ok)observerError='Verification lease lost';}).catch(e => {observerError=e.message;}), 15000);
  const initial = await api('status'); originalPaused = initial.paused;
  assert.equal(initial.namespace, config.namespace); assert.equal(initial.arenas.length, 1);
  assert.equal(initial.arenas[0].state, 'available');
  assert.deepEqual(initial.format, {teams: Object.keys(rules.map.teams), players_per_team: 4});
  assert(!initial.arenas.some(a => a.task_id) && !initial.entrants.some(e => e.state === 'waiting'), 'Use an idle instance without waiting entrants');
  const needed = startupBudget(config, 0, true);
  assert(initial.metrics.free_mb >= needed, `Host needs ${needed} MiB free after Minecraft startup before admitting 16 clients`);
  await api('pause', {paused: true}); admissionChanged = true;
  control = new Control({port:config.control_port});
  socket = net.createConnection({host:'127.0.0.1',port:config.arenas[0].observer_port});
  let buffer = '';
  socket.on('error', e => {observerError=e.message;});
  socket.on('close', () => {observerError='Observer connection closed';});
  socket.on('data', chunk => {
   buffer += chunk;
   if(buffer.length>4*1024*1024){observerError='Oversized observer message';socket.destroy();return;}
   let end;
   while((end=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,end);buffer=buffer.slice(end+1);try{state=JSON.parse(line);}catch{observerError='Malformed observer JSON';}}
  });
  const match = await startRound('controlled');
  await until('test marker', () => state.test_run === true);
  pass('sixteen_players_in_reserved_teams', {match_id:match.id});
  assertBeds(state.world_objects.beds,rules); pass('all_eight_bed_blocks_color_orientation_and_part');
  await until('active controller report', () => readLive(match)?.agents.every(a => a.match_id===match.id));
  const baseline = readLive(match), baselineTick = state.tick;
  await until('100 active updates from every client', () => {
   const live=readLive(match);
   return state.phase==='running' && state.tick-baselineTick>=200 && live?.agents.length===16 && live.agents.every(a => a.active_steps-(baseline.agents.find(b=>b.name===a.name)?.active_steps??Infinity)>=100);
  }, 120000);
  const live=readLive(match);
  assert(live.agents.every(a=>a.inventory.some(i=>i.count>0)), 'All clients must receive an in-game inventory');
  pass('each_client_at_least_100_active_updates', {runtime:live.runtime,tick:state.tick});
  if(config.distinct_models){
   assert.equal(new Set(live.agents.map(a=>a.model_weights_sha256).filter(Boolean)).size,config.distinct_models,'Every seat must use independently trained numeric weights');
   assert(live.agents.every(a=>a.model_parameter_bytes>=(config.min_model_parameter_bytes||0)),'All actors must meet the configured numeric parameter size');
   pass('independent_trained_actors_on_every_seat',{distinct_models:config.distinct_models,parameter_bytes:live.agents.map(a=>a.model_parameter_bytes),model_ids:live.agents.map(a=>a.model_id)});
  }
  await control.command('validation_hold',match);
  await until('held test agents',()=>state.test_controls_paused===true); await sleep(1000);
  const red=match.players.filter(p=>p.team==='Red'),probe=red[0].name;
  await control.command('validation_death',match,{player:probe});
  await until('normal respawn countdown',()=>state.players.find(p=>p.name===probe)?.mode==='SPECTATOR');
  await until('normal respawn with bed intact',()=>state.players.find(p=>p.name===probe)?.mode==='SURVIVAL');
  pass('bed_intact_allows_normal_respawn');
  await control.command('validation_death',match,{player:probe});
  await until('second respawn countdown',()=>state.players.find(p=>p.name===probe)?.mode==='SPECTATOR');
  await control.command('validation_beds_gone',match);
  await until('all beds removed',()=>state.teams.length===4&&state.teams.every(t=>!t.bed));
  assert.equal(state.players.find(p=>p.name===probe)?.respawn_pending,true,'Breaking a bed preserves the pending respawn');
  await until('earned respawn after losing bed',()=>state.players.find(p=>p.name===probe)?.mode==='SURVIVAL');
  assert.equal(state.players.find(p=>p.name===probe)?.respawn_seconds,0);
  pass('bed_destroyed_during_countdown_preserves_one_earned_respawn');
  for(const p of red.slice(0,3))await control.command('validation_kill',match,{player:p.name});
  await until('three final deaths',()=>red.slice(0,3).every(p=>state.players.find(e=>e.name===p.name)?.mode==='SPECTATOR'));
  const finalDeathTick=state.tick;await until('final deaths stay eliminated',()=>state.tick>=finalDeathTick+140);
  assert(red.slice(0,3).every(p=>{const player=state.players.find(e=>e.name===p.name);return player?.mode==='SPECTATOR'&&!player.respawn_pending&&player.respawn_seconds===0;}));
  pass('death_after_bed_destruction_cannot_respawn');
  assert.equal(state.teams.find(t=>t.name==='Red')?.alive,true); pass('three_deaths_do_not_eliminate_four_person_team');
  await control.command('validation_kill',match,{player:red[3].name});
  await until('fourth final death',()=>state.teams.find(t=>t.name==='Red')?.alive===false); pass('fourth_death_eliminates_team');
  for(const p of match.players.filter(p=>['Blue','Green'].includes(p.team)))await control.command('validation_kill',match,{player:p.name});
  const result=await finishRound(match);
  assert.equal(result.winner,'Yellow'); assert.equal(result.status,'test'); assert.deepEqual(result.winner_ids,[]);
  const controlledSummary=JSON.parse(fs.readFileSync(path.join(config.server_root,'plugins/SkyDuelReferee/replays/results',match.id+'.json'),'utf8'));
  const broken=new Set(),earned=new Set();
  for(const event of controlledSummary.events){
   if(event.type==='bed_destroyed')broken.add(event.team);
   if(event.type==='death'){
    const team=event.team||match.players.find(p=>p.name===event.player)?.team;
    assert.equal(event.final,broken.has(team),'Final death is determined by the bed state at death');
    if(!event.final)earned.add(event.player);else earned.delete(event.player);
   }
   if(event.type==='respawn'){assert(earned.delete(event.player),'Each respawn must consume a death-time entitlement');}
  }
  pass('complete_recording_only_contains_earned_respawns');
  const scores=(await store.snapshot()).scores;
  assert(match.players.every(p=>Number(scores[p.id+':wins']||0)===0));
  pass('unscored_test_result_saved_and_all_beds_restored');
  for(let round=1;round<=normalRounds;round++){
   const normal=await startRound('normal'),samples=[],explored=new Set();let lastSample=0;
   await until('normal full match '+round,async()=>{
    for(const team of exploredTeams(state.players||[],rules))explored.add(team);
    const saved=await store.result(normal.id);if(saved)return true;
    if(Date.now()-lastSample>=5000){
     lastSample=Date.now();const status=await api('status'),runtime=readLive(normal)?.runtime;
     if(state.phase==='running'&&state.tick>=200)samples.push({tick:state.tick,tps:status.metrics.tps,mspt:status.metrics.mspt,free_mb:status.metrics.free_mb,ai:runtime});
    }
    return false;
   }, (config.match_timeout_ms||2400000)+60000);
   const result=await finishRound(normal),performance=summarizePerformance(samples);
   const summary=JSON.parse(fs.readFileSync(path.resolve(root,config.server_root,'plugins/SkyDuelReferee/replays/results',normal.id+'.json'),'utf8'));
   const upgrades=summary.events.filter(e=>e.type==='upgrade');
   const activity={teams_left_base:[...explored],blocks_placed:result.event_counts.block_place||0,player_bed_breaks:summary.events.filter(e=>e.type==='bed_destroyed'&&e.player).length,
    team_upgrades:upgrades.length,teams_upgraded:[...new Set(upgrades.map(e=>e.team))],beds_destroyed:summary.events.filter(e=>e.type==='bed_destroyed').map(e=>({team:e.team,player:e.player,tick:e.tick}))};
   Object.assign(report.matches.find(m=>m.id===normal.id),{performance,activity});save();
   assert.equal(result.status,'complete','A normal game must finish without disconnection, truncation or test controls');
   assert.equal(explored.size,4,'Every team must move beyond its base onto a supported route');
   assert(activity.blocks_placed>=4&&activity.player_bed_breaks>=1,'Normal play must include real construction and a player breaking an enemy bed');
   assert(activity.team_upgrades>=1,'Collectors must return diamonds and purchase an actual team upgrade');
   assert(samples.length>=3,'Need at least three steady-state performance samples');
   assert(performance.tps_p05>=Number(options['min-tps']||18),'Live TPS below acceptance target');
   assert(performance.mspt_p95<=Number(options['max-mspt']||50),'Live MSPT above acceptance target');
   pass('normal_match_'+round+'_saved_and_reset',{match_id:normal.id,performance});
  }
  report.complete=true;
 } catch(e){report.error=e.stack;process.exitCode=1;console.error(e.message);}
 finally{
  clearInterval(heartbeat);
  if(store&&owned.size)await Promise.all([...owned].map(id=>store.withdraw(id).catch(()=>{})));
  if(currentMatch&&control&&store){
   try{
    const active=await store.active(currentMatch.arena_id);
    if(active?.id===currentMatch.id&&active.token===currentMatch.token){
     await control.command('abort',currentMatch);
     await until('cleanup own reservation',async()=>!(await store.active(currentMatch.arena_id)),config.reset_timeout_ms||180000,{cleanup:true});
    }
   }catch(e){report.cleanup_error=e.message;process.exitCode=1;report.complete=false;}
  }
  if(admissionChanged)try{await api('pause',{paused:originalPaused});}catch(e){report.restore_pause_error=e.message;report.complete=false;process.exitCode=1;}
  socket?.destroy();control?.close();
  if(redis){if(lockOwned)await redis.eval("if redis.call('GET',KEYS[1])==ARGV[1] then return redis.call('DEL',KEYS[1]) end;return 0",1,lockKey,owner).catch(()=>{});redis.disconnect();}
  process.off('SIGINT',onSignal);process.off('SIGTERM',onSignal);
  report.finished_at=new Date().toISOString();save();console.log('Report:',output);
 }
 return report;
}
module.exports={assertRoster,assertBeds,summarizePerformance,exploredTeams,main};
if(require.main===module)main().catch(e=>{console.error(e.message);process.exitCode=1;});
