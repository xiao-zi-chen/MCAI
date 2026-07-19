from __future__ import annotations

from dataclasses import asdict, is_dataclass
from pathlib import Path
from typing import Any
import json
import math
import subprocess

import numpy as np

from mc_pvp_env.actions import ACTION_FIELDS, NEUTRAL_ACTION
from mc_pvp_env.config import EnvConfig
from mc_pvp_env.observations import OBSERVATION_FIELDS, flatten_snapshot


DUEL_RECORD_SCHEMA_VERSION = 1

DUEL_STATE_FIELDS = (
    "hp",
    "max_hp",
    "pos_x",
    "pos_y",
    "pos_z",
    "vel_x",
    "vel_y",
    "vel_z",
    "yaw",
    "pitch",
    "attack_cooldown",
    "hurt_time",
    "on_ground",
    "line_of_sight",
    "sprinting",
    "sneaking",
    "selected_hotbar_slot",
    "food_level",
)

ACTION_SOURCES = ("policy", "scripted", "human_inferred", "raw_input", "unavailable")


class DuelRecordEpisodeBuffer:
    def __init__(
        self,
        episode_id: str,
        arena_id: str,
        *,
        actor_names: list[str],
        actor_roles: list[str],
        mode: str,
        difficulty: str,
        participants: list[dict[str, Any]] | None = None,
    ):
        if len(actor_names) != len(actor_roles):
            raise ValueError("actor_names and actor_roles must have the same length")
        if len(actor_names) < 2:
            raise ValueError("duel records require at least two actors")
        self.episode_id = episode_id
        self.arena_id = arena_id
        self.actor_names = list(actor_names)
        self.actor_roles = list(actor_roles)
        self.mode = mode
        self.difficulty = difficulty
        self.participants = participants or []
        self._rows: list[dict[str, Any]] = []
        self._sidecar_rows: list[dict[str, Any]] = []

    def append_step(
        self,
        *,
        pre_snapshot: dict[str, Any],
        post_snapshot: dict[str, Any],
        applied_actions: dict[str, Any] | None = None,
        action_ids: dict[str, int] | None = None,
        action_sources: dict[str, str] | None = None,
        raw_input: dict[str, Any] | None = None,
    ) -> None:
        applied_actions = applied_actions or {}
        action_ids = action_ids or {}
        action_sources = action_sources or {}
        raw_input = raw_input or {}

        obs_rows = []
        next_obs_rows = []
        state_rows = []
        action_rows = []
        action_id_rows = []
        source_rows = []
        reward_rows = []
        inferred_actions: dict[str, list[int]] = {}

        for actor in self.actor_names:
            opponent = self._opponent_for(actor)
            obs_rows.append(flatten_snapshot(pre_snapshot, actor, opponent))
            next_obs_rows.append(flatten_snapshot(post_snapshot, actor, opponent))
            state_rows.append(_player_state_vector(post_snapshot, actor))
            if actor in applied_actions:
                vector = _action_vector(applied_actions[actor])
            else:
                vector = infer_action_vector(pre_snapshot, post_snapshot, actor)
                inferred_actions[actor] = vector.astype(int).tolist()
            action_rows.append(vector)
            action_id_rows.append(int(action_ids.get(actor, -1)))
            source = str(action_sources.get(actor, "unavailable"))
            source_rows.append(source if source in ACTION_SOURCES else "unavailable")
            reward_rows.append(_actor_reward(post_snapshot, actor, opponent))

        phase = str(post_snapshot.get("phase", ""))
        tick = int(post_snapshot.get("tick", 0))
        terminated = phase in {"self_win", "opponent_win", "draw"}
        truncated = str(post_snapshot.get("done_reason", "")) == "timeout"
        self._rows.append({
            "tick": tick,
            "obs": np.stack(obs_rows).astype(np.float32),
            "next_obs": np.stack(next_obs_rows).astype(np.float32),
            "state": np.stack(state_rows).astype(np.float32),
            "action_vector": np.stack(action_rows).astype(np.int64),
            "action_id": np.asarray(action_id_rows, dtype=np.int64),
            "action_source": np.asarray(source_rows),
            "reward": np.asarray(reward_rows, dtype=np.float32),
            "terminated": bool(terminated),
            "truncated": bool(truncated),
        })
        self._sidecar_rows.append({
            "episode_id": self.episode_id,
            "arena_id": self.arena_id,
            "step_index": len(self._rows) - 1,
            "pre_tick": int(pre_snapshot.get("tick", 0)),
            "post_tick": tick,
            "mode": self.mode,
            "difficulty": self.difficulty,
            "participants": self.participants,
            "pre_snapshot": pre_snapshot,
            "post_snapshot": post_snapshot,
            "applied_actions": {key: _action_vector(value).astype(int).tolist() for key, value in applied_actions.items()},
            "inferred_actions": inferred_actions,
            "events": post_snapshot.get("events", []),
            "raw_input": raw_input or None,
        })

    def to_arrays(self) -> dict[str, np.ndarray]:
        if not self._rows:
            raise ValueError("cannot convert an empty duel record episode")
        return {
            "tick": np.asarray([row["tick"] for row in self._rows], dtype=np.int64),
            "actor_names": np.asarray(self.actor_names),
            "actor_roles": np.asarray(self.actor_roles),
            "obs": np.stack([row["obs"] for row in self._rows]).astype(np.float32),
            "next_obs": np.stack([row["next_obs"] for row in self._rows]).astype(np.float32),
            "state": np.stack([row["state"] for row in self._rows]).astype(np.float32),
            "action_vector": np.stack([row["action_vector"] for row in self._rows]).astype(np.int64),
            "action_id": np.stack([row["action_id"] for row in self._rows]).astype(np.int64),
            "action_source": np.stack([row["action_source"] for row in self._rows]),
            "reward": np.stack([row["reward"] for row in self._rows]).astype(np.float32),
            "terminated": np.asarray([row["terminated"] for row in self._rows], dtype=np.bool_),
            "truncated": np.asarray([row["truncated"] for row in self._rows], dtype=np.bool_),
            "arena_id": np.asarray([self.arena_id for _ in self._rows]),
            "episode_id": np.asarray([self.episode_id for _ in self._rows]),
        }

    def sidecar_rows(self) -> list[dict[str, Any]]:
        return list(self._sidecar_rows)

    def __len__(self) -> int:
        return len(self._rows)

    def _opponent_for(self, actor: str) -> str:
        for name in self.actor_names:
            if name != actor:
                return name
        raise ValueError(f"no opponent available for {actor}")


