import test from "node:test";
import assert from "node:assert/strict";
import {
  decodeSwordPvpActionV1,
  decodeVirtualHidFrameV1,
  encodeSwordPvpActionV1,
  encodeVirtualHidFrameV1,
  swordActionToVirtualHidFrameV1,
  type SwordPvpActionV1,
  type VirtualHidFrameV1,
} from "../actionAbi.js";

test("SwordPvPActionV1 round trips without legacy targeting fields", () => {
  const action: SwordPvpActionV1 = {
    abi_version: "SwordPvPActionV1",
    sequence_id: 7,
    observation_tick: 42,
    observation_time_ms: 1000,
    policy_time_ms: 1012,
    control_step_ticks: 1,
    move_forward: 1,
    move_strafe: -1,
    jump_hold: true,
    sprint_hold: true,
    sneak_hold: false,
    attack_pulse: true,
    use_pulse: false,
    mouse_dx: -7,
    mouse_dy: 2,
    recenter_request: true,
    recenter_target_x: 0.25,
    recenter_target_y: -0.5,
  };

  const payload = encodeSwordPvpActionV1(action);

  assert.equal(payload.abi_version, "SwordPvPActionV1");
  assert.equal("target_id" in payload, false);
  assert.equal("look_primitive" in payload, false);
  assert.deepEqual(decodeSwordPvpActionV1(payload), action);
});

test("SwordPvPActionV1 rejects legacy targeting fields", () => {
  const payload = {
    ...encodeSwordPvpActionV1({ abi_version: "SwordPvPActionV1", sequence_id: 1 }),
    target_username: "SCRIPT-A0",
  };

  assert.throws(() => decodeSwordPvpActionV1(payload), /forbidden/);
});

test("VirtualHIDFrameV1 round trips execution status", () => {
  const frame: VirtualHidFrameV1 = {
    abi_version: "VirtualHIDFrameV1",
    sequence_id: 8,
    source_sequence_id: 7,
    execute_tick: 43,
    execute_time_ms: 1050,
    control_step_ticks: 1,
    keys: {
      forward: true,
      back: false,
      left: true,
      right: false,
      jump: false,
      sprint: true,
      sneak: false,
    },
    mouse_buttons: { attack: true, use: false },
    mouse_dx: -5,
    mouse_dy: 1,
    wheel_dy: 0,
    recenter: {
      requested: true,
      busy: true,
      phase: "lift",
      target_x: 0.25,
      target_y: -0.5,
    },
    status: "clipped",
    status_reasons: ["mouse_dx_limit"],
  };

  const payload = encodeVirtualHidFrameV1(frame);

  assert.equal(payload.abi_version, "VirtualHIDFrameV1");
  assert.equal(payload.status, "clipped");
  assert.deepEqual(decodeVirtualHidFrameV1(payload), frame);
});

test("SwordPvPActionV1 maps to a VirtualHIDFrameV1 execution record", () => {
  const action = decodeSwordPvpActionV1({
    abi_version: "SwordPvPActionV1",
    sequence_id: 12,
    observation_tick: 120,
    control_step_ticks: 2,
    move_forward: 1,
    move_strafe: -1,
    jump_hold: true,
    sprint_hold: true,
    attack_pulse: true,
    use_pulse: true,
    mouse_dx: 9,
    mouse_dy: -4,
    recenter_request: true,
    recenter_target_x: 0.5,
    recenter_target_y: -0.25,
  });

  const frame = swordActionToVirtualHidFrameV1(action, 121, 5000);

  assert.equal(frame.abi_version, "VirtualHIDFrameV1");
  assert.equal(frame.sequence_id, 12);
  assert.equal(frame.source_sequence_id, 12);
  assert.equal(frame.execute_tick, 121);
  assert.equal(frame.execute_time_ms, 5000);
  assert.equal(frame.control_step_ticks, 2);
  assert.deepEqual(frame.keys, {
    forward: true,
    back: false,
    left: true,
    right: false,
    jump: true,
    sprint: true,
    sneak: false,
  });
  assert.deepEqual(frame.mouse_buttons, { attack: true, use: true });
  assert.equal(frame.mouse_dx, 9);
  assert.equal(frame.mouse_dy, -4);
  assert.deepEqual(frame.recenter, {
    requested: true,
    busy: false,
    phase: "idle",
    target_x: 0.5,
    target_y: -0.25,
  });
  assert.equal(frame.status, "executed");
  assert.deepEqual(frame.status_reasons, []);
});
