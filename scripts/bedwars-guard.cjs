// Local rules-based practice opponent. Does not learn, bridge, buy, or attack beds.
const mineflayer = require('../bot-controller/node_modules/mineflayer');
const bot = mineflayer.createBot({ host: '127.0.0.1', port: 25567, username: 'BedGuard', auth: 'offline', version: '1.21' });
let joined = false;
let ticks = 0;
let lastAttack = 0;
let lastQueueAttempt = 0;
bot.on('game', () => {
  bot.physicsEnabled = bot.game.gameMode === 'survival';
  bot.clearControlStates();
});
bot.on('forcedMove', () => { if (bot.entity?.velocity) bot.entity.velocity.set(0, 0, 0); });
const queueTimer = setInterval(() => {
  if (!bot.entity || bot.game.gameMode !== 'survival' || bot.entity.position.y < 100) return;
  if (bot.inventory.items().some(item => item.name === 'compass')) return;
  if (Date.now() - lastQueueAttempt < 10000) return;
  lastQueueAttempt = Date.now();
  bot.chat('/bw join SkyDuel');
  joined = true;
}, 1000);
bot.on('physicsTick', () => {
  if (++ticks % 4 || !joined || !bot.entity) return;
  bot.clearControlStates();
  const me = bot.entity.position;
  if (me.y > 80 || me.y < 62 || Math.abs(me.x) < 28) return;
  const target = bot.nearestEntity(e => e.type === 'player' && e.username !== bot.username && e.position.distanceTo(me) < 7);
  if (!target) return;
  bot.lookAt(target.position.offset(0, 1.4, 0), true).catch(() => {});
  const delta = target.position.minus(me);
  const distance = delta.norm();
  if (distance > 2.6 && distance < 6) {
    const next = me.plus(delta.scaled(0.8 / Math.max(distance, 0.01))).offset(0, -0.5, 0);
    const support = bot.blockAt(next);
    if (support && support.boundingBox === 'block') bot.setControlState('forward', true);
  }
  // Let the server arbitrate reach, cooldowns, line of sight and damage.
  const eye = me.offset(0, 1.62, 0);
  const ray = target.position.offset(0, 1.4, 0).minus(eye);
  const rayLength = ray.norm();
  const blocked = rayLength > 0 && bot.world.raycast(eye, ray.scaled(1 / rayLength), rayLength);
  if (distance < 2.8 && ticks - lastAttack >= 13 && !blocked) {
    bot.attack(target);
    lastAttack = ticks;
  }
});
bot.on('kicked', reason => console.error('Kicked:', reason));
bot.on('error', error => { console.error(error.message); process.exitCode = 1; });
bot.on('end', reason => { clearInterval(queueTimer); console.log('Disconnected:', reason); process.exit(process.exitCode || 0); });
process.on('SIGINT', () => { bot.quit(); });
console.log('BedGuard: scripted base defender for local rule testing; not a learned BedWars agent.');
