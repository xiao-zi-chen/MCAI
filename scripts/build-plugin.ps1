param(
    [string]$JavaHome = "",
    [string]$GradleHome = "",
    [switch]$SkipTests
)

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot
$pluginDir = Join-Path $repoRoot "server-plugin"

if ($JavaHome -ne "") {
    $env:JAVA_HOME = $JavaHome
    $env:Path = (Join-Path $JavaHome "bin") + [IO.Path]::PathSeparator + $env:Path
}

if ($GradleHome -ne "") {
    $env:Path = (Join-Path $GradleHome "bin") + [IO.Path]::PathSeparator + $env:Path
}

$java = Get-Command java -ErrorAction SilentlyContinue
if ($null -eq $java) {
    throw "Java 21 is required to build the Paper plugin. Install Java 21 or pass -JavaHome."
}

$gradlew = Join-Path $pluginDir "gradlew.bat"
if (Test-Path -LiteralPath $gradlew) {
    $gradleCmd = $gradlew
    $gradleArgs = @()
} else {
    $gradle = Get-Command gradle -ErrorAction SilentlyContinue
    if ($null -eq $gradle) {
        throw "Gradle or server-plugin\gradlew.bat is required to build the Paper plugin. Install Gradle or pass -GradleHome."
    }
    $gradleCmd = $gradle.Source
    $gradleArgs = @()
}

Push-Location $pluginDir
try {
    if ($SkipTests) {
        & $gradleCmd @gradleArgs build -x test
    } else {
        & $gradleCmd @gradleArgs build
    }
    if ($LASTEXITCODE -ne 0) {
        throw "Gradle build failed with exit code $LASTEXITCODE."
    }
} finally {
    Pop-Location
}
