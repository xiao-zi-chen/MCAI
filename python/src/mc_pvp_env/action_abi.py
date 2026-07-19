from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Any


SWORD_PVP_ACTION_V1 = "SwordPvPActionV1"
VIRTUAL_HID_FRAME_V1 = "VirtualHIDFrameV1"
MOUSE_COUNT_LIMIT = 32767
FORBIDDEN_SWORD_ACTION_FIELDS = frozenset(
    {
        "target_id",
        "target_username",
        "entity_id",
        "attack_entity",
        "look_at",
        "lookAt",
        "look_primitive",
        "yaw",
        "pitch",
        "absolute_yaw",
        "absolute_pitch",
    }
)


class ActionExecutionStatus(str, Enum):
    EXECUTED = "executed"
    CLIPPED = "clipped"
    DELAYED = "delayed"
    DROPPED = "dropped"
    MODIFIED = "modified"


@dataclass(frozen=True)
class SwordPvPActionV1:
    sequence_id: int = 0
    observation_tick: int = 0
    observation_time_ms: int = 0
    policy_time_ms: int = 0
    control_step_ticks: int = 1
    move_forward: int = 0
    move_strafe: int = 0
    jump_hold: bool = False
    sprint_hold: bool = False
    sneak_hold: bool = False
    attack_pulse: bool = False
    use_pulse: bool = False
    mouse_dx: int = 0
    mouse_dy: int = 0
    recenter_request: bool = False
    recenter_target_x: float = 0.0
    recenter_target_y: float = 0.0

    def __post_init__(self) -> None:
        _require_non_negative_int("sequence_id", self.sequence_id)
        _require_non_negative_int("observation_tick", self.observation_tick)
        _require_non_negative_int("observation_time_ms", self.observation_time_ms)
        _require_non_negative_int("policy_time_ms", self.policy_time_ms)
        _require_positive_int("control_step_ticks", self.control_step_ticks)
        _require_direction("move_forward", self.move_forward)
        _require_direction("move_strafe", self.move_strafe)
        for field_name in ("jump_hold", "sprint_hold", "sneak_hold", "attack_pulse", "use_pulse", "recenter_request"):
            _require_bool(field_name, getattr(self, field_name))
        _require_mouse_count("mouse_dx", self.mouse_dx)
        _require_mouse_count("mouse_dy", self.mouse_dy)
        _require_normalized("recenter_target_x", self.recenter_target_x)
        _require_normalized("recenter_target_y", self.recenter_target_y)

    def to_dict(self) -> dict[str, Any]:
        return {
            "abi_version": SWORD_PVP_ACTION_V1,
            "sequence_id": self.sequence_id,
            "observation_tick": self.observation_tick,
            "observation_time_ms": self.observation_time_ms,
            "policy_time_ms": self.policy_time_ms,
            "control_step_ticks": self.control_step_ticks,
            "move_forward": self.move_forward,
            "move_strafe": self.move_strafe,
            "jump_hold": self.jump_hold,
            "sprint_hold": self.sprint_hold,
            "sneak_hold": self.sneak_hold,
            "attack_pulse": self.attack_pulse,
            "use_pulse": self.use_pulse,
            "mouse_dx": self.mouse_dx,
            "mouse_dy": self.mouse_dy,
            "recenter_request": self.recenter_request,
            "recenter_target_x": self.recenter_target_x,
            "recenter_target_y": self.recenter_target_y,
        }

    @classmethod
    def from_dict(cls, payload: dict[str, Any]) -> "SwordPvPActionV1":
        _require_abi(payload, SWORD_PVP_ACTION_V1)
        forbidden = sorted(FORBIDDEN_SWORD_ACTION_FIELDS.intersection(payload))
        if forbidden:
            raise ValueError(f"forbidden SwordPvPActionV1 fields: {forbidden}")
        return cls(
            sequence_id=_int_value(payload, "sequence_id", 0),
            observation_tick=_int_value(payload, "observation_tick", 0),
            observation_time_ms=_int_value(payload, "observation_time_ms", 0),
            policy_time_ms=_int_value(payload, "policy_time_ms", 0),
            control_step_ticks=_int_value(payload, "control_step_ticks", 1),
            move_forward=_int_value(payload, "move_forward", 0),
            move_strafe=_int_value(payload, "move_strafe", 0),
            jump_hold=_bool_value(payload, "jump_hold", False),
            sprint_hold=_bool_value(payload, "sprint_hold", False),
            sneak_hold=_bool_value(payload, "sneak_hold", False),
            attack_pulse=_bool_value(payload, "attack_pulse", False),
            use_pulse=_bool_value(payload, "use_pulse", False),
            mouse_dx=_int_value(payload, "mouse_dx", 0),
            mouse_dy=_int_value(payload, "mouse_dy", 0),
            recenter_request=_bool_value(payload, "recenter_request", False),
            recenter_target_x=_float_value(payload, "recenter_target_x", 0.0),
            recenter_target_y=_float_value(payload, "recenter_target_y", 0.0),
        )


