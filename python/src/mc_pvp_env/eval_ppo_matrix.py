from __future__ import annotations

import argparse
import csv
import json
import time
from dataclasses import replace
from pathlib import Path
from typing import Any

from mc_pvp_env.config import EnvConfig
from mc_pvp_env.eval_ppo import evaluate_ppo_policy, _parse_curriculum_steps
from mc_pvp_env.runtime_policy import RUNTIME_PVP_POLICY_TYPES, normalize_runtime_pvp_policy_type


DEFAULT_OPPONENTS = "movement_only,weak_scripted,curriculum_scripted,controller_pvp"


def main() -> int:
    parser = argparse.ArgumentParser(description="Evaluate a PPO checkpoint against a fixed opponent matrix.")
    parser.add_argument("--policy", required=True, help="Path to PPO .zip checkpoint.")
    parser.add_argument("--config", required=True, help="Path to generated env config JSON.")
    parser.add_argument("--out-dir", required=True, help="Directory for matrix JSON/CSV output.")
    parser.add_argument("--episodes", type=int, default=50)
    parser.add_argument("--seed", type=int, default=123)
    parser.add_argument("--max-steps-per-episode", type=int, default=None)
    parser.add_argument("--target-hits", type=int, default=None)
    parser.add_argument("--opponents", default=DEFAULT_OPPONENTS)
    parser.add_argument("--policy-lineage", default="unspecified")
    parser.add_argument("--opponent-curriculum-steps", default="5000,15000")
    parser.add_argument("--stochastic", action="store_true", help="Sample actions instead of deterministic argmax.")
    args = parser.parse_args()

    config = EnvConfig.from_json(Path(args.config))
    if args.target_hits is not None:
        config = replace(config, target_hits=args.target_hits)

    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    opponents = _parse_opponents(args.opponents)
    curriculum_steps = _parse_curriculum_steps(args.opponent_curriculum_steps)

    rows: list[dict[str, Any]] = []
    started_at = time.strftime("%Y-%m-%dT%H:%M:%S%z")
    for index, opponent in enumerate(opponents):
        summary = evaluate_ppo_policy(
            args.policy,
            config,
            episodes=args.episodes,
            seed=args.seed + index,
            max_steps_per_episode=args.max_steps_per_episode,
            opponent_policy=opponent,
            opponent_curriculum_steps=curriculum_steps,
            deterministic=not args.stochastic,
        )
        summary = _apply_lineage_to_summary(
            summary,
            config=config,
            policy_lineage=args.policy_lineage,
            opponent_policy=opponent,
        )
        rows.append(summary)
        print(
            "eval_matrix "
            f"opponent={opponent} "
            f"win_rate={summary['win_rate']:.3f} "
            f"reward_mean={summary['reward_mean']:.6f} "
            f"self_hits_mean={summary['self_hits_mean']:.3f} "
            f"opponent_hits_mean={summary['opponent_hits_mean']:.3f}"
        )

    payload = {
        "policy": str(Path(args.policy)),
        "config": str(Path(args.config)),
        "episodes": args.episodes,
        "seed": args.seed,
        "target_hits": config.target_hits,
        "server_runtime": config.server_runtime,
        "minecraft_version": config.minecraft_version,
        "bot_backend": config.bot_backend,
        "policy_lineage": args.policy_lineage,
        "max_steps_per_episode": args.max_steps_per_episode,
        "opponents": opponents,
        "opponent_curriculum_steps": list(curriculum_steps),
        "stochastic": bool(args.stochastic),
        "started_at": started_at,
        "finished_at": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        "results": rows,
    }
    json_path = out_dir / "eval_matrix.json"
    csv_path = out_dir / "eval_matrix.csv"
    with json_path.open("w", encoding="utf-8") as handle:
        json.dump(payload, handle, indent=2, sort_keys=True)
    _write_csv(csv_path, rows)
    print("PVPRobo PPO eval matrix complete")
    print(f"json={json_path}")
    print(f"csv={csv_path}")
    return 0


def _parse_opponents(value: str) -> list[str]:
    allowed = {"neutral", "movement_only", "weak_scripted", "curriculum_scripted", "curriculum"} | RUNTIME_PVP_POLICY_TYPES
    opponents = [normalize_runtime_pvp_policy_type(item) for item in value.split(",") if item.strip()]
    if not opponents:
        raise ValueError("--opponents must contain at least one opponent policy")
    invalid = [item for item in opponents if item not in allowed]
    if invalid:
        raise ValueError(f"Unsupported opponent policies: {', '.join(invalid)}")
    return opponents


def _apply_lineage_to_summary(
    summary: dict[str, Any],
    *,
    config: EnvConfig,
    policy_lineage: str,
    opponent_policy: str,
) -> dict[str, Any]:
    enriched = dict(summary)
    enriched["policy_lineage"] = policy_lineage
    enriched["server_runtime"] = config.server_runtime
    enriched["minecraft_version"] = config.minecraft_version
    enriched["bot_backend"] = config.bot_backend
    enriched["opponent_policy"] = opponent_policy
    enriched["opponent_lineage"] = {
        "policy_type": opponent_policy,
        "bot_backend": config.bot_backend,
        "server_runtime": config.server_runtime,
        "minecraft_version": config.minecraft_version,
    }
    return enriched


def _write_csv(path: Path, rows: list[dict[str, Any]]) -> None:
    fields = [
        "policy",
        "policy_lineage",
        "opponent_policy",
        "opponent_lineage_json",
        "server_runtime",
        "minecraft_version",
        "bot_backend",
        "episodes",
        "win_rate",
        "loss_rate",
        "draw_rate",
        "reward_mean",
        "reward_std",
        "episode_length_mean",
        "episode_length_min",
        "episode_length_max",
        "self_hits_mean",
        "opponent_hits_mean",
        "episodes_per_sec",
        "elapsed_seconds",
        "phase_counts_json",
    ]
    with path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields)
        writer.writeheader()
        for row in rows:
            flat = {field: row.get(field, "") for field in fields}
            flat["opponent_lineage_json"] = json.dumps(row.get("opponent_lineage", {}), sort_keys=True)
            flat["phase_counts_json"] = json.dumps(row.get("phase_counts", {}), sort_keys=True)
            writer.writerow(flat)


if __name__ == "__main__":
    raise SystemExit(main())
