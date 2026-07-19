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
  assert.deepEqual(config.heroBotCommand, {
    host: "127.0.0.1",
    port: 25583,
    timeoutMs: 2000,
  });
  assert.deepEqual(config.restrictedMouseProfile, {
    id: "mineflayer_default_v1",
    radiansPerCount: 0.0025,
    maxDxPerStep: 64,
    maxDyPerStep: 64,
  });
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

test("loadConfig accepts herobot command bridge settings", () => {
  const dir = mkdtempSync(join(tmpdir(), "pvprobo-bot-config-"));
  try {
    const configPath = join(dir, "herobot.json");
    writeFileSync(configPath, JSON.stringify({
      bot_backend: "herobot",
      herobot_command_host: "localhost",
      herobot_command_port: 26083,
      herobot_command_timeout_ms: 3500
    }));

    const config = loadConfig(configPath);
    assert.equal(config.botBackend, "herobot");
    assert.deepEqual(config.heroBotCommand, {
      host: "localhost",
      port: 26083,
      timeoutMs: 3500,
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("loadConfig accepts a custom restricted mouse profile", () => {
  const dir = mkdtempSync(join(tmpdir(), "pvprobo-bot-config-"));
  try {
    const configPath = join(dir, "controller.json");
    writeFileSync(configPath, JSON.stringify({
      restricted_mouse_profile: {
        id: "slow_mouse",
        radians_per_count: 0.001,
        max_dx_per_step: 12,
        max_dy_per_step: 8
      }
    }));

    assert.deepEqual(loadConfig(configPath).restrictedMouseProfile, {
      id: "slow_mouse",
      radiansPerCount: 0.001,
      maxDxPerStep: 12,
      maxDyPerStep: 8,
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
