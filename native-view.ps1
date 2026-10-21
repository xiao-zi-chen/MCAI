param(
    [ValidateSet('Start','Stop')][string]$Mode='Start',
    [ValidateSet('EmberAI','BastionAI')][string]$Target='EmberAI',
    [string]$JavaHome='',
    [switch]$NoDemo
)
$ErrorActionPreference='Stop'
$repoRoot=$PSScriptRoot
if(-not $JavaHome){$JavaHome=if(Test-Path (Join-Path $repoRoot 'runs\local-runtime.json')){(Get-Content (Join-Path $repoRoot 'runs\local-runtime.json') -Raw | ConvertFrom-Json).java_home}elseif($env:JAVA_HOME){$env:JAVA_HOME}elseif(Test-Path -LiteralPath 'E:\Java\jdk-21'){'E:\Java\jdk-21'}else{Split-Path (Split-Path (Get-Command java -ErrorAction Stop).Source)}}
$pythonExe=Join-Path $repoRoot '.venv\Scripts\python.exe'
$nativeRun=Join-Path $repoRoot 'runs\native-spectator'
$pidFile=Join-Path $nativeRun 'processes.json'
function Get-OwnedProcess([int]$ProcessId,[string]$Marker){
    $proc=Get-CimInstance Win32_Process -Filter "ProcessId=$ProcessId"
    if($proc -and $proc.CommandLine -match [regex]::Escape($Marker)){return $proc}
    return $null
}
if(Test-Path -LiteralPath $pidFile){
    $state=Get-Content -LiteralPath $pidFile -Raw | ConvertFrom-Json
    $client=Get-OwnedProcess $state.client_pid $nativeRun
    $helper=Get-OwnedProcess $state.helper_pid 'native-spectator.py'
    $previousTarget=if($state.target){$state.target}else{'EmberAI'}
    if($Mode -eq 'Start' -and $client -and $helper -and $previousTarget -eq $Target){
        $online=$null
        try{$online=& $pythonExe (Join-Path $repoRoot 'scripts/bedwars-rcon.py') list 2>$null}catch{$online=$null}
        if($LASTEXITCODE -eq 0 -and $online -match '\bVanillaView\b'){Write-Output 'Native Minecraft spectator is already running.';exit}
    }
    if($helper){Stop-Process -Id $helper.ProcessId}
    if($client){
        $nativeProcess=Get-Process -Id $client.ProcessId
        [void]$nativeProcess.CloseMainWindow()
        try{Wait-Process -Id $client.ProcessId -Timeout 8 -ErrorAction Stop}catch{if(Get-OwnedProcess $client.ProcessId $nativeRun){Stop-Process -Id $client.ProcessId}}
    }
}
if($Mode -eq 'Stop'){Write-Output 'Native spectator stopped.';exit}
& (Join-Path $repoRoot 'playtest.ps1') -NoBrowser -JavaHome $JavaHome -NoDemo:$NoDemo
if(-not (Test-Path -LiteralPath (Join-Path $repoRoot 'downloads\official-client-1.21\launch.json'))){
    & $pythonExe (Join-Path $repoRoot 'scripts\prepare-native-client.py')
    if($LASTEXITCODE -ne 0){throw 'Official Minecraft resources could not be prepared'}
}
& $pythonExe (Join-Path $repoRoot 'scripts\native-spectator.py') --java (Join-Path $JavaHome 'bin\javaw.exe') --target $Target
if($LASTEXITCODE -ne 0){throw 'Native spectator launch failed'}
