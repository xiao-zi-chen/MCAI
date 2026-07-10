import unittest

from mc_pvp_env.plot_training_curves import _rolling_mean


class PlotTrainingCurvesTests(unittest.TestCase):
    def test_rolling_mean_uses_partial_window_until_full(self):
        self.assertEqual(_rolling_mean([1.0, 3.0, 5.0, 7.0], 2), [1.0, 2.0, 4.0, 6.0])


if __name__ == "__main__":
    unittest.main()
