import type { BotBackend, BotStatus, SpawnSpec } from "../backend.js";
import type { DecodedAction } from "../action.js";
import { swordActionToVirtualHidFrameV1, type NormalizedSwordPvpActionV1, type NormalizedVirtualHidFrameV1 } from "../actionAbi.js";

export interface HeroBotCommandTransport {
  sendCommand(command: string): void | Promise<void>;
}

type HeroBotRuntime = BotStatus;

export class HeroBotCommandBackend implements BotBackend {
  private readonly bots = new Map<string, HeroBotRuntime>();
  private commandQueue: Promise<void> = Promise.resolve();

  constructor(private readonly transport: HeroBotCommandTransport) {}

  async spawn(specs: SpawnSpec[]): Promise<string[]> {
    const created: string[] = [];
    for (const spec of specs) {
      const agentId = spec.agent_id ?? spec.username;
      const username = spec.username ?? spec.agent_id;
      if (!agentId || !username) {
        throw new Error("spawn spec requires agent_id or username");
      }
      this.requireCommandToken(username);
      await this.send(spawnCommand(username, spec));
      this.bots.set(agentId, {
        agent_id: agentId,
        username,
        arena_id: spec.arena_id ?? "arena_0",
        role: spec.role ?? "learner",
        connected: true,
      });
      created.push(agentId);
    }
    return created;
  }

  status(): BotStatus[] {
    return [...this.bots.values()].map(bot => ({ ...bot }));
  }

  async applyAction(agentId: string, action: DecodedAction, repeatTicks: number, targetUsername?: string): Promise<void> {
    const runtime = this.required(agentId);
    const username = this.commandToken(runtime.username);
    await this.send(`player ${username} stop`);
    await this.send(`player ${username} hotbar ${action.hotbarSlot + 1}`);
    if (action.sprint) {
      await this.send(`player ${username} sprint`);
    }
    if (action.sneak) {
      await this.send(`player ${username} sneak`);
    }

    const movement = movementCommand(action);
    if (movement) {
      await this.send(`player ${username} move ${movement}`);
    }

    const target = targetUsername ?? this.nearestKnownOpponent(runtime)?.username;
    if (action.lookPrimitive !== "none" && target) {
      await this.send(`player ${username} look upon ${this.commandToken(target)} ${lookMode(action.lookPrimitive)}`);
    } else if (action.lookPrimitive === "none" && (action.yawDeltaRadians !== 0 || action.pitchDeltaRadians !== 0)) {
      const yaw = radiansToDegrees(action.yawDeltaRadians);
      const pitch = radiansToDegrees(action.pitchDeltaRadians);
      await this.send(`player ${username} look relative ~${formatDegrees(yaw)} ~${formatDegrees(pitch)}`);
    }

    if (action.attack) {
      await this.send(`player ${username} attack continuous ${Math.max(1, repeatTicks)}`);
    }
    if (action.use) {
      await this.send(`player ${username} use continuous ${Math.max(1, repeatTicks)}`);
    }
  }

  async applyRestrictedAction(agentId: string, action: NormalizedSwordPvpActionV1): Promise<NormalizedVirtualHidFrameV1> {
    const runtime = this.required(agentId);
    const username = this.commandToken(runtime.username);
    const frame = swordActionToVirtualHidFrameV1(action);
    await this.send(`player ${username} stop`);
    if (frame.keys.sprint) {
      await this.send(`player ${username} sprint`);
    }
    if (frame.keys.sneak) {
      await this.send(`player ${username} sneak`);
    }
    for (const movement of restrictedMovementCommands(frame)) {
      await this.send(`player ${username} move ${movement}`);
    }
    if (frame.mouse_dx !== 0 || frame.mouse_dy !== 0) {
      await this.send(`player ${username} look relative ~${frame.mouse_dx} ~${frame.mouse_dy}`);
    }
    if (frame.mouse_buttons.attack) {
      await this.send(`player ${username} attack once`);
    }
    if (frame.mouse_buttons.use) {
      await this.send(`player ${username} use continuous ${Math.max(1, frame.control_step_ticks)}`);
    }
    return frame;
  }

