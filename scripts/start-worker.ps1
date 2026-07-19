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
    [string]$ServerDomain = "localhost",
    [string]$MonitoringHost = "127.0.0.1",
    [string]$MonitoringAuthToken = "",
    [double]$RequestTimeoutSeconds = 5.0,
    [int]$BotWatchdogTimeoutMs = 5000,
    [ValidateSet("mineflayer", "herobot")]
    [string]$BotBackend = "mineflayer",
    [int]$TargetHits = 50,
    [int]$Steps = 100,
    [ValidateSet("none", "random", "controller_pvp", "mineflayer_pvp")]
    [string]$ScriptedOpponent = "none",
    [string]$RoboSkinUrl = "",
    [string]$RoboSkinTextureValue = "",
    [string]$RoboSkinTextureSignature = "",
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

function Resolve-ToolHome($Current, $Candidates, $Executable) {
    if ($Current -ne "" -and (Test-Path -LiteralPath (Join-Path $Current $Executable))) {
        return $Current
    }
    foreach ($candidate in $Candidates) {
        if ($candidate -ne "" -and (Test-Path -LiteralPath (Join-Path $candidate $Executable))) {
            return $candidate
        }
    }
    return $Current
}

function Normalize-PathEnvironment {
    $pathValue = [Environment]::GetEnvironmentVariable("Path", "Process")
    if ([string]::IsNullOrEmpty($pathValue)) {
        $pathValue = [Environment]::GetEnvironmentVariable("PATH", "Process")
    }
    [Environment]::SetEnvironmentVariable("PATH", $null, "Process")
    [Environment]::SetEnvironmentVariable("Path", $pathValue, "Process")
}

$JavaHome = Resolve-ToolHome $JavaHome @(
    "C:\Program Files\Java\latest",
    "C:\Program Files\Java\jdk-21.0.10",
    "C:\Program Files\Java\jdk-21.0.11"
) "bin\java.exe"
$GradleHome = Resolve-ToolHome $GradleHome @(
    (Join-Path $repoRoot "downloads\tools\gradle-8.7"),
    (Join-Path $repoRoot "downloads\gradle-8.7")
) "bin\gradle.bat"
$NodeHome = Resolve-ToolHome $NodeHome @(
    (Join-Path $repoRoot "downloads\node-v22.23.1-win-x64"),
    (Join-Path $repoRoot "downloads\tools\node-v22.23.1-win-x64")
) "node.exe"

function Test-PortInUse($Port) {
    $netstatPattern = "^\s*TCP\s+\S+:$Port\s+\S+\s+LISTENING\s+\d+\s*$"
    $netstatHit = netstat -ano | Where-Object { $_ -match $netstatPattern } | Select-Object -First 1
    return $null -ne $netstatHit
}

function Wait-Port($Port, $Name, $TimeoutSeconds = 60, $Process = $null) {
    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    while ((Get-Date) -lt $deadline) {
        if ($null -ne $Process) {
            $Process.Refresh()
            if ($Process.HasExited) {
                throw "$Name process exited before opening 127.0.0.1:$Port. exit_code=$($Process.ExitCode)"
            }
        }
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

if ((Test-PortInUse $serverPort) -or (Test-PortInUse $pluginPort) -or (Test-PortInUse $botPort)) {
    throw "Worker $WorkerId ports are already in use. Run scripts\stop-workers.ps1 -WorkerId $WorkerId before starting this worker."
}

& (Join-Path $PSScriptRoot "setup-worker.ps1") -WorkerId $WorkerId -JavaHome $JavaHome -GradleHome $GradleHome -NodeHome $NodeHome -SpectatorUsernames $SpectatorUsernames -OperatorUsernames $OperatorUsernames -ArenaCount $ArenaCount -ArenaSpacing $ArenaSpacing -ArenaColumns $ArenaColumns -MaxPlayers $MaxPlayers -MaxHumanPlayers $MaxHumanPlayers -ServerDomain $ServerDomain -MonitoringHost $MonitoringHost -MonitoringAuthToken $MonitoringAuthToken -RequestTimeoutSeconds $RequestTimeoutSeconds -BotWatchdogTimeoutMs $BotWatchdogTimeoutMs -BotBackend $BotBackend -TargetHits $TargetHits -ScriptedOpponent $ScriptedOpponent -RoboSkinUrl $RoboSkinUrl -RoboSkinTextureValue $RoboSkinTextureValue -RoboSkinTextureSignature $RoboSkinTextureSignature -DuelMode:$DuelMode -ExposeLan:$ExposeLan -Rebuild:$Rebuild -AcceptEula:$AcceptEula
Normalize-PathEnvironment

if (-not (Test-Path -LiteralPath (Join-Path $workerDir "eula.txt"))) {
    throw "Minecraft EULA is not accepted. Rerun with -AcceptEula only if you agree to Mojang's EULA."
}

New-Item -ItemType Directory -Force -Path $pidDir | Out-Null

$javaExe = Join-Path $JavaHome "bin\java.exe"
if (-not (Test-Path -LiteralPath $javaExe)) {
    $javaExe = "java"
}

$paperLog = Join-Path $workerDir "logs\paper.out.log"
$paperErr = Join-Path $workerDir "logs\paper.err.log"
$paper = Start-Process -FilePath $javaExe -ArgumentList @("-Xms1G", "-Xmx2G", "-jar", "paper.jar", "--nogui") -WorkingDirectory $workerDir -RedirectStandardOutput $paperLog -RedirectStandardError $paperErr -WindowStyle Hidden -PassThru
Set-Content -LiteralPath (Join-Path $pidDir "paper.pid") -Value $paper.Id
Wait-Port $serverPort "Paper server" 240 $paper
Wait-Port $pluginPort "PVPRobo plugin" 180 $paper

Push-Location (Join-Path $repoRoot "bot-controller")
try {
    if ($NodeHome -ne "") {
        $env:Path = $NodeHome + [IO.Path]::PathSeparator + $env:Path
        Normalize-PathEnvironment
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
Wait-Port $botPort "Bot controller" 60 $bot

if (-not $SkipRollout) {
    & (Join-Path $PSScriptRoot "run-random-rollout.ps1") -WorkerId $WorkerId -Steps $Steps
}
