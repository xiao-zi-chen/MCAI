from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from mc_pvp_env.action_abi import (
    ActionExecutionStatus,
    KeyboardStateV1,
    SwordPvPActionV1,
    VirtualHIDFrameV1,
)
from mc_pvp_env.config import EnvConfig
from mc_pvp_env.mocks import MockBotController
from mc_pvp_env.restricted_client import apply_restricted_action
from mc_pvp_env.restricted_dataset import (
    RestrictedDatasetWriter,
    RestrictedEpisodeBuffer,
    load_restricted_dataset,
)


class RestrictedDatasetTests(unittest.TestCase):
    def test_writer_and_loader_round_trip_jsonl_episode(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            writer = RestrictedDatasetWriter(
                tmp,
                config=EnvConfig(),
                backend="mineflayer",
                minecraft_version="auto",
                server_runtime="paper-1.21",
                visual_profile_id="none",
                mouse_profile_id="mineflayer_default_v1",
            )
            buffer = RestrictedEpisodeBuffer("ep-0001", "arena_0")
            buffer.append(
                tick=10,
                observation_tick=8,
                policy_time_ms=1000,
                action_requested=SwordPvPActionV1(sequence_id=1, observation_tick=8, mouse_dx=4),
                action_executed=VirtualHIDFrameV1(
                    sequence_id=1,
                    source_sequence_id=1,
                    execute_tick=10,
                    execute_time_ms=1001,
                    keys=KeyboardStateV1(forward=True),
                    mouse_dx=4,
                ),
                mouse_device_state={"workspace_x": 4, "workspace_y": 0},
                action_queue_depth=0,
                reward=0.25,
                terminated=False,
                truncated=False,
            )

            writer.write_episode(buffer)
            dataset = load_restricted_dataset(tmp)
            rows = dataset.load_episode(dataset.episode_files[0])

            self.assertEqual(dataset.manifest["schema_version"], 2)
            self.assertEqual(dataset.manifest["backend"], "mineflayer")
            self.assertEqual(rows[0].action_requested.sequence_id, 1)
            self.assertEqual(rows[0].action_executed.source_sequence_id, 1)
            self.assertEqual(rows[0].action_execution_status, ActionExecutionStatus.EXECUTED)
            self.assertEqual(rows[0].mouse_device_state["workspace_x"], 4)

    def test_loader_rejects_missing_backend(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "ep-0001.jsonl").write_text("", encoding="utf-8")
            (root / "manifest.json").write_text(json.dumps({
                "schema_version": 2,
                "action_abi_version": "SwordPvPActionV1",
                "executed_action_abi_version": "VirtualHIDFrameV1",
                "minecraft_version": "auto",
                "server_runtime": "paper-1.21",
                "visual_profile_id": "none",
                "mouse_profile_id": "mineflayer_default_v1",
                "env_config": {},
                "git_commit": None,
                "episodes": [{"episode_id": "ep-0001", "arena_id": "arena_0", "file": "ep-0001.jsonl", "steps": 0}],
            }), encoding="utf-8")

            with self.assertRaisesRegex(ValueError, "backend"):
                load_restricted_dataset(root)

    def test_loader_rejects_missing_action_records(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            writer = RestrictedDatasetWriter(
                tmp,
                config=EnvConfig(),
                backend="mineflayer",
                minecraft_version="auto",
                server_runtime="paper-1.21",
                visual_profile_id="none",
                mouse_profile_id="mineflayer_default_v1",
            )
            writer.write_manifest()
            root = Path(tmp)
            (root / "ep-bad.jsonl").write_text(json.dumps({
                "tick": 1,
                "observation_tick": 1,
                "policy_time_ms": 1,
                "action_executed": VirtualHIDFrameV1().to_dict(),
                "action_execution_status": "executed",
                "action_execution_status_reasons": [],
                "mouse_device_state": {},
                "action_queue_depth": 0,
                "reward": 0.0,
                "terminated": False,
                "truncated": False,
                "episode_id": "ep-bad",
                "arena_id": "arena_0",
            }) + "\n", encoding="utf-8")
            manifest = json.loads((root / "manifest.json").read_text(encoding="utf-8"))
            manifest["episodes"] = [{"episode_id": "ep-bad", "arena_id": "arena_0", "file": "ep-bad.jsonl", "steps": 1}]
            (root / "manifest.json").write_text(json.dumps(manifest), encoding="utf-8")

            dataset = load_restricted_dataset(root)
            with self.assertRaisesRegex(ValueError, "action_requested"):
                dataset.load_episode(dataset.episode_files[0])

    def test_buffer_records_apply_restricted_action_ack_fields(self) -> None:
        bot = MockBotController()
        client = bot.client()
        try:
            with tempfile.TemporaryDirectory() as tmp:
                action = SwordPvPActionV1(
                    sequence_id=5,
                    observation_tick=12,
                    policy_time_ms=3456,
                    control_step_ticks=2,
                    attack_pulse=True,
                    mouse_dx=7,
                    mouse_dy=-3,
                )
                result = apply_restricted_action(
                    bot_client=client,
                    agent_id="ROBO-A0",
                    action=action,
                    request_id="restricted-test",
                )
                buffer = RestrictedEpisodeBuffer("ep-ack", "arena_0")
                buffer.append_action_result(
                    tick=14,
                    result=result,
                    mouse_device_state={"workspace_x": 7, "workspace_y": -3},
                    action_queue_depth=0,
                    reward=0.5,
                    terminated=False,
                    truncated=False,
                )
                writer = RestrictedDatasetWriter(
                    tmp,
                    config=EnvConfig(),
                    backend="herobot",
                    minecraft_version="1.21.11",
                    server_runtime="fabric-1.21.11",
                    visual_profile_id="none",
                    mouse_profile_id="herobot_relative_v1",
                )

                writer.write_episode(buffer)
                dataset = load_restricted_dataset(tmp)
                rows = dataset.load_episode(dataset.episode_files[0])

                self.assertEqual(dataset.manifest["backend"], "herobot")
                self.assertEqual(rows[0].action_requested.sequence_id, 5)
                self.assertEqual(rows[0].action_executed.source_sequence_id, 5)
                self.assertEqual(rows[0].action_execution_status, result.status)
                self.assertEqual(tuple(rows[0].action_execution_status_reasons), result.status_reasons)
        finally:
            client.close()
            bot.close()


if __name__ == "__main__":
    unittest.main()
