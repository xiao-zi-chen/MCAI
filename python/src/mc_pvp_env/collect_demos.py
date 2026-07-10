from __future__ import annotations

import argparse
from dataclasses import replace
import time
from pathlib import Path
from typing import Any

import numpy as np

from mc_pvp_env.actions import CURRICULUM_ACTION_COUNT, curriculum_action_to_vector
from mc_pvp_env.config import EnvConfig
from mc_pvp_env.demo_writer import DemoEpisodeBuffer, DemoWriter
from mc_pvp_env.env import MinecraftPvpEnv
from mc_pvp_env.expert import HeuristicExpertPolicy, MovementOnlyTargetPolicy
from mc_pvp_env.protocol import JsonlClient, PROTOCOL_VERSION


def collect_demonstrations(
    config: EnvConfig,
    out_dir: str | Path,
    *,
    episodes: int | None = None,
    target_transitions: int | None = None,
    seed: int = 123,
    max_steps_per_episode: int | None = None,
    progress_every_episodes: int = 25,
    setup_stack: bool = True,
) -> dict[str, Any]:
    if config.action_mode != "curriculum_discrete":
        raise ValueError("demonstration collection v1 requires action_mode='curriculum_discrete'")
    if episodes is None and target_transitions is None:
        raise ValueError("provide episodes or target_transitions")
    if episodes is not None and episodes <= 0:
        raise ValueError("episodes must be positive when provided")
    if target_transitions is not None and target_transitions <= 0:
        raise ValueError("target_transitions must be positive when provided")

    setup_plugin = None
    setup_bot = None
    env = MinecraftPvpEnv(config=config)
    expert = HeuristicExpertPolicy(config.self_name, config.opponent_name, seed=seed)
    target = MovementOnlyTargetPolicy(seed=seed)
    writer = DemoWriter(out_dir, config=config, seed=seed, expert_policy=expert, target_policy=target)
    rng = np.random.default_rng(seed)
    episode_lengths: list[int] = []
    rewards: list[float] = []
    action_hist = np.zeros(CURRICULUM_ACTION_COUNT, dtype=np.int64)
    start_time = time.perf_counter()

    try:
        if setup_stack:
            setup_plugin = JsonlClient(config.host, config.plugin_port, config.request_timeout_seconds, "plugin")
            setup_bot = JsonlClient(config.host, config.bot_port, config.request_timeout_seconds, "bot-controller")
            _request(setup_plugin, "hello", role="demo-collector")
            _request(setup_plugin, "register_players", arena_id=config.arena, players=[config.self_name, config.opponent_name])
            _request(setup_bot, "hello", role="demo-collector")
            _request(setup_bot, "spawn", bots=config.bot_specs())
            setup_plugin.close()
            setup_bot.close()
            setup_plugin = None
            setup_bot = None

        episode_index = 0
        total_transitions = 0
        while True:
            if episodes is not None and episode_index >= episodes:
                break
            if target_transitions is not None and total_transitions >= target_transitions:
                break
            episode_seed = int(rng.integers(0, 2**31 - 1))
            obs, info = env.reset(seed=episode_seed)
            episode_id = str(info["episode_id"])
            buffer = DemoEpisodeBuffer(episode_id, config.arena)
            terminated = False
            truncated = False
            step_limit = max_steps_per_episode or config.max_episode_ticks

            for _ in range(step_limit):
                snapshot = info.get("snapshot", {})
                tick = int(snapshot.get("tick", 0)) if isinstance(snapshot, dict) else 0
                action = expert.action(obs, snapshot if isinstance(snapshot, dict) else None)
                target_vector = target.action_vector(obs, snapshot if isinstance(snapshot, dict) else None)
                next_obs, reward, terminated, truncated, step_info = env.step_pair(action, target_vector)
                action_vector = curriculum_action_to_vector(action)
                buffer.append(
                    obs=obs,
                    action=action,
                    action_vector=action_vector,
                    next_obs=next_obs,
                    reward=reward,
                    terminated=terminated,
                    truncated=truncated,
                    tick=tick,
                )
                action_hist[action] += 1
                rewards.append(float(reward))
                obs = next_obs
                info = step_info
                if terminated or truncated:
                    break

            writer.write_episode(buffer)
            episode_lengths.append(len(buffer))
            total_transitions += len(buffer)
            episode_index += 1
            if progress_every_episodes > 0 and episode_index % progress_every_episodes == 0:
                elapsed = time.perf_counter() - start_time
                rate = total_transitions / elapsed if elapsed > 0 else 0.0
                print(
                    "progress "
                    f"episodes={episode_index} "
                    f"transitions={total_transitions} "
                    f"steps_per_sec={rate:.3f}",
                    flush=True,
                )

        elapsed = time.perf_counter() - start_time
        summary = {
            "episodes": len(episode_lengths),
            "transitions": int(sum(episode_lengths)),
            "target_transitions": int(target_transitions or 0),
            "steps_per_sec": float(sum(episode_lengths) / elapsed) if elapsed > 0 else 0.0,
            "reward_mean": float(np.mean(rewards)) if rewards else 0.0,
            "episode_length_mean": float(np.mean(episode_lengths)) if episode_lengths else 0.0,
            "episode_length_min": int(np.min(episode_lengths)) if episode_lengths else 0,
            "episode_length_max": int(np.max(episode_lengths)) if episode_lengths else 0,
            "action_histogram": action_hist.astype(int).tolist(),
            "out_dir": str(Path(out_dir)),
        }
        return summary
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
    parser = argparse.ArgumentParser(description="Collect action-labeled PVPRobo expert demonstrations.")
    parser.add_argument("--config", required=True, help="Path to generated env config JSON.")
    parser.add_argument("--episodes", type=int, default=None)
    parser.add_argument("--target-transitions", type=int, default=None)
    parser.add_argument("--out", required=True, help="Output dataset directory.")
    parser.add_argument("--seed", type=int, default=123)
    parser.add_argument("--max-steps-per-episode", type=int, default=None)
    parser.add_argument("--progress-every-episodes", type=int, default=25)
    parser.add_argument("--target-hits", type=int, default=None, help="Override EnvConfig.target_hits for longer demo episodes.")
    args = parser.parse_args()

    config = EnvConfig.from_json(Path(args.config))
    if args.target_hits is not None:
        config = replace(config, target_hits=args.target_hits)
    summary = collect_demonstrations(
        config,
        args.out,
        episodes=args.episodes,
        target_transitions=args.target_transitions,
        seed=args.seed,
        max_steps_per_episode=args.max_steps_per_episode,
        progress_every_episodes=args.progress_every_episodes,
    )
    print("PVPRobo demo collection summary")
    for key, value in summary.items():
        print(f"{key}={value}")
    return 0


def _request(client: JsonlClient, msg_type: str, **fields):
    message = {"v": PROTOCOL_VERSION, "id": f"demo-{time.time_ns()}", "type": msg_type}
    message.update(fields)
    reply = client.request(message)
    if reply.get("type") == "error":
        raise RuntimeError(reply.get("error", "protocol error"))
    return reply


if __name__ == "__main__":
    raise SystemExit(main())
