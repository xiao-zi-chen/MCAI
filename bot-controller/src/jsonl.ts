import { createServer, Server, Socket } from "node:net";
import { createInterface } from "node:readline";

export type JsonObject = Record<string, unknown>;
export type Handler = (message: JsonObject) => Promise<JsonObject> | JsonObject;

export function encodeJsonl(message: JsonObject): string {
  return `${JSON.stringify(message)}\n`;
}

export function decodeJsonl(line: string): JsonObject {
  const parsed = JSON.parse(line) as unknown;
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("JSONL message must be an object");
  }
  const message = parsed as JsonObject;
  if (message.v !== 1) {
    throw new Error("unsupported protocol version");
  }
  if (typeof message.type !== "string") {
    throw new Error("message missing type");
  }
  return message;
}

export class JsonlTcpServer {
  private server?: Server;

  constructor(
    private readonly host: string,
    private readonly port: number,
    private readonly handler: Handler
  ) {
    if (host !== "127.0.0.1" && host !== "localhost") {
      throw new Error("bot controller must bind to localhost only");
    }
  }

  start(): Promise<void> {
    this.server = createServer(socket => this.handleSocket(socket));
    return new Promise((resolve, reject) => {
      this.server?.once("error", reject);
      this.server?.listen(this.port, this.host, () => resolve());
    });
  }

  stop(): Promise<void> {
    return new Promise(resolve => {
      if (!this.server) {
        resolve();
        return;
      }
      this.server.close(() => resolve());
    });
  }

  private handleSocket(socket: Socket): void {
    if (!socket.remoteAddress?.includes("127.0.0.1") && socket.remoteAddress !== "::1") {
      socket.destroy();
      return;
    }
    const rl = createInterface({ input: socket });
    socket.on("error", error => {
      process.stderr.write(`bot controller socket error: ${String(error)}\n`);
      rl.close();
    });
    rl.on("error", error => {
      process.stderr.write(`bot controller readline error: ${String(error)}\n`);
      socket.destroy();
    });
    rl.on("line", async line => {
      try {
        const request = decodeJsonl(line);
        const response = await this.handler(request);
        socket.write(encodeJsonl(response));
      } catch (error) {
        socket.write(encodeJsonl({ v: 1, id: "unknown", type: "error", ok: false, error: String(error) }));
      }
    });
  }
}
