from __future__ import annotations

from typing import Any

from mc_pvp_env.action_abi import SwordPvPActionV1, VirtualHIDFrameV1


def encode_sword_action_v1(action: SwordPvPActionV1) -> dict[str, Any]:
    return action.to_dict()


def decode_sword_action_v1(payload: dict[str, Any]) -> SwordPvPActionV1:
    return SwordPvPActionV1.from_dict(payload)


def encode_virtual_hid_frame_v1(frame: VirtualHIDFrameV1) -> dict[str, Any]:
    return frame.to_dict()


def decode_virtual_hid_frame_v1(payload: dict[str, Any]) -> VirtualHIDFrameV1:
    return VirtualHIDFrameV1.from_dict(payload)
