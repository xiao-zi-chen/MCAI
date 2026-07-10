import { BotController } from "./controller.js";
import { loadConfig } from "./config.js";
import { JsonlTcpServer } from "./jsonl.js";

function argValue(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main(): Promise<void> {
  const config = loadConfig(argValue("--config"));
  const controller = new BotController(config);
  const server = new JsonlTcpServer(config.host, config.botControllerPort, message => controller.handle(message));
  await server.start();
  process.stdout.write(`PVPRobo bot controller listening on ${config.host}:${config.botControllerPort}\n`);

  const shutdown = async () => {
    await server.stop();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch(error => {
  process.stderr.write(`${String(error)}\n`);
  process.exit(1);
});

