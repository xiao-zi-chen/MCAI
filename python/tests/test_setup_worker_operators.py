import json
import os
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[2]
OFFLINE_OWNER_UUID = "d2502e58-a6a6-3a44-932c-5170ca0cf875"
ONLINE_OWNER_UUID = "3318d9d5-0f87-4db0-bb16-35f23e062656"
SMOKE_ADMIN_UUID = "5947b6de-4137-3970-b7e7-730f0a687c83"


class SetupWorkerOperatorTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.powershell = shutil.which("powershell.exe")
        if cls.powershell is None:
            raise unittest.SkipTest("Windows PowerShell is required for worker script tests")

    def write_operators(self, directory, names, auth_mode="offline"):
        env = os.environ.copy()
        env["PVPROBO_TEST_SETUP_SCRIPT"] = str(REPO_ROOT / "scripts" / "setup-worker.ps1")
        env["PVPROBO_TEST_WORKER_DIR"] = str(directory)
        env["PVPROBO_TEST_OPERATOR_NAMES"] = json.dumps(names)
        env["PVPROBO_TEST_AUTH_MODE"] = auth_mode
        # Execute the actual writer functions without running worker setup,
        # downloading dependencies, or starting any processes.
        command = r"""
$ErrorActionPreference = "Stop"
$tokens = $null
$parseErrors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile(
    $env:PVPROBO_TEST_SETUP_SCRIPT, [ref]$tokens, [ref]$parseErrors)
if ($parseErrors.Count -gt 0) { throw "Worker setup script has syntax errors" }
$wanted = @("Write-TextFile", "Get-OfflineUuid", "Get-KnownOnlineUuid", "Write-Operators")
$definitions = $ast.FindAll({
    param($node)
    $node -is [System.Management.Automation.Language.FunctionDefinitionAst]
}, $false)
foreach ($definition in $definitions) {
    if ($wanted -contains $definition.Name) {
        . ([scriptblock]::Create($definition.Extent.Text))
    }
}
$playerAuthMode = $env:PVPROBO_TEST_AUTH_MODE
$operatorNames = ConvertFrom-Json -InputObject $env:PVPROBO_TEST_OPERATOR_NAMES
Write-Operators $env:PVPROBO_TEST_WORKER_DIR $operatorNames
"""
        subprocess.run(
            [self.powershell, "-NoProfile", "-NonInteractive", "-ExecutionPolicy",
             "Bypass", "-Command", command],
            cwd=REPO_ROOT, env=env, check=True, capture_output=True, text=True, timeout=20,
        )
        return json.loads((Path(directory) / "ops.json").read_text(encoding="utf-8"))

    def test_offline_startup_uses_offline_uuids_for_all_operator_names(self):
        with tempfile.TemporaryDirectory(prefix="pvprobo operators ") as directory:
            operators = self.write_operators(directory, ["SmokeAdmin", "KyaKayKya"])
        by_name = {entry["name"]: entry for entry in operators}
        self.assertEqual(len(operators), 2)
        self.assertEqual(by_name["SmokeAdmin"]["uuid"], SMOKE_ADMIN_UUID)
        self.assertEqual(by_name["KyaKayKya"]["uuid"], OFFLINE_OWNER_UUID)
        for entry in operators:
            self.assertEqual(entry["level"], 4)
            self.assertTrue(entry["bypassesPlayerLimit"])

    def test_repeating_setup_repairs_old_online_uuid_and_preserves_other_ops(self):
        previous = [
            {"name": "KyaKayKya", "uuid": ONLINE_OWNER_UUID,
             "level": 1, "bypassesPlayerLimit": False},
            {"name": "OtherAdmin", "uuid": "11111111-1111-3111-8111-111111111111",
             "level": 2, "bypassesPlayerLimit": False},
        ]
        with tempfile.TemporaryDirectory() as directory:
            (Path(directory) / "ops.json").write_text(json.dumps(previous), encoding="utf-8")
            operators = self.write_operators(directory, ["KyaKayKya"])
        self.assertEqual(len(operators), 2)
        by_name = {entry["name"]: entry for entry in operators}
        self.assertEqual(by_name["KyaKayKya"]["uuid"], OFFLINE_OWNER_UUID)
        self.assertEqual(by_name["KyaKayKya"]["level"], 4)
        self.assertTrue(by_name["KyaKayKya"]["bypassesPlayerLimit"])
        self.assertEqual(by_name["OtherAdmin"], previous[1])

    def test_online_forwarding_keeps_known_online_uuid(self):
        with tempfile.TemporaryDirectory() as directory:
            operators = self.write_operators(directory, ["KyaKayKya"], auth_mode="online")
        self.assertEqual(operators[0]["uuid"], ONLINE_OWNER_UUID)

    def test_empty_operator_list_preserves_existing_entries(self):
        previous = [{"name": "Existing", "uuid": SMOKE_ADMIN_UUID,
                     "level": 2, "bypassesPlayerLimit": False}]
        with tempfile.TemporaryDirectory() as directory:
            (Path(directory) / "ops.json").write_text(json.dumps(previous), encoding="utf-8")
            operators = self.write_operators(directory, [])
        self.assertEqual(operators, previous)


if __name__ == "__main__":
    unittest.main()
