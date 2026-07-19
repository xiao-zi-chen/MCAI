from __future__ import annotations

from dataclasses import asdict, dataclass, is_dataclass
from pathlib import Path
from typing import TYPE_CHECKING, Any
import json
import subprocess

from mc_pvp_env.action_abi import (
    SWORD_PVP_ACTION_V1,
    VIRTUAL_HID_FRAME_V1,
    ActionExecutionStatus,
    SwordPvPActionV1,
    VirtualHIDFrameV1,
)
from mc_pvp_env.action_codec import decode_sword_action_v1, decode_virtual_hid_frame_v1
from mc_pvp_env.config import EnvConfig

if TYPE_CHECKING:
    from mc_pvp_env.restricted_client import RestrictedActionResult


RESTRICTED_DATASET_SCHEMA_VERSION = 2


@dataclass(frozen=True)
class RestrictedStep:
    tick: int
    observation_tick: int
    policy_time_ms: int
    action_requested: SwordPvPActionV1
    action_executed: VirtualHIDFrameV1
    action_execution_status: ActionExecutionStatus
    action_execution_status_reasons: tuple[str, ...]
    mouse_device_state: dict[str, Any]
    action_queue_depth: int
    reward: float
    terminated: bool
    truncated: bool
    episode_id: str
    arena_id: str


class RestrictedEpisodeBuffer:
    def __init__(self, episode_id: str, arena_id: str):
        self.episode_id = episode_id
        self.arena_id = arena_id
        self._rows: list[dict[str, Any]] = []

    def append(
        self,
        *,
        tick: int,
        observation_tick: int,
        policy_time_ms: int,
        action_requested: SwordPvPActionV1,
        action_executed: VirtualHIDFrameV1,
        mouse_device_state: dict[str, Any] | None,
        action_queue_depth: int,
        reward: float,
        terminated: bool,
        truncated: bool,
    ) -> None:
        self._rows.append({
            "tick": int(tick),
            "observation_tick": int(observation_tick),
            "policy_time_ms": int(policy_time_ms),
            "action_requested": action_requested.to_dict(),
            "action_executed": action_executed.to_dict(),
            "action_execution_status": action_executed.status.value,
            "action_execution_status_reasons": list(action_executed.status_reasons),
            "mouse_device_state": dict(mouse_device_state or {}),
            "action_queue_depth": int(action_queue_depth),
            "reward": float(reward),
            "terminated": bool(terminated),
            "truncated": bool(truncated),
            "episode_id": self.episode_id,
            "arena_id": self.arena_id,
        })

    def append_action_result(
        self,
        *,
        tick: int,
        result: "RestrictedActionResult",
        mouse_device_state: dict[str, Any] | None,
        action_queue_depth: int,
        reward: float,
        terminated: bool,
        truncated: bool,
    ) -> None:
        self._rows.append({
            "tick": int(tick),
            "observation_tick": int(result.requested.observation_tick),
            "policy_time_ms": int(result.requested.policy_time_ms),
            "action_requested": result.requested.to_dict(),
            "action_executed": result.executed.to_dict(),
            "action_execution_status": result.status.value,
            "action_execution_status_reasons": list(result.status_reasons),
            "mouse_device_state": dict(mouse_device_state or {}),
            "action_queue_depth": int(action_queue_depth),
            "reward": float(reward),
            "terminated": bool(terminated),
            "truncated": bool(truncated),
            "episode_id": self.episode_id,
            "arena_id": self.arena_id,
        })

    def rows(self) -> list[dict[str, Any]]:
        return list(self._rows)

    def __len__(self) -> int:
        return len(self._rows)


class RestrictedDatasetWriter:
    def __init__(
        self,
        out_dir: str | Path,
        *,
        config: EnvConfig,
        backend: str,
        minecraft_version: str,
        server_runtime: str,
        visual_profile_id: str,
        mouse_profile_id: str,
    ):
        self.out_dir = Path(out_dir)
        self.out_dir.mkdir(parents=True, exist_ok=True)
        self.config = config
        self.backend = backend
        self.minecraft_version = minecraft_version
        self.server_runtime = server_runtime
        self.visual_profile_id = visual_profile_id
        self.mouse_profile_id = mouse_profile_id
        self.episodes: list[dict[str, Any]] = []

    def write_episode(self, buffer: RestrictedEpisodeBuffer) -> Path:
        if len(buffer) == 0:
            raise ValueError("cannot write an empty restricted episode")
        filename = f"{buffer.episode_id}.jsonl"
        path = self.out_dir / filename
        with path.open("w", encoding="utf-8") as handle:
            for row in buffer.rows():
                handle.write(json.dumps(row, separators=(",", ":"), sort_keys=True) + "\n")
        self.episodes.append({
            "episode_id": buffer.episode_id,
            "arena_id": buffer.arena_id,
            "file": filename,
            "steps": len(buffer),
        })
        self.write_manifest()
        return path

    def write_manifest(self) -> Path:
        manifest = {
            "schema_version": RESTRICTED_DATASET_SCHEMA_VERSION,
            "action_abi_version": SWORD_PVP_ACTION_V1,
            "executed_action_abi_version": VIRTUAL_HID_FRAME_V1,
            "backend": self.backend,
            "minecraft_version": self.minecraft_version,
            "server_runtime": self.server_runtime,
            "visual_profile_id": self.visual_profile_id,
            "mouse_profile_id": self.mouse_profile_id,
            "env_config": _config_dict(self.config),
            "git_commit": _git_commit(),
            "episodes": self.episodes,
        }
        path = self.out_dir / "manifest.json"
        with path.open("w", encoding="utf-8") as handle:
            json.dump(manifest, handle, indent=2, sort_keys=True)
        return path


