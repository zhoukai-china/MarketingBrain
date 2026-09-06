param([Parameter(Mandatory=$true)][string]$AcceptanceRoot)
$ErrorActionPreference='Stop'
$taskStopRoot=$AcceptanceRoot
. (Join-Path $PSScriptRoot 'start.ps1') -OfflineSelfTest
$repo=(Resolve-Path (Join-Path $PSScriptRoot '../../..')).Path
$base=Join-Path (Split-Path $repo -Parent) 'test-environments'
$root=(Resolve-Path -LiteralPath $taskStopRoot).Path
if ((Split-Path $root -Leaf) -notmatch '^by(?:4[56]|5[014])-offline-[a-f0-9]{32}$' -or (Normalize-PathKey (Split-Path $root -Parent)) -ne (Normalize-PathKey $base)) {throw 'Scope rejected'}
$recordPath=Join-Path $root 'runtime.json'
$record=Get-Content -LiteralPath $recordPath -Raw | ConvertFrom-Json
$data=Join-Path $root 'pgdata'
$prefix=if($record.task){$record.task.ToLower()}else{'by45'}
if ((Normalize-PathKey $record.repo) -ne (Normalize-PathKey $repo) -or (Normalize-PathKey $record.root) -ne (Normalize-PathKey $root) -or (Normalize-PathKey $record.data) -ne (Normalize-PathKey $data) -or (Split-Path $root -Leaf) -ne "$prefix-offline-$($record.session)") {throw 'Runtime provenance mismatch'}
$lines=Get-Content -LiteralPath (Join-Path $data 'postmaster.pid')
$pgProcessId=[int]$lines[0]
$process=Get-CimInstance Win32_Process -Filter "ProcessId=$pgProcessId"
$pgBin='C:\Program Files\PostgreSQL\17\bin'
$listeners=@(Get-NetTCPConnection -LocalPort $record.port -State Listen -ErrorAction Stop)
if ((Normalize-PathKey $lines[1]) -ne (Normalize-PathKey $data) -or -not $process -or (Normalize-PathKey $process.ExecutablePath) -ne (Normalize-PathKey (Join-Path $pgBin 'postgres.exe')) -or -not (Normalize-PathKey $process.CommandLine).Contains((Normalize-PathKey $data)) -or $listeners.Count -eq 0 -or @($listeners | Where-Object OwningProcess -ne $pgProcessId).Count -gt 0 -or ($record.pid -and $record.pid -ne $pgProcessId)) {throw 'Stop identity mismatch'}
& (Join-Path $pgBin 'pg_ctl.exe') -D $data -m fast -w -t 30 stop
if ($LASTEXITCODE -ne 0 -or (Get-NetTCPConnection -LocalPort $record.port -State Listen -ErrorAction SilentlyContinue)) {throw 'Stop unverified'}
$record | Add-Member -NotePropertyName pid -NotePropertyValue $pgProcessId -Force
$record.state='stopped'
$record | Add-Member -NotePropertyName stoppedAt -NotePropertyValue ([DateTime]::UtcNow.ToString('o')) -Force
$record | ConvertTo-Json | Set-Content -LiteralPath $recordPath -Encoding UTF8
Write-Output 'BY45_OWNED_STOP_PASS'
