# Repository Split Classification

Date: 2026-07-07

This document classifies the current `PVPRobo` repository for a two-layer maintenance model:

- **Open-source core repository**: local, research/developer-facing MC PvP RL platform.
- **Private cloud-server repository**: operator-facing online experience server that consumes the open core and adds authenticated entry, deployment, private assets, operations, monitoring, and player-experience configuration.

The hard boundary is: **protocols, observations, actions, model formats, policy-pool manifests, and duel manifests stay in the open-source core.** Private cloud features must layer on top through private configuration, optional private plugin extensions, or private launcher/orchestration code. Do not fork the training protocol.

## Classification Labels

| Label | Meaning | Action for open-source prep |
| --- | --- | --- |
| `OPEN_CORE` | Belongs in the public repository. | Keep, document, and test as part of the public release. |
| `PRIVATE_CLOUD` | Belongs only in the private cloud-server repository. | Move or recreate privately; remove from the public repo. |
| `SPLIT_OR_SCRUB` | Concept belongs partly in public core, but current file includes private/local/operator state. | Split into public generic pieces plus private overlays, or scrub sensitive/local details before publishing. |
| `GENERATED_EXCLUDE` | Generated, downloaded, build, runtime, or model artifact. | Keep gitignored; do not publish in either source repository unless intentionally packaged elsewhere. |

## Must Stay Public

These contracts are shared by training, benchmarks, local duels, and the private cloud server. Future agents must not move them to the private layer or introduce private-only variants.

| Area | Public contract |
| --- | --- |
| Plugin protocol | Persistent localhost JSONL schema, request/response types, `status.duel`, `status.duels`, reset/start/observe/wait/done, duel helpers. |
| Bot protocol | Spawn/status/action/despawn messages and Mineflayer controller action application semantics. |
| Observations | Flat `np.float32` Gymnasium observation format and snapshot-to-vector flattening contract. |
| Actions | Low-level action vector and higher-level discrete/curriculum action encodings. |
| Model formats | BC `.pt`, PPO/SB3 `.zip`, evaluation result schema, training curve inputs, policy IDs. |
| Policy manifests | `runs\policy_pool\policy_pool.json` schema and tooling, but not private generated manifest contents. |
| Duel manifests | `runs\duel\duel-policies.json` schema and tooling, but not private generated manifest contents or real deployment paths. |
| Local benchmark paths | Random rollout, BC, PPO, eval matrix, league benchmark, and local player-duel smoke flows. |

## Top-Level Paths

| Path | Classification | Notes and required action |
| --- | --- | --- |
| `server-plugin/` | `SPLIT_OR_SCRUB` | Core Paper plugin belongs public for state extraction, arena reset, hit-count rules, local duel flow, protocol server, and tests. Player-facing operations such as production leaderboard behavior, signed skin handling, private venue defaults, and replay/arena asset operations should be reviewed and either made generic/optional or moved to private extension code. |
| `bot-controller/` | `OPEN_CORE` | Mineflayer headless controller is part of the public Route A stack. Keep protocol, config, action application, spawn/despawn, tests, and local scripted benchmark modes public. |
| `python/` | `OPEN_CORE` | Main Gymnasium env, protocol clients, action encoding, observation flattening, BC/PPO, benchmark, duel runner, manifests, policy pool, mocks, and tests belong public. Remove only private generated paths from examples/docs. |
| `scripts/` | `SPLIT_OR_SCRUB` | Training/build/setup scripts are public. Authenticated LAN/cloud deployment, private bundle, client ReplayMod helper, and operator-specific readiness checks should move private or become sanitized public examples. |
| `configs/` | `SPLIT_OR_SCRUB` | Default training configs are public. Private duel configs can remain only as sanitized examples if they contain no real domain, signed skin textures, private coordinates, or operator choices. |
| `docs/wiki/` | `SPLIT_OR_SCRUB` | Protocol, training, runbook, troubleshooting, and overview have public value. Duel-server docs contain private-player-server operations and should split into public local-duel docs plus private cloud ops docs. |
| `docs/agent/` | `PRIVATE_CLOUD` | Current handoff includes local pins, private worker state, live smoke results, policy paths, arena coordinates, and operator notes. Keep private; extract only stable public facts into public docs. |
| `docs/open-source/` | `OPEN_CORE` | New planning area for the split itself. This file can be committed publicly after any references to private details are acceptable. |
| `runs/` | `GENERATED_EXCLUDE` | Generated workers, worlds, manifests, models, demos, evals, replay snapshots, leaderboards, and runtime configs. Do not publish source. Intentionally released small checkpoints belong under `checkpoints/`, not under generated worker state. |
| `downloads/` | `GENERATED_EXCLUDE` | Downloaded Paper jars, portable Node, tools, schematics, mods, and other third-party artifacts. Do not commit. |
| `.venv/`, `node_modules/`, `dist/`, `build/`, `.gradle/`, caches | `GENERATED_EXCLUDE` | Keep ignored. |
| `docs.zip` | `GENERATED_EXCLUDE` | Untracked archive in current workspace. Do not include in the public split unless manually audited. |
| `.gitignore` | `OPEN_CORE` | Keep and expand if new private/generated locations are introduced. |
| `AGENTS.md` | `SPLIT_OR_SCRUB` | Useful public repo rules, but current baseline and local tool paths should move to private handoff or be generalized. |
| `README.md` | `SPLIT_OR_SCRUB` | Public README should describe research platform, setup, tests, and safety constraints. Current champion/private-duel status, real checkpoint paths, and authenticated worker commands need to move private or become generic examples. |

