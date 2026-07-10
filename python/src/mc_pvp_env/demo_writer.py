from __future__ import annotations

from dataclasses import asdict, is_dataclass
from pathlib import Path
from typing import Any
import json
import subprocess

import numpy as np

from mc_pvp_env.actions import CURRICULUM_ACTIONS, CURRICULUM_ACTION_COUNT
from mc_pvp_env.config import EnvConfig
from mc_pvp_env.observations import OBSERVATION_FIELDS


DEMO_SCHEMA_VERSION = 1


class DemoEpisodeBuffer:
    def __init__(self, episode_id: str, arena_id: str):
        self.episode_id = episode_id
        self.arena_id = arena_id
        self._rows: list[dict[str, Any]] = []

    def append(
        self,
        *,
        obs,
        action: int,
        action_vector,
        next_obs,
        reward: float,
        terminated: bool,
        truncated: bool,
        tick: int,
    ) -> None:
        self._rows.append({
            "obs": np.asarray(obs, dtype=np.float32),
            "action": int(action),
            "action_vector": np.asarray(action_vector, dtype=np.int64),
            "next_obs": np.asarray(next_obs, dtype=np.float32),
            "reward": float(reward),
            "terminated": bool(terminated),
            "truncated": bool(truncated),
            "tick": int(tick),
        })

    def to_arrays(self) -> dict[str, np.ndarray]:
        rows = self._rows
        return {
            "obs": np.stack([row["obs"] for row in rows]).astype(np.float32),
            "action": np.asarray([row["action"] for row in rows], dtype=np.int64),
            "action_vector": np.stack([row["action_vector"] for row in rows]).astype(np.int64),
            "next_obs": np.stack([row["next_obs"] for row in rows]).astype(np.float32),
            "reward": np.asarray([row["reward"] for row in rows], dtype=np.float32),
            "terminated": np.asarray([row["terminated"] for row in rows], dtype=np.bool_),
            "truncated": np.asarray([row["truncated"] for row in rows], dtype=np.bool_),
            "tick": np.asarray([row["tick"] for row in rows], dtype=np.int64),
            "arena_id": np.asarray([self.arena_id for _ in rows]),
            "episode_id": np.asarray([self.episode_id for _ in rows]),
        }

    def __len__(self) -> int:
        return len(self._rows)


class DemoWriter:
    def __init__(
        self,
        out_dir: str | Path,
        *,
        config: EnvConfig,
        seed: int,
        expert_policy: Any,
        target_policy: Any,
    ):
        self.out_dir = Path(out_dir)
        self.out_dir.mkdir(parents=True, exist_ok=True)
        self.config = config
        self.seed = int(seed)
        self.expert_policy = expert_policy
        self.target_policy = target_policy
        self.episodes: list[dict[str, Any]] = []

    def write_episode(self, buffer: DemoEpisodeBuffer) -> Path:
        if len(buffer) == 0:
            raise ValueError("cannot write an empty demonstration episode")
        filename = f"{buffer.episode_id}.npz"
        path = self.out_dir / filename
        np.savez_compressed(path, **buffer.to_arrays())
        self.episodes.append({"episode_id": buffer.episode_id, "arena_id": buffer.arena_id, "file": filename, "steps": len(buffer)})
        self.write_manifest()
        return path

    def write_manifest(self) -> Path:
        manifest = {
            "schema_version": DEMO_SCHEMA_VERSION,
            "action_mode": self.config.action_mode,
            "observation_fields": list(OBSERVATION_FIELDS),
            "action_names": list(CURRICULUM_ACTIONS),
            "action_count": CURRICULUM_ACTION_COUNT,
            "expert_policy_name": getattr(self.expert_policy, "name", type(self.expert_policy).__name__),
            "expert_policy_version": getattr(self.expert_policy, "version", ""),
            "target_policy_name": getattr(self.target_policy, "name", type(self.target_policy).__name__),
            "target_policy_version": getattr(self.target_policy, "version", ""),
            "env_config": _config_dict(self.config),
            "seed": self.seed,
            "git_commit": _git_commit(),
            "episodes": self.episodes,
        }
        path = self.out_dir / "manifest.json"
        with path.open("w", encoding="utf-8") as handle:
            json.dump(manifest, handle, indent=2, sort_keys=True)
        return path


def _config_dict(config: EnvConfig) -> dict[str, Any]:
    if is_dataclass(config):
        return asdict(config)
    return dict(config)


def _git_commit() -> str | None:
    try:
        result = subprocess.run(
            ["git", "rev-parse", "HEAD"],
            check=True,
            capture_output=True,
            text=True,
            timeout=2.0,
        )
    except Exception:
        return None
    return result.stdout.strip() or None
