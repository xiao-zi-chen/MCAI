import unittest
import tempfile
from pathlib import Path
from unittest.mock import patch

import numpy as np

from mc_pvp_env.config import EnvConfig
from mc_pvp_env.duel_recording import load_duel_record_dataset
from mc_pvp_env.duel_runner import make_policy_predictor, run_auto_duel_daemon, run_bc_duel
from mc_pvp_env.duel_policy_manifest import DuelPolicy
from mc_pvp_env.mocks import MockBotController, MockPluginServer


class DuelRunnerTests(unittest.TestCase):
    def test_runner_sends_single_robo_actions_and_clears_controls(self):
        plugin = MockPluginServer()
        bot = MockBotController()
        try:
            config = EnvConfig(plugin_port=plugin.port, bot_port=bot.port, max_episode_ticks=10)
            summary = run_bc_duel(
                Path("unused.pt"),
                config,
                player_name="SCRIPT-A0",
                robo_name="ROBO-A0",
                max_steps=3,
                wait_timeout_seconds=2.0,
                predictor=lambda _obs: 4,
            )
            self.assertEqual(summary.steps, 3)
            applied = [request for request in bot.actions if request["type"] == "apply_action"]
            self.assertEqual(len(applied), 3)
            self.assertEqual(applied[0]["agent_id"], "ROBO-A0")
            self.assertEqual(applied[0]["target_username"], "SCRIPT-A0")
            self.assertEqual(applied[0]["action"][7], 1)
        finally:
            plugin.close()
            bot.close()

    def test_runner_writes_duel_record_when_enabled(self):
        plugin = MockPluginServer()
        bot = MockBotController()
        try:
            config = EnvConfig(plugin_port=plugin.port, bot_port=bot.port, max_episode_ticks=10)
            with tempfile.TemporaryDirectory() as tmp:
                summary = run_bc_duel(
                    Path("unused.pt"),
                    config,
                    player_name="SCRIPT-A0",
                    robo_name="ROBO-A0",
                    max_steps=2,
                    wait_timeout_seconds=2.0,
                    predictor=lambda _obs: 4,
                    record_dir=tmp,
                )
                self.assertEqual(summary.steps, 2)
                dataset = load_duel_record_dataset(tmp)
                self.assertEqual(len(dataset.episode_files), 1)
                arrays = dataset.load_episode(dataset.episode_files[0])
                self.assertEqual(arrays["action_id"].shape, (2, 2))
                self.assertEqual(arrays["action_id"][0, 0], 4)
        finally:
            plugin.close()
            bot.close()

    def test_auto_daemon_detects_human_duel_and_forwards_target_username(self):
        plugin = MockPluginServer(self_name="ROBO", opponent_name="KyaKayKya")
        bot = MockBotController()
        try:
            config = EnvConfig(plugin_port=plugin.port, bot_port=bot.port, max_episode_ticks=10)
            import mc_pvp_env.duel_runner as duel_runner

            original_resolve = duel_runner.resolve_difficulty
            original_predictor = duel_runner.make_policy_predictor
            try:
                duel_runner.resolve_difficulty = lambda _manifest, difficulty: DuelPolicy(difficulty, "bc", Path("unused.pt"))
                duel_runner.make_policy_predictor = lambda _policy: (lambda _obs: 4)
                summary = run_auto_duel_daemon(
                    config,
                    Path("unused-manifest.json"),
                    max_sessions=1,
                    wait_timeout_seconds=2.0,
                    max_steps=2,
                )
            finally:
                duel_runner.resolve_difficulty = original_resolve
                duel_runner.make_policy_predictor = original_predictor
            self.assertEqual(summary.sessions, 1)
            applied = [request for request in bot.actions if request["type"] == "apply_action"]
            self.assertGreaterEqual(len(applied), 1)
            self.assertEqual(applied[0]["agent_id"], "ROBO")
            self.assertEqual(applied[0]["target_username"], "KyaKayKya")
            self.assertEqual(applied[0]["action"][7], 1)
        finally:
            plugin.close()
            bot.close()

    def test_auto_daemon_despawns_generated_player_duel_robo_after_session(self):
        plugin = MockPluginServer(self_name="ROBO_A1", opponent_name="KyaKayKya", arena_id="arena_1")
        bot = MockBotController()
        try:
            config = EnvConfig(plugin_port=plugin.port, bot_port=bot.port, max_episode_ticks=10)
            import mc_pvp_env.duel_runner as duel_runner

            original_resolve = duel_runner.resolve_difficulty
            original_predictor = duel_runner.make_policy_predictor
            try:
                duel_runner.resolve_difficulty = lambda _manifest, difficulty: DuelPolicy(difficulty, "bc", Path("unused.pt"))
                duel_runner.make_policy_predictor = lambda _policy: (lambda _obs: 4)
                summary = run_auto_duel_daemon(
                    config,
                    Path("unused-manifest.json"),
                    max_sessions=1,
                    wait_timeout_seconds=2.0,
                    max_steps=2,
                )
            finally:
                duel_runner.resolve_difficulty = original_resolve
                duel_runner.make_policy_predictor = original_predictor
            self.assertEqual(summary.sessions, 1)
            remaining = {item["agent_id"] for item in bot.bots}
            self.assertNotIn("ROBO_A1", remaining)
            self.assertIn("ROBO", remaining)
        finally:
            plugin.close()
            bot.close()

    def test_auto_daemon_controls_both_ai_battle_participants(self):
        plugin = MockPluginServer(
            self_name="ROBO_A0",
            opponent_name="SCRIPT_E0",
            mode="ai_battle",
            participants=[
                {"name": "ROBO_A0", "difficulty": "bc"},
                {"name": "SCRIPT_E0", "difficulty": "script_easy"},
            ],
        )
        bot = MockBotController()
        try:
            config = EnvConfig(plugin_port=plugin.port, bot_port=bot.port, max_episode_ticks=10)
            import mc_pvp_env.duel_runner as duel_runner

            original_resolve = duel_runner.resolve_difficulty
            original_predictor = duel_runner.make_policy_predictor
            try:
                duel_runner.resolve_difficulty = lambda _manifest, difficulty: DuelPolicy(difficulty, "bc", Path("unused.pt"))
                duel_runner.make_policy_predictor = lambda _policy: (lambda _obs: 4)
                summary = run_auto_duel_daemon(
                    config,
                    Path("unused-manifest.json"),
                    max_sessions=1,
                    wait_timeout_seconds=2.0,
                    max_steps=2,
                )
            finally:
                duel_runner.resolve_difficulty = original_resolve
                duel_runner.make_policy_predictor = original_predictor
            self.assertEqual(summary.sessions, 1)
            applied = [request for request in bot.actions if request["type"] == "apply_action"]
            self.assertGreaterEqual(len(applied), 2)
            first_by_agent = {}
            for request in applied:
                first_by_agent.setdefault(request["agent_id"], request)
            self.assertEqual(first_by_agent["ROBO_A0"]["target_username"], "SCRIPT_E0")
            self.assertEqual(first_by_agent["SCRIPT_E0"]["target_username"], "ROBO_A0")
            self.assertEqual(first_by_agent["ROBO_A0"]["action"][7], 1)
            remaining = {item["agent_id"] for item in bot.bots}
            self.assertNotIn("ROBO_A0", remaining)
            self.assertNotIn("SCRIPT_E0", remaining)
            self.assertIn("ROBO", remaining)
        finally:
            plugin.close()
            bot.close()

    def test_auto_daemon_waits_for_ai_battle_loading_before_control(self):
        plugin = MockPluginServer(
            self_name="ROBO_A0",
            opponent_name="SCRIPT_E0",
            mode="ai_battle",
            phase="loading",
            participants=[
                {"name": "ROBO_A0", "difficulty": "bc"},
                {"name": "SCRIPT_E0", "difficulty": "script_easy"},
            ],
        )
        bot = MockBotController()
        try:
            config = EnvConfig(plugin_port=plugin.port, bot_port=bot.port, max_episode_ticks=10)
            import mc_pvp_env.duel_runner as duel_runner

            original_resolve = duel_runner.resolve_difficulty
            original_predictor = duel_runner.make_policy_predictor
            try:
                duel_runner.resolve_difficulty = lambda _manifest, difficulty: DuelPolicy(difficulty, "bc", Path("unused.pt"))
                duel_runner.make_policy_predictor = lambda _policy: (lambda _obs: 4)
                summary = run_auto_duel_daemon(
                    config,
                    Path("unused-manifest.json"),
                    max_sessions=1,
                    wait_timeout_seconds=2.0,
                    max_steps=1,
                )
            finally:
                duel_runner.resolve_difficulty = original_resolve
                duel_runner.make_policy_predictor = original_predictor
            self.assertEqual(summary.sessions, 1)
            self.assertEqual(len(plugin.ready_requests), 1)
            self.assertEqual(plugin.ready_requests[0]["episode_id"], "mock-episode")
            applied = [request for request in bot.actions if request["type"] == "apply_action"]
            self.assertGreaterEqual(len(applied), 2)
        finally:
            plugin.close()
            bot.close()

    def test_missing_sb3_is_recoverable_policy_load_error(self):
        original_import = __import__

        def fake_import(name, globals=None, locals=None, fromlist=(), level=0):
            if name == "stable_baselines3":
                raise ImportError("missing sb3")
            return original_import(name, globals, locals, fromlist, level)

        with patch("builtins.__import__", side_effect=fake_import):
            with self.assertRaisesRegex(RuntimeError, "Missing stable-baselines3"):
                make_policy_predictor(DuelPolicy("ppo_mid", "ppo", Path("missing.zip")))

    def test_scripted_policy_predictor_produces_curriculum_action(self):
        predictor = make_policy_predictor(DuelPolicy("script_hard", "scripted", None, policy_id="curriculum_scripted"))

        action = predictor(np.zeros(31, dtype=np.float32))

        self.assertGreaterEqual(action, 0)
        self.assertLess(action, 11)


if __name__ == "__main__":
    unittest.main()
