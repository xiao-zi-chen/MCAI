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
    [int]$BotSpawnLoginThrottleMs = 3100,
    [ValidateSet("mineflayer", "herobot")]
    [string]$BotBackend = "mineflayer",
    [int]$TargetHits = 50,
    [ValidateSet("none", "random", "controller_pvp", "mineflayer_pvp")]
    [string]$ScriptedOpponent = "none",
    [string]$RoboSkinUrl = "",
    [string]$RoboSkinTextureValue = "",
    [string]$RoboSkinTextureSignature = "",
    [string]$ScriptSkinUrl = "",
    [string]$ScriptSkinTextureValue = "",
    [string]$ScriptSkinTextureSignature = "",
    [switch]$DuelMode,
    [switch]$ExposeLan,
    [switch]$Rebuild,
    [switch]$AcceptEula
)

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot
$workerName = "worker_{0:D3}" -f $WorkerId
$workerDir = Join-Path $repoRoot "runs\$workerName"
$downloadsDir = Join-Path $repoRoot "downloads"
$paperVersion = "1.21"
$serverPort = 25565 + $WorkerId
$pluginPort = 25580 + ($WorkerId * 10)
$botPort = 25581 + ($WorkerId * 10)
$monitoringPort = 25582 + ($WorkerId * 10)
$minecraftBotPort = if ([string]::IsNullOrWhiteSpace($env:PVPROBO_BOT_MINECRAFT_PORT)) { $serverPort } else { [int]$env:PVPROBO_BOT_MINECRAFT_PORT }
$minecraftBotVersion = if ([string]::IsNullOrWhiteSpace($env:PVPROBO_BOT_MINECRAFT_VERSION)) { "auto" } else { $env:PVPROBO_BOT_MINECRAFT_VERSION }
$paperVelocityOnlineMode = if ([string]::IsNullOrWhiteSpace($env:PVPROBO_VELOCITY_ONLINE_MODE)) { "false" } else { $env:PVPROBO_VELOCITY_ONLINE_MODE.ToLowerInvariant() }
$playerAuthMode = if ($paperVelocityOnlineMode -eq "false") { "offline" } else { "online" }
$serverIp = if ($ExposeLan) { "" } else { "127.0.0.1" }
$resolvedArenaColumns = if ($ArenaColumns -gt 0) { $ArenaColumns } else { [Math]::Ceiling([Math]::Sqrt([Math]::Max(1, $ArenaCount))) }
$spectatorSlots = [Math]::Max(0, $SpectatorUsernames.Count)
$resolvedMaxPlayers = if ($MaxPlayers -gt 0) { $MaxPlayers } else { [Math]::Max(20, ([Math]::Max(1, $ArenaCount) * 2) + $spectatorSlots + 4) }
$botNames = @()
if ($DuelMode) {
    $botNames += "ROBO"
} else {
    for ($i = 0; $i -lt [Math]::Max(1, $ArenaCount); $i++) {
        $botNames += "ROBO-A$i"
        $botNames += "SCRIPT-A$i"
    }
}

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

function Write-TextFile($Path, $Content) {
    $parent = Split-Path -Parent $Path
    New-Item -ItemType Directory -Force -Path $parent | Out-Null
    $utf8NoBom = [Text.UTF8Encoding]::new($false)
    [IO.File]::WriteAllText($Path, $Content, $utf8NoBom)
}

function Get-OfflineUuid($Name) {
    $bytes = [Text.Encoding]::UTF8.GetBytes("OfflinePlayer:$Name")
    $md5 = [Security.Cryptography.MD5]::Create()
    try {
        $hash = $md5.ComputeHash($bytes)
    } finally {
        $md5.Dispose()
    }
    $hash[6] = (($hash[6] -band 0x0f) -bor 0x30)
    $hash[8] = (($hash[8] -band 0x3f) -bor 0x80)
    $hex = ($hash | ForEach-Object { $_.ToString("x2") }) -join ""
    return "{0}-{1}-{2}-{3}-{4}" -f $hex.Substring(0, 8), $hex.Substring(8, 4), $hex.Substring(12, 4), $hex.Substring(16, 4), $hex.Substring(20, 12)
}

