// Import only the block artwork, never upstream entities, loot or datapack commands.
const fs=require('node:fs'),path=require('node:path'),zlib=require('node:zlib'),crypto=require('node:crypto');
const nbt=require('../bot-controller/node_modules/prismarine-nbt');
const root=path.resolve(__dirname,'..'),dir=path.join(root,'maps/crypt-squads');
const commit='aad1a8e250016ef1283f823367249cc0b8f0d15b';
const hashes={red_base:'2968a5b0cd4af38a73903c3cba346f301b181b503c2eae0eee4d74df789df095',diamond:'d192f8c6a39b6269d2a3090989bf80f54c948dff840bc8c3d350d7a0200c83e6',emerald:'031a749c33a0e34c36808230eed68d52530eca0bfd2e81dd1d9689f71a96020b'};
async function main(){
 fs.mkdirSync(path.join(dir,'upstream'),{recursive:true});
 const mc=require('../bot-controller/node_modules/minecraft-data')('1.21'),manifest={repository:'https://github.com/atomic-cogwheel0/act-bedwars',commit,license:'GPL-3.0-only',files:{}};
 for(const [name,hash]of Object.entries(hashes)){
  const file=path.join(dir,'upstream',name+'.nbt');
  if(!fs.existsSync(file)){const r=await fetch(`https://raw.githubusercontent.com/atomic-cogwheel0/act-bedwars/${commit}/datapack/bedwars/data/crypt/structure/${name}.nbt`);if(!r.ok)throw Error(`Download failed: ${r.status}`);const data=Buffer.from(await r.arrayBuffer());if(crypto.createHash('sha256').update(data).digest('hex')!==hash)throw Error('Source checksum mismatch');fs.writeFileSync(file,data);}
  const raw=fs.readFileSync(file);if(crypto.createHash('sha256').update(raw).digest('hex')!==hash)throw Error('Source checksum mismatch: '+name);
  const {parsed}=await nbt.parse(raw),data=nbt.simplify(parsed),lines=[];
  for(const block of data.blocks){const p=data.palette[block.state],id=p.Name.replace('minecraft:','');
   if(!mc.blocksByName[id])throw Error('Not available in Minecraft 1.21: '+id);
   for(const [key,value]of Object.entries(p.Properties||{})){
    const state=mc.blocksByName[id].states.find(s=>s.name===key);
    if(!state||!(state.type==='bool'?['true','false']:state.values||Array.from({length:state.num_values},(_,i)=>String(i))).includes(String(value)))throw Error(`Unsupported 1.21 block state: ${id}[${key}=${value}]`);
   }
   if(['air','cave_air','void_air','structure_void','structure_block','command_block','chain_command_block','repeating_command_block','barrier','spawner','vault','trial_spawner'].includes(id)||id.endsWith('_bed'))continue;
   const props=Object.entries(p.Properties||{}).sort().map(([k,v])=>k+'='+v).join(',');
   lines.push(block.pos.join(' ')+' '+p.Name+(props?'['+props+']':''));
  }
  const output=zlib.gzipSync(lines.join('\n')+'\n',{level:9});fs.writeFileSync(path.join(dir,name+'.blocks.gz'),output);
  manifest.files[name]={source_sha256:hash,blocks_sha256:crypto.createHash('sha256').update(output).digest('hex'),blocks:lines.length,size:data.size,source_data_version:data.DataVersion};
 }
 fs.writeFileSync(path.join(dir,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
 console.log('Imported Crypt block artwork:',Object.fromEntries(Object.entries(manifest.files).map(([k,v])=>[k,v.blocks])));
}
if(require.main===module)main().catch(e=>{console.error(e);process.exitCode=1});
