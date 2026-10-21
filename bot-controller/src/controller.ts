import { decodeAction, neutralAction, randomAction } from "./action.js";
import { decodeSwordPvpActionV1, RESTRICTED_ACTION_FORBIDDEN_FIELDS } from "./actionAbi.js";
import type { BotBackend } from "./backend.js";
import type { BotConfig } from "./config.js";
import type { JsonObject } from "./jsonl.js";
import { createBotBackend } from "./backends/index.js";

export class BotController {
  private readonly actionOrder = new Map<string, number>();
  constructor(
    private readonly config: BotConfig,
    private readonly adapter: BotBackend = createBotBackend(config)
  ) {}

  async handle(message: JsonObject): Promise<JsonObject> {
    const id = typeof message.id === "string" ? message.id : "unknown";
    try {
      switch (message.type) {
        case "hello":
          return this.base(id, "hello_ack", { server: "pvprobo-bot-controller" });
        case "spawn":
          return await this.spawn(id, message);
        case "status":
          return this.base(id, "status", { ok: true, bots: this.adapter.status() });
        case "ready_request":
          return this.base(id, "ready", { bots: this.adapter.status().map(bot => bot.agent_id) });
        case "act":
          return await this.act(id, message);
        case "apply_action":
          return await this.applyAction(id, message);
        case "apply_restricted_action":
          return await this.applyRestrictedAction(id, message);
        case "clear_controls":
        case "stop_action":
          await this.adapter.clearControls(typeof message.agent_id === "string" ? message.agent_id : undefined);
          return this.base(id, "clear_controls_ack", { ok: true });
        case "despawn":
          return await this.despawn(id, message);
        case "disconnect":
          await this.adapter.disconnect();
          return this.base(id, "disconnect_ack", { ok: true });
        default:
          return this.base(id, "error", { ok: false, error: `unsupported message type: ${String(message.type)}` });
      }
    } catch (error) {
      return this.base(id, "error", { ok: false, error: String(error) });
    }
  }

  private async spawn(id: string, message: JsonObject): Promise<JsonObject> {
    const specs = Array.isArray(message.bots)
      ? message.bots as Array<{ agent_id?: string; username?: string; arena_id?: string; role?: string; x?: number; y?: number; z?: number; yaw?: number; pitch?: number }>
      : this.config.botNames.map(name => ({ agent_id: name, username: name }));
    const bots = await this.adapter.spawn(specs);
    return this.base(id, "spawn_ack", { ok: true, bots });
  }

  private async despawn(id: string, message: JsonObject): Promise<JsonObject> {
    const rawAgents = Array.isArray(message.agent_ids)
      ? message.agent_ids
      : (typeof message.agent_id === "string" ? [message.agent_id] : []);
    const agentIds = rawAgents.filter((agentId): agentId is string => typeof agentId === "string" && agentId.length > 0);
    if (agentIds.length === 0) {
      throw new Error("despawn requires agent_id or agent_ids");
    }
    const bots = await this.adapter.disconnectAgents(agentIds);
    return this.base(id, "despawn_ack", { ok: true, bots });
  }

  private async act(id: string, message: JsonObject): Promise<JsonObject> {
    const repeatTicks = repeatTicksFrom(message, this.config.actionRepeatTicks);
    const actions = message.actions;
    if (!actions || typeof actions !== "object" || Array.isArray(actions)) {
      throw new Error("act requires actions object");
    }
    const entries = Object.entries(actions as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([agentId, rawAction]) => ({agentId, action: decodeAction(rawAction)}));
    const arena = typeof message.arena_id === "string" ? message.arena_id : "default";
    const sequence = this.actionOrder.get(arena) ?? 0;
    this.actionOrder.set(arena, sequence + 1);
    for (let index = 0; index < entries.length; index++) {
      const entry = entries[(sequence + index) % entries.length];
      await this.adapter.applyAction(entry.agentId, entry.action, repeatTicks);
    }
    await this.applyScriptedOpponent(repeatTicks);
    return this.base(id, "act_ack", { accepted: true });
  }

  private async applyAction(id: string, message: JsonObject): Promise<JsonObject> {
    if (typeof message.agent_id !== "string") {
      throw new Error("apply_action requires agent_id");
    }
    await this.adapter.applyAction(
      message.agent_id,
      decodeAction(message.action),
      repeatTicksFrom(message, this.config.actionRepeatTicks),
      typeof message.target_username === "string" ? message.target_username : undefined
    );
    await this.applyScriptedOpponent(repeatTicksFrom(message, this.config.actionRepeatTicks));
    return this.base(id, "apply_action_ack", { accepted: true });
  }

  private async applyRestrictedAction(id: string, message: JsonObject): Promise<JsonObject> {
    if (typeof message.agent_id !== "string") {
      throw new Error("apply_restricted_action requires agent_id");
    }
    const forbidden = Object.keys(message).filter(key => (RESTRICTED_ACTION_FORBIDDEN_FIELDS as readonly string[]).includes(key));
    if (forbidden.length > 0) {
      throw new Error(`forbidden restricted action fields: ${forbidden.sort().join(",")}`);
    }
    const action = decodeSwordPvpActionV1(message.action);
    const executed = await this.adapter.applyRestrictedAction(message.agent_id, action);
    return this.base(id, "apply_restricted_action_ack", {
      accepted: true,
      action_requested: action,
      action_executed: executed,
      action_execution_status: executed.status,
      action_execution_status_reasons: executed.status_reasons,
    });
  }

  private async applyScriptedOpponent(repeatTicks: number): Promise<void> {
    if (this.config.scriptedOpponent === "none") {
      return;
    }
    const byArena = new Map<string, Array<{ agent_id: string; role?: string }>>();
    for (const bot of this.adapter.status()) {
      const arenaId = typeof bot.arena_id === "string" ? bot.arena_id : "arena_0";
      const group = byArena.get(arenaId) ?? [];
      group.push(bot);
      byArena.set(arenaId, group);
    }
    for (const group of byArena.values()) {
      const scripted = group.find(bot => bot.role === "scripted" || /^SCRIPT[-_]/.test(bot.agent_id)) ?? group[1];
      if (scripted) {
        if (this.config.scriptedOpponent === "controller_pvp") {
          await this.adapter.applyPvpOpponent(scripted.agent_id, repeatTicks);
        } else {
          await this.adapter.applyAction(scripted.agent_id, decodeAction(randomAction()), repeatTicks);
        }
      }
    }
  }

  private base(id: string, type: string, extra: JsonObject): JsonObject {
    return { v: 1, id, type, ...extra };
  }
}

function repeatTicksFrom(message: JsonObject, fallback: number): number {
  return typeof message.repeat_ticks === "number" ? message.repeat_ticks : fallback;
}

export { neutralAction };
