import unittest


class PublicFacadeTest(unittest.TestCase):
    def test_training_facade_exports_stable_entrypoints(self):
        from mc_pvp_env import training

        self.assertTrue(callable(training.make_opponent_policy))
        self.assertTrue(callable(training.make_policy_pool_sample_opponent))
        self.assertTrue(callable(training.make_sb3_vec_env))
        self.assertTrue(callable(training.train_ppo_main))

    def test_duel_facade_exports_stable_entrypoints(self):
        from mc_pvp_env import duel

        self.assertTrue(callable(duel.make_policy_predictor))
        self.assertTrue(callable(duel.run_auto_duel_daemon))
        self.assertTrue(callable(duel.resolve_difficulty))

    def test_benchmark_facade_exports_stable_entrypoints(self):
        from mc_pvp_env import benchmark

        self.assertTrue(callable(benchmark.evaluate_league))
        self.assertTrue(callable(benchmark.load_league_manifest))
        self.assertTrue(callable(benchmark.eval_ppo_matrix_main))


if __name__ == "__main__":
    unittest.main()