## Source File Groups

### Server Plugin

| Path group | Classification | Notes |
| --- | --- | --- |
| `server-plugin/build.gradle.kts`, `settings.gradle.kts`, `README.md` | `OPEN_CORE` | Public build metadata and plugin documentation after removing private-only run commands if present. |
| `server-plugin/src/main/resources/plugin.yml` | `OPEN_CORE` | Public plugin metadata. |
| `server-plugin/src/main/resources/config.yml` | `SPLIT_OR_SCRUB` | Keep core defaults public, but remove private-player-server defaults, signed texture values/signatures, real venue coordinates, and operator branding. Provide sanitized defaults plus a private overlay example. |
| `server-plugin/src/main/java/.../control/*` | `OPEN_CORE` | Protocol server and command handler are core contracts. Keep schema mirrored in docs/tests. |
| `server-plugin/src/main/java/.../thread/MainThreadBridge.java` | `OPEN_CORE` | Required Paper main-thread bridge for safe plugin operation. |
| `server-plugin/src/main/java/.../game/EpisodeState.java`, `EpisodeRegistry.java`, `SnapshotService.java`, `PvPEventListener.java`, `ArenaService.java` | `OPEN_CORE` | Core privileged observation, reset, arena, and episode mechanics. |
| `server-plugin/src/main/java/.../game/DuelService.java` | `SPLIT_OR_SCRUB` | Local player duel and AI battle are public. Production admission, private venue assumptions, and player-facing server policy should be separated or made configurable. |
| `server-plugin/src/main/java/.../game/LocalizedText.java` | `SPLIT_OR_SCRUB` | Generic localization support can be public. Private copy/branding belongs in private config. |
| `server-plugin/src/main/java/.../game/LeaderboardService.java` | `PRIVATE_CLOUD` | Operational leaderboard persistence/ranking is cloud-server functionality by default. If kept public, reduce it to a local optional example and move production leaderboard policy/private config out. |
| `server-plugin/src/main/java/.../game/SkinProfileService.java` | `PRIVATE_CLOUD` | Signed skins and player-facing appearance are private-server operations by default. Public core should not ship real texture values/signatures. |
| `server-plugin/src/main/java/.../game/ReplayService.java` | `SPLIT_OR_SCRUB` | Server-side scene snapshot can be a generic local debugging tool, but private replay assets and venue workflows belong private. |
| `server-plugin/src/main/java/.../command/PvPRoboCommand.java` | `SPLIT_OR_SCRUB` | Core admin/test commands can remain public. Player-facing menus, leaderboard commands, skin/replay/venue operations need review for public/private split. |
| `server-plugin/src/test/java/**` | `OPEN_CORE` | Keep protocol and game-rule tests public; add/adjust tests as code is split. |

### Bot Controller