@dataclass(frozen=True)
class RestrictedDataset:
    root: Path
    manifest: dict[str, Any]
    episode_files: tuple[Path, ...]

    def load_episode(self, path: Path) -> list[RestrictedStep]:
        rows: list[RestrictedStep] = []
        with path.open("r", encoding="utf-8") as handle:
            for line_number, line in enumerate(handle, start=1):
                if not line.strip():
                    continue
                raw = json.loads(line)
                rows.append(_decode_step(raw, path, line_number))
        return rows


def load_restricted_dataset(path: str | Path) -> RestrictedDataset:
    root = Path(path)
    manifest_path = root / "manifest.json"
    if not manifest_path.exists():
        raise FileNotFoundError(f"missing restricted dataset manifest: {manifest_path}")
    with manifest_path.open("r", encoding="utf-8") as handle:
        manifest = json.load(handle)
    _validate_manifest(manifest)
    episode_files = tuple(root / episode["file"] for episode in manifest.get("episodes", []))
    missing = [str(path) for path in episode_files if not path.exists()]
    if missing:
        raise FileNotFoundError(f"missing restricted episode files: {missing}")
    return RestrictedDataset(root=root, manifest=manifest, episode_files=episode_files)


def _validate_manifest(manifest: dict[str, Any]) -> None:
    required = {
        "schema_version",
        "action_abi_version",
        "executed_action_abi_version",
        "backend",
        "minecraft_version",
        "server_runtime",
        "visual_profile_id",
        "mouse_profile_id",
        "env_config",
        "git_commit",
        "episodes",
    }
    missing = required.difference(manifest)
    if missing:
        raise ValueError(f"restricted dataset manifest missing fields: {sorted(missing)}")
    if int(manifest["schema_version"]) != RESTRICTED_DATASET_SCHEMA_VERSION:
        raise ValueError("incompatible restricted dataset schema_version")
    if manifest["action_abi_version"] != SWORD_PVP_ACTION_V1:
        raise ValueError("incompatible action_abi_version")
    if manifest["executed_action_abi_version"] != VIRTUAL_HID_FRAME_V1:
        raise ValueError("incompatible executed_action_abi_version")
    if manifest["backend"] not in ("mineflayer", "herobot", "real_client", "robot_emulator", "physical_robot"):
        raise ValueError("backend must be a known restricted dataset backend")
    if not isinstance(manifest["episodes"], list):
        raise ValueError("episodes must be a list")


def _decode_step(raw: dict[str, Any], path: Path, line_number: int) -> RestrictedStep:
    required = {
        "tick",
        "observation_tick",
        "policy_time_ms",
        "action_requested",
        "action_executed",
        "action_execution_status",
        "action_execution_status_reasons",
        "mouse_device_state",
        "action_queue_depth",
        "reward",
        "terminated",
        "truncated",
        "episode_id",
        "arena_id",
    }
    missing = required.difference(raw)
    if missing:
        raise ValueError(f"{path}:{line_number} missing fields: {sorted(missing)}")
    requested = decode_sword_action_v1(_dict_value(raw, "action_requested"))
    executed = decode_virtual_hid_frame_v1(_dict_value(raw, "action_executed"))
    status = ActionExecutionStatus(_str_value(raw, "action_execution_status"))
    reasons = tuple(_str_list_value(raw, "action_execution_status_reasons"))
    return RestrictedStep(
        tick=_int_value(raw, "tick"),
        observation_tick=_int_value(raw, "observation_tick"),
        policy_time_ms=_int_value(raw, "policy_time_ms"),
        action_requested=requested,
        action_executed=executed,
        action_execution_status=status,
        action_execution_status_reasons=reasons,
        mouse_device_state=_dict_value(raw, "mouse_device_state"),
        action_queue_depth=_int_value(raw, "action_queue_depth"),
        reward=float(raw["reward"]),
        terminated=_bool_value(raw, "terminated"),
        truncated=_bool_value(raw, "truncated"),
        episode_id=_str_value(raw, "episode_id"),
        arena_id=_str_value(raw, "arena_id"),
    )


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


def _dict_value(payload: dict[str, Any], key: str) -> dict[str, Any]:
    value = payload.get(key)
    if not isinstance(value, dict):
        raise ValueError(f"{key} must be an object")
    return value


def _str_value(payload: dict[str, Any], key: str) -> str:
    value = payload.get(key)
    if not isinstance(value, str) or not value:
        raise ValueError(f"{key} must be a non-empty string")
    return value


def _str_list_value(payload: dict[str, Any], key: str) -> list[str]:
    value = payload.get(key)
    if not isinstance(value, list) or any(not isinstance(item, str) or not item for item in value):
        raise ValueError(f"{key} must be a list of non-empty strings")
    return value


def _int_value(payload: dict[str, Any], key: str) -> int:
    value = payload.get(key)
    if not isinstance(value, int) or isinstance(value, bool):
        raise ValueError(f"{key} must be an integer")
    return value


def _bool_value(payload: dict[str, Any], key: str) -> bool:
    value = payload.get(key)
    if not isinstance(value, bool):
        raise ValueError(f"{key} must be a bool")
    return value
