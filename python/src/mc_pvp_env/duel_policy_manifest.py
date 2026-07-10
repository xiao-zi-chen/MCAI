from __future__ import annotations

import argparse
import json
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import numpy as np

from mc_pvp_env.actions import CURRICULUM_ACTION_COUNT
from mc_pvp_env.observations import OBSERVATION_FIELDS


SCHEMA_VERSION = 1
DEFAULT_DIFFICULTIES = ("bc", "ppo_mid", "ppo_high", "script_easy", "script_hard", "champion")
SCRIPTED_POLICY_IDS = ("weak_scripted", "curriculum_scripted")
POLICY_TYPES = ("bc", "ppo", "scripted")


@dataclass(frozen=True)
class DuelPolicy:
    difficulty: str
    policy_type: str
    checkpoint: Path | None
    policy_id: str = ""
    source: str = ""
    notes: str = ""


def default_manifest() -> dict[str, Any]:
    return {
        "schema_version": SCHEMA_VERSION,
        "difficulties": {},
    }


def load_manifest(path: str | Path) -> dict[str, Any]:
    manifest_path = Path(path)
    if not manifest_path.exists():
        return default_manifest()
    with manifest_path.open("r", encoding="utf-8") as handle:
        data = json.load(handle)
    if int(data.get("schema_version", 0)) != SCHEMA_VERSION:
        raise ValueError(f"Unsupported duel policy manifest schema_version={data.get('schema_version')}")
    data.setdefault("difficulties", {})
    return data


def save_manifest(path: str | Path, manifest: dict[str, Any]) -> None:
    manifest_path = Path(path)
    manifest_path.parent.mkdir(parents=True, exist_ok=True)
    temp_path = manifest_path.with_name(f"{manifest_path.name}.{time.time_ns()}.tmp")
    with temp_path.open("w", encoding="utf-8") as handle:
        json.dump(manifest, handle, indent=2, sort_keys=True)
    temp_path.replace(manifest_path)


def register_difficulty(
    manifest_path: str | Path,
    *,
    difficulty: str,
    checkpoint: str | Path,
    policy_type: str,
    policy_id: str = "",
    source: str = "",
    notes: str = "",
) -> DuelPolicy:
    normalized = _normalize_difficulty(difficulty)
    normalized_type = _normalize_policy_type(policy_type)
    checkpoint_path = Path(checkpoint) if str(checkpoint).strip() else None
    if normalized_type != "scripted" and checkpoint_path is None:
        raise ValueError(f"Checkpoint is required for policy_type '{normalized_type}'")
    if checkpoint_path is not None and not checkpoint_path.exists():
        raise FileNotFoundError(f"Checkpoint does not exist: {checkpoint_path}")
    if normalized_type == "scripted" and policy_id and policy_id not in SCRIPTED_POLICY_IDS:
        raise ValueError(f"scripted policy_id must be one of: {', '.join(SCRIPTED_POLICY_IDS)}")

    manifest = load_manifest(manifest_path)
    difficulties = dict(manifest.get("difficulties", {}))
    now = _now()
    existing = difficulties.get(normalized, {})
    difficulties[normalized] = {
        "policy_type": normalized_type,
        "checkpoint": "" if checkpoint_path is None else str(checkpoint_path),
        "policy_id": policy_id or _default_scripted_policy_id(normalized),
        "source": source,
        "notes": notes,
        "created_at": existing.get("created_at", now) if isinstance(existing, dict) else now,
        "updated_at": now,
    }
    manifest["difficulties"] = difficulties
    save_manifest(manifest_path, manifest)
    return resolve_difficulty(manifest_path, normalized)


def resolve_difficulty(manifest_path: str | Path, difficulty: str) -> DuelPolicy:
    normalized = _normalize_difficulty(difficulty)
    manifest = load_manifest(manifest_path)
    entry = manifest.get("difficulties", {}).get(normalized)
    if not isinstance(entry, dict):
        available = sorted(str(key) for key in manifest.get("difficulties", {}).keys())
        available_text = ", ".join(available) if available else "none"
        raise KeyError(f"Difficulty '{normalized}' is not configured in {manifest_path}. Available: {available_text}")
    policy_type = _normalize_policy_type(str(entry.get("policy_type", "")))
    checkpoint_raw = str(entry.get("checkpoint", ""))
    checkpoint = Path(checkpoint_raw) if checkpoint_raw else None
    policy_id = str(entry.get("policy_id", ""))
    if policy_type == "scripted":
        policy_id = policy_id or _default_scripted_policy_id(normalized)
        if policy_id not in SCRIPTED_POLICY_IDS:
            raise ValueError(f"scripted policy_id for difficulty '{normalized}' must be one of: {', '.join(SCRIPTED_POLICY_IDS)}")
    elif checkpoint is None:
        raise FileNotFoundError(f"Checkpoint for difficulty '{normalized}' is not configured")
    elif not checkpoint.exists():
        raise FileNotFoundError(f"Checkpoint for difficulty '{normalized}' does not exist: {checkpoint}")
    return DuelPolicy(
        difficulty=normalized,
        policy_type=policy_type,
        checkpoint=checkpoint,
        policy_id=policy_id,
        source=str(entry.get("source", "")),
        notes=str(entry.get("notes", "")),
    )


def preflight_difficulty(
    manifest_path: str | Path,
    difficulty: str,
    *,
    predictor_factory=None,
    observation_size: int | None = None,
) -> tuple[DuelPolicy, int]:
    policy = resolve_difficulty(manifest_path, difficulty)
    if predictor_factory is None:
        from mc_pvp_env.duel_runner import make_policy_predictor

        predictor_factory = make_policy_predictor
    predictor = predictor_factory(policy)
    size = observation_size if observation_size is not None else len(OBSERVATION_FIELDS)
    obs = np.zeros(size, dtype=np.float32)
    action = int(predictor(obs))
    if action < 0 or action >= CURRICULUM_ACTION_COUNT:
        raise ValueError(
            f"Policy for difficulty '{policy.difficulty}' produced action {action}; "
            f"expected [0, {CURRICULUM_ACTION_COUNT})"
        )
    return policy, action


