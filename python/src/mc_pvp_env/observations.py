from __future__ import annotations

import math
from typing import Any

import numpy as np


OBSERVATION_FIELDS = (
    "self_hp",
    "opponent_hp",
    "rel_x",
    "rel_y",
    "rel_z",
    "self_vel_x",
    "self_vel_y",
    "self_vel_z",
    "opponent_vel_x",
    "opponent_vel_y",
    "opponent_vel_z",
    "self_yaw_sin",
    "self_yaw_cos",
    "self_pitch_sin",
    "self_pitch_cos",
    "opponent_yaw_sin",
    "opponent_yaw_cos",
    "distance",
    "line_of_sight",
    "self_attack_cooldown",
    "opponent_attack_cooldown",
    "self_hurt_time",
    "opponent_hurt_time",
    "self_on_ground",
    "opponent_on_ground",
    "elapsed_ticks_norm",
    "self_hits_norm",
    "opponent_hits_norm",
    "self_hit_delta",
    "opponent_hit_delta",
    "time_remaining_norm",
)


def _player(snapshot: dict[str, Any], name: str) -> dict[str, Any]:
    for player in snapshot.get("players", []):
        if player.get("name") == name:
            return player
    raise ValueError("snapshot missing player %r" % name)


def _sin_cos_degrees(degrees: float) -> tuple[float, float]:
    radians = math.radians(float(degrees))
    return math.sin(radians), math.cos(radians)


def flatten_snapshot(
    snapshot: dict[str, Any],
    self_name: str = "ROBO-A0",
    opponent_name: str = "SCRIPT-A0",
    max_episode_ticks: int = 2400,
) -> np.ndarray:
    self_player = _player(snapshot, self_name)
    opponent = _player(snapshot, opponent_name)

    self_pos = np.asarray(self_player.get("pos", [0.0, 0.0, 0.0]), dtype=np.float32)
    opp_pos = np.asarray(opponent.get("pos", [0.0, 0.0, 0.0]), dtype=np.float32)
    self_vel = np.asarray(self_player.get("vel", [0.0, 0.0, 0.0]), dtype=np.float32)
    opp_vel = np.asarray(opponent.get("vel", [0.0, 0.0, 0.0]), dtype=np.float32)
    rel = opp_pos - self_pos
    distance = float(np.linalg.norm(rel))
    self_yaw_sin, self_yaw_cos = _sin_cos_degrees(self_player.get("yaw", 0.0))
    self_pitch_sin, self_pitch_cos = _sin_cos_degrees(self_player.get("pitch", 0.0))
    opp_yaw_sin, opp_yaw_cos = _sin_cos_degrees(opponent.get("yaw", 0.0))
    elapsed = min(float(snapshot.get("tick", 0)) / float(max_episode_ticks), 1.0)
    target_hits = max(float(snapshot.get("target_hits", 50)), 1.0)
    hit_counts = snapshot.get("hit_counts", {})
    hit_deltas = snapshot.get("hit_deltas", {})
    if not isinstance(hit_counts, dict):
        hit_counts = {}
    if not isinstance(hit_deltas, dict):
        hit_deltas = {}

    values = [
        float(self_player.get("hp", 0.0)) / 20.0,
        float(opponent.get("hp", 0.0)) / 20.0,
        rel[0] / 20.0,
        rel[1] / 10.0,
        rel[2] / 20.0,
        self_vel[0],
        self_vel[1],
        self_vel[2],
        opp_vel[0],
        opp_vel[1],
        opp_vel[2],
        self_yaw_sin,
        self_yaw_cos,
        self_pitch_sin,
        self_pitch_cos,
        opp_yaw_sin,
        opp_yaw_cos,
        min(distance / 20.0, 1.0),
        1.0 if self_player.get("line_of_sight", False) else 0.0,
        float(self_player.get("attack_cooldown", 0.0)),
        float(opponent.get("attack_cooldown", 0.0)),
        float(self_player.get("hurt_time", 0.0)) / 10.0,
        float(opponent.get("hurt_time", 0.0)) / 10.0,
        1.0 if self_player.get("on_ground", False) else 0.0,
        1.0 if opponent.get("on_ground", False) else 0.0,
        elapsed,
        min(float(hit_counts.get(self_name, 0)) / target_hits, 1.0),
        min(float(hit_counts.get(opponent_name, 0)) / target_hits, 1.0),
        float(hit_deltas.get(self_name, 0)),
        float(hit_deltas.get(opponent_name, 0)),
        max(1.0 - elapsed, 0.0),
    ]
    return np.asarray(values, dtype=np.float32)