class DuelRecordWriter:
    def __init__(
        self,
        out_dir: str | Path,
        *,
        config: EnvConfig,
        record_source: str = "duel_runner",
    ):
        self.out_dir = Path(out_dir)
        self.out_dir.mkdir(parents=True, exist_ok=True)
        self.config = config
        self.record_source = record_source
        self.episodes: list[dict[str, Any]] = []

    def write_episode(self, buffer: DuelRecordEpisodeBuffer) -> Path:
        if len(buffer) == 0:
            raise ValueError("cannot write an empty duel record episode")
        npz_name = f"{buffer.episode_id}.npz"
        jsonl_name = f"{buffer.episode_id}.jsonl"
        npz_path = self.out_dir / npz_name
        jsonl_path = self.out_dir / jsonl_name
        np.savez_compressed(npz_path, **buffer.to_arrays())
        with jsonl_path.open("w", encoding="utf-8") as handle:
            for row in buffer.sidecar_rows():
                handle.write(json.dumps(row, ensure_ascii=False, sort_keys=True) + "\n")
        self.episodes.append({
            "episode_id": buffer.episode_id,
            "arena_id": buffer.arena_id,
            "mode": buffer.mode,
            "difficulty": buffer.difficulty,
            "npz_file": npz_name,
            "jsonl_file": jsonl_name,
            "steps": len(buffer),
            "actors": [{"name": name, "role": role} for name, role in zip(buffer.actor_names, buffer.actor_roles)],
        })
        self.write_manifest()
        return npz_path

    def write_manifest(self) -> Path:
        manifest = {
            "schema_version": DUEL_RECORD_SCHEMA_VERSION,
            "record_source": self.record_source,
            "observation_fields": list(OBSERVATION_FIELDS),
            "state_fields": list(DUEL_STATE_FIELDS),
            "action_fields": list(ACTION_FIELDS),
            "action_sources": list(ACTION_SOURCES),
            "env_config": _config_dict(self.config),
            "git_commit": _git_commit(),
            "episodes": self.episodes,
        }
        path = self.out_dir / "manifest.json"
        with path.open("w", encoding="utf-8") as handle:
            json.dump(manifest, handle, indent=2, sort_keys=True)
        return path


