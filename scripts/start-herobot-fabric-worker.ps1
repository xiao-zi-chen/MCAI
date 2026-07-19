param(
    [int]$WorkerId = 0,
    [string]$JavaHome = "",
    [string]$NodeHome = "",
    [string]$HeroBotRepo = "C:\Project\GameAI\HeRoBot",
    [string]$FabricServerJar = "",
    [int]$TargetHits = 5,
    [int]$RequestTimeoutSeconds = 10,
    [ValidateSet("none", "controller_pvp", "herobot_pvp")]
    [string]$ScriptedOpponent = "none",
    [switch]$Rebuild,
    [switch]$SkipSmoke,
    [switch]$AllowNoDamage,
    [switch]$AcceptEula
)

$ErrorActionPreference = "Stop"
if ($WorkerId -ne 0) {
    throw "HeRoBot/Fabric worker is restricted to worker0. Do not start worker1 on HeRoBot."
}

$repoRoot = Split-Path -Parent $PSScriptRoot
$workerName = "worker_{0:D3}" -f $WorkerId
$workerDir = Join-Path $repoRoot "runs\$workerName"
$pidDir = Join-Path $workerDir "pids"
$serverPort = 25565 + $WorkerId
$controlPort = 25580 + ($WorkerId * 10)
$botPort = 25581 + ($WorkerId * 10)
$commandPort = 25583 + ($WorkerId * 10)
$downloadsDir = Join-Path $repoRoot "downloads"
$fabricVersion = "1.21.11"
$loaderVersion = "0.18.3"
$installerVersion = "1.1.0"
$fabricApiVersion = "0.141.3+1.21.11"
$controllerScriptedOpponent = if ($ScriptedOpponent -eq "none") { "none" } else { "controller_pvp" }

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

function Write-TextFile($Path, $Content) {
    $parent = Split-Path -Parent $Path
    New-Item -ItemType Directory -Force -Path $parent | Out-Null
    $utf8NoBom = [Text.UTF8Encoding]::new($false)
    [IO.File]::WriteAllText($Path, $Content, $utf8NoBom)
}

function Test-PortInUse($Port) {
    $netstatPattern = "^\s*TCP\s+\S+:$Port\s+\S+\s+LISTENING\s+\d+\s*$"
    $netstatHit = netstat -ano | Where-Object { $_ -match $netstatPattern } | Select-Object -First 1
    return $null -ne $netstatHit
}

function Wait-Port($Port, $Name, $TimeoutSeconds = 90, $Process = $null) {
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

function Get-FabricServerJar {
    if ($FabricServerJar -ne "") {
        if (-not (Test-Path -LiteralPath $FabricServerJar)) {
            throw "Fabric server jar not found: $FabricServerJar"
        }
        return (Resolve-Path -LiteralPath $FabricServerJar).Path
    }
    New-Item -ItemType Directory -Force -Path $downloadsDir | Out-Null
    $jar = Join-Path $downloadsDir "fabric-server-mc.$fabricVersion-loader.$loaderVersion-launcher.$installerVersion.jar"
    if (Test-Path -LiteralPath $jar) {
        return $jar
    }
    $url = "https://meta.fabricmc.net/v2/versions/loader/$fabricVersion/$loaderVersion/$installerVersion/server/jar"
    Invoke-WebRequest -Uri $url -OutFile $jar
    return $jar
}

function Get-FabricApiJar {
    $cacheRoot = Join-Path $env:USERPROFILE ".gradle\caches\modules-2\files-2.1\net.fabricmc.fabric-api\fabric-api\$fabricApiVersion"
    if (Test-Path -LiteralPath $cacheRoot) {
        $cached = Get-ChildItem -LiteralPath $cacheRoot -Recurse -Filter "fabric-api-$fabricApiVersion.jar" -ErrorAction SilentlyContinue |
            Where-Object { $_.Length -gt 0 } |
            Sort-Object Length -Descending |
            Select-Object -First 1
        if ($null -ne $cached) {
            return $cached.FullName
        }
    }

    New-Item -ItemType Directory -Force -Path $downloadsDir | Out-Null
    $jar = Join-Path $downloadsDir "fabric-api-$fabricApiVersion.jar"
    if (Test-Path -LiteralPath $jar) {
        return $jar
    }
    $encodedVersion = $fabricApiVersion.Replace("+", "%2B")
    $url = "https://maven.fabricmc.net/net/fabricmc/fabric-api/fabric-api/$encodedVersion/fabric-api-$encodedVersion.jar"
    Invoke-WebRequest -Uri $url -OutFile $jar
    return $jar
}

$JavaHome = Resolve-ToolHome $JavaHome @(
    "C:\Program Files\Java\latest",
    "C:\Program Files\Java\jdk-21.0.11",
    "C:\Program Files\Java\jdk-21.0.10"
) "bin\java.exe"
$NodeHome = Resolve-ToolHome $NodeHome @(
    (Join-Path $repoRoot "downloads\node-v22.23.1-win-x64"),
    (Join-Path $repoRoot "downloads\tools\node-v22.23.1-win-x64")
) "node.exe"

if ($JavaHome -ne "") {
    $env:JAVA_HOME = $JavaHome
    $env:Path = (Join-Path $JavaHome "bin") + [IO.Path]::PathSeparator + $env:Path
    Normalize-PathEnvironment
}
if ($NodeHome -ne "") {
    $env:Path = $NodeHome + [IO.Path]::PathSeparator + $env:Path
    Normalize-PathEnvironment
}

foreach ($port in @($serverPort, $controlPort, $botPort, $commandPort)) {
    if (Test-PortInUse $port) {
        throw "Worker $WorkerId port $port is already in use. Stop worker0 before starting Fabric worker."
    }
}

if (-not (Test-Path -LiteralPath $HeroBotRepo)) {
    throw "HeRoBot checkout not found: $HeroBotRepo"
}

if ($Rebuild -or -not (Test-Path -LiteralPath (Join-Path $repoRoot "fabric-bridge\build\libs\pvprobo-fabric-bridge-0.1.0.jar"))) {
    & (Join-Path $HeroBotRepo "gradlew.bat") -p (Join-Path $repoRoot "fabric-bridge") build
}

$heroBotJar = Get-ChildItem -LiteralPath (Join-Path $HeroBotRepo "build\libs") -Filter "herobot-*.jar" -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -notlike "*sources*" } |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 1
if ($Rebuild -or $null -eq $heroBotJar) {
    & (Join-Path $HeroBotRepo "gradlew.bat") -p $HeroBotRepo build
    $heroBotJar = Get-ChildItem -LiteralPath (Join-Path $HeroBotRepo "build\libs") -Filter "herobot-*.jar" |
        Where-Object { $_.Name -notlike "*sources*" } |
        Sort-Object LastWriteTime -Descending |
        Select-Object -First 1
}
if ($null -eq $heroBotJar) {
    throw "HeRoBot jar not found under $HeroBotRepo\build\libs"
}

