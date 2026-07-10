from __future__ import annotations

import importlib.util
import json
import tempfile
import unittest
from pathlib import Path

import numpy as np

from mc_pvp_env.config import EnvConfig
from mc_pvp_env.demo_dataset import load_demo_dataset
from mc_pvp_env.demo_writer import DemoEpisodeBuffer, DemoWriter
from mc_pvp_env.expert import HeuristicExpertPolicy, MovementOnlyTargetPolicy
from mc_pvp_env.observations import OBSERVATION_FIELDS


class DemoDatasetTests(unittest.TestCase):
    def test_loader_rejects_incompatible_action_mode(self):
        with tempfile.TemporaryDirectory() as tmp:
            _write_tiny_dataset(tmp)
            manifest_path = Path(tmp) / "manifest.json"
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
            manifest["action_mode"] = "multi_discrete"
            manifest_path.write_text(json.dumps(manifest), encoding="utf-8")
            with self.assertRaises(ValueError):
                load_demo_dataset(tmp)

    def test_loader_concatenates_arrays(self):
        with tempfile.TemporaryDirectory() as tmp:
            _write_tiny_dataset(tmp)
            dataset = load_demo_dataset(tmp)
            arrays = dataset.load_arrays()
            self.assertEqual(arrays["obs"].shape, (4, len(OBSERVATION_FIELDS)))
            self.assertEqual(arrays["action"].shape, (4,))

    @unittest.skipUnless(importlib.util.find_spec("torch") is not None, "torch not installed")
    def test_bc_tiny_dataset_trains(self):
        from mc_pvp_env.train_bc import train_behavior_cloning

        with tempfile.TemporaryDirectory() as tmp:
            data = Path(tmp) / "data"
            out = Path(tmp) / "bc"
            _write_tiny_dataset(data)
            metrics = train_behavior_cloning(data, out, epochs=3, batch_size=2, hidden_size=16)
            self.assertTrue((out / "bc_policy.pt").exists())
            self.assertEqual(metrics["train_transitions"], 2)
            self.assertEqual(metrics["val_transitions"], 2)


def _write_tiny_dataset(path: str | Path) -> None:
    writer = DemoWriter(
        path,
        config=EnvConfig(),
        seed=123,
        expert_policy=HeuristicExpertPolicy(),
        target_policy=MovementOnlyTargetPolicy(),
    )
    for episode_index in range(2):
        buffer = DemoEpisodeBuffer(f"ep-{episode_index:04d}", "arena_0")
        for step in range(2):
            obs = np.zeros(len(OBSERVATION_FIELDS), dtype=np.float32)
            obs[17] = 0.1 + 0.1 * step
            action = 5 if step == 0 else 2
            buffer.append(
                obs=obs,
                action=action,
                action_vector=[0, 0, 0, 0, 0, 0, 0, int(action == 5), 0, 0, 3, 2, 2],
                next_obs=obs + 0.01,
                reward=0.1,
                terminated=step == 1,
                truncated=False,
                tick=step,
            )
        writer.write_episode(buffer)


if __name__ == "__main__":
    unittest.main()