| Path group | Classification | Notes |
| --- | --- | --- |
| `bot-controller/package.json`, `package-lock.json`, `tsconfig.json`, `README.md` | `OPEN_CORE` | Public Node/Mineflayer package. Keep Mineflayer version pin and setup docs. |
| `bot-controller/src/action.ts`, `config.ts`, `controller.ts`, `index.ts`, `jsonl.ts`, `mineflayerAdapter.ts` | `OPEN_CORE` | Public headless controller implementation. |
| `bot-controller/src/tests/**` | `OPEN_CORE` | Public tests for action/protocol/controller behavior. |
| `bot-controller/dist/`, `bot-controller/node_modules/` | `GENERATED_EXCLUDE` | Keep ignored. |

### Python Package

| Path group | Classification | Notes |
| --- | --- | --- |
| `python/pyproject.toml` | `OPEN_CORE` | Public package metadata. |
| `python/src/mc_pvp_env/actions.py`, `observations.py`, `protocol.py`, `env.py`, `vector_env.py`, `gym_compat.py`, `config.py` | `OPEN_CORE` | Primary public API and protocol contracts. |
| `python/src/mc_pvp_env/demo_writer.py`, `demo_dataset.py`, `collect_demos.py`, `expert.py`, `train_bc.py`, `train_ppo.py`, `training.py`, `ppo_warmstart.py` | `OPEN_CORE` | Public BC/PPO pipeline and local demonstration tooling. |
| `python/src/mc_pvp_env/eval_ppo.py`, `eval_ppo_matrix.py`, `eval_policy.py`, `eval_league.py`, `benchmark.py`, `plot_training_curves.py`, `opponent_pool.py`, `policy_pool.py`, `tui.py`, `random_rollout.py`, `mocks.py` | `OPEN_CORE` | Public benchmark/evaluation and testing support. |
| `python/src/mc_pvp_env/duel.py`, `duel_runner.py`, `duel_policy_manifest.py` | `OPEN_CORE` | Public local-player duel runner and duel manifest schema/tooling. Keep private manifest data out. |
| `python/tests/**` | `OPEN_CORE` | Public tests for protocol parsing, actions, observations, env mocks, manifests, BC/PPO support, and duel runner. |

## Scripts

| Script | Classification | Notes |
| --- | --- | --- |
| `scripts/build-plugin.ps1`, `build-all.ps1`, `setup-python-env.ps1`, `python-env.ps1` | `OPEN_CORE` | Public setup/build helpers. |
| `scripts/setup-worker.ps1`, `start-worker.ps1`, `stop-workers.ps1`, `start-bot-controller.ps1`, `run-random-rollout.ps1` | `OPEN_CORE` | Public local worker lifecycle, with explicit EULA handling preserved. |
| `scripts/collect-demos.ps1`, `train-bc.ps1`, `run-ppo-training.ps1`, `start-ppo-training.ps1`, `compare-ppo-warmstart.ps1` | `OPEN_CORE` | Public training entry points. |
| `scripts/eval-policy.ps1`, `eval-ppo-policy.ps1`, `eval-ppo-matrix.ps1`, `eval-league.ps1`, `benchmark-scaling.ps1`, `plot-training-curves.ps1` | `OPEN_CORE` | Public evaluation/benchmark tooling. |
| `scripts/register-policy.ps1`, `register-duel-policy.ps1` | `OPEN_CORE` | Public manifest tooling. Generated manifests stay private/generated. |
| `scripts/run-bc-duel.ps1`, `run-duel-policy.ps1`, `run-duel-daemon.ps1`, `start-duel-worker.ps1`, `start-lan-duel-server.ps1`, `test-lan-duel-access.ps1`, `test-bot-spawn.ps1` | `SPLIT_OR_SCRUB` | Public if framed as local/LAN playtesting. Remove real hostnames, private limits, and production assumptions. |
| `scripts/start-authenticated-lan-duel-server.ps1`, `test-authenticated-lan-access.ps1` | `PRIVATE_CLOUD` | Authenticated Velocity entry and private server admission belong private. If public docs mention Velocity, keep only abstract integration notes. |
| `scripts/prepare-private-duel-deployment.ps1`, `test-private-duel-bundle.ps1` | `PRIVATE_CLOUD` | Private deployment packaging and validation belong in the private cloud-server repo. |
| `scripts/prepare-duel-arena-assets.ps1` | `PRIVATE_CLOUD` | Map/schematic staging and venue assets are private unless replaced by generic sample asset handling. |
| `scripts/setup-replaymod-client.ps1` | `PRIVATE_CLOUD` | Client-side recording helper is outside Route A no-render core and belongs with private player-experience operations. |
| `scripts/test-duel-readiness.ps1`, `test-ai-battle-live.ps1` | `SPLIT_OR_SCRUB` | Keep a public local smoke variant. Move private champion readiness, real checkpoint validation, and live server checks private. |
| `scripts/README.md` | `SPLIT_OR_SCRUB` | Rewrite into public script index plus private operator script index. |

