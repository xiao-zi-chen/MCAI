import json
import tempfile
import unittest
from pathlib import Path

import numpy as np

from mc_pvp_env.collect_demos import collect_demonstrations
from mc_pvp_env.config import EnvConfig
from mc_pvp_env.demo_writer import DemoEpisodeBuffer, DemoWriter
from mc_pvp_env.expert import HeuristicExpertPolicy, MovementOnlyTargetPolicy
from mc_pvp_env.mocks import MockBotController, MockPluginServer
from mc_pvp_env.observations import OBSERVATION_FIELDS


class DemoCollectionTests(unittest.TestCase):
    def test_demo_writer_writes_episode_and_manifest(self):
        config = EnvConfig()
        with tempfile.TemporaryDirectory() as tmp:
            writer = DemoWriter(
                tmp,
                config=config,
                seed=123,
                expert_policy=HeuristicExpertPolicy(),
                target_policy=MovementOnlyTargetPolicy(),
            )
            buffer = DemoEpisodeBuffer("ep-test", "arena_0")
            obs = np.zeros(len(OBSERVATION_FIELDS), dtype=np.float32)
            buffer.append(
                obs=obs,
                action=3,
                action_vector=[1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 3, 2, 2],
                next_obs=obs + 1,
                reward=0.5,
                terminated=False,
                truncated=False,
                tick=0,
            )
            episode_path = writer.write_episode(buffer)
            self.assertTrue(episode_path.exists())
            with np.load(episode_path) as arrays:
                self.assertEqual(arrays["obs"].shape, (1, len(OBSERVATION_FIELDS)))
                self.assertEqual(arrays["action"][0], 3)
            manifest = json.loads((Path(tmp) / "manifest.json").read_text(encoding="utf-8"))
            self.assertEqual(manifest["action_mode"], "curriculum_discrete")
            self.assertEqual(manifest["episodes"][0]["steps"], 1)

    def test_collect_demonstrations_against_mocks(self):
        plugin = MockPluginServer()
        bot = MockBotController()
        try:
            config = EnvConfig(plugin_port=plugin.port, bot_port=bot.port, max_episode_ticks=10)
            with tempfile.TemporaryDirectory() as tmp:
                summary = collect_demonstrations(config, tmp, episodes=2, seed=123, max_steps_per_episode=3)
                self.assertEqual(summary["episodes"], 2)
                self.assertEqual(summary["transitions"], 6)
                self.assertEqual(len(bot.actions), 6)
                self.assertTrue((Path(tmp) / "manifest.json").exists())
                self.assertEqual(len(list(Path(tmp).glob("*.npz"))), 2)
        finally:
            plugin.close()
            bot.close()


if __name__ == "__main__":
    unittest.main()
