param(
    [int]$WorkerId = 0,
    [Parameter(Mandatory = $true)]
    [string]$Manifest,
    [int]$Episodes = 200,
    [int]$Seed = 123,
    [int]$MaxStepsPerEpisode = 0,
    [int]$TargetHits = 50,
    [string]$OutDir = "",
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

if ($OutDir -eq "") {
    $stamp = Get-Date -Format "yyyyMMdd-HHmmss"
    $OutDir = Join-Path $workerDir "eval\league_$stamp"
}
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null

$pythonExe = Get-PVPRoboPython -RepoRoot $repoRoot
$pythonArgs = @(
    "-m", "mc_pvp_env.eval_league",
    "--config", $envConfig,
    "--manifest", $Manifest,
    "--episodes", $Episodes,
    "--seed", $Seed,
    "--out-dir", $OutDir
)
if ($MaxStepsPerEpisode -gt 0) { $pythonArgs += @("--max-steps-per-episode", $MaxStepsPerEpisode) }
if ($TargetHits -gt 0) { $pythonArgs += @("--target-hits", $TargetHits) }
if ($Stochastic) { $pythonArgs += "--stochastic" }

& $pythonExe @pythonArgs
if ($LASTEXITCODE -ne 0) {
    throw "League eval failed with exit code $LASTEXITCODE."
}
