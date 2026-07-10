# Runbook

Run commands from the repository root in Windows PowerShell.

## 1. Prepare Python

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\setup-python-env.ps1
```

Optional package index mirror:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\setup-python-env.ps1 -IndexUrl https://pypi.tuna.tsinghua.edu.cn/simple
```

The scripts use `.venv\Scripts\python.exe`. They intentionally reject system Python for normal runs.

## 2. Install Node Dependencies

```powershell
npm.cmd --prefix bot-controller install
```

Mineflayer is pinned in `bot-controller/package-lock.json`.

## 3. Build And Test

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\build-all.ps1 -JavaHome "<JDK 21 path>" -GradleHome "<Gradle path>"
```

Individual checks:

```powershell
.\.venv\Scripts\python.exe -m unittest discover -s python\tests
npm.cmd --prefix bot-controller test
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\build-plugin.ps1 -JavaHome "<JDK 21 path>" -GradleHome "<Gradle path>"
```

If Java or Gradle is already on `PATH`, omit the matching parameter.

## 4. Start A Local Worker

The first local smoke starts Paper `--nogui`, starts the Mineflayer controller, and runs 100 random environment steps:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\start-worker.ps1 -WorkerId 0 -JavaHome "<JDK 21 path>" -GradleHome "<Gradle path>" -NodeHome "<Node path>" -AcceptEula -Steps 100
```

`-AcceptEula` writes `runs\worker_000\eula.txt` with `eula=true`. Pass it only if you agree to Mojang's Minecraft EULA. Without the flag, create the file manually after reading the EULA.

Start a worker and leave it running for collection/training:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\start-worker.ps1 -WorkerId 0 -AcceptEula -SkipRollout
```

Stop the worker:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\stop-workers.ps1 -WorkerId 0
```

## 5. Collect Demonstrations

With worker 0 running:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\collect-demos.ps1 -WorkerId 0 -Episodes 5 -Seed 123 -MaxStepsPerEpisode 40 -Out runs\worker_000\demos\smoke
```

For larger datasets, increase `-Episodes` and `-MaxStepsPerEpisode`, and keep the output under `runs\`.

## 6. Train Behavior Cloning

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\train-bc.ps1 -Data runs\worker_000\demos\smoke -Out runs\worker_000\bc\smoke -Epochs 1 -BatchSize 256 -HiddenSize 128 -Seed 123
```

Longer BC runs can write to `runs\worker_000\bc\<name>`. Publish selected checkpoints as release artifacts, not as source files.

## 7. Train PPO

Start worker and PPO together:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\start-ppo-training.ps1 -WorkerId 0 -AcceptEula -Rebuild -TotalTimesteps 2000 -Tui
```

Run PPO against an already-running worker:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\run-ppo-training.ps1 -WorkerId 0 -TotalTimesteps 20000 -CheckpointFreq 2000 -OpponentPolicy movement_only -Tui
```

BC warm-start:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\run-ppo-training.ps1 -WorkerId 0 -TotalTimesteps 20000 -CheckpointFreq 2000 -BcCheckpoint runs\worker_000\bc\smoke\bc_policy.pt -Tui
```

## 8. Evaluate And Benchmark

Evaluate a PPO checkpoint:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\eval-ppo-policy.ps1 -WorkerId 0 -Policy runs\worker_000\training\<run>\ppo_final.zip -Episodes 10 -OpponentPolicy movement_only -TargetHits 50
```

Run a fixed evaluation matrix:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\eval-ppo-matrix.ps1 -ManageWorker -WorkerId 0 -Policy runs\worker_000\training\<run>\ppo_final.zip -Episodes 10 -AcceptEula
```

Run a scaling benchmark:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\benchmark-scaling.ps1 -WorkerId 0 -AcceptEula -ArenaCounts 1,2,4 -Steps 100
```

## 9. Register Policies And Local Duel Difficulties

Register a policy-pool candidate:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\register-policy.ps1 -Command register -Id ppo_local_001 -Checkpoint runs\worker_000\training\<run>\ppo_final.zip -Role candidate
```

The public schema example is `configs\policy-pool.example.json`.

Register a local duel difficulty:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\register-duel-policy.ps1 -Command register -Difficulty bc -PolicyType bc -Checkpoint runs\worker_000\bc\smoke\bc_policy.pt
```

The public schema example is `configs\duel-policies.example.json`.

Run a local duel sidecar after a player starts a duel in the local worker:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\run-duel-policy.ps1 -WorkerId 1 -Difficulty bc -Player "<minecraftName>"
```

Local duel is for private playtesting on servers you control. Authenticated cloud entry and deployment automation are private extensions and are not part of the public core.
