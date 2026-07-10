from __future__ import annotations

import argparse
import json
import time
from pathlib import Path
from typing import Any

from mc_pvp_env.config import EnvConfig
from mc_pvp_env.env import MinecraftPvpEnv
from mc_pvp_env.expert import make_opponent_policy
from mc_pvp_env.ppo_warmstart import (
    policy_kwargs_for_hidden_size,
    policy_kwargs_from_bc_checkpoint,
    warm_start_ppo_from_bc,
)
from mc_pvp_env.protocol import JsonlClient, PROTOCOL_VERSION


def main() -> int:
    parser = argparse.ArgumentParser(description="Train a PPO policy for PVPRobo.")
    parser.add_argument("--config", required=True, help="Path to generated env config JSON.")
    parser.add_argument("--total-timesteps", type=int, default=10_000)
    parser.add_argument("--seed", type=int, default=123)
    parser.add_argument("--run-dir", required=True, help="Directory for checkpoints and logs.")
    parser.add_argument("--checkpoint-freq", type=int, default=2_000)
    parser.add_argument("--learning-rate", type=float, default=3e-4)
    parser.add_argument("--clip-range", type=float, default=0.2)
    parser.add_argument("--ent-coef", type=float, default=0.0)
    parser.add_argument("--n-steps", type=int, default=256)
    parser.add_argument("--batch-size", type=int, default=64)
    parser.add_argument("--n-epochs", type=int, default=4)
    parser.add_argument("--device", default="auto")
    parser.add_argument("--bc-checkpoint", default=None, help="Optional bc_policy.pt checkpoint for PPO policy warm-start.")
    parser.add_argument("--resume-checkpoint", default=None, help="Optional PPO .zip checkpoint to resume training from.")
    parser.add_argument("--policy-hidden-size", type=int, default=None, help="Optional PPO MLP hidden size for pure PPO runs.")
    parser.add_argument(
        "--opponent-policy",
        default="neutral",
        choices=("neutral", "movement_only", "weak_scripted", "curriculum_scripted", "curriculum", "mineflayer_pvp", "policy_pool_sample"),
        help="Scripted opponent used by env.step during online PPO.",
    )
    parser.add_argument(
        "--opponent-curriculum-steps",
        default="5000,15000",
        help="Comma-separated step thresholds for movement_only->weak_scripted->curriculum_scripted.",
    )
    parser.add_argument("--policy-pool-manifest", default=None, help="Policy-pool manifest for --opponent-policy policy_pool_sample.")
    parser.add_argument(
        "--policy-pool-weights",
        default="0.5,0.3,0.2",
        help="Comma-separated anchor,champion,older sampling weights for policy_pool_sample.",
    )
    parser.add_argument("--tui", action="store_true", help="Show a Rich terminal monitor during training.")
    args = parser.parse_args()
    if args.resume_checkpoint and args.bc_checkpoint:
        raise ValueError("--resume-checkpoint and --bc-checkpoint are mutually exclusive; resumed PPO checkpoints already contain policy weights")

    try:
        from stable_baselines3 import PPO
        from stable_baselines3.common.callbacks import CheckpointCallback
        from stable_baselines3.common.monitor import Monitor
        from stable_baselines3.common.vec_env import VecMonitor
    except ImportError as exc:
        raise SystemExit(
            "Missing stable-baselines3. Run through scripts\\run-ppo-training.ps1 or install the python[sb3] extra."
        ) from exc

    config = EnvConfig.from_json(Path(args.config))
    run_dir = Path(args.run_dir)
    checkpoint_dir = run_dir / "checkpoints"
    monitor_dir = run_dir / "monitor"
    tensorboard_dir = run_dir / "tensorboard"
    checkpoint_dir.mkdir(parents=True, exist_ok=True)
    monitor_dir.mkdir(parents=True, exist_ok=True)
    tensorboard_dir.mkdir(parents=True, exist_ok=True)

    setup_plugin = JsonlClient(config.host, config.plugin_port, config.request_timeout_seconds, "plugin")
    setup_bot = JsonlClient(config.host, config.bot_port, config.request_timeout_seconds, "bot-controller")
    opponent_curriculum_steps = _parse_curriculum_steps(args.opponent_curriculum_steps)
    policy_pool_weights = _parse_policy_pool_weights(args.policy_pool_weights)
    if max(1, config.arena_count) > 1:
        from mc_pvp_env.vector_env import make_sb3_vec_env

        monitored_env = VecMonitor(
            make_sb3_vec_env(
                config,
                opponent_policy=args.opponent_policy,
                seed=args.seed,
                opponent_curriculum_steps=opponent_curriculum_steps,
                policy_pool_manifest=args.policy_pool_manifest,
                policy_pool_weights=policy_pool_weights,
            ),
            filename=str(monitor_dir / "monitor.csv"),
        )
    else:
        plugin = JsonlClient(config.host, config.plugin_port, config.request_timeout_seconds, "plugin")
        bot = JsonlClient(config.host, config.bot_port, config.request_timeout_seconds, "bot-controller")
        opponent = make_opponent_policy(
            args.opponent_policy,
            seed=args.seed,
            curriculum_steps=opponent_curriculum_steps,
            policy_pool_manifest=args.policy_pool_manifest,
            policy_pool_weights=policy_pool_weights,
        )
        env = MinecraftPvpEnv(config=config, plugin_client=plugin, bot_client=bot, opponent_policy=opponent)
        monitored_env = Monitor(env, filename=str(monitor_dir / "monitor.csv"))

    try:
        _request(setup_plugin, "hello", role="ppo-training")
        for index in range(max(1, config.arena_count)):
            arena_config = config.for_arena(index)
            _request(
                setup_plugin,
                "register_players",
                arena_id=arena_config.arena,
                players=[arena_config.self_name, arena_config.opponent_name],
            )
        _request(setup_bot, "hello", role="ppo-training")
        _request(setup_bot, "spawn", bots=config.bot_specs())

        callbacks: list[Any] = [CheckpointCallback(
            save_freq=max(1, args.checkpoint_freq),
            save_path=str(checkpoint_dir),
            name_prefix="ppo_pvprobo",
            save_replay_buffer=False,
            save_vecnormalize=False,
        )]
        if args.tui:
            from mc_pvp_env.tui import ArenaTuiCallback

            callbacks.append(ArenaTuiCallback(max(1, config.arena_count)).callback)
        if args.resume_checkpoint:
            model = PPO.load(
                str(args.resume_checkpoint),
                env=monitored_env,
                device=args.device,
                tensorboard_log=str(tensorboard_dir),
            )
        else:
            policy_kwargs: dict[str, Any] | None = None
            bc_config: dict[str, Any] | None = None
            if args.bc_checkpoint:
                policy_kwargs, bc_config = policy_kwargs_from_bc_checkpoint(args.bc_checkpoint)
                if args.policy_hidden_size is not None and int(args.policy_hidden_size) != int(bc_config["hidden_size"]):
                    raise ValueError("--policy-hidden-size must match the BC checkpoint hidden_size when warm-starting")
            elif args.policy_hidden_size is not None:
                policy_kwargs = policy_kwargs_for_hidden_size(args.policy_hidden_size)
            model = PPO(
                "MlpPolicy",
                monitored_env,
                learning_rate=args.learning_rate,
                clip_range=args.clip_range,
                ent_coef=args.ent_coef,
                n_steps=args.n_steps,
                batch_size=args.batch_size,
                n_epochs=args.n_epochs,
                seed=args.seed,
                verbose=1,
                tensorboard_log=str(tensorboard_dir),
                device=args.device,
                policy_kwargs=policy_kwargs,
            )
            if args.bc_checkpoint:
                metadata = warm_start_ppo_from_bc(model, args.bc_checkpoint)
                metadata_path = run_dir / "bc_warmstart.json"
                with metadata_path.open("w", encoding="utf-8") as handle:
                    json.dump(metadata, handle, indent=2, sort_keys=True)
        _write_training_config(run_dir, args, config, resumed=bool(args.resume_checkpoint))
        print("PVPRobo PPO training start")
        print(f"total_timesteps={args.total_timesteps}")
        print(f"run_dir={run_dir}")
        if args.bc_checkpoint:
            print(f"bc_checkpoint={args.bc_checkpoint}")
        if args.resume_checkpoint:
            print(f"resume_checkpoint={args.resume_checkpoint}")
        print(f"opponent_policy={args.opponent_policy}")
        model.learn(
            total_timesteps=args.total_timesteps,
            callback=callbacks,
            tb_log_name="ppo",
            reset_num_timesteps=not bool(args.resume_checkpoint),
        )
        final_model = run_dir / "ppo_final.zip"
        model.save(final_model)
        print("PVPRobo PPO training complete")
        print(f"final_model={final_model}")
        return 0
    finally:
        try:
            _request(setup_bot, "clear_controls")
            _request(setup_plugin, "cleanup")
        except Exception:
            pass
        setup_plugin.close()
        setup_bot.close()
        monitored_env.close()


