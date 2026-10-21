param(
    [ValidateSet('Start','Stop','Status')][string]$Mode = 'Start',
    [string]$JavaHome = '',
    [ValidateRange(1,8)][int]$MemoryGB = 2,
    [string]$ViewerModules = '',
    [string]$RuntimeRoot = '',
    [string]$ModelDir = 'models\showcase',
    [switch]$NoDemo,
    [switch]$NoViewer,
    [switch]$NoBrowser
)
$ErrorActionPreference = 'Stop'
$repoRoot = $PSScriptRoot
if(-not $JavaHome){$JavaHome=if(Test-Path (Join-Path $repoRoot 'runs\local-runtime.json')){(Get-Content (Join-Path $repoRoot 'runs\local-runtime.json') -Raw | ConvertFrom-Json).java_home}elseif($env:JAVA_HOME){$env:JAVA_HOME}elseif(Test-Path -LiteralPath 'E:\Java\jdk-21'){'E:\Java\jdk-21'}else{Split-Path (Split-Path (Get-Command java -ErrorAction Stop).Source)}}
$runPath = Join-Path $repoRoot 'runs\bedwars-local'
if(-not $ViewerModules){$ViewerModules=Join-Path $repoRoot 'local-viewer\node_modules';if(-not(Test-Path $ViewerModules) -and (Test-Path 'D:\codex-local-cache\skyduel-viewer\node_modules')){$ViewerModules='D:\codex-local-cache\skyduel-viewer\node_modules'}}
if(-not $RuntimeRoot){$RuntimeRoot=Join-Path $repoRoot 'bot-controller';if(-not(Test-Path (Join-Path $RuntimeRoot 'node_modules\mineflayer-pathfinder')) -and (Test-Path 'D:\codex-local-cache\skyduel-runtime')){$RuntimeRoot='D:\codex-local-cache\skyduel-runtime'}}
$pythonExe = Join-Path $repoRoot '.venv\Scripts\python.exe'
$rconScript = Join-Path $repoRoot 'scripts\bedwars-rcon.py'
function Test-Port([int]$Port) {
    $client = New-Object Net.Sockets.TcpClient
    try { $task=$client.ConnectAsync('127.0.0.1',$Port); return $task.Wait(200) -and $client.Connected } catch { return $false } finally { $client.Dispose() }
}
function Wait-Port([int]$Port) {
    $deadline=(Get-Date).AddSeconds(45)
    while (-not (Test-Port $Port)) { if((Get-Date) -gt $deadline){throw "Local service did not open port $Port; inspect logs in $runPath"}; Start-Sleep -Milliseconds 500 }
}
function Node-Process([string]$Name,[string]$Script) {
    $pidFile=Join-Path $runPath ($Name+'.pid')
    if (-not (Test-Path -LiteralPath $pidFile)) { return $null }
    $localProcessId=[int](Get-Content -LiteralPath $pidFile)
    $proc=Get-CimInstance Win32_Process -Filter "ProcessId=$localProcessId"
    if($proc -and $proc.Name -eq 'node.exe' -and $proc.CommandLine -match [regex]::Escape($Script)){return $proc}
    return $null
}
function Start-Node([string]$Name,[string]$Script,[string]$Check) {
    if(Node-Process $Name $Check){return}
    $proc=Start-Process node -ArgumentList @(('"'+(Join-Path $repoRoot $Script)+'"')) -WorkingDirectory $repoRoot -RedirectStandardOutput (Join-Path $runPath ($Name+'.out.log')) -RedirectStandardError (Join-Path $runPath ($Name+'.err.log')) -WindowStyle Hidden -PassThru
    Set-Content -LiteralPath (Join-Path $runPath ($Name+'.pid')) -Value $proc.Id
}
if($Mode -eq 'Status'){
    [pscustomobject]@{Minecraft=Test-Port 25567;Referee=Test-Port 25600;Viewer=Test-Port 3007;Demo=[bool](Node-Process 'showcase' 'showcase-v2.cjs');Watch='http://127.0.0.1:3007/'}
    exit
}
if($Mode -eq 'Stop'){
    if(Test-Port 25578){ & $pythonExe $rconScript skyduel abort | Out-Null }
    foreach($spec in @(@('showcase','showcase-v2.cjs'),@('viewer','server.cjs'))){$proc=Node-Process $spec[0] $spec[1];if($proc){Stop-Process -Id $proc.ProcessId}}
    if(Test-Port 25578){ & $pythonExe $rconScript stop; if($LASTEXITCODE -ne 0){throw 'Could not stop Minecraft gracefully'} }
    $deadline=(Get-Date).AddSeconds(30)
    while(Test-Port 25567){if((Get-Date) -gt $deadline){throw 'Minecraft is still saving; check its log before restarting'};Start-Sleep -Milliseconds 500}
    Write-Output 'Local playtest stopped; worlds and replays saved.'
    exit
}
$eula=Join-Path $runPath 'eula.txt'
if(-not (Test-Path -LiteralPath $eula) -or (Get-Content -LiteralPath $eula -Raw) -notmatch '(?m)^\s*eula\s*=\s*true\s*$'){throw 'Accept the Minecraft EULA through bedwars.ps1 -Mode Start -AcceptEula first.'}
if(-not $NoViewer -and -not (Test-Path -LiteralPath (Join-Path $ViewerModules 'prismarine-viewer\package.json'))){throw "Viewer modules missing: $ViewerModules"}
if(-not $NoDemo){
    if(-not (Test-Path -LiteralPath (Join-Path $RuntimeRoot 'node_modules\mineflayer-pathfinder\package.json'))){throw "Pathfinder missing: $RuntimeRoot"}
    foreach($name in @('EmberAI','BastionAI')){if(-not (Test-Path -LiteralPath (Join-Path $repoRoot "$ModelDir\$name.json"))){throw "Trained actor missing: $ModelDir\$name.json"}}
}
if(-not (Test-Port 25567)){
    $serverProc=Start-Process (Join-Path $JavaHome 'bin\java.exe') -ArgumentList @('-Xms512M',"-Xmx${MemoryGB}G",'-Dterminal.jline=false','-Dterminal.ansi=false','-jar','paper.jar','--nogui') -WorkingDirectory $runPath -RedirectStandardOutput (Join-Path $runPath 'console.out.log') -RedirectStandardError (Join-Path $runPath 'console.err.log') -WindowStyle Hidden -PassThru
    Set-Content -LiteralPath (Join-Path $runPath 'server.pid') -Value $serverProc.Id
}
Wait-Port 25600
& $pythonExe $rconScript skyduel lock | Out-Null
if(-not $NoViewer -and -not (Test-Path -LiteralPath (Join-Path $repoRoot 'runs/native-assets-1.21/items.json'))){ & $pythonExe (Join-Path $repoRoot 'scripts/prepare-native-items.py'); if($LASTEXITCODE -ne 0){throw 'Official item resources could not be prepared'} }
$env:BEDWARS_VIEWER_MODULES=$ViewerModules
$env:SKYDUEL_RUNTIME_ROOT=$RuntimeRoot
$env:SKYDUEL_MODEL_DIR=$ModelDir
if(-not $NoViewer){Start-Node 'viewer' 'local-viewer\server.cjs' 'server.cjs';Wait-Port 3007}
if(-not $NoDemo){Start-Node 'showcase' 'scripts\showcase-v2.cjs' 'showcase-v2.cjs'}
if($NoViewer){Write-Output 'Minecraft and referee streams ready.'}else{Write-Output 'Live: http://127.0.0.1:3007/  Replays: http://127.0.0.1:3007/replays'}
if(-not $NoBrowser -and -not $NoViewer){Start-Process 'http://127.0.0.1:3007/'}
