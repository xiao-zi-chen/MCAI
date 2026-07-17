# Overview

PVPRobo Open Core is a Windows-first, no-render Minecraft PvP reinforcement-learning platform for local research servers.

## Architecture

```text
Python Gymnasium env
  <persistent JSONL TCP>
Paper plugin control server
  <Minecraft server state/control>
PaperMC --nogui

Python scripts / bot runtime controller
  <persistent JSONL TCP>
Mineflayer headless bots by default; HeRoBot command backend is reserved for Fabric workers
  <Minecraft protocol>
PaperMC --nogui
```

The hot loop uses persistent localhost connections. It does not use HTTP per step, does not write to disk per step, and does not require a graphical Minecraft client.

## Public Repository Layout

```text
server-plugin/        Paper plugin: protocol, state extraction, resets, local duel hooks, tests
bot-controller/       Headless bot runtime controller and tests
python/               Gymnasium env, protocols, BC/PPO, evaluation, benchmarks, manifests, tests
scripts/              Windows PowerShell setup/build/run/train/eval tools
configs/              Public local defaults and example manifests
docs/                 Public setup, protocol, training, and troubleshooting docs
runs/                 Generated local state, gitignored
downloads/            Downloaded third-party artifacts, gitignored
```

## Public Contracts

These stay in the open core and must not fork in private extensions:

- Plugin JSONL protocol.
- Bot-controller JSONL protocol.
- Flat `np.float32` observation format.
- Integer action encodings.
- BC/PPO model loading conventions.
- Policy-pool and duel manifest schemas.

## Private Extension Boundary

Authenticated player entry, cloud deployment, real maps, skins, signed texture values, leaderboard operations, monitoring, deployment bundles, and live server handoffs belong in a private repository. The private layer should consume this core through configs, optional plugin extensions, launchers, and released model files without changing the training protocol.

## Version Expectations

- Minecraft/Paper: `1.21`
- Paper API dependency: `1.21-R0.1-SNAPSHOT`
- Java: 21
- Gradle: 8.x
- Node: 22.x
- Bot backend: `mineflayer` by default
- Mineflayer: `4.37.1`
- Python: 3.12

Direct local Mineflayer workers use `minecraft_version=auto` by default in generated worker configs unless overridden. The `herobot` backend is available as a command-transport adapter slice for future Fabric/HeRoBot workers; do not compare `herobot_pvp` and `controller_pvp` results as the same backend lineage.
