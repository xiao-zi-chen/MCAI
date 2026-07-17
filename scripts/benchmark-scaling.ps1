param(
    [int]$WorkerId = 0,
    [string]$ArenaCounts = "1,2,4,8,12,16",
    [int]$Steps = 200,
    [double]$ArenaSpacing = 64.0,
    [int]$ArenaColumns = 0,
    [int]$MaxPlayers = 0,
    [ValidateSet("none", "random", "controller_pvp", "mineflayer_pvp")]
    [string]$ScriptedOpponent = "none",
    [string]$JavaHome = "C:\Program Files\Java\jdk-21.0.11",
    [string]$GradleHome = "D:\gradle-8.7",
    [string]$NodeHome = "",
    [string]$OutDir = "",
    [double]$RequestTimeoutSeconds = 60.0,
    [int]$BotWatchdogTimeoutMs = 5000,
    [int]$TargetHits = 25,
    [switch]$UseSystemPython,
    [switch]$AcceptEula,
    [switch]$Rebuild
)

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot
if ($UseSystemPython) {
    throw "-UseSystemPython is disabled. Run scripts\setup-python-env.ps1 and use the project .venv."
}
if ($OutDir -eq "") {
    $stamp = Get-Date -Format "yyyyMMdd-HHmmss"
    $OutDir = Join-Path $repoRoot "runs\benchmarks\scaling_$stamp"
}
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null

$arenaCountValues = @()
foreach ($part in ($ArenaCounts -split ",")) {
    $trimmed = $part.Trim()
    if ($trimmed -ne "") {
        $arenaCountValues += [int]$trimmed
    }
}
if ($arenaCountValues.Count -eq 0) {
    throw "ArenaCounts must contain at least one integer."
}

$results = @()
$logicalProcessors = $env:NUMBER_OF_PROCESSORS

foreach ($arenaCount in $arenaCountValues) {
    $status = "ok"
    $errorText = ""
    $rolloutLines = @()
    $startTime = Get-Date
    try {
        & (Join-Path $PSScriptRoot "stop-workers.ps1") -WorkerId $WorkerId
        $startArgs = @{
            WorkerId = $WorkerId
            JavaHome = $JavaHome
            GradleHome = $GradleHome
            NodeHome = $NodeHome
            ArenaCount = $arenaCount
            ArenaSpacing = $ArenaSpacing
            ArenaColumns = $ArenaColumns
            MaxPlayers = $MaxPlayers
            RequestTimeoutSeconds = $RequestTimeoutSeconds
            BotWatchdogTimeoutMs = $BotWatchdogTimeoutMs
            TargetHits = $TargetHits
            ScriptedOpponent = $ScriptedOpponent
            SkipRollout = $true
            AcceptEula = $AcceptEula
            Rebuild = $Rebuild
        }
        & (Join-Path $PSScriptRoot "start-worker.ps1") @startArgs
        $rolloutLines = & (Join-Path $PSScriptRoot "run-random-rollout.ps1") -WorkerId $WorkerId -Steps $Steps 2>&1
        if ($LASTEXITCODE -ne 0) {
            throw "random rollout failed with exit code $LASTEXITCODE"
        }
    } catch {
        $status = "failed"
        $errorText = ($_ | Out-String).Trim()
    } finally {
        & (Join-Path $PSScriptRoot "stop-workers.ps1") -WorkerId $WorkerId
    }

    $metrics = @{}
    foreach ($line in $rolloutLines) {
        $text = [string]$line
        if ($text -match '^([A-Za-z_]+)=(.+)$') {
            $metrics[$Matches[1]] = $Matches[2]
        }
    }
    $outerStepsPerSec = if ($metrics.ContainsKey("steps_per_sec")) { [double]$metrics["steps_per_sec"] } else { 0.0 }
    $arenasReported = if ($metrics.ContainsKey("arenas")) { [int]$metrics["arenas"] } else { $arenaCount }
    $row = [pscustomobject]@{
        timestamp = $startTime.ToString("o")
        status = $status
        worker_id = $WorkerId
        arena_count = $arenaCount
        arenas_reported = $arenasReported
        requested_steps = $Steps
        completed_outer_steps = if ($metrics.ContainsKey("steps")) { [int]$metrics["steps"] } else { 0 }
        outer_steps_per_sec = $outerStepsPerSec
        arena_steps_per_sec = $outerStepsPerSec * $arenasReported
        reset_latency_ms = if ($metrics.ContainsKey("reset_latency_ms")) { [double]$metrics["reset_latency_ms"] } else { 0.0 }
        avg_step_latency_ms = if ($metrics.ContainsKey("avg_step_latency_ms")) { [double]$metrics["avg_step_latency_ms"] } else { 0.0 }
        reward_mean = if ($metrics.ContainsKey("reward_mean")) { [double]$metrics["reward_mean"] } else { 0.0 }
        terminated = if ($metrics.ContainsKey("terminated")) { $metrics["terminated"] } else { "" }
        truncated = if ($metrics.ContainsKey("truncated")) { $metrics["truncated"] } else { "" }
        scripted_opponent = $ScriptedOpponent
        max_players_arg = $MaxPlayers
        target_hits = $TargetHits
        logical_processors = $logicalProcessors
        error = $errorText
    }
    $results += $row
    $results | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $OutDir "summary.json") -Encoding UTF8
    $results | Export-Csv -LiteralPath (Join-Path $OutDir "summary.csv") -NoTypeInformation -Encoding UTF8
    $rolloutLines | Set-Content -LiteralPath (Join-Path $OutDir ("arena_{0}.log" -f $arenaCount)) -Encoding UTF8
    Write-Host ("arena_count={0} status={1} arena_steps_per_sec={2:N3}" -f $arenaCount, $status, ($outerStepsPerSec * $arenasReported))
}

Write-Host "PVPRobo scaling benchmark complete"
Write-Host "out_dir=$OutDir"
