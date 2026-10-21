// Proposed AGX BedWars strategy contract v0.1; NOT yet supported by the live AGX API.
// Requires the future platform adapter documented in AGX_BEDWARS_DESIGN.zh-CN.md.
// This is a readable scripted baseline, not a trained model.
function act(o) {
  const order = value => ({v: 1, order: value});
  if (o.phase !== 'playing' || !o.me || o.me.eliminated) return order({type: 'wait'});
  const distance = p => Math.hypot(p.x - o.me.position.x, p.y - o.me.position.y, p.z - o.me.position.z);
  const enemies = (o.visibleEnemies || []).slice().sort((a, b) => distance(a.position) - distance(b.position));
  if (o.me.health <= 6) return order({type: 'move', target: o.map.ownSpawn});
  if (enemies.length && distance(enemies[0].position) < 5) return order({type: 'attack', targetId: enemies[0].id});
  const inv = o.me.inventory;
  if ((inv.wool || 0) < 32) {
    if ((inv.iron || 0) >= 8) {
      if (o.me.atOwnShop) return order({type: 'buy', item: 'wool', quantity: 32});
      return order({type: 'move', target: o.map.ownShop});
    }
    return order({type: 'move', target: o.map.ownIronGenerator});
  }
  // visibleMineTargets comes from the legal visible block set, never hidden bed defenses.
  const bed = (o.visibleMineTargets || []).find(block => block.kind === 'enemy_bed' && distance(block.position) <= 3);
  if (bed) return order({type: 'mine', block: bed.position});
  return order({type: 'bridge', target: o.map.enemyApproach});
}
