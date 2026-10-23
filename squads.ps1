param(
    [ValidateSet('Prepare','Start','Stop','Status','Redis','Doctor','Verify')][string]$Mode='Start',
    [string]$JavaHome='',
    [string]$RedisExe='',
    [ValidateRange(2,8)][int]$MemoryGB=4,
    [ValidateRange(0,10)][int]$NormalRounds=1,
    [switch]$AcceptEula,
    [switch]$NoBrowser
)
$ErrorActionPreference='Stop'
& (Join-Path $PSScriptRoot 'scheduler.ps1') -ConfigFile 'configs/scheduler.squads.json' -Mode $Mode -JavaHome $JavaHome -RedisExe $RedisExe -MemoryGB $MemoryGB -NormalRounds $NormalRounds -AcceptEula:$AcceptEula -NoBrowser:$NoBrowser
exit $LASTEXITCODE
