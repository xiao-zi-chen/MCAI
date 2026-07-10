param(
    [string]$PythonVersion = "3.12",
    [string]$VenvPath = "",
    [string]$UvCacheDir = "",
    [string]$IndexUrl = "",
    [switch]$NoInstall
)

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
if ($VenvPath -eq "") {
    $VenvPath = Join-Path $repoRoot ".venv"
}
if ($UvCacheDir -eq "") {
    $UvCacheDir = Join-Path $repoRoot "runs\uv-cache"
}

$uv = Get-Command uv -ErrorAction SilentlyContinue
if ($null -eq $uv) {
    throw "Missing uv. Install uv first, then rerun this script."
}

New-Item -ItemType Directory -Force -Path $UvCacheDir | Out-Null
$env:UV_CACHE_DIR = $UvCacheDir

& uv venv $VenvPath --python $PythonVersion
if ($LASTEXITCODE -ne 0) {
    throw "uv venv failed with exit code $LASTEXITCODE."
}

$pythonExe = Join-Path $VenvPath "Scripts\python.exe"
if (-not (Test-Path -LiteralPath $pythonExe)) {
    throw "Expected venv Python was not created: $pythonExe"
}

if (-not $NoInstall) {
    $packageSpec = (Join-Path $repoRoot "python") + "[sb3]"
    $installArgs = @("pip", "install", "--python", $pythonExe, "-e", $packageSpec)
    if ($IndexUrl -ne "") {
        $installArgs += @("--index-url", $IndexUrl)
    }
    & uv @installArgs
    if ($LASTEXITCODE -ne 0) {
        throw "uv pip install failed with exit code $LASTEXITCODE."
    }
}

Write-Host "PVPRobo Python environment ready: $pythonExe"
