# Troubleshooting

## Java Or Gradle Not Found

Install Java 21 and Gradle 8.x, add them to `PATH`, or pass explicit paths:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\build-plugin.ps1 -JavaHome "<JDK 21 path>" -GradleHome "<Gradle path>"
```

## Node Or npm Not Found

Install Node.js 22.x, add it to `PATH`, or pass `-NodeHome "<Node path>"` to worker scripts. Install bot dependencies with:

```powershell
npm.cmd --prefix bot-controller install
```

## Python Environment Missing

Install `uv`, then run:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\setup-python-env.ps1
```

The project scripts expect `.venv\Scripts\python.exe`.

## Minecraft EULA Not Accepted

Worker startup will not silently accept the EULA. Either pass `-AcceptEula` after reading and accepting Mojang's EULA, or manually create:

```text
runs\worker_000\eula.txt
```

with:

```text
eula=true
```

## Ports Already In Use

Worker `N` uses:

- Minecraft server: `25565 + N`
- Plugin control: `25580 + 10 * N`
- Bot control: `25581 + 10 * N`

Stop a worker before restarting it:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\stop-workers.ps1 -WorkerId 0
```

## Paper Download Fails

`setup-worker.ps1` downloads Paper into `downloads\`. If the network is unavailable, place a compatible `paper-1.21.jar` in `downloads\` before running worker setup.

## Bot Login Or Protocol Errors

The default `mineflayer` backend serializes logins. Keep `spawn_login_throttle_ms` at the generated default unless you have a reason to tune it. Direct local Mineflayer workers should use `minecraft_version=auto`.

## Random Rollout Hangs

Check that all three ports for the worker are listening and inspect:

```text
runs\worker_000\logs\paper.out.log
runs\worker_000\logs\paper.err.log
runs\worker_000\logs\bot-controller.out.log
runs\worker_000\logs\bot-controller.err.log
```

Then stop and restart the scoped worker:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\stop-workers.ps1 -WorkerId 0
```

## Local Duel Notes

Local duel commands are for private playtesting on a server you control. Authenticated public entry, Velocity launchers, cloud deployment, production leaderboards, maps, skins, and monitoring are private extensions and are not part of this open core.

## Client Joined But Cannot Find The AI Battle

Use the end-to-end guide in [local-ai-battle.md](local-ai-battle.md) first.

Common fixes:

- Connect a Minecraft Java Edition `1.21` client to `127.0.0.1:25566` for worker 1.
- Keep `scripts\run-duel-daemon.ps1 -WorkerId 1` running in a second PowerShell window when using the in-game AI Battle menu.
- Use the Ender Eye or `/pvprobo menu` -> `Watch AI Battle`; then select two available difficulties. `script_easy` vs `script_hard` works without checkpoints.
- If you are OP and see admin behavior instead of the normal player menu, run `/pvprobo playtest on`.
- If you joined in Survival mode or away from the arena, run `/pvprobo menu` or reconnect. The plugin should teleport normal players to the lobby and use Spectator mode only while watching AI Battle.
- Model-backed difficulties such as `bc` or `champion` require the released or local checkpoint paths in `configs\duel-policies.example.json` to resolve.
