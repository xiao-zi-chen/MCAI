# Local AI Battle Spectating

This page is the shortest open-core path for watching two built-in AI policies fight in a local Minecraft client. It uses only scripted policies, so it does not require trained model checkpoints.

Use this only on private local or LAN servers you control. Do not use PVPRobo for public-server cheating, anticheat bypassing, stealth automation, or evasion.

## What This Starts

- One Paper `--nogui` worker on `localhost`.
- The PVPRobo Paper plugin.
- The Mineflayer bot controller.
- A Python duel daemon that listens for in-game duel or AI Battle requests.
- A normal Minecraft Java Edition client joining as a viewer.

For `WorkerId 1`, the Minecraft gameplay port is `25566`, the plugin control port is `25590`, and the bot-controller port is `25591`.

## 1. Prepare Dependencies

From the repository root:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\setup-python-env.ps1
npm.cmd --prefix bot-controller install
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\build-all.ps1 -JavaHome "<JDK 21 path>" -GradleHome "<Gradle path>"
```

## 2. Create A Scripted Duel Manifest

The example manifest includes `script_easy` and `script_hard`, which are built into the Python package and do not need checkpoints.

```powershell
New-Item -ItemType Directory -Force -Path .\runs\duel | Out-Null
Copy-Item -LiteralPath .\configs\duel-policies.example.json -Destination .\runs\duel\duel-policies.json -Force
```

Model-backed difficulties such as `bc`, `ppo_mid`, `ppo_high`, or `champion` work only when their checkpoint paths in the manifest exist and pass preflight. Use `script_easy` and `script_hard` first when you want a checkpoint-free smoke.

## 3. Start The Local Duel Worker

Use a nonzero worker so it stays separate from training worker 0:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\start-duel-worker.ps1 `
  -WorkerId 1 `
  -JavaHome "<JDK 21 path>" `
  -GradleHome "<Gradle path>" `
  -NodeHome "<Node path>" `
  -AcceptEula `
  -Rebuild
```

`-AcceptEula` writes `runs\worker_001\eula.txt` only when explicitly passed. Use it only after you have read and accepted Mojang's Minecraft EULA.

For another machine on your LAN to join, add `-ExposeLan` and then run:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\test-lan-duel-access.ps1 -WorkerId 1 -RequireRunning
```

## 4. Start The Duel Daemon

Open a second PowerShell window from the repository root and run:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\run-duel-daemon.ps1 -WorkerId 1
```

Leave this window running. The daemon spawns AI Battle bots, marks them ready, drives both participants, and despawns temporary AI Battle bots after the fight.

For a one-battle smoke that exits after the first session:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\run-duel-daemon.ps1 -WorkerId 1 -MaxSessions 1 -MaxSteps 300
```

## 5. Join From Minecraft

Use Minecraft Java Edition `1.21`.

- Same machine: Direct Connect to `127.0.0.1:25566`.
- LAN machine: Direct Connect to the LAN address printed by `test-lan-duel-access.ps1`, port `25566`.

The open-core local worker uses `online-mode=false` and is intended for private local testing. The authenticated public-entry Velocity topology is a private extension and is not part of this open core.

When you join, the plugin should teleport you to the local lobby at roughly `x=0 y=66 z=12`, switch normal players to Adventure mode, and give utility items:

- Slot 0 Nether Star: PVPRobo menu.
- Slot 3 Ender Eye: Watch AI Battle.

To grant operator (OP) access on the local offline worker, add
`-OperatorUsernames PLAYER_NAME` to the startup command in step 3. Replace
`PLAYER_NAME` with your Minecraft username. When upgrading the plugin, keep
`-Rebuild` in that command so the worker loads the updated jar. If an older
plugin removed your OP entry, pass `-OperatorUsernames` again to restore it.

The plugin preserves server-granted OP access. Players with OP or the
`pvprobo.admin` permission see admin tools by default. To test the normal
player experience as an admin, run:

```text
/pvprobo playtest on
```

Use `/pvprobo playtest off` to restore admin commands.

## 6. Watch Two AIs Fight

In game:

1. Right-click the Ender Eye, or run `/pvprobo menu` and click `Watch AI Battle`.
2. Choose `Basic SCRIPT` / `script_easy` as fighter 1.
3. Choose `Tough SCRIPT` / `script_hard` as fighter 2.
4. Wait for the loading/countdown titles.

The plugin moves the viewer to `duel.spectator-spawn` near the generated arena, switches the viewer to Spectator mode, and shows an AI Battle scoreboard. The daemon drives both generated Mineflayer participants. At the end, temporary AI bots are despawned and the viewer returns to the lobby.

## If You Cannot See The Arena

- Make sure the duel daemon is running. Without it, the plugin can create an AI Battle request but no AI participants will be driven.
- Run `/pvprobo arena status`. The default local arena is centered around `x=0 y=64 z=0`; the viewer point is near `x=0 y=66 z=8`.
- If you are OP and not seeing normal menu behavior, run `/pvprobo playtest on`.
- If you join in Survival mode before the plugin finishes handling join, run `/pvprobo menu` or reconnect. Normal non-bot players should be moved to Adventure mode by the plugin.
- If a fight stays in loading, check `runs\worker_001\logs\duel-daemon.out.log`, `duel-daemon.err.log`, and `bot-controller.err.log`.
- If `bc` or `champion` is locked or fails to load, use `script_easy` and `script_hard` first. Model-backed difficulties need checkpoint paths in `runs\duel\duel-policies.json` that exist and pass preflight.

## Clean Up

Stop the daemon with `Ctrl+C`, then stop worker 1:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\stop-workers.ps1 -WorkerId 1
```
