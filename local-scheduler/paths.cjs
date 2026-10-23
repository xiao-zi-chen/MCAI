const path = require('node:path');
function schedulerRoot(root, config) { return path.resolve(root, config.scheduler_root || 'runs/scheduler'); }
function matchDirectory(root, config, id) {
 if (!/^[a-zA-Z0-9_-]{1,64}$/.test(id)) throw Error('Invalid match ID');
 return path.join(schedulerRoot(root, config), 'matches', id);
}
module.exports = {schedulerRoot, matchDirectory};
