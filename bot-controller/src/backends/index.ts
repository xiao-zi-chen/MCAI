import type { BotBackend } from "../backend.js";
import type { BotConfig } from "../config.js";
import { MineflayerBackend } from "./mineflayerBackend.js";

export function createBotBackend(config: BotConfig): BotBackend {
  switch (config.botBackend) {
    case "mineflayer":
      return new MineflayerBackend(config);
    case "herobot":
      throw new Error("herobot bot_backend is reserved for the Fabric/HeRoBot worker path and is not available in the Node controller yet");
  }
}