function Get-KnownOnlineUuid($Name) {
    switch ($Name.ToLowerInvariant()) {
        "kyakaykya" { return "3318d9d5-0f87-4db0-bb16-35f23e062656" }
        default { return "" }
    }
}

function Write-Operators($WorkerDir, [string[]]$Names) {
    if ($Names.Count -eq 0) {
        return
    }
    $opsPath = Join-Path $WorkerDir "ops.json"
    $ops = @()
    if (Test-Path -LiteralPath $opsPath) {
        try {
            $existing = Get-Content -LiteralPath $opsPath -Raw | ConvertFrom-Json
            if ($null -ne $existing) {
                $ops += @($existing)
            }
        } catch {
            $ops = @()
        }
    }
    foreach ($name in $Names) {
        if ([string]::IsNullOrWhiteSpace($name)) {
            continue
        }
        $uuid = if ($playerAuthMode -eq "online") {
            Get-KnownOnlineUuid $name
        } else {
            ""
        }
        if ([string]::IsNullOrWhiteSpace($uuid)) {
            $uuid = Get-OfflineUuid $name
        }
        $already = $false
        foreach ($op in $ops) {
            if ($op.name -ieq $name) {
                $op.uuid = $uuid
                $op.level = 4
                $op.bypassesPlayerLimit = $true
                $already = $true
            }
        }
        if (-not $already) {
            $ops += [pscustomobject]@{
                uuid = $uuid
                name = $name
                level = 4
                bypassesPlayerLimit = $true
            }
        }
    }
    $opsArray = @($ops)
    Write-TextFile $opsPath ((ConvertTo-Json -InputObject $opsArray -Depth 4) + "`r`n")
}

function Download-Paper($Version, $OutDir) {
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
    $jar = Join-Path $OutDir "paper-$Version.jar"
    if (Test-Path -LiteralPath $jar) {
        return $jar
    }

    $headers = @{
        "User-Agent" = "PVPRobo local research worker"
    }
    try {
        $builds = Invoke-RestMethod -Headers $headers -Uri "https://fill.papermc.io/v3/projects/paper/versions/$Version/builds"
        $build = $builds | Where-Object { $_.channel -eq "STABLE" } | Select-Object -First 1
        if ($null -eq $build) {
            $build = $builds | Select-Object -First 1
        }
        $url = $build.downloads.'server:default'.url
        if ([string]::IsNullOrWhiteSpace($url)) {
            throw "Could not resolve Paper v3 download URL for version $Version."
        }
        Invoke-WebRequest -Headers $headers -Uri $url -OutFile $jar
        return $jar
    } catch {
        Write-Warning "PaperMC v3 download failed; trying legacy v2 API: $($_.Exception.Message)"
    }

    $builds = Invoke-RestMethod -Uri "https://api.papermc.io/v2/projects/paper/versions/$Version/builds"
    $build = ($builds.builds | Sort-Object build -Descending | Select-Object -First 1).build
    if ($null -eq $build) {
        throw "Could not resolve Paper build for version $Version."
    }
    $file = "paper-$Version-$build.jar"
    $url = "https://api.papermc.io/v2/projects/paper/versions/$Version/builds/$build/downloads/$file"
    Invoke-WebRequest -Uri $url -OutFile $jar
    return $jar
}

if ($JavaHome -ne "") {
    $env:JAVA_HOME = $JavaHome
    $env:Path = (Join-Path $JavaHome "bin") + [IO.Path]::PathSeparator + $env:Path
    Normalize-PathEnvironment
}

if ($NodeHome -ne "") {
    $env:Path = $NodeHome + [IO.Path]::PathSeparator + $env:Path
    Normalize-PathEnvironment
}

$java = Get-Command java -ErrorAction SilentlyContinue
if ($null -eq $java) {
    throw "Missing Java 21. Install Java 21 or pass -JavaHome."
}

