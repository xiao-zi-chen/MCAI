import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { defaultConfig, loadConfig } from "../config.js";

test("default config uses mineflayer backend and no scripted opponent", () => {
  const config = defaultConfig();
  assert.equal(config.botBackend, "mineflayer");
  assert.equal(config.scriptedOpponent, "none");
});

test("loadConfig accepts controller pvp and normalizes mineflayer pvp alias", () => {
  const dir = mkdtempSync(join(tmpdir(), "pvprobo-bot-config-"));
  try {
    const controllerPath = join(dir, "controller.json");
    writeFileSync(controllerPath, JSON.stringify({
      bot_backend: "mineflayer",
      scripted_opponent: "controller_pvp"
    }));
    assert.equal(loadConfig(controllerPath).scriptedOpponent, "controller_pvp");

    const legacyPath = join(dir, "legacy.json");
    writeFileSync(legacyPath, JSON.stringify({
      scripted_opponent: "mineflayer_pvp"
    }));
    assert.equal(loadConfig(legacyPath).scriptedOpponent, "controller_pvp");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

