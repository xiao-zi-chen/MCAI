param(
    [int]$WorkerId = -1,
    [switch]$NoElevate
)

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot
$runsDir = Join-Path $repoRoot "runs"
$script:AccessDeniedFailures = New-Object System.Collections.Generic.List[string]

function Test-IsAdministrator {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = [Security.Principal.WindowsPrincipal]::new($identity)
    return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Invoke-ElevatedRerun {
    if ($NoElevate -or (Test-IsAdministrator) -or ($script:AccessDeniedFailures.Count -eq 0)) {
        return
    }

    Write-Warning "Some worker processes could not be stopped because this PowerShell session is not elevated."
    Write-Warning "Requesting an elevated PowerShell to rerun stop-workers.ps1 for WorkerId=$WorkerId."
    $argsList = @(
        "-NoProfile",
        "-ExecutionPolicy", "Bypass",
        "-File", $PSCommandPath,
        "-WorkerId", $WorkerId,
        "-NoElevate"
    )
    try {
        $proc = Start-Process -FilePath "powershell.exe" -ArgumentList $argsList -Verb RunAs -Wait -PassThru
        if ($proc.ExitCode -ne 0) {
            Write-Warning "Elevated stop-workers.ps1 exited with code $($proc.ExitCode)."
        }
    } catch {
        Write-Warning "Could not start elevated PowerShell: $($_.Exception.Message)"
    }
}

function Get-WorkerPorts($Id, $WorkerPath) {
    $ports = New-Object System.Collections.Generic.HashSet[int]
    [void]$ports.Add(25565 + $Id)
    [void]$ports.Add(25580 + ($Id * 10))
    [void]$ports.Add(25581 + ($Id * 10))

    # Optional local proxy experiments may add extra frontend ports. Include
    # both common adjacent ports and any explicit bind port written by configs.
    [void]$ports.Add(25575 + $Id)
    [void]$ports.Add(25576 + $Id)
    $velocityConfigs = @(
        (Join-Path $WorkerPath "proxy\proxy.toml"),
        (Join-Path $WorkerPath "proxy-bot\proxy.toml")
    )
    foreach ($velocityConfig in $velocityConfigs) {
        if (Test-Path -LiteralPath $velocityConfig) {
            Get-Content -LiteralPath $velocityConfig -ErrorAction SilentlyContinue | ForEach-Object {
                if ($_ -match '^\s*bind\s*=\s*".*:(\d+)"\s*$') {
                    [void]$ports.Add([int]$Matches[1])
                }
            }
        }
    }

    return @($ports)
}

function Get-ProcessInfoById($ProcessId) {
    if ($ProcessId -notmatch '^\d+$') {
        return $null
    }
    return Get-CimInstance Win32_Process -Filter "ProcessId = $ProcessId" -ErrorAction SilentlyContinue
}

function Get-ListenerProcessIds($Ports) {
    $ids = New-Object System.Collections.Generic.HashSet[int]
    foreach ($port in $Ports) {
        $connections = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
        foreach ($connection in $connections) {
            [void]$ids.Add([int]$connection.OwningProcess)
        }

        $pattern = "^\s*TCP\s+\S+:$port\s+\S+\s+LISTENING\s+(\d+)\s*$"
        netstat -ano | ForEach-Object {
            if ($_ -match $pattern) {
                [void]$ids.Add([int]$Matches[1])
            }
        }
    }
    return @($ids)
}

function Test-CommandLineBelongsToWorker($ProcessInfo, $WorkerPath) {
    if ($null -eq $ProcessInfo -or [string]::IsNullOrWhiteSpace($ProcessInfo.CommandLine)) {
        return $false
    }
    $workerFull = [IO.Path]::GetFullPath($WorkerPath)
    $commandLine = $ProcessInfo.CommandLine

    $workerConfigMarkers = @(
        (Join-Path $workerFull "bot.json"),
        (Join-Path $workerFull "env.json"),
        (Join-Path $workerFull "training"),
        (Join-Path $workerFull "demos")
    )
    foreach ($marker in $workerConfigMarkers) {
        if ($commandLine.Contains($marker) -or $commandLine.Contains(($marker -replace '\\', '/'))) {
            return $true
        }
    }

    # start-worker/start-ppo-training wrapper processes identify the worker by parameter.
    $workerNumber = Worker-IdFromPath $workerFull
    if (($null -ne $workerNumber) -and ($commandLine -match 'start-(worker|ppo-training)\.ps1') -and ($commandLine -match "(^|\s)-WorkerId\s+$workerNumber($|\s)")) {
        return $true
    }
    return $false
}

function Get-DescendantProcessIds($SeedIds) {
    $allProcesses = @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue)
    $childrenByParent = @{}
    foreach ($process in $allProcesses) {
        $parent = [int]$process.ParentProcessId
        if (-not $childrenByParent.ContainsKey($parent)) {
            $childrenByParent[$parent] = New-Object System.Collections.Generic.List[int]
        }
        $childrenByParent[$parent].Add([int]$process.ProcessId)
    }

    $result = New-Object System.Collections.Generic.HashSet[int]
    $queue = New-Object System.Collections.Generic.Queue[int]
    foreach ($id in $SeedIds) {
        if ($id -match '^\d+$' -and $result.Add([int]$id)) {
            $queue.Enqueue([int]$id)
        }
    }
    while ($queue.Count -gt 0) {
        $parent = $queue.Dequeue()
        if ($childrenByParent.ContainsKey($parent)) {
            foreach ($child in $childrenByParent[$parent]) {
                if ($result.Add([int]$child)) {
                    $queue.Enqueue([int]$child)
                }
            }
        }
    }
    return @($result)
}