@dataclass(frozen=True)
class KeyboardStateV1:
    forward: bool = False
    back: bool = False
    left: bool = False
    right: bool = False
    jump: bool = False
    sprint: bool = False
    sneak: bool = False

    def __post_init__(self) -> None:
        for field_name in ("forward", "back", "left", "right", "jump", "sprint", "sneak"):
            _require_bool(field_name, getattr(self, field_name))

    def to_dict(self) -> dict[str, bool]:
        return {
            "forward": self.forward,
            "back": self.back,
            "left": self.left,
            "right": self.right,
            "jump": self.jump,
            "sprint": self.sprint,
            "sneak": self.sneak,
        }

    @classmethod
    def from_dict(cls, payload: dict[str, Any] | None) -> "KeyboardStateV1":
        data = payload or {}
        return cls(
            forward=_bool_value(data, "forward", False),
            back=_bool_value(data, "back", False),
            left=_bool_value(data, "left", False),
            right=_bool_value(data, "right", False),
            jump=_bool_value(data, "jump", False),
            sprint=_bool_value(data, "sprint", False),
            sneak=_bool_value(data, "sneak", False),
        )


@dataclass(frozen=True)
class MouseButtonStateV1:
    attack: bool = False
    use: bool = False

    def __post_init__(self) -> None:
        _require_bool("attack", self.attack)
        _require_bool("use", self.use)

    def to_dict(self) -> dict[str, bool]:
        return {"attack": self.attack, "use": self.use}

    @classmethod
    def from_dict(cls, payload: dict[str, Any] | None) -> "MouseButtonStateV1":
        data = payload or {}
        return cls(
            attack=_bool_value(data, "attack", False),
            use=_bool_value(data, "use", False),
        )


@dataclass(frozen=True)
class RecenterStateV1:
    requested: bool = False
    busy: bool = False
    phase: str = "idle"
    target_x: float = 0.0
    target_y: float = 0.0

    def __post_init__(self) -> None:
        _require_bool("requested", self.requested)
        _require_bool("busy", self.busy)
        if not isinstance(self.phase, str) or not self.phase:
            raise ValueError("phase must be a non-empty string")
        _require_normalized("target_x", self.target_x)
        _require_normalized("target_y", self.target_y)

    def to_dict(self) -> dict[str, Any]:
        return {
            "requested": self.requested,
            "busy": self.busy,
            "phase": self.phase,
            "target_x": self.target_x,
            "target_y": self.target_y,
        }

    @classmethod
    def from_dict(cls, payload: dict[str, Any] | None) -> "RecenterStateV1":
        data = payload or {}
        return cls(
            requested=_bool_value(data, "requested", False),
            busy=_bool_value(data, "busy", False),
            phase=_str_value(data, "phase", "idle"),
            target_x=_float_value(data, "target_x", 0.0),
            target_y=_float_value(data, "target_y", 0.0),
        )