$existingPluginJar = Get-ChildItem -LiteralPath (Join-Path $repoRoot "server-plugin\build\libs") -Filter "*.jar" -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if ($Rebuild -or $null -eq $existingPluginJar) {
    & (Join-Path $PSScriptRoot "build-plugin.ps1") -JavaHome $JavaHome -GradleHome $GradleHome
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

$paperJar = Download-Paper $paperVersion $downloadsDir

New-Item -ItemType Directory -Force -Path $workerDir | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $workerDir "plugins\PVPRobo") | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $workerDir "logs") | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $workerDir "plugins\PVPRobo\skins") | Out-Null

Copy-Item -LiteralPath $paperJar -Destination (Join-Path $workerDir "paper.jar") -Force
$pluginJar = Get-ChildItem -LiteralPath (Join-Path $repoRoot "server-plugin\build\libs") -Filter "*.jar" | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if ($null -eq $pluginJar) {
    throw "Built plugin jar not found under server-plugin\build\libs."
}
Copy-Item -LiteralPath $pluginJar.FullName -Destination (Join-Path $workerDir "plugins\PVPRobo.jar") -Force
$roboSkin = Join-Path $repoRoot "downloads\skin\ROBO.png"
if (Test-Path -LiteralPath $roboSkin) {
    Copy-Item -LiteralPath $roboSkin -Destination (Join-Path $workerDir "plugins\PVPRobo\skins\ROBO.png") -Force
}
Write-Operators $workerDir $OperatorUsernames

$serverProperties = @"
server-port=$serverPort
server-ip=$serverIp
online-mode=false
enforce-secure-profile=false
spawn-protection=0
view-distance=4
simulation-distance=4
player-idle-timeout=0
enable-command-block=false
motd=PVPRobo local worker $WorkerId
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
max-players=$resolvedMaxPlayers
level-name=world
"@
Write-TextFile (Join-Path $workerDir "server.properties") $serverProperties

if (-not [string]::IsNullOrWhiteSpace($env:PVPROBO_VELOCITY_FORWARDING_SECRET)) {
    $paperProxyConfig = @"
proxies:
  bungee-cord:
    online-mode: true
  proxy-protocol: false
  velocity:
    enabled: true
    online-mode: $paperVelocityOnlineMode
    secret: "$env:PVPROBO_VELOCITY_FORWARDING_SECRET"
"@
} else {
    $paperProxyConfig = @"
proxies:
  bungee-cord:
    online-mode: true
  proxy-protocol: false
  velocity:
    enabled: false
    online-mode: true
    secret: ''
"@
}

$paperGlobalConfig = @"
_version: 29
packet-limiter:
  all-packets:
    action: DROP
    interval: 7.0
    max-packet-rate: 5000.0
  kick-message: <red><lang:disconnect.exceeded_packet_rate>
  overrides:
    ServerboundPlaceRecipePacket:
      action: DROP
      interval: 4.0
      max-packet-rate: 5.0
$paperProxyConfig
"@
Write-TextFile (Join-Path $workerDir "config\paper-global.yml") $paperGlobalConfig

if ($AcceptEula) {
    [IO.File]::WriteAllText((Join-Path $workerDir "eula.txt"), "eula=true`r`n", [Text.Encoding]::ASCII)
} elseif (-not (Test-Path -LiteralPath (Join-Path $workerDir "eula.txt"))) {
    Write-Host "Minecraft EULA not accepted. To accept explicitly, rerun with -AcceptEula or manually create runs\$workerName\eula.txt containing eula=true."
}

