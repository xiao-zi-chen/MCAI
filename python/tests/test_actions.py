import unittest

from mc_pvp_env.actions import ACTION_NVECS, curriculum_action_to_vector, validate_action


class ActionTests(unittest.TestCase):
    def test_valid_action_returns_array(self):
        action = validate_action([1, 0, 0, 0, 0, 1, 0, 1, 0, 0, 3, 2, 0])
        self.assertEqual(tuple(action.shape), tuple(ACTION_NVECS.shape))

    def test_invalid_action_rejected(self):
        with self.assertRaises(ValueError):
            validate_action([2, 0, 0, 0, 0, 1, 0, 1, 0, 0, 3, 2, 0])

    def test_curriculum_action_maps_to_attack_vector(self):
        action = curriculum_action_to_vector(6)
        self.assertEqual(tuple(action.shape), tuple(ACTION_NVECS.shape))
        self.assertEqual(action[0], 1)
        self.assertEqual(action[5], 1)
        self.assertEqual(action[7], 1)
        self.assertEqual(action[12], 2)


if __name__ == "__main__":
    unittest.main()
