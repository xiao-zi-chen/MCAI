from __future__ import annotations

from typing import Iterable

import numpy as np


ACTION_FIELDS = (
    "forward",
    "back",
    "left",
    "right",
    "jump",
    "sprint",
    "sneak",
    "attack",
    "use",
    "hotbar_slot",
    "yaw_delta_bin",
    "pitch_delta_bin",
    "look_primitive",
)

ACTION_NVECS = np.array([2, 2, 2, 2, 2, 2, 2, 2, 2, 9, 7, 5, 4], dtype=np.int64)
NEUTRAL_ACTION = np.array([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 3, 2, 0], dtype=np.int64)

CURRICULUM_ACTIONS = (
    "noop",
    "face_enemy",
    "walk_forward_face",
    "sprint_forward_face",
    "attack_body",
    "walk_attack_body",
    "sprint_attack_body",
    "strafe_left_attack_body",
    "strafe_right_attack_body",
    "jump_sprint_attack_body",
    "back_attack_body",
)

CURRICULUM_ACTION_COUNT = len(CURRICULUM_ACTIONS)


def validate_action(action: Iterable[int]) -> np.ndarray:
    arr = np.asarray(list(action), dtype=np.int64)
    if arr.shape != ACTION_NVECS.shape:
        raise ValueError("action must have shape %s" % (ACTION_NVECS.shape,))
    if np.any(arr < 0) or np.any(arr >= ACTION_NVECS):
        raise ValueError("action entries must be within MultiDiscrete bounds")
    return arr


def curriculum_action_to_vector(action: int) -> np.ndarray:
    index = int(action)
    if index < 0 or index >= CURRICULUM_ACTION_COUNT:
        raise ValueError("curriculum action must be in [0, %d)" % CURRICULUM_ACTION_COUNT)
    vector = NEUTRAL_ACTION.copy()
    if index == 0:
        return vector
    vector[12] = 2
    if index in (2, 3, 5, 6, 9):
        vector[0] = 1
    if index in (3, 6, 9):
        vector[5] = 1
    if index in (4, 5, 6, 7, 8, 9, 10):
        vector[7] = 1
    if index == 7:
        vector[2] = 1
    if index == 8:
        vector[3] = 1
    if index == 9:
        vector[4] = 1
    if index == 10:
        vector[1] = 1
    return vector


def encode_actions(
    self_action: Iterable[int],
    opponent_action: Iterable[int],
    self_name: str = "ROBO-A0",
    opponent_name: str = "SCRIPT-A0",
) -> dict:
    return {
        self_name: validate_action(self_action).astype(int).tolist(),
        opponent_name: validate_action(opponent_action).astype(int).tolist(),
    }
