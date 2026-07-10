param(
    [Parameter(Mandatory=$true)][string]$Policy,
    [int]$WorkerId = 0,
    [int]$Episodes = 20,
    [int]$Seed = 123,
    [int]$MaxStepsPerEpisode = 0,
    [int]$TargetHits = 0
)

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot
. (Join-Path $PSScriptRoot "python-env.ps1")
$workerName = "worker_{0:D3}" -f $WorkerId
$workerDir = Join-Path $repoRoot "runs\$workerName"
$envConfig = Join-Path $workerDir "env.json"

if (-not (Test-Path -LiteralPath $envConfig)) {
    throw "Missing worker env config: $envConfig. Run scripts\setup-worker.ps1 first."
}

$pythonExe = Get-PVPRoboPython -RepoRoot $repoRoot
$argsList = @(
    "-m", "mc_pvp_env.eval_policy",
    "--policy", $Policy,
    "--config", $envConfig,
    "--episodes", "$Episodes",
    "--seed", "$Seed"
)
if ($MaxStepsPerEpisode -gt 0) {
    $argsList += @("--max-steps-per-episode", "$MaxStepsPerEpisode")
}
if ($TargetHits -gt 0) {
    $argsList += @("--target-hits", "$TargetHits")
}

& $pythonExe @argsList
if ($LASTEXITCODE -ne 0) {
    throw "Policy evaluation failed with exit code $LASTEXITCODE."
}
