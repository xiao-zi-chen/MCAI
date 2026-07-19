import json
import tempfile
import unittest
from pathlib import Path

import numpy as np

from mc_pvp_env.config import EnvConfig
from mc_pvp_env.duel_recording import (
    DUEL_RECORD_SCHEMA_VERSION,
    DuelRecordEpisodeBuffer,
    DuelRecordWriter,
    infer_action_vector,
    load_duel_record_dataset,
)
from mc_pvp_env.mocks import make_snapshot
from mc_pvp_env.observations import OBSERVATION_FIELDS


class DuelRecordingTests(unittest.TestCase):
    def test_writer_writes_episode_sidecar_and_manifest(self):
        with tempfile.TemporaryDirectory() as tmp:
            writer = DuelRecordWriter(tmp, config=EnvConfig())
            buffer = DuelRecordEpisodeBuffer(
                "duel-test",
                "arena_0",
                actor_names=["ROBO-A0", "SCRIPT-A0"],
                actor_roles=["robo", "human"],
                mode="player_duel",
                difficulty="champion",
            )
            pre = make_snapshot(0)
            post = make_snapshot(2)
            buffer.append_step(
                pre_snapshot=pre,
                post_snapshot=post,
                applied_actions={"ROBO-A0": [0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 3, 2, 2]},
                action_ids={"ROBO-A0": 4},
                action_sources={"ROBO-A0": "policy", "SCRIPT-A0": "human_inferred"},
            )

            path = writer.write_episode(buffer)

            self.assertTrue(path.exists())
            self.assertTrue((Path(tmp) / "duel-test.jsonl").exists())
            manifest = json.loads((Path(tmp) / "manifest.json").read_text(encoding="utf-8"))
            self.assertEqual(manifest["schema_version"], DUEL_RECORD_SCHEMA_VERSION)
            dataset = load_duel_record_dataset(tmp)
            arrays = dataset.load_episode(path)
            self.assertEqual(arrays["obs"].shape, (1, 2, len(OBSERVATION_FIELDS)))
            self.assertEqual(arrays["action_vector"].shape, (1, 2, 13))
            self.assertEqual(arrays["action_id"][0, 0], 4)
            self.assertEqual(str(arrays["action_source"][0, 1]), "human_inferred")

    def test_loader_rejects_incompatible_schema(self):
        with tempfile.TemporaryDirectory() as tmp:
            writer = DuelRecordWriter(tmp, config=EnvConfig())
            buffer = DuelRecordEpisodeBuffer(
                "duel-test",
                "arena_0",
                actor_names=["ROBO-A0", "SCRIPT-A0"],
                actor_roles=["robo", "human"],
                mode="player_duel",
                difficulty="bc",
            )
            buffer.append_step(pre_snapshot=make_snapshot(0), post_snapshot=make_snapshot(2))
            writer.write_episode(buffer)
            manifest_path = Path(tmp) / "manifest.json"
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
            manifest["schema_version"] = 999
            manifest_path.write_text(json.dumps(manifest), encoding="utf-8")

            with self.assertRaises(ValueError):
                load_duel_record_dataset(tmp)

    def test_infer_action_vector_from_state_and_events(self):
        pre = make_snapshot(0)
        post = make_snapshot(2)
        _player(pre, "SCRIPT-A0")["yaw"] = 0.0
        player = _player(post, "SCRIPT-A0")
        player["pos"] = [1.0, 64.0, 0.2]
        player["yaw"] = 35.0
        player["pitch"] = 10.0
        player["sprinting"] = True
        player["selected_hotbar_slot"] = 3
        post["events"] = ["hit:SCRIPT-A0:ROBO-A0:1"]

        action = infer_action_vector(pre, post, "SCRIPT-A0")

        self.assertEqual(action[0], 1)
        self.assertEqual(action[5], 1)
        self.assertEqual(action[7], 1)
        self.assertEqual(action[9], 3)
        self.assertGreater(action[10], 3)
        self.assertGreater(action[11], 2)


def _player(snapshot, name):
    for player in snapshot["players"]:
        if player["name"] == name:
            return player
    raise AssertionError(name)


if __name__ == "__main__":
    unittest.main()
