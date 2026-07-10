from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
import json


@dataclass(frozen=True)
class EnvConfig:
    host: str = "127.0.0.1"
    plugin_port: int = 25580
    bot_port: int = 25581
    connect_timeout_seconds: float = 5.0
    request_timeout_seconds: float = 2.0
    action_repeat_ticks: int = 2
    max_episode_ticks: int = 2400
    arena: str = "default"
    arena_count: int = 1
    self_name: str = "ROBO-A0"
    opponent_name: str = "SCRIPT-A0"
    self_name_template: str = "ROBO-A{index}"
    opponent_name_template: str = "SCRIPT-A{index}"
    combat_mode: str = "hit_count"
    target_hits: int = 50
    time_penalty_per_step: float = -0.001
    self_hit_reward_scale: float = 1.0
    opponent_hit_penalty_scale: float = 2.0
    post_hit_spacing_reward: float = 0.003
    danger_close_penalty: float = 0.002
    safe_distance_min: float = 2.4
    safe_distance_max: float = 3.8
    win_reward: float = 1.0
    loss_reward: float = -1.0
    timeout_reward: float = -0.25
    action_mode: str = "curriculum_discrete"

    @classmethod
    def from_json(cls, path: str | Path) -> "EnvConfig":
        with Path(path).open("r", encoding="utf-8") as handle:
            data = json.load(handle)
        allowed = cls.__dataclass_fields__.keys()
        return cls(**{key: value for key, value in data.items() if key in allowed})

    def arena_id(self, index: int) -> str:
        if index == 0 and self.arena not in ("", "default"):
            return self.arena
        return f"arena_{index}"

    def self_name_for(self, index: int) -> str:
        if index == 0 and self.self_name:
            return self.self_name
        return self.self_name_template.format(index=index)

    def opponent_name_for(self, index: int) -> str:
        if index == 0 and self.opponent_name:
            return self.opponent_name
        return self.opponent_name_template.format(index=index)

    def for_arena(self, index: int) -> "EnvConfig":
        data = {field: getattr(self, field) for field in self.__dataclass_fields__}
        data["arena"] = self.arena_id(index)
        data["self_name"] = self.self_name_for(index)
        data["opponent_name"] = self.opponent_name_for(index)
        return EnvConfig(**data)

    def bot_specs(self) -> list[dict[str, str]]:
        specs: list[dict[str, str]] = []
        for index in range(max(1, self.arena_count)):
            arena_id = self.arena_id(index)
            specs.append({
                "agent_id": self.self_name_for(index),
                "username": self.self_name_for(index),
                "arena_id": arena_id,
                "role": "learner",
            })
            specs.append({
                "agent_id": self.opponent_name_for(index),
                "username": self.opponent_name_for(index),
                "arena_id": arena_id,
                "role": "scripted",
            })
        return specs