## Configs

| Config | Classification | Notes |
| --- | --- | --- |
| `configs/default-env.json`, `default-bot.json`, `default-server.json` | `OPEN_CORE` | Public local training defaults. |
| `configs/league-candidates.example.json` | `OPEN_CORE` | Public example if it contains no real private checkpoint paths. |
| `configs/private-duel-env.example.json`, `private-duel-bot.example.json` | `SPLIT_OR_SCRUB` | Can become sanitized local-duel examples in public; private cloud overrides move private. |
| `configs/private-duel-plugin.example.yml` | `SPLIT_OR_SCRUB` | Remove signed skin values/signatures, private domain/branding, real venue coordinates, and operations defaults before any public release. Keep only generic local-duel config if needed. |

## Docs

| Doc | Classification | Notes |
| --- | --- | --- |
| `docs/wiki/protocol.md` | `OPEN_CORE` | Public contract. Keep authoritative. |
| `docs/wiki/rl-training.md` | `SPLIT_OR_SCRUB` | Public training concepts and APIs stay. Move current champion path, private checkpoint lineage, and live metrics to private docs or public release notes only if intentionally published. |
| `docs/wiki/overview.md` | `SPLIT_OR_SCRUB` | Public architecture stays. Remove optional authenticated private-server wording or move it to private extension docs. |
| `docs/wiki/runbook.md` | `SPLIT_OR_SCRUB` | Public build/test/local training runbook stays. Private duel worker, authenticated LAN, ReplayMod, real checkpoint paths, and deployment bundle commands move private. |
| `docs/wiki/duel-server.md` | `PRIVATE_CLOUD` | Current document is mostly player-facing server operations by default: Velocity, Champion ROBO deployment, maps, skins, leaderboard, admission, replay, and multi-arena venue plan. Extract only public local-duel manifest/API pieces to public docs. |
| `docs/wiki/troubleshooting.md` | `SPLIT_OR_SCRUB` | Keep generic Windows/Java/Node/Python/Paper troubleshooting public. Move private network, authenticated entry, and deployment issues private. |
| `docs/agent/HANDOFF.md` | `PRIVATE_CLOUD` | Keep private; contains local state and operational decisions. Create a sanitized public `CONTRIBUTING` or `docs/agent/public-handoff-template.md` if needed. |
| `docs/README.md` | `SPLIT_OR_SCRUB` | Rewrite after docs are split so it indexes public docs only. |

## Data, Models, Assets, and Runtime State

