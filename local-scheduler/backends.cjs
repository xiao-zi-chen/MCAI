// Arena placement is shared by control, agent launch, viewers and replay validation.
function backends(config){
 const values=config.servers?.length?config.servers:[{id:'default',server_root:config.server_root,game_port:config.game_port,control_port:config.control_port||25610,rcon_port:config.rcon_port||25578}];
 const ids=new Set(),roots=new Set(),ports=new Set();
 for(const s of values){
  if(!s.id||ids.has(s.id)||!s.server_root||roots.has(s.server_root))throw Error('Duplicate or missing backend ID/root');
  ids.add(s.id);roots.add(s.server_root);
  for(const k of ['game_port','control_port','rcon_port']){if(!Number.isInteger(s[k])||s[k]<1||s[k]>65535||ports.has(s[k]))throw Error('Invalid or overlapping backend port');ports.add(s[k]);}
 }
 const arenas=new Set();for(const a of config.arenas){if(arenas.has(a.id))throw Error('Duplicate arena ID');arenas.add(a.id);if(!ids.has(a.server_id||values[0].id))throw Error('Unknown arena backend');}
 return values;
}
function backendFor(config,id){const all=backends(config),a=config.arenas.find(a=>a.id===id);if(!a)throw Error('Unknown arena: '+id);return all.find(s=>s.id===(a.server_id||all[0].id));}
module.exports={backends,backendFor};
