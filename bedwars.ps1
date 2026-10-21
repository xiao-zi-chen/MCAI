param(
    [ValidateSet("Prepare", "Start", "Bot")][string]$Mode = "Prepare",
    [string]$JavaHome = "",
    [ValidateRange(1, 8)][int]$MemoryGB = 2,
    [switch]$AcceptEula
)
$ErrorActionPreference = "Stop"
$repoRoot = $PSScriptRoot
if(-not $JavaHome){$JavaHome=if(Test-Path (Join-Path $repoRoot 'runs\local-runtime.json')){(Get-Content (Join-Path $repoRoot 'runs\local-runtime.json') -Raw | ConvertFrom-Json).java_home}elseif($env:JAVA_HOME){$env:JAVA_HOME}elseif(Test-Path -LiteralPath 'E:\Java\jdk-21'){'E:\Java\jdk-21'}else{Split-Path (Split-Path (Get-Command java -ErrorAction Stop).Source)}}
$env:PYTHONUTF8 = "1"
$pythonExe = Join-Path $repoRoot ".venv\Scripts\python.exe"
$serverDir = Join-Path $repoRoot "runs\bedwars-local"
Push-Location $repoRoot
try {
    if ($Mode -eq "Prepare") {
        $env:JAVA_HOME = $JavaHome
        $env:GRADLE_USER_HOME = Join-Path $repoRoot "downloads\gradle-cache"
        & .\downloads\tools\gradle-8.7\bin\gradle.bat -p bedwars-map-plugin build --no-daemon --max-workers=2 '-Dorg.gradle.jvmargs=-Dfile.encoding=COMPAT'
        if ($LASTEXITCODE -ne 0) { throw "Map plugin build failed" }
        & .\downloads\tools\gradle-8.7\bin\gradle.bat -p referee-plugin build --no-daemon --max-workers=2 '-Dorg.gradle.jvmargs=-Dfile.encoding=COMPAT'
        if ($LASTEXITCODE -ne 0) { throw "Referee plugin build failed" }
        & $pythonExe scripts\prepare-bedwars.py
        if ($LASTEXITCODE -ne 0) { throw "Preparation failed" }
    } elseif ($Mode -eq "Bot") {
        & node scripts\bedwars-guard.cjs
        if ($LASTEXITCODE -ne 0) { throw "Practice bot exited with an error" }
    } else {
        $eulaFile = Join-Path $serverDir "eula.txt"
        if ($AcceptEula) { [IO.File]::WriteAllText($eulaFile, "eula=true`n", [Text.Encoding]::ASCII) }
        $accepted = (Test-Path -LiteralPath $eulaFile) -and ((Get-Content -LiteralPath $eulaFile -Raw) -match '(?m)^\s*eula\s*=\s*true\s*$')
        if (-not $accepted) { throw "Read https://www.minecraft.net/eula; if you agree, rerun with -AcceptEula." }
        Push-Location $serverDir
        try {
            & (Join-Path $JavaHome "bin\java.exe") '-Xms512M' "-Xmx${MemoryGB}G" '-jar' 'paper.jar' '--nogui'
            if ($LASTEXITCODE -ne 0) { throw "Minecraft server exited with code $LASTEXITCODE" }
        } finally { Pop-Location }
    }
} finally { Pop-Location }
