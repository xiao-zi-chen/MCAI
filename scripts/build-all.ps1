param(
    [string]$JavaHome = "",
    [string]$GradleHome = "",
    [switch]$SkipPluginTests
)

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot
. (Join-Path $PSScriptRoot "python-env.ps1")

& (Join-Path $PSScriptRoot "build-plugin.ps1") -JavaHome $JavaHome -GradleHome $GradleHome -SkipTests:$SkipPluginTests

Push-Location (Join-Path $repoRoot "bot-controller")
try {
    npm.cmd test
    if ($LASTEXITCODE -ne 0) {
        throw "Bot controller tests failed with exit code $LASTEXITCODE."
    }
} finally {
    Pop-Location
}

Push-Location $repoRoot
try {
    $pythonExe = Get-PVPRoboPython -RepoRoot $repoRoot
    & $pythonExe -m unittest discover -s python\tests
    if ($LASTEXITCODE -ne 0) {
        throw "Python tests failed with exit code $LASTEXITCODE."
    }
} finally {
    Pop-Location
}
