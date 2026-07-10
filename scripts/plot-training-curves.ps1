param(
    [Parameter(Mandatory = $true)]
    [string]$RunDir,
    [string]$OutDir = "",
    [int]$Window = 50,
    [switch]$UseSystemPython
)

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot
. (Join-Path $PSScriptRoot "python-env.ps1")
Assert-NoSystemPython -UseSystemPython $UseSystemPython
$pythonExe = Get-PVPRoboPython -RepoRoot $repoRoot

$baseArgs = @(
    "-m", "mc_pvp_env.plot_training_curves",
    "--run-dir", $RunDir,
    "--window", $Window
)
if ($OutDir -ne "") { $baseArgs += @("--out-dir", $OutDir) }

& $pythonExe @baseArgs
if ($LASTEXITCODE -ne 0) {
    throw "Training curve plotting failed with exit code $LASTEXITCODE."
}
