param(
    [ValidateSet('Prepare','Start','Stop','Status','Redis','Doctor','Verify')][string]$Mode='Start',
    [Alias('Config')][string]$ConfigFile='configs/scheduler.local.json',
    [string]$RedisExe='',
    [string]$JavaHome='',
    [ValidateRange(1,8)][int]$MemoryGB=2,
    [ValidateRange(0,10)][int]$NormalRounds=1,
    [switch]$AcceptEula,
    [switch]$NoBrowser
)
$ErrorActionPreference='Stop'
$repoRoot=$PSScriptRoot
$env:PYTHONUTF8='1'
$configPath=if([IO.Path]::IsPathRooted($ConfigFile)){[IO.Path]::GetFullPath($ConfigFile)}else{Join-Path $repoRoot $ConfigFile}
$config=Get-Content -LiteralPath $configPath -Raw -Encoding UTF8 | ConvertFrom-Json
$env:SKYDUEL_SCHEDULER_CONFIG=$configPath
function Project-Path([string]$Value){
    $target=if([IO.Path]::IsPathRooted($Value)){[IO.Path]::GetFullPath($Value)}else{[IO.Path]::GetFullPath((Join-Path $repoRoot $Value))}
    if(-not $target.StartsWith($repoRoot.TrimEnd('\')+'\',[StringComparison]::OrdinalIgnoreCase)){throw "Local runtime path must be inside the project: $target"}
    return $target
}
$runPath=Project-Path $(if($config.scheduler_root){$config.scheduler_root}else{'runs/scheduler'})
$serverPath=Project-Path $config.server_root
$env:SKYDUEL_SERVER_ROOT=$serverPath
$redisPath=Join-Path $runPath 'redis'
$pythonExe=Join-Path $repoRoot '.venv/Scripts/python.exe'
$instanceTag="--scheduler-config=$configPath"
function Test-Port([int]$Port){$client=New-Object Net.Sockets.TcpClient;try{$task=$client.ConnectAsync('127.0.0.1',$Port);return $task.Wait(200) -and $client.Connected}catch{return $false}finally{$client.Dispose()}}
function Wait-Port([int]$Port,$Process,[string]$Log,[int]$Seconds=240){
    $deadline=(Get-Date).AddSeconds($Seconds);$nextMessage=Get-Date
    while(-not(Test-Port $Port)){
        if($Process){$Process.Refresh();if($Process.HasExited){throw "Service exited (code $($Process.ExitCode)) before port $Port was ready. Log: $Log"}}
        if((Get-Date) -gt $deadline){throw "Service did not become ready on port $Port. Log: $Log"}
        if((Get-Date) -ge $nextMessage){Write-Host "Waiting for localhost:$Port ... log: $Log";$nextMessage=(Get-Date).AddSeconds(10)}
        Start-Sleep -Milliseconds 400
    }
}
function Owned-Process([string]$File,[string]$Name,[string]$Marker){
    if(-not(Test-Path -LiteralPath $File)){return $null}
    $processNumber=0;if(-not [int]::TryParse((Get-Content -LiteralPath $File -Raw).Trim(),[ref]$processNumber)){return $null}
    $proc=Get-CimInstance Win32_Process -Filter "ProcessId=$processNumber"
    if($proc -and $proc.Name -eq $Name -and $proc.CommandLine -match [regex]::Escape($Marker)){return $proc};return $null
}
function Api([string]$Route,$Body=$null){
    $url="http://127.0.0.1:$($config.web_port)/api/$Route"
    if($null -eq $Body){return Invoke-RestMethod $url -TimeoutSec 10}
    return Invoke-RestMethod $url -Method Post -ContentType 'application/json' -Body ($Body | ConvertTo-Json -Compress) -TimeoutSec 10
}
function Assert-Coordinator{
    $status=Api 'status';$expected=if($config.namespace){$config.namespace}else{'skyduel-local'}
    if($status.namespace -ne $expected){throw 'Dashboard port belongs to another instance'}
    return $status
}
function Rcon([string[]]$Command){
    & $pythonExe (Join-Path $repoRoot 'scripts/bedwars-rcon.py') @Command
    if($LASTEXITCODE -ne 0){throw 'Minecraft administrative command failed; inspect the server log'}
}
function Resolve-Java{
    if($JavaHome){return $JavaHome}
    $runtime=Join-Path $repoRoot 'runs/local-runtime.json'
    if(Test-Path -LiteralPath $runtime){$record=Get-Content -LiteralPath $runtime -Raw -Encoding UTF8 | ConvertFrom-Json;if($record.java_home){return $record.java_home}}
    if($env:JAVA_HOME){return $env:JAVA_HOME}
    if(Test-Path -LiteralPath 'E:/Java/jdk-21/bin/java.exe'){return 'E:/Java/jdk-21'}
    $command=Get-Command java -ErrorAction SilentlyContinue
    if($command){return Split-Path (Split-Path $command.Source)}
    throw 'JDK 21 was not found. Pass -JavaHome.'
}
function Resolve-Redis{
    if($RedisExe){return $RedisExe}
    $command=Get-Command redis-server -ErrorAction SilentlyContinue
    if($command){return $command.Source}
    if(Test-Path -LiteralPath 'D:/Redis/redis-server.exe'){return 'D:/Redis/redis-server.exe'}
    return ''
}
function Accept-ExplicitEula{
    if($AcceptEula){
        if(-not(Test-Path -LiteralPath (Join-Path $serverPath 'paper.jar'))){throw 'Run -Mode Prepare first'}
        [IO.File]::WriteAllText((Join-Path $serverPath 'eula.txt'),"eula=true`r`n",[Text.Encoding]::ASCII)
        Write-Host 'Minecraft EULA accepted explicitly through -AcceptEula for this instance.'
    }
}
if($Mode -eq 'Status'){
    if(Test-Port $config.web_port){Assert-Coordinator | ConvertTo-Json -Depth 12}else{Write-Output 'Scheduler is not running'}
    exit 0
}
if($Mode -eq 'Stop'){
    $status=$null
    if(Test-Port $config.web_port){$status=Assert-Coordinator;Api 'pause' @{paused=$true} | Out-Null}
    $serverProcess=Owned-Process (Join-Path $serverPath 'server.pid') 'java.exe' (Join-Path $serverPath 'paper.jar')
    if(Test-Port $config.game_port){
        if(-not $serverProcess){throw 'Minecraft was not launched by this instance launcher; refusing to stop an unidentified process'}
        Rcon @('skyduel','abort')
    }
    if($status){
        $deadline=(Get-Date).AddSeconds($(if($config.reset_timeout_ms){[Math]::Ceiling($config.reset_timeout_ms/1000)}else{120}))
        do {$status=Assert-Coordinator;if(@($status.arenas | Where-Object {$_.task_id}).Count -eq 0){break}
            if((Get-Date) -gt $deadline){throw 'Arena has not finished saving/resetting. Services remain running for recovery; inspect the dashboard.'}
            Start-Sleep -Milliseconds 500
        }while($true)
        Api 'shutdown' @{} | Out-Null
        $deadline=(Get-Date).AddSeconds(20)
        while(Test-Port $config.web_port){if((Get-Date) -gt $deadline){throw 'Coordinator has not finished shutting down'};Start-Sleep -Milliseconds 300}
    }
    foreach($arena in $config.arenas){
        $file=Join-Path $runPath "$($arena.id)-viewer.pid";$viewer=Owned-Process $file 'node.exe' $instanceTag
        if($viewer){Stop-Process -Id $viewer.ProcessId}
        if(Test-Path -LiteralPath $file){Remove-Item -LiteralPath $file}
    }
    $stopRequested=$false
    $rconPort=if($config.rcon_port){$config.rcon_port}else{25578}
    if($serverProcess -and (Test-Port $rconPort)){Rcon @('stop');$stopRequested=$true}
    $deadline=(Get-Date).AddSeconds(45)
    while(Owned-Process (Join-Path $serverPath 'server.pid') 'java.exe' (Join-Path $serverPath 'paper.jar')){
        if(-not $stopRequested -and (Test-Port $rconPort)){Rcon @('stop');$stopRequested=$true}
        if((Get-Date) -gt $deadline){throw 'Minecraft is still starting or saving; its PID remains recorded and it was not force-killed'}
        Start-Sleep -Milliseconds 400
    }
    if(Test-Port $config.game_port){throw 'Game port remains occupied by an unidentified process'}
    foreach($file in @((Join-Path $runPath 'scheduler.pid'),(Join-Path $serverPath 'server.pid'))){if(Test-Path -LiteralPath $file){Remove-Item -LiteralPath $file}}
    Write-Output 'Instance stopped. Dedicated Redis retains the durable queue. Resume new admissions from the dashboard after restarting.'
    exit 0
}
if($Mode -ne 'Redis'){$JavaHome=Resolve-Java}
$RedisExe=Resolve-Redis
if($Mode -eq 'Prepare'){
    if((Test-Port $config.game_port) -or (Owned-Process (Join-Path $serverPath 'server.pid') 'java.exe' (Join-Path $serverPath 'paper.jar'))){throw 'Stop this Minecraft instance before preparing it'}
    $env:JAVA_HOME=$JavaHome;$env:GRADLE_USER_HOME=Join-Path $repoRoot 'downloads/gradle-cache'
    foreach($project in @('referee-plugin','bedwars-map-plugin')){
        & (Join-Path $repoRoot 'downloads/tools/gradle-8.7/bin/gradle.bat') -p (Join-Path $repoRoot $project) build --no-daemon --max-workers=2 '-Dorg.gradle.jvmargs=-Xmx512m -Dfile.encoding=COMPAT'
        if($LASTEXITCODE -ne 0){throw "Build failed: $project"}
    }
    & $pythonExe (Join-Path $repoRoot 'scripts/prepare-bedwars.py') --apply-rules --scheduler-config $configPath
    if($LASTEXITCODE -ne 0){throw 'Arena preparation failed'}
    foreach($project in @('local-scheduler','bot-controller','local-viewer')){
        & node -e 'try {for (const m of Object.keys(require(process.argv[1]).dependencies)) require.resolve(m,{paths:[process.argv[2]]})} catch {process.exitCode=1}' (Join-Path $repoRoot "$project/package.json") (Join-Path $repoRoot $project) 2>$null
        if($LASTEXITCODE -ne 0){
            Push-Location (Join-Path $repoRoot $project);try{& npm.cmd ci --no-fund;if($LASTEXITCODE -ne 0){throw "Dependencies failed: $project"}}finally{Pop-Location}
        }
    }
    & $pythonExe -c 'import PIL' 2>$null
    if($LASTEXITCODE -ne 0){& $pythonExe -m pip install Pillow==10.4.0;if($LASTEXITCODE -ne 0){throw 'Viewer resource dependency installation failed'}}
    $viewerRules=if($config.rules_file){$config.rules_file}else{'competition/rules.json'}
    & $pythonExe (Join-Path $repoRoot 'scripts/prepare-native-items.py') --rules-file (Join-Path $repoRoot $viewerRules)
    if($LASTEXITCODE -ne 0){throw 'Official viewer resource preparation failed'}
    Accept-ExplicitEula
    Write-Host 'Preparation complete. Use -Mode Doctor to check runtime readiness.'
    exit 0
}
if($Mode -in @('Start','Verify')){Accept-ExplicitEula}
if($Mode -ne 'Redis'){
    $doctorArgs=@("--config=$configPath","--java-home=$JavaHome","--redis-exe=$RedisExe","--memory-gb=$MemoryGB","--output=$(Join-Path $runPath 'doctor.json')")
    & node (Join-Path $repoRoot 'scripts/scheduler-doctor.cjs') @doctorArgs
    $doctorExit=$LASTEXITCODE
    if($Mode -eq 'Doctor'){exit $doctorExit}
    if($doctorExit -ne 0){throw "Preflight failed. No new services started. Report: $(Join-Path $runPath 'doctor.json')"}
}
New-Item -ItemType Directory -Force -Path $redisPath | Out-Null
$startedRedis=$null;$startedServer=$null;$startedScheduler=$null
try{
    if(-not(Test-Port $config.redis_port)){
        if(-not $RedisExe){throw 'Pass -RedisExe with a local Redis server executable'}
        $redisConfig=Join-Path $redisPath 'redis.conf'
        if(-not(Test-Path -LiteralPath $redisConfig)){
            $text="bind 127.0.0.1`nprotected-mode yes`nport $($config.redis_port)`ndir .`nappendonly yes`nappendfsync always`nmaxmemory 256mb`nmaxmemory-policy noeviction`nsave 900 1`n"
            [IO.File]::WriteAllText($redisConfig,$text,[Text.Encoding]::ASCII)
        }
        $startedRedis=Start-Process $RedisExe -ArgumentList @(('"'+$redisConfig+'"')) -WorkingDirectory $redisPath -WindowStyle Hidden -RedirectStandardOutput (Join-Path $runPath 'redis.out.log') -RedirectStandardError (Join-Path $runPath 'redis.err.log') -PassThru
        Set-Content -LiteralPath (Join-Path $runPath 'redis.pid') -Value $startedRedis.Id
    }
    Wait-Port $config.redis_port $startedRedis (Join-Path $runPath 'redis.err.log') 30
    if($Mode -eq 'Redis'){Write-Output "Dedicated local Redis ready on $($config.redis_port)";exit 0}
    if(-not(Test-Port $config.game_port)){
        $paper=Join-Path $serverPath 'paper.jar'
        $startedServer=Start-Process (Join-Path $JavaHome 'bin/java.exe') -ArgumentList @('-Xms512M',"-Xmx${MemoryGB}G",'-Dterminal.jline=false','-Dterminal.ansi=false','-jar',('"'+$paper+'"'),'--nogui') -WorkingDirectory $serverPath -WindowStyle Hidden -RedirectStandardOutput (Join-Path $serverPath 'console.out.log') -RedirectStandardError (Join-Path $serverPath 'console.err.log') -PassThru
        Set-Content -LiteralPath (Join-Path $serverPath 'server.pid') -Value $startedServer.Id
    }
    Wait-Port $config.control_port $startedServer (Join-Path $serverPath 'console.out.log')
    if(-not(Test-Port $config.web_port)){
        $script=Join-Path $repoRoot 'local-scheduler/server.cjs'
        $startedScheduler=Start-Process node -ArgumentList @(('"'+$script+'"'),('"'+$instanceTag+'"')) -WorkingDirectory $repoRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $runPath 'scheduler.out.log') -RedirectStandardError (Join-Path $runPath 'scheduler.err.log') -PassThru
        Set-Content -LiteralPath (Join-Path $runPath 'scheduler.pid') -Value $startedScheduler.Id
    }
    Wait-Port $config.web_port $startedScheduler (Join-Path $runPath 'scheduler.err.log') 45
    $readyDeadline=(Get-Date).AddSeconds(90)
    do {
        $status=Assert-Coordinator
        if(@($status.arenas | Where-Object {$_.state -eq 'quarantined'}).Count){throw 'An arena is quarantined. Inspect Minecraft and coordinator logs.'}
        if(-not @($status.arenas | Where-Object {$_.state -eq 'unavailable' -or -not $_.state}).Count){break}
        if((Get-Date) -gt $readyDeadline){throw 'Arenas did not become ready. Inspect Minecraft and coordinator logs.'}
        Start-Sleep -Milliseconds 500
    }while($true)
}catch{
    $failure=$_
    if($startedScheduler){$startedScheduler.Refresh();if(-not $startedScheduler.HasExited){Stop-Process -Id $startedScheduler.Id}}
    if($startedServer){$startedServer.Refresh();if(-not $startedServer.HasExited){
        try{Rcon @('stop');if(-not $startedServer.WaitForExit(15000)){Write-Warning 'Minecraft is still saving. It remains running; inspect its log.'}}catch{Write-Warning 'Minecraft did not accept graceful shutdown. It remains running; inspect its log and recorded PID.'}
    }}
    if($startedRedis -and -not $startedServer){
        $cli=Join-Path (Split-Path $RedisExe) 'redis-cli.exe'
        if(Test-Path -LiteralPath $cli){& $cli -h 127.0.0.1 -p $config.redis_port shutdown | Out-Null}
    }
    throw $failure
}
Write-Output "Local competition center: http://127.0.0.1:$($config.web_port)/"
if($status.paused){Write-Host 'New admissions are paused; resume them in the dashboard when ready.'}
if($Mode -eq 'Verify'){
    & node (Join-Path $repoRoot 'scripts/verify-squads-live.cjs') "--config=$configPath" "--normal-rounds=$NormalRounds"
    if($LASTEXITCODE -ne 0){throw 'Live verification failed. See runs/squads-validation.json; the instance remains available for diagnosis.'}
}
if(-not $NoBrowser){Start-Process "http://127.0.0.1:$($config.web_port)/"}
