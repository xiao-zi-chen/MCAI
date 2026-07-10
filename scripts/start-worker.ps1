param(
    [int]$WorkerId = 0,
    [string]$JavaHome = "",
    [string]$GradleHome = "",
    [string]$NodeHome = "",
    [string[]]$SpectatorUsernames = @(),
    [string[]]$OperatorUsernames = @(),
    [int]$ArenaCount = 1,
    [double]$ArenaSpacing = 64.0,
    [int]$ArenaColumns = 0,
    [int]$MaxPlayers = 0,
    [int]$MaxHumanPlayers = 20,
    [double]$RequestTimeoutSeconds = 5.0,
    [int]$BotWatchdogTimeoutMs = 5000,
    [int]$TargetHits = 50,
    [int]$Steps = 100,
    [ValidateSet("none", "random", "mineflayer_pvp")]
    [string]$ScriptedOpponent = "none",
    [switch]$DuelMode,
    [switch]$ExposeLan,
    [switch]$Rebuild,
    [switch]$SkipRollout,
    [switch]$AcceptEula
)

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot
$workerName = "worker_{0:D3}" -f $WorkerId
$workerDir = Join-Path $repoRoot "runs\$workerName"
$pidDir = Join-Path $workerDir "pids"
$serverPort = 25565 + $WorkerId
$pluginPort = 25580 + ($WorkerId * 10)
$botPort = 25581 + ($WorkerId * 10)

function Test-PortInUse($Port) {
    $netstatPattern = "^\s*TCP\s+\S+:$Port\s+\S+\s+LISTENING\s+\d+\s*$"
    $netstatHit = netstat -ano | Where-Object { $_ -match $netstatPattern } | Select-Object -First 1
    return $null -ne $netstatHit
}

function Wait-Port($Port, $Name, $TimeoutSeconds = 60) {
    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    while ((Get-Date) -lt $deadline) {
        try {
            $client = [Net.Sockets.TcpClient]::new()
            $async = $client.BeginConnect("127.0.0.1", $Port, $null, $null)
            if ($async.AsyncWaitHandle.WaitOne(500)) {
                $client.EndConnect($async)
                $client.Close()
                Write-Host "$Name ready on 127.0.0.1:$Port"
                return
            }
            $client.Close()
        } catch {
            Start-Sleep -Milliseconds 500
        }
    }
    throw "$Name did not open 127.0.0.1:$Port within $TimeoutSeconds seconds."
}

function Normalize-ProcessPath {
    $pathValue = [Environment]::GetEnvironmentVariable("Path", "Process")
    if ([string]::IsNullOrEmpty($pathValue)) {
        $pathValue = [Environment]::GetEnvironmentVariable("PATH", "Process")
    }
    if ([string]::IsNullOrEmpty($pathValue)) {
        $pathValue = [Environment]::GetEnvironmentVariable("Path", "Machine")
    }
    [Environment]::SetEnvironmentVariable("PATH", $null, "Process")
    [Environment]::SetEnvironmentVariable("Path", $pathValue, "Process")
}

function Add-ToProcessPath($PathEntry) {
    if ([string]::IsNullOrWhiteSpace($PathEntry)) {
        return
    }
    Normalize-ProcessPath
    $pathValue = [Environment]::GetEnvironmentVariable("Path", "Process")
    [Environment]::SetEnvironmentVariable("Path", $PathEntry + [IO.Path]::PathSeparator + $pathValue, "Process")
}

if ((Test-PortInUse $serverPort) -or (Test-PortInUse $pluginPort) -or (Test-PortInUse $botPort)) {
    throw "Worker $WorkerId ports are already in use. Run scripts\stop-workers.ps1 -WorkerId $WorkerId before starting this worker."
}

& (Join-Path $PSScriptRoot "setup-worker.ps1") -WorkerId $WorkerId -JavaHome $JavaHome -GradleHome $GradleHome -NodeHome $NodeHome -SpectatorUsernames $SpectatorUsernames -OperatorUsernames $OperatorUsernames -ArenaCount $ArenaCount -ArenaSpacing $ArenaSpacing -ArenaColumns $ArenaColumns -MaxPlayers $MaxPlayers -MaxHumanPlayers $MaxHumanPlayers -RequestTimeoutSeconds $RequestTimeoutSeconds -BotWatchdogTimeoutMs $BotWatchdogTimeoutMs -TargetHits $TargetHits -ScriptedOpponent $ScriptedOpponent -DuelMode:$DuelMode -ExposeLan:$ExposeLan -Rebuild:$Rebuild -AcceptEula:$AcceptEula

if (-not (Test-Path -LiteralPath (Join-Path $workerDir "eula.txt"))) {
    throw "Minecraft EULA is not accepted. Rerun with -AcceptEula only if you agree to Mojang's EULA."
}

New-Item -ItemType Directory -Force -Path $pidDir | Out-Null
Normalize-ProcessPath

$javaExe = Join-Path $JavaHome "bin\java.exe"
if (-not (Test-Path -LiteralPath $javaExe)) {
    $javaExe = "java"
}

$paperLog = Join-Path $workerDir "logs\paper.out.log"
$paperErr = Join-Path $workerDir "logs\paper.err.log"
$paper = Start-Process -FilePath $javaExe -ArgumentList @("-Xms1G", "-Xmx2G", "-jar", "paper.jar", "--nogui") -WorkingDirectory $workerDir -RedirectStandardOutput $paperLog -RedirectStandardError $paperErr -WindowStyle Hidden -PassThru
Set-Content -LiteralPath (Join-Path $pidDir "paper.pid") -Value $paper.Id
Wait-Port $serverPort "Paper server" 90
Wait-Port $pluginPort "PVPRobo plugin" 90

Push-Location (Join-Path $repoRoot "bot-controller")
try {
    if ($NodeHome -ne "") {
        Add-ToProcessPath $NodeHome
    }
    $botLog = Join-Path $workerDir "logs\bot-controller.out.log"
    $botErr = Join-Path $workerDir "logs\bot-controller.err.log"
    $botConfig = Join-Path $workerDir "bot.json"
    $nodeExe = if ($NodeHome -ne "") { Join-Path $NodeHome "node.exe" } else { "node" }
    $bot = Start-Process -FilePath $nodeExe -ArgumentList @(".\dist\index.js", "--config", $botConfig) -WorkingDirectory (Get-Location) -RedirectStandardOutput $botLog -RedirectStandardError $botErr -WindowStyle Hidden -PassThru
    Set-Content -LiteralPath (Join-Path $pidDir "bot-controller.pid") -Value $bot.Id
} finally {
    Pop-Location
}
Wait-Port $botPort "Bot controller" 30

if (-not $SkipRollout) {
    & (Join-Path $PSScriptRoot "run-random-rollout.ps1") -WorkerId $WorkerId -Steps $Steps
}
