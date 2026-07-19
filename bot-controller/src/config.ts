import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { BotBackendKind, ScriptedOpponent } from "./backend.js";

export type BotConfig = {
  botBackend: BotBackendKind;
  heroBotCommand: HeroBotCommandConfig;
  host: string;
  botControllerPort: number;
  minecraftHost: string;
  minecraftPort: number;
  minecraftVersion: string;
  botNames: string[];
  actionRepeatTicks: number;
  watchdogTimeoutMs: number;
  spawnLoginThrottleMs: number;
  scriptedOpponent: ScriptedOpponent;
  spectatorUsernames: string[];
  restrictedMouseProfile: RestrictedMouseProfile;
};

export type HeroBotCommandConfig = {
  host: string;
  port: number;
  timeoutMs: number;
};

export type RestrictedMouseProfile = {
  id: string;
  radiansPerCount: number;
  maxDxPerStep: number;
  maxDyPerStep: number;
};

export function defaultConfig(): BotConfig {
  return {
    botBackend: "mineflayer",
    heroBotCommand: defaultHeroBotCommandConfig(),
    host: "127.0.0.1",
    botControllerPort: 25581,
    minecraftHost: "127.0.0.1",
    minecraftPort: 25565,
    minecraftVersion: "auto",
    botNames: ["ROBO-A0", "SCRIPT-A0"],
    actionRepeatTicks: 2,
    watchdogTimeoutMs: 2000,
    spawnLoginThrottleMs: 3100,
    scriptedOpponent: "none",
    spectatorUsernames: [],
    restrictedMouseProfile: defaultRestrictedMouseProfile()
  };
}

export function defaultHeroBotCommandConfig(): HeroBotCommandConfig {
  return {
    host: "127.0.0.1",
    port: 25583,
    timeoutMs: 2000,
  };
}

export function defaultRestrictedMouseProfile(): RestrictedMouseProfile {
  return {
    id: "mineflayer_default_v1",
    radiansPerCount: 0.0025,
    maxDxPerStep: 64,
    maxDyPerStep: 64,
  };
}

export function loadConfig(path?: string): BotConfig {
  const base = defaultConfig();
  if (!path) {
    return base;
  }
  const raw = JSON.parse(readFileSync(resolve(path), "utf8")) as Record<string, unknown>;
  return {
    ...base,
    botBackend: botBackendValue(raw.bot_backend, base.botBackend),
    heroBotCommand: {
      host: stringValue(raw.herobot_command_host, base.heroBotCommand.host),
      port: numberValue(raw.herobot_command_port, base.heroBotCommand.port),
      timeoutMs: numberValue(raw.herobot_command_timeout_ms, base.heroBotCommand.timeoutMs),
    },
    host: stringValue(raw.host, base.host),
    botControllerPort: numberValue(raw.bot_controller_port, base.botControllerPort),
    minecraftHost: stringValue(raw.minecraft_host, base.minecraftHost),
    minecraftPort: numberValue(raw.minecraft_port, base.minecraftPort),
    minecraftVersion: stringValue(raw.minecraft_version, base.minecraftVersion),
    botNames: Array.isArray(raw.bot_names) ? raw.bot_names.map(String) : base.botNames,
    actionRepeatTicks: numberValue(raw.action_repeat_ticks, base.actionRepeatTicks),
    watchdogTimeoutMs: numberValue(raw.watchdog_timeout_ms, base.watchdogTimeoutMs),
    spawnLoginThrottleMs: numberValue(raw.spawn_login_throttle_ms, base.spawnLoginThrottleMs),
    scriptedOpponent: scriptedOpponentValue(raw.scripted_opponent, base.scriptedOpponent),
    spectatorUsernames: Array.isArray(raw.spectator_usernames) ? raw.spectator_usernames.map(String) : base.spectatorUsernames,
    restrictedMouseProfile: restrictedMouseProfileValue(raw.restricted_mouse_profile, base.restrictedMouseProfile)
  };
}

function stringValue(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

function numberValue(value: unknown, fallback: number): number {
  return typeof value === "number" ? value : fallback;
}

function positiveNumberValue(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
}

function nonNegativeIntegerValue(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : fallback;
}

function restrictedMouseProfileValue(value: unknown, fallback: RestrictedMouseProfile): RestrictedMouseProfile {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return fallback;
  }
  const raw = value as Record<string, unknown>;
  return {
    id: stringValue(raw.id, fallback.id),
    radiansPerCount: positiveNumberValue(raw.radians_per_count, fallback.radiansPerCount),
    maxDxPerStep: nonNegativeIntegerValue(raw.max_dx_per_step, fallback.maxDxPerStep),
    maxDyPerStep: nonNegativeIntegerValue(raw.max_dy_per_step, fallback.maxDyPerStep),
  };
}

function botBackendValue(value: unknown, fallback: BotBackendKind): BotBackendKind {
  if (value === "mineflayer" || value === "herobot") {
    return value;
  }
  return fallback;
}

function scriptedOpponentValue(value: unknown, fallback: ScriptedOpponent): ScriptedOpponent {
  if (value === "mineflayer_pvp") {
    return "controller_pvp";
  }
  if (value === "random" || value === "controller_pvp") {
    return value;
  }
  return fallback;
}