Push-Location (Join-Path $repoRoot "bot-controller")
try {
    if (-not (Test-Path -LiteralPath "node_modules")) {
        npm.cmd install
    }
    npm.cmd run build
    if ($LASTEXITCODE -ne 0) {
        throw "Bot controller build failed with exit code $LASTEXITCODE."
    }
} finally {
    Pop-Location
}

New-Item -ItemType Directory -Force -Path $workerDir,$pidDir,(Join-Path $workerDir "logs"),(Join-Path $workerDir "mods") | Out-Null
Copy-Item -LiteralPath (Get-FabricServerJar) -Destination (Join-Path $workerDir "fabric-server.jar") -Force
Copy-Item -LiteralPath (Get-FabricApiJar) -Destination (Join-Path $workerDir "mods\fabric-api.jar") -Force
Copy-Item -LiteralPath (Join-Path $repoRoot "fabric-bridge\build\libs\pvprobo-fabric-bridge-0.1.0.jar") -Destination (Join-Path $workerDir "mods\pvprobo-fabric-bridge.jar") -Force
Copy-Item -LiteralPath $heroBotJar.FullName -Destination (Join-Path $workerDir "mods\herobot.jar") -Force

if ($AcceptEula) {
    [IO.File]::WriteAllText((Join-Path $workerDir "eula.txt"), "eula=true`r`n", [Text.Encoding]::ASCII)
} elseif (-not (Test-Path -LiteralPath (Join-Path $workerDir "eula.txt"))) {
    throw "Minecraft EULA is not accepted. Rerun with -AcceptEula only if you agree to Mojang's EULA."
}

$serverProperties = @"
server-port=$serverPort
server-ip=127.0.0.1
online-mode=false
enforce-secure-profile=false
spawn-protection=0
view-distance=4
simulation-distance=4
player-idle-timeout=0
motd=PVPRobo Fabric worker $WorkerId
allow-flight=true
allow-nether=false
difficulty=normal
gamemode=survival
force-gamemode=true
pvp=true
enable-status=true
hide-online-players=true
network-compression-threshold=-1
spawn-monsters=false
spawn-animals=false
spawn-npcs=false
max-players=20
level-name=world
"@
Write-TextFile (Join-Path $workerDir "server.properties") $serverProperties

