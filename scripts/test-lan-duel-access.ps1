param(
    [int]$WorkerId = 1,
    [string]$ExpectedIp = "",
    [switch]$RequireRunning
)

$ErrorActionPreference = "Stop"

if ($WorkerId -eq 0) {
    throw "test-lan-duel-access.ps1 is intentionally isolated from worker 0. Use -WorkerId 1 unless the user explicitly authorizes another nonzero worker."
}

$repoRoot = Split-Path -Parent $PSScriptRoot
$workerName = "worker_{0:D3}" -f $WorkerId
$serverPropertiesPath = Join-Path $repoRoot "runs\$workerName\server.properties"
$port = 25565 + $WorkerId
$serverIp = ""

if (Test-Path -LiteralPath $serverPropertiesPath) {
    $props = @{}
    Get-Content -LiteralPath $serverPropertiesPath | ForEach-Object {
        if ($_ -match "^\s*([^#][^=]*)=(.*)$") {
            $props[$Matches[1].Trim()] = $Matches[2].Trim()
        }
    }
    if ($props.ContainsKey("server-port")) {
        $port = [int]$props["server-port"]
    }
    if ($props.ContainsKey("server-ip")) {
        $serverIp = [string]$props["server-ip"]
    }
}

function Get-ListeningRows($Port) {
    netstat -ano | Where-Object { $_ -match "^\s*TCP\s+(\S+):$Port\s+\S+\s+LISTENING\s+(\d+)\s*$" } | ForEach-Object {
        $_ -match "^\s*TCP\s+(\S+):$Port\s+\S+\s+LISTENING\s+(\d+)\s*$" | Out-Null
        [pscustomobject]@{
            address = $Matches[1]
            port = $Port
            pid = [int]$Matches[2]
        }
    }
}

function Get-IPv4Candidates() {
    $lines = ipconfig | Select-String -Pattern "IPv4"
    foreach ($line in $lines) {
        $text = [string]$line
        if ($text -match "(\d+\.\d+\.\d+\.\d+)") {
            $ip = $Matches[1]
            if ($ip -notlike "127.*" -and $ip -notlike "169.254.*") {
                $ip
            }
        }
    }
}

$listenRows = @(Get-ListeningRows $port)
$lanCandidates = @(Get-IPv4Candidates | Sort-Object -Unique)
$lanReady = $false
if ($listenRows.Count -gt 0) {
    foreach ($row in $listenRows) {
        if ($row.address -eq "0.0.0.0" -or $row.address -eq "::" -or ($row.address -notlike "127.*")) {
            $lanReady = $true
        }
    }
}
$configAllowsLan = [string]::IsNullOrWhiteSpace($serverIp) -or $serverIp -eq "0.0.0.0"

Write-Host "PVPRobo worker $WorkerId LAN access check"
Write-Host "server.properties: $serverPropertiesPath"
Write-Host "server-port=$port"
Write-Host "server-ip=$serverIp"
Write-Host ("configured_for_lan=" + $configAllowsLan)
Write-Host ("listening=" + ($listenRows.Count -gt 0))
foreach ($row in $listenRows) {
    Write-Host ("listener={0}:{1} pid={2}" -f $row.address, $row.port, $row.pid)
}
if ($lanCandidates.Count -gt 0) {
    Write-Host "candidate_lan_addresses:"
    foreach ($ip in $lanCandidates) {
        Write-Host ("  {0}:{1}" -f $ip, $port)
    }
} else {
    Write-Host "candidate_lan_addresses: none detected by ipconfig"
}
if ($ExpectedIp -ne "") {
    Write-Host "expected_address=$ExpectedIp`:$port"
}

if (-not $configAllowsLan) {
    Write-Host "LAN access is not configured. Start a nonzero local duel worker with:"
    Write-Host "powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\start-duel-worker.ps1 -WorkerId $WorkerId -AcceptEula -ExposeLan"
}
if ($RequireRunning -and -not $lanReady) {
    throw "Worker $WorkerId is not currently listening for LAN clients on port $port."
}
if ($configAllowsLan -and $lanReady) {
    Write-Host "LAN access appears ready."
} elseif ($configAllowsLan) {
    Write-Host "LAN config is ready, but the worker is not currently listening."
}
