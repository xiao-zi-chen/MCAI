const crypto=require('node:crypto');
const LUA={
 add:`local e=cjson.decode(ARGV[1]);if redis.call('HEXISTS',KEYS[1],e.id)==1 then return redis.error_reply('Entrant already exists') end
 e.state='waiting';e.completed=0;redis.call('HSET',KEYS[1],e.id,cjson.encode(e));redis.call('RPUSH',KEYS[2],e.id);return e.id`,
 allocate:`if redis.call('HEXISTS',KEYS[3],ARGV[1])==1 then return nil end
 local teams=cjson.decode(ARGV[5]);local size=tonumber(ARGV[6]);local required=#teams*size
 local pair={};while #pair<required do local id=redis.call('LPOP',KEYS[2]);if not id then break end
 local raw=redis.call('HGET',KEYS[1],id);if raw then local e=cjson.decode(raw);if e.state=='waiting' and not e.withdraw then table.insert(pair,e) end end end
 if #pair<required then for i=#pair,1,-1 do redis.call('LPUSH',KEYS[2],pair[i].id) end;return nil end
 for i,e in ipairs(pair) do e.team=teams[math.floor((i-1)/size)+1];e.slot=(i-1)%size end
 local m={id=ARGV[2],token=ARGV[3],arena_id=ARGV[1],players=pair,players_per_team=size,state='reserved',created_at=tonumber(ARGV[4])}
 for _,e in ipairs(pair) do e.state='reserved';e.match_id=m.id;redis.call('HSET',KEYS[1],e.id,cjson.encode(e)) end
 redis.call('HSET',KEYS[3],ARGV[1],m.id);redis.call('HSET',KEYS[4],m.id,cjson.encode(m));return cjson.encode(m)`,
 result:`local raw=redis.call('HGET',KEYS[1],ARGV[1]);if not raw then return redis.error_reply('Unknown match') end
 local m=cjson.decode(raw);if m.token~=ARGV[2] then return redis.error_reply('Stale match token') end
 if redis.call('HSETNX',KEYS[2],ARGV[1],ARGV[3])==0 then return 0 end
 local r=cjson.decode(ARGV[3]);for _,e in ipairs(m.players) do
 redis.call('HINCRBY',KEYS[3],e.id..':played',1)
 local won=r.winner_id==e.id;for _,id in ipairs(r.winner_ids or {}) do if id==e.id then won=true end end
 if r.status=='complete' and won then redis.call('HINCRBY',KEYS[3],e.id..':wins',1) end end
 return 1`,
 release:`local raw=redis.call('HGET',KEYS[1],ARGV[1]);if not raw then return redis.error_reply('Unknown match') end
 local m=cjson.decode(raw);if m.token~=ARGV[2] then return redis.error_reply('Stale match token') end
 if m.state=='settled' then return 0 end
 if redis.call('HEXISTS',KEYS[2],m.id)==0 then return redis.error_reply('Result not committed') end
 if redis.call('HGET',KEYS[3],m.arena_id)~=m.id then return redis.error_reply('Arena reservation mismatch') end
 for _,old in ipairs(m.players) do local e=cjson.decode(redis.call('HGET',KEYS[4],old.id));
 if e.match_id~=m.id then return redis.error_reply('Entrant reservation mismatch') end end
 for _,old in ipairs(m.players) do local e=cjson.decode(redis.call('HGET',KEYS[4],old.id));e.completed=e.completed+1;e.match_id=nil
 if e.completed<e.rounds and not e.withdraw then e.state='waiting';redis.call('RPUSH',KEYS[5],e.id) else e.state=e.withdraw and 'withdrawn' or 'done' end
 redis.call('HSET',KEYS[4],e.id,cjson.encode(e)) end
 m.state='settled';m.settled_at=tonumber(ARGV[3]);redis.call('HSET',KEYS[1],m.id,cjson.encode(m));redis.call('HDEL',KEYS[3],m.arena_id);return 1`,
 withdraw:`local raw=redis.call('HGET',KEYS[1],ARGV[1]);if not raw then return 0 end
 local e=cjson.decode(raw);e.withdraw=true;if e.state=='waiting' then e.state='withdrawn' end;redis.call('HSET',KEYS[1],e.id,cjson.encode(e));return 1`,
 state:`local raw=redis.call('HGET',KEYS[1],ARGV[1]);if not raw then return 0 end
 local m=cjson.decode(raw);if m.token~=ARGV[2] then return redis.error_reply('Stale match token') end
 if m.state=='settled' then return 0 end;m.state=ARGV[3];m.updated_at=tonumber(ARGV[4]);m.detail=ARGV[5];redis.call('HSET',KEYS[1],m.id,cjson.encode(m));return 1`
};
class Store{
 constructor(redis,prefix='skyduel-local',format={teams:['Red','Blue'],players_per_team:1},models=['EmberAI','BastionAI']){if(!/^[a-zA-Z0-9_-]+$/.test(prefix))throw Error('Invalid namespace');if(!Array.isArray(format.teams)||format.teams.length<2||new Set(format.teams).size!==format.teams.length||!Number.isInteger(format.players_per_team)||format.players_per_team<1||format.teams.length*format.players_per_team>64)throw Error('Invalid match format');if(!Array.isArray(models)||!models.length||new Set(models).size!==models.length||models.some(m=>!/^[-A-Za-z0-9_]{1,48}$/.test(m)))throw Error('Invalid local model allowlist');this.models=new Set(models);this.redis=redis;this.prefix=prefix;this.format=format;}
 k(name){return `${this.prefix}:${name}`;}
 eval(name,keys,args){return this.redis.eval(LUA[name],keys.length,...keys.map(k=>this.k(k)),...args);}
 async add(e){if(!/^[A-Za-z0-9_]{3,16}$/.test(e.id)||!this.models.has(e.model)||!['rush','fortify'].includes(e.style)||!Number.isInteger(e.rounds)||e.rounds<1||e.rounds>100)throw Error('Invalid local test entrant');
 const value={...e,name:e.id,seed:Number(e.seed)||1,joined_at:Date.now()};await this.eval('add',['entrants','waiting'],[JSON.stringify(value)]);return value;}
 async allocate(arena){const raw=await this.eval('allocate',['entrants','waiting','slots','matches'],[arena,crypto.randomUUID(),crypto.randomUUID(),Date.now(),JSON.stringify(this.format.teams),this.format.players_per_team]);return raw?JSON.parse(raw):null;}
 async active(arena){const id=await this.redis.hget(this.k('slots'),arena);return id?this.match(id):null;}
 async match(id){const raw=await this.redis.hget(this.k('matches'),id);return raw?JSON.parse(raw):null;}
 async setState(m,state,detail=''){return this.eval('state',['matches'],[m.id,m.token,state,Date.now(),detail]);}
 async result(id){const raw=await this.redis.hget(this.k('results'),id);return raw?JSON.parse(raw):null;}
 async saveResult(m,result){if(result.match_id!==m.id||result.arena_id!==m.arena_id)throw Error('Result identity mismatch');const added=await this.eval('result',['matches','results','scores'],[m.id,m.token,JSON.stringify(result)]);if(added)await this.event('result_saved',{match_id:m.id,arena_id:m.arena_id,status:result.status});return Boolean(added);}
 async release(m){const changed=await this.eval('release',['matches','results','slots','entrants','waiting'],[m.id,m.token,Date.now()]);if(changed)await this.event('slot_released',{match_id:m.id,arena_id:m.arena_id});return Boolean(changed);}
 withdraw(id){return this.eval('withdraw',['entrants'],[id]);}
 event(type,data={}){return this.redis.xadd(this.k('events'),'MAXLEN','~',10000,'*','data',JSON.stringify({type,at:Date.now(),...data}));}
 async snapshot(){const rows=await this.redis.pipeline().hgetall(this.k('entrants')).hgetall(this.k('matches')).hgetall(this.k('results')).hgetall(this.k('scores')).lrange(this.k('waiting'),0,-1).xrevrange(this.k('events'),'+','-','COUNT',40).exec();
 for(const [err]of rows)if(err)throw err;const [entrants,matches,results,scores,waiting,events]=rows.map(r=>r[1]);return {entrants:Object.values(entrants).map(JSON.parse),matches:Object.values(matches).map(JSON.parse).map(({token,...m})=>m),results:Object.values(results).map(JSON.parse),scores,waiting,events:events.map(([,fields])=>JSON.parse(fields[1]))};}
}
module.exports={Store};
