import test from "node:test";
import assert from "node:assert/strict";
import { BotController } from "../controller.js";
import { defaultConfig } from "../config.js";
import type { DecodedAction } from "../action.js";
import type { BotBackend, BotStatus } from "../backend.js";
import type { NormalizedSwordPvpActionV1, NormalizedVirtualHidFrameV1 } from "../actionAbi.js";

type RestrictedActionAck = {
  action_requested: NormalizedSwordPvpActionV1;
  action_executed: NormalizedVirtualHidFrameV1;
  action_execution_status: string;
  action_execution_status_reasons: string[];
};

class FakeAdapter implements BotBackend {
  public applied: Array<{ agentId: string; action: DecodedAction; repeatTicks: number; targetUsername?: string }> = [];
  public restricted: Array<{ agentId: string; action: NormalizedSwordPvpActionV1 }> = [];
  public cleared: Array<string | undefined> = [];
  public despawned: string[] = [];
  public disconnected = false;
  private bots = [
    { agent_id: "ROBO-A0", username: "ROBO-A0", arena_id: "arena_0", role: "learner", connected: true },
    { agent_id: "SCRIPT-A0", username: "SCRIPT-A0", arena_id: "arena_0", role: "scripted", connected: true }
  ];

  async spawn(): Promise<string[]> {
    return this.bots.map(bot => bot.agent_id);
  }

  status(): BotStatus[] {
    return this.bots;
  }

  applyAction(agentId: string, action: DecodedAction, repeatTicks: number, targetUsername?: string): void {
    this.applied.push({ agentId, action, repeatTicks, targetUsername });
  }

  applyRestrictedAction(agentId: string, action: NormalizedSwordPvpActionV1): NormalizedVirtualHidFrameV1 {
    this.restricted.push({ agentId, action });
    return {
      abi_version: "VirtualHIDFrameV1",
      sequence_id: action.sequence_id,
      source_sequence_id: action.sequence_id,
      execute_tick: action.observation_tick + 1,
      execute_time_ms: action.policy_time_ms + 1,
      control_step_ticks: action.control_step_ticks,
      keys: {
        forward: action.move_forward === 1,
        back: action.move_forward === -1,
        left: action.move_strafe === -1,
        right: action.move_strafe === 1,
        jump: action.jump_hold,
        sprint: action.sprint_hold,
        sneak: action.sneak_hold,
      },
      mouse_buttons: { attack: action.attack_pulse, use: action.use_pulse },
      mouse_dx: action.mouse_dx,
      mouse_dy: action.mouse_dy,
      wheel_dy: 0,
      recenter: {
        requested: action.recenter_request,
        busy: false,
        phase: "idle",
        target_x: action.recenter_target_x,
        target_y: action.recenter_target_y,
      },
      status: "executed",
      status_reasons: [],
    };
  }

  applyPvpOpponent(agentId: string, repeatTicks: number): void {
    this.applied.push({ agentId, action: {} as DecodedAction, repeatTicks });
  }

  clearControls(agentId?: string): void {
    this.cleared.push(agentId);
  }

  disconnect(): void {
    this.disconnected = true;
  }

  disconnectAgents(agentIds: string[]): string[] {
    this.despawned.push(...agentIds);
    return agentIds;
  }
}

test("joint actions rotate the first sender between seats", async () => {
  const adapter = new FakeAdapter();
  const controller = new BotController(defaultConfig(), adapter);
  const action = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 3, 2, 0];
  for (let round = 0; round < 2; round++) {
    await controller.handle({v: 1, id: `joint-${round}`, type: "act", arena_id: "arena_0", actions: {"ROBO-A0": action, "SCRIPT-A0": action}});
  }
  assert.deepEqual(adapter.applied.map(item => item.agentId), ["ROBO-A0", "SCRIPT-A0", "SCRIPT-A0", "ROBO-A0"]);
});

test("invalid joint actions do not partially execute", async () => {
  const adapter = new FakeAdapter();
  const controller = new BotController(defaultConfig(), adapter);
  const response = await controller.handle({v: 1, id: "invalid-joint", type: "act", actions: {"ROBO-A0": [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 3, 2, 0], "SCRIPT-A0": [99]}});
  assert.equal(response.type, "error");
  assert.equal(adapter.applied.length, 0);
});

test("controller applies actions through adapter", async () => {
  const adapter = new FakeAdapter();
  const controller = new BotController(defaultConfig(), adapter as never);
  const response = await controller.handle({
    v: 1,
    id: "b-1",
    type: "apply_action",
    agent_id: "ROBO-A0",
    repeat_ticks: 4,
    action: [1, 0, 0, 0, 0, 1, 0, 1, 0, 0, 3, 2, 0]
  });
  assert.equal(response.type, "apply_action_ack");
  assert.equal(adapter.applied.length, 1);
  assert.equal(adapter.applied[0].agentId, "ROBO-A0");
  assert.equal(adapter.applied[0].repeatTicks, 4);
});

