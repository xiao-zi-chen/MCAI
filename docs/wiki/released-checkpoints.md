# Released Checkpoints

Run commands from the repository root in Windows PowerShell.

PVPRobo includes two intentionally released model checkpoints so a fresh clone can test policy loading and local duels without training first.

```text
checkpoints/bc_open_baseline/bc_policy.pt
checkpoints/champion_robo/ppo_final.zip
```

The duel manifest maps these checkpoints to public difficulty names:

```text
configs/duel-policies.example.json
```

The policy-pool example identifies the promoted PPO checkpoint:

```text
configs/policy-pool.example.json
```

## Preflight Model Loading

Create the Python environment first:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\setup-python-env.ps1
```

Then load each released policy and run one dummy action prediction:

```powershell
.\.venv\Scripts\python.exe -m mc_pvp_env.duel_policy_manifest `
  --manifest configs\duel-policies.example.json preflight --difficulty bc

.\.venv\Scripts\python.exe -m mc_pvp_env.duel_policy_manifest `
  --manifest configs\duel-policies.example.json preflight --difficulty champion
```

Both commands print the resolved checkpoint path, observation size, and sampled action.

## Watch AI vs AI

Install Node dependencies and build before the first live smoke:

```powershell
npm.cmd --prefix bot-controller install

powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\build-all.ps1 `
  -JavaHome "<JDK 21 path>" `
  -GradleHome "<Gradle path>"
```

Start a nonzero duel worker, launch the duel daemon, trigger an AI battle, and verify that temporary bots connect and despawn:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\test-ai-battle-live.ps1 `
  -WorkerId 1 `
  -StartWorker `
  -AcceptEula `
  -LeftDifficulty champion `
  -RightDifficulty bc `
  -TargetHits 2 `
  -JavaHome "<JDK 21 path>" `
  -GradleHome "<Gradle path>" `
  -NodeHome "<Node path>"
```

`-AcceptEula` writes `runs\worker_001\eula.txt` only when explicitly passed. Use it only if you agree to Mojang's Minecraft EULA.

After the smoke:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\stop-workers.ps1 -WorkerId 1
```

## Player vs Champion ROBO

Start a duel worker and keep it running:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\start-duel-worker.ps1 `
  -WorkerId 1 `
  -AcceptEula `
  -JavaHome "<JDK 21 path>" `
  -GradleHome "<Gradle path>" `
  -NodeHome "<Node path>"
```

Start the policy daemon in another PowerShell window:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\run-duel-daemon.ps1 `
  -WorkerId 1 `
  -Manifest configs\duel-policies.example.json
```

Join the local server at `127.0.0.1:25566`, then use the `/pvprobo menu` item flow or:

```text
/pvprobo duel start champion
```

The daemon reads the `champion` entry from `configs\duel-policies.example.json`, loads `checkpoints/champion_robo/ppo_final.zip`, and applies actions through the headless bot runtime controller.

## Notes

- Use these checkpoints only on private local/offline servers you control.
- The BC file is a PyTorch behavior-cloning policy. The champion file is a Stable-Baselines3 PPO checkpoint.
- New training outputs still belong under `runs\` and remain gitignored unless intentionally promoted.
