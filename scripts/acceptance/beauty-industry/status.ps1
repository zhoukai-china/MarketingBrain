param([string]$AcceptanceRoot = "F:\思潼AI增长os\test-environments\beauty-industry-acceptance-20260821")
$ErrorActionPreference = "Continue"

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..\..")).Path

# Reuse shared functions from start.ps1 (-OfflineSelfTest loads functions only).
. (Join-Path $PSScriptRoot "start.ps1") -OfflineSelfTest -AcceptanceRoot $AcceptanceRoot

$envFile = Join-Path $AcceptanceRoot ".env.acceptance"
if (Test-Path -LiteralPath $envFile) {
  Get-Content -LiteralPath $envFile -Encoding utf8 | ForEach-Object {
    if ($_ -match "^([^#][^=]*)=(.*)$") { [Environment]::SetEnvironmentVariable($matches[1].Trim(), $matches[2].Trim(), "Process") }
  }
}
& "C:\Program Files\PostgreSQL\17\bin\pg_isready.exe" -h 127.0.0.1 -p 55434

$apiReady = $false
try {
  $ready = Invoke-RestMethod -Uri "http://127.0.0.1:3016/ready" -TimeoutSec 3
  $apiReady = [bool]$ready.ok
  "api_ready=" + [bool]$ready.ok + ";database=" + [bool]$ready.checks.database.ok + ";provider_configured=" + [bool]$ready.checks.llm.configured
} catch {
  $apiReady = $false
  "api_ready=false"
}
try { "web_status=" + (Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:5176/" -TimeoutSec 3).StatusCode } catch { "web_status=offline" }

# ---- source freshness ----
$commandMarker = 'src/server.ts'
$fp = Get-SourceFingerprint -RepoRoot $repoRoot
$fpShort = Get-FingerprintShort -Fingerprint $fp

$record = Read-RuntimeRecord -RuntimeDir (Join-Path $AcceptanceRoot "runtime") -Name "api.runtime.json"
$recordShort = "none"
if ($null -ne $record) { $recordShort = Get-FingerprintShort -Fingerprint ([string]$record.sourceFingerprint) }

$listener = Get-PortListener -Port 3016
$listenerPid = 0
if ($null -ne $listener) { $listenerPid = [int]$listener.pid }

$pidFile = Join-Path $AcceptanceRoot "runtime\api.pid"
$pidFileValue = 0
if (Test-Path -LiteralPath $pidFile) {
  $raw = (Get-Content -LiteralPath $pidFile -Raw -ErrorAction SilentlyContinue).Trim()
  [int]::TryParse($raw, [ref]$pidFileValue) | Out-Null
}

$fresh = Resolve-SourceFreshness -SourceFingerprint $fp -Record $record -Listener $listener -PidFileValue $pidFileValue -ApiReady $apiReady -RepoRoot $repoRoot -CommandMarker $commandMarker

"source_fingerprint_short=" + $fpShort
"runtime_fingerprint_short=" + $recordShort
"source_fresh=" + $fresh.fresh.ToString().ToLowerInvariant()
"source_fresh_reason=" + $fresh.reason
"pid_matches_listener=" + (($pidFileValue -gt 0) -and ($pidFileValue -eq $listenerPid)).ToString().ToLowerInvariant()
$textProviderMode = if ($apiReady -and $null -ne $record -and -not [string]::IsNullOrWhiteSpace([string]$record.textProviderMode)) { [string]$record.textProviderMode } else { "offline" }
$runtimeProfile = if ($apiReady -and $null -ne $record -and -not [string]::IsNullOrWhiteSpace([string]$record.runtimeProfile)) { [string]$record.runtimeProfile } else { "offline" }
$mediaMode = if ($apiReady -and $null -ne $record -and -not [string]::IsNullOrWhiteSpace([string]$record.mediaExecutionMode)) { [string]$record.mediaExecutionMode } else { "offline" }
$mediaProductEnabled = if ($apiReady -and $null -ne $record) { ([bool]$record.mediaProductEnabled).ToString().ToLowerInvariant() } else { "offline" }
$maxRealImages = if ($apiReady -and $null -ne $record) { [int]$record.maxRealImages } else { "offline" }
"acceptance_mode=local_only;runtime_profile=" + $runtimeProfile + ";text_provider=" + $textProviderMode + ";beauty_media_mode=" + $mediaMode + ";beauty_media_product_enabled=" + $mediaProductEnabled + ";max_real_images=" + $maxRealImages