@dataclass(frozen=True)
class VirtualHIDFrameV1:
    sequence_id: int = 0
    source_sequence_id: int = 0
    execute_tick: int = 0
    execute_time_ms: int = 0
    control_step_ticks: int = 1
    keys: KeyboardStateV1 = field(default_factory=KeyboardStateV1)
    mouse_buttons: MouseButtonStateV1 = field(default_factory=MouseButtonStateV1)
    mouse_dx: int = 0
    mouse_dy: int = 0
    wheel_dy: int = 0
    recenter: RecenterStateV1 = field(default_factory=RecenterStateV1)
    status: ActionExecutionStatus = ActionExecutionStatus.EXECUTED
    status_reasons: tuple[str, ...] = ()

    def __post_init__(self) -> None:
        _require_non_negative_int("sequence_id", self.sequence_id)
        _require_non_negative_int("source_sequence_id", self.source_sequence_id)
        _require_non_negative_int("execute_tick", self.execute_tick)
        _require_non_negative_int("execute_time_ms", self.execute_time_ms)
        _require_positive_int("control_step_ticks", self.control_step_ticks)
        if not isinstance(self.keys, KeyboardStateV1):
            raise ValueError("keys must be KeyboardStateV1")
        if not isinstance(self.mouse_buttons, MouseButtonStateV1):
            raise ValueError("mouse_buttons must be MouseButtonStateV1")
        if not isinstance(self.recenter, RecenterStateV1):
            raise ValueError("recenter must be RecenterStateV1")
        _require_mouse_count("mouse_dx", self.mouse_dx)
        _require_mouse_count("mouse_dy", self.mouse_dy)
        _require_int("wheel_dy", self.wheel_dy)
        if not isinstance(self.status, ActionExecutionStatus):
            raise ValueError("status must be ActionExecutionStatus")
        if any(not isinstance(reason, str) or not reason for reason in self.status_reasons):
            raise ValueError("status_reasons must contain non-empty strings")

    def to_dict(self) -> dict[str, Any]:
        return {
            "abi_version": VIRTUAL_HID_FRAME_V1,
            "sequence_id": self.sequence_id,
            "source_sequence_id": self.source_sequence_id,
            "execute_tick": self.execute_tick,
            "execute_time_ms": self.execute_time_ms,
            "control_step_ticks": self.control_step_ticks,
            "keys": self.keys.to_dict(),
            "mouse_buttons": self.mouse_buttons.to_dict(),
            "mouse_dx": self.mouse_dx,
            "mouse_dy": self.mouse_dy,
            "wheel_dy": self.wheel_dy,
            "recenter": self.recenter.to_dict(),
            "status": self.status.value,
            "status_reasons": list(self.status_reasons),
        }

    @classmethod
    def from_dict(cls, payload: dict[str, Any]) -> "VirtualHIDFrameV1":
        _require_abi(payload, VIRTUAL_HID_FRAME_V1)
        return cls(
            sequence_id=_int_value(payload, "sequence_id", 0),
            source_sequence_id=_int_value(payload, "source_sequence_id", 0),
            execute_tick=_int_value(payload, "execute_tick", 0),
            execute_time_ms=_int_value(payload, "execute_time_ms", 0),
            control_step_ticks=_int_value(payload, "control_step_ticks", 1),
            keys=KeyboardStateV1.from_dict(_dict_value(payload, "keys")),
            mouse_buttons=MouseButtonStateV1.from_dict(_dict_value(payload, "mouse_buttons")),
            mouse_dx=_int_value(payload, "mouse_dx", 0),
            mouse_dy=_int_value(payload, "mouse_dy", 0),
            wheel_dy=_int_value(payload, "wheel_dy", 0),
            recenter=RecenterStateV1.from_dict(_dict_value(payload, "recenter")),
            status=ActionExecutionStatus(_str_value(payload, "status", ActionExecutionStatus.EXECUTED.value)),
            status_reasons=tuple(_str_list_value(payload, "status_reasons")),
        )


def _require_abi(payload: dict[str, Any], expected: str) -> None:
    if payload.get("abi_version") != expected:
        raise ValueError(f"abi_version must be {expected}")


def _require_int(name: str, value: int) -> None:
    if not isinstance(value, int) or isinstance(value, bool):
        raise ValueError(f"{name} must be an integer")


def _require_non_negative_int(name: str, value: int) -> None:
    _require_int(name, value)
    if value < 0:
        raise ValueError(f"{name} must be non-negative")


def _require_positive_int(name: str, value: int) -> None:
    _require_int(name, value)
    if value < 1:
        raise ValueError(f"{name} must be positive")


def _require_direction(name: str, value: int) -> None:
    _require_int(name, value)
    if value not in (-1, 0, 1):
        raise ValueError(f"{name} must be -1, 0, or 1")


def _require_bool(name: str, value: bool) -> None:
    if not isinstance(value, bool):
        raise ValueError(f"{name} must be a bool")


def _require_mouse_count(name: str, value: int) -> None:
    _require_int(name, value)
    if abs(value) > MOUSE_COUNT_LIMIT:
        raise ValueError(f"{name} exceeds mouse count serialization limit")


def _require_normalized(name: str, value: float) -> None:
    if not isinstance(value, (int, float)) or isinstance(value, bool):
        raise ValueError(f"{name} must be a number")
    if float(value) < -1.0 or float(value) > 1.0:
        raise ValueError(f"{name} must be in [-1.0, 1.0]")


def _int_value(payload: dict[str, Any], name: str, fallback: int) -> int:
    value = payload.get(name, fallback)
    _require_int(name, value)
    return value


def _bool_value(payload: dict[str, Any], name: str, fallback: bool) -> bool:
    value = payload.get(name, fallback)
    _require_bool(name, value)
    return value


def _float_value(payload: dict[str, Any], name: str, fallback: float) -> float:
    value = payload.get(name, fallback)
    _require_normalized(name, value)
    return float(value)


def _str_value(payload: dict[str, Any], name: str, fallback: str) -> str:
    value = payload.get(name, fallback)
    if not isinstance(value, str) or not value:
        raise ValueError(f"{name} must be a non-empty string")
    return value


def _dict_value(payload: dict[str, Any], name: str) -> dict[str, Any] | None:
    value = payload.get(name)
    if value is None:
        return None
    if not isinstance(value, dict):
        raise ValueError(f"{name} must be an object")
    return value


def _str_list_value(payload: dict[str, Any], name: str) -> list[str]:
    value = payload.get(name, [])
    if not isinstance(value, list):
        raise ValueError(f"{name} must be a list")
    if any(not isinstance(item, str) or not item for item in value):
        raise ValueError(f"{name} must contain non-empty strings")
    return value
