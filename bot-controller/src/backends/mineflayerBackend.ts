import mineflayer from "mineflayer";
import type { Bot } from "mineflayer";
import type { BotStatus, SpawnSpec } from "../backend.js";
import type { BotConfig, RestrictedMouseProfile } from "../config.js";
import { defaultRestrictedMouseProfile } from "../config.js";
import type { DecodedAction } from "../action.js";
import { swordActionToVirtualHidFrameV1, type NormalizedSwordPvpActionV1, type NormalizedVirtualHidFrameV1 } from "../actionAbi.js";
import { canAttackTarget, directionTo, lookDirection, type AabbLike, type Vec3Like } from "../combatGeometry.js";

const VANILLA_ENTITY_INTERACTION_RANGE = 3.0;

export type BotRuntime = {
  agentId: string;
  username: string;
  arenaId: string;
  role: string;
  connected: boolean;
  bot?: Bot;
  actionTimer?: NodeJS.Timeout;
};

export class MineflayerBackend {
  private readonly bots = new Map<string, BotRuntime>();
  private lastSpawnAttemptMs = 0;

  constructor(private readonly config: BotConfig) {}

  async spawn(specs: SpawnSpec[]): Promise<string[]> {
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

  status(): BotStatus[] {
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
    let aimedTarget: { position: Vec3Like; height?: number; width?: number } | undefined;
    let aimedDirection: Vec3Like | undefined;
    if (action.lookPrimitive === "none") {
      const intendedYaw = bot.entity.yaw + action.yawDeltaRadians;
      const intendedPitch = clampPitch(bot.entity.pitch + action.pitchDeltaRadians);
      bot.look(intendedYaw, intendedPitch, true);
      aimedDirection = lookDirection(intendedYaw, intendedPitch);
    } else {
      const aim = this.lookAtNearestEnemy(runtime, action.lookPrimitive, targetUsername);
      aimedTarget = aim?.target;
      aimedDirection = aim ? directionTo(botEye(bot), aim.point) : undefined;
    }
    if (action.attack) {
      const target = aimedTarget ?? bot.nearestEntity(entity => this.isTrainingOpponent(runtime, entity.username, targetUsername));
      if (target && this.canAttackCurrentTarget(bot, target, aimedDirection)) {
        bot.attack(target as Parameters<Bot["attack"]>[0]);
      }
    }
    if (action.use) {
      bot.activateItem();
    }
    const durationMs = Math.max(1, repeatTicks) * 50;
    runtime.actionTimer = setTimeout(() => this.clearControls(agentId), durationMs);
  }

  applyRestrictedAction(agentId: string, action: NormalizedSwordPvpActionV1): NormalizedVirtualHidFrameV1 {
    const runtime = this.required(agentId);
    if (!runtime.bot) {
      return {
        ...swordActionToVirtualHidFrameV1(action),
        status: "dropped",
        status_reasons: ["bot_not_available"],
      };
    }
    this.clearControls(agentId);
    const frame = applyRestrictedFrameToMineflayerBot(runtime.bot, action, this.config.restrictedMouseProfile);
    const durationMs = Math.max(1, frame.control_step_ticks) * 50;
    runtime.actionTimer = setTimeout(() => this.clearControls(agentId), durationMs);
    return frame;
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
    const aimPoint = target.position.offset(0, 1.0, 0);
    bot.lookAt(aimPoint, true);
    if (distance > 2.7) {
      bot.setControlState("forward", true);
      bot.setControlState("sprint", true);
    } else if (distance < 1.2) {
      bot.setControlState("back", true);
    } else {
      bot.setControlState("left", Math.floor(bot.time.age / 8) % 2 === 0);
      bot.setControlState("right", Math.floor(bot.time.age / 8) % 2 === 1);
    }
    if (distance <= 3.2 && this.canAttackCurrentTarget(bot, target, directionTo(botEye(bot), aimPoint))) {
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

  private lookAtNearestEnemy(runtime: BotRuntime, primitive: DecodedAction["lookPrimitive"], targetUsername?: string): { target: { position: Vec3Like; height?: number; width?: number }; point: Vec3Like } | undefined {
    const bot = runtime.bot;
    if (!bot) {
      return undefined;
    }
    const target = this.nearestTrainingOpponent(runtime, targetUsername);
    if (!target) {
      return undefined;
    }
    const yOffset = primitive === "enemy_head" ? 1.62 : primitive === "enemy_body" ? 1.0 : 0.2;
    const point = target.position.offset(0, yOffset, 0);
    bot.lookAt(point, true);
    return { target, point };
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

  private canAttackCurrentTarget(bot: Bot, target: { position: Vec3Like; height?: number; width?: number }, directionOverride?: Vec3Like): boolean {
    const reach = VANILLA_ENTITY_INTERACTION_RANGE;
    const eye = botEye(bot);
    const direction = directionOverride ?? lookDirection(bot.entity.yaw, bot.entity.pitch);
    const targetBox = targetAabb(target);
    const block = raycastBlock(bot, eye, direction, reach);
    const blockingDistance = block?.intersect ? distanceBetween(eye, block.intersect) : undefined;
    return canAttackTarget({ eye, direction, targetBox, reach, blockingDistance });
  }
}

export function applyRestrictedFrameToMineflayerBot(
  bot: Bot,
  action: NormalizedSwordPvpActionV1,
  mouseProfile: RestrictedMouseProfile = defaultRestrictedMouseProfile(),
): NormalizedVirtualHidFrameV1 {
  const requestedFrame = swordActionToVirtualHidFrameV1(action);
  const { dx, dy, reasons } = clipMouseCounts(requestedFrame.mouse_dx, requestedFrame.mouse_dy, mouseProfile);
  let frame: NormalizedVirtualHidFrameV1 = {
    ...requestedFrame,
    mouse_dx: dx,
    mouse_dy: dy,
    status: reasons.length > 0 ? "clipped" : requestedFrame.status,
    status_reasons: reasons,
  };
  bot.setControlState("forward", frame.keys.forward);
  bot.setControlState("back", frame.keys.back);
  bot.setControlState("left", frame.keys.left);
  bot.setControlState("right", frame.keys.right);
  bot.setControlState("jump", frame.keys.jump);
  bot.setControlState("sprint", frame.keys.sprint);
  bot.setControlState("sneak", frame.keys.sneak);

  const intendedYaw = bot.entity.yaw + frame.mouse_dx * mouseProfile.radiansPerCount;
  const intendedPitch = clampPitch(bot.entity.pitch + frame.mouse_dy * mouseProfile.radiansPerCount);
  bot.look(intendedYaw, intendedPitch, true);

  if (frame.mouse_buttons.use) {
    bot.activateItem();
  }
  if (!frame.mouse_buttons.attack) {
    return frame;
  }
  const swingArm = (bot as unknown as { swingArm?: (hand: "left" | "right") => void }).swingArm;
  if (typeof swingArm !== "function") {
    return {
      ...frame,
      status: "dropped",
      status_reasons: [...frame.status_reasons, "attack_pulse_unavailable"],
    };
  }
  swingArm.call(bot, "right");
  return frame;
}

function clipMouseCounts(dx: number, dy: number, profile: RestrictedMouseProfile): { dx: number; dy: number; reasons: string[] } {
  const clippedDx = clamp(dx, -profile.maxDxPerStep, profile.maxDxPerStep);
  const clippedDy = clamp(dy, -profile.maxDyPerStep, profile.maxDyPerStep);
  const reasons: string[] = [];
  if (clippedDx !== dx) {
    reasons.push("mouse_dx_clipped");
  }
  if (clippedDy !== dy) {
    reasons.push("mouse_dy_clipped");
  }
  return { dx: clippedDx, dy: clippedDy, reasons };
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function clampPitch(value: number): number {
  const limit = Math.PI / 2 - 0.001;
  return Math.max(-limit, Math.min(limit, value));
}

function targetAabb(target: { position: Vec3Like; height?: number; width?: number }): AabbLike {
  const width = target.width ?? 0.6;
  const height = target.height ?? 1.8;
  const halfWidth = width / 2;
  return {
    minX: target.position.x - halfWidth,
    minY: target.position.y,
    minZ: target.position.z - halfWidth,
    maxX: target.position.x + halfWidth,
    maxY: target.position.y + height,
    maxZ: target.position.z + halfWidth
  };
}

function botEye(bot: Bot): Vec3Like {
  return bot.entity.position.offset(0, bot.entity.height ?? 1.62, 0);
}

function raycastBlock(bot: Bot, eye: Vec3Like, direction: Vec3Like, reach: number): { intersect?: Vec3Like } | null {
  const world = bot.world as unknown as { raycast?: (from: unknown, direction: unknown, range: number) => { intersect?: Vec3Like } | null };
  if (typeof world.raycast !== "function") {
    return null;
  }
  const from = eye as unknown as { offset?: (x: number, y: number, z: number) => { minus: (other: unknown) => unknown } };
  const rayDirection = typeof from.offset === "function"
    ? from.offset(direction.x, direction.y, direction.z).minus(eye)
    : direction;
  return world.raycast(eye, rayDirection, reach);
}

function distanceBetween(a: Vec3Like, b: Vec3Like): number {
  return Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
}
