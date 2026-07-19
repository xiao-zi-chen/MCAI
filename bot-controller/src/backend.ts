import type { DecodedAction } from "./action.js";
import type { NormalizedSwordPvpActionV1, NormalizedVirtualHidFrameV1 } from "./actionAbi.js";

export type BotBackendKind = "mineflayer" | "herobot";

export type ScriptedOpponent = "none" | "random" | "controller_pvp";

export type SpawnSpec = {
  agent_id?: string;
  username?: string;
  arena_id?: string;
  role?: string;
  x?: number;
  y?: number;
  z?: number;
  yaw?: number;
  pitch?: number;
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
  applyAction(agentId: string, action: DecodedAction, repeatTicks: number, targetUsername?: string): void | Promise<void>;
  applyRestrictedAction(agentId: string, action: NormalizedSwordPvpActionV1): NormalizedVirtualHidFrameV1 | Promise<NormalizedVirtualHidFrameV1>;
  applyPvpOpponent(agentId: string, repeatTicks: number): void | Promise<void>;
  clearControls(agentId?: string): void | Promise<void>;
  disconnect(): void | Promise<void>;
  disconnectAgents(agentIds: string[]): string[] | Promise<string[]>;
}