$envConfig = @{
    protocol_version = 1
    host = "127.0.0.1"
    plugin_port = $controlPort
    bot_port = $botPort
    connect_timeout_seconds = 30.0
    request_timeout_seconds = $RequestTimeoutSeconds
    action_repeat_ticks = 2
    max_episode_ticks = 2400
    arena = "arena_0"
    arena_count = 1
    self_name = "ROBO_A0"
    opponent_name = "SCRIPT_A0"
    self_name_template = "ROBO_A{index}"
    opponent_name_template = "SCRIPT_A{index}"
    combat_mode = "hit_count"
    target_hits = $TargetHits
    time_penalty_per_step = -0.001
    self_hit_reward_scale = 1.0
    opponent_hit_penalty_scale = 2.0
    post_hit_spacing_reward = 0.003
    danger_close_penalty = 0.002
    safe_distance_min = 2.4
    safe_distance_max = 3.8
    win_reward = 1.0
    loss_reward = -1.0
    timeout_reward = -0.25
    action_mode = "curriculum_discrete"
    server_runtime = "fabric-1.21.11"
    minecraft_version = "1.21.11"
    bot_backend = "herobot"
} | ConvertTo-Json -Depth 4
Write-TextFile (Join-Path $workerDir "env.json") $envConfig

$botConfig = @{
    host = "127.0.0.1"
    bot_backend = "herobot"
    bot_controller_port = $botPort
    minecraft_host = "127.0.0.1"
    minecraft_port = $serverPort
    minecraft_version = "1.21.11"
    bot_names = @("ROBO_A0", "SCRIPT_A0")
    action_repeat_ticks = 2
    watchdog_timeout_ms = 5000
    spawn_login_throttle_ms = 0
    scripted_opponent = $controllerScriptedOpponent
    spectator_usernames = @()
    herobot_command_host = "127.0.0.1"
    herobot_command_port = $commandPort
    herobot_command_timeout_ms = 5000
} | ConvertTo-Json -Depth 4
Write-TextFile (Join-Path $workerDir "bot.json") $botConfig

$javaExe = if ($JavaHome -ne "") { Join-Path $JavaHome "bin\java.exe" } else { "java" }
$fabricLog = Join-Path $workerDir "logs\fabric.out.log"
$fabricErr = Join-Path $workerDir "logs\fabric.err.log"
$fabricArgs = @(
    "-Xms1G",
    "-Xmx2G",
    "-Dpvprobo.bridge.enabled=true",
    "-Dpvprobo.bridge.host=127.0.0.1",
    "-Dpvprobo.bridge.controlPort=$controlPort",
    "-Dpvprobo.bridge.commandPort=$commandPort",
    "-jar",
    "fabric-server.jar",
    "nogui"
)
$fabric = Start-Process -FilePath $javaExe -ArgumentList $fabricArgs -WorkingDirectory $workerDir -RedirectStandardOutput $fabricLog -RedirectStandardError $fabricErr -WindowStyle Hidden -PassThru
Set-Content -LiteralPath (Join-Path $pidDir "fabric.pid") -Value $fabric.Id
Wait-Port $serverPort "Fabric server" 240 $fabric
Wait-Port $controlPort "PVPRobo Fabric bridge" 120 $fabric
Wait-Port $commandPort "PVPRobo Fabric command bridge" 120 $fabric

Push-Location (Join-Path $repoRoot "bot-controller")
try {
    $botLog = Join-Path $workerDir "logs\bot-controller.out.log"
    $botErr = Join-Path $workerDir "logs\bot-controller.err.log"
    $nodeExe = if ($NodeHome -ne "") { Join-Path $NodeHome "node.exe" } else { "node" }
    $bot = Start-Process -FilePath $nodeExe -ArgumentList @(".\dist\index.js", "--config", (Join-Path $workerDir "bot.json")) -WorkingDirectory (Get-Location) -RedirectStandardOutput $botLog -RedirectStandardError $botErr -WindowStyle Hidden -PassThru
    Set-Content -LiteralPath (Join-Path $pidDir "bot-controller.pid") -Value $bot.Id
} finally {
    Pop-Location
}
Wait-Port $botPort "Bot controller" 60 $bot

Write-Host "HeRoBot/Fabric worker0 is ready."
Write-Host "server_runtime=fabric-1.21.11 bot_backend=herobot"
Write-Host "scripted_opponent=$ScriptedOpponent controller_scripted_opponent=$controllerScriptedOpponent"
Write-Host "server_port=$serverPort control_port=$controlPort bot_port=$botPort command_port=$commandPort"

if (-not $SkipSmoke) {
    $smokeArgs = @{
        WorkerId = $WorkerId
    }
    if ($AllowNoDamage) {
        $smokeArgs.AllowNoDamage = $true
    }
    & (Join-Path $PSScriptRoot "test-herobot-fabric-smoke.ps1") @smokeArgs
}
