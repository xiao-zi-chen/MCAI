import mineflayer from "mineflayer";
import type { Bot } from "mineflayer";
import type { BotConfig } from "./config.js";
import type { DecodedAction } from "./action.js";

export type BotRuntime = {
  agentId: string;
  username: string;
  arenaId: string;
  role: string;
  connected: boolean;
  bot?: Bot;
  actionTimer?: NodeJS.Timeout;
};

export class MineflayerAdapter {
  private readonly bots = new Map<string, BotRuntime>();
  private lastSpawnAttemptMs = 0;

  constructor(private readonly config: BotConfig) {}

  async spawn(specs: Array<{ agent_id?: string; username?: string; arena_id?: string; role?: string }>): Promise<string[]> {
    const created: string[] = [];
    for (const spec of specs) {
      const agentId = spec.agent_id ?? spec.username;
      const username = spec.username ?? spec.agent_id;
      if (!agentId || !username) {
        throw new Error("spawn spec requires agent_id or username");
      }
      const existing = this.bots.get(agentId);
      if (existing?.connected) {
        created.push(agentId);
        continue;
      }
      if (existing) {
        existing.bot?.end();
        this.bots.delete(agentId);
      }
      await this.spawnOne(agentId, username, spec.arena_id ?? "arena_0", spec.role ?? "learner");
      created.push(agentId);
    }
    return created;
  }

  private async spawnOne(agentId: string, username: string, arenaId: string, role: string): Promise<void> {
    await this.waitForSpawnThrottle();
    const options = {
      host: this.config.minecraftHost,
      port: this.config.minecraftPort,
      username,
      ...(this.config.minecraftVersion === "auto" ? {} : { version: this.config.minecraftVersion })
    };
    const bot = mineflayer.createBot(options);
    this.lastSpawnAttemptMs = Date.now();
    process.stderr.write(`spawning agent=${agentId} username=${username} arena=${arenaId} host=${this.config.minecraftHost}:${this.config.minecraftPort} version=${this.config.minecraftVersion}\n`);
    const runtime: BotRuntime = { agentId, username, arenaId, role, connected: false, bot };
    this.bots.set(agentId, runtime);

    return new Promise(resolve => {
      const timeout = setTimeout(() => resolve(), this.config.watchdogTimeoutMs);
      bot.once("spawn", () => {
        runtime.connected = true;
        clearTimeout(timeout);
        process.stderr.write(`bot spawned agent=${agentId} username=${username}\n`);
        resolve();
      });
      bot.once("end", reason => {
        runtime.connected = false;
        clearTimeout(timeout);
        process.stderr.write(`bot ended agent=${agentId} reason=${String(reason)}\n`);
        resolve();
      });
      bot.once("kicked", reason => {
        runtime.connected = false;
        process.stderr.write(`bot kicked agent=${agentId} reason=${JSON.stringify(reason)}\n`);
      });
      bot.once("error", error => {
        runtime.connected = false;
        process.stderr.write(`bot error agent=${agentId} error=${String(error)}\n`);
      });
    });
  }

  private async waitForSpawnThrottle(): Promise<void> {
    const throttleMs = Math.max(0, this.config.spawnLoginThrottleMs);
    const waitMs = this.lastSpawnAttemptMs + throttleMs - Date.now();
    if (waitMs > 0) {
      await new Promise(resolve => setTimeout(resolve, waitMs));
    }
  }

  status(): Array<{ agent_id: string; username: string; arena_id: string; role: string; connected: boolean }> {
    return [...this.bots.values()].map(bot => ({
      agent_id: bot.agentId,
      username: bot.username,
      arena_id: bot.arenaId,
      role: bot.role,
      connected: bot.connected
    }));
  }

  applyAction(agentId: string, action: DecodedAction, repeatTicks: number, targetUsername?: string): void {
    const runtime = this.required(agentId);
    if (!runtime.bot) {
      return;
    }
    this.clearControls(agentId);
    const bot = runtime.bot;
    bot.setControlState("forward", action.forward);
    bot.setControlState("back", action.back);
    bot.setControlState("left", action.left);
    bot.setControlState("right", action.right);
    bot.setControlState("jump", action.jump);
    bot.setControlState("sprint", action.sprint);
    bot.setControlState("sneak", action.sneak);
    bot.quickBarSlot = action.hotbarSlot;
    if (action.lookPrimitive === "none") {
      bot.look(bot.entity.yaw + action.yawDeltaRadians, clampPitch(bot.entity.pitch + action.pitchDeltaRadians), true);
    } else {
      this.lookAtNearestEnemy(runtime, action.lookPrimitive, targetUsername);
    }
    if (action.attack) {
      const target = bot.nearestEntity(entity => this.isTrainingOpponent(runtime, entity.username, targetUsername));
      if (target) {
        bot.attack(target);
      }
    }
    if (action.use) {
      bot.activateItem();
    }
    const durationMs = Math.max(1, repeatTicks) * 50;
    runtime.actionTimer = setTimeout(() => this.clearControls(agentId), durationMs);
  }