$spectatorYaml = "[]"
if ($SpectatorUsernames.Count -gt 0) {
    $spectatorYaml = "`r`n" + (($SpectatorUsernames | ForEach-Object { "    - `"$($_)`"" }) -join "`r`n")
}

$zhDifficultyBc = [string]::Concat([char]0x65B0, [char]0x624B, " ROBO")
$zhDifficultyPpoMid = [string]::Concat([char]0x719F, [char]0x7EC3, " ROBO")
$zhDifficultyPpoHigh = [string]::Concat([char]0x7CBE, [char]0x82F1, " ROBO")
$zhDifficultyScriptEasy = [string]::Concat([char]0x5165, [char]0x95E8, " SCRIPT")
$zhDifficultyScriptHard = [string]::Concat([char]0x5F3A, [char]0x52B2, " SCRIPT")
$zhDifficultyChampion = [string]::Concat([char]0x51A0, [char]0x519B, " ROBO")

$pluginConfig = @"
control:
  host: "127.0.0.1"
  port: $pluginPort
  request-timeout-ms: 5000
monitoring:
  enabled: true
  host: "$MonitoringHost"
  port: $monitoringPort
  auth-token: "$MonitoringAuthToken"
  history:
    sample-interval-seconds: 20
    max-samples: 4320
  recordings:
    directory: ""
server:
  display-name: "PVPRobo"
  domain: "$ServerDomain"
admission:
  player-auth-mode: "$playerAuthMode"
  protect-reserved-names-in-offline-mode: true
  reserved-name-message: "This PVPRobo name is reserved. Please choose another name."
  max-human-players: $MaxHumanPlayers
  bot-name-prefixes:
    - "ROBO"
    - "SCRIPT"
  full-message: "PVPRobo human player slots are full. Please try again later."
afk:
  enabled: true
  warn-after-seconds: 900
  kick-after-seconds: 1200
  check-interval-seconds: 30
  warning-message: "You have been idle for a while. Move or use the PVPRobo menu to keep your slot."
  kick-message: "You were disconnected for being idle so another player can use the PVPRobo slot."
localization:
  default-language: "en_us"
  auto-detect-client-locale: true
  difficulty-names:
    zh_cn:
      bc: "$zhDifficultyBc"
      ppo_mid: "$zhDifficultyPpoMid"
      ppo_high: "$zhDifficultyPpoHigh"
      script_easy: "$zhDifficultyScriptEasy"
      script_hard: "$zhDifficultyScriptHard"
      champion: "$zhDifficultyChampion"
  overrides: {}
arena:
  world: "world"
  center:
    x: 0.0
    y: 64.0
    z: 0.0
  radius: 12.0
  count: $ArenaCount
  spacing: $ArenaSpacing
  columns: $resolvedArenaColumns
  wall-height: 5
  player-a:
    x: -2.0
    y: 64.0
    z: 0.0
    yaw: 90.0
    pitch: 0.0
  player-b:
    x: 2.0
    y: 64.0
    z: 0.0
    yaw: -90.0
    pitch: 0.0
episode:
  max-ticks: 2400
  combat-mode: "hit_count"
  target-hits: $TargetHits
spectators:
  usernames: $spectatorYaml
replay:
  enabled: true
  directory: "replays"
  max-volume: 120000
duel:
  world: "world"
  arena-id: "arena_0"
  default-robo-name: "ROBO"
  bot-combat-backend: "$BotBackend"
  hit-count-equipment:
    enabled: true
    weapon: "IRON_SWORD"
  enabled-difficulties:
    - "bc"
    - "ppo_mid"
    - "ppo_high"
    - "champion"
    - "script_easy"
    - "script_hard"
  difficulty-order:
    - "bc"
    - "ppo_mid"
    - "ppo_high"
    - "champion"
    - "script_easy"
    - "script_hard"
  difficulty-names:
    bc: "Novice ROBO"
    ppo_mid: "Skilled ROBO"
    ppo_high: "Elite ROBO"
    script_easy: "Basic SCRIPT"
    script_hard: "Tough SCRIPT"
    champion: "Champion ROBO"
  robo-skin:
    enabled: true
    file: "skins/ROBO.png"
    model: "slim"
    url: "$RoboSkinUrl"
    texture-value: "$RoboSkinTextureValue"
    texture-signature: "$RoboSkinTextureSignature"
  script-skin:
    enabled: false
    file: "skins/SCRIPT.png"
    model: "slim"
    url: "$ScriptSkinUrl"
    texture-value: "$ScriptSkinTextureValue"
    texture-signature: "$ScriptSkinTextureSignature"
  default-target-hits: 50
  reset-mode: "preserve_blocks"
  arena-pool:
    enabled: true
    count: 0
    columns: 0
    spacing: 56.0
  auto-arena:
    enabled: true
    style: "champion_hall"
    radius-x: 22
    radius-z: 22
    clear-below: 2
    clear-above: 12
  max-clear-build-volume: 200000
  countdown-seconds: 3
  knockout-enabled: false
  knockout-drop-y: 3.0
  allow-op-building: true
  bounds:
    center:
      x: 0.0
      y: 64.0
      z: 0.0
    radius-x: 22.0
    radius-y: 13.0
    radius-z: 22.0
  player-spawn:
    x: -2.0
    y: 64.0
    z: 0.0
    yaw: -90.0
    pitch: 0.0
  robo-spawn:
    x: 2.0
    y: 64.0
    z: 0.0
    yaw: 90.0
    pitch: 0.0
  spectator-spawn:
    x: 0.0
    y: 66.0
    z: 8.0
    yaw: 180.0
    pitch: 20.0
  robo-standby-spawn:
    x: 0.0
    y: 66.0
    z: 8.0
    yaw: 180.0
    pitch: 20.0
lobby:
  world: "world"
  leash-radius: 80.0
  spawn:
    x: 0.0
    y: 66.0
    z: 12.0
    yaw: 0.0
    pitch: 0.0
leaderboard:
  enabled: false
  offset:
    x: 0.0
    y: 5.0
    z: 10.0
  column-spacing-x: 4.5
  line-spacing: 0.28
"@
Write-TextFile (Join-Path $workerDir "plugins\PVPRobo\config.yml") $pluginConfig

$envConfig = @{
    protocol_version = 1
    host = "127.0.0.1"
    plugin_port = $pluginPort
    bot_port = $botPort
    connect_timeout_seconds = 30.0
    request_timeout_seconds = $RequestTimeoutSeconds
    action_repeat_ticks = 2
    max_episode_ticks = 2400
    arena = "arena_0"
    arena_count = $ArenaCount
    self_name = "ROBO-A0"
    opponent_name = "SCRIPT-A0"
    self_name_template = "ROBO-A{index}"
    opponent_name_template = "SCRIPT-A{index}"
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
    server_runtime = "paper-$paperVersion"
    minecraft_version = $paperVersion
    bot_backend = $BotBackend
} | ConvertTo-Json -Depth 4
Write-TextFile (Join-Path $workerDir "env.json") $envConfig

$botConfig = @{
    host = "127.0.0.1"
    bot_backend = $BotBackend
    bot_controller_port = $botPort
    minecraft_host = "127.0.0.1"
    minecraft_port = $minecraftBotPort
    minecraft_version = $minecraftBotVersion
    bot_names = $botNames
    action_repeat_ticks = 2
    watchdog_timeout_ms = $BotWatchdogTimeoutMs
    spawn_login_throttle_ms = $BotSpawnLoginThrottleMs
    scripted_opponent = if ($ScriptedOpponent -eq "mineflayer_pvp") { "controller_pvp" } else { $ScriptedOpponent }
    spectator_usernames = $SpectatorUsernames
} | ConvertTo-Json -Depth 4
Write-TextFile (Join-Path $workerDir "bot.json") $botConfig

Write-Host "Worker prepared: $workerDir"
Write-Host "server_port=$serverPort plugin_port=$pluginPort bot_port=$botPort"
Write-Host "arena_count=$ArenaCount arena_spacing=$ArenaSpacing arena_columns=$resolvedArenaColumns"
Write-Host "max_players=$resolvedMaxPlayers"
Write-Host "bot_backend=$BotBackend"
Write-Host "scripted_opponent=$ScriptedOpponent"
Write-Host "duel_mode=$DuelMode"
if ($ExposeLan) {
    Write-Host "Minecraft server is bound to all interfaces for LAN viewing. Plugin and bot control ports remain localhost-only."
}
