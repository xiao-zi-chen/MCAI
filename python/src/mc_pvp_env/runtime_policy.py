from __future__ import annotations

RUNTIME_PVP_POLICY_TYPES = {"controller_pvp", "herobot_pvp"}
LEGACY_RUNTIME_PVP_POLICY_TYPES = {"mineflayer_pvp"}
ALL_RUNTIME_PVP_POLICY_TYPES = RUNTIME_PVP_POLICY_TYPES | LEGACY_RUNTIME_PVP_POLICY_TYPES


def normalize_runtime_pvp_policy_type(policy_type: str) -> str:
    normalized = str(policy_type).strip().lower()
    if normalized == "mineflayer_pvp":
        return "controller_pvp"
    return normalized


def is_runtime_pvp_policy_type(policy_type: str) -> bool:
    return normalize_runtime_pvp_policy_type(policy_type) in RUNTIME_PVP_POLICY_TYPES
