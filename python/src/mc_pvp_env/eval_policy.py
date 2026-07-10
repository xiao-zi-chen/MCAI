from __future__ import annotations

import argparse
from dataclasses import replace
from pathlib import Path
from typing import Any

import numpy as np

from mc_pvp_env.config import EnvConfig
from mc_pvp_env.env import MinecraftPvpEnv
from mc_pvp_env.expert import MovementOnlyTargetPolicy
from mc_pvp_env.protocol import JsonlClient, PROTOCOL_VERSION
from mc_pvp_env.train_bc import load_bc_policy, predict_action
import time


def evaluate_bc_policy(
    policy_path: str | Path,
    config: EnvConfig,
    *,
    episodes: int = 20,
    seed: int = 123,
    max_steps_per_episode: int | None = None,
    setup_stack: bool = True,
) -> dict[str, Any]:
    model, _policy_config = load_bc_policy(policy_path)
    target = MovementOnlyTargetPolicy(seed=seed)
    env = MinecraftPvpEnv(config=config)
    setup_plugin = None
    setup_bot = None
    rewards: list[float] = []
    lengths: list[int] = []
    self_hits: list[int] = []
    wins = 0
    invalid_actions = 0

    try:
        if setup_stack:
            setup_plugin = JsonlClient(config.host, config.plugin_port, config.request_timeout_seconds, "plugin")
            setup_bot = JsonlClient(config.host, config.bot_port, config.request_timeout_seconds, "bot-controller")
            _request(setup_plugin, "hello", role="bc-eval")
            _request(setup_plugin, "register_players", arena_id=config.arena, players=[config.self_name, config.opponent_name])
            _request(setup_bot, "hello", role="bc-eval")
            _request(setup_bot, "spawn", bots=config.bot_specs())
            setup_plugin.close()
            setup_bot.close()
            setup_plugin = None
            setup_bot = None

        rng = np.random.default_rng(seed)
        for _episode in range(episodes):
            obs, info = env.reset(seed=int(rng.integers(0, 2**31 - 1)))
            step_limit = max_steps_per_episode or config.max_episode_ticks
            episode_reward = 0.0
            final_snapshot: dict[str, Any] = {}
            for step_index in range(step_limit):
                snapshot = info.get("snapshot", {})
                action = predict_action(model, obs)
                if action < 0:
                    invalid_actions += 1
                    action = 0
                target_vector = target.action_vector(obs, snapshot if isinstance(snapshot, dict) else None)
                obs, reward, terminated, truncated, info = env.step_pair(action, target_vector)
                episode_reward += float(reward)
                final_snapshot = info.get("snapshot", {}) if isinstance(info.get("snapshot", {}), dict) else {}
                if terminated or truncated:
                    lengths.append(step_index + 1)
                    break
            else:
                lengths.append(step_limit)
            rewards.append(episode_reward)
            hit_counts = final_snapshot.get("hit_counts", {}) if isinstance(final_snapshot, dict) else {}
            self_hits.append(int(hit_counts.get(config.self_name, 0)) if isinstance(hit_counts, dict) else 0)
            if final_snapshot.get("phase") == "self_win":
                wins += 1

        return {
            "episodes": episodes,
            "reward_mean": float(np.mean(rewards)) if rewards else 0.0,
            "episode_length_mean": float(np.mean(lengths)) if lengths else 0.0,
            "self_hits_mean": float(np.mean(self_hits)) if self_hits else 0.0,
            "win_rate": wins / max(episodes, 1),
            "invalid_actions": invalid_actions,
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
    parser = argparse.ArgumentParser(description="Evaluate a PVPRobo BC policy against the movement-only target.")
    parser.add_argument("--policy", required=True, help="Path to bc_policy.pt.")
    parser.add_argument("--config", required=True, help="Path to generated env config JSON.")
    parser.add_argument("--episodes", type=int, default=20)
    parser.add_argument("--seed", type=int, default=123)
    parser.add_argument("--max-steps-per-episode", type=int, default=None)
    parser.add_argument("--target-hits", type=int, default=None)
    args = parser.parse_args()
    config = EnvConfig.from_json(Path(args.config))
    if args.target_hits is not None:
        config = replace(config, target_hits=args.target_hits)
    summary = evaluate_bc_policy(
        args.policy,
        config,
        episodes=args.episodes,
        seed=args.seed,
        max_steps_per_episode=args.max_steps_per_episode,
    )
    print("PVPRobo BC eval summary")
    for key, value in summary.items():
        print(f"{key}={value}")
    return 0


def _request(client: JsonlClient, msg_type: str, **fields):
    message = {"v": PROTOCOL_VERSION, "id": f"bc-eval-{time.time_ns()}", "type": msg_type}
    message.update(fields)
    reply = client.request(message)
    if reply.get("type") == "error":
        raise RuntimeError(reply.get("error", "protocol error"))
    return reply


if __name__ == "__main__":
    raise SystemExit(main())
