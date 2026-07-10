param(
    [int]$WorkerId = 1,
    [ValidateSet("bc", "ppo_mid", "ppo_high", "script_easy", "script_hard", "champion")]
    [string]$LeftDifficulty = "champion",
    [ValidateSet("bc", "ppo_mid", "ppo_high", "script_easy", "script_hard", "champion")]
    [string]$RightDifficulty = "bc",
    [string]$Manifest = "",
    [int]$TargetHits = 2,
    [int]$TimeoutSeconds = 180,
    [string]$JavaHome = "",
    [string]$GradleHome = "",
    [string]$NodeHome = "",
    [switch]$StartWorker,
    [switch]$Rebuild,
    [switch]$AcceptEula
)

$ErrorActionPreference = "Stop"

if ($WorkerId -eq 0) {
    throw "test-ai-battle-live.ps1 is intentionally isolated from worker 0. Use worker 1 or another nonzero worker."
}
if ($StartWorker -and -not $AcceptEula) {
    throw "Pass -AcceptEula only if you agree to Mojang's Minecraft EULA. This script will not accept it silently."
}

$repoRoot = Split-Path -Parent $PSScriptRoot
if ($Manifest -eq "") {
    $Manifest = Join-Path $repoRoot "configs\duel-policies.example.json"
}
$pluginPort = 25580 + ($WorkerId * 10)
$botPort = 25581 + ($WorkerId * 10)
$daemon = $null

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

function Get-AiName($Difficulty, $Suffix) {
    if ($Difficulty -eq "script_easy") { return "SCRIPT_E$Suffix" }
    if ($Difficulty -eq "script_hard") { return "SCRIPT_H$Suffix" }
    if ($Difficulty -eq "ppo_mid") { return "ROBO_B$Suffix" }
    if ($Difficulty -eq "ppo_high") { return "ROBO_C$Suffix" }
    if ($Difficulty -eq "champion") { return "ROBO_D$Suffix" }
    return "ROBO_A$Suffix"
}

try {
    if ($StartWorker) {
        & (Join-Path $PSScriptRoot "start-duel-worker.ps1") `
            -WorkerId $WorkerId `
            -JavaHome $JavaHome `
            -GradleHome $GradleHome `
            -NodeHome $NodeHome `
            -AcceptEula `
            -Rebuild:$Rebuild
    } else {
        Wait-Port $pluginPort "PVPRobo plugin" 10
        Wait-Port $botPort "Bot controller" 10
    }

    $workerName = "worker_{0:D3}" -f $WorkerId
    $workerDir = Join-Path $repoRoot "runs\$workerName"
    $daemonOut = Join-Path $workerDir "logs\duel-daemon.out.log"
    $daemonErr = Join-Path $workerDir "logs\duel-daemon.err.log"
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $daemonOut) | Out-Null
    $daemonArgs = @(
        "-NoProfile",
        "-ExecutionPolicy", "Bypass",
        "-File", (Join-Path $PSScriptRoot "run-duel-daemon.ps1"),
        "-WorkerId", "$WorkerId",
        "-Manifest", $Manifest,
        "-MaxSessions", "1",
        "-WaitTimeoutSeconds", "$TimeoutSeconds"
    )
    $daemon = Start-Process -FilePath "powershell" -ArgumentList $daemonArgs -WorkingDirectory $repoRoot -RedirectStandardOutput $daemonOut -RedirectStandardError $daemonErr -WindowStyle Hidden -PassThru
    Start-Sleep -Seconds 2
    if ($daemon.HasExited) {
        $outText = if (Test-Path -LiteralPath $daemonOut) { Get-Content -LiteralPath $daemonOut -Raw } else { "" }
        $errText = if (Test-Path -LiteralPath $daemonErr) { Get-Content -LiteralPath $daemonErr -Raw } else { "" }
        throw "Duel daemon exited early with code $($daemon.ExitCode). stdout=$outText stderr=$errText"
    }

    $start = Invoke-Jsonl $pluginPort @{
        v = 1
        id = "public-ai-smoke"
        type = "start_ai_battle"
        left_difficulty = $LeftDifficulty
        right_difficulty = $RightDifficulty
        target_hits = $TargetHits
    }
    Write-Host ("start_ai_battle=" + ($start | ConvertTo-Json -Compress -Depth 12))

    $expectedLeft = Get-AiName $LeftDifficulty 0
    $expectedRight = Get-AiName $RightDifficulty 0
    if ($expectedRight -eq $expectedLeft) {
        $expectedRight = Get-AiName $RightDifficulty 1
    }
    $seenLeft = $false
    $seenRight = $false
    $cleared = $false
    $lastBotStatus = $null
    $lastPluginStatus = $null
    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    while ((Get-Date) -lt $deadline) {
        Start-Sleep -Seconds 1
        $lastBotStatus = Invoke-Jsonl $botPort @{ v = 1; id = "bot-status"; type = "status" }
        $lastPluginStatus = Invoke-Jsonl $pluginPort @{ v = 1; id = "plugin-status"; type = "status" }
        $names = @($lastBotStatus.bots | ForEach-Object { $_.agent_id })
        if ($names -contains $expectedLeft) { $seenLeft = $true }
        if ($names -contains $expectedRight) { $seenRight = $true }
        if ($seenLeft -and $seenRight -and -not ($names -contains $expectedLeft) -and -not ($names -contains $expectedRight)) {
            $cleared = $true
            break
        }
        if ($daemon.HasExited -and -not $cleared) {
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
    if (Test-Path -LiteralPath $daemonOut) {
        Write-Host "duel_daemon_tail="
        Get-Content -LiteralPath $daemonOut -Tail 80
    }
    if (Test-Path -LiteralPath $daemonErr) {
        $errTail = Get-Content -LiteralPath $daemonErr -Tail 80
        if ($errTail) {
            Write-Host "duel_daemon_error_tail="
            $errTail
        }
    }
    if (-not $seenLeft -or -not $seenRight -or -not $cleared) {
        throw "AI Battle live smoke failed. Expected both generated bots to connect and then despawn."
    }
} finally {
    if ($null -ne $daemon -and -not $daemon.HasExited) {
        Stop-Process -Id $daemon.Id -Force
    }
}
