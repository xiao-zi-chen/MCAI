from __future__ import annotations

import argparse
import time
from pathlib import Path

import numpy as np

from mc_pvp_env.actions import ACTION_NVECS, CURRICULUM_ACTION_COUNT
from mc_pvp_env.config import EnvConfig
from mc_pvp_env.env import MinecraftPvpEnv
from mc_pvp_env.protocol import JsonlClient, PROTOCOL_VERSION


def main() -> int:
    parser = argparse.ArgumentParser(description="Run a random PVPRobo rollout.")
    parser.add_argument("--config", required=True, help="Path to generated env config JSON.")
    parser.add_argument("--steps", type=int, default=100)
    parser.add_argument("--seed", type=int, default=123)
    args = parser.parse_args()

    config = EnvConfig.from_json(Path(args.config))
    rng = np.random.default_rng(args.seed)

    setup_plugin = JsonlClient(config.host, config.plugin_port, config.request_timeout_seconds, "plugin")
    setup_bot = JsonlClient(config.host, config.bot_port, config.request_timeout_seconds, "bot-controller")
    envs = [
        MinecraftPvpEnv(config=config.for_arena(index))
        for index in range(max(1, config.arena_count))
    ]

    rewards: list[float] = []
    step_latencies: list[float] = []
    terminated = False
    truncated = False
    reset_latency = 0.0
    completed_steps = 0
    start_time = time.perf_counter()

    try:
        _request(setup_plugin, "hello", role="random-rollout")
        for index in range(max(1, config.arena_count)):
            arena_config = config.for_arena(index)
            _request(
                setup_plugin,
                "register_players",
                arena_id=arena_config.arena,
                players=[arena_config.self_name, arena_config.opponent_name],
            )
        _request(setup_bot, "hello", role="random-rollout")
        _request(setup_bot, "spawn", bots=config.bot_specs())

        reset_start = time.perf_counter()
        for index, env in enumerate(envs):
            _obs, _info = env.reset(seed=args.seed + index)
        reset_latency = time.perf_counter() - reset_start

        for step_index in range(args.steps):
            step_start = time.perf_counter()
            all_done = True
            for env in envs:
                if config.action_mode == "curriculum_discrete":
                    action = int(rng.integers(0, CURRICULUM_ACTION_COUNT))
                else:
                    action = np.array([rng.integers(0, high) for high in ACTION_NVECS], dtype=np.int64)
                _obs, reward, terminated, truncated, _info = env.step(action)
                rewards.append(float(reward))
                all_done = all_done and (terminated or truncated)
            step_latencies.append(time.perf_counter() - step_start)
            completed_steps = step_index + 1
            if all_done:
                break

        elapsed = time.perf_counter() - start_time
        avg_step_latency = float(np.mean(step_latencies)) if step_latencies else 0.0
        steps_per_sec = completed_steps / elapsed if elapsed > 0 else 0.0
        print("PVPRobo random rollout summary")
        print(f"arenas={len(envs)}")
        print(f"steps={completed_steps}")
        print(f"steps_per_sec={steps_per_sec:.3f}")
        print(f"reset_latency_ms={reset_latency * 1000.0:.3f}")
        print(f"avg_step_latency_ms={avg_step_latency * 1000.0:.3f}")
        print(f"reward_sum={sum(rewards):.6f}")
        print(f"reward_mean={(float(np.mean(rewards)) if rewards else 0.0):.6f}")
        print(f"terminated={terminated}")
        print(f"truncated={truncated}")
        return 0
    finally:
        try:
            _request(setup_bot, "clear_controls")
            _request(setup_plugin, "cleanup")
        except Exception:
            pass
        setup_plugin.close()
        setup_bot.close()
        for env in envs:
            env.close()


def _request(client: JsonlClient, msg_type: str, **fields):
    message = {"v": PROTOCOL_VERSION, "id": f"rollout-{time.time_ns()}", "type": msg_type}
    message.update(fields)
    reply = client.request(message)
    if reply.get("type") == "error":
        raise RuntimeError(reply.get("error", "protocol error"))
    return reply


if __name__ == "__main__":
    raise SystemExit(main())
