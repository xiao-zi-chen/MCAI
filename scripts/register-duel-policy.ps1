param(
    [string]$Manifest = "",
    [ValidateSet("register", "resolve", "import-champion", "list")]
    [string]$Command = "register",
    [ValidateSet("bc", "ppo_mid", "ppo_high", "script_easy", "script_hard", "champion")]
    [string]$Difficulty = "bc",
    [string]$Checkpoint = "",
    [ValidateSet("bc", "ppo", "scripted")]
    [string]$PolicyType = "bc",
    [string]$PolicyId = "",
    [string]$Source = "",
    [string]$Notes = "",
    [string]$PolicyPool = "",
    [switch]$UseSystemPython
)

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot
. (Join-Path $PSScriptRoot "python-env.ps1")
if ($Manifest -eq "") {
    $Manifest = Join-Path $repoRoot "runs\duel\duel-policies.json"
}
if ($PolicyPool -eq "") {
    $PolicyPool = Join-Path $repoRoot "runs\policy_pool\policy_pool.json"
}

Assert-NoSystemPython -UseSystemPython $UseSystemPython
$pythonExe = Get-PVPRoboPython -RepoRoot $repoRoot
$baseArgs = @("-m", "mc_pvp_env.duel_policy_manifest", "--manifest", $Manifest, $Command)
if ($Command -eq "register") {
    if ($Checkpoint -eq "" -and $PolicyType -ne "scripted") { throw "-Checkpoint is required for register unless -PolicyType scripted." }
    $baseArgs += @(
        "--difficulty", $Difficulty,
        "--policy-type", $PolicyType
    )
    if ($Checkpoint -ne "") { $baseArgs += @("--checkpoint", $Checkpoint) }
    if ($PolicyId -ne "") { $baseArgs += @("--policy-id", $PolicyId) }
    if ($Source -ne "") { $baseArgs += @("--source", $Source) }
    if ($Notes -ne "") { $baseArgs += @("--notes", $Notes) }
} elseif ($Command -eq "resolve") {
    $baseArgs += @("--difficulty", $Difficulty)
} elseif ($Command -eq "import-champion") {
    $baseArgs += @("--policy-pool", $PolicyPool, "--difficulty", $Difficulty)
    if ($Notes -ne "") { $baseArgs += @("--notes", $Notes) }
}

& $pythonExe @baseArgs
if ($LASTEXITCODE -ne 0) {
    throw "Duel policy manifest command failed with exit code $LASTEXITCODE."
}
