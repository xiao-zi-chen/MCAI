param(
    [int]$WorkerId = 0,
    [Parameter(Mandatory = $true)]
    [string]$BcCheckpoint,
    [int]$TotalTimesteps = 20000,
    [int]$Seed = 123,
    [int]$CheckpointFreq = 2000,
    [double]$LearningRate = 0.0003,
    [int]$NSteps = 256,
    [int]$BatchSize = 64,
    [int]$NEpochs = 4,
    [string]$Device = "auto",
    [int]$PolicyHiddenSize = 128,
    [ValidateSet("movement_only", "weak_scripted", "curriculum_scripted", "curriculum", "mineflayer_pvp")]
    [string]$OpponentPolicy = "curriculum",
    [string]$OpponentCurriculumSteps = "5000,15000",
    [switch]$Tui
)

$ErrorActionPreference = "Stop"

$common = @{
    WorkerId = $WorkerId
    TotalTimesteps = $TotalTimesteps
    Seed = $Seed
    CheckpointFreq = $CheckpointFreq
    LearningRate = $LearningRate
    NSteps = $NSteps
    BatchSize = $BatchSize
    NEpochs = $NEpochs
    Device = $Device
    OpponentPolicy = $OpponentPolicy
    OpponentCurriculumSteps = $OpponentCurriculumSteps
    Tui = $Tui
}

Write-Host "PVPRobo PPO comparison: pure PPO"
& (Join-Path $PSScriptRoot "run-ppo-training.ps1") @common -PolicyHiddenSize $PolicyHiddenSize

Write-Host "PVPRobo PPO comparison: BC warm-started PPO"
& (Join-Path $PSScriptRoot "run-ppo-training.ps1") @common -BcCheckpoint $BcCheckpoint -PolicyHiddenSize $PolicyHiddenSize
