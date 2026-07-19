import test from "node:test";
import assert from "node:assert/strict";
import { createServer, type AddressInfo } from "node:net";
import { createInterface } from "node:readline";
import { HeroBotJsonlCommandTransport } from "../backends/herobotJsonlTransport.js";

test("herobot jsonl command transport sends run_command requests", async () => {
  const received: string[] = [];
  const server = createServer(socket => {
    const rl = createInterface({ input: socket });
    rl.on("line", line => {
      const message = JSON.parse(line) as { id: string; type: string; command: string };
      received.push(message.command);
      socket.write(JSON.stringify({ v: 1, id: message.id, type: "run_command_ack", ok: true }) + "\n");
    });
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", () => resolve()));
  const address = server.address();
  assert.equal(typeof address, "object");
  assert.notEqual(address, null);
  const port = (address as AddressInfo).port;
  try {
    const transport = new HeroBotJsonlCommandTransport({
      host: "127.0.0.1",
      port,
      timeoutMs: 1000,
    });

    await transport.sendCommand("player ROBO-A0 attack once");

    assert.deepEqual(received, ["player ROBO-A0 attack once"]);
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});

test("herobot jsonl command transport rejects non-local hosts", () => {
  assert.throws(
    () => new HeroBotJsonlCommandTransport({ host: "192.0.2.10", port: 25583, timeoutMs: 1000 }),
    /localhost-only/,
  );
});

test("herobot jsonl command transport rejects zero command results", async () => {
  const server = createServer(socket => {
    const rl = createInterface({ input: socket });
    rl.on("line", line => {
      const message = JSON.parse(line) as { id: string };
      socket.write(JSON.stringify({ v: 1, id: message.id, type: "run_command_ack", ok: true, command_result: 0 }) + "\n");
    });
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", () => resolve()));
  const address = server.address();
  assert.equal(typeof address, "object");
  assert.notEqual(address, null);
  const port = (address as AddressInfo).port;
  try {
    const transport = new HeroBotJsonlCommandTransport({
      host: "127.0.0.1",
      port,
      timeoutMs: 1000,
    });

    await assert.rejects(() => transport.sendCommand("playerspawn ROBO_A0 in survival"), /returned 0/);
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});