function Stop-ProcessIds($ProcessIds, $Label) {
    $orderedIds = @($ProcessIds | Sort-Object -Unique -Descending)
    foreach ($numericId in $orderedIds) {
        $proc = Get-Process -Id $numericId -ErrorAction SilentlyContinue
        if ($null -eq $proc) {
            continue
        }
        Write-Host "Stopping $Label pid=$numericId name=$($proc.ProcessName)"
        try {
            Stop-Process -Id $numericId -Force -ErrorAction Stop
        } catch {
            $stopError = $_.Exception.Message
            try {
                $taskkillOutput = & taskkill.exe /PID $numericId /T /F 2>&1
                if ($LASTEXITCODE -ne 0) {
                    $taskkillText = $taskkillOutput -join ' '
                    Write-Warning "taskkill failed for pid=$numericId ($taskkillText)"
                    $script:AccessDeniedFailures.Add("pid=$numericId name=$($proc.ProcessName)") | Out-Null
                }
            } catch {
                Write-Warning "Failed to stop pid=${numericId}: $($_.Exception.Message)"
                $script:AccessDeniedFailures.Add("pid=$numericId name=$($proc.ProcessName)") | Out-Null
            }
        }
    }
}

function Get-WorkerSeedProcessIds($WorkerPath) {
    $ids = New-Object System.Collections.Generic.HashSet[int]
    $id = Worker-IdFromPath $WorkerPath
    $ports = @()
    if ($null -ne $id) {
        $ports = Get-WorkerPorts $id $WorkerPath
        foreach ($listenerId in (Get-ListenerProcessIds $ports)) {
            [void]$ids.Add([int]$listenerId)
        }
    }

    $pidDir = Join-Path $WorkerPath "pids"
    if (Test-Path -LiteralPath $pidDir) {
        Get-ChildItem -LiteralPath $pidDir -Filter "*.pid" -ErrorAction SilentlyContinue | ForEach-Object {
            $pidText = Get-Content -LiteralPath $_.FullName -ErrorAction SilentlyContinue | Select-Object -First 1
            $processInfo = Get-ProcessInfoById $pidText
            if ($null -eq $processInfo) {
                Remove-Item -LiteralPath $_.FullName -Force -ErrorAction SilentlyContinue
                return
            }
            if ((Test-CommandLineBelongsToWorker $processInfo $WorkerPath) -or ($ids.Contains([int]$processInfo.ProcessId))) {
                [void]$ids.Add([int]$processInfo.ProcessId)
                Remove-Item -LiteralPath $_.FullName -Force -ErrorAction SilentlyContinue
            } else {
                Write-Warning "Ignoring stale pid file $($_.FullName): pid=$pidText does not match $WorkerPath."
            }
        }
    }

    $allProcesses = @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue)
    foreach ($processInfo in $allProcesses) {
        if (Test-CommandLineBelongsToWorker $processInfo $WorkerPath) {
            [void]$ids.Add([int]$processInfo.ProcessId)
        }
    }
    return @($ids)
}

function Worker-IdFromPath($WorkerPath) {
    $name = Split-Path -Leaf $WorkerPath
    if ($name -match '^worker_(\d+)$') {
        return [int]$Matches[1]
    }
    return $null
}

if ($WorkerId -ge 0) {
    $workers = @(Join-Path $runsDir ("worker_{0:D3}" -f $WorkerId))
} else {
    $workers = Get-ChildItem -LiteralPath $runsDir -Directory -Filter "worker_*" -ErrorAction SilentlyContinue | ForEach-Object { $_.FullName }
}

foreach ($worker in $workers) {
    if (-not (Test-Path -LiteralPath $worker)) {
        Write-Warning "Worker directory does not exist: $worker"
        continue
    }
    $seedIds = @(Get-WorkerSeedProcessIds $worker)
    if ($seedIds.Count -eq 0) {
        Write-Host "No live processes found for $worker"
        continue
    }
    $processIds = @(Get-DescendantProcessIds $seedIds)
    Stop-ProcessIds $processIds (Split-Path -Leaf $worker)
}

Invoke-ElevatedRerun
