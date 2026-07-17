from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any

import numpy as np

from mc_pvp_env.actions import NEUTRAL_ACTION, curriculum_action_to_vector
from mc_pvp_env.policy_pool import load_pool
from mc_pvp_env.runtime_policy import RUNTIME_PVP_POLICY_TYPES, is_runtime_pvp_policy_type, normalize_runtime_pvp_policy_type


@dataclass(frozen=True)
class PolicyPoolCandidate:
    policy_id: str
    policy_type: str
    role: str
    checkpoint: str = ""
    scripted_policy: str = ""
    weight_class: str = "older"


class FrozenPpoOpponentPolicy:
    name = "frozen_ppo_opponent_v1"
    version = "1"

    def __init__(self, checkpoint: str | Path, *, deterministic: bool = True):
        try:
            from stable_baselines3 import PPO
        except ImportError as exc:
            raise RuntimeError("policy_pool_sample requires stable-baselines3; install python[sb3].") from exc
        self.checkpoint = str(checkpoint)
        self.deterministic = bool(deterministic)
        self._model = PPO.load(self.checkpoint, device="cpu")

    def action_vector(self, obs: np.ndarray | None = None, snapshot: dict[str, Any] | None = None) -> np.ndarray:
        if obs is None:
            return NEUTRAL_ACTION.copy()
        action, _state = self._model.predict(obs, deterministic=self.deterministic)
        return curriculum_action_to_vector(int(action))


class PolicyPoolSampleOpponentPolicy:
    name = "policy_pool_sample_v1"
    version = "1"

    def __init__(
        self,
        candidates: list[PolicyPoolCandidate],
        *,
        seed: int = 0,
        curriculum_steps: tuple[int, int] = (5_000, 15_000),
        weights: tuple[float, float, float] = (0.5, 0.3, 0.2),
    ):
        if not candidates:
            raise ValueError("policy pool sample requires at least one candidate")
        self.candidates = candidates
        self.seed = int(seed)
        self.curriculum_steps = curriculum_steps
        self.weights = _normalize_weights(weights)
        self._rng = np.random.default_rng(self.seed)
        self._loaded: dict[str, Any] = {}
        self._active = self._choose_candidate()

    @property
    def active_candidate(self) -> PolicyPoolCandidate:
        return self._active

    def reset(self, seed: int | None = None, snapshot: dict[str, Any] | None = None) -> None:
        if seed is not None:
            self._rng = np.random.default_rng(int(seed) + self.seed)
        self._active = self._choose_candidate()

    def action_vector(self, obs: np.ndarray | None = None, snapshot: dict[str, Any] | None = None) -> np.ndarray:
        policy = self._materialize(self._active)
        if policy is None:
            return NEUTRAL_ACTION.copy()
        return policy.action_vector(obs, snapshot)

    def _choose_candidate(self) -> PolicyPoolCandidate:
        groups = {
            "anchor": [item for item in self.candidates if item.weight_class == "anchor"],
            "champion": [item for item in self.candidates if item.weight_class == "champion"],
            "older": [item for item in self.candidates if item.weight_class == "older"],
        }
        available_groups = [name for name in ("anchor", "champion", "older") if groups[name]]
        raw_group_weights = dict(zip(("anchor", "champion", "older"), self.weights, strict=True))
        probs = np.asarray([raw_group_weights[name] for name in available_groups], dtype=np.float64)
        probs = probs / probs.sum()
        group_name = str(self._rng.choice(available_groups, p=probs))
        group = groups[group_name]
        return group[int(self._rng.integers(0, len(group)))]

    def _materialize(self, candidate: PolicyPoolCandidate):
        if candidate.policy_id in self._loaded:
            return self._loaded[candidate.policy_id]
        if candidate.policy_type == "ppo":
            policy = FrozenPpoOpponentPolicy(candidate.checkpoint)
        elif candidate.policy_type == "scripted":
            from mc_pvp_env.expert import make_opponent_policy

            policy = make_opponent_policy(
                candidate.scripted_policy or candidate.policy_id,
                seed=self.seed,
                curriculum_steps=self.curriculum_steps,
            )
        elif is_runtime_pvp_policy_type(candidate.policy_type):
            policy = None
        else:
            raise ValueError(f"Unsupported policy pool candidate type: {candidate.policy_type}")
        self._loaded[candidate.policy_id] = policy
        return policy


def load_policy_pool_candidates(path: str | Path) -> list[PolicyPoolCandidate]:
    pool = load_pool(path)
    candidates: list[PolicyPoolCandidate] = [
        PolicyPoolCandidate(
            policy_id="curriculum_scripted",
            policy_type="scripted",
            role="anchor",
            scripted_policy="curriculum_scripted",
            weight_class="anchor",
        )
    ]
    champion_id = pool.get("champion_id")
    for entry in pool.get("policies", []):
        policy_type = normalize_runtime_pvp_policy_type(str(entry.get("policy_type", "ppo")))
        if policy_type not in {"ppo", "scripted"} | RUNTIME_PVP_POLICY_TYPES:
            continue
        policy_id = str(entry.get("id", ""))
        if not policy_id:
            continue
        role = str(entry.get("role", "frozen"))
        weight_class = "champion" if role == "champion" or policy_id == champion_id else "older"
        candidates.append(
            PolicyPoolCandidate(
                policy_id=policy_id,
                policy_type=policy_type,
                role=role,
                checkpoint=str(entry.get("checkpoint", "")),
                scripted_policy=str(entry.get("scripted_policy", "")),
                weight_class=weight_class,
            )
        )
    return candidates


def make_policy_pool_sample_opponent(
    manifest_path: str | Path,
    *,
    seed: int = 0,
    curriculum_steps: tuple[int, int] = (5_000, 15_000),
    weights: tuple[float, float, float] = (0.5, 0.3, 0.2),
) -> PolicyPoolSampleOpponentPolicy:
    return PolicyPoolSampleOpponentPolicy(
        load_policy_pool_candidates(manifest_path),
        seed=seed,
        curriculum_steps=curriculum_steps,
        weights=weights,
    )


def _normalize_weights(weights: tuple[float, float, float]) -> tuple[float, float, float]:
    arr = np.asarray(weights, dtype=np.float64)
    if arr.shape != (3,) or np.any(arr < 0) or float(arr.sum()) <= 0.0:
        raise ValueError("policy pool weights must be three non-negative numbers with positive sum")
    arr = arr / arr.sum()
    return (float(arr[0]), float(arr[1]), float(arr[2]))
