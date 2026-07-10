param(
    [string]$ConfigPath = "configs\default-bot.json",
    [string]$NodeHome = ""
)

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot
$botDir = Join-Path $repoRoot "bot-controller"
$config = Join-Path $repoRoot $ConfigPath

Push-Location $botDir
try {
    if ($NodeHome -ne "") {
        $env:Path = $NodeHome + [IO.Path]::PathSeparator + $env:Path
    }
    npm.cmd run build
    if ($LASTEXITCODE -ne 0) {
        throw "Bot controller TypeScript build failed with exit code $LASTEXITCODE."
    }
    $nodeExe = if ($NodeHome -ne "") { Join-Path $NodeHome "node.exe" } else { "node" }
    & $nodeExe .\dist\index.js --config $config
} finally {
    Pop-Location
}
