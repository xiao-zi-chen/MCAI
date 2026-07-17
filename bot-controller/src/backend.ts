import type { DecodedAction } from "./action.js";

export type BotBackendKind = "mineflayer" | "herobot";

export type ScriptedOpponent = "none" | "random" | "controller_pvp";

export type SpawnSpec = {
  agent_id?: string;
  username?: string;
  arena_id?: string;
  role?: string;
};

export type BotStatus = {
  agent_id: string;
  username: string;
  arena_id: string;
  role: string;
  connected: boolean;
};

export interface BotBackend {
  spawn(specs: SpawnSpec[]): Promise<string[]>;
  status(): BotStatus[];
  applyAction(agentId: string, action: DecodedAction, repeatTicks: number, targetUsername?: string): void;
  applyPvpOpponent(agentId: string, repeatTicks: number): void;
  clearControls(agentId?: string): void;
  disconnect(): void;
  disconnectAgents(agentIds: string[]): string[];
}

