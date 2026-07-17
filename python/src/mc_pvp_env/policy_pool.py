from __future__ import annotations

import argparse
import json
import time
from pathlib import Path
from typing import Any


SCHEMA_VERSION = 1


def load_pool(path: str | Path) -> dict[str, Any]:
    pool_path = Path(path)
    if not pool_path.exists():
        return {
            "schema_version": SCHEMA_VERSION,
            "champion_id": None,
            "policies": [],
        }
    with pool_path.open("r", encoding="utf-8") as handle:
        data = json.load(handle)
    if int(data.get("schema_version", 0)) != SCHEMA_VERSION:
        raise ValueError(f"Unsupported policy pool schema_version={data.get('schema_version')}")
    data.setdefault("champion_id", None)
    data.setdefault("policies", [])
    return data


def save_pool(path: str | Path, pool: dict[str, Any]) -> None:
    pool_path = Path(path)
    pool_path.parent.mkdir(parents=True, exist_ok=True)
    with pool_path.open("w", encoding="utf-8") as handle:
        json.dump(pool, handle, indent=2, sort_keys=True)


def register_policy(
    manifest_path: str | Path,
    *,
    policy_id: str,
    checkpoint: str | Path = "",
    policy_type: str = "ppo",
    role: str = "frozen",
    source_run: str | Path | None = None,
    metrics: str | Path | None = None,
    notes: str = "",
    champion: bool = False,
) -> dict[str, Any]:
    if role not in {"frozen", "candidate", "champion"}:
        raise ValueError("role must be one of: frozen, candidate, champion")
    if policy_type not in {"ppo", "bc", "scripted", "mineflayer_pvp"}:
        raise ValueError("policy_type must be one of: ppo, bc, scripted, mineflayer_pvp")
    checkpoint_path = Path(checkpoint) if checkpoint else Path()
    if policy_type in {"ppo", "bc"}:
        if not checkpoint:
            raise FileNotFoundError("Checkpoint is required for PPO/BC policy entries")
        if not checkpoint_path.exists():
            raise FileNotFoundError(f"Checkpoint does not exist: {checkpoint_path}")
    if champion:
        role = "champion"

    pool = load_pool(manifest_path)
    policies = list(pool.get("policies", []))
    existing_index = next((index for index, item in enumerate(policies) if item.get("id") == policy_id), None)
    entry = {
        "id": policy_id,
        "checkpoint": str(checkpoint_path) if checkpoint else "",
        "policy_type": policy_type,
        "role": role,
        "source_run": str(source_run) if source_run else "",
        "metrics": str(metrics) if metrics else "",
        "notes": notes,
        "created_at": _now(),
        "updated_at": _now(),
    }
    if existing_index is not None:
        entry["created_at"] = policies[existing_index].get("created_at", entry["created_at"])
        policies[existing_index] = entry
    else:
        policies.append(entry)

    if role == "champion":
        pool["champion_id"] = policy_id
        for item in policies:
            if item.get("id") != policy_id and item.get("role") == "champion":
                item["role"] = "frozen"
                item["updated_at"] = _now()
    pool["policies"] = sorted(policies, key=lambda item: str(item.get("id", "")))
    save_pool(manifest_path, pool)
    return entry


def promote_champion(manifest_path: str | Path, policy_id: str) -> dict[str, Any]:
    pool = load_pool(manifest_path)
    found: dict[str, Any] | None = None
    for item in pool.get("policies", []):
        if item.get("id") == policy_id:
            item["role"] = "champion"
            item["updated_at"] = _now()
            found = item
        elif item.get("role") == "champion":
            item["role"] = "frozen"
            item["updated_at"] = _now()
    if found is None:
        raise KeyError(f"Unknown policy id: {policy_id}")
    pool["champion_id"] = policy_id
    save_pool(manifest_path, pool)
    return found


def main() -> int:
    parser = argparse.ArgumentParser(description="Manage the PVPRobo frozen policy pool manifest.")
    parser.add_argument("--manifest", required=True, help="Path to policy_pool.json.")
    subparsers = parser.add_subparsers(dest="command", required=True)

    register = subparsers.add_parser("register", help="Register or update a checkpoint in the pool.")
    register.add_argument("--id", required=True)
    register.add_argument("--checkpoint", default="")
    register.add_argument("--policy-type", default="ppo", choices=("ppo", "bc", "scripted", "mineflayer_pvp"))
    register.add_argument("--role", default="frozen", choices=("frozen", "candidate", "champion"))
    register.add_argument("--source-run", default="")
    register.add_argument("--metrics", default="")
    register.add_argument("--notes", default="")
    register.add_argument("--champion", action="store_true")

    promote = subparsers.add_parser("promote", help="Promote an existing policy id to champion.")
    promote.add_argument("--id", required=True)

    subparsers.add_parser("list", help="Print the current manifest.")
    args = parser.parse_args()

    if args.command == "register":
        entry = register_policy(
            args.manifest,
            policy_id=args.id,
            checkpoint=args.checkpoint,
            policy_type=args.policy_type,
            role=args.role,
            source_run=args.source_run,
            metrics=args.metrics,
            notes=args.notes,
            champion=args.champion,
        )
        print(f"registered_policy={entry['id']}")
    elif args.command == "promote":
        entry = promote_champion(args.manifest, args.id)
        print(f"champion_policy={entry['id']}")
    else:
        print(json.dumps(load_pool(args.manifest), indent=2, sort_keys=True))
    return 0


def _now() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%S%z")


if __name__ == "__main__":
    raise SystemExit(main())
