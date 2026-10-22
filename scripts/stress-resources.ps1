param([string]$Repo,[string]$ServerRoot)
$ErrorActionPreference='Stop'
$javaId=[int](Get-Content -LiteralPath (Join-Path (Join-Path $Repo $ServerRoot) 'server.pid'))
$pattern=[regex]::Escape($Repo)
$rows=@(Get-CimInstance Win32_Process | Where-Object {($_.ProcessId -eq $javaId -and $_.Name -eq 'java.exe') -or ($_.CommandLine -match $pattern -and $_.Name -match 'node|redis')} | ForEach-Object {
 $role=if($_.Name -eq 'java.exe'){'minecraft'}elseif($_.Name -match 'redis'){'redis'}elseif($_.CommandLine -match 'showcase-v2'){'ai'}elseif($_.CommandLine -match 'local-scheduler'){'scheduler'}elseif($_.CommandLine -match 'local-viewer'){'viewer'}else{'diagnostic'}
 @{pid=[int]$_.ProcessId;role=$role;rss_mb=[double]$_.WorkingSetSize/1MB;private_mb=[double]$_.PrivatePageCount/1MB;cpu_seconds=([double]$_.UserModeTime+[double]$_.KernelModeTime)/10000000}
})
ConvertTo-Json -InputObject $rows -Compress
