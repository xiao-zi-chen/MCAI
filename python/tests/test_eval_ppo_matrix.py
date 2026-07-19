import csv
import tempfile
import unittest
from pathlib import Path

from mc_pvp_env.config import EnvConfig
from mc_pvp_env.eval_ppo_matrix import _apply_lineage_to_summary, _write_csv


class EvalPpoMatrixTests(unittest.TestCase):
    def test_apply_lineage_records_policy_and_runtime_boundaries(self):
        summary = {
            "policy": "private-deployment/checkpoints/champion.zip",
            "opponent_policy": "herobot_pvp",
            "episodes": 2,
            "win_rate": 0.5,
        }
        config = EnvConfig(
            server_runtime="fabric-1.21.11",
            minecraft_version="1.21.11",
            bot_backend="herobot",
        )

        enriched = _apply_lineage_to_summary(
            summary,
            config=config,
            policy_lineage="mineflayer_champion",
            opponent_policy="herobot_pvp",
        )

        self.assertEqual(enriched["policy_lineage"], "mineflayer_champion")
        self.assertEqual(
            enriched["opponent_lineage"],
            {
                "policy_type": "herobot_pvp",
                "bot_backend": "herobot",
                "server_runtime": "fabric-1.21.11",
                "minecraft_version": "1.21.11",
            },
        )
        self.assertEqual(enriched["server_runtime"], "fabric-1.21.11")
        self.assertEqual(enriched["minecraft_version"], "1.21.11")
        self.assertEqual(enriched["bot_backend"], "herobot")

    def test_csv_includes_lineage_columns(self):
        with tempfile.TemporaryDirectory() as tmp:
            csv_path = Path(tmp) / "eval_matrix.csv"
            _write_csv(
                csv_path,
                [
                    {
                        "policy": "private-deployment/checkpoints/champion.zip",
                        "policy_lineage": "mineflayer_champion",
                        "opponent_policy": "controller_pvp",
                        "opponent_lineage": {
                            "policy_type": "controller_pvp",
                            "bot_backend": "mineflayer",
                            "server_runtime": "paper-1.21",
                            "minecraft_version": "1.21",
                        },
                        "server_runtime": "paper-1.21",
                        "minecraft_version": "1.21",
                        "bot_backend": "mineflayer",
                        "episodes": 1,
                        "win_rate": 1.0,
                        "loss_rate": 0.0,
                        "draw_rate": 0.0,
                        "reward_mean": 1.0,
                        "reward_std": 0.0,
                        "episode_length_mean": 10.0,
                        "episode_length_min": 10,
                        "episode_length_max": 10,
                        "self_hits_mean": 5.0,
                        "opponent_hits_mean": 2.0,
                        "episodes_per_sec": 1.0,
                        "elapsed_seconds": 1.0,
                        "phase_counts": {"self_win": 1},
                    }
                ],
            )

            with csv_path.open("r", encoding="utf-8") as handle:
                rows = list(csv.DictReader(handle))

        self.assertEqual(rows[0]["policy_lineage"], "mineflayer_champion")
        self.assertEqual(rows[0]["opponent_policy"], "controller_pvp")
        self.assertEqual(rows[0]["server_runtime"], "paper-1.21")
        self.assertEqual(rows[0]["minecraft_version"], "1.21")
        self.assertEqual(rows[0]["bot_backend"], "mineflayer")
        self.assertIn('"policy_type": "controller_pvp"', rows[0]["opponent_lineage_json"])


if __name__ == "__main__":
    unittest.main()
