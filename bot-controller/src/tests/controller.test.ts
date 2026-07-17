import test from "node:test";
import assert from "node:assert/strict";
import { BotController } from "../controller.js";
import { defaultConfig } from "../config.js";
import type { DecodedAction } from "../action.js";
import type { BotBackend, BotStatus } from "../backend.js";

class FakeAdapter implements BotBackend {
  public applied: Array<{ agentId: string; action: DecodedAction; repeatTicks: number; targetUsername?: string }> = [];
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
