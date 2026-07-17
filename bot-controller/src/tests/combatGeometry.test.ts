import test from "node:test";
import assert from "node:assert/strict";
import { canAttackTarget, directionTo, lookDirection, rayIntersectsAabb } from "../combatGeometry.js";

test("lookDirection points down the current yaw and pitch ray", () => {
  const direction = lookDirection(0, 0);

  assert.equal(Math.abs(Math.round(direction.x * 1000) / 1000), 0);
  assert.equal(Math.abs(Math.round(direction.y * 1000) / 1000), 0);
  assert.equal(Math.round(direction.z * 1000) / 1000, -1);
  assert.ok(lookDirection(0, Math.PI / 6).y > 0);
});

test("directionTo aims at the intended point without waiting for entity yaw updates", () => {
  const direction = directionTo({ x: 0, y: 1.62, z: 0 }, { x: 0, y: 1.62, z: -3 });

  assert.equal(Math.abs(Math.round(direction.x * 1000) / 1000), 0);
  assert.equal(Math.abs(Math.round(direction.y * 1000) / 1000), 0);
  assert.equal(Math.round(direction.z * 1000) / 1000, -1);
});

test("rayIntersectsAabb returns the first hit distance inside reach", () => {
  const distance = rayIntersectsAabb(
    { x: 0, y: 1.62, z: 0 },
    { x: 0, y: 0, z: -1 },
    { minX: -0.3, minY: 0, minZ: -3.3, maxX: 0.3, maxY: 1.8, maxZ: -2.7 },
    3.5
  );

  assert.equal(distance, 2.7);
});

test("canAttackTarget rejects misses and nearer blocking blocks", () => {
  const eye = { x: 0, y: 1.62, z: 0 };
  const forward = { x: 0, y: 0, z: -1 };
  const targetBox = { minX: -0.3, minY: 0, minZ: -3.3, maxX: 0.3, maxY: 1.8, maxZ: -2.7 };

  assert.equal(canAttackTarget({ eye, direction: forward, targetBox, reach: 3.5 }), true);
  assert.equal(canAttackTarget({ eye, direction: { x: 1, y: 0, z: 0 }, targetBox, reach: 3.5 }), false);
  assert.equal(canAttackTarget({ eye, direction: forward, targetBox, reach: 3.5, blockingDistance: 2.0 }), false);
});
