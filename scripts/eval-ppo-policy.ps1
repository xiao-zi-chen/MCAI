param(
    [int]$WorkerId = 0,
    [Parameter(Mandatory = $true)]
    [string]$Policy,
    [int]$Episodes = 50,
    [int]$Seed = 123,
    [int]$MaxStepsPerEpisode = 0,
    [int]$TargetHits = 0,
    [ValidateSet("neutral", "movement_only", "weak_scripted", "curriculum_scripted", "curriculum", "mineflayer_pvp")]
    [string]$OpponentPolicy = "movement_only",
    [string]$OpponentCurriculumSteps = "5000,15000",
    [switch]$Stochastic
)

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot
. (Join-Path $PSScriptRoot "python-env.ps1")
$workerName = "worker_{0:D3}" -f $WorkerId
$workerDir = Join-Path $repoRoot "runs\$workerName"
$envConfig = Join-Path $workerDir "env.json"

if (-not (Test-Path -LiteralPath $envConfig)) {
    throw "Missing worker env config: $envConfig. Run scripts\setup-worker.ps1 or scripts\start-worker.ps1 first."
}

$pythonExe = Get-PVPRoboPython -RepoRoot $repoRoot
$baseArgs = @(
    "-m", "mc_pvp_env.eval_ppo",
    "--config", $envConfig,
    "--policy", $Policy,
    "--episodes", $Episodes,
    "--seed", $Seed,
    "--opponent-policy", $OpponentPolicy,
    "--opponent-curriculum-steps", $OpponentCurriculumSteps
)
if ($MaxStepsPerEpisode -gt 0) { $baseArgs += @("--max-steps-per-episode", $MaxStepsPerEpisode) }
if ($TargetHits -gt 0) { $baseArgs += @("--target-hits", $TargetHits) }
if ($Stochastic) { $baseArgs += "--stochastic" }

& $pythonExe @baseArgs
if ($LASTEXITCODE -ne 0) {
    throw "PPO eval failed with exit code $LASTEXITCODE."
}
