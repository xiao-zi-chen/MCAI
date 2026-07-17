import json
import tempfile
import unittest
from pathlib import Path

import numpy as np

from mc_pvp_env.actions import ACTION_NVECS
from mc_pvp_env.opponent_pool import (
    PolicyPoolCandidate,
    PolicyPoolSampleOpponentPolicy,
    load_policy_pool_candidates,
)


class OpponentPoolTests(unittest.TestCase):
    def test_load_policy_pool_candidates_adds_curriculum_anchor(self):
        temp_dir = Path(tempfile.mkdtemp())
        checkpoint = temp_dir / "ppo.zip"
        checkpoint.write_bytes(b"fake")
        manifest = temp_dir / "policy_pool.json"
        manifest.write_text(
            json.dumps(
                {
                    "schema_version": 1,
                    "champion_id": "champ",
                    "policies": [
                        {"id": "champ", "policy_type": "ppo", "role": "champion", "checkpoint": str(checkpoint)},
                        {"id": "mf", "policy_type": "mineflayer_pvp", "role": "frozen", "checkpoint": ""},
                        {"id": "hero", "policy_type": "herobot_pvp", "role": "frozen", "checkpoint": ""},
                    ],
                }
            ),
            encoding="utf-8",
        )

        candidates = load_policy_pool_candidates(manifest)
        by_id = {item.policy_id: item for item in candidates}
        self.assertEqual(by_id["curriculum_scripted"].weight_class, "anchor")
        self.assertEqual(by_id["champ"].weight_class, "champion")
        self.assertEqual(by_id["mf"].policy_type, "controller_pvp")
        self.assertEqual(by_id["hero"].policy_type, "herobot_pvp")

    def test_sampling_weights_can_force_champion_group(self):
        policy = PolicyPoolSampleOpponentPolicy(
            [
                PolicyPoolCandidate("anchor", "scripted", "anchor", scripted_policy="movement_only", weight_class="anchor"),
                PolicyPoolCandidate("champ", "controller_pvp", "champion", weight_class="champion"),
                PolicyPoolCandidate("old", "scripted", "frozen", scripted_policy="weak_scripted", weight_class="older"),
            ],
            seed=7,
            weights=(0.0, 1.0, 0.0),
        )

        for seed in range(5):
            policy.reset(seed=seed)
            self.assertEqual(policy.active_candidate.policy_id, "champ")
            action = policy.action_vector(np.zeros(31, dtype=np.float32), {})
            self.assertEqual(action.shape, ACTION_NVECS.shape)


if __name__ == "__main__":
    unittest.main()