class DuelRecordDataset:
    def __init__(self, root: Path, manifest: dict[str, Any], episode_files: tuple[Path, ...]):
        self.root = root
        self.manifest = manifest
        self.episode_files = episode_files

    def load_episode(self, path: Path) -> dict[str, np.ndarray]:
        with np.load(path) as data:
            arrays = {key: data[key].copy() for key in data.files}
        _validate_episode_arrays(arrays, path)
        return arrays


def load_duel_record_dataset(path: str | Path) -> DuelRecordDataset:
    root = Path(path)
    manifest_path = root / "manifest.json"
    if not manifest_path.exists():
        raise FileNotFoundError(f"missing duel record manifest: {manifest_path}")
    with manifest_path.open("r", encoding="utf-8") as handle:
        manifest = json.load(handle)
    _validate_manifest(manifest)
    episode_files = tuple(root / episode["npz_file"] for episode in manifest.get("episodes", []))
    missing = [str(path) for path in episode_files if not path.exists()]
    if missing:
        raise FileNotFoundError(f"missing duel record episode files: {missing}")
    return DuelRecordDataset(root=root, manifest=manifest, episode_files=episode_files)


def infer_action_vector(pre_snapshot: dict[str, Any], post_snapshot: dict[str, Any], actor: str) -> np.ndarray:
    vector = NEUTRAL_ACTION.copy()
    pre = _player(pre_snapshot, actor)
    post = _player(post_snapshot, actor)
    if not pre or not post:
        return vector

    pre_pos = np.asarray(pre.get("pos", [0.0, 0.0, 0.0]), dtype=np.float32)
    post_pos = np.asarray(post.get("pos", [0.0, 0.0, 0.0]), dtype=np.float32)
    delta = post_pos - pre_pos
    yaw = math.radians(float(pre.get("yaw", 0.0)))
    forward = np.asarray([-math.sin(yaw), math.cos(yaw)], dtype=np.float32)
    right = np.asarray([math.cos(yaw), math.sin(yaw)], dtype=np.float32)
    planar = np.asarray([delta[0], delta[2]], dtype=np.float32)
    if float(np.linalg.norm(planar)) > 0.03:
        forward_amount = float(np.dot(planar, forward))
        right_amount = float(np.dot(planar, right))
        if forward_amount > 0.02:
            vector[0] = 1
        elif forward_amount < -0.02:
            vector[1] = 1
        if right_amount > 0.02:
            vector[3] = 1
        elif right_amount < -0.02:
            vector[2] = 1
    if delta[1] > 0.05 and bool(pre.get("on_ground", True)):
        vector[4] = 1
    vector[5] = 1 if bool(post.get("sprinting", False)) else 0
    vector[6] = 1 if bool(post.get("sneaking", False)) else 0
    if _actor_hit_event(post_snapshot.get("events", []), actor):
        vector[7] = 1
    vector[9] = max(0, min(8, int(post.get("selected_hotbar_slot", 0) or 0)))
    vector[10] = _yaw_bin(float(pre.get("yaw", 0.0)), float(post.get("yaw", 0.0)))
    vector[11] = _pitch_bin(float(pre.get("pitch", 0.0)), float(post.get("pitch", 0.0)))
    return vector.astype(np.int64)


def _validate_manifest(manifest: dict[str, Any]) -> None:
    if int(manifest.get("schema_version", -1)) != DUEL_RECORD_SCHEMA_VERSION:
        raise ValueError("incompatible duel record schema_version")
    if list(manifest.get("observation_fields", [])) != list(OBSERVATION_FIELDS):
        raise ValueError("incompatible duel record observation field order")
    if list(manifest.get("state_fields", [])) != list(DUEL_STATE_FIELDS):
        raise ValueError("incompatible duel record state field order")
    if list(manifest.get("action_fields", [])) != list(ACTION_FIELDS):
        raise ValueError("incompatible duel record action field order")


