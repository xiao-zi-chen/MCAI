from __future__ import annotations

from collections.abc import MutableMapping
from dataclasses import dataclass
from typing import Any

import numpy as np

from mc_pvp_env.actions import NEUTRAL_ACTION, curriculum_action_to_vector
from mc_pvp_env.runtime_policy import is_runtime_pvp_policy_type


EXPERT_POLICY_NAME = "heuristic_expert_v1"
EXPERT_POLICY_VERSION = "1"
TARGET_POLICY_NAME = "movement_only_target_v1"
TARGET_POLICY_VERSION = "1"
WEAK_SCRIPTED_TARGET_POLICY_NAME = "weak_scripted_target_v1"
WEAK_SCRIPTED_TARGET_POLICY_VERSION = "1"
CURRICULUM_SCRIPTED_TARGET_POLICY_NAME = "curriculum_scripted_target_v1"
CURRICULUM_SCRIPTED_TARGET_POLICY_VERSION = "1"
OPPONENT_CURRICULUM_POLICY_NAME = "opponent_curriculum_v1"
OPPONENT_CURRICULUM_POLICY_VERSION = "1"


@dataclass(frozen=True)
class HeuristicExpertPolicy:
    self_name: str = "ROBO-A0"
    opponent_name: str = "SCRIPT-A0"
    seed: int = 0
    attack_distance: float = 3.1
    close_distance: float = 1.4
    walk_distance: float = 5.0
    cooldown_threshold: float = 0.85

    name: str = EXPERT_POLICY_NAME
    version: str = EXPERT_POLICY_VERSION

    def action(self, obs: np.ndarray | None = None, snapshot: dict[str, Any] | None = None) -> int:
        if snapshot is None:
            return self._action_from_obs(obs)

        self_player = _find_player(snapshot, self.self_name)
        opponent = _find_player(snapshot, self.opponent_name)
        if self_player is None or opponent is None:
            return 1

        tick = int(snapshot.get("tick", 0))
        rel = _relative_position(self_player, opponent)
        distance = float(np.linalg.norm(rel))
        cooldown = float(self_player.get("attack_cooldown", 0.0))
        line_of_sight = bool(self_player.get("line_of_sight", False))

        if distance <= self.close_distance:
            return 10
        if distance <= self.attack_distance and line_of_sight and cooldown >= self.cooldown_threshold:
            phase = (tick + self.seed) % 8
            if phase == 0:
                return 7
            if phase == 2:
                return 8
            if phase == 4:
                return 4
            if phase == 6:
                return 9
            return 5
        if distance <= self.walk_distance:
            if ((tick // 4) + self.seed) % 5 == 0:
                return 3
            return 2
        return 3

    def action_vector(self, action: int) -> np.ndarray:
        return curriculum_action_to_vector(action)

    def _action_from_obs(self, obs: np.ndarray | None) -> int:
        if obs is None:
            return 1
        arr = np.asarray(obs, dtype=np.float32)
        if arr.size < 21:
            return 1
        distance = float(arr[17]) * 20.0
        line_of_sight = bool(arr[18] > 0.5)
        cooldown = float(arr[19])
        if distance <= self.close_distance:
            return 10
        if distance <= self.attack_distance and line_of_sight and cooldown >= self.cooldown_threshold:
            return 5
        if distance <= self.walk_distance:
            return 2
        return 3


@dataclass(frozen=True)
class MovementOnlyTargetPolicy:
    seed: int = 0

    name: str = TARGET_POLICY_NAME
    version: str = TARGET_POLICY_VERSION

    def action_vector(self, obs: np.ndarray | None = None, snapshot: dict[str, Any] | None = None) -> np.ndarray:
        tick = int(snapshot.get("tick", 0)) if isinstance(snapshot, dict) else 0
        phase = (tick // 6 + self.seed) % 8
        vector = NEUTRAL_ACTION.copy()
        vector[12] = 2 if phase in (1, 2, 5) else 0
        if phase == 1:
            vector[0] = 1
        elif phase == 2:
            vector[0] = 1
            vector[5] = 1
        elif phase == 3:
            vector[2] = 1
        elif phase == 4:
            vector[3] = 1
        elif phase == 5:
            vector[1] = 1
        elif phase == 6:
            vector[4] = 1
        vector[7] = 0
        return vector


@dataclass(frozen=True)
class WeakScriptedTargetPolicy:
    seed: int = 0

    name: str = WEAK_SCRIPTED_TARGET_POLICY_NAME
    version: str = WEAK_SCRIPTED_TARGET_POLICY_VERSION

    def action(self, obs: np.ndarray | None = None, snapshot: dict[str, Any] | None = None) -> int:
        tick = int(snapshot.get("tick", 0)) if isinstance(snapshot, dict) else 0
        phase = ((tick // 8) + self.seed) % 12
        if phase in (0, 1, 2):
            return 1
        if phase in (3, 4, 5, 6):
            return 2
        if phase == 7:
            return 5
        return 0

    def action_vector(self, obs: np.ndarray | None = None, snapshot: dict[str, Any] | None = None) -> np.ndarray:
        return curriculum_action_to_vector(self.action(obs, snapshot))


@dataclass(frozen=True)
class CurriculumScriptedTargetPolicy:
    seed: int = 0

    name: str = CURRICULUM_SCRIPTED_TARGET_POLICY_NAME
    version: str = CURRICULUM_SCRIPTED_TARGET_POLICY_VERSION

    def action(self, obs: np.ndarray | None = None, snapshot: dict[str, Any] | None = None) -> int:
        tick = int(snapshot.get("tick", 0)) if isinstance(snapshot, dict) else 0
        phase = ((tick // 4) + self.seed) % 10
        if phase in (0, 1):
            return 2
        if phase == 2:
            return 3
        if phase == 3:
            return 5
        if phase == 4:
            return 7
        if phase == 5:
            return 8
        if phase == 6:
            return 9
        if phase == 7:
            return 10
        return 1

    def action_vector(self, obs: np.ndarray | None = None, snapshot: dict[str, Any] | None = None) -> np.ndarray:
        return curriculum_action_to_vector(self.action(obs, snapshot))


class OpponentCurriculumPolicy:
    name: str = OPPONENT_CURRICULUM_POLICY_NAME
    version: str = OPPONENT_CURRICULUM_POLICY_VERSION

    def __init__(
        self,
        seed: int = 0,
        stage_steps: tuple[int, int] = (5_000, 15_000),
        shared_step_counter: MutableMapping[str, int] | None = None,
    ):
        first, second = stage_steps
        if first < 0 or second < first:
            raise ValueError("opponent curriculum steps must be non-negative and sorted")
        self.seed = seed
        self.stage_steps = (int(first), int(second))
        self._calls = 0
        self._shared_step_counter = shared_step_counter
        self._movement = MovementOnlyTargetPolicy(seed=seed)
        self._weak = WeakScriptedTargetPolicy(seed=seed)
        self._scripted = CurriculumScriptedTargetPolicy(seed=seed)

    def action_vector(self, obs: np.ndarray | None = None, snapshot: dict[str, Any] | None = None) -> np.ndarray:
        policy = self.current_policy(self._next_step())
        return policy.action_vector(obs, snapshot)

    def current_policy(self, step: int | None = None):
        current_step = self._calls if step is None else int(step)
        if current_step < self.stage_steps[0]:
            return self._movement
        if current_step < self.stage_steps[1]:
            return self._weak
        return self._scripted

    def _next_step(self) -> int:
        if self._shared_step_counter is None:
            step = self._calls
            self._calls += 1
            return step
        step = int(self._shared_step_counter.get("calls", 0))
        self._shared_step_counter["calls"] = step + 1
        self._calls = step + 1
        return step


def make_opponent_policy(
    name: str,
    *,
    seed: int = 0,
    curriculum_steps: tuple[int, int] = (5_000, 15_000),
    shared_step_counter: MutableMapping[str, int] | None = None,
    policy_pool_manifest: str | None = None,
    policy_pool_weights: tuple[float, float, float] = (0.5, 0.3, 0.2),
):
    normalized = name.strip().lower()
    if normalized in ("", "neutral", "none") or is_runtime_pvp_policy_type(normalized):
        return None
    if normalized == "movement_only":
        return MovementOnlyTargetPolicy(seed=seed)
    if normalized == "weak_scripted":
        return WeakScriptedTargetPolicy(seed=seed)
    if normalized == "curriculum_scripted":
        return CurriculumScriptedTargetPolicy(seed=seed)
    if normalized == "curriculum":
        return OpponentCurriculumPolicy(
            seed=seed,
            stage_steps=curriculum_steps,
            shared_step_counter=shared_step_counter,
        )
    if normalized == "policy_pool_sample":
        if not policy_pool_manifest:
            raise ValueError("policy_pool_sample requires a policy_pool_manifest path")
        from mc_pvp_env.opponent_pool import make_policy_pool_sample_opponent

        return make_policy_pool_sample_opponent(
            policy_pool_manifest,
            seed=seed,
            curriculum_steps=curriculum_steps,
            weights=policy_pool_weights,
        )
    raise ValueError(f"Unknown opponent policy: {name}")


def _find_player(snapshot: dict[str, Any], name: str) -> dict[str, Any] | None:
    for player in snapshot.get("players", []):
        if player.get("name") == name:
            return player
    return None


def _relative_position(self_player: dict[str, Any], opponent: dict[str, Any]) -> np.ndarray:
    self_pos = np.asarray(self_player.get("pos", [0.0, 0.0, 0.0]), dtype=np.float32)
    opp_pos = np.asarray(opponent.get("pos", [0.0, 0.0, 0.0]), dtype=np.float32)
    return opp_pos - self_pos
