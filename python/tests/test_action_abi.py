from __future__ import annotations

import unittest

from mc_pvp_env.action_abi import (
    ActionExecutionStatus,
    KeyboardStateV1,
    MouseButtonStateV1,
    RecenterStateV1,
    SwordPvPActionV1,
    VirtualHIDFrameV1,
)
from mc_pvp_env.action_codec import decode_sword_action_v1, decode_virtual_hid_frame_v1


class ActionAbiTest(unittest.TestCase):
    def test_sword_action_round_trips_with_restricted_fields(self) -> None:
        action = SwordPvPActionV1(
            sequence_id=7,
            observation_tick=42,
            observation_time_ms=1000,
            policy_time_ms=1012,
            control_step_ticks=1,
            move_forward=1,
            move_strafe=-1,
            jump_hold=True,
            sprint_hold=True,
            sneak_hold=False,
            attack_pulse=True,
            use_pulse=False,
            mouse_dx=-7,
            mouse_dy=2,
            recenter_request=True,
            recenter_target_x=0.25,
            recenter_target_y=-0.5,
        )

        payload = action.to_dict()
        self.assertEqual(payload["abi_version"], "SwordPvPActionV1")
        self.assertNotIn("target_id", payload)
        self.assertNotIn("look_primitive", payload)

        decoded = decode_sword_action_v1(payload)
        self.assertEqual(decoded, action)

    def test_sword_action_rejects_legacy_targeting_fields(self) -> None:
        payload = SwordPvPActionV1(sequence_id=1).to_dict()
        payload["target_username"] = "SCRIPT-A0"

        with self.assertRaisesRegex(ValueError, "forbidden"):
            decode_sword_action_v1(payload)

    def test_virtual_hid_frame_round_trips_execution_status(self) -> None:
        frame = VirtualHIDFrameV1(
            sequence_id=8,
            source_sequence_id=7,
            execute_tick=43,
            execute_time_ms=1050,
            control_step_ticks=1,
            keys=KeyboardStateV1(forward=True, left=True, sprint=True),
            mouse_buttons=MouseButtonStateV1(attack=True),
            mouse_dx=-5,
            mouse_dy=1,
            wheel_dy=0,
            recenter=RecenterStateV1(
                requested=True,
                busy=True,
                phase="lift",
                target_x=0.25,
                target_y=-0.5,
            ),
            status=ActionExecutionStatus.CLIPPED,
            status_reasons=("mouse_dx_limit",),
        )

        payload = frame.to_dict()
        self.assertEqual(payload["abi_version"], "VirtualHIDFrameV1")
        self.assertEqual(payload["status"], "clipped")

        decoded = decode_virtual_hid_frame_v1(payload)
        self.assertEqual(decoded, frame)


if __name__ == "__main__":
    unittest.main()
