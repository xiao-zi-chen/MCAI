import test from "node:test";
import assert from "node:assert/strict";
import type { DecodedAction } from "../action.js";
import { decodeSwordPvpActionV1 } from "../actionAbi.js";
import { defaultConfig, defaultRestrictedMouseProfile } from "../config.js";
import { applyRestrictedFrameToMineflayerBot, MineflayerBackend } from "../backends/mineflayerBackend.js";

class FakeVec3 {
  constructor(public x: number, public y: number, public z: number) {}

  offset(x: number, y: number, z: number): FakeVec3 {
    return new FakeVec3(this.x + x, this.y + y, this.z + z);
  }

  minus(other: FakeVec3): FakeVec3 {
    return new FakeVec3(this.x - other.x, this.y - other.y, this.z - other.z);
  }
}

type FakeEntity = {
  username: string;
  position: FakeVec3;
  height?: number;
  width?: number;
};

class FakeMineflayerBot {
  public entity = { yaw: 1, pitch: 0.25, position: new FakeVec3(0, 0, 0), height: 1.62 };
  public controls: Array<{ name: string; state: boolean }> = [];
  public looks: Array<{ yaw: number; pitch: number; force: boolean }> = [];
  public lookAtCalls = 0;
  public attackCalls: unknown[] = [];
  public activated = 0;
  public swings: string[] = [];
  public entities: FakeEntity[] = [];
  public world = { raycast: () => null };
  public quickBarSlot = 0;

  setControlState(name: string, state: boolean): void {
    this.controls.push({ name, state });
  }

  look(yaw: number, pitch: number, force: boolean): void {
    this.looks.push({ yaw, pitch, force });
  }

  lookAt(): void {
    this.lookAtCalls += 1;
  }

  nearestEntity(predicate: (entity: FakeEntity) => boolean): FakeEntity | undefined {
    return this.entities.find(predicate);
  }

  attack(target: unknown): void {
    this.attackCalls.push(target);
  }

  activateItem(): void {
    this.activated += 1;
  }

  deactivateItem(): void {}

  swingArm(hand: string): void {
    this.swings.push(hand);
  }
}

test("mineflayer restricted action uses relative look and no targeted attack", () => {
  const bot = new FakeMineflayerBot();
  const frame = applyRestrictedFrameToMineflayerBot(
    bot as never,
    decodeSwordPvpActionV1({
      abi_version: "SwordPvPActionV1",
      sequence_id: 10,
      control_step_ticks: 2,
      move_forward: -1,
      move_strafe: -1,
      jump_hold: true,
      sneak_hold: true,
      attack_pulse: true,
      use_pulse: true,
      mouse_dx: 5,
      mouse_dy: -2,
    }),
    defaultRestrictedMouseProfile(),
  );

  assert.deepEqual(bot.controls, [
    { name: "forward", state: false },
    { name: "back", state: true },
    { name: "left", state: true },
    { name: "right", state: false },
    { name: "jump", state: true },
    { name: "sprint", state: false },
    { name: "sneak", state: true },
  ]);
  assert.equal(bot.looks.length, 1);
  assert.equal(bot.looks[0].yaw, 1 + 5 * 0.0025);
  assert.equal(bot.looks[0].pitch, 0.25 + -2 * 0.0025);
  assert.equal(bot.looks[0].force, true);
  assert.equal(bot.lookAtCalls, 0);
  assert.deepEqual(bot.attackCalls, []);
  assert.deepEqual(bot.swings, ["right"]);
  assert.equal(bot.activated, 1);
  assert.equal(frame.status, "executed");
});

test("mineflayer restricted action clips mouse counts through profile", () => {
  const bot = new FakeMineflayerBot();
  const frame = applyRestrictedFrameToMineflayerBot(
    bot as never,
    decodeSwordPvpActionV1({
      abi_version: "SwordPvPActionV1",
      sequence_id: 11,
      mouse_dx: 20,
      mouse_dy: -15,
    }),
    {
      id: "tiny_workspace",
      radiansPerCount: 0.01,
      maxDxPerStep: 7,
      maxDyPerStep: 5,
    },
  );

  assert.equal(bot.looks[0].yaw, 1 + 7 * 0.01);
  assert.equal(bot.looks[0].pitch, 0.25 + -5 * 0.01);
  assert.equal(frame.mouse_dx, 7);
  assert.equal(frame.mouse_dy, -5);
  assert.equal(frame.status, "clipped");
  assert.deepEqual(frame.status_reasons, ["mouse_dx_clipped", "mouse_dy_clipped"]);
});

test("mineflayer does not send attack packets beyond vanilla reach", () => {
  const backend = new MineflayerBackend(defaultConfig());
  const bot = new FakeMineflayerBot();
  const target = { username: "KyaKayKya", position: new FakeVec3(0, 0, -3.35), height: 1.8, width: 0.6 };
  bot.entities = [target];
  const runtimes = (backend as unknown as { bots: Map<string, unknown> }).bots;
  runtimes.set("ROBO", { agentId: "ROBO", username: "ROBO", arenaId: "arena_0", role: "learner", connected: true, bot });

  backend.applyAction("ROBO", attackBodyAction(), 1, "KyaKayKya");

  assert.deepEqual(bot.attackCalls, []);
});

test("mineflayer sends attack packets inside vanilla entity interaction range", () => {
  const backend = new MineflayerBackend(defaultConfig());
  const bot = new FakeMineflayerBot();
  const target = { username: "KyaKayKya", position: new FakeVec3(0, 0, -3.2), height: 1.8, width: 0.6 };
  bot.entities = [target];
  const runtimes = (backend as unknown as { bots: Map<string, unknown> }).bots;
  runtimes.set("ROBO", { agentId: "ROBO", username: "ROBO", arenaId: "arena_0", role: "learner", connected: true, bot });

  backend.applyAction("ROBO", attackBodyAction(), 1, "KyaKayKya");

  assert.deepEqual(bot.attackCalls, [target]);
});

function attackForwardAction(): DecodedAction {
  return {
    forward: false,
    back: false,
    left: false,
    right: false,
    jump: false,
    sprint: false,
    sneak: false,
    attack: true,
    use: false,
    hotbarSlot: 0,
    yawDeltaRadians: 0,
    pitchDeltaRadians: 0,
    lookPrimitive: "none",
  };
}

function attackBodyAction(): DecodedAction {
  return {
    ...attackForwardAction(),
    lookPrimitive: "enemy_body",
  };
}
