// An expired coordinator can reacquire its namespace without taking another live owner's lease.
const SCRIPT = `
local current=redis.call('GET',KEYS[1])
if current and current~=ARGV[1] then return 0 end
redis.call('SET',KEYS[1],ARGV[1],'PX',ARGV[2])
return 1
`;
async function renewOrAcquire(redis,key,owner,ttlMs=15000){
  return Boolean(await redis.eval(SCRIPT,1,key,owner,ttlMs));
}
module.exports={renewOrAcquire};
