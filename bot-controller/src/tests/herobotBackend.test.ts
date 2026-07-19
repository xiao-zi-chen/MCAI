import test from "node:test";
import assert from "node:assert/strict";
import { decodeAction } from "../action.js";
import { decodeSwordPvpActionV1 } from "../actionAbi.js";
import { HeroBotCommandBackend, type HeroBotCommandTransport } from "../backends/herobotCommandBackend.js";

class FakeCommandTransport implements HeroBotCommandTransport {
  public commands: string[] = [];
  public failNext = false;

  async sendCommand(command: string): Promise<void> {
    this.commands.push(command);
    if (this.failNext) {
      this.failNext = false;
      throw new Error(`failed ${command}`);
    }
  }
}

test("herobot command backend spawns and tracks bot status", async () => {
  const transport = new FakeCommandTransport();
  const backend = new HeroBotCommandBackend(transport);

  const bots = await backend.spawn([
    { agent_id: "ROBO-A0", username: "ROBO-A0", arena_id: "arena_0", role: "learner" },
    { agent_id: "SCRIPT-A0", username: "SCRIPT-A0", arena_id: "arena_0", role: "scripted" },
  ]);

  assert.deepEqual(bots, ["ROBO-A0", "SCRIPT-A0"]);
  assert.deepEqual(transport.commands, [
    "playerspawn ROBO-A0 at 0 90 0 facing 0 0 in survival",
    "playerspawn SCRIPT-A0 at 0 90 0 facing 0 0 in survival",
  ]);
  assert.deepEqual(backend.status().map(bot => bot.agent_id), ["ROBO-A0", "SCRIPT-A0"]);
});

test("herobot command backend includes optional spawn pose", async () => {
  const transport = new FakeCommandTransport();
  const backend = new HeroBotCommandBackend(transport);

  await backend.spawn([
    {
      agent_id: "ROBO-A0",
      username: "ROBO-A0",
      arena_id: "arena_0",
      role: "learner",
      x: -1,
      y: 64,
      z: 0,
      yaw: 90,
      pitch: 0,
    },
  ]);

  assert.deepEqual(transport.commands, [
    "playerspawn ROBO-A0 at -1 64 0 facing 90 0 in survival",
  ]);
});

test("herobot command backend maps a combat action to player commands", async () => {
  const transport = new FakeCommandTransport();
  const backend = new HeroBotCommandBackend(transport);
  await backend.spawn([
    { agent_id: "ROBO-A0", username: "ROBO-A0", arena_id: "arena_0", role: "learner" },
    { agent_id: "SCRIPT-A0", username: "SCRIPT-A0", arena_id: "arena_0", role: "scripted" },
  ]);
  transport.commands = [];

  await backend.applyAction(
    "ROBO-A0",
    decodeAction([1, 0, 0, 0, 0, 1, 0, 1, 0, 2, 3, 2, 2]),
    3,
    "SCRIPT-A0",
  );

  assert.deepEqual(transport.commands, [
    "player ROBO-A0 stop",
    "player ROBO-A0 hotbar 3",
    "player ROBO-A0 sprint",
    "player ROBO-A0 move forward",
    "player ROBO-A0 look upon SCRIPT-A0 closest",
    "player ROBO-A0 attack continuous 3",
  ]);
});

test("herobot restricted action uses relative look without target lookup", async () => {
  const transport = new FakeCommandTransport();
  const backend = new HeroBotCommandBackend(transport);
  await backend.spawn([
    { agent_id: "ROBO-A0", username: "ROBO-A0", arena_id: "arena_0", role: "learner" },
    { agent_id: "SCRIPT-A0", username: "SCRIPT-A0", arena_id: "arena_0", role: "scripted" },
  ]);
  transport.commands = [];

  const frame = await backend.applyRestrictedAction(
    "ROBO-A0",
    decodeSwordPvpActionV1({
      abi_version: "SwordPvPActionV1",
      sequence_id: 9,
      control_step_ticks: 2,
      move_forward: 1,
      move_strafe: 1,
      sprint_hold: true,
      attack_pulse: true,
      use_pulse: true,
      mouse_dx: 6,
      mouse_dy: -3,
    }),
  );

  assert.deepEqual(transport.commands, [
    "player ROBO-A0 stop",
    "player ROBO-A0 sprint",
    "player ROBO-A0 move forward",
    "player ROBO-A0 move right",
    "player ROBO-A0 look relative ~6 ~-3",
    "player ROBO-A0 attack once",
    "player ROBO-A0 use continuous 2",
  ]);
  assert.equal(transport.commands.some(command => command.includes("look upon")), false);
  assert.equal(frame.status, "executed");
  assert.equal(frame.mouse_dx, 6);
  assert.equal(frame.mouse_dy, -3);
});

test("herobot command backend disconnects selected bots", async () => {
  const transport = new FakeCommandTransport();
  const backend = new HeroBotCommandBackend(transport);
  await backend.spawn([{ agent_id: "ROBO-A0", username: "ROBO-A0" }]);
  transport.commands = [];

  const disconnected = await backend.disconnectAgents(["ROBO-A0"]);

  assert.deepEqual(disconnected, ["ROBO-A0"]);
  assert.deepEqual(transport.commands, ["player ROBO-A0 disconnect"]);
  assert.equal(backend.status().length, 0);
});

test("herobot command backend recovers command queue after a failed command", async () => {
  const transport = new FakeCommandTransport();
  const backend = new HeroBotCommandBackend(transport);
  await backend.spawn([{ agent_id: "ROBO-A0", username: "ROBO-A0" }]);
  transport.commands = [];
  transport.failNext = true;

  await assert.rejects(() => backend.clearControls("ROBO-A0"), /failed/);
  await backend.clearControls("ROBO-A0");

  assert.deepEqual(transport.commands, [
    "player ROBO-A0 stop",
    "player ROBO-A0 stop",
  ]);
});
