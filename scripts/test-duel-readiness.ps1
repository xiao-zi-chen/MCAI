param(
    [int]$WorkerId = 1,
    [string]$Manifest = "",
    [string[]]$Difficulties = @("bc", "ppo_mid", "ppo_high", "champion", "script_easy", "script_hard"),
    [string]$SchematicName = "sumo_arena.schem",
    [string]$LobbySchematicName = "ancient_chinese_town.schem",
    [switch]$RequireRunning,
    [switch]$UseSystemPython
)

$ErrorActionPreference = "Stop"

if ($WorkerId -eq 0) {
    throw "test-duel-readiness.ps1 is intentionally isolated from worker 0. Use -WorkerId 1 unless the user explicitly authorizes another nonzero worker."
}

$repoRoot = Split-Path -Parent $PSScriptRoot
. (Join-Path $PSScriptRoot "python-env.ps1")
$workerName = "worker_{0:D3}" -f $WorkerId
$workerDir = Join-Path $repoRoot "runs\$workerName"
$envConfig = Join-Path $workerDir "env.json"
$botConfig = Join-Path $workerDir "bot.json"
$pluginConfig = Join-Path $workerDir "plugins\PVPRobo\config.yml"
$roboSkin = Join-Path $workerDir "plugins\PVPRobo\skins\ROBO.png"
$worldEditJar = Join-Path $workerDir "plugins\WorldEdit.jar"
$schematic = Join-Path $workerDir "plugins\WorldEdit\schematics\pvprobo\$SchematicName"
$lobbySchematic = Join-Path $workerDir "plugins\WorldEdit\schematics\pvprobo\$LobbySchematicName"
if ($Manifest -eq "") {
    $Manifest = Join-Path $repoRoot "runs\duel\duel-policies.json"
}

$checks = New-Object System.Collections.Generic.List[object]

function Add-Check($Name, $Ok, $Detail) {
    $script:checks.Add([pscustomobject]@{
        name = $Name
        ok = [bool]$Ok
        detail = $Detail
    }) | Out-Null
}

function Test-File($Name, $Path) {
    $exists = Test-Path -LiteralPath $Path
    Add-Check $Name $exists $Path
    return $exists
}

function Get-YamlSectionValue($Text, $SectionName, $Key, $Default) {
    $inSection = $false
    foreach ($line in ($Text -split "\r?\n")) {
        if ($line -match "^\s{2}$([Regex]::Escape($SectionName)):\s*$") {
            $inSection = $true
            continue
        }
        if ($inSection -and $line -match "^\s{2}\S") {
            break
        }
        if ($inSection -and $line -match "^\s{4}$([Regex]::Escape($Key)):\s+(.+?)\s*$") {
            return $Matches[1].Trim('"')
        }
    }
    return $Default
}

function Get-ListenPid($Port) {
    $line = netstat -ano | Where-Object { $_ -match "^\s*TCP\s+\S+:$Port\s+\S+\s+LISTENING\s+(\d+)\s*$" } | Select-Object -First 1
    if ($null -eq $line) { return $null }
    if ($line -match "LISTENING\s+(\d+)\s*$") { return [int]$Matches[1] }
    return $null
}

Test-File "worker_dir" $workerDir | Out-Null
$hasEnv = Test-File "env_config" $envConfig
$hasBot = Test-File "bot_config" $botConfig
Test-File "plugin_config" $pluginConfig | Out-Null
Test-File "robo_skin" $roboSkin | Out-Null
Add-Check "worldedit_jar_optional" $true ($(if (Test-Path -LiteralPath $worldEditJar) { $worldEditJar } else { "missing; auto arena does not require WorldEdit" }))
Add-Check "staged_schematic_optional" $true ($(if (Test-Path -LiteralPath $schematic) { $schematic } else { "missing; auto arena does not require sumo schematic" }))
Add-Check "lobby_schematic_optional" $true ($(if (Test-Path -LiteralPath $lobbySchematic) { $lobbySchematic } else { "missing; configured lobby spawn will be used" }))
$hasManifest = Test-File "duel_policy_manifest" $Manifest

