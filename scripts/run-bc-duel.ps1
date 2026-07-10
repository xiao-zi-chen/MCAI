param(
    [int]$WorkerId = 1,
    [string]$Policy = "",
    [string]$Manifest = "",
    [ValidateSet("bc", "ppo_mid", "ppo_high", "script_easy", "script_hard", "champion")]
    [string]$Difficulty = "bc",
    [Parameter(Mandatory = $true)]
    [string]$Player,
    [string]$RoboName = "ROBO",
    [string]$ArenaId = "arena_0",
    [int]$MaxSteps = 0,
    [double]$WaitTimeoutSeconds = 120.0,
    [switch]$UseSystemPython
)

$ErrorActionPreference = "Stop"

if ($WorkerId -eq 0) {
    throw "run-bc-duel.ps1 is intentionally isolated from worker 0. Use -WorkerId 1 unless the user explicitly authorizes another nonzero worker."
}

$repoRoot = Split-Path -Parent $PSScriptRoot
. (Join-Path $PSScriptRoot "python-env.ps1")
$workerName = "worker_{0:D3}" -f $WorkerId
$envConfig = Join-Path $repoRoot "runs\$workerName\env.json"

if (-not (Test-Path -LiteralPath $envConfig)) {
    throw "Missing worker env config: $envConfig. Start or set up the duel worker first."
}
if ($Manifest -eq "") {
    $Manifest = Join-Path $repoRoot "runs\duel\duel-policies.json"
}
if ($Policy -eq "" -and -not (Test-Path -LiteralPath $Manifest)) {
    throw "Provide -Policy for a direct BC run, or register a difficulty in $Manifest and pass -Difficulty."
}
Assert-NoSystemPython -UseSystemPython $UseSystemPython

$pythonExe = Get-PVPRoboPython -RepoRoot $repoRoot
$argsList = @(
    "-m", "mc_pvp_env.duel_runner",
    "--config", $envConfig,
    "--player", $Player,
    "--robo-name", $RoboName,
    "--arena-id", $ArenaId,
    "--wait-timeout-seconds", $WaitTimeoutSeconds
)
if ($Policy -ne "") {
    $argsList += @("--policy", $Policy)
} else {
    $argsList += @("--manifest", $Manifest, "--difficulty", $Difficulty)
}
if ($MaxSteps -gt 0) {
    $argsList += @("--max-steps", $MaxSteps)
}

& $pythonExe @argsList
if ($LASTEXITCODE -ne 0) {
    throw "BC duel runner failed with exit code $LASTEXITCODE."
}
