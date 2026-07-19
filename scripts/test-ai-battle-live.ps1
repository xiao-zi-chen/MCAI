param(
    [int]$WorkerId = 1,
    [ValidateSet("bc", "ppo_mid", "ppo_high", "script_easy", "script_hard", "champion")]
    [string]$LeftDifficulty = "bc",
    [ValidateSet("bc", "ppo_mid", "ppo_high", "script_easy", "script_hard", "champion")]
    [string]$RightDifficulty = "script_easy",
    [int]$TargetHits = 2,
    [int]$TimeoutSeconds = 120,
    [switch]$StartWorker,
    [switch]$Rebuild,
    [switch]$AcceptEula
)

$ErrorActionPreference = "Stop"

if ($WorkerId -eq 0) {
    throw "test-ai-battle-live.ps1 is intentionally isolated from worker 0. Use a nonzero worker for local duel smoke tests."
}
if ($StartWorker -and -not $AcceptEula) {
    throw "Pass -AcceptEula only if you agree to Mojang's Minecraft EULA. This script will not accept it silently."
}

$repoRoot = Split-Path -Parent $PSScriptRoot
$pluginPort = 25580 + ($WorkerId * 10)
$botPort = 25581 + ($WorkerId * 10)

function Invoke-Jsonl($Port, $Object) {
    $client = [Net.Sockets.TcpClient]::new("127.0.0.1", $Port)
    try {
        $stream = $client.GetStream()
        $encoding = [Text.UTF8Encoding]::new($false)
        $writer = [IO.StreamWriter]::new($stream, $encoding)
        $reader = [IO.StreamReader]::new($stream, $encoding)
        $writer.AutoFlush = $true
        $writer.WriteLine(($Object | ConvertTo-Json -Compress -Depth 12))
        $line = $reader.ReadLine()
        if ([string]::IsNullOrWhiteSpace($line)) {
            throw "No JSONL response from port $Port."
        }
        return $line | ConvertFrom-Json
    } finally {
        $client.Close()
    }
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

if ($StartWorker) {
    & (Join-Path $PSScriptRoot "start-duel-worker.ps1") `
        -WorkerId $WorkerId `
        -AcceptEula `
        -Rebuild:$Rebuild
} else {
    Wait-Port $pluginPort "PVPRobo plugin" 10
    Wait-Port $botPort "Bot controller" 10
}

$start = Invoke-Jsonl $pluginPort @{
    v = 1
    id = "live-ai"
    type = "start_ai_battle"
    left_difficulty = $LeftDifficulty
    right_difficulty = $RightDifficulty
    target_hits = $TargetHits
}
Write-Host ("start_ai_battle=" + ($start | ConvertTo-Json -Compress -Depth 12))

$seenLeft = $false
$seenRight = $false
$cleared = $false
$lastBotStatus = $null
$lastPluginStatus = $null
$expectedLeft = if ($LeftDifficulty -like "script_*") { if ($LeftDifficulty -eq "script_easy") { "SCRIPT_E0" } else { "SCRIPT_H0" } } elseif ($LeftDifficulty -eq "ppo_mid") { "ROBO_B0" } elseif ($LeftDifficulty -eq "ppo_high") { "ROBO_C0" } elseif ($LeftDifficulty -eq "champion") { "ROBO_D0" } else { "ROBO_A0" }
$expectedRight = if ($RightDifficulty -like "script_*") { if ($RightDifficulty -eq "script_easy") { "SCRIPT_E0" } else { "SCRIPT_H0" } } elseif ($RightDifficulty -eq "ppo_mid") { "ROBO_B0" } elseif ($RightDifficulty -eq "ppo_high") { "ROBO_C0" } elseif ($RightDifficulty -eq "champion") { "ROBO_D0" } else { "ROBO_A0" }
if ($expectedRight -eq $expectedLeft) {
    $expectedRight = $expectedRight.Substring(0, $expectedRight.Length - 1) + "1"
}

$deadline = (Get-Date).AddSeconds($TimeoutSeconds)
while ((Get-Date) -lt $deadline) {
    Start-Sleep -Seconds 1
    $lastBotStatus = Invoke-Jsonl $botPort @{ v = 1; id = "bot-status"; type = "status" }
    $lastPluginStatus = Invoke-Jsonl $pluginPort @{ v = 1; id = "plugin-status"; type = "status" }
    $names = @($lastBotStatus.bots | ForEach-Object { $_.agent_id })
    if ($names -contains $expectedLeft) {
        $seenLeft = $true
    }
    if ($names -contains $expectedRight) {
        $seenRight = $true
    }
    if ($seenLeft -and $seenRight -and -not ($names -contains $expectedLeft) -and -not ($names -contains $expectedRight)) {
        $cleared = $true
        break
    }
}

Write-Host "expected_left=$expectedLeft"
Write-Host "expected_right=$expectedRight"
Write-Host "seen_left=$seenLeft"
Write-Host "seen_right=$seenRight"
Write-Host "temp_bots_cleared=$cleared"
Write-Host ("last_bot_status=" + ($lastBotStatus | ConvertTo-Json -Compress -Depth 12))
Write-Host ("last_plugin_status=" + ($lastPluginStatus | ConvertTo-Json -Compress -Depth 12))

$workerName = "worker_{0:D3}" -f $WorkerId
$latestLog = Join-Path $repoRoot "runs\$workerName\logs\latest.log"
if (Test-Path -LiteralPath $latestLog) {
    Write-Host "paper_ai_battle_logs="
    Get-Content -LiteralPath $latestLog -Tail 180 |
        Select-String -Pattern "Applied .* skin profile|joined the game|left the game|Starting AI battle|AI battle"
}

if (-not $seenLeft -or -not $seenRight -or -not $cleared) {
    throw "AI Battle live smoke failed. Expected both generated bots to connect and then despawn."
}
