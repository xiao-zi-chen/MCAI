from __future__ import annotations

import argparse
import csv
import json
import time
from dataclasses import dataclass, replace
from pathlib import Path
from typing import Any

import numpy as np

from mc_pvp_env.actions import NEUTRAL_ACTION, curriculum_action_to_vector
from mc_pvp_env.config import EnvConfig
from mc_pvp_env.env import MinecraftPvpEnv
from mc_pvp_env.expert import make_opponent_policy
from mc_pvp_env.observations import flatten_snapshot
from mc_pvp_env.protocol import JsonlClient, PROTOCOL_VERSION


SUPPORTED_POLICY_TYPES = {"scripted", "ppo", "mineflayer_pvp"}


@dataclass(frozen=True)
class LeagueCandidate:
    policy_id: str
    policy_type: str
    checkpoint: str = ""
    scripted_policy: str = ""


class LeaguePolicy:
    def __init__(self, candidate: LeagueCandidate, *, seed: int = 0, deterministic: bool = True):
        self.candidate = candidate
        self.seed = int(seed)
        self.deterministic = bool(deterministic)
        self._scripted = None
        self._model = None
        if candidate.policy_type == "scripted":
            self._scripted = make_opponent_policy(candidate.scripted_policy or candidate.policy_id, seed=seed)
        elif candidate.policy_type == "ppo":
            try:
                from stable_baselines3 import PPO
            except ImportError as exc:
                raise RuntimeError("PPO league candidates require stable-baselines3; install python[sb3].") from exc
            self._model = PPO.load(candidate.checkpoint, device="cpu")
        elif candidate.policy_type != "mineflayer_pvp":
            raise ValueError(f"Unsupported league policy type: {candidate.policy_type}")

    def action_vector(
        self,
        snapshot: dict[str, Any],
        *,
        self_name: str,
        opponent_name: str,
        max_episode_ticks: int,
    ) -> np.ndarray:
        if self.candidate.policy_type == "mineflayer_pvp":
            return NEUTRAL_ACTION.copy()
        obs = flatten_snapshot(snapshot, self_name, opponent_name, max_episode_ticks)
        if self._model is not None:
            action, _state = self._model.predict(obs, deterministic=self.deterministic)
            return curriculum_action_to_vector(int(action))
        return self._scripted.action_vector(obs, snapshot)


