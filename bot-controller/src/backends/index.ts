import type { BotBackend } from "../backend.js";
import type { BotConfig } from "../config.js";
import { HeroBotCommandBackend } from "./herobotCommandBackend.js";
import { HeroBotJsonlCommandTransport } from "./herobotJsonlTransport.js";
import { MineflayerBackend } from "./mineflayerBackend.js";

export function createBotBackend(config: BotConfig): BotBackend {
  switch (config.botBackend) {
    case "mineflayer":
      return new MineflayerBackend(config);
    case "herobot":
      return new HeroBotCommandBackend(new HeroBotJsonlCommandTransport(config.heroBotCommand));
  }
}
