import unittest
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[2]


class Worker0ShortEvalScriptTests(unittest.TestCase):
    def test_short_eval_script_keeps_runtime_results_in_separate_lineage_dirs(self):
        script = (REPO_ROOT / "scripts" / "eval-worker0-short.ps1").read_text(encoding="utf-8")

        self.assertIn("[int]$WorkerId = 0", script)
        self.assertIn("WorkerId -ne 0", script)
        self.assertIn("paper-1.21", script)
        self.assertIn("fabric-1.21.11", script)
        self.assertIn("mineflayer_champion", script)
        self.assertIn("vs_controller_pvp", script)
        self.assertIn("vs_herobot_pvp", script)

    def test_herobot_fabric_worker_accepts_runtime_scripted_opponent_label(self):
        script = (REPO_ROOT / "scripts" / "start-herobot-fabric-worker.ps1").read_text(encoding="utf-8")

        self.assertIn("[ValidateSet(\"none\", \"controller_pvp\", \"herobot_pvp\")]", script)
        self.assertIn("[string]$ScriptedOpponent = \"none\"", script)
        self.assertIn("$controllerScriptedOpponent = if ($ScriptedOpponent -eq \"none\")", script)
        self.assertIn("scripted_opponent = $controllerScriptedOpponent", script)

    def test_managed_eval_matrix_combined_csv_preserves_lineage_columns(self):
        script = (REPO_ROOT / "scripts" / "eval-ppo-matrix.ps1").read_text(encoding="utf-8")

        self.assertIn("policy_lineage = $result.policy_lineage", script)
        self.assertIn("opponent_lineage_json = ($result.opponent_lineage | ConvertTo-Json -Compress)", script)
        self.assertIn("server_runtime = $result.server_runtime", script)
        self.assertIn("minecraft_version = $result.minecraft_version", script)
        self.assertIn("bot_backend = $result.bot_backend", script)


if __name__ == "__main__":
    unittest.main()
