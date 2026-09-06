param([string]$AcceptanceRoot = "F:\思潼AI增长os\test-environments\beauty-industry-acceptance-20260821")
$ErrorActionPreference = "Stop"

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..\..")).Path

# Reuse shared identity/decision functions from start.ps1.
. (Join-Path $PSScriptRoot "start.ps1") -OfflineSelfTest -AcceptanceRoot $AcceptanceRoot

function Get-ProcessIdentity([int]$ProcessId) {
  if ($ProcessId -le 0) { return $null }
  $proc = Get-CimInstance Win32_Process -Filter "ProcessId=$ProcessId" -ErrorAction SilentlyContinue
  if ($null -eq $proc) { return $null }
  return [pscustomobject]@{ executablePath = $proc.ExecutablePath; commandLine = $proc.CommandLine }
}

$commandMarker = 'src/server.ts'
$runtimeDir = Join-Path $AcceptanceRoot 'runtime'

# ---- API state ----
$apiPidFile = Join-Path $runtimeDir 'api.pid'
$apiPidFileValue = 0
if (Test-Path -LiteralPath $apiPidFile) {
  $raw = (Get-Content -LiteralPath $apiPidFile -Raw -ErrorAction SilentlyContinue).Trim()
  [int]::TryParse($raw, [ref]$apiPidFileValue) | Out-Null
}
$apiRecord = Read-RuntimeRecord -RuntimeDir $runtimeDir -Name 'api.runtime.json'
$apiListener = Get-PortListener -Port 3016
$apiPidFileProc = $null
if ($apiPidFileValue -gt 0) { $apiPidFileProc = Get-ProcessIdentity $apiPidFileValue }

# ---- Web state ----
$webPidFile = Join-Path $runtimeDir 'web.pid'
$webPidFileValue = 0
if (Test-Path -LiteralPath $webPidFile) {
  $raw = (Get-Content -LiteralPath $webPidFile -Raw -ErrorAction SilentlyContinue).Trim()
  [int]::TryParse($raw, [ref]$webPidFileValue) | Out-Null
}
$webListener = Get-PortListener -Port 5176
$webPidFileProc = $null
if ($webPidFileValue -gt 0) { $webPidFileProc = Get-ProcessIdentity $webPidFileValue }

# Controlled stop of API + Web (throws FailClosed before touching any process).
$null = Invoke-StopAll -AcceptanceRoot $AcceptanceRoot -RepoRoot $repoRoot -CommandMarker $commandMarker `
  -ApiListener $apiListener -ApiPidFileProc $apiPidFileProc -ApiPidFileValue $apiPidFileValue -ApiRecord $apiRecord `
  -WebListener $webListener -WebPidFileProc $webPidFileProc -WebPidFileValue $webPidFileValue

& "C:\Program Files\PostgreSQL\17\bin\pg_ctl.exe" stop -D (Join-Path $AcceptanceRoot "pgdata") -m fast
