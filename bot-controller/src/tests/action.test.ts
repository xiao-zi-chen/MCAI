import test from "node:test";
import assert from "node:assert/strict";
import { decodeAction, neutralAction, randomAction, validateAction } from "../action.js";

test("decodeAction decodes compact action vector", () => {
  const action = decodeAction([1, 0, 0, 1, 1, 1, 0, 1, 0, 8, 6, 4, 3]);
  assert.equal(action.forward, true);
  assert.equal(action.right, true);
  assert.equal(action.hotbarSlot, 8);
  assert.equal(action.lookPrimitive, "enemy_feet");
  assert.ok(action.yawDeltaRadians > 0);
  assert.ok(action.pitchDeltaRadians > 0);
});

test("validateAction rejects out of bounds values", () => {
  assert.throws(() => validateAction([2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 3, 2, 0]));
});

test("neutral and random actions match schema length", () => {
  assert.equal(neutralAction().length, 13);
  assert.equal(randomAction(() => 0.1).length, 13);
});