test("controller forwards explicit human target username", async () => {
  const adapter = new FakeAdapter();
  const controller = new BotController(defaultConfig(), adapter as never);
  const response = await controller.handle({
    v: 1,
    id: "b-human",
    type: "apply_action",
    agent_id: "ROBO",
    target_username: "KyaKayKya",
    action: [0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 3, 2, 2]
  });
  assert.equal(response.type, "apply_action_ack");
  assert.equal(adapter.applied[0].targetUsername, "KyaKayKya");
});

test("controller applies restricted action and returns execution record", async () => {
  const adapter = new FakeAdapter();
  const controller = new BotController(defaultConfig(), adapter);
  const response = await controller.handle({
    v: 1,
    id: "b-restricted",
    type: "apply_restricted_action",
    agent_id: "ROBO-A0",
    action: {
      abi_version: "SwordPvPActionV1",
      sequence_id: 4,
      observation_tick: 20,
      policy_time_ms: 100,
      control_step_ticks: 2,
      move_forward: 1,
      move_strafe: -1,
      attack_pulse: true,
      mouse_dx: 3,
      mouse_dy: -2,
    },
  });

  assert.equal(response.type, "apply_restricted_action_ack");
  assert.equal(response.accepted, true);
  assert.equal(adapter.restricted.length, 1);
  assert.equal(adapter.restricted[0].agentId, "ROBO-A0");
  const ack = response as typeof response & RestrictedActionAck;
  assert.equal(ack.action_requested.sequence_id, 4);
  assert.equal(ack.action_executed.abi_version, "VirtualHIDFrameV1");
  assert.equal(ack.action_execution_status, "executed");
  assert.deepEqual(ack.action_execution_status_reasons, []);
});

test("controller rejects restricted top-level targeting fields", async () => {
  const adapter = new FakeAdapter();
  const controller = new BotController(defaultConfig(), adapter);
  const response = await controller.handle({
    v: 1,
    id: "b-restricted-forbidden",
    type: "apply_restricted_action",
    agent_id: "ROBO-A0",
    target_username: "SCRIPT-A0",
    action: { abi_version: "SwordPvPActionV1", sequence_id: 5 },
  });

  assert.equal(response.type, "error");
  assert.match(String(response.error), /forbidden restricted action fields/);
  assert.equal(adapter.restricted.length, 0);
});

test("controller handles status and clear controls", async () => {
  const adapter = new FakeAdapter();
  const controller = new BotController(defaultConfig(), adapter as never);
  const status = await controller.handle({ v: 1, id: "b-2", type: "status" });
  assert.equal(status.type, "status");
  const cleared = await controller.handle({ v: 1, id: "b-3", type: "clear_controls", agent_id: "ROBO-A0" });
  assert.equal(cleared.type, "clear_controls_ack");
  assert.deepEqual(adapter.cleared, ["ROBO-A0"]);
});

test("controller despawns selected agents", async () => {
  const adapter = new FakeAdapter();
  const controller = new BotController(defaultConfig(), adapter as never);
  const response = await controller.handle({ v: 1, id: "b-despawn", type: "despawn", agent_ids: ["ROBO_A0", "SCRIPT_S0"] });
  assert.equal(response.type, "despawn_ack");
  assert.deepEqual(response.bots, ["ROBO_A0", "SCRIPT_S0"]);
  assert.deepEqual(adapter.despawned, ["ROBO_A0", "SCRIPT_S0"]);
});

test("controller applies random scripted opponent per arena", async () => {
  const adapter = new FakeAdapter();
  const controller = new BotController({ ...defaultConfig(), scriptedOpponent: "random" }, adapter as never);
  const response = await controller.handle({
    v: 1,
    id: "b-4",
    type: "act",
    actions: {
      "ROBO-A0": [1, 0, 0, 0, 0, 1, 0, 1, 0, 0, 3, 2, 0]
    }
  });
  assert.equal(response.type, "act_ack");
  assert.equal(adapter.applied.length, 2);
  assert.equal(adapter.applied[1].agentId, "SCRIPT-A0");
});

test("controller applies controller pvp scripted opponent per arena", async () => {
  const adapter = new FakeAdapter();
  const controller = new BotController({ ...defaultConfig(), scriptedOpponent: "controller_pvp" }, adapter);
  const response = await controller.handle({
    v: 1,
    id: "b-controller-pvp",
    type: "act",
    repeat_ticks: 3,
    actions: {
      "ROBO-A0": [1, 0, 0, 0, 0, 1, 0, 1, 0, 0, 3, 2, 0]
    }
  });
  assert.equal(response.type, "act_ack");
  assert.equal(adapter.applied.length, 2);
  assert.equal(adapter.applied[1].agentId, "SCRIPT-A0");
  assert.equal(adapter.applied[1].repeatTicks, 3);
});
