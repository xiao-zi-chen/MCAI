import unittest

import numpy as np

from mc_pvp_env.actions import ACTION_NVECS
from mc_pvp_env.expert import (
    CurriculumScriptedTargetPolicy,
    HeuristicExpertPolicy,
    MovementOnlyTargetPolicy,
    OpponentCurriculumPolicy,
    WeakScriptedTargetPolicy,
    make_opponent_policy,
)
from mc_pvp_env.mocks import make_snapshot


class ExpertPolicyTests(unittest.TestCase):
    def test_expert_attacks_in_range_with_cooldown(self):
        snapshot = make_snapshot(2)
        expert = HeuristicExpertPolicy(seed=1)
        action = expert.action(snapshot=snapshot)
        self.assertIn(action, (5, 7, 8))

    def test_expert_sprints_to_far_target(self):
        snapshot = make_snapshot(0)
        snapshot["players"][1]["pos"] = [10.0, 64.0, 0.0]
        expert = HeuristicExpertPolicy()
        self.assertEqual(expert.action(snapshot=snapshot), 3)

    def test_movement_only_target_never_attacks(self):
        target = MovementOnlyTargetPolicy(seed=0)
        for tick in range(0, 80, 2):
            action = target.action_vector(snapshot=make_snapshot(tick))
            self.assertEqual(action[7], 0)

    def test_scripted_targets_emit_valid_vectors(self):
        for policy in (WeakScriptedTargetPolicy(seed=1), CurriculumScriptedTargetPolicy(seed=2)):
            for tick in range(0, 100, 3):
                action = policy.action_vector(snapshot=make_snapshot(tick))
                self.assertEqual(action.shape, ACTION_NVECS.shape)
                self.assertTrue(np.all(action >= 0))
                self.assertTrue(np.all(action < ACTION_NVECS))

    def test_opponent_curriculum_advances_stages(self):
        policy = OpponentCurriculumPolicy(seed=0, stage_steps=(1, 2))
        self.assertIsInstance(policy.current_policy(), MovementOnlyTargetPolicy)
        policy.action_vector(snapshot=make_snapshot(0))
        self.assertIsInstance(policy.current_policy(), WeakScriptedTargetPolicy)
        policy.action_vector(snapshot=make_snapshot(2))
        self.assertIsInstance(policy.current_policy(), CurriculumScriptedTargetPolicy)

    def test_opponent_curriculum_can_share_step_counter(self):
        counter = {"calls": 0}
        first = OpponentCurriculumPolicy(seed=0, stage_steps=(1, 2), shared_step_counter=counter)
        second = OpponentCurriculumPolicy(seed=1, stage_steps=(1, 2), shared_step_counter=counter)
        self.assertIsInstance(first.current_policy(), MovementOnlyTargetPolicy)
        first.action_vector(snapshot=make_snapshot(0))
        self.assertIsInstance(second.current_policy(counter["calls"]), WeakScriptedTargetPolicy)
        second.action_vector(snapshot=make_snapshot(2))
        self.assertIsInstance(first.current_policy(counter["calls"]), CurriculumScriptedTargetPolicy)

    def test_make_opponent_policy_supports_neutral(self):
        self.assertIsNone(make_opponent_policy("neutral"))

    def test_make_opponent_policy_defers_mineflayer_pvp_to_bot_controller(self):
        self.assertIsNone(make_opponent_policy("mineflayer_pvp"))


if __name__ == "__main__":
    unittest.main()
