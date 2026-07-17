# Open-Core Verification Log

## 2026-07-17 Standalone Repository Sync

Checks run against `C:\Project\GameAI\PVPRobo-OpenSource` after syncing the public HeRoBot backend slice and PvP hit-parity fixes:

- Bot controller: `npm.cmd test`, 18 tests passed.
- Python package: `PYTHONPATH=C:\Project\GameAI\PVPRobo-OpenSource\python\src .\.venv\Scripts\python.exe -m unittest discover -s python\tests`, 57 tests passed.
- Paper plugin: `D:\gradle-8.7\bin\gradle.bat -p server-plugin build`, build successful.
- Public boundary spot-check: `setup-worker.ps1` and `start-worker.ps1` only gained public `bot_backend` / `controller_pvp` wiring; private skin, monitoring, authenticated-entry, and deployment defaults were not copied from `PVPRobo-Server`.

`PVPRobo-OpenSource` is now the authoritative public repository. The old `PVPRobo-Server/open-core` snapshot is abandoned and should not be used for future public updates.

## 2026-07-07 Initial Candidate

Date: 2026-07-07

Checks run against this public repository candidate:

- Sensitive/local string scan: no source/config/runtime-doc leaks for real local paths, signed skin texture values, real private usernames, or generated model path names. Private asset names remain only in `docs/open-source/repository-split-classification.md` as examples of excluded private assets.
- Runtime-doc script reference check: every `scripts/*.ps1` referenced from `README.md`, `docs/README.md`, and `docs/wiki/*.md` exists under `scripts/`.
- Python tests: `PYTHONPATH=open-core\python\src .\.venv\Scripts\python.exe -m unittest discover -s open-core\python\tests`, 56 tests passed.
- Bot controller: `npm.cmd --prefix open-core\bot-controller install --offline`, then `npm.cmd --prefix open-core\bot-controller test`, 9 tests passed.
- Paper plugin: `D:\gradle-8.7\bin\gradle.bat -p open-core\server-plugin build`, build successful.
- Full local worker smoke: `open-core\scripts\start-worker.ps1 -WorkerId 7 -JavaHome 'C:\Program Files\Java\jdk-21.0.11' -GradleHome 'D:\gradle-8.7' -AcceptEula -Steps 100`, random rollout completed 100 steps and cleanup stopped the worker `node` and `java` processes.

The first worker smoke attempt exposed a Windows process-environment issue where inherited `Path`/`PATH` duplicates made `Start-Process` fail before Paper launch. `scripts/start-worker.ps1` now normalizes the process PATH before launching child processes.

Cloud/player-experience services were removed from the public plugin candidate after the initial smoke:

- Removed `LeaderboardService`, `SkinProfileService`, `ReplayService`, and `ReplayServiceTest`.
- Removed plugin registration for skin profiles and replay commands.
- Removed leaderboard/replay/skin config blocks from public defaults and generated worker configs.
- Removed WorldEdit/map paste commands from the public command surface.

After that split, `D:\gradle-8.7\bin\gradle.bat -p open-core\server-plugin build` succeeded, and the worker smoke completed another 100 random steps.

Data collection and BC smoke also completed from `open-core/`: worker 7 collected 1 episode with 8 transitions into `runs\worker_007\demos\smoke`, then `train-bc.ps1` completed 1 epoch and wrote `runs\worker_007\bc\smoke`.

PPO smoke completed from `open-core/`: `start-ppo-training.ps1` ran worker 7 for 16 PPO timesteps with `movement_only`, wrote `ppo_final.zip` under ignored `runs\worker_007\training\...`, and cleanup stopped the worker processes.

Verification produced ignored local artifacts under `bot-controller/node_modules/`, `bot-controller/dist/`, Python cache/egg-info paths, `server-plugin/build/`/`.gradle/`, `runs/`, `downloads/`, and `.venv`.

Before publishing, repeat the worker integration command from a clean standalone copy:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\start-worker.ps1 -WorkerId 0 -JavaHome "<JDK 21 path>" -GradleHome "<Gradle path>" -NodeHome "<Node path>" -AcceptEula -Steps 100
```

Run it once from a clean standalone copy before publishing the public repository.
