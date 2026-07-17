import test from "node:test";
import assert from "node:assert/strict";
import { decodeAction } from "../action.js";
import { HeroBotCommandBackend, type HeroBotCommandTransport } from "../backends/herobotCommandBackend.js";

class FakeCommandTransport implements HeroBotCommandTransport {
  public commands: string[] = [];

  async sendCommand(command: string): Promise<void> {
    this.commands.push(command);
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
    "playerspawn ROBO-A0 in survival",
    "playerspawn SCRIPT-A0 in survival",
  ]);
  assert.deepEqual(backend.status().map(bot => bot.agent_id), ["ROBO-A0", "SCRIPT-A0"]);
});

test("herobot command backend maps a combat action to player commands", async () => {
  const transport = new FakeCommandTransport();
  const backend = new HeroBotCommandBackend(transport);
  await backend.spawn([
    { agent_id: "ROBO-A0", username: "ROBO-A0", arena_id: "arena_0", role: "learner" },
    { agent_id: "SCRIPT-A0", username: "SCRIPT-A0", arena_id: "arena_0", role: "scripted" },
  ]);
  transport.commands = [];

  backend.applyAction(
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

test("herobot command backend disconnects selected bots", async () => {
  const transport = new FakeCommandTransport();
  const backend = new HeroBotCommandBackend(transport);
  await backend.spawn([{ agent_id: "ROBO-A0", username: "ROBO-A0" }]);
  transport.commands = [];

  const disconnected = backend.disconnectAgents(["ROBO-A0"]);

  assert.deepEqual(disconnected, ["ROBO-A0"]);
  assert.deepEqual(transport.commands, ["player ROBO-A0 disconnect"]);
  assert.equal(backend.status().length, 0);
});

