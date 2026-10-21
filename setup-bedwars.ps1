param([string]$JavaHome='', [string]$Python='python', [switch]$NativeClient)
$ErrorActionPreference='Stop'
$repoRoot=$PSScriptRoot
if(-not $JavaHome){$JavaHome=if($env:JAVA_HOME){$env:JAVA_HOME}else{Split-Path (Split-Path (Get-Command java -ErrorAction Stop).Source)}}
if(-not(Test-Path (Join-Path $JavaHome 'bin\javac.exe'))){throw 'JDK 21 is required; pass -JavaHome with its directory.'}
New-Item -ItemType Directory -Path (Join-Path $repoRoot 'runs') -Force | Out-Null
[IO.File]::WriteAllText((Join-Path $repoRoot 'runs\local-runtime.json'),(@{java_home=$JavaHome}|ConvertTo-Json),[Text.UTF8Encoding]::new($false))
$env:JAVA_HOME=$JavaHome
$env:PYTHONUTF8='1'
Push-Location $repoRoot
function Check-Step { if($LASTEXITCODE -ne 0){throw "Setup step failed with exit code $LASTEXITCODE"} }
try {
    if(-not(Test-Path '.venv\Scripts\python.exe')){& $Python -m venv .venv;Check-Step}
    $py=Join-Path $repoRoot '.venv\Scripts\python.exe'
    & $py -m pip install -r scripts/requirements-bedwars.txt;Check-Step
    Push-Location bot-controller;try{& npm.cmd ci;Check-Step}finally{Pop-Location}
    Push-Location local-viewer;try{& npm.cmd ci;Check-Step}finally{Pop-Location}
    & $py scripts/fetch-bedwars-deps.py;Check-Step
    & .\bedwars.ps1 -Mode Prepare -JavaHome $JavaHome;Check-Step
    & $py scripts/prepare-bedwars.py --apply-rules;Check-Step
    & $py scripts/prepare-native-items.py;Check-Step
    if($NativeClient){& $py scripts/prepare-native-client.py;Check-Step}
    Write-Output 'Prepared. Read LOCAL_TRIAL.zh-CN.md for EULA acceptance and launch commands.'
} finally { Pop-Location }