  applyPvpOpponent(agentId: string, repeatTicks: number): void {
    const runtime = this.required(agentId);
    const bot = runtime.bot;
    if (!bot) {
      return;
    }
    this.clearControls(agentId);
    const target = this.nearestTrainingOpponent(runtime);
    if (!target) {
      return;
    }
    const distance = bot.entity.position.distanceTo(target.position);
    bot.lookAt(target.position.offset(0, 1.0, 0), true);
    if (distance > 2.7) {
      bot.setControlState("forward", true);
      bot.setControlState("sprint", true);
    } else if (distance < 1.2) {
      bot.setControlState("back", true);
    } else {
      bot.setControlState("left", Math.floor(bot.time.age / 8) % 2 === 0);
      bot.setControlState("right", Math.floor(bot.time.age / 8) % 2 === 1);
    }
    if (distance <= 3.2) {
      bot.attack(target);
    }
    const durationMs = Math.max(1, repeatTicks) * 50;
    runtime.actionTimer = setTimeout(() => this.clearControls(agentId), durationMs);
  }

  clearControls(agentId?: string): void {
    const runtimes = agentId ? [this.required(agentId)] : [...this.bots.values()];
    for (const runtime of runtimes) {
      if (runtime.actionTimer) {
        clearTimeout(runtime.actionTimer);
        runtime.actionTimer = undefined;
      }
      const bot = runtime.bot;
      if (!bot) {
        continue;
      }
      for (const control of ["forward", "back", "left", "right", "jump", "sprint", "sneak"] as const) {
        bot.setControlState(control, false);
      }
      bot.deactivateItem();
    }
  }

  disconnect(): void {
    this.clearControls();
    for (const runtime of this.bots.values()) {
      runtime.bot?.end();
      runtime.connected = false;
    }
    this.bots.clear();
  }

  disconnectAgents(agentIds: string[]): string[] {
    const disconnected: string[] = [];
    for (const agentId of agentIds) {
      const runtime = this.bots.get(agentId);
      if (!runtime) {
        continue;
      }
      this.clearControls(agentId);
      runtime.bot?.end();
      runtime.connected = false;
      this.bots.delete(agentId);
      disconnected.push(agentId);
    }
    return disconnected;
  }

  private lookAtNearestEnemy(runtime: BotRuntime, primitive: DecodedAction["lookPrimitive"], targetUsername?: string): void {
    const bot = runtime.bot;
    if (!bot) {
      return;
    }
    const target = this.nearestTrainingOpponent(runtime, targetUsername);
    if (!target) {
      return;
    }
    const yOffset = primitive === "enemy_head" ? 1.62 : primitive === "enemy_body" ? 1.0 : 0.2;
    bot.lookAt(target.position.offset(0, yOffset, 0), true);
  }

  private required(agentId: string): BotRuntime {
    const runtime = this.bots.get(agentId);
    if (!runtime) {
      throw new Error(`unknown agent_id: ${agentId}`);
    }
    return runtime;
  }

  private nearestTrainingOpponent(runtime: BotRuntime, targetUsername?: string) {
    return runtime.bot?.nearestEntity(entity => this.isTrainingOpponent(runtime, entity.username, targetUsername));
  }

  private isTrainingOpponent(runtime: BotRuntime, username: unknown, targetUsername?: string): boolean {
    if (typeof username !== "string") {
      return false;
    }
    if (username === runtime.username) {
      return false;
    }
    if (this.config.spectatorUsernames.includes(username)) {
      return false;
    }
    if (targetUsername && username === targetUsername) {
      return true;
    }
    const target = [...this.bots.values()].find(bot => bot.username === username || bot.agentId === username);
    if (!target) {
      return false;
    }
    return target.arenaId === runtime.arenaId;
  }
}

function clampPitch(value: number): number {
  const limit = Math.PI / 2 - 0.001;
  return Math.max(-limit, Math.min(limit, value));
}
