import json
import tempfile
import unittest
from pathlib import Path

from mc_pvp_env.config import EnvConfig


class ConfigTests(unittest.TestCase):
    def test_default_target_hits_is_long_training_rule(self):
        self.assertEqual(EnvConfig().target_hits, 50)
        self.assertEqual(EnvConfig().server_runtime, "paper-1.21")
        self.assertEqual(EnvConfig().minecraft_version, "1.21")
        self.assertEqual(EnvConfig().bot_backend, "mineflayer")

    def test_loads_worker_lineage_fields_from_json(self):
        with tempfile.TemporaryDirectory() as tmp:
            config_path = Path(tmp) / "env.json"
            config_path.write_text(
                json.dumps(
                    {
                        "target_hits": 5,
                        "server_runtime": "fabric-1.21.11",
                        "minecraft_version": "1.21.11",
                        "bot_backend": "herobot",
                    }
                ),
                encoding="utf-8",
            )

            config = EnvConfig.from_json(config_path)

        self.assertEqual(config.target_hits, 5)
        self.assertEqual(config.server_runtime, "fabric-1.21.11")
        self.assertEqual(config.minecraft_version, "1.21.11")
        self.assertEqual(config.bot_backend, "herobot")

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
