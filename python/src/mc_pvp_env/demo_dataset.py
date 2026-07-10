from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any
import json

import numpy as np

from mc_pvp_env.actions import CURRICULUM_ACTION_COUNT
from mc_pvp_env.demo_writer import DEMO_SCHEMA_VERSION
from mc_pvp_env.observations import OBSERVATION_FIELDS


@dataclass(frozen=True)
class DemoDataset:
    root: Path
    manifest: dict[str, Any]
    episode_files: tuple[Path, ...]

    @property
    def action_count(self) -> int:
        return int(self.manifest["action_count"])

    def load_episode(self, path: Path) -> dict[str, np.ndarray]:
        with np.load(path) as data:
            arrays = {key: data[key].copy() for key in data.files}
        _validate_episode_arrays(arrays, path, self.action_count)
        return arrays

    def load_arrays(self) -> dict[str, np.ndarray]:
        episodes = [self.load_episode(path) for path in self.episode_files]
        if not episodes:
            raise ValueError("dataset has no episode files")
        keys = episodes[0].keys()
        return {key: np.concatenate([episode[key] for episode in episodes], axis=0) for key in keys}


def load_demo_dataset(path: str | Path) -> DemoDataset:
    root = Path(path)
    manifest_path = root / "manifest.json"
    if not manifest_path.exists():
        raise FileNotFoundError(f"missing demo manifest: {manifest_path}")
    with manifest_path.open("r", encoding="utf-8") as handle:
        manifest = json.load(handle)
    _validate_manifest(manifest)
    episode_files = tuple(root / episode["file"] for episode in manifest.get("episodes", []))
    missing = [str(path) for path in episode_files if not path.exists()]
    if missing:
        raise FileNotFoundError(f"missing demo episode files: {missing}")
    return DemoDataset(root=root, manifest=manifest, episode_files=episode_files)


def split_episode_files(
    dataset: DemoDataset,
    *,
    val_fraction: float = 0.2,
    seed: int = 123,
) -> tuple[tuple[Path, ...], tuple[Path, ...]]:
    files = list(dataset.episode_files)
    if len(files) < 2:
        return tuple(files), tuple(files)
    rng = np.random.default_rng(seed)
    rng.shuffle(files)
    val_count = max(1, int(round(len(files) * val_fraction)))
    val_count = min(val_count, len(files) - 1)
    return tuple(files[val_count:]), tuple(files[:val_count])


def load_file_arrays(dataset: DemoDataset, files: tuple[Path, ...]) -> tuple[np.ndarray, np.ndarray]:
    episodes = [dataset.load_episode(path) for path in files]
    obs = np.concatenate([episode["obs"] for episode in episodes], axis=0).astype(np.float32)
    actions = np.concatenate([episode["action"] for episode in episodes], axis=0).astype(np.int64)
    return obs, actions


def _validate_manifest(manifest: dict[str, Any]) -> None:
    if int(manifest.get("schema_version", -1)) != DEMO_SCHEMA_VERSION:
        raise ValueError("incompatible demo schema_version")
    if manifest.get("action_mode") != "curriculum_discrete":
        raise ValueError("incompatible demo action_mode")
    if list(manifest.get("observation_fields", [])) != list(OBSERVATION_FIELDS):
        raise ValueError("incompatible demo observation field order")
    if int(manifest.get("action_count", -1)) != CURRICULUM_ACTION_COUNT:
        raise ValueError("incompatible demo action_count")


def _validate_episode_arrays(arrays: dict[str, np.ndarray], path: Path, action_count: int) -> None:
    required = {
        "obs",
        "action",
        "action_vector",
        "next_obs",
        "reward",
        "terminated",
        "truncated",
        "tick",
        "arena_id",
        "episode_id",
    }
    missing = required.difference(arrays)
    if missing:
        raise ValueError(f"{path} missing arrays: {sorted(missing)}")
    length = arrays["obs"].shape[0]
    if arrays["obs"].shape[1:] != (len(OBSERVATION_FIELDS),):
        raise ValueError(f"{path} has incompatible obs shape")
    if arrays["next_obs"].shape != arrays["obs"].shape:
        raise ValueError(f"{path} has incompatible next_obs shape")
    if arrays["action_vector"].shape != (length, 13):
        raise ValueError(f"{path} has incompatible action_vector shape")
    for key in required - {"obs", "next_obs", "action_vector"}:
        if arrays[key].shape[0] != length:
            raise ValueError(f"{path} array {key} is not aligned")
    if np.any(arrays["action"] < 0) or np.any(arrays["action"] >= action_count):
        raise ValueError(f"{path} contains out-of-range action labels")
