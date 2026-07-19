import { createConnection } from "node:net";
import type { HeroBotCommandConfig } from "../config.js";
import { decodeJsonl, encodeJsonl, type JsonObject } from "../jsonl.js";
import type { HeroBotCommandTransport } from "./herobotCommandBackend.js";

export class HeroBotJsonlCommandTransport implements HeroBotCommandTransport {
  private nextId = 1;

  constructor(private readonly config: HeroBotCommandConfig) {
    if (config.host !== "127.0.0.1" && config.host !== "localhost") {
      throw new Error("HeRoBot command bridge must be localhost-only");
    }
  }

  sendCommand(command: string): Promise<void> {
    const requestId = `herobot-command-${this.nextId++}`;
    const request = { v: 1, id: requestId, type: "run_command", command };
    return new Promise((resolve, reject) => {
      const socket = createConnection({ host: this.config.host, port: this.config.port });
      let buffer = "";
      const timeout = setTimeout(() => {
        socket.destroy();
        reject(new Error(`HeRoBot command bridge timed out after ${this.config.timeoutMs}ms`));
      }, this.config.timeoutMs);

      socket.once("connect", () => {
        socket.write(encodeJsonl(request));
      });
      socket.on("data", chunk => {
        buffer += chunk.toString("utf8");
        const newline = buffer.indexOf("\n");
        if (newline < 0) {
          return;
        }
        const line = buffer.slice(0, newline);
        clearTimeout(timeout);
        socket.end();
        try {
          const response = decodeJsonl(line);
          this.assertAck(response, requestId, command);
          resolve();
        } catch (error) {
          reject(error);
        }
      });
      socket.once("error", error => {
        clearTimeout(timeout);
        reject(error);
      });
      socket.once("close", () => {
        clearTimeout(timeout);
      });
    });
  }

  private assertAck(response: JsonObject, requestId: string, command: string): void {
    if (response.id !== requestId) {
      throw new Error(`unexpected HeRoBot command ack id: ${String(response.id)}`);
    }
    if (response.type !== "run_command_ack" || response.ok !== true) {
      throw new Error(`HeRoBot command bridge rejected command '${command}': ${String(response.error ?? response.type)}`);
    }
    if (typeof response.command_result === "number" && response.command_result <= 0) {
      throw new Error(`HeRoBot command '${command}' returned ${response.command_result}`);
    }
  }
}
