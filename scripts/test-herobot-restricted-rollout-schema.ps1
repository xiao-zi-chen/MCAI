param(
    [int]$WorkerId = 0,
    [int]$Steps = 4,
    [string]$EpisodeId = "herobot-restricted-rollout-schema",
    [string]$OutDir = ""
)

$ErrorActionPreference = "Stop"
if ($WorkerId -ne 0) {
    throw "HeRoBot/Fabric restricted rollout schema check is restricted to worker0."
}
if ($Steps -le 0) {
    throw "Steps must be positive."
}

$repoRoot = Split-Path -Parent $PSScriptRoot
. (Join-Path $PSScriptRoot "python-env.ps1")
$workerName = "worker_{0:D3}" -f $WorkerId
$workerDir = Join-Path $repoRoot "runs\$workerName"
$envConfigPath = Join-Path $workerDir "env.json"
if (-not (Test-Path -LiteralPath $envConfigPath)) {
    throw "Missing worker env config: $envConfigPath. Start worker0 Fabric first."
}

$envConfig = Get-Content -LiteralPath $envConfigPath -Raw | ConvertFrom-Json
if ($OutDir -eq "") {
    $stamp = Get-Date -Format "yyyyMMdd-HHmmss"
    $OutDir = Join-Path $workerDir "restricted-rollout\herobot_schema_$stamp"
}
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null

$pythonExe = Get-PVPRoboPython -RepoRoot $repoRoot
$args = @(
    "-m", "mc_pvp_env.restricted_rollout",
    "--out-dir", $OutDir,
    "--agent-id", ([string]$envConfig.self_name),
    "--episode-id", $EpisodeId,
    "--arena-id", ([string]$envConfig.arena),
    "--host", ([string]$envConfig.host),
    "--bot-port", ([int]$envConfig.bot_port),
    "--steps", $Steps,
    "--control-step-ticks", 1,
    "--backend", "herobot",
    "--minecraft-version", "1.21.11",
    "--server-runtime", "fabric-1.21.11",
    "--visual-profile-id", "none",
    "--mouse-profile-id", "herobot_relative_v1"
)
& $pythonExe @args
if ($LASTEXITCODE -ne 0) {
    throw "HeRoBot restricted rollout collection failed with exit code $LASTEXITCODE."
}

$manifestPath = Join-Path $OutDir "manifest.json"
if (-not (Test-Path -LiteralPath $manifestPath)) {
    throw "Missing restricted rollout manifest: $manifestPath"
}
$manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
if ([int]$manifest.schema_version -ne 2) {
    throw "Expected restricted dataset schema_version=2, got $($manifest.schema_version)."
}
if ([string]$manifest.backend -ne "herobot" -or [string]$manifest.server_runtime -ne "fabric-1.21.11") {
    throw "Unexpected lineage: backend=$($manifest.backend) server_runtime=$($manifest.server_runtime)"
}
if ($manifest.episodes.Count -lt 1) {
    throw "Restricted rollout manifest has no episodes."
}

$episodePath = Join-Path $OutDir ([string]$manifest.episodes[0].file)
$lines = Get-Content -LiteralPath $episodePath
if ($lines.Count -ne $Steps) {
    throw "Expected $Steps restricted rollout rows, got $($lines.Count)."
}
$required = @("action_requested", "action_executed", "action_execution_status", "action_execution_status_reasons")
foreach ($line in $lines) {
    $row = $line | ConvertFrom-Json
    foreach ($field in $required) {
        if (-not ($row.PSObject.Properties.Name -contains $field)) {
            throw "Restricted rollout row missing field '$field'."
        }
    }
}

Write-Host "PVPRobo HeRoBot/Fabric restricted rollout schema check passed"
Write-Host "out_dir=$OutDir"
