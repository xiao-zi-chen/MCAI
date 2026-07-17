# Scripts

Windows PowerShell entry points for the public local RL stack.

## Setup And Build

- `setup-python-env.ps1`: create `.venv` with `uv` and install the Python package.
- `python-env.ps1`: shared helper that resolves `.venv\Scripts\python.exe`.
- `build-plugin.ps1`: build the Paper plugin.
- `build-all.ps1`: build plugin, run bot-controller tests, and run Python tests.

## Worker Lifecycle

- `setup-worker.ps1`: prepare `runs\worker_NNN`, write configs, copy Paper/plugin jars, and write `eula=true` only with `-AcceptEula`.
- `start-worker.ps1`: start Paper `--nogui`, start the bot runtime controller, and optionally run a rollout.
- `start-bot-controller.ps1`: start only the bot controller for an existing worker config.
- `stop-workers.ps1`: stop generated worker processes.

## Rollout, Data, And Training

- `run-random-rollout.ps1`: run random actions against an existing worker.
- `collect-demos.ps1`: collect scripted demonstration datasets.
- `train-bc.ps1`: train a BC `.pt` policy from demonstrations.
- `run-ppo-training.ps1`: run PPO against an existing worker.
- `start-ppo-training.ps1`: start a worker and then run PPO.
- `compare-ppo-warmstart.ps1`: compare pure PPO and BC-warm-started PPO.

## Evaluation And Benchmark

- `eval-policy.ps1`: evaluate a policy through the generic evaluator.
- `eval-ppo-policy.ps1`: evaluate a PPO `.zip` checkpoint.
- `eval-ppo-matrix.ps1`: evaluate one PPO checkpoint against a fixed opponent matrix.
- `eval-league.ps1`: evaluate a manifest of scripted, PPO, and controller-side runtime benchmark policies.
- `benchmark-scaling.ps1`: restart a worker across arena counts and write throughput summaries.
- `plot-training-curves.ps1`: render reward and episode-length curves from SB3 monitor logs.

## Manifests And Local Duel

- `register-policy.ps1`: update `runs\policy_pool\policy_pool.json`.
- `register-duel-policy.ps1`: update `runs\duel\duel-policies.json`.
- `start-duel-worker.ps1`: start a local nonzero worker for private playtesting.
- `run-bc-duel.ps1`: run a direct BC checkpoint sidecar.
- `run-duel-policy.ps1`: run a registered duel difficulty sidecar.
- `run-duel-daemon.ps1`: keep the local duel sidecar running.
- `test-ai-battle-live.ps1`: start or use a nonzero local worker, load `configs\duel-policies.example.json`, and smoke-test AI-vs-AI with the released checkpoints.
- `test-bot-spawn.ps1`, `test-duel-readiness.ps1`, `test-lan-duel-access.ps1`: local smoke/readiness helpers only.

Cloud deployment, authenticated player entry, private bundles, ReplayMod client setup, map staging, skins, leaderboards, and monitoring scripts are intentionally excluded from the public core.
