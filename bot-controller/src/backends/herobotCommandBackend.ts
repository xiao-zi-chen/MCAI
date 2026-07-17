import type { BotBackend, BotStatus, SpawnSpec } from "../backend.js";
import type { DecodedAction } from "../action.js";

export interface HeroBotCommandTransport {
  sendCommand(command: string): void | Promise<void>;
}

type HeroBotRuntime = BotStatus;

export class HeroBotCommandBackend implements BotBackend {
  private readonly bots = new Map<string, HeroBotRuntime>();

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
      this.send(`playerspawn ${username} in survival`);
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

  applyAction(agentId: string, action: DecodedAction, repeatTicks: number, targetUsername?: string): void {
    const runtime = this.required(agentId);
    const username = this.commandToken(runtime.username);
    this.send(`player ${username} stop`);
    this.send(`player ${username} hotbar ${action.hotbarSlot + 1}`);
    if (action.sprint) {
      this.send(`player ${username} sprint`);
    }
    if (action.sneak) {
      this.send(`player ${username} sneak`);
    }

    const movement = movementCommand(action);
    if (movement) {
      this.send(`player ${username} move ${movement}`);
    }

    const target = targetUsername ?? this.nearestKnownOpponent(runtime)?.username;
    if (action.lookPrimitive !== "none" && target) {
      this.send(`player ${username} look upon ${this.commandToken(target)} ${lookMode(action.lookPrimitive)}`);
    } else if (action.lookPrimitive === "none" && (action.yawDeltaRadians !== 0 || action.pitchDeltaRadians !== 0)) {
      const yaw = radiansToDegrees(action.yawDeltaRadians);
      const pitch = radiansToDegrees(action.pitchDeltaRadians);
      this.send(`player ${username} look relative ~${formatDegrees(yaw)} ~${formatDegrees(pitch)}`);
    }

    if (action.attack) {
      this.send(`player ${username} attack continuous ${Math.max(1, repeatTicks)}`);
    }
    if (action.use) {
      this.send(`player ${username} use continuous ${Math.max(1, repeatTicks)}`);
    }
  }

  applyPvpOpponent(agentId: string, repeatTicks: number): void {
    const runtime = this.required(agentId);
    const target = this.nearestKnownOpponent(runtime);
    if (!target) {
      return;
    }
    const username = this.commandToken(runtime.username);
    this.send(`player ${username} stop`);
    this.send(`player ${username} sprint`);
    this.send(`player ${username} move forward`);
    this.send(`player ${username} look upon ${this.commandToken(target.username)} closest`);
    this.send(`player ${username} attack continuous ${Math.max(1, repeatTicks)}`);
  }

  clearControls(agentId?: string): void {
    const runtimes = agentId ? [this.required(agentId)] : [...this.bots.values()];
    for (const runtime of runtimes) {
      this.send(`player ${this.commandToken(runtime.username)} stop`);
    }
  }

  disconnect(): void {
    for (const runtime of this.bots.values()) {
      this.send(`player ${this.commandToken(runtime.username)} disconnect`);
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
      this.send(`player ${this.commandToken(runtime.username)} disconnect`);
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

  private send(command: string): void {
    void this.transport.sendCommand(command);
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