def _validate_episode_arrays(arrays: dict[str, np.ndarray], path: Path) -> None:
    required = {
        "tick",
        "actor_names",
        "actor_roles",
        "obs",
        "next_obs",
        "state",
        "action_vector",
        "action_id",
        "action_source",
        "reward",
        "terminated",
        "truncated",
        "arena_id",
        "episode_id",
    }
    missing = required.difference(arrays)
    if missing:
        raise ValueError(f"{path} missing arrays: {sorted(missing)}")
    steps = arrays["tick"].shape[0]
    actors = arrays["actor_names"].shape[0]
    if arrays["actor_roles"].shape != (actors,):
        raise ValueError(f"{path} has incompatible actor_roles shape")
    if arrays["obs"].shape != (steps, actors, len(OBSERVATION_FIELDS)):
        raise ValueError(f"{path} has incompatible obs shape")
    if arrays["next_obs"].shape != arrays["obs"].shape:
        raise ValueError(f"{path} has incompatible next_obs shape")
    if arrays["state"].shape != (steps, actors, len(DUEL_STATE_FIELDS)):
        raise ValueError(f"{path} has incompatible state shape")
    if arrays["action_vector"].shape != (steps, actors, len(ACTION_FIELDS)):
        raise ValueError(f"{path} has incompatible action_vector shape")
    for key in ("action_id", "action_source", "reward"):
        if arrays[key].shape != (steps, actors):
            raise ValueError(f"{path} has incompatible {key} shape")
    for key in ("terminated", "truncated", "arena_id", "episode_id"):
        if arrays[key].shape != (steps,):
            raise ValueError(f"{path} has incompatible {key} shape")


def _player(snapshot: dict[str, Any], name: str) -> dict[str, Any]:
    for player in snapshot.get("players", []):
        if isinstance(player, dict) and player.get("name") == name:
            return player
    return {}


def _player_state_vector(snapshot: dict[str, Any], name: str) -> np.ndarray:
    player = _player(snapshot, name)
    pos = list(player.get("pos", [0.0, 0.0, 0.0]))
    vel = list(player.get("vel", [0.0, 0.0, 0.0]))
    values = [
        float(player.get("hp", 0.0)),
        float(player.get("max_hp", 20.0)),
        float(pos[0]),
        float(pos[1]),
        float(pos[2]),
        float(vel[0]),
        float(vel[1]),
        float(vel[2]),
        float(player.get("yaw", 0.0)),
        float(player.get("pitch", 0.0)),
        float(player.get("attack_cooldown", 0.0)),
        float(player.get("hurt_time", 0.0)),
        1.0 if bool(player.get("on_ground", False)) else 0.0,
        1.0 if bool(player.get("line_of_sight", False)) else 0.0,
        1.0 if bool(player.get("sprinting", False)) else 0.0,
        1.0 if bool(player.get("sneaking", False)) else 0.0,
        float(player.get("selected_hotbar_slot", 0.0)),
        float(player.get("food_level", 20.0)),
    ]
    return np.asarray(values, dtype=np.float32)


def _action_vector(value: Any) -> np.ndarray:
    arr = np.asarray(value, dtype=np.int64)
    if arr.shape != NEUTRAL_ACTION.shape:
        return NEUTRAL_ACTION.copy()
    return arr


def _actor_reward(snapshot: dict[str, Any], actor: str, opponent: str) -> float:
    target_hits = max(float(snapshot.get("target_hits", 1)), 1.0)
    hit_deltas = snapshot.get("hit_deltas", {})
    if not isinstance(hit_deltas, dict):
        hit_deltas = {}
    reward = (float(hit_deltas.get(actor, 0)) - float(hit_deltas.get(opponent, 0))) / target_hits
    winner = str(snapshot.get("winner", ""))
    phase = str(snapshot.get("phase", ""))
    if winner == actor:
        reward += 1.0
    elif winner == opponent:
        reward -= 1.0
    elif phase == "draw":
        reward -= 0.25
    return float(reward)


def _actor_hit_event(events: Any, actor: str) -> bool:
    if not isinstance(events, list):
        return False
    prefix = f"hit:{actor}:"
    return any(isinstance(event, str) and event.startswith(prefix) for event in events)


def _yaw_bin(before: float, after: float) -> int:
    delta = ((after - before + 180.0) % 360.0) - 180.0
    if delta <= -30.0:
        return 0
    if delta <= -15.0:
        return 1
    if delta < -3.0:
        return 2
    if delta <= 3.0:
        return 3
    if delta < 15.0:
        return 4
    if delta < 30.0:
        return 5
    return 6


def _pitch_bin(before: float, after: float) -> int:
    delta = after - before
    if delta <= -15.0:
        return 0
    if delta < -3.0:
        return 1
    if delta <= 3.0:
        return 2
    if delta < 15.0:
        return 3
    return 4


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