def evaluate_league(
    manifest_path: str | Path,
    config: EnvConfig,
    *,
    episodes: int = 200,
    seed: int = 123,
    max_steps_per_episode: int | None = None,
    deterministic: bool = True,
    setup_stack: bool = True,
) -> dict[str, Any]:
    candidates = load_league_manifest(manifest_path)
    policies = {
        candidate.policy_id: LeaguePolicy(candidate, seed=seed + index, deterministic=deterministic)
        for index, candidate in enumerate(candidates)
    }
    setup_plugin = None
    setup_bot = None
    env = MinecraftPvpEnv(config=config, opponent_policy=None)
    try:
        if setup_stack:
            setup_plugin = JsonlClient(config.host, config.plugin_port, config.request_timeout_seconds, "plugin")
            setup_bot = JsonlClient(config.host, config.bot_port, config.request_timeout_seconds, "bot-controller")
            _request(setup_plugin, "hello", role="league-eval")
            _request(setup_plugin, "register_players", arena_id=config.arena, players=[config.self_name, config.opponent_name])
            _request(setup_bot, "hello", role="league-eval")
            _request(setup_bot, "spawn", bots=config.bot_specs())
            setup_plugin.close()
            setup_bot.close()
            setup_plugin = None
            setup_bot = None

        rng = np.random.default_rng(seed)
        rows: list[dict[str, Any]] = []
        elo = {candidate.policy_id: 1000.0 for candidate in candidates}
        for left_index, left in enumerate(candidates):
            for right in candidates[left_index + 1:]:
                for left_candidate, right_candidate in ((left, right), (right, left)):
                    if left_candidate.policy_type == "mineflayer_pvp":
                        rows.append(_skipped_matchup(left_candidate.policy_id, right_candidate.policy_id))
                        continue
                    rows.append(
                        _run_matchup(
                            env,
                            policies[left_candidate.policy_id],
                            policies[right_candidate.policy_id],
                            episodes=episodes,
                            rng=rng,
                            max_steps_per_episode=max_steps_per_episode,
                            elo=elo,
                        )
                    )

        rankings = [
            {"policy_id": policy_id, "elo": round(score, 3)}
            for policy_id, score in sorted(elo.items(), key=lambda item: item[1], reverse=True)
        ]
        return {
            "manifest": str(Path(manifest_path)),
            "config": str(Path(config.__dict__.get("_source", ""))) if "_source" in config.__dict__ else "",
            "episodes_per_direction": episodes,
            "seed": seed,
            "target_hits": config.target_hits,
            "deterministic": deterministic,
            "candidates": [candidate.__dict__ for candidate in candidates],
            "results": rows,
            "rankings": rankings,
            "finished_at": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
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


def load_league_manifest(path: str | Path) -> list[LeagueCandidate]:
    manifest_path = Path(path)
    with manifest_path.open("r", encoding="utf-8") as handle:
        payload = json.load(handle)
    entries = payload.get("candidates", payload if isinstance(payload, list) else [])
    if not isinstance(entries, list) or not entries:
        raise ValueError("league manifest must contain a non-empty candidates list")
    candidates: list[LeagueCandidate] = []
    seen: set[str] = set()
    for entry in entries:
        if not isinstance(entry, dict):
            raise ValueError("league candidate entries must be objects")
        policy_id = str(entry.get("id", entry.get("policy_id", ""))).strip()
        policy_type = str(entry.get("policy_type", "")).strip()
        if not policy_id:
            raise ValueError("league candidate missing id")
        if policy_id in seen:
            raise ValueError(f"duplicate league candidate id: {policy_id}")
        if policy_type not in SUPPORTED_POLICY_TYPES:
            raise ValueError(f"unsupported league policy_type for {policy_id}: {policy_type}")
        checkpoint = str(entry.get("checkpoint", "")).strip()
        if policy_type == "ppo" and not checkpoint:
            raise ValueError(f"PPO league candidate {policy_id} missing checkpoint")
        candidates.append(
            LeagueCandidate(
                policy_id=policy_id,
                policy_type=policy_type,
                checkpoint=checkpoint,
                scripted_policy=str(entry.get("scripted_policy", "")).strip(),
            )
        )
        seen.add(policy_id)
    return candidates


def write_league_outputs(out_dir: str | Path, payload: dict[str, Any]) -> tuple[Path, Path]:
    output_dir = Path(out_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    json_path = output_dir / "league_eval.json"
    csv_path = output_dir / "league_eval.csv"
    with json_path.open("w", encoding="utf-8") as handle:
        json.dump(payload, handle, indent=2, sort_keys=True)
    _write_csv(csv_path, payload.get("results", []))
    return json_path, csv_path


def _run_matchup(
    env: MinecraftPvpEnv,
    left_policy: LeaguePolicy,
    right_policy: LeaguePolicy,
    *,
    episodes: int,
    rng: np.random.Generator,
    max_steps_per_episode: int | None,
    elo: dict[str, float],
) -> dict[str, Any]:
    rewards: list[float] = []
    lengths: list[int] = []
    left_hits: list[int] = []
    right_hits: list[int] = []
    wins = losses = draws = timeouts = 0
    start_time = time.perf_counter()
    for _episode in range(episodes):
        obs, info = env.reset(seed=int(rng.integers(0, 2**31 - 1)))
        snapshot = info.get("snapshot", {})
        step_limit = max_steps_per_episode or env.config.max_episode_ticks
        reward_total = 0.0
        for step_index in range(step_limit):
            left_action = left_policy.action_vector(
                snapshot,
                self_name=env.config.self_name,
                opponent_name=env.config.opponent_name,
                max_episode_ticks=env.config.max_episode_ticks,
            )
            right_action = right_policy.action_vector(
                snapshot,
                self_name=env.config.opponent_name,
                opponent_name=env.config.self_name,
                max_episode_ticks=env.config.max_episode_ticks,
            )
            obs, reward, terminated, truncated, info = env.step_pair(left_action, right_action)
            reward_total += float(reward)
            snapshot = info.get("snapshot", {}) if isinstance(info.get("snapshot", {}), dict) else {}
            if terminated or truncated:
                lengths.append(step_index + 1)
                break
        else:
            lengths.append(step_limit)
        rewards.append(reward_total)
        hit_counts = snapshot.get("hit_counts", {}) if isinstance(snapshot, dict) else {}
        left_count = int(hit_counts.get(env.config.self_name, 0)) if isinstance(hit_counts, dict) else 0
        right_count = int(hit_counts.get(env.config.opponent_name, 0)) if isinstance(hit_counts, dict) else 0
        left_hits.append(left_count)
        right_hits.append(right_count)
        phase = str(snapshot.get("phase", "unknown"))
        if phase == "self_win":
            wins += 1
            score = 1.0
        elif phase == "opponent_win":
            losses += 1
            score = 0.0
        else:
            draws += 1
            score = 0.5
            if snapshot.get("done_reason") == "timeout" or int(snapshot.get("tick", 0)) >= env.config.max_episode_ticks:
                timeouts += 1
        _update_elo(elo, left_policy.candidate.policy_id, right_policy.candidate.policy_id, score)

    elapsed = time.perf_counter() - start_time
    return {
        "left_policy": left_policy.candidate.policy_id,
        "right_policy": right_policy.candidate.policy_id,
        "status": "completed",
        "episodes": episodes,
        "left_win_rate": wins / max(episodes, 1),
        "right_win_rate": losses / max(episodes, 1),
        "draw_rate": draws / max(episodes, 1),
        "timeout_rate": timeouts / max(episodes, 1),
        "hit_differential_mean": float(np.mean(np.asarray(left_hits) - np.asarray(right_hits))) if left_hits else 0.0,
        "left_hits_mean": float(np.mean(left_hits)) if left_hits else 0.0,
        "right_hits_mean": float(np.mean(right_hits)) if right_hits else 0.0,
        "reward_mean": float(np.mean(rewards)) if rewards else 0.0,
        "episode_length_mean": float(np.mean(lengths)) if lengths else 0.0,
        "episodes_per_sec": episodes / elapsed if elapsed > 0 else 0.0,
        "elapsed_seconds": elapsed,
    }


def _skipped_matchup(left_policy: str, right_policy: str) -> dict[str, Any]:
    return {
        "left_policy": left_policy,
        "right_policy": right_policy,
        "status": "skipped",
        "skip_reason": "mineflayer_pvp can only be evaluated as the scripted-role opponent in the current worker topology",
        "episodes": 0,
        "left_win_rate": 0.0,
        "right_win_rate": 0.0,
        "draw_rate": 0.0,
        "timeout_rate": 0.0,
        "hit_differential_mean": 0.0,
        "left_hits_mean": 0.0,
        "right_hits_mean": 0.0,
        "reward_mean": 0.0,
        "episode_length_mean": 0.0,
        "episodes_per_sec": 0.0,
        "elapsed_seconds": 0.0,
    }


def _update_elo(elo: dict[str, float], left_id: str, right_id: str, score: float, *, k: float = 32.0) -> None:
    left = elo[left_id]
    right = elo[right_id]
    expected_left = 1.0 / (1.0 + 10.0 ** ((right - left) / 400.0))
    delta = k * (score - expected_left)
    elo[left_id] = left + delta
    elo[right_id] = right - delta


def _write_csv(path: Path, rows: list[dict[str, Any]]) -> None:
    fields = [
        "left_policy",
        "right_policy",
        "status",
        "skip_reason",
        "episodes",
        "left_win_rate",
        "right_win_rate",
        "draw_rate",
        "timeout_rate",
        "hit_differential_mean",
        "left_hits_mean",
        "right_hits_mean",
        "reward_mean",
        "episode_length_mean",
        "episodes_per_sec",
        "elapsed_seconds",
    ]
    with path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields)
        writer.writeheader()
        for row in rows:
            writer.writerow({field: row.get(field, "") for field in fields})


def _request(client: JsonlClient, msg_type: str, **fields):
    message = {"v": PROTOCOL_VERSION, "id": f"league-{time.time_ns()}", "type": msg_type}
    message.update(fields)
    reply = client.request(message)
    if reply.get("type") == "error":
        raise RuntimeError(reply.get("error", "protocol error"))
    return reply


def main() -> int:
    parser = argparse.ArgumentParser(description="Evaluate a local PVPRobo policy league.")
    parser.add_argument("--manifest", required=True, help="JSON league manifest with candidates.")
    parser.add_argument("--config", required=True, help="Path to generated env config JSON.")
    parser.add_argument("--out-dir", required=True, help="Directory for JSON/CSV output.")
    parser.add_argument("--episodes", type=int, default=200)
    parser.add_argument("--seed", type=int, default=123)
    parser.add_argument("--max-steps-per-episode", type=int, default=None)
    parser.add_argument("--target-hits", type=int, default=None)
    parser.add_argument("--stochastic", action="store_true")
    args = parser.parse_args()

    config = EnvConfig.from_json(Path(args.config))
    if args.target_hits is not None:
        config = replace(config, target_hits=args.target_hits)
    payload = evaluate_league(
        args.manifest,
        config,
        episodes=args.episodes,
        seed=args.seed,
        max_steps_per_episode=args.max_steps_per_episode,
        deterministic=not args.stochastic,
    )
    json_path, csv_path = write_league_outputs(args.out_dir, payload)
    print("PVPRobo league eval complete")
    print(f"json={json_path}")
    print(f"csv={csv_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
