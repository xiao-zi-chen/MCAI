param(
    [Parameter(Mandatory=$true)][string]$Data,
    [string]$Out = "",
    [int]$Epochs = 20,
    [int]$BatchSize = 256,
    [double]$LearningRate = 0.0003,
    [int]$HiddenSize = 128,
    [double]$ValFraction = 0.2,
    [int]$Seed = 123
)

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot
. (Join-Path $PSScriptRoot "python-env.ps1")
if ([string]::IsNullOrWhiteSpace($Out)) {
    $stamp = Get-Date -Format "yyyyMMdd-HHmmss"
    $Out = Join-Path $repoRoot "runs\worker_000\bc\bc_$stamp"
}

$pythonExe = Get-PVPRoboPython -RepoRoot $repoRoot
$argsList = @(
    "-m", "mc_pvp_env.train_bc",
    "--data", $Data,
    "--out", $Out,
    "--epochs", "$Epochs",
    "--batch-size", "$BatchSize",
    "--learning-rate", "$LearningRate",
    "--hidden-size", "$HiddenSize",
    "--val-fraction", "$ValFraction",
    "--seed", "$Seed"
)

& $pythonExe @argsList
if ($LASTEXITCODE -ne 0) {
    throw "BC training failed with exit code $LASTEXITCODE."
}
