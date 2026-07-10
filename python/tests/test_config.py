import unittest

from mc_pvp_env.config import EnvConfig


class ConfigTests(unittest.TestCase):
    def test_default_target_hits_is_long_training_rule(self):
        self.assertEqual(EnvConfig().target_hits, 50)

    def test_generates_multi_arena_robo_and_script_names(self):
        config = EnvConfig(arena_count=3)
        self.assertEqual(config.for_arena(0).self_name, "ROBO-A0")
        self.assertEqual(config.for_arena(1).self_name, "ROBO-A1")
        self.assertEqual(config.for_arena(2).opponent_name, "SCRIPT-A2")
        specs = config.bot_specs()
        self.assertEqual(specs[0]["agent_id"], "ROBO-A0")
        self.assertEqual(specs[1]["role"], "scripted")
        self.assertEqual(specs[-1]["arena_id"], "arena_2")


if __name__ == "__main__":
    unittest.main()
