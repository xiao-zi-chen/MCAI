param(
    [int]$WorkerId = 0,
    [Parameter(Mandatory = $true)]
    [string]$Policy,
    [int]$Episodes = 50,
    [int]$Seed = 123,
    [int]$MaxStepsPerEpisode = 0,
    [int]$TargetHits = 50,
    [string]$Opponents = "movement_only,weak_scripted,curriculum_scripted,mineflayer_pvp",
    [string]$OpponentCurriculumSteps = "5000,15000",
    [string]$OutDir = "",
    [switch]$Stochastic,
    [switch]$UseSystemPython,
    [switch]$ManageWorker,
    [string]$JavaHome = "",
    [string]$GradleHome = "",
    [string]$NodeHome = "",
    [int]$ArenaCount = 1,
    [double]$ArenaSpacing = 64.0,
    [int]$ArenaColumns = 0,
    [double]$RequestTimeoutSeconds = 60.0,
    [int]$BotWatchdogTimeoutMs = 5000,
    [switch]$AcceptEula,
    [switch]$Rebuild
)

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot
. (Join-Path $PSScriptRoot "python-env.ps1")
$workerName = "worker_{0:D3}" -f $WorkerId
$workerDir = Join-Path $repoRoot "runs\$workerName"
$envConfig = Join-Path $workerDir "env.json"

if ((-not $ManageWorker) -and (-not (Test-Path -LiteralPath $envConfig))) {
    throw "Missing worker env config: $envConfig. Run scripts\setup-worker.ps1 or scripts\start-worker.ps1 first."
}

if ($OutDir -eq "") {
    $stamp = Get-Date -Format "yyyyMMdd-HHmmss"
    $OutDir = Join-Path $workerDir "eval\matrix_$stamp"
}
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null

Assert-NoSystemPython -UseSystemPython $UseSystemPython
$pythonExe = Get-PVPRoboPython -RepoRoot $repoRoot

function Invoke-PythonMatrix($OpponentList, $OutputDir, $SeedOffset) {
    $baseArgs = @(
        "-m", "mc_pvp_env.eval_ppo_matrix",
        "--config", $envConfig,
        "--policy", $Policy,
        "--episodes", $Episodes,
        "--seed", ($Seed + $SeedOffset),
        "--out-dir", $OutputDir,
        "--opponents", $OpponentList,
        "--opponent-curriculum-steps", $OpponentCurriculumSteps
    )
    if ($MaxStepsPerEpisode -gt 0) { $baseArgs += @("--max-steps-per-episode", $MaxStepsPerEpisode) }
    if ($TargetHits -gt 0) { $baseArgs += @("--target-hits", $TargetHits) }
    if ($Stochastic) { $baseArgs += "--stochastic" }

    & $pythonExe @baseArgs
    if ($LASTEXITCODE -ne 0) {
        throw "PPO eval matrix failed with exit code $LASTEXITCODE."
    }
}

$opponentValues = @()
foreach ($part in ($Opponents -split ",")) {
    $trimmed = $part.Trim()
    if ($trimmed -ne "") { $opponentValues += $trimmed }
}
$hasMineflayer = $opponentValues -contains "mineflayer_pvp"
$hasPythonSide = ($opponentValues | Where-Object { $_ -ne "mineflayer_pvp" }).Count -gt 0

if (-not $ManageWorker) {
    if ($hasMineflayer -and $hasPythonSide) {
        throw "Mixed mineflayer_pvp and Python-side opponents require -ManageWorker so the script can restart the worker with the correct ScriptedOpponent mode."
    }
    Invoke-PythonMatrix $Opponents $OutDir 0
    return
}

$combinedResults = @()
try {
    $index = 0
    foreach ($opponent in $opponentValues) {
        & (Join-Path $PSScriptRoot "stop-workers.ps1") -WorkerId $WorkerId
        $scriptedOpponent = if ($opponent -eq "mineflayer_pvp") { "mineflayer_pvp" } else { "none" }
        & (Join-Path $PSScriptRoot "start-worker.ps1") -WorkerId $WorkerId -JavaHome $JavaHome -GradleHome $GradleHome -NodeHome $NodeHome -ArenaCount $ArenaCount -ArenaSpacing $ArenaSpacing -ArenaColumns $ArenaColumns -RequestTimeoutSeconds $RequestTimeoutSeconds -BotWatchdogTimeoutMs $BotWatchdogTimeoutMs -TargetHits $TargetHits -ScriptedOpponent $scriptedOpponent -Rebuild:$Rebuild -AcceptEula:$AcceptEula -SkipRollout
        $opponentOut = Join-Path $OutDir ("opponent_{0}" -f $opponent)
        Invoke-PythonMatrix $opponent $opponentOut $index
        $payload = Get-Content -LiteralPath (Join-Path $opponentOut "eval_matrix.json") -Raw | ConvertFrom-Json
        foreach ($result in $payload.results) {
            $combinedResults += $result
        }
        $index += 1
    }
} finally {
    & (Join-Path $PSScriptRoot "stop-workers.ps1") -WorkerId $WorkerId
}

$combined = [ordered]@{
    policy = $Policy
    episodes = $Episodes
    seed = $Seed
    target_hits = $TargetHits
    opponents = $opponentValues
    managed_worker = $true
    results = $combinedResults
}
$combined | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $OutDir "eval_matrix.json") -Encoding UTF8
$csvRows = foreach ($result in $combinedResults) {
    [pscustomobject]@{
        policy = $result.policy
        opponent_policy = $result.opponent_policy
        episodes = $result.episodes
        win_rate = $result.win_rate
        loss_rate = $result.loss_rate
        draw_rate = $result.draw_rate
        reward_mean = $result.reward_mean
        reward_std = $result.reward_std
        episode_length_mean = $result.episode_length_mean
        episode_length_min = $result.episode_length_min
        episode_length_max = $result.episode_length_max
        self_hits_mean = $result.self_hits_mean
        opponent_hits_mean = $result.opponent_hits_mean
        episodes_per_sec = $result.episodes_per_sec
        elapsed_seconds = $result.elapsed_seconds
        phase_counts_json = ($result.phase_counts | ConvertTo-Json -Compress)
    }
}
$csvRows | Export-Csv -LiteralPath (Join-Path $OutDir "eval_matrix.csv") -NoTypeInformation -Encoding UTF8
Write-Host "PVPRobo managed PPO eval matrix complete"
Write-Host "out_dir=$OutDir"
