import unittest

from mc_pvp_env.config import EnvConfig
from mc_pvp_env.env import MinecraftPvpEnv
from mc_pvp_env.expert import WeakScriptedTargetPolicy
from mc_pvp_env.mocks import MockBotController, MockPluginServer, make_snapshot
from mc_pvp_env.observations import OBSERVATION_FIELDS


class EnvMockTests(unittest.TestCase):
    def test_reset_and_step_against_mocks(self):
        plugin = MockPluginServer()
        bot = MockBotController()
        try:
            env = MinecraftPvpEnv(EnvConfig(plugin_port=plugin.port, bot_port=bot.port))
            obs, info = env.reset(seed=123)
            self.assertEqual(obs.shape, (len(OBSERVATION_FIELDS),))
            self.assertEqual(info["episode_id"], "ep-0001")
            self.assertEqual(info["start_status"]["type"], "start_episode_ack")
            next_obs, reward, terminated, truncated, step_info = env.step(6)
            self.assertEqual(next_obs.shape, obs.shape)
            self.assertIsInstance(reward, float)
            self.assertFalse(terminated)
            self.assertFalse(truncated)
            self.assertGreater(reward, 0.0)
            self.assertTrue(step_info["bot_status"]["accepted"])
            self.assertEqual(len(bot.actions), 1)
            env.close()
        finally:
            plugin.close()
            bot.close()

    def test_reward_penalizes_opponent_hits_more_strongly(self):
        env = MinecraftPvpEnv(EnvConfig(opponent_hit_penalty_scale=2.0))
        snapshot = make_snapshot(2)
        snapshot["hit_deltas"] = {"ROBO-A0": 0, "SCRIPT-A0": 1}
        snapshot["target_hits"] = 50
        self.assertAlmostEqual(env._reward(snapshot), -0.043, places=6)
        env.close()

    def test_reward_encourages_safe_spacing_after_hit(self):
        config = EnvConfig(post_hit_spacing_reward=0.003, danger_close_penalty=0.002)
        env = MinecraftPvpEnv(config)
        safe = make_snapshot(2)
        safe["target_hits"] = 50
        safe["hit_deltas"] = {"ROBO-A0": 1, "SCRIPT-A0": 0}
        safe["players"][1]["hurt_time"] = 5.0
        safe["players"][1]["pos"] = [2.0, 64.0, 0.0]

        close = make_snapshot(2)
        close["target_hits"] = 50
        close["hit_deltas"] = {"ROBO-A0": 1, "SCRIPT-A0": 0}
        close["players"][1]["hurt_time"] = 5.0
        close["players"][1]["pos"] = [0.2, 64.0, 0.0]

        self.assertGreater(env._reward(safe), env._reward(close))
        env.close()

    def test_step_pair_sends_both_actions(self):
        plugin = MockPluginServer()
        bot = MockBotController()
        try:
            env = MinecraftPvpEnv(EnvConfig(plugin_port=plugin.port, bot_port=bot.port))
            env.reset(seed=123)
            env.step_pair(6, [0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 3, 2, 2])
            sent = bot.actions[-1]["actions"]
            self.assertEqual(sent["ROBO-A0"][7], 1)
            self.assertEqual(sent["SCRIPT-A0"][2], 1)
            self.assertEqual(sent["SCRIPT-A0"][7], 0)
            env.close()
        finally:
            plugin.close()
            bot.close()

    def test_step_uses_configured_opponent_policy(self):
        plugin = MockPluginServer()
        bot = MockBotController()
        try:
            env = MinecraftPvpEnv(
                EnvConfig(plugin_port=plugin.port, bot_port=bot.port),
                opponent_policy=WeakScriptedTargetPolicy(seed=0),
            )
            env.reset(seed=123)
            env.step(6)
            sent = bot.actions[-1]["actions"]
            self.assertEqual(sent["ROBO-A0"][7], 1)
            self.assertIn(sent["SCRIPT-A0"][7], (0, 1))
            self.assertNotEqual(sent["SCRIPT-A0"], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 3, 2, 0])
            env.close()
        finally:
            plugin.close()
            bot.close()


if __name__ == "__main__":
    unittest.main()
