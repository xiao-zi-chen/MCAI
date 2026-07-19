param(
    [int]$WorkerId = 0,
    [string]$Policy = "",
    [int]$Episodes = 3,
    [int]$TargetHits = 5,
    [int]$Seed = 123,
    [string]$OutDir = "",
    [switch]$RunPaper,
    [switch]$RunFabric,
    [switch]$AcceptEula,
    [switch]$Rebuild
)

$ErrorActionPreference = "Stop"
if ($WorkerId -ne 0) {
    throw "Worker0 short eval is restricted to worker0. Worker1 remains Mineflayer."
}

$repoRoot = Split-Path -Parent $PSScriptRoot
$workerName = "worker_{0:D3}" -f $WorkerId
$workerDir = Join-Path $repoRoot "runs\$workerName"
if ($Policy -eq "") {
    $Policy = Join-Path $repoRoot "private-deployment\checkpoints\champion.zip"
}
if (-not (Test-Path -LiteralPath $Policy)) {
    throw "Policy checkpoint not found: $Policy"
}
if ($OutDir -eq "") {
    $stamp = Get-Date -Format "yyyyMMdd-HHmmss"
    $OutDir = Join-Path $workerDir "eval\short_$stamp"
}
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null

$runPaperSelected = $RunPaper.IsPresent -or (-not $RunPaper.IsPresent -and -not $RunFabric.IsPresent)
$runFabricSelected = $RunFabric.IsPresent -or (-not $RunPaper.IsPresent -and -not $RunFabric.IsPresent)

function Join-LineagePath([string]$Root, [string[]]$Parts) {
    $current = $Root
    foreach ($part in $Parts) {
        $current = Join-Path $current $part
    }
    return $current
}

function Invoke-ShortEval([string]$OpponentPolicy, [string]$OutputDir) {
    & (Join-Path $PSScriptRoot "eval-ppo-matrix.ps1") `
        -WorkerId $WorkerId `
        -Policy $Policy `
        -Episodes $Episodes `
        -Seed $Seed `
        -TargetHits $TargetHits `
        -Opponents $OpponentPolicy `
        -PolicyLineage "mineflayer_champion" `
        -OutDir $OutputDir
    if ($LASTEXITCODE -ne 0) {
        throw "Worker0 short eval failed for opponent $OpponentPolicy with exit code $LASTEXITCODE."
    }
}

try {
    if ($runPaperSelected) {
        & (Join-Path $PSScriptRoot "stop-workers.ps1") -WorkerId $WorkerId
        & (Join-Path $PSScriptRoot "start-worker.ps1") `
            -WorkerId $WorkerId `
            -TargetHits $TargetHits `
            -ScriptedOpponent "controller_pvp" `
            -Rebuild:$Rebuild `
            -AcceptEula:$AcceptEula `
            -SkipRollout
        $paperOut = Join-LineagePath $OutDir @("paper-1.21", "mineflayer_champion", "vs_controller_pvp")
        Invoke-ShortEval "controller_pvp" $paperOut
    }

    if ($runFabricSelected) {
        & (Join-Path $PSScriptRoot "stop-workers.ps1") -WorkerId $WorkerId
        & (Join-Path $PSScriptRoot "start-herobot-fabric-worker.ps1") `
            -WorkerId $WorkerId `
            -TargetHits $TargetHits `
            -ScriptedOpponent "herobot_pvp" `
            -Rebuild:$Rebuild `
            -AcceptEula:$AcceptEula `
            -SkipSmoke
        $fabricOut = Join-LineagePath $OutDir @("fabric-1.21.11", "mineflayer_champion", "vs_herobot_pvp")
        Invoke-ShortEval "herobot_pvp" $fabricOut
    }
} finally {
    & (Join-Path $PSScriptRoot "stop-workers.ps1") -WorkerId $WorkerId
}

Write-Host "PVPRobo worker0 short eval complete"
Write-Host "out_dir=$OutDir"
