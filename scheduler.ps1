param(
    [ValidateSet('Prepare','Start','Stop','Status','Redis')][string]$Mode='Start',
    [string]$RedisExe='',
    [string]$JavaHome='',
    [ValidateRange(1,8)][int]$MemoryGB=2,
    [switch]$NoBrowser
)
$ErrorActionPreference='Stop'
$repoRoot=$PSScriptRoot
$env:PYTHONUTF8='1'
$config=Get-Content -LiteralPath (Join-Path $repoRoot 'configs/scheduler.local.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$runPath=Join-Path $repoRoot 'runs/scheduler'
$serverPath=Join-Path $repoRoot $config.server_root
$env:SKYDUEL_SERVER_ROOT=$config.server_root
$redisPath=Join-Path $runPath 'redis'
$pythonExe=Join-Path $repoRoot '.venv/Scripts/python.exe'
function Test-Port([int]$Port){$client=New-Object Net.Sockets.TcpClient;try{$task=$client.ConnectAsync('127.0.0.1',$Port);return $task.Wait(200) -and $client.Connected}catch{return $false}finally{$client.Dispose()}}
function Wait-Port([int]$Port){$deadline=(Get-Date).AddSeconds(45);while(-not(Test-Port $Port)){if((Get-Date) -gt $deadline){throw "Service did not start on port $Port"};Start-Sleep -Milliseconds 500}}
function Scheduler-Process{
    $file=Join-Path $runPath 'scheduler.pid';if(-not(Test-Path -LiteralPath $file)){return $null}
    $schedulerProcessId=[int](Get-Content -LiteralPath $file);$proc=Get-CimInstance Win32_Process -Filter "ProcessId=$schedulerProcessId"
    if($proc -and $proc.Name -eq 'node.exe' -and $proc.CommandLine -match [regex]::Escape((Join-Path $repoRoot 'local-scheduler/server.cjs'))){return $proc};return $null
}
if($Mode -eq 'Status'){if(Test-Port $config.web_port){Invoke-RestMethod "http://127.0.0.1:$($config.web_port)/api/status" | ConvertTo-Json -Depth 12}else{Write-Output 'Scheduler is not running'};exit}
if($Mode -eq 'Prepare'){
    if(-not $JavaHome){$runtime=Join-Path $repoRoot 'runs/local-runtime.json';if(Test-Path -LiteralPath $runtime){$JavaHome=(Get-Content $runtime -Raw | ConvertFrom-Json).java_home}elseif($env:JAVA_HOME){$JavaHome=$env:JAVA_HOME}else{$JavaHome=Split-Path (Split-Path (Get-Command java -ErrorAction Stop).Source)}}
    $env:JAVA_HOME=$JavaHome;$env:GRADLE_USER_HOME=Join-Path $repoRoot 'downloads/gradle-cache'
    foreach($project in @('referee-plugin','bedwars-map-plugin')){
        & (Join-Path $repoRoot 'downloads/tools/gradle-8.7/bin/gradle.bat') -p (Join-Path $repoRoot $project) build --no-daemon --max-workers=2 '-Dorg.gradle.jvmargs=-Xmx512m -Dfile.encoding=COMPAT'
        if($LASTEXITCODE -ne 0){throw "Build failed: $project"}
    }
    & $pythonExe (Join-Path $repoRoot 'scripts/prepare-bedwars.py') --apply-rules --scheduler-config (Join-Path $repoRoot 'configs/scheduler.local.json')
    if($LASTEXITCODE -ne 0){throw 'Arena preparation failed'}
    Push-Location (Join-Path $repoRoot 'local-scheduler');try{& npm ci --no-fund;if($LASTEXITCODE -ne 0){throw 'Scheduler install failed'}}finally{Pop-Location}
    exit
}
if($Mode -eq 'Stop'){
    if(Test-Port $config.web_port){Invoke-RestMethod "http://127.0.0.1:$($config.web_port)/api/pause" -Method Post -ContentType 'application/json' -Body '{"paused":true}' | Out-Null}
    & $pythonExe (Join-Path $repoRoot 'scripts/bedwars-rcon.py') skyduel abort
    $deadline=(Get-Date).AddSeconds(40)
    while((Test-Port $config.web_port) -and (Get-Date) -lt $deadline){$state=Invoke-RestMethod "http://127.0.0.1:$($config.web_port)/api/status";if(@($state.matches | Where-Object {$_.state -ne 'settled'}).Count -eq 0){break};Start-Sleep -Milliseconds 1000}
    $proc=Scheduler-Process;if($proc){Stop-Process -Id $proc.ProcessId}
    $viewerPattern=[regex]::Escape($repoRoot)+'[\\/]local-viewer[\\/]server.cjs'
    Get-CimInstance Win32_Process | Where-Object {$_.Name -eq 'node.exe' -and $_.CommandLine -match $viewerPattern} | ForEach-Object {Stop-Process -Id $_.ProcessId}
    & $pythonExe (Join-Path $repoRoot 'scripts/bedwars-rcon.py') stop
    $deadline=(Get-Date).AddSeconds(30);while(Test-Port $config.game_port){if((Get-Date) -gt $deadline){throw 'Minecraft is still saving'};Start-Sleep -Milliseconds 500}
    Write-Output 'Scheduler stopped. Redis keeps queue state; restart and resume admissions from the dashboard.';exit
}
New-Item -ItemType Directory -Force -Path $redisPath | Out-Null
if(-not(Test-Port $config.redis_port)){
    if(-not $RedisExe){$command=Get-Command redis-server -ErrorAction SilentlyContinue;if($command){$RedisExe=$command.Source}elseif(Test-Path -LiteralPath 'D:/Redis/redis-server.exe'){$RedisExe='D:/Redis/redis-server.exe'}else{throw 'Pass -RedisExe with the path to a local Redis server executable'}}
    $redisConfig=Join-Path $redisPath 'redis.conf'
    if(-not(Test-Path -LiteralPath $redisConfig)){
        $text="bind 127.0.0.1`nprotected-mode yes`nport $($config.redis_port)`ndir .`nappendonly yes`nappendfsync always`nmaxmemory 256mb`nmaxmemory-policy noeviction`nsave 900 1`n"
        [IO.File]::WriteAllText($redisConfig,$text,[Text.Encoding]::ASCII)
    }
    $proc=Start-Process $RedisExe -ArgumentList @(('"'+$redisConfig+'"')) -WorkingDirectory $redisPath -WindowStyle Hidden -RedirectStandardOutput (Join-Path $runPath 'redis.out.log') -RedirectStandardError (Join-Path $runPath 'redis.err.log') -PassThru
    Set-Content -LiteralPath (Join-Path $runPath 'redis.pid') -Value $proc.Id
}
Wait-Port $config.redis_port
if($Mode -eq 'Redis'){Write-Output "Dedicated local Redis ready on $($config.redis_port)";exit}
if(-not(Test-Port $config.game_port)){
    if(-not $JavaHome){$runtime=Join-Path $repoRoot 'runs/local-runtime.json';if(Test-Path -LiteralPath $runtime){$JavaHome=(Get-Content $runtime -Raw | ConvertFrom-Json).java_home}elseif($env:JAVA_HOME){$JavaHome=$env:JAVA_HOME}else{$JavaHome=Split-Path (Split-Path (Get-Command java -ErrorAction Stop).Source)}}
    $eula=Join-Path $serverPath 'eula.txt'
    if(-not(Test-Path -LiteralPath $eula) -or (Get-Content -LiteralPath $eula -Raw) -notmatch '(?m)^\s*eula\s*=\s*true\s*$'){throw 'Minecraft EULA must already be accepted through the setup flow'}
    $proc=Start-Process (Join-Path $JavaHome 'bin/java.exe') -ArgumentList @('-Xms512M',"-Xmx${MemoryGB}G",'-Dterminal.jline=false','-Dterminal.ansi=false','-jar','paper.jar','--nogui') -WorkingDirectory $serverPath -WindowStyle Hidden -RedirectStandardOutput (Join-Path $serverPath 'console.out.log') -RedirectStandardError (Join-Path $serverPath 'console.err.log') -PassThru
    Set-Content -LiteralPath (Join-Path $serverPath 'server.pid') -Value $proc.Id
}
Wait-Port $config.control_port
if(-not(Scheduler-Process)){
    $script=Join-Path $repoRoot 'local-scheduler/server.cjs'
    $proc=Start-Process node -ArgumentList @(('"'+$script+'"')) -WorkingDirectory $repoRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $runPath 'scheduler.out.log') -RedirectStandardError (Join-Path $runPath 'scheduler.err.log') -PassThru
    Set-Content -LiteralPath (Join-Path $runPath 'scheduler.pid') -Value $proc.Id
}
Wait-Port $config.web_port
Write-Output "Local competition center: http://127.0.0.1:$($config.web_port)/"
if(-not $NoBrowser){Start-Process "http://127.0.0.1:$($config.web_port)/"}
