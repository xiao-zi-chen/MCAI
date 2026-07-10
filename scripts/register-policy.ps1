param(
    [string]$Manifest = "",
    [ValidateSet("register", "promote", "list")]
    [string]$Command = "register",
    [string]$Id = "",
    [string]$Checkpoint = "",
    [ValidateSet("ppo", "bc", "scripted", "mineflayer_pvp")]
    [string]$PolicyType = "ppo",
    [ValidateSet("frozen", "candidate", "champion")]
    [string]$Role = "frozen",
    [string]$SourceRun = "",
    [string]$Metrics = "",
    [string]$Notes = "",
    [switch]$Champion,
    [switch]$UseSystemPython
)

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot
. (Join-Path $PSScriptRoot "python-env.ps1")
if ($Manifest -eq "") {
    $Manifest = Join-Path $repoRoot "runs\policy_pool\policy_pool.json"
}

Assert-NoSystemPython -UseSystemPython $UseSystemPython
$pythonExe = Get-PVPRoboPython -RepoRoot $repoRoot
$baseArgs = @("-m", "mc_pvp_env.policy_pool", "--manifest", $Manifest, $Command)
if ($Command -eq "register") {
    if ($Id -eq "") { throw "-Id is required for register." }
    if (($PolicyType -eq "ppo" -or $PolicyType -eq "bc") -and $Checkpoint -eq "") { throw "-Checkpoint is required for PPO/BC register." }
    $baseArgs += @(
        "--id", $Id,
        "--policy-type", $PolicyType,
        "--role", $Role
    )
    if ($Checkpoint -ne "") { $baseArgs += @("--checkpoint", $Checkpoint) }
    if ($SourceRun -ne "") { $baseArgs += @("--source-run", $SourceRun) }
    if ($Metrics -ne "") { $baseArgs += @("--metrics", $Metrics) }
    if ($Notes -ne "") { $baseArgs += @("--notes", $Notes) }
    if ($Champion) { $baseArgs += "--champion" }
} elseif ($Command -eq "promote") {
    if ($Id -eq "") { throw "-Id is required for promote." }
    $baseArgs += @("--id", $Id)
}

& $pythonExe @baseArgs
if ($LASTEXITCODE -ne 0) {
    throw "Policy pool command failed with exit code $LASTEXITCODE."
}
