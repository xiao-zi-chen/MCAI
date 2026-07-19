param(
    [int]$WorkerId = 1,
    [string]$Manifest = "",
    [string]$RoboName = "ROBO",
    [string]$ArenaId = "arena_0",
    [int]$MaxSteps = 0,
    [int]$MaxSessions = 0,
    [double]$WaitTimeoutSeconds = 120.0,
    [double]$PollSeconds = 0.5,
    [double]$IdleTimeoutSeconds = 0.0,
    [string]$RecordDir = "__default__",
    [switch]$UseSystemPython
)

$ErrorActionPreference = "Stop"

if ($WorkerId -eq 0) {
    throw "run-duel-daemon.ps1 is intentionally isolated from worker 0. Use worker 1 unless explicitly testing another nonzero duel worker."
}

$repoRoot = Split-Path -Parent $PSScriptRoot
. (Join-Path $PSScriptRoot "python-env.ps1")
$workerName = "worker_{0:D3}" -f $WorkerId
$envConfig = Join-Path $repoRoot "runs\$workerName\env.json"
if ($RecordDir -eq "__default__") {
    $RecordDir = Join-Path $repoRoot "runs\$workerName\duel-records"
}
if ($Manifest -eq "") {
    $Manifest = Join-Path $repoRoot "runs\duel\duel-policies.json"
}

if (-not (Test-Path -LiteralPath $envConfig)) {
    throw "Missing worker env config: $envConfig. Start or set up the duel worker first."
}
if (-not (Test-Path -LiteralPath $Manifest)) {
    throw "Missing duel policy manifest: $Manifest. Register bc/ppo difficulties with scripts\register-duel-policy.ps1 first."
}
Assert-NoSystemPython -UseSystemPython $UseSystemPython

$pythonExe = Get-PVPRoboPython -RepoRoot $repoRoot
$argsList = @(
    "-m", "mc_pvp_env.duel_runner",
    "--config", $envConfig,
    "--manifest", $Manifest,
    "--auto",
    "--robo-name", $RoboName,
    "--arena-id", $ArenaId,
    "--wait-timeout-seconds", "$WaitTimeoutSeconds",
    "--poll-seconds", "$PollSeconds"
)
if ($MaxSteps -gt 0) {
    $argsList += @("--max-steps", "$MaxSteps")
}
if ($MaxSessions -gt 0) {
    $argsList += @("--max-sessions", "$MaxSessions")
}
if ($IdleTimeoutSeconds -gt 0) {
    $argsList += @("--idle-timeout-seconds", "$IdleTimeoutSeconds")
}
if ($RecordDir -ne "") {
    $argsList += @("--record-dir", $RecordDir)
}

& $pythonExe @argsList
if ($LASTEXITCODE -ne 0) {
    throw "Duel daemon failed with exit code $LASTEXITCODE."
}