if (Test-Path -LiteralPath $pluginConfig) {
    $pluginConfigText = Get-Content -LiteralPath $pluginConfig -Raw
    Add-Check "auto_arena_enabled" ($pluginConfigText -match "(?ms)auto-arena:\s*\r?\n\s+enabled:\s+true") "duel.auto-arena.enabled=true"
    Add-Check "arena_pool_enabled" ($pluginConfigText -match "(?ms)arena-pool:\s*\r?\n\s+enabled:\s+true") "duel.arena-pool.enabled=true"
    $humanLimitMatch = [Regex]::Match($pluginConfigText, "(?m)^\s+max-human-players:\s+(-?\d+)\s*$")
    $radiusXMatch = [Regex]::Match($pluginConfigText, "(?m)^\s+radius-x:\s+([0-9.]+)\s*$")
    $humanLimit = if ($humanLimitMatch.Success) { [int]$humanLimitMatch.Groups[1].Value } else { -1 }
    $playerAuthModeMatch = [Regex]::Match($pluginConfigText, "(?m)^\s+player-auth-mode:\s+`"?([^`"\r\n]+)`"?\s*$")
    $reservedNameProtectionMatch = [Regex]::Match($pluginConfigText, "(?m)^\s+protect-reserved-names-in-offline-mode:\s+(true|false)\s*$")
    $playerAuthMode = if ($playerAuthModeMatch.Success) { $playerAuthModeMatch.Groups[1].Value } else { "online" }
    $reservedNameProtection = if ($reservedNameProtectionMatch.Success) { $reservedNameProtectionMatch.Groups[1].Value } else { "false" }
    Add-Check "player_auth_mode_config" (@("online", "offline") -contains $playerAuthMode) "admission.player-auth-mode=$playerAuthMode"
    Add-Check "reserved_name_protection" ($reservedNameProtection -eq "true") "admission.protect-reserved-names-in-offline-mode=$reservedNameProtection"
    $arenaPoolCount = [int](Get-YamlSectionValue $pluginConfigText "arena-pool" "count" "1")
    $arenaPoolColumns = [int](Get-YamlSectionValue $pluginConfigText "arena-pool" "columns" "1")
    $effectiveArenaPoolCount = if ($humanLimit -gt 0) { [Math]::Max([Math]::Max(1, $arenaPoolCount), $humanLimit) } elseif ($arenaPoolCount -gt 0) { $arenaPoolCount } else { 1 }
    $effectiveArenaPoolColumns = if ($arenaPoolColumns -gt 0) { $arenaPoolColumns } else { [Math]::Ceiling([Math]::Sqrt([Math]::Max(1, $effectiveArenaPoolCount))) }
    $arenaPoolSpacing = [double](Get-YamlSectionValue $pluginConfigText "arena-pool" "spacing" "0.0")
    $radiusX = if ($radiusXMatch.Success) { [double]$radiusXMatch.Groups[1].Value } else { 22.0 }
    Add-Check "arena_pool_capacity" ($humanLimit -lt 0 -or $effectiveArenaPoolCount -ge $humanLimit) "arena_pool.count=$arenaPoolCount effective=$effectiveArenaPoolCount admission.max-human-players=$humanLimit"
    Add-Check "arena_pool_columns" ($effectiveArenaPoolColumns -ge 1) "arena_pool.columns=$arenaPoolColumns effective=$effectiveArenaPoolColumns"
    Add-Check "arena_pool_spacing" ($arenaPoolSpacing -ge (($radiusX * 2.0) + 8.0)) "arena_pool.spacing=$arenaPoolSpacing radius_x=$radiusX"
    Add-Check "knockout_disabled" ($pluginConfigText -match "(?m)^\s+knockout-enabled:\s+false\s*$") "duel.knockout-enabled=false"
    Add-Check "replay_enabled" ($pluginConfigText -match "(?ms)^replay:\s*\r?\n\s+enabled:\s+true") "replay.enabled=true"
    Add-Check "replay_directory" ($pluginConfigText -match "(?m)^\s+directory:\s+`"replays`"\s*$") "replay.directory=replays"
}

$pluginPort = 25580 + ($WorkerId * 10)
$botPort = 25581 + ($WorkerId * 10)
$mcPort = 25565 + $WorkerId
if ($hasEnv) {
    $envJson = Get-Content -LiteralPath $envConfig -Raw | ConvertFrom-Json
    $pluginPort = [int]$envJson.plugin_port
    $botPort = [int]$envJson.bot_port
    Add-Check "env_action_mode" ($envJson.action_mode -eq "curriculum_discrete") ("action_mode=" + $envJson.action_mode)
    Add-Check "env_localhost" ($envJson.host -eq "127.0.0.1") ("host=" + $envJson.host)
}
if ($hasBot) {
    $botJson = Get-Content -LiteralPath $botConfig -Raw | ConvertFrom-Json
    $mcPort = [int]$botJson.minecraft_port
    $botNames = @($botJson.bot_names)
    Add-Check "bot_robo" ($botNames -contains "ROBO") ("bot_names=" + ($botNames -join ","))
    Add-Check "bot_control_localhost" ($botJson.host -eq "127.0.0.1") ("host=" + $botJson.host)
}

foreach ($item in @(
    @{ name = "minecraft_port"; port = $mcPort },
    @{ name = "plugin_port"; port = $pluginPort },
    @{ name = "bot_port"; port = $botPort }
)) {
    $listenPid = Get-ListenPid $item.port
    $ok = if ($RequireRunning) { $null -ne $listenPid } else { $true }
    $detail = if ($null -ne $listenPid) { "$($item.port) listening pid=$listenPid" } else { "$($item.port) not listening" }
    Add-Check $item.name $ok $detail
}

if ($hasManifest) {
    Assert-NoSystemPython -UseSystemPython $UseSystemPython
    $pythonExe = Get-PVPRoboPython -RepoRoot $repoRoot
    foreach ($difficulty in $Difficulties) {
        $argsList = @(
            "-m", "mc_pvp_env.duel_policy_manifest",
            "--manifest", $Manifest,
            "preflight",
            "--difficulty", $difficulty
        )
        $output = $null
        $exitCode = 0
        try {
            $output = & $pythonExe @argsList 2>&1
            $exitCode = $LASTEXITCODE
        } catch {
            $output = $_.Exception.Message
            $exitCode = 1
        }
        Add-Check "difficulty_$difficulty" ($exitCode -eq 0) (($output | Out-String).Trim())
    }
}

$failed = @($checks | Where-Object { -not $_.ok })
$checks | Format-Table -AutoSize | Out-String | Write-Host
if ($failed.Count -gt 0) {
    throw "PVPRobo duel readiness failed: $($failed.Count) check(s) failed."
}

Write-Host "PVPRobo duel readiness checks passed for $workerName."