| Path or artifact | Classification | Notes |
| --- | --- | --- |
| `runs\worker_000\demos\**` | `GENERATED_EXCLUDE` | Demonstration datasets are generated. Publish only selected samples through explicit dataset releases. |
| `runs\worker_000\bc\**` | `GENERATED_EXCLUDE` | BC checkpoints are generated model artifacts. |
| `runs\worker_000\training\**` | `GENERATED_EXCLUDE` | PPO checkpoints, monitor logs, plots, and eval outputs are generated. |
| `runs\policy_pool\policy_pool.json` | `GENERATED_EXCLUDE` contents, `OPEN_CORE` schema/tooling | Do not publish private generated policy pool. Keep schema and example public. |
| `runs\duel\duel-policies.json` | `GENERATED_EXCLUDE` contents, `OPEN_CORE` schema/tooling | Do not publish private generated duel manifest. Keep schema and example public. |
| `runs\worker_001\**` | `PRIVATE_CLOUD` / `GENERATED_EXCLUDE` | Private duel server world, configs, replays, leaderboards, staged assets, and runtime state. |
| `plugins\PVPRobo\leaderboard.yml` under any worker | `PRIVATE_CLOUD` / `GENERATED_EXCLUDE` | Player operation data. |
| `plugins\PVPRobo\replays\*.json` under any worker | `PRIVATE_CLOUD` / `GENERATED_EXCLUDE` | Player venue snapshots; do not publish by default. |
| Skin PNGs, signed texture values, texture signatures | `PRIVATE_CLOUD` | Private player-experience assets. Public examples must use placeholders only. |
| Schematics/maps such as `sumo_arena.schem`, `ancient_chinese_town.schem` | `PRIVATE_CLOUD` unless explicitly licensed | Treat as private map assets unless replaced by clearly licensed sample assets. |
| Downloaded Paper, Velocity, Node, Gradle, Fabric, ReplayMod jars/installers | `GENERATED_EXCLUDE` | Do not commit third-party binaries. Public scripts may download by version with explicit user action. |

## Recommended Public Repository Shape

```text
server-plugin/        Core Paper plugin: protocol, state, reset, local duel, tests
bot-controller/       Headless Mineflayer controller
python/               Gymnasium env, BC/PPO, evaluation, manifests, tests
scripts/              Public setup/build/train/eval/local-duel PowerShell tools
configs/              Safe local defaults and example manifests/configs
docs/                 Public architecture, protocol, training, runbook, troubleshooting
examples/             Optional sanitized example policy/duel manifests
```

Recommended private repository shape:

```text
private-cloud/
  configs/            Real Velocity/Paper/plugin/bot/player-experience overlays
  deployment/         Cloud or LAN deployment scripts, bundle assembly, secrets handling
  assets/             Maps, schematics, skins, resource packs, venue data
  ops/                Monitoring, backups, restart automation, domain/firewall notes
  docs/               Operator runbooks, handoffs, live smoke history, private pins
  manifests/          Private generated duel/policy manifests or templates
```

## Split Rules for Future Agents

1. Keep one canonical protocol in the public core. Private cloud code may add launchers or config, but must not define a different action, observation, or duel manifest schema.
2. Convert private settings into overlays. Public configs should be runnable locally with placeholders and safe defaults.
3. Remove real model paths from public docs unless the model artifact is intentionally released.
4. Do not publish generated worker worlds, replay snapshots, leaderboards, or private map/skin assets.
5. Preserve explicit Minecraft EULA handling in both repositories.
6. Preserve Windows PowerShell support in public core; private cloud scripts can add provider-specific automation on top.
7. When moving player-facing features out of the plugin, keep the public plugin extension points stable rather than copying and editing protocol handlers privately.
8. Any public smoke test must be local/offline and should not require authenticated public-server entry.

## Suggested Agent Work Packages

| Work package | Scope | Output |
| --- | --- | --- |
| Public docs scrub | Rewrite `README.md`, `docs/README.md`, `overview`, `runbook`, `rl-training`, and `troubleshooting` for public local core. | Public docs without private paths, live server state, or operator details. |
| Private docs extraction | Move `docs/agent/HANDOFF.md` and private sections of `duel-server.md`/`runbook.md` into the private repo. | Private operator docs preserving current cloud-server knowledge. |
| Config split | Produce sanitized public configs and private overlay configs. | No signed skin values, private domains, real coordinates, or generated manifest paths in public configs. |
| Script split | Separate public build/train/eval/local-duel scripts from authenticated/deployment/asset/replay helper scripts. | Public script index plus private cloud script set. |
| Plugin feature boundary | Review leaderboard, skin, replay, localized player menus, and duel service boundaries. | Public core plugin plus private extension or optional modules without protocol fork. |
| Manifest examples | Add public sample `policy_pool` and `duel-policies` manifests with fake/local paths. | Tests and docs can reference stable schemas without private artifacts. |
| Release hygiene | Expand ignores, scan for credentials/assets/binaries, and verify fresh clone setup. | Clean public repo candidate and private repo handoff checklist. |
