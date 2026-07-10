import unittest

import numpy as np

from mc_pvp_env.mocks import make_snapshot
from mc_pvp_env.observations import OBSERVATION_FIELDS, flatten_snapshot


class ObservationTests(unittest.TestCase):
    def test_flatten_snapshot_shape_and_dtype(self):
        obs = flatten_snapshot(make_snapshot(4))
        self.assertEqual(obs.shape, (len(OBSERVATION_FIELDS),))
        self.assertEqual(obs.dtype, np.float32)
        self.assertGreater(obs[-5], 0.0)

    def test_flatten_snapshot_requires_players(self):
        with self.assertRaises(ValueError):
            flatten_snapshot({"tick": 0, "players": []})


if __name__ == "__main__":
    unittest.main()
