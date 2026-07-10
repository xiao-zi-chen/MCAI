import json
import tempfile
import unittest
from pathlib import Path

from mc_pvp_env.duel_policy_manifest import (
    import_champion_from_policy_pool,
    load_manifest,
    preflight_difficulty,
    register_difficulty,
    resolve_difficulty,
)


class DuelPolicyManifestTests(unittest.TestCase):
    def test_register_and_resolve_difficulty(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            checkpoint = root / "bc_policy.pt"
            checkpoint.write_bytes(b"placeholder")
            manifest = root / "duel-policies.json"

            registered = register_difficulty(
                manifest,
                difficulty="bc",
                checkpoint=checkpoint,
                policy_type="bc",
                notes="smoke",
            )

            self.assertEqual(registered.difficulty, "bc")
            self.assertEqual(registered.policy_type, "bc")
            resolved = resolve_difficulty(manifest, "bc")
            self.assertEqual(resolved.checkpoint, checkpoint)
            self.assertEqual(load_manifest(manifest)["difficulties"]["bc"]["notes"], "smoke")
            json.loads(manifest.read_text(encoding="utf-8"))

    def test_missing_difficulty_has_readable_error(self):
        with tempfile.TemporaryDirectory() as tmp:
            manifest = Path(tmp) / "duel-policies.json"
            with self.assertRaisesRegex(KeyError, "Difficulty 'ppo_mid' is not configured"):
                resolve_difficulty(manifest, "ppo_mid")

    def test_import_champion_from_policy_pool(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            checkpoint = root / "ppo_final.zip"
            checkpoint.write_bytes(b"placeholder")
            pool = root / "policy_pool.json"
            pool.write_text(
                json.dumps(
                    {
                        "schema_version": 1,
                        "champion_id": "ppo_curriculum_001",
                        "policies": [
                            {
                                "id": "ppo_curriculum_001",
                                "checkpoint": str(checkpoint),
                                "policy_type": "ppo",
                                "role": "champion",
                            }
                        ],
                    }
                ),
                encoding="utf-8",
            )
            manifest = root / "duel-policies.json"

            imported = import_champion_from_policy_pool(manifest, pool)

            self.assertEqual(imported.difficulty, "champion")
            self.assertEqual(imported.policy_type, "ppo")
            self.assertEqual(imported.policy_id, "ppo_curriculum_001")

    def test_preflight_loads_predictor_and_checks_action_range(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            checkpoint = root / "ppo_final.zip"
            checkpoint.write_bytes(b"placeholder")
            manifest = root / "duel-policies.json"
            register_difficulty(
                manifest,
                difficulty="ppo_mid",
                checkpoint=checkpoint,
                policy_type="ppo",
            )

            seen = {}

            def factory(policy):
                seen["policy"] = policy
                return lambda obs: 10 if obs.shape == (31,) else -1

            policy, action = preflight_difficulty(manifest, "ppo_mid", predictor_factory=factory)

            self.assertEqual(policy.difficulty, "ppo_mid")
            self.assertEqual(seen["policy"].checkpoint, checkpoint)
            self.assertEqual(action, 10)

    def test_preflight_rejects_invalid_action(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            checkpoint = root / "ppo_final.zip"
            checkpoint.write_bytes(b"placeholder")
            manifest = root / "duel-policies.json"
            register_difficulty(
                manifest,
                difficulty="ppo_mid",
                checkpoint=checkpoint,
                policy_type="ppo",
            )

            with self.assertRaisesRegex(ValueError, "produced action 99"):
                preflight_difficulty(manifest, "ppo_mid", predictor_factory=lambda _policy: (lambda _obs: 99))

    def test_register_scripted_difficulty_without_checkpoint(self):
        with tempfile.TemporaryDirectory() as tmp:
            manifest = Path(tmp) / "duel-policies.json"

            registered = register_difficulty(
                manifest,
                difficulty="script_easy",
                checkpoint="",
                policy_type="scripted",
            )

            self.assertEqual(registered.difficulty, "script_easy")
            self.assertEqual(registered.policy_type, "scripted")
            self.assertIsNone(registered.checkpoint)
            self.assertEqual(registered.policy_id, "weak_scripted")
            resolved = resolve_difficulty(manifest, "script_easy")
            self.assertIsNone(resolved.checkpoint)

    def test_preflight_scripted_difficulty(self):
        with tempfile.TemporaryDirectory() as tmp:
            manifest = Path(tmp) / "duel-policies.json"
            register_difficulty(
                manifest,
                difficulty="script_hard",
                checkpoint="",
                policy_type="scripted",
            )

            policy, action = preflight_difficulty(manifest, "script_hard")

            self.assertEqual(policy.policy_type, "scripted")
            self.assertGreaterEqual(action, 0)
            self.assertLess(action, 11)


if __name__ == "__main__":
    unittest.main()
