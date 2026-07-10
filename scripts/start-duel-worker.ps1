param(
    [int]$WorkerId = 1,
    [string]$JavaHome = "",
    [string]$GradleHome = "",
    [string]$NodeHome = "",
    [string[]]$SpectatorUsernames = @(),
    [string[]]$OperatorUsernames = @(),
    [int]$MaxPlayers = 20,
    [int]$MaxHumanPlayers = 20,
    [double]$RequestTimeoutSeconds = 30.0,
    [int]$BotWatchdogTimeoutMs = 30000,
    [switch]$ExposeLan,
    [switch]$Rebuild,
    [switch]$AcceptEula
)

$ErrorActionPreference = "Stop"

if ($WorkerId -eq 0) {
    throw "start-duel-worker.ps1 is intentionally isolated from worker 0. Use -WorkerId 1 unless the user explicitly authorizes another nonzero worker."
}

& (Join-Path $PSScriptRoot "start-worker.ps1") `
    -WorkerId $WorkerId `
    -JavaHome $JavaHome `
    -GradleHome $GradleHome `
    -NodeHome $NodeHome `
    -SpectatorUsernames $SpectatorUsernames `
    -OperatorUsernames $OperatorUsernames `
    -ArenaCount 1 `
    -MaxPlayers $MaxPlayers `
    -MaxHumanPlayers $MaxHumanPlayers `
    -RequestTimeoutSeconds $RequestTimeoutSeconds `
    -BotWatchdogTimeoutMs $BotWatchdogTimeoutMs `
    -TargetHits 50 `
    -ScriptedOpponent none `
    -DuelMode `
    -ExposeLan:$ExposeLan `
    -Rebuild:$Rebuild `
    -SkipRollout `
    -AcceptEula:$AcceptEula

Write-Host "Duel worker $WorkerId is ready."
Write-Host ("Minecraft gameplay port: {0}" -f (25565 + $WorkerId))
Write-Host ("PVPRobo plugin control port: {0}" -f (25580 + ($WorkerId * 10)))
Write-Host ("Bot controller port: {0}" -f (25581 + ($WorkerId * 10)))
Write-Host "Stop only this worker with: powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\stop-workers.ps1 -WorkerId $WorkerId"
