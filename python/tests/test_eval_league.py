import json
import tempfile
import unittest
from pathlib import Path

from mc_pvp_env.eval_league import _skipped_matchup, _update_elo, load_league_manifest


class EvalLeagueTests(unittest.TestCase):
    def test_load_league_manifest_accepts_scripted_ppo_and_mineflayer(self):
        temp_dir = Path(tempfile.mkdtemp())
        manifest = temp_dir / "league.json"
        manifest.write_text(
            json.dumps(
                {
                    "candidates": [
                        {"id": "curriculum_scripted", "policy_type": "scripted", "scripted_policy": "curriculum_scripted"},
                        {"id": "continue4", "policy_type": "ppo", "checkpoint": "runs/worker_000/training/ppo_final.zip"},
                        {"id": "mineflayer_pvp", "policy_type": "mineflayer_pvp"},
                    ]
                }
            ),
            encoding="utf-8",
        )

        candidates = load_league_manifest(manifest)
        self.assertEqual([item.policy_id for item in candidates], ["curriculum_scripted", "continue4", "mineflayer_pvp"])
        self.assertEqual(candidates[1].checkpoint, "runs/worker_000/training/ppo_final.zip")

    def test_load_league_manifest_rejects_duplicate_ids(self):
        temp_dir = Path(tempfile.mkdtemp())
        manifest = temp_dir / "league.json"
        manifest.write_text(
            json.dumps(
                {
                    "candidates": [
                        {"id": "same", "policy_type": "scripted", "scripted_policy": "movement_only"},
                        {"id": "same", "policy_type": "mineflayer_pvp"},
                    ]
                }
            ),
            encoding="utf-8",
        )

        with self.assertRaises(ValueError):
            load_league_manifest(manifest)

    def test_elo_update_moves_winner_up(self):
        elo = {"a": 1000.0, "b": 1000.0}
        _update_elo(elo, "a", "b", 1.0)
        self.assertGreater(elo["a"], 1000.0)
        self.assertLess(elo["b"], 1000.0)

    def test_skipped_mineflayer_left_row_is_explicit(self):
        row = _skipped_matchup("mineflayer_pvp", "continue4")
        self.assertEqual(row["status"], "skipped")
        self.assertEqual(row["episodes"], 0)
        self.assertIn("scripted-role opponent", row["skip_reason"])


if __name__ == "__main__":
    unittest.main()
