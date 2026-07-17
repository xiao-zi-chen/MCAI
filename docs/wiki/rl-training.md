# RL Training

PVPRobo starts with structured privileged observations and high-level discrete actions. Visual observations and graphical Minecraft clients are out of scope for the open core.

## Observation Contract

The primary Gymnasium environment returns flat `np.float32` vectors. Rich snapshots are reserved for `info`, debugging, tooling, and tests.

Core observation code lives in:

- `python/src/mc_pvp_env/observations.py`
- `python/tests/test_observations.py`

Keep the flattening contract stable. Private cloud extensions must not introduce a different observation schema.

## Action Contract

The primary action API uses integer actions. Encoders live in:

- `python/src/mc_pvp_env/actions.py`
- `python/tests/test_actions.py`

Supported scripted/opponent policy names include `neutral`, `movement_only`, `weak_scripted`, `curriculum_scripted`, `curriculum`, `mineflayer_pvp`, and `policy_pool_sample`.

## Demonstration Collection

Collect demonstrations through the Python sidecar against a running worker:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\collect-demos.ps1 -WorkerId 0 -Episodes 5 -Seed 123 -MaxStepsPerEpisode 40 -Out runs\worker_000\demos\smoke
```

Datasets are generated artifacts. Keep them under `runs\` unless publishing an intentional dataset release.

## Behavior Cloning

Train BC from a demonstration directory:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\train-bc.ps1 -Data runs\worker_000\demos\smoke -Out runs\worker_000\bc\smoke -Epochs 1 -BatchSize 256 -HiddenSize 128 -Seed 123
```

BC checkpoints use `.pt` files. The released quick-start BC checkpoint is `checkpoints\bc_open_baseline\bc_policy.pt`; generated local checkpoints should stay under `runs\`.

## PPO

Short PPO smoke:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\start-ppo-training.ps1 -WorkerId 0 -AcceptEula -Rebuild -TotalTimesteps 2000 -Tui
```

Longer PPO against an existing worker:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\run-ppo-training.ps1 -WorkerId 0 -TotalTimesteps 20000 -CheckpointFreq 2000 -OpponentPolicy movement_only -Tui
```

BC warm-start:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\run-ppo-training.ps1 -WorkerId 0 -TotalTimesteps 20000 -CheckpointFreq 2000 -BcCheckpoint runs\worker_000\bc\smoke\bc_policy.pt -Tui
```

PPO checkpoints use Stable-Baselines3 `.zip` files.

## Evaluation

Evaluate a single checkpoint:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\eval-ppo-policy.ps1 -WorkerId 0 -Policy runs\worker_000\training\<run>\ppo_final.zip -Episodes 10 -OpponentPolicy movement_only -TargetHits 50
```

Run a matrix:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\eval-ppo-matrix.ps1 -ManageWorker -WorkerId 0 -Policy runs\worker_000\training\<run>\ppo_final.zip -Episodes 10 -AcceptEula
```

Plot curves from SB3 monitor logs:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\plot-training-curves.ps1 -RunDir runs\worker_000\training\<run>
```

## Policy Pool And Duel Manifests

Policy-pool schema/tooling is public:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\register-policy.ps1 -Command register -Id ppo_local_001 -Checkpoint runs\worker_000\training\<run>\ppo_final.zip -Role candidate
```

Duel manifest schema/tooling is public:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\register-duel-policy.ps1 -Command register -Difficulty bc -PolicyType bc -Checkpoint runs\worker_000\bc\smoke\bc_policy.pt
```

The `champion` role/difficulty is part of the public manifest vocabulary. The released Champion ROBO checkpoint is `checkpoints\champion_robo\ppo_final.zip`.

Public schema examples:

- `configs\policy-pool.example.json`
- `configs\duel-policies.example.json`
- `configs\league-candidates.example.json`

Quick local checks:

```powershell
.\.venv\Scripts\python.exe -m mc_pvp_env.duel_policy_manifest --manifest configs\duel-policies.example.json preflight --difficulty bc
.\.venv\Scripts\python.exe -m mc_pvp_env.duel_policy_manifest --manifest configs\duel-policies.example.json preflight --difficulty champion
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\test-ai-battle-live.ps1 -WorkerId 1 -StartWorker -AcceptEula -LeftDifficulty champion -RightDifficulty bc
```
