param(
    [int]$WorkerId = 0,
    [string]$JavaHome = "",
    [string]$GradleHome = "",
    [string]$NodeHome = "",
    [string[]]$SpectatorUsernames = @(),
    [int]$ArenaCount = 4,
    [double]$ArenaSpacing = 64.0,
    [int]$ArenaColumns = 2,
    [int]$MaxPlayers = 0,
    [double]$RequestTimeoutSeconds = 5.0,
    [int]$BotWatchdogTimeoutMs = 5000,
    [int]$TargetHits = 50,
    [int]$TotalTimesteps = 10000,
    [int]$CheckpointFreq = 2000,
    [double]$LearningRate = 0.0003,
    [double]$ClipRange = 0.2,
    [double]$EntCoef = 0.0,
    [int]$NSteps = 256,
    [int]$BatchSize = 64,
    [int]$NEpochs = 4,
    [string]$Device = "auto",
    [string]$BcCheckpoint = "",
    [string]$ResumeCheckpoint = "",
    [int]$PolicyHiddenSize = 0,
    [string]$RunDir = "",
    [ValidateSet("neutral", "movement_only", "weak_scripted", "curriculum_scripted", "curriculum", "mineflayer_pvp", "policy_pool_sample")]
    [string]$OpponentPolicy = "neutral",
    [string]$OpponentCurriculumSteps = "5000,15000",
    [string]$PolicyPoolManifest = "",
    [string]$PolicyPoolWeights = "0.5,0.3,0.2",
    [switch]$ExposeLan,
    [switch]$Rebuild,
    [switch]$AcceptEula,
    [switch]$Tui
)

$ErrorActionPreference = "Stop"

$scriptedOpponent = if ($OpponentPolicy -eq "mineflayer_pvp") { "mineflayer_pvp" } else { "none" }
& (Join-Path $PSScriptRoot "start-worker.ps1") -WorkerId $WorkerId -JavaHome $JavaHome -GradleHome $GradleHome -NodeHome $NodeHome -SpectatorUsernames $SpectatorUsernames -ArenaCount $ArenaCount -ArenaSpacing $ArenaSpacing -ArenaColumns $ArenaColumns -MaxPlayers $MaxPlayers -RequestTimeoutSeconds $RequestTimeoutSeconds -BotWatchdogTimeoutMs $BotWatchdogTimeoutMs -TargetHits $TargetHits -ScriptedOpponent $scriptedOpponent -Steps 0 -ExposeLan:$ExposeLan -Rebuild:$Rebuild -AcceptEula:$AcceptEula -SkipRollout
& (Join-Path $PSScriptRoot "run-ppo-training.ps1") -WorkerId $WorkerId -TotalTimesteps $TotalTimesteps -CheckpointFreq $CheckpointFreq -LearningRate $LearningRate -ClipRange $ClipRange -EntCoef $EntCoef -NSteps $NSteps -BatchSize $BatchSize -NEpochs $NEpochs -Device $Device -BcCheckpoint $BcCheckpoint -ResumeCheckpoint $ResumeCheckpoint -PolicyHiddenSize $PolicyHiddenSize -RunDir $RunDir -OpponentPolicy $OpponentPolicy -OpponentCurriculumSteps $OpponentCurriculumSteps -PolicyPoolManifest $PolicyPoolManifest -PolicyPoolWeights $PolicyPoolWeights -Tui:$Tui
