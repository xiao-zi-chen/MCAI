param(
    [int]$WorkerId = 0,
    [int]$Steps = 100,
    [switch]$UseSystemPython
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

Assert-NoSystemPython -UseSystemPython $UseSystemPython
$pythonExe = Get-PVPRoboPython -RepoRoot $repoRoot
& $pythonExe -m mc_pvp_env.random_rollout --config $envConfig --steps $Steps
if ($LASTEXITCODE -ne 0) {
    throw "Random rollout failed with exit code $LASTEXITCODE."
}
