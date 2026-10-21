"""Measure released CPU policies and verify mock transport; no Minecraft combat."""
from __future__ import annotations

import argparse
from collections import Counter
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import platform
import sys
import time

import numpy as np
import torch
from stable_baselines3 import PPO

from mc_pvp_env.actions import CURRICULUM_ACTION_COUNT
from mc_pvp_env.config import EnvConfig
from mc_pvp_env.env import MinecraftPvpEnv
from mc_pvp_env.mocks import MockBotController, MockPluginServer, make_snapshot
from mc_pvp_env.observations import OBSERVATION_FIELDS, flatten_snapshot
from mc_pvp_env.train_bc import load_bc_policy, predict_action


def measure(predict, observations, iterations):
    for index in range(100):
        predict(observations[index % len(observations)])
    timings = []
    actions = Counter()
    cpu_start = time.process_time()
    with torch.inference_mode():
        for index in range(iterations):
            start = time.perf_counter_ns()
            action = int(predict(observations[index % len(observations)]))
            timings.append((time.perf_counter_ns() - start) / 1_000_000)
            if not 0 <= action < CURRICULUM_ACTION_COUNT:
                raise ValueError(f"Invalid action: {action}")
            actions[action] += 1
    return {
        "iterations": iterations,
        "mean_ms": float(np.mean(timings)),
        "median_ms": float(np.median(timings)),
        "p95_ms": float(np.percentile(timings, 95)),
        "process_cpu_seconds": time.process_time() - cpu_start,
        "action_counts": dict(actions),
    }


def mock_smoke(steps):
    plugin = MockPluginServer()
    bot = MockBotController()
    env = MinecraftPvpEnv(EnvConfig(plugin_port=plugin.port, bot_port=bot.port))
    try:
        obs, _ = env.reset(seed=123)
        env.action_space.seed(123)
        for index in range(steps):
            obs, reward, terminated, truncated, info = env.step(env.action_space.sample())
            assert obs.shape == (len(OBSERVATION_FIELDS),)
            assert obs.dtype == np.float32 and np.isfinite(obs).all()
            assert np.isfinite(reward) and info["bot_status"]["accepted"]
            if terminated or truncated:
                obs, _ = env.reset(seed=124 + index)
        assert len(bot.actions) == steps
        return {"passed": True, "random_steps": steps, "real_minecraft": False}
    finally:
        env.close()
        plugin.close()
        bot.close()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--iterations", type=int, default=2000)
    parser.add_argument("--mock-steps", type=int, default=100)
    parser.add_argument("--threads", type=int, default=1)
    parser.add_argument("--output", type=Path, default=Path("runs/local-probe.json"))
    args = parser.parse_args()
    if min(args.iterations, args.mock_steps, args.threads) < 1:
        parser.error("All numeric options must be positive")
    torch.set_num_threads(args.threads)
    torch.set_num_interop_threads(1)
    root = Path(__file__).resolve().parents[1]
    observations = []
    for index in range(64):
        snapshot = make_snapshot(index % 10)
        snapshot["players"][1]["pos"][0] = 0.5 + index / 8
        snapshot["players"][0]["attack_cooldown"] = (index % 11) / 10
        observations.append(flatten_snapshot(snapshot))
    bc_path = root / "checkpoints/bc_open_baseline/bc_policy.pt"
    ppo_path = root / "checkpoints/champion_robo/ppo_final.zip"
    bc, bc_config = load_bc_policy(bc_path)
    ppo = PPO.load(str(ppo_path), device="cpu")
    bc_result = measure(lambda obs: predict_action(bc, obs), observations, args.iterations)
    ppo_result = measure(lambda obs: ppo.predict(obs, deterministic=True)[0], observations, args.iterations)
    for result, path, module in [(bc_result, bc_path, bc), (ppo_result, ppo_path, ppo.policy)]:
        result.update({
            "checkpoint": str(path.relative_to(root)),
            "checkpoint_sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
            "parameters_total": sum(p.numel() for p in module.parameters()),
        })
    bc_result["hidden_size"] = bc_config["hidden_size"]
    # These released MLP policies have parameter-free feature extractors.
    ppo_result["actor_parameters"] = sum(
        p.numel() for name, p in ppo.policy.named_parameters()
        if name.startswith(("mlp_extractor.policy_net.", "action_net.", "pi_features_extractor."))
    )
    result = {
        "timestamp_utc": datetime.now(timezone.utc).isoformat(),
        "scope": "CPU inference on synthetic observations and mock protocol only; no live combat or server TPS measurement",
        "python": platform.python_version(),
        "torch": torch.__version__,
        "processor": platform.processor(),
        "device": "cpu",
        "torch_threads": args.threads,
        "observation_features": len(OBSERVATION_FIELDS),
        "action_count": CURRICULUM_ACTION_COUNT,
        "bc": bc_result,
        "champion_ppo": ppo_result,
        "mock_transport": mock_smoke(args.mock_steps),
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(result, ensure_ascii=False, indent=2))
    print(f"Report: {args.output.resolve()}")


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    main()
