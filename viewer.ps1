param([string]$Modules = 'D:\codex-local-cache\skyduel-viewer\node_modules')
$ErrorActionPreference = 'Stop'
if (-not (Test-Path -LiteralPath (Join-Path $Modules 'prismarine-viewer\package.json'))) {
    throw 'Viewer dependencies are missing; install local-viewer/package.json into the chosen cache directory.'
}
$env:BEDWARS_VIEWER_MODULES = $Modules
Push-Location $PSScriptRoot
try { & node local-viewer\server.cjs; if ($LASTEXITCODE -ne 0) { throw "Viewer failed: $LASTEXITCODE" } } finally { Pop-Location }
