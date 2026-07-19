from __future__ import annotations

import tempfile
import unittest

from mc_pvp_env.config import EnvConfig
from mc_pvp_env.herobot_fabric_smoke import run_herobot_fabric_smoke
from mc_pvp_env.mocks import MockBotController, MockPluginServer
from mc_pvp_env.restricted_dataset import load_restricted_dataset


class HeroBotFabricSmokeTests(unittest.TestCase):
    def test_smoke_spawns_positioned_agents_and_writes_restricted_rows(self) -> None:
        plugin = MockPluginServer()
        bot = MockBotController()
        plugin_client = plugin.client()
        bot_client = bot.client()
        try:
            with tempfile.TemporaryDirectory() as tmp:
                summary = run_herobot_fabric_smoke(
                    config=EnvConfig(target_hits=2),
                    plugin_client=plugin_client,
                    bot_client=bot_client,
                    out_dir=tmp,
                    require_damage=True,
                )

                self.assertGreaterEqual(summary.damage_events, 1)
                self.assertEqual(summary.dataset_steps, 2)
                spawn = bot.spawn_requests[0]
                self.assertEqual(spawn["bots"][0]["x"], -1.0)
                self.assertEqual(spawn["bots"][0]["yaw"], -94.0)
                self.assertEqual(spawn["bots"][1]["x"], 1.0)
                self.assertEqual(spawn["bots"][1]["yaw"], 90.0)
                restricted = [action for action in bot.actions if action["type"] == "apply_restricted_action"]
                self.assertEqual([action["action"].get("attack_pulse", False) for action in restricted], [False, True])
                dataset = load_restricted_dataset(tmp)
                rows = dataset.load_episode(dataset.episode_files[0])
                self.assertEqual(len(rows), 2)
                self.assertEqual(rows[0].action_requested.mouse_dx, 4)
                self.assertTrue(rows[1].action_requested.attack_pulse)
        finally:
            plugin_client.close()
            bot_client.close()
            plugin.close()
            bot.close()


if __name__ == "__main__":
    unittest.main()
