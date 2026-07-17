import tempfile
import unittest
from pathlib import Path

from mc_pvp_env.policy_pool import load_pool, promote_champion, register_policy


class PolicyPoolTests(unittest.TestCase):
    def test_register_and_promote_policy(self):
        temp_dir = Path(tempfile.mkdtemp())
        manifest = temp_dir / "policy_pool.json"
        first_checkpoint = temp_dir / "ppo_a.zip"
        second_checkpoint = temp_dir / "ppo_b.zip"
        first_checkpoint.write_bytes(b"fake")
        second_checkpoint.write_bytes(b"fake")

        first = register_policy(manifest, policy_id="ppo_a", checkpoint=first_checkpoint, role="candidate")
        second = register_policy(manifest, policy_id="ppo_b", checkpoint=second_checkpoint, champion=True)

        self.assertEqual(first["role"], "candidate")
        self.assertEqual(second["role"], "champion")
        pool = load_pool(manifest)
        self.assertEqual(pool["champion_id"], "ppo_b")

        promoted = promote_champion(manifest, "ppo_a")
        self.assertEqual(promoted["role"], "champion")
        pool = load_pool(manifest)
        roles = {item["id"]: item["role"] for item in pool["policies"]}
        self.assertEqual(pool["champion_id"], "ppo_a")
        self.assertEqual(roles["ppo_a"], "champion")
        self.assertEqual(roles["ppo_b"], "frozen")

    def test_missing_checkpoint_is_rejected(self):
        temp_dir = Path(tempfile.mkdtemp())
        with self.assertRaises(FileNotFoundError):
            register_policy(temp_dir / "policy_pool.json", policy_id="missing", checkpoint=temp_dir / "missing.zip")

    def test_scripted_and_mineflayer_entries_do_not_require_checkpoint(self):
        temp_dir = Path(tempfile.mkdtemp())
        manifest = temp_dir / "policy_pool.json"
        register_policy(manifest, policy_id="script_anchor", checkpoint="", policy_type="scripted")
        register_policy(manifest, policy_id="mineflayer_pvp", checkpoint="", policy_type="mineflayer_pvp")

        pool = load_pool(manifest)
        entries = {item["id"]: item for item in pool["policies"]}
        self.assertEqual(entries["script_anchor"]["checkpoint"], "")
        self.assertEqual(entries["mineflayer_pvp"]["policy_type"], "mineflayer_pvp")


if __name__ == "__main__":
    unittest.main()