def _request(client: JsonlClient, msg_type: str, **fields: Any) -> dict[str, Any]:
    message = {"v": PROTOCOL_VERSION, "id": f"train-{time.time_ns()}", "type": msg_type}
    message.update(fields)
    reply = client.request(message)
    if reply.get("type") == "error":
        raise RuntimeError(reply.get("error", "protocol error"))
    return reply


def _parse_curriculum_steps(value: str) -> tuple[int, int]:
    parts = [part.strip() for part in value.split(",") if part.strip()]
    if len(parts) != 2:
        raise ValueError("--opponent-curriculum-steps must contain two comma-separated integers")
    first, second = (int(parts[0]), int(parts[1]))
    if first < 0 or second < first:
        raise ValueError("--opponent-curriculum-steps must be non-negative and sorted")
    return first, second


def _parse_policy_pool_weights(value: str) -> tuple[float, float, float]:
    parts = [part.strip() for part in value.split(",") if part.strip()]
    if len(parts) != 3:
        raise ValueError("--policy-pool-weights must contain three comma-separated numbers")
    weights = (float(parts[0]), float(parts[1]), float(parts[2]))
    if any(item < 0 for item in weights) or sum(weights) <= 0.0:
        raise ValueError("--policy-pool-weights must be non-negative and have positive sum")
    return weights