def import_champion_from_policy_pool(
    manifest_path: str | Path,
    policy_pool_path: str | Path,
    *,
    difficulty: str = "champion",
    notes: str = "",
) -> DuelPolicy:
    pool_path = Path(policy_pool_path)
    if not pool_path.exists():
        raise FileNotFoundError(f"Policy pool does not exist: {pool_path}")
    with pool_path.open("r", encoding="utf-8") as handle:
        pool = json.load(handle)
    champion_id = pool.get("champion_id")
    if not champion_id:
        raise KeyError(f"Policy pool has no champion_id: {pool_path}")
    for item in pool.get("policies", []):
        if isinstance(item, dict) and item.get("id") == champion_id:
            return register_difficulty(
                manifest_path,
                difficulty=difficulty,
                checkpoint=str(item.get("checkpoint", "")),
                policy_type=str(item.get("policy_type", "")),
                policy_id=str(champion_id),
                source=str(pool_path),
                notes=notes or str(item.get("notes", "")),
            )
    raise KeyError(f"Champion policy '{champion_id}' is not present in {pool_path}")


def main() -> int:
    parser = argparse.ArgumentParser(description="Manage PVPRobo human-duel difficulty checkpoint manifest.")
    parser.add_argument("--manifest", required=True, help="Path to duel-policies.json.")
    subparsers = parser.add_subparsers(dest="command", required=True)

    register = subparsers.add_parser("register", help="Register or update a difficulty label.")
    register.add_argument("--difficulty", required=True, choices=DEFAULT_DIFFICULTIES)
    register.add_argument("--checkpoint", default="")
    register.add_argument("--policy-type", required=True, choices=POLICY_TYPES)
    register.add_argument("--policy-id", default="")
    register.add_argument("--source", default="")
    register.add_argument("--notes", default="")

    resolve = subparsers.add_parser("resolve", help="Resolve a difficulty label.")
    resolve.add_argument("--difficulty", required=True, choices=DEFAULT_DIFFICULTIES)

    preflight = subparsers.add_parser("preflight", help="Load a difficulty policy and run one dummy prediction.")
    preflight.add_argument("--difficulty", required=True, choices=DEFAULT_DIFFICULTIES)
    preflight.add_argument("--observation-size", type=int, default=len(OBSERVATION_FIELDS))

    champion = subparsers.add_parser("import-champion", help="Map the promoted policy-pool champion to a duel difficulty.")
    champion.add_argument("--policy-pool", required=True)
    champion.add_argument("--difficulty", default="champion", choices=DEFAULT_DIFFICULTIES)
    champion.add_argument("--notes", default="")

    subparsers.add_parser("list", help="Print the current manifest.")
    args = parser.parse_args()

    if args.command == "register":
        policy = register_difficulty(
            args.manifest,
            difficulty=args.difficulty,
            checkpoint=args.checkpoint,
            policy_type=args.policy_type,
            policy_id=args.policy_id,
            source=args.source,
            notes=args.notes,
        )
        print(f"registered_difficulty={policy.difficulty}")
        print(f"policy_type={policy.policy_type}")
        print(f"checkpoint={policy.checkpoint}")
        if policy.policy_id:
            print(f"policy_id={policy.policy_id}")
    elif args.command == "resolve":
        policy = resolve_difficulty(args.manifest, args.difficulty)
        print(f"difficulty={policy.difficulty}")
        print(f"policy_type={policy.policy_type}")
        print(f"checkpoint={policy.checkpoint}")
        if policy.policy_id:
            print(f"policy_id={policy.policy_id}")
    elif args.command == "preflight":
        policy, action = preflight_difficulty(
            args.manifest,
            args.difficulty,
            observation_size=args.observation_size,
        )
        print(f"difficulty={policy.difficulty}")
        print(f"policy_type={policy.policy_type}")
        print(f"checkpoint={policy.checkpoint}")
        print(f"observation_size={args.observation_size}")
        print(f"action={action}")
    elif args.command == "import-champion":
        policy = import_champion_from_policy_pool(
            args.manifest,
            args.policy_pool,
            difficulty=args.difficulty,
            notes=args.notes,
        )
        print(f"registered_difficulty={policy.difficulty}")
        print(f"policy_type={policy.policy_type}")
        print(f"checkpoint={policy.checkpoint}")
        if policy.policy_id:
            print(f"policy_id={policy.policy_id}")
    else:
        print(json.dumps(load_manifest(args.manifest), indent=2, sort_keys=True))
    return 0


def _normalize_difficulty(value: str) -> str:
    normalized = value.strip().lower()
    if normalized not in DEFAULT_DIFFICULTIES:
        raise ValueError(f"difficulty must be one of: {', '.join(DEFAULT_DIFFICULTIES)}")
    return normalized


def _normalize_policy_type(value: str) -> str:
    normalized = value.strip().lower()
    if normalized not in POLICY_TYPES:
        raise ValueError(f"policy_type must be one of: {', '.join(POLICY_TYPES)}")
    return normalized


def _default_scripted_policy_id(difficulty: str) -> str:
    if difficulty == "script_easy":
        return "weak_scripted"
    if difficulty == "script_hard":
        return "curriculum_scripted"
    return ""


def _now() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%S%z")


if __name__ == "__main__":
    raise SystemExit(main())
