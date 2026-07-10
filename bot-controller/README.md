# PVPRobo Bot Controller

Node.js + TypeScript Mineflayer controller for local headless bots.

The controller exposes a localhost-only persistent TCP JSONL API for the Python env. It does not render Minecraft, write per-step logs, or use HTTP in the hot loop.

For multi-arena sampling, spawned bots carry `arena_id` and `role`. Target selection and scripted random opponent actions are restricted to each bot's own arena group. Default generated names are `ROBO-A{index}` for the learner and `SCRIPT-A{index}` for the scripted opponent.

Build and test:

```powershell
npm.cmd install
npm.cmd test
```

Start after build:

```powershell
npm.cmd run build
node .\dist\index.js --config ..\configs\default-bot.json
```

For the verified Windows worker path, `minecraft_version` is `auto` and bot login is serialized to avoid Paper/Mineflayer handshake races.
