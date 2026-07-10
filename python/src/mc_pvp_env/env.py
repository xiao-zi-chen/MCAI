from __future__ import annotations

import itertools
from typing import Any

import numpy as np

from mc_pvp_env.actions import (
    ACTION_NVECS,
    CURRICULUM_ACTION_COUNT,
    NEUTRAL_ACTION,
    curriculum_action_to_vector,
    encode_actions,
    validate_action,
)
from mc_pvp_env.config import EnvConfig
from mc_pvp_env.gym_compat import gym, spaces
from mc_pvp_env.observations import OBSERVATION_FIELDS, flatten_snapshot
from mc_pvp_env.protocol import JsonlClient, PROTOCOL_VERSION


class MinecraftPvpEnv(gym.Env):
    metadata = {"render_modes": []}

    def __init__(self, config: EnvConfig | None = None, plugin_client=None, bot_client=None, opponent_policy=None):
        self.config = config or EnvConfig()
        self.plugin = plugin_client or JsonlClient(
            self.config.host,
            self.config.plugin_port,
            self.config.request_timeout_seconds,
            "plugin",
        )
        self.bot = bot_client or JsonlClient(
            self.config.host,
            self.config.bot_port,
            self.config.request_timeout_seconds,
            "bot-controller",
        )
        self.observation_space = spaces.Box(
            low=-np.inf,
            high=np.inf,
            shape=(len(OBSERVATION_FIELDS),),
            dtype=np.float32,
        )
        if self.config.action_mode == "curriculum_discrete":
            self.action_space = spaces.Discrete(CURRICULUM_ACTION_COUNT)
        else:
            self.action_space = spaces.MultiDiscrete(ACTION_NVECS)
        self._ids = itertools.count(1)
        self._episode_idx = 0
        self._last_snapshot: dict[str, Any] | None = None
        self.opponent_policy = opponent_policy

    def close(self) -> None:
        self.plugin.close()
        self.bot.close()

    def reset(self, *, seed=None, options=None):
        self._episode_idx += 1
        episode_id = "ep-%04d" % self._episode_idx
        reset_msg = {
            "v": PROTOCOL_VERSION,
            "id": self._next_id("p"),
            "type": "reset",
            "episode_id": episode_id,
            "seed": seed,
            "arena": self.config.arena,
            "arena_id": self.config.arena,
            "combat_mode": self.config.combat_mode,
            "target_hits": self.config.target_hits,
        }
        plugin_reply = self.plugin.request(reset_msg)
        start_reply = self.plugin.request({
            "v": PROTOCOL_VERSION,
            "id": self._next_id("p"),
            "type": "start_episode",
            "episode_id": episode_id,
            "arena_id": self.config.arena,
        })
        bot_reply = self.bot.request({
            "v": PROTOCOL_VERSION,
            "id": self._next_id("b"),
            "type": "ready_request",
        })
        snapshot = plugin_reply.get("snapshot")
        if not isinstance(snapshot, dict):
            snapshot = self.plugin.request({
                "v": PROTOCOL_VERSION,
                "id": self._next_id("p"),
                "type": "snapshot_request",
                "arena_id": self.config.arena,
            })
        self._last_snapshot = snapshot
        if self.opponent_policy is not None and hasattr(self.opponent_policy, "reset"):
            self.opponent_policy.reset(seed=seed, snapshot=snapshot)
        obs = flatten_snapshot(
            snapshot,
            self.config.self_name,
            self.config.opponent_name,
            self.config.max_episode_ticks,
        )
        return obs, {"episode_id": episode_id, "snapshot": snapshot, "bot_status": bot_reply, "start_status": start_reply}

    def step(self, action):
        self_action = self._encode_policy_action(action)
        opponent_action = self._opponent_action()
        return self._step_actions(self_action, opponent_action)

    def step_pair(self, self_action, opponent_action):
        """Collector/eval path that controls both bots for one environment step."""
        return self._step_actions(
            self._encode_policy_action(self_action),
            self._encode_pair_action(opponent_action),
        )

    def _step_actions(self, self_action: np.ndarray, opponent_action: np.ndarray):
        tick = int(self._last_snapshot.get("tick", 0)) if self._last_snapshot else 0
        bot_reply = self.bot.request({
            "v": PROTOCOL_VERSION,
            "id": self._next_id("b"),
            "type": "act",
            "tick": tick,
            "arena_id": self.config.arena,
            "repeat_ticks": self.config.action_repeat_ticks,
            "actions": encode_actions(self_action, opponent_action, self.config.self_name, self.config.opponent_name),
        })
        snapshot = self.plugin.request({
            "v": PROTOCOL_VERSION,
            "id": self._next_id("p"),
            "type": "wait_tick",
            "arena_id": self.config.arena,
            "after_tick": tick,
        })
        self._last_snapshot = snapshot
        obs = flatten_snapshot(
            snapshot,
            self.config.self_name,
            self.config.opponent_name,
            self.config.max_episode_ticks,
        )
        reward = self._reward(snapshot)
        terminated = snapshot.get("phase") in ("self_win", "opponent_win", "draw")
        truncated = int(snapshot.get("tick", 0)) >= self.config.max_episode_ticks
        info = {"snapshot": snapshot, "bot_status": bot_reply}
        return obs, float(reward), bool(terminated), bool(truncated), info

    def _encode_policy_action(self, action) -> np.ndarray:
        if self.config.action_mode == "curriculum_discrete":
            return curriculum_action_to_vector(int(action))
        return validate_action(action)

    def _encode_pair_action(self, action) -> np.ndarray:
        arr = np.asarray(action)
        if arr.shape == ACTION_NVECS.shape:
            return validate_action(action)
        return self._encode_policy_action(action)

    def _reward(self, snapshot: dict[str, Any]) -> float:
        hit_deltas = snapshot.get("hit_deltas")
        if isinstance(hit_deltas, dict):
            target_hits = max(float(snapshot.get("target_hits", self.config.target_hits)), 1.0)
            self_hit_delta = float(hit_deltas.get(self.config.self_name, 0))
            opponent_hit_delta = float(hit_deltas.get(self.config.opponent_name, 0))
            reward = (
                self.config.self_hit_reward_scale * self_hit_delta / target_hits
                - self.config.opponent_hit_penalty_scale * opponent_hit_delta / target_hits
                + self.config.time_penalty_per_step
                + self._spacing_reward(snapshot)
            )
            if snapshot.get("phase") == "self_win":
                reward += self.config.win_reward
            elif snapshot.get("phase") == "opponent_win":
                reward += self.config.loss_reward
            elif snapshot.get("done_reason") == "timeout" or snapshot.get("phase") == "draw":
                reward += self.config.timeout_reward
            return reward

        players = {p.get("name"): p for p in snapshot.get("players", [])}
        self_hp = float(players.get(self.config.self_name, {}).get("hp", 0.0))
        opp_hp = float(players.get(self.config.opponent_name, {}).get("hp", 0.0))
        reward = (self_hp - opp_hp) / 20.0
        if snapshot.get("phase") == "self_win":
            reward += 1.0
        elif snapshot.get("phase") == "opponent_win":
            reward -= 1.0
        return reward

    def _spacing_reward(self, snapshot: dict[str, Any]) -> float:
        players = {p.get("name"): p for p in snapshot.get("players", [])}
        self_player = players.get(self.config.self_name)
        opponent = players.get(self.config.opponent_name)
        if not isinstance(self_player, dict) or not isinstance(opponent, dict):
            return 0.0
        if not bool(self_player.get("line_of_sight", False)):
            return 0.0

        self_pos = np.asarray(self_player.get("pos", [0.0, 0.0, 0.0]), dtype=np.float32)
        opp_pos = np.asarray(opponent.get("pos", [0.0, 0.0, 0.0]), dtype=np.float32)
        distance = float(np.linalg.norm(opp_pos - self_pos))
        safe_min = float(self.config.safe_distance_min)
        safe_max = float(self.config.safe_distance_max)
        opponent_hurt = float(opponent.get("hurt_time", 0.0)) > 0.0
        opponent_ready = float(opponent.get("attack_cooldown", 0.0)) >= 0.85

        if opponent_hurt:
            if safe_min <= distance <= safe_max:
                return float(self.config.post_hit_spacing_reward)
            if distance < safe_min:
                return -float(self.config.danger_close_penalty)
        if opponent_ready and distance < safe_min:
            return -float(self.config.danger_close_penalty)
        return 0.0

    def _next_id(self, prefix: str) -> str:
        return "%s-%d" % (prefix, next(self._ids))

    def _opponent_action(self) -> np.ndarray:
        if self.opponent_policy is None:
            return NEUTRAL_ACTION
        obs = None
        if self._last_snapshot is not None:
            obs = flatten_snapshot(
                self._last_snapshot,
                self.config.opponent_name,
                self.config.self_name,
                self.config.max_episode_ticks,
            )
        return self._encode_pair_action(self.opponent_policy.action_vector(obs, self._last_snapshot))