  async applyPvpOpponent(agentId: string, repeatTicks: number): Promise<void> {
    const runtime = this.required(agentId);
    const target = this.nearestKnownOpponent(runtime);
    if (!target) {
      return;
    }
    const username = this.commandToken(runtime.username);
    await this.send(`player ${username} stop`);
    await this.send(`player ${username} sprint`);
    await this.send(`player ${username} move forward`);
    await this.send(`player ${username} look upon ${this.commandToken(target.username)} closest`);
    await this.send(`player ${username} attack continuous ${Math.max(1, repeatTicks)}`);
  }

  async clearControls(agentId?: string): Promise<void> {
    const runtimes = agentId ? [this.required(agentId)] : [...this.bots.values()];
    for (const runtime of runtimes) {
      await this.send(`player ${this.commandToken(runtime.username)} stop`);
    }
  }

  async disconnect(): Promise<void> {
    for (const runtime of this.bots.values()) {
      await this.send(`player ${this.commandToken(runtime.username)} disconnect`);
    }
    this.bots.clear();
  }

  async disconnectAgents(agentIds: string[]): Promise<string[]> {
    const disconnected: string[] = [];
    for (const agentId of agentIds) {
      const runtime = this.bots.get(agentId);
      if (!runtime) {
        continue;
      }
      await this.send(`player ${this.commandToken(runtime.username)} disconnect`);
      this.bots.delete(agentId);
      disconnected.push(agentId);
    }
    return disconnected;
  }

  private required(agentId: string): HeroBotRuntime {
    const runtime = this.bots.get(agentId);
    if (!runtime) {
      throw new Error(`unknown agent_id: ${agentId}`);
    }
    return runtime;
  }

  private nearestKnownOpponent(runtime: HeroBotRuntime): HeroBotRuntime | undefined {
    return [...this.bots.values()].find(bot => bot.agent_id !== runtime.agent_id && bot.arena_id === runtime.arena_id);
  }

  private commandToken(value: string): string {
    this.requireCommandToken(value);
    return value;
  }

  private requireCommandToken(value: string): void {
    if (!value || /[\s"'\\]/.test(value)) {
      throw new Error(`unsafe HeRoBot command token: ${value}`);
    }
  }

  private send(command: string): Promise<void> {
    const run = this.commandQueue.catch(() => undefined).then(() => this.transport.sendCommand(command));
    this.commandQueue = run.catch(() => undefined);
    return run;
  }
}

function movementCommand(action: DecodedAction): "forward" | "backward" | "left" | "right" | undefined {
  if (action.forward) {
    return "forward";
  }
  if (action.back) {
    return "backward";
  }
  if (action.left) {
    return "left";
  }
  if (action.right) {
    return "right";
  }
  return undefined;
}

function spawnCommand(username: string, spec: SpawnSpec): string {
  if (
    typeof spec.x === "number"
    && typeof spec.y === "number"
    && typeof spec.z === "number"
    && typeof spec.yaw === "number"
    && typeof spec.pitch === "number"
  ) {
    return `playerspawn ${username} at ${formatNumber(spec.x)} ${formatNumber(spec.y)} ${formatNumber(spec.z)} facing ${formatNumber(spec.yaw)} ${formatNumber(spec.pitch)} in survival`;
  }
  return `playerspawn ${username} at 0 90 0 facing 0 0 in survival`;
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(3);
}

function restrictedMovementCommands(frame: NormalizedVirtualHidFrameV1): Array<"forward" | "backward" | "left" | "right"> {
  const commands: Array<"forward" | "backward" | "left" | "right"> = [];
  if (frame.keys.forward) {
    commands.push("forward");
  }
  if (frame.keys.back) {
    commands.push("backward");
  }
  if (frame.keys.left) {
    commands.push("left");
  }
  if (frame.keys.right) {
    commands.push("right");
  }
  return commands;
}

function lookMode(primitive: DecodedAction["lookPrimitive"]): "eyes" | "closest" | "feet" {
  if (primitive === "enemy_head") {
    return "eyes";
  }
  if (primitive === "enemy_feet") {
    return "feet";
  }
  return "closest";
}

function radiansToDegrees(value: number): number {
  return value * 180 / Math.PI;
}

function formatDegrees(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(3);
}
