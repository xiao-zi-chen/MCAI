param(
    [int]$WorkerId = 1,
    [string]$AgentId = "ROBO",
    [string]$Username = "ROBO",
    [string]$ArenaId = "arena_0",
    [int]$TimeoutSeconds = 120
)

$ErrorActionPreference = "Stop"

if ($WorkerId -eq 0) {
    throw "test-bot-spawn.ps1 is intentionally isolated from worker 0. Use worker 1 unless the user explicitly authorizes another nonzero worker."
}

$repoRoot = Split-Path -Parent $PSScriptRoot
$workerName = "worker_{0:D3}" -f $WorkerId
$workerDir = Join-Path $repoRoot "runs\$workerName"
$botConfigPath = Join-Path $workerDir "bot.json"

if (-not (Test-Path -LiteralPath $botConfigPath)) {
    throw "Missing bot config: $botConfigPath"
}

$botConfig = Get-Content -LiteralPath $botConfigPath -Raw | ConvertFrom-Json
$hostName = [string]$botConfig.host
$port = [int]$botConfig.bot_controller_port
$deadline = (Get-Date).AddSeconds($TimeoutSeconds)

function Send-JsonLine($Writer, $Payload) {
    $json = $Payload | ConvertTo-Json -Depth 8 -Compress
    $Writer.WriteLine($json)
}

function Read-JsonLine($Reader, $Deadline) {
    while ((Get-Date) -lt $Deadline) {
        try {
            $line = $Reader.ReadLine()
            if (-not [string]::IsNullOrWhiteSpace($line)) {
                return ($line | ConvertFrom-Json)
            }
        } catch [IO.IOException] {
            Start-Sleep -Milliseconds 100
        }
    }
    throw "Timed out waiting for bot-controller response."
}

$client = [Net.Sockets.TcpClient]::new()
$client.ReceiveTimeout = 1000
$client.SendTimeout = 5000
$async = $client.BeginConnect($hostName, $port, $null, $null)
if (-not $async.AsyncWaitHandle.WaitOne([Math]::Max(1000, $TimeoutSeconds * 1000))) {
    $client.Close()
    throw "Timed out connecting to bot-controller at $hostName`:$port"
}
$client.EndConnect($async)

try {
    $stream = $client.GetStream()
    $writer = [IO.StreamWriter]::new($stream, [Text.UTF8Encoding]::new($false))
    $writer.NewLine = "`n"
    $writer.AutoFlush = $true
    $reader = [IO.StreamReader]::new($stream, [Text.Encoding]::UTF8)

    Send-JsonLine $writer @{
        v = 1
        id = "smoke-spawn"
        type = "spawn"
        bots = @(
            @{
                agent_id = $AgentId
                username = $Username
                arena_id = $ArenaId
                role = "learner"
            }
        )
    }
    $spawn = Read-JsonLine $reader $deadline
    if ($spawn.type -ne "spawn_ack" -or -not $spawn.ok) {
        throw "Spawn failed: $($spawn | ConvertTo-Json -Depth 8 -Compress)"
    }

    $status = $null
    $connected = $false
    while ((Get-Date) -lt $deadline -and -not $connected) {
        Send-JsonLine $writer @{
            v = 1
            id = "smoke-status"
            type = "status"
        }
        $status = Read-JsonLine $reader $deadline
        $bots = @($status.bots)
        $found = $false
        foreach ($bot in $bots) {
            if ([string]$bot.agent_id -eq $AgentId) {
                $found = $true
                $connected = [bool]$bot.connected
            }
        }
        if (-not $connected) {
            Start-Sleep -Milliseconds 500
        }
    }
    if (-not $connected) {
        throw "Spawn acknowledged but $AgentId did not reach connected=true: $($status | ConvertTo-Json -Depth 8 -Compress)"
    }

    Write-Host "spawn_ack=$($spawn | ConvertTo-Json -Depth 8 -Compress)"
    Write-Host "status=$($status | ConvertTo-Json -Depth 8 -Compress)"
    Write-Host "$AgentId is connected through bot-controller."
} finally {
    $client.Close()
}
