param(
    [int]$WorkerId = 0,
    [string]$OutDir = "",
    [switch]$AllowNoDamage,
    [switch]$UseSystemPython
)

$ErrorActionPreference = "Stop"
if ($WorkerId -ne 0) {
    throw "HeRoBot/Fabric smoke is restricted to worker0. Worker1 remains Mineflayer."
}

$repoRoot = Split-Path -Parent $PSScriptRoot
. (Join-Path $PSScriptRoot "python-env.ps1")
$workerName = "worker_{0:D3}" -f $WorkerId
$workerDir = Join-Path $repoRoot "runs\$workerName"
$envConfig = Join-Path $workerDir "env.json"

if (-not (Test-Path -LiteralPath $envConfig)) {
    throw "Missing worker env config: $envConfig. Run scripts\start-herobot-fabric-worker.ps1 first."
}
if ($OutDir -eq "") {
    $stamp = Get-Date -Format "yyyyMMdd-HHmmss"
    $OutDir = Join-Path $workerDir "restricted-smoke\herobot_fabric_$stamp"
}
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null

Assert-NoSystemPython -UseSystemPython $UseSystemPython
$pythonExe = Get-PVPRoboPython -RepoRoot $repoRoot
$args = @(
    "-m", "mc_pvp_env.herobot_fabric_smoke",
    "--config", $envConfig,
    "--out-dir", $OutDir
)
if ($AllowNoDamage) {
    $args += "--allow-no-damage"
}

& $pythonExe @args
if ($LASTEXITCODE -ne 0) {
    throw "HeRoBot/Fabric restricted smoke failed with exit code $LASTEXITCODE."
}
Write-Host "out_dir=$OutDir"
