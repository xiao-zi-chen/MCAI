from __future__ import annotations

from dataclasses import dataclass

from mc_pvp_env.action_abi import ActionExecutionStatus, SwordPvPActionV1, VirtualHIDFrameV1
from mc_pvp_env.action_codec import decode_sword_action_v1, decode_virtual_hid_frame_v1, encode_sword_action_v1
from mc_pvp_env.protocol import PROTOCOL_VERSION, JsonlClient


@dataclass(frozen=True)
class RestrictedActionResult:
    requested: SwordPvPActionV1
    executed: VirtualHIDFrameV1
    status: ActionExecutionStatus
    status_reasons: tuple[str, ...]
    raw_ack: dict


def apply_restricted_action(
    *,
    bot_client: JsonlClient,
    agent_id: str,
    action: SwordPvPActionV1,
    request_id: str = "restricted-1",
) -> RestrictedActionResult:
    ack = bot_client.request({
        "v": PROTOCOL_VERSION,
        "id": request_id,
        "type": "apply_restricted_action",
        "agent_id": agent_id,
        "action": encode_sword_action_v1(action),
    })
    if ack.get("type") != "apply_restricted_action_ack":
        raise ValueError(f"unexpected restricted action ack: {ack.get('type')} payload={ack!r}")
    requested = decode_sword_action_v1(_dict_field(ack, "action_requested"))
    executed = decode_virtual_hid_frame_v1(_dict_field(ack, "action_executed"))
    status = ActionExecutionStatus(_str_field(ack, "action_execution_status"))
    reasons = tuple(_str_list_field(ack, "action_execution_status_reasons"))
    return RestrictedActionResult(
        requested=requested,
        executed=executed,
        status=status,
        status_reasons=reasons,
        raw_ack=ack,
    )


def _dict_field(payload: dict, key: str) -> dict:
    value = payload.get(key)
    if not isinstance(value, dict):
        raise ValueError(f"{key} must be an object")
    return value


def _str_field(payload: dict, key: str) -> str:
    value = payload.get(key)
    if not isinstance(value, str) or not value:
        raise ValueError(f"{key} must be a non-empty string")
    return value


def _str_list_field(payload: dict, key: str) -> list[str]:
    value = payload.get(key)
    if not isinstance(value, list) or any(not isinstance(item, str) or not item for item in value):
        raise ValueError(f"{key} must be a list of non-empty strings")
    return value
