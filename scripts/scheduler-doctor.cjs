// Read-only readiness checks. Never accepts the EULA, installs software or starts services.
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const os = require('node:os');
const crypto = require('node:crypto');
const {execFileSync} = require('node:child_process');
const root = path.resolve(__dirname, '..');
function properties(text) {
 const out = {};
 for (const line of text.split(/\r?\n/)) {
  const m = /^\s*([^#!\s=]+)\s*=\s*(.*?)\s*$/.exec(line);
  if (m) out[m[1]] = m[2];
 }
 return out;
}
function startupBudget(config, memoryGB, running = false) {
 return (running ? 0 : memoryGB * 1024 + (config.jvm_overhead_mb ?? 512)) +
  (config.min_free_mb ?? 512) + (config.admission_reserve_mb ?? 256);
}
function localPath(base, relative) {
 const resolved = path.resolve(base, relative);
 const rel = path.relative(base, resolved);
 if (!rel || rel.startsWith('..' + path.sep) || rel === '..' || path.isAbsolute(rel)) throw Error('Path must be a child of the project: ' + relative);
 return resolved;
}
function ports(config) {
 const entries = [['redis', config.redis_port], ['game', config.game_port], ['rcon', config.rcon_port || 25578], ['control', config.control_port], ['dashboard', config.web_port]];
 for (const arena of config.arenas || []) entries.push([arena.id + ':observer', arena.observer_port], [arena.id + ':viewer', arena.viewer_port]);
 const used = new Set();
 for (const [name, port] of entries) {
  if (!Number.isInteger(port) || port < 1 || port > 65535 || used.has(port)) throw Error('Invalid or duplicate port for ' + name);
  used.add(port);
 }
 return entries;
}
function listening(port) {
 return new Promise(resolve => {
  const socket = net.createConnection({host: '127.0.0.1', port});
  let done = false;
  const finish = open => {if (done) return; done = true; socket.destroy(); resolve(open);};
  socket.setTimeout(400, () => finish(false)); socket.once('connect', () => finish(true)); socket.once('error', () => finish(false));
 });
}
function hash(file) { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }
async function inspect({configFile = 'configs/scheduler.squads.json', javaHome = '', redisExe = '', memoryGB = 4, includeMemory = true} = {}) {
 const checks = [];
 const add = (id, ok, detail, fix = '') => checks.push({id, ok: Boolean(ok), detail, ...(fix ? {fix} : {})});
 const configPath = path.resolve(root, configFile);
 const config = JSON.parse(fs.readFileSync(configPath, 'utf8').replace(/^\uFEFF/, ''));
 const server = localPath(root, config.server_root), scheduler = localPath(root, config.scheduler_root || 'runs/scheduler');
 const rulesFile = localPath(root, config.rules_file || 'competition/rules.json');
 const rules = JSON.parse(fs.readFileSync(rulesFile, 'utf8'));
 const size = rules.match.teams * rules.match.players_per_team;
 const viewDistance=config.agent_view_distance??(size>2?4:16);
 add('agent_view_distance',Number.isInteger(viewDistance)&&viewDistance>=2&&viewDistance<=32,`AI view distance: ${viewDistance} chunks`,'Set agent_view_distance to an integer from 2 to 32');
 let portEntries = [];
 try {portEntries = ports(config); add('ports', true, 'All configured ports are distinct');} catch (e) {add('ports', false, e.message);}
 const portState = Object.fromEntries(await Promise.all(portEntries.map(async ([name, port]) => [name, await listening(port)])));
 add('node', Number(process.versions.node.split('.')[0]) >= 22, 'Node ' + process.versions.node, 'Use Node 22 or later');
 const javaResult = require('node:child_process').spawnSync(javaHome ? path.join(javaHome, 'bin', process.platform === 'win32' ? 'java.exe' : 'java') : 'java', ['-version'], {encoding: 'utf8', windowsHide: true, timeout: 8000});
 const javaText = (javaResult.stdout || '') + (javaResult.stderr || ''), javaMajor = Number(/version "(\d+)/.exec(javaText)?.[1]);
 add('java', javaResult.status === 0 && javaMajor === 21, javaText.split(/\r?\n/)[0] || 'Java cannot start', 'This prepared Paper 1.21 profile is validated with JDK 21; pass -JavaHome');
 for (const [id, dir, modules] of [
  ['scheduler_dependencies', 'local-scheduler', ['bullmq', 'ioredis']],
  ['agent_dependencies', 'bot-controller', ['mineflayer', 'mineflayer-pathfinder', 'vec3']]
 ]) {
  try {for (const m of modules) require.resolve(m, {paths: [path.join(root, dir)]}); add(id, true, modules.join(', '));}
  catch {add(id, false, 'Missing Node dependencies in ' + dir, 'Run npm ci in ' + dir);}
 }
 const viewerModules = process.env.BEDWARS_VIEWER_MODULES || (fs.existsSync(path.join(root, 'local-viewer/node_modules')) ? path.join(root, 'local-viewer/node_modules') : 'D:/codex-local-cache/skyduel-viewer/node_modules');
 try {for (const m of ['prismarine-viewer', 'three']) require.resolve(m, {paths: [viewerModules]}); add('viewer_dependencies', true, viewerModules);}
 catch {add('viewer_dependencies', false, 'Viewer modules missing', 'Install local-viewer dependencies or set BEDWARS_VIEWER_MODULES');}
 try {
  const catalog = JSON.parse(fs.readFileSync(path.join(root, 'runs/native-assets-1.21/items.json'), 'utf8'));
  const textures = new Set(['entity/player/wide/steve', 'entity/villager/villager', 'misc/enchanted_glint_item']);
  for (const team of Object.keys(rules.map.teams)) {
   if (!catalog.items[team.toLowerCase() + '_wool']) throw Error('Missing team item model: ' + team);
   textures.add('entity/bed/' + team.toLowerCase());
  }
  for (const name of Object.keys(catalog.textures)) textures.add(name);
  for (const model of Object.values(catalog.items)) for (const element of model.elements || []) for (const face of Object.values(element.faces)) textures.add(face.texture);
  for (const name of textures) if (!fs.existsSync(path.join(root, 'downloads/minecraft-assets-1.21/assets/minecraft/textures', name + '.png'))) throw Error('Missing texture: ' + name);
  add('viewer_assets', catalog.client_sha1 === '0e9a07b9bb3390602f977073aa12884a4ce12431', `${textures.size} official viewer textures and team models available`);
 } catch (e) {add('viewer_assets', false, e.message, 'Prepare the official item catalog and textures with scripts/prepare-native-items.py --rules-file=' + config.rules_file);}
 const python = process.env.SKYDUEL_PYTHON || path.join(root, process.platform === 'win32' ? '.venv/Scripts/python.exe' : '.venv/bin/python');
 try {execFileSync(python, ['-c', 'import yaml, jsonschema'], {windowsHide: true, timeout: 15000, stdio: 'pipe'}); add('python', true, 'Python, PyYAML and jsonschema available');}
 catch {add('python', false, 'Python environment incomplete', 'Install the repository Python requirements');}
 for (const [source, target] of [
  ['downloads/paper-1.21.jar', 'paper.jar'],
  ['bedwars-map-plugin/build/libs/local-bedwars-map-0.2.0.jar', 'plugins/LocalBedwarsMap.jar'],
  ['referee-plugin/build/libs/skyduel-referee-0.1.0.jar', 'plugins/SkyDuelReferee.jar'],
  [config.rules_file || 'competition/rules.json', 'plugins/LocalBedwarsMap/competition-rules.json'],
  [config.rules_file || 'competition/rules.json', 'plugins/SkyDuelReferee/competition-rules.json']
 ]) {
  try {add(target, hash(path.resolve(root, source)) === hash(path.join(server, target)), 'Prepared artifact matches build/source', 'Run -Mode Prepare while the server is stopped');}
  catch {add(target, false, 'Prepared artifact missing', 'Run -Mode Prepare');}
 }
 add('bedwars_plugin', fs.existsSync(path.join(server, 'plugins/BedWars-0.2.44.jar')), 'BedWars plugin installed', 'Run the repository dependency setup, then -Mode Prepare');
 const modelIds=config.model_profiles_file?JSON.parse(fs.readFileSync(localPath(root,config.model_profiles_file),'utf8')).profiles.map(p=>p.id):['EmberAI','BastionAI'];
 const weightHashes=new Set();
 for (const name of modelIds) {
  try {const file=localPath(root,path.join(config.model_directory||'models/showcase',name+'.json')),runtime=require('./policy-runtime.cjs'),actor=runtime.compile(runtime.loadModel(file));weightHashes.add(actor.sha256);add('model_'+name,actor.parameter_bytes>=(config.min_model_parameter_bytes||0),`${name}: ${actor.parameters} parameters, ${actor.parameter_bytes} bytes of numeric weights`);}
  catch(e){add('model_'+name,false,e.message,'Prepare the configured actor weights');}
 }
 if(config.distinct_models)add('distinct_models',weightHashes.size===config.distinct_models,`${weightHashes.size} independently trained weight sets`);
 if (rules.map.asset_directory) {
  try {
   const assets = localPath(root, rules.map.asset_directory), manifest = JSON.parse(fs.readFileSync(path.join(assets, 'manifest.json'), 'utf8'));
   for (const [name, spec] of Object.entries(manifest.files)) {
    if (hash(path.join(assets, name + '.blocks.gz')) !== spec.blocks_sha256 || hash(path.join(server, 'plugins/LocalBedwarsMap/structures', name + '.blocks.gz')) !== spec.blocks_sha256) throw Error('Mismatch: ' + name);
   }
   add('map_assets', true, 'All imported structure checksums match');
  } catch (e) {add('map_assets', false, e.message, 'Run -Mode Prepare');}
 }
 const eulaFile = path.join(server, 'eula.txt');
 add('eula', fs.existsSync(eulaFile) && properties(fs.readFileSync(eulaFile, 'utf8')).eula === 'true', 'Explicit EULA acceptance for this instance', 'Read the Minecraft EULA, then use -AcceptEula only if you agree');
 try {
  const props = properties(fs.readFileSync(path.join(server, 'server.properties'), 'utf8'));
  add('server_properties', props['server-ip'] === '127.0.0.1' && Number(props['server-port']) === config.game_port && props['level-name'] === rules.map.world && Number(props['max-players']) >= size + 1 && props['enable-rcon'] === 'true' && Number(props['rcon.port']) === (config.rcon_port || 25578), 'Loopback binding, world, player capacity and RCON ports', 'Run -Mode Prepare');
 } catch (e) {add('server_properties', false, e.message, 'Run -Mode Prepare');}
 let serverRunning = false;
 if (portState.game || portState.control) {
  const {Control} = require('../local-scheduler/control.cjs'), control = new Control({port: config.control_port, timeoutMs: 2000});
  try {
   const state = await control.request('status');
   serverRunning = portState.game && config.arenas.every(a => state.arenas.some(s => s.arena_id === a.id && s.world === a.world && s.required_players === size));
   add('server_identity', serverRunning, 'Existing server matches configured arena worlds and roster', 'Check the instance logs and occupied ports');
  } catch (e) {add('server_identity', false, e.message, 'Another process may occupy the game/control ports, or Minecraft is still starting');}
  finally {control.close();}
 }
 if (portState.dashboard) {
  try {const response = await fetch(`http://127.0.0.1:${config.web_port}/api/status`, {signal: AbortSignal.timeout(2500)}); const state = await response.json(); add('dashboard_identity', state.namespace === config.namespace, 'Existing coordinator namespace matches', 'Use the configured instance dashboard port');}
  catch (e) {add('dashboard_identity', false, e.message, 'Dashboard port is occupied by an unexpected service');}
 }
 if (portState.redis) {
  let redis;
  try {
   const Redis = require('../local-scheduler/node_modules/ioredis');
   redis = new Redis({host: '127.0.0.1', port: config.redis_port, maxRetriesPerRequest: 1, connectTimeout: 2000, commandTimeout: 2000, retryStrategy: () => null}); redis.on('error', () => {});
   const [policy, append, sync] = await Promise.all(['maxmemory-policy', 'appendonly', 'appendfsync'].map(k => redis.config('GET', k)));
   add('redis', policy[1] === 'noeviction' && append[1] === 'yes' && sync[1] === 'always', 'Dedicated Redis persistence and eviction policy', 'Use the dedicated Redis created by this launcher');
  } catch (e) {add('redis', false, e.message, 'Check the configured Redis port');} finally {redis?.disconnect();}
 } else add('redis_executable', Boolean(redisExe && fs.existsSync(redisExe)), redisExe || 'Redis executable not resolved', 'Pass -RedisExe or install redis-server on PATH');
 for (const [name, open] of Object.entries(portState)) if (open && name.endsWith(':observer') && !serverRunning) add(name, false, 'Observer port occupied without the expected Minecraft server');
 if (!serverRunning && portState.rcon) add('rcon_port', false, 'RCON port is already occupied');
 const freeMB = require('../local-scheduler/resources.cjs').memoryBudget().free_mb, requiredMB = startupBudget(config, memoryGB, serverRunning);
 add('memory', !includeMemory || freeMB >= requiredMB, `${freeMB} MiB free; launch budget ${requiredMB} MiB (heap ${memoryGB} GiB, configured reserves included)`, 'Free memory in other applications, or select -MemoryGB 2 for the smaller configured heap');
 return {checked_at: new Date().toISOString(), ready: checks.every(c => c.ok), config: configPath, server_root: server, scheduler_root: scheduler, format: `${rules.match.teams}x${rules.match.players_per_team}`, server_running: serverRunning, memory: {free_mb: freeMB, required_mb: requiredMB}, checks};
}
async function main(args) {
 const options = Object.fromEntries(args.map(arg => {const m = /^--([a-z-]+)=(.*)$/.exec(arg); if (!m) throw Error('Use --option=value'); return [m[1], m[2]];}));
 const report = await inspect({configFile: options.config, javaHome: options['java-home'], redisExe: options['redis-exe'], memoryGB: Number(options['memory-gb'] || 4)});
 if (options.output) {fs.mkdirSync(path.dirname(path.resolve(options.output)), {recursive: true}); fs.writeFileSync(options.output, JSON.stringify(report, null, 2) + '\n');}
 if (options.json === 'true') console.log(JSON.stringify(report, null, 2));
 else {for (const c of report.checks) console.log(`${c.ok ? 'PASS' : 'FAIL'} ${c.id}: ${c.detail}${!c.ok && c.fix ? '\n     ' + c.fix : ''}`); console.log(report.ready ? 'READY' : 'NOT READY; no services were started by the doctor.');}
 process.exitCode = report.ready ? 0 : 1;
}
module.exports = {inspect, properties, startupBudget, localPath, ports};
if (require.main === module) main(process.argv.slice(2)).catch(e => {console.error(e.message); process.exitCode = 1;});
