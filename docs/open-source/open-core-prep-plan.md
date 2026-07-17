# Open-Core Preparation Plan

Date: 2026-07-07

## Goal

Historical plan for creating the standalone open-source repository without carrying private cloud-server operations, private assets, generated state, or local machine handoff data.

## Directory Strategy

The original staging approach used `open-core/` as a non-destructive public snapshot inside the private working repository. As of 2026-07-17, `PVPRobo-OpenSource` is the authoritative public repository and the old `PVPRobo-Server/open-core` snapshot is abandoned.

## Public Boundary

Keep these in the public candidate:

- Paper plugin core training/control protocol, privileged observations, arena reset, local duel protocol support, and tests.
- Headless bot runtime controller and tests, with Mineflayer as the default backend.
- Python Gymnasium environment, protocol clients, action/observation code, BC/PPO tooling, data collection, evaluation, benchmark, local duel runner, manifest tooling, mocks, and tests.
- Public default configs for local training, local bot control, local Paper worker setup, policy-pool examples, and duel manifest examples.
- Windows PowerShell scripts for setup, build, worker lifecycle, rollout, data collection, BC, PPO, evaluation, benchmark, policy registration, and local duel smoke paths.
- Public docs for clone-to-run setup, protocol, RL training, local duel, troubleshooting, and release hygiene.

Keep these out of the public candidate:

- Authenticated LAN/cloud-server entry, Velocity launchers, deployment bundles, private readiness checks, replay client setup, map/skin staging, monitoring/ops automation, and private player admission workflows.
- Real generated worker state, worlds, leaderboards, replay snapshots, model manifests, local checkpoint paths, and local smoke history.
- Signed skin texture values/signatures, private domains, real venue coordinates, private map/schematic assets, and operator-specific defaults.
- `docs/agent/HANDOFF.md` and any equivalent local/private future-agent notes.

## Work Packages

1. Commit this plan and use it as the authoritative open-source preparation checklist.
2. Create a public repository with public source directories and safe repository metadata.
3. Scrub public plugin defaults and worker setup scripts so cloned users get local training defaults, not private cloud-server defaults.
4. Split script indexes and docs so public users see build, setup, rollout, data collection, training, evaluation, and local duel commands only.
5. Add public example manifests/configs with fake local paths and document where intentionally released BC/PPO checkpoints can be placed.
6. Verify from the standalone public repository using cheap checks first: file inventory scan, Python unit tests where dependencies are present, Node tests/build where dependencies are present, and Gradle build where local Java/Gradle are configured.
7. Commit each finished work package separately.

## Reproduction Standard

A new user should be able to clone the public candidate, configure local tool paths, explicitly accept the Minecraft EULA if they choose, then run:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\setup-python-env.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\build-all.ps1 -JavaHome "<JDK 21 path>" -GradleHome "<Gradle path>"
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\start-worker.ps1 -WorkerId 0 -JavaHome "<JDK 21 path>" -GradleHome "<Gradle path>" -NodeHome "<Node path>" -AcceptEula -Steps 100
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\collect-demos.ps1 -WorkerId 0 -Episodes 5 -MaxStepsPerEpisode 40 -Out runs\worker_000\demos\smoke
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\train-bc.ps1 -Data runs\worker_000\demos\smoke -Out runs\worker_000\bc\smoke -Epochs 1
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\start-ppo-training.ps1 -WorkerId 0 -AcceptEula -TotalTimesteps 2000
```

Heavy downloads such as Paper, Python packages, Node packages, and Torch/SB3 should be documented clearly. Verification during this preparation may reuse already-installed local dependencies to avoid unnecessary network traffic.
