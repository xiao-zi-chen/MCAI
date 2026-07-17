from __future__ import annotations

import argparse
from collections import Counter
from dataclasses import replace
from pathlib import Path
from typing import Any
import time

import numpy as np

from mc_pvp_env.config import EnvConfig
from mc_pvp_env.env import MinecraftPvpEnv
from mc_pvp_env.expert import make_opponent_policy
from mc_pvp_env.protocol import JsonlClient, PROTOCOL_VERSION
from mc_pvp_env.runtime_policy import normalize_runtime_pvp_policy_type


def evaluate_ppo_policy(
    policy_path: str | Path,
    config: EnvConfig,
    *,
    episodes: int = 50,
    seed: int = 123,
    max_steps_per_episode: int | None = None,
    opponent_policy: str = "movement_only",
    opponent_curriculum_steps: tuple[int, int] = (5_000, 15_000),
    deterministic: bool = True,
    setup_stack: bool = True,
) -> dict[str, Any]:
    try:
        from stable_baselines3 import PPO
    except ImportError as exc:
        raise SystemExit("Missing stable-baselines3. Run through scripts\\eval-ppo-policy.ps1 or install python[sb3].") from exc

    model = PPO.load(str(policy_path), device="cpu")
    opponent = make_opponent_policy(
        opponent_policy,
        seed=seed,
        curriculum_steps=opponent_curriculum_steps,
    )
    env = MinecraftPvpEnv(config=config, opponent_policy=opponent)
    setup_plugin = None
    setup_bot = None
    rewards: list[float] = []
    lengths: list[int] = []
    self_hits: list[int] = []
    opponent_hits: list[int] = []
    phases: Counter[str] = Counter()
    start_time = time.perf_counter()

    try:
        if setup_stack:
            setup_plugin = JsonlClient(config.host, config.plugin_port, config.request_timeout_seconds, "plugin")
            setup_bot = JsonlClient(config.host, config.bot_port, config.request_timeout_seconds, "bot-controller")
            _request(setup_plugin, "hello", role="ppo-eval")
            _request(setup_plugin, "register_players", arena_id=config.arena, players=[config.self_name, config.opponent_name])
            _request(setup_bot, "hello", role="ppo-eval")
            _request(setup_bot, "spawn", bots=config.bot_specs())
            setup_plugin.close()
            setup_bot.close()
            setup_plugin = None
            setup_bot = None

        rng = np.random.default_rng(seed)
        for _episode in range(episodes):
            obs, _info = env.reset(seed=int(rng.integers(0, 2**31 - 1)))
            step_limit = max_steps_per_episode or config.max_episode_ticks
            episode_reward = 0.0
            final_snapshot: dict[str, Any] = {}
            for step_index in range(step_limit):
                action, _state = model.predict(obs, deterministic=deterministic)
                obs, reward, terminated, truncated, info = env.step(action)
                episode_reward += float(reward)
                final_snapshot = info.get("snapshot", {}) if isinstance(info.get("snapshot", {}), dict) else {}
                if terminated or truncated:
                    lengths.append(step_index + 1)
                    break
            else:
                lengths.append(step_limit)
            rewards.append(episode_reward)
            hit_counts = final_snapshot.get("hit_counts", {}) if isinstance(final_snapshot, dict) else {}
            if isinstance(hit_counts, dict):
                self_hits.append(int(hit_counts.get(config.self_name, 0)))
                opponent_hits.append(int(hit_counts.get(config.opponent_name, 0)))
            else:
                self_hits.append(0)
                opponent_hits.append(0)
            phases[str(final_snapshot.get("phase", "unknown"))] += 1

        elapsed = time.perf_counter() - start_time
        wins = phases.get("self_win", 0)
        losses = phases.get("opponent_win", 0)
        draws = phases.get("draw", 0)
        return {
            "policy": str(Path(policy_path)),
            "episodes": episodes,
            "opponent_policy": opponent_policy,
            "deterministic": deterministic,
            "elapsed_seconds": elapsed,
            "episodes_per_sec": episodes / elapsed if elapsed > 0 else 0.0,
            "win_rate": wins / max(episodes, 1),
            "loss_rate": losses / max(episodes, 1),
            "draw_rate": draws / max(episodes, 1),
            "reward_mean": float(np.mean(rewards)) if rewards else 0.0,
            "reward_std": float(np.std(rewards)) if rewards else 0.0,
            "episode_length_mean": float(np.mean(lengths)) if lengths else 0.0,
            "episode_length_min": int(np.min(lengths)) if lengths else 0,
            "episode_length_max": int(np.max(lengths)) if lengths else 0,
            "self_hits_mean": float(np.mean(self_hits)) if self_hits else 0.0,
            "opponent_hits_mean": float(np.mean(opponent_hits)) if opponent_hits else 0.0,
            "phase_counts": dict(sorted(phases.items())),
        }
    finally:
        try:
            _request(env.bot, "clear_controls")
            _request(env.plugin, "cleanup")
        except Exception:
            pass
        env.close()
        if setup_plugin is not None:
            setup_plugin.close()
        if setup_bot is not None:
            setup_bot.close()


def main() -> int:
    parser = argparse.ArgumentParser(description="Evaluate a PVPRobo PPO policy checkpoint.")
    parser.add_argument("--policy", required=True, help="Path to PPO .zip checkpoint.")
    parser.add_argument("--config", required=True, help="Path to generated env config JSON.")
    parser.add_argument("--episodes", type=int, default=50)
    parser.add_argument("--seed", type=int, default=123)
    parser.add_argument("--max-steps-per-episode", type=int, default=None)
    parser.add_argument("--target-hits", type=int, default=None)
    parser.add_argument(
        "--opponent-policy",
        default="movement_only",
        choices=("neutral", "movement_only", "weak_scripted", "curriculum_scripted", "curriculum", "controller_pvp", "herobot_pvp", "mineflayer_pvp"),
    )
    parser.add_argument("--opponent-curriculum-steps", default="5000,15000")
    parser.add_argument("--stochastic", action="store_true", help="Sample actions instead of using deterministic argmax.")
    args = parser.parse_args()

    config = EnvConfig.from_json(Path(args.config))
    if args.target_hits is not None:
        config = replace(config, target_hits=args.target_hits)
    summary = evaluate_ppo_policy(
        args.policy,
        config,
        episodes=args.episodes,
        seed=args.seed,
        max_steps_per_episode=args.max_steps_per_episode,
        opponent_policy=normalize_runtime_pvp_policy_type(args.opponent_policy),
        opponent_curriculum_steps=_parse_curriculum_steps(args.opponent_curriculum_steps),
        deterministic=not args.stochastic,
    )
    print("PVPRobo PPO eval summary")
    for key, value in summary.items():
        print(f"{key}={value}")
    return 0


def _request(client: JsonlClient, msg_type: str, **fields):
    message = {"v": PROTOCOL_VERSION, "id": f"ppo-eval-{time.time_ns()}", "type": msg_type}
    message.update(fields)
    reply = client.request(message)
    if reply.get("type") == "error":
        raise RuntimeError(reply.get("error", "protocol error"))
    return reply


def _parse_curriculum_steps(value: str) -> tuple[int, int]:
    parts = [part.strip() for part in value.split(",") if part.strip()]
    if len(parts) != 2:
        raise ValueError("opponent curriculum steps must contain two comma-separated integers")
    first, second = (int(parts[0]), int(parts[1]))
    if first < 0 or second < first:
        raise ValueError("opponent curriculum steps must be non-negative and sorted")
    return first, second


if __name__ == "__main__":
    raise SystemExit(main())
