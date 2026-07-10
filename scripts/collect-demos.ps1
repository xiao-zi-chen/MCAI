param(
    [int]$WorkerId = 0,
    [int]$Episodes = 0,
    [int]$TargetTransitions = 0,
    [int]$Seed = 123,
    [string]$Out = "",
    [int]$MaxStepsPerEpisode = 0,
    [int]$TargetHits = 0,
    [int]$ProgressEveryEpisodes = 25
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

if ([string]::IsNullOrWhiteSpace($Out)) {
    $stamp = Get-Date -Format "yyyyMMdd-HHmmss"
    $Out = Join-Path $workerDir "demos\expert_v1_$stamp"
}

$pythonExe = Get-PVPRoboPython -RepoRoot $repoRoot
$argsList = @(
    "-m", "mc_pvp_env.collect_demos",
    "--config", $envConfig,
    "--seed", "$Seed",
    "--out", $Out
)
if ($Episodes -gt 0) {
    $argsList += @("--episodes", "$Episodes")
}
if ($TargetTransitions -gt 0) {
    $argsList += @("--target-transitions", "$TargetTransitions")
}
if ($MaxStepsPerEpisode -gt 0) {
    $argsList += @("--max-steps-per-episode", "$MaxStepsPerEpisode")
}
if ($TargetHits -gt 0) {
    $argsList += @("--target-hits", "$TargetHits")
}
if ($ProgressEveryEpisodes -gt 0) {
    $argsList += @("--progress-every-episodes", "$ProgressEveryEpisodes")
}
if (($Episodes -le 0) -and ($TargetTransitions -le 0)) {
    throw "Provide -Episodes or -TargetTransitions."
}

& $pythonExe @argsList
if ($LASTEXITCODE -ne 0) {
    throw "Demo collection failed with exit code $LASTEXITCODE."
}
