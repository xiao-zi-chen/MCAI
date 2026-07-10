function Get-PVPRoboPython {
    param(
        [Parameter(Mandatory = $true)]
        [string]$RepoRoot
    )

    $pythonExe = Join-Path $RepoRoot ".venv\Scripts\python.exe"
    if (-not (Test-Path -LiteralPath $pythonExe)) {
        throw "Missing project Python environment: $pythonExe. Run scripts\setup-python-env.ps1 first."
    }
    $env:PYTHONPATH = Join-Path $RepoRoot "python\src"
    return $pythonExe
}

function Assert-NoSystemPython {
    param(
        [bool]$UseSystemPython
    )

    if ($UseSystemPython) {
        throw "-UseSystemPython is disabled. Run scripts\setup-python-env.ps1 and use the project .venv."
    }
}
