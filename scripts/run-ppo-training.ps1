param(
    [int]$WorkerId = 0,
    [int]$TotalTimesteps = 10000,
    [int]$Seed = 123,
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
    [ValidateSet("neutral", "movement_only", "weak_scripted", "curriculum_scripted", "curriculum", "controller_pvp", "herobot_pvp", "mineflayer_pvp", "policy_pool_sample")]
    [string]$OpponentPolicy = "neutral",
    [string]$OpponentCurriculumSteps = "5000,15000",
    [string]$PolicyPoolManifest = "",
    [string]$PolicyPoolWeights = "0.5,0.3,0.2",
    [switch]$Tui
)

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot
. (Join-Path $PSScriptRoot "python-env.ps1")
$workerName = "worker_{0:D3}" -f $WorkerId
$workerDir = Join-Path $repoRoot "runs\$workerName"
$envConfig = Join-Path $workerDir "env.json"
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
if ($RunDir -ne "") {
    $runDir = $RunDir
} elseif ($ResumeCheckpoint -ne "") {
    $resumePath = Resolve-Path -LiteralPath $ResumeCheckpoint
    $resumeParent = Split-Path -Parent $resumePath.Path
    if ((Split-Path -Leaf $resumeParent) -eq "checkpoints") {
        $runDir = Split-Path -Parent $resumeParent
    } else {
        $runDir = $resumeParent
    }
} else {
    $runDir = Join-Path $workerDir "training\ppo_$stamp"
}

if ($BcCheckpoint -ne "" -and $ResumeCheckpoint -ne "") {
    throw "-BcCheckpoint and -ResumeCheckpoint are mutually exclusive. Resume from the PPO checkpoint directly."
}

if (-not (Test-Path -LiteralPath $envConfig)) {
    throw "Missing worker env config: $envConfig. Run scripts\setup-worker.ps1 or scripts\start-worker.ps1 first."
}

New-Item -ItemType Directory -Force -Path $runDir | Out-Null
$pythonExe = Get-PVPRoboPython -RepoRoot $repoRoot
$pythonArgs = @("-m", "mc_pvp_env.train_ppo", "--config", $envConfig, "--total-timesteps", $TotalTimesteps, "--seed", $Seed, "--run-dir", $runDir, "--checkpoint-freq", $CheckpointFreq, "--learning-rate", $LearningRate, "--clip-range", $ClipRange, "--ent-coef", $EntCoef, "--n-steps", $NSteps, "--batch-size", $BatchSize, "--n-epochs", $NEpochs, "--device", $Device)
if ($BcCheckpoint -ne "") { $pythonArgs += @("--bc-checkpoint", $BcCheckpoint) }
if ($ResumeCheckpoint -ne "") { $pythonArgs += @("--resume-checkpoint", $ResumeCheckpoint) }
if ($PolicyHiddenSize -gt 0) { $pythonArgs += @("--policy-hidden-size", $PolicyHiddenSize) }
$pythonArgs += @("--opponent-policy", $OpponentPolicy, "--opponent-curriculum-steps", $OpponentCurriculumSteps)
if ($PolicyPoolManifest -ne "") { $pythonArgs += @("--policy-pool-manifest", $PolicyPoolManifest) }
if ($PolicyPoolWeights -ne "") { $pythonArgs += @("--policy-pool-weights", $PolicyPoolWeights) }
if ($Tui) { $pythonArgs += "--tui" }
& $pythonExe @pythonArgs
if ($LASTEXITCODE -ne 0) {
    throw "PPO training failed with exit code $LASTEXITCODE."
}
