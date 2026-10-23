// A read-only, pristine map snapshot for 3D replays. No live entities or updates
// are sent to a replay socket. Snapshots are keyed by the frozen map definition.
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const crypto = require('node:crypto');
const { Vec3 } = require('../bot-controller/node_modules/vec3');

class ReplayWorld {
  constructor({viewerRequire, directory, rules}) {
    this.directory=directory;this.rules=rules;this.cache=new Map();this.lastError='';
    this.Chunk=viewerRequire('prismarine-chunk')('1.21.1');
    this.Block=viewerRequire('prismarine-block')('1.21.1');
    this.data=viewerRequire('minecraft-data')('1.21.1');
  }
  key(rules) {
    // Bukkit/Gson omits null object properties; key order does not change a map.
    const normalize=value=>Array.isArray(value)?value.map(normalize):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().filter(k=>value[k]!==null).map(k=>[k,normalize(value[k])])):value;
    return crypto.createHash('sha256').update(JSON.stringify(normalize(rules.map))).digest('hex');
  }
  read(rules) {
    const key=this.key(rules);
    if(this.cache.has(key))return this.cache.get(key);
    let file=path.join(this.directory,key+'.json.gz');
    if(!fs.existsSync(file)&&key===this.key(this.rules)) {
      const legacy=crypto.createHash('sha256').update(JSON.stringify(this.rules.map)).digest('hex');
      file=path.join(this.directory,legacy+'.json.gz');
    }
    if(!fs.existsSync(file))return null;
    const snapshot=JSON.parse(zlib.gunzipSync(fs.readFileSync(file)).toString('utf8'));
    snapshot.columns=new Map(snapshot.chunks.map(c=>[c.x+','+c.z,this.Chunk.fromJson(c.chunk)]));
    this.cache.set(key,snapshot);return snapshot;
  }
  capture(bot,state) {
    if(state.phase!=='waiting'||this.read(this.rules))return;
    // A reset must have finished: both beds exist and their covering blocks are air.
    for(const team of Object.values(this.rules.map.teams)) {
      const p=new Vec3(...team.bed),bed=bot.blockAt(p),cover=bot.blockAt(p.offset(0,1,0));
      if(!bed?.name.endsWith('_bed')||cover?.name!=='air')return;
    }
    const chunks=[];
    const {build_min:lo,build_max:hi}=this.rules.map;
    for(let x=Math.floor(lo[0]/16);x<=Math.floor(hi[0]/16);x++)for(let z=Math.floor(lo[2]/16);z<=Math.floor(hi[2]/16);z++) {
      const column=bot.world.getColumn(x,z);if(!column)return;
      chunks.push({x:x*16,z:z*16,chunk:column.toJson()});
    }
    const snapshot={version:'1.21.1',map_id:this.rules.map.id,map:this.rules.map,captured_at:new Date().toISOString(),chunks};
    fs.mkdirSync(this.directory,{recursive:true});
    fs.writeFileSync(path.join(this.directory,this.key(this.rules)+'.json.gz'),zlib.gzipSync(JSON.stringify(snapshot)));
    console.log('Captured pristine replay map:',snapshot.map_id,chunks.length,'chunks');
    this.read(this.rules);
  }
  stateId(block) {
    const match=/^(?:minecraft:)?([a-z0-9_]+)(?:\[(.*)\])?$/.exec(block);
    const type=this.data.blocksByName[match?.[1]];
    if(!type)throw new Error('回放包含不支持的方块：'+block);
    if(!match[2])return type.defaultState;
    const props=Object.fromEntries(match[2].split(',').map(p=>{const [k,v]=p.split('=');return [k,v==='true'?true:v==='false'?false:/^-?\d+$/.test(v)?Number(v):v]}));
    return this.Block.fromProperties(type.id,props,0).stateId;
  }
  metadata(record,snapshot) {
    const initial={},states={},positions=new Map(),beds={};
    for(const e of record.events) {
      if(['block_place','block_break','block_state'].includes(e.type))positions.set(e.pos.join(','),e.pos);
      if(e.type==='block_place'||e.type==='block_state')states[e.block]=this.stateId(e.block);
      if(e.type==='explosion')for(const p of e.blocks||[])positions.set(p.join(','),p);
    }
    for(const [name,t]of Object.entries(record.rules.map.teams)) {
      const side=Math.sign(t.base_block_x),head=t.bed;
      beds[name]=[head,t.bed_foot||[head[0]-side,head[1],head[2]]];
      for(const p of beds[name])positions.set(p.join(','),p);
    }
    for(const [key,p]of positions) {
      const column=snapshot.columns.get((Math.floor(p[0]/16)*16)+','+(Math.floor(p[2]/16)*16));
      initial[key]=column?.getBlockStateId(new Vec3(p[0]&15,p[1],p[2]&15))||0;
    }
    return {match_id:record.match_id,initial,states,beds,chunks:snapshot.chunks.length,map_id:snapshot.map_id};
  }
  stream(socket,record) {
    if(!record.rules)throw new Error('这份早期记录没有冻结地图，暂不能还原 3D 场景。');
    const snapshot=this.read(record.rules);
    if(!snapshot)throw new Error('还未保存这张地图的初始场景，请在本地比赛复位后重试。');
    const metadata=this.metadata(record,snapshot);
    socket.emit('version',snapshot.version);
    for(const c of snapshot.chunks)socket.emit('loadChunk',c);
    socket.emit('position',{pos:{x:0,y:record.rules.map.surface_y,z:0},addMesh:false});
    // Merchant meshes use the same frozen map in SpectatorActors, including old replays.
    socket.emit('replayReady',metadata);
  }
}
module.exports={ReplayWorld};