def _write_training_config(run_dir: Path, args: argparse.Namespace, config: EnvConfig, *, resumed: bool) -> None:
    payload = {
        "config": str(Path(args.config)),
        "run_dir": str(run_dir),
        "total_timesteps": args.total_timesteps,
        "seed": args.seed,
        "checkpoint_freq": args.checkpoint_freq,
        "learning_rate": args.learning_rate,
        "clip_range": args.clip_range,
        "ent_coef": args.ent_coef,
        "n_steps": args.n_steps,
        "batch_size": args.batch_size,
        "n_epochs": args.n_epochs,
        "device": args.device,
        "bc_checkpoint": args.bc_checkpoint,
        "resume_checkpoint": args.resume_checkpoint,
        "resumed": resumed,
        "resume_uses_saved_ppo_hyperparams": resumed,
        "policy_hidden_size": args.policy_hidden_size,
        "opponent_policy": args.opponent_policy,
        "opponent_curriculum_steps": args.opponent_curriculum_steps,
        "policy_pool_manifest": args.policy_pool_manifest,
        "policy_pool_weights": args.policy_pool_weights,
        "arena_count": config.arena_count,
        "target_hits": config.target_hits,
        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
    }
    with (run_dir / "training_config.json").open("w", encoding="utf-8") as handle:
        json.dump(payload, handle, indent=2, sort_keys=True)


if __name__ == "__main__":
    raise SystemExit(main())
