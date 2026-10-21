param(
    [ValidateSet("Probe", "Prepare", "Play", "Smoke", "Stop")]
    [string]$Mode = "Probe",
    [string]$JavaHome = "E:\Java\jdk-21",
    [string]$GradleHome = "",
    [string]$NodeHome = "",
    [ValidateRange(1, 100)]
    [int]$WorkerId = 1,
    [switch]$AcceptEula
)

$ErrorActionPreference = "Stop"
$repoRoot = $PSScriptRoot
if ($GradleHome -eq "") { $GradleHome = Join-Path $repoRoot "downloads\tools\gradle-8.7" }
if ($NodeHome -eq "") { $NodeHome = Split-Path -Parent (Get-Command node -ErrorAction Stop).Source }
$env:GRADLE_USER_HOME = Join-Path $repoRoot "downloads\gradle-cache"
# Gradle 8.7 worker argfiles must use Windows' native encoding for this Chinese path.
$env:GRADLE_OPTS = "$env:GRADLE_OPTS -Dorg.gradle.jvmargs=-Dfile.encoding=COMPAT"
$env:PYTHONPATH = Join-Path $repoRoot "python\src"
$env:PYTHONUTF8 = "1"
$env:PYTHONIOENCODING = "utf-8"
$env:OMP_NUM_THREADS = "1"
$env:MKL_NUM_THREADS = "1"
$pythonExe = Join-Path $repoRoot ".venv\Scripts\python.exe"

Push-Location $repoRoot
try {
    switch ($Mode) {
        "Probe" {
            & $pythonExe scripts\local-probe.py
            if ($LASTEXITCODE -ne 0) { throw "Local probe failed: $LASTEXITCODE" }
        }
        "Prepare" {
            & .\scripts\setup-worker.ps1 -WorkerId $WorkerId -JavaHome $JavaHome -GradleHome $GradleHome -NodeHome $NodeHome -ArenaCount 1 -MaxPlayers 6 -MaxHumanPlayers 4 -DuelMode -AcceptEula:$AcceptEula
        }
        "Play" {
            $workerName = "worker_{0:D3}" -f $WorkerId
            $eulaFile = Join-Path $repoRoot "runs\$workerName\eula.txt"
            $alreadyAccepted = (Test-Path -LiteralPath $eulaFile) -and ((Get-Content -LiteralPath $eulaFile -Raw) -match '(?m)^\s*eula\s*=\s*true\s*$')
            if (-not $AcceptEula -and -not $alreadyAccepted) {
                throw "Read https://www.minecraft.net/eula first. If you agree, rerun with -AcceptEula."
            }
            & .\scripts\start-duel-worker.ps1 -WorkerId $WorkerId -JavaHome $JavaHome -GradleHome $GradleHome -NodeHome $NodeHome -ArenaCount 1 -MaxPlayers 6 -MaxHumanPlayers 4 -AcceptEula:$AcceptEula
            Write-Host ("Join Minecraft Java 1.21 at 127.0.0.1:{0}; use /pvprobo menu." -f (25565 + $WorkerId))
            Write-Host "The policy daemon runs here. Stop this terminal with Ctrl+C, then use local.ps1 -Mode Stop."
            & .\scripts\run-duel-daemon.ps1 -WorkerId $WorkerId -Manifest configs\duel-policies.example.json
        }
        "Smoke" {
            # Run from a second terminal while Play is active.
            & .\scripts\test-ai-battle-live.ps1 -WorkerId $WorkerId -LeftDifficulty champion -RightDifficulty bc -TargetHits 2
        }
        "Stop" {
            & .\scripts\stop-workers.ps1 -WorkerId $WorkerId -NoElevate
        }
    }
} finally {
    Pop-Location
}
