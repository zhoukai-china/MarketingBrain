param(
  [string]$AcceptanceRoot = "F:\思潼AI增长os\test-environments\beauty-industry-acceptance-20260821",
  [switch]$EnableApprovedText,
  [switch]$EnableApprovedDailyBrief,
  [switch]$EnableApprovedMedia,
  [switch]$OfflineSelfTest
)

# =====================================================================
# Shared functions (side-effect free; reused by start/status/stop and
# the offline regression script). $OfflineSelfTest lets status.ps1 /
# stop.ps1 / the regression script dot-source this file to load the
# functions without running the main flow.
# =====================================================================

function Normalize-PathKey {
  param([string]$Path)
  if ([string]::IsNullOrWhiteSpace($Path)) { return '' }
  return $Path.Trim().TrimEnd('\', '/').Replace('/', '\').ToLowerInvariant()
}

function Get-SourceFingerprint {
  param([string]$RepoRoot)
  if (-not (Test-Path -LiteralPath $RepoRoot)) { throw "Repo root not found: $RepoRoot" }
  $RepoRoot = (Resolve-Path -LiteralPath $RepoRoot).Path.TrimEnd('\', '/')

  $dirs = @(
    "apps/api/src",
    "apps/web/src",
    "packages/agent/src",
    "packages/shared/src",
    "packages/skills/src",
    "packages/skills/skills",
    "mcp-skills/skills"
  )

  $entries = New-Object System.Collections.Generic.List[System.IO.FileInfo]
  foreach ($d in $dirs) {
    $full = Join-Path $RepoRoot $d
    if (Test-Path -LiteralPath $full) {
      Get-ChildItem -LiteralPath $full -Recurse -File -ErrorAction SilentlyContinue |
        Where-Object {
          $_.FullName -notmatch '[\\/](node_modules|dist|\.git)[\\/]' -and
          $_.Extension -ne '.map'
        } |
        ForEach-Object { $entries.Add($_) }
    }
  }

  # File list MUST be sorted (normalized to "/" separators) for repeatability.
  $relSorted = $entries | ForEach-Object {
    $_.FullName.Substring($RepoRoot.Length + 1).Replace('\', '/')
  } | Sort-Object

  $sha = [System.Security.Cryptography.SHA256]::Create()
  $sb = New-Object System.Text.StringBuilder
  foreach ($rel in $relSorted) {
    $abs = Join-Path $RepoRoot ($rel.Replace('/', '\'))
    $bytes = [System.IO.File]::ReadAllBytes($abs)
    $h = [System.BitConverter]::ToString($sha.ComputeHash($bytes)).Replace('-', '')
    [void]$sb.AppendLine($rel + '|' + $h)
  }
  $final = [System.BitConverter]::ToString(
    $sha.ComputeHash([System.Text.Encoding]::UTF8.GetBytes($sb.ToString()))
  ).Replace('-', '')
  return $final.ToUpperInvariant()
}

function Get-FingerprintShort {
  param([string]$Fingerprint)
  if ([string]::IsNullOrWhiteSpace($Fingerprint)) { return 'none' }
  return $Fingerprint.Substring(0, [Math]::Min(8, $Fingerprint.Length))
}

# Pure (no I/O) identity check: executable is node.exe, command line contains
# the exact TSX CLI path under the CURRENT repoRoot (Windows-normalized,
# case-insensitive) AND the command marker. Binding to repoRoot prevents a
# same-"src/server.ts" process from another repo being treated as controlled.
function Test-ApiCommandIdentity {
  param(
    [string]$ExecutablePath,
    [string]$CommandLine,
    [string]$RepoRoot,
    [string]$CommandMarker = 'src/server.ts'
  )
  if ([string]::IsNullOrWhiteSpace($ExecutablePath)) { return $false }
  if ($ExecutablePath -notlike '*node.exe') { return $false }
  if ([string]::IsNullOrWhiteSpace($CommandLine)) { return $false }
  $expectedTsx = Normalize-PathKey (Join-Path $RepoRoot 'apps\api\node_modules\tsx\dist\cli.mjs')
  $expectedPreflight = Normalize-PathKey (Join-Path $RepoRoot 'apps\api\node_modules\tsx\dist\preflight.cjs')
  if ($expectedTsx -eq '' -or $expectedPreflight -eq '') { return $false }
  $normCmd = Normalize-PathKey $CommandLine
  $usesCli = $normCmd -like ('*' + $expectedTsx + '*')
  $usesSingleProcessBootstrap = $normCmd -like ('*' + $expectedPreflight + '*') -and $CommandLine -match '(?i)--import\s+["'']?tsx["'']?(?:\s|$)'
  if (-not $usesCli -and -not $usesSingleProcessBootstrap) { return $false }
  if ($CommandLine -notlike ('*' + $CommandMarker + '*')) { return $false }
  return $true
}

# I/O version: resolve the process by PID then delegate to the pure check.
function Test-ApiProcessIdentity {
  param([int]$ProcessId, [string]$RepoRoot, [string]$CommandMarker = 'src/server.ts')
  if ($ProcessId -le 0) { return $false }
  $proc = Get-CimInstance Win32_Process -Filter "ProcessId=$ProcessId" -ErrorAction SilentlyContinue
  if ($null -eq $proc) { return $false }
  return Test-ApiCommandIdentity -ExecutablePath $proc.ExecutablePath -CommandLine $proc.CommandLine -RepoRoot $RepoRoot -CommandMarker $CommandMarker
}

# Recognize the one legacy acceptance shape created by the old TSX CLI start:
# the pid file points to the repo-bound CLI parent while the port belongs to
# its repo-bound preload child. This exists only to migrate that old process.
function Test-LegacyApiPairIdentity {
  param(
    [object]$Parent,
    [object]$Child,
    [string]$RepoRoot,
    [string]$ExpectedPreflightPath,
    [string]$CommandMarker = 'src/server.ts'
  )
  if ($null -eq $Parent -or $null -eq $Child) { return $false }
  if ([int]$Parent.pid -le 0 -or [int]$Child.pid -le 0 -or [int]$Child.parentPid -ne [int]$Parent.pid) { return $false }
  if (-not (Test-ApiCommandIdentity -ExecutablePath $Parent.executablePath -CommandLine $Parent.commandLine -RepoRoot $RepoRoot -CommandMarker $CommandMarker)) { return $false }
  if ([string]$Child.executablePath -notlike '*node.exe' -or [string]::IsNullOrWhiteSpace([string]$Child.commandLine)) { return $false }
  $normChild = Normalize-PathKey ([string]$Child.commandLine)
  $normPreflight = Normalize-PathKey $ExpectedPreflightPath
  if ($normPreflight -eq '' -or $normChild -notlike ('*' + $normPreflight + '*')) { return $false }
  if ([string]$Child.commandLine -notlike ('*' + $CommandMarker + '*')) { return $false }
  return $true
}

function Stop-LegacyApiPairIfControlled {
  param(
    [int]$ParentPid,
    [int]$ChildPid,
    [string]$RepoRoot,
    [string]$ExpectedPreflightPath,
    [string]$CommandMarker = 'src/server.ts'
  )
  $resolve = {
    param([int]$ProcessId)
    $p = Get-CimInstance Win32_Process -Filter "ProcessId=$ProcessId" -ErrorAction SilentlyContinue
    if ($null -eq $p) { return $null }
    return [pscustomobject]@{
      pid = [int]$p.ProcessId
      parentPid = [int]$p.ParentProcessId
      executablePath = [string]$p.ExecutablePath
      commandLine = [string]$p.CommandLine
    }
  }
  $assertPair = {
    $parent = & $resolve -ProcessId $ParentPid
    $child = & $resolve -ProcessId $ChildPid
    if (-not (Test-LegacyApiPairIdentity -Parent $parent -Child $child -RepoRoot $RepoRoot -ExpectedPreflightPath $ExpectedPreflightPath -CommandMarker $CommandMarker)) {
      throw 'FAIL-CLOSED: legacy acceptance process identity changed before stop.'
    }
  }
  & $assertPair
  & $assertPair
  Stop-Process -Id $ChildPid -ErrorAction Stop
  $parentNow = & $resolve -ProcessId $ParentPid
  if ($null -ne $parentNow) {
    if (-not (Test-ApiCommandIdentity -ExecutablePath $parentNow.executablePath -CommandLine $parentNow.commandLine -RepoRoot $RepoRoot -CommandMarker $CommandMarker)) {
      throw 'FAIL-CLOSED: legacy parent identity changed before stop.'
    }
    Stop-Process -Id $ParentPid -ErrorAction Stop
  }
}

function Get-PortListener {
  param([int]$Port)
  $c = Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($null -eq $c) { return $null }
  $proc = Get-CimInstance Win32_Process -Filter "ProcessId=$($c.OwningProcess)" -ErrorAction SilentlyContinue
  return [pscustomobject]@{
    pid            = [int]$c.OwningProcess
    parentPid      = if ($null -ne $proc) { [int]$proc.ParentProcessId } else { 0 }
    executablePath = if ($null -ne $proc) { $proc.ExecutablePath } else { $null }
    commandLine    = if ($null -ne $proc) { $proc.CommandLine } else { $null }
  }
}

function Read-RuntimeRecord {
  param([string]$RuntimeDir, [string]$Name)
  $path = Join-Path $RuntimeDir $Name
  if (-not (Test-Path -LiteralPath $path)) { return $null }
  try {
    return Get-Content -LiteralPath $path -Raw -Encoding utf8 | ConvertFrom-Json
  } catch { return $null }
}

function Write-RuntimeRecord {
  param([string]$RuntimeDir, [string]$Name, [hashtable]$Record)
  $path = Join-Path $RuntimeDir $Name
  $dir = Split-Path -Parent $path
  if (-not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
  $json = $Record | ConvertTo-Json -Compress
  Set-Content -LiteralPath $path -Value $json -Encoding utf8
}

function Resolve-AcceptanceRuntimeProfile {
  param([string]$AcceptanceRoot)
  $profileMarker = Join-Path $AcceptanceRoot '.xhs-user-acceptance-profile'
  if (-not (Test-Path -LiteralPath $profileMarker)) { return 'safe_default' }
  $profileValue = (Get-Content -LiteralPath $profileMarker -Raw -Encoding utf8).Trim()
  if ($profileValue -ne 'xhs_user_acceptance_v1') {
    throw 'Unknown persisted beauty acceptance profile. Refusing to infer Provider capability.'
  }
  return $profileValue
}

# Pure decision. Inputs already include the resolved listener identity and any
# runtime record. Enforces full identity + pid file + record (repoRoot /
# commandMarker / pid / fingerprint) before Reuse/Restart, else FailClosed.
function Resolve-ApiStartDecision {
  param(
    [string]$SourceFingerprint,
    [object]$Listener,
    [object]$Record,
    [int]$PidFileValue,
    [string]$RepoRoot,
    [string]$CommandMarker = 'src/server.ts',
    [string]$DesiredTextProviderMode = '',
    [string]$DesiredRuntimeProfile = ''
  )
  $listenerPid = 0
  if ($null -ne $Listener) { $listenerPid = [int]$Listener.pid }
  if ($listenerPid -le 0) {
    return [pscustomobject]@{ action = 'StartNew'; reason = 'no listener on port'; stopPid = $null }
  }
  if (-not (Test-ApiCommandIdentity -ExecutablePath $Listener.executablePath -CommandLine $Listener.commandLine -RepoRoot $RepoRoot -CommandMarker $CommandMarker)) {
    return [pscustomobject]@{ action = 'FailClosed'; reason = 'foreign or unknown process'; stopPid = $null }
  }
  if (-not ($PidFileValue -gt 0 -and $PidFileValue -eq $listenerPid)) {
    return [pscustomobject]@{ action = 'FailClosed'; reason = 'pid file stale or reused'; stopPid = $null }
  }
  if ($null -ne $Record) {
    if ([int]$Record.pid -ne $listenerPid) {
      return [pscustomobject]@{ action = 'FailClosed'; reason = 'runtime record pid mismatch'; stopPid = $null }
    }
    if ([string]::IsNullOrWhiteSpace([string]$Record.repoRoot) -or (Normalize-PathKey ([string]$Record.repoRoot)) -ne (Normalize-PathKey $RepoRoot)) {
      return [pscustomobject]@{ action = 'FailClosed'; reason = 'runtime record repoRoot mismatch'; stopPid = $null }
    }
    if (([string]$Record.commandMarker) -ne $CommandMarker) {
      return [pscustomobject]@{ action = 'FailClosed'; reason = 'runtime record commandMarker mismatch'; stopPid = $null }
    }
    if (-not [string]::IsNullOrWhiteSpace($DesiredTextProviderMode) -and ([string]$Record.textProviderMode) -ne $DesiredTextProviderMode) {
      return [pscustomobject]@{ action = 'Restart'; reason = 'text provider mode changed'; stopPid = $listenerPid }
    }
    if (-not [string]::IsNullOrWhiteSpace($DesiredRuntimeProfile) -and ([string]$Record.runtimeProfile) -ne $DesiredRuntimeProfile) {
      return [pscustomobject]@{ action = 'Restart'; reason = 'acceptance runtime profile changed'; stopPid = $listenerPid }
    }
    if (([string]$Record.sourceFingerprint) -eq $SourceFingerprint) {
      return [pscustomobject]@{ action = 'Reuse'; reason = 'fingerprint matches'; stopPid = $listenerPid }
    }
    return [pscustomobject]@{ action = 'Restart'; reason = 'controlled but stale fingerprint'; stopPid = $listenerPid }
  }
  return [pscustomobject]@{ action = 'Restart'; reason = 'controlled but missing runtime record'; stopPid = $listenerPid }
}

function Test-SourceFresh {
  param([string]$CurrentFingerprint, [object]$Record, [int]$ListenerPid)
  if ($null -eq $Record) { return [pscustomobject]@{ fresh = $false; reason = 'no runtime record' } }
  if ([int]$Record.pid -ne $ListenerPid) { return [pscustomobject]@{ fresh = $false; reason = 'pid mismatch' } }
  if (([string]$Record.sourceFingerprint) -ne $CurrentFingerprint) { return [pscustomobject]@{ fresh = $false; reason = 'fingerprint mismatch' } }
  return [pscustomobject]@{ fresh = $true; reason = 'ok' }
}

function Wait-ApiReady {
  param([scriptblock]$Probe, [int]$TimeoutSec = 20, [int]$PollMs = 500)
  $deadline = (Get-Date).AddSeconds($TimeoutSec)
  while ((Get-Date) -lt $deadline) {
    $ok = $false
    try { $ok = & $Probe } catch { $ok = $false }
    if ($ok) { return $true }
    Start-Sleep -Milliseconds $PollMs
  }
  return $false
}

# Single-shot /ready probe (injectable for offline regression).
function Test-ApiReady {
  param([scriptblock]$Probe = $null)
  if ($null -eq $Probe) {
    $Probe = { try { (Invoke-RestMethod -Uri 'http://127.0.0.1:3016/ready' -TimeoutSec 2).ok -eq $true } catch { $false } }
  }
  $ok = $false
  try { $ok = & $Probe } catch { $ok = $false }
  return [bool]$ok
}

# Stop a process only when its FULL identity (repoRoot-bound) matches.
# -Strict: throw on mismatch (used when a decision already asserted control).
# Without -Strict: silently skip (used for best-effort cleanup).
function Stop-ApiProcessIfControlled {
  param(
    [int]$ProcessId,
    [string]$RepoRoot,
    [string]$CommandMarker = 'src/server.ts',
    [switch]$Strict
  )
  $proc = Get-CimInstance Win32_Process -Filter "ProcessId=$ProcessId" -ErrorAction SilentlyContinue
  if ($null -eq $proc) { return }
  if (-not (Test-ApiCommandIdentity -ExecutablePath $proc.ExecutablePath -CommandLine $proc.CommandLine -RepoRoot $RepoRoot -CommandMarker $CommandMarker)) {
    if ($Strict) { throw "Refusing to stop uncontrolled process $ProcessId" }
    return
  }
  Stop-Process -Id $ProcessId -ErrorAction SilentlyContinue
}

function Start-ApiAndWait {
  param(
    [string]$AcceptanceRoot,
    [string]$RepoRoot,
    [string]$NodeExe,
    [string]$SourceFingerprint,
    [string]$CommandMarker = 'src/server.ts',
    [string]$TextProviderMode = '',
    [string]$RuntimeProfile = 'safe_default',
    [string]$MediaExecutionMode = 'disabled',
    [bool]$MediaProductEnabled = $false,
    [int]$MaxRealImages = 0,
    [scriptblock]$Probe = $null,
    [scriptblock]$ProcessStarter = $null,
    [scriptblock]$CleanupProcess = $null,
    [scriptblock]$FreshnessCheck = $null,
    [int]$ReadyTimeoutSec = 20,
    [int]$ReadyPollMs = 500
  )
  $tsxPreflight = Join-Path $RepoRoot 'apps\api\node_modules\tsx\dist\preflight.cjs'
  $apiWorkingDir = Join-Path $RepoRoot 'apps\api'
  $stdout = Join-Path $AcceptanceRoot 'logs\api.stdout.log'
  $stderr = Join-Path $AcceptanceRoot 'logs\api.stderr.log'

  $api = $null
  if ($null -ne $ProcessStarter) {
    $api = & $ProcessStarter -RepoRoot $RepoRoot -TsxPreflight $tsxPreflight -WorkingDir $apiWorkingDir -Stdout $stdout -Stderr $stderr
  } else {
    # Launch Node directly with TSX's preload instead of the TSX CLI wrapper.
    # The wrapper spawns a child listener, which makes the recorded PID differ
    # from the port owner and defeats source-freshness verification.
    $api = Start-Process -FilePath $NodeExe -ArgumentList @('--require', $tsxPreflight, '--import', 'tsx', 'src/server.ts') -WorkingDirectory $apiWorkingDir -WindowStyle Hidden -RedirectStandardOutput $stdout -RedirectStandardError $stderr -PassThru
  }
  if ($null -eq $api) { throw 'API process failed to start.' }

  $startedPid = [int]$api.Id
  $pidFile = Join-Path $AcceptanceRoot 'runtime\api.pid'
  $recordPath = Join-Path $AcceptanceRoot 'runtime\api.runtime.json'
  Set-Content -LiteralPath $pidFile -Value $startedPid -Encoding ascii

  $record = [ordered]@{
    sourceFingerprint = $SourceFingerprint
    pid               = $startedPid
    startedAt         = (Get-Date).ToString('o')
    repoRoot          = $RepoRoot
    commandMarker     = $CommandMarker
    textProviderMode  = $TextProviderMode
    runtimeProfile    = $RuntimeProfile
    mediaExecutionMode = $MediaExecutionMode
    mediaProductEnabled = $MediaProductEnabled
    maxRealImages     = $MaxRealImages
  }
  Write-RuntimeRecord -RuntimeDir (Join-Path $AcceptanceRoot 'runtime') -Name 'api.runtime.json' -Record $record

  try {
    $probe = $Probe
    if ($null -eq $probe) {
      $probe = { try { (Invoke-RestMethod -Uri 'http://127.0.0.1:3016/ready' -TimeoutSec 2).ok -eq $true } catch { $false } }
    }
    if (-not (Wait-ApiReady -Probe $probe -TimeoutSec $ReadyTimeoutSec -PollMs $ReadyPollMs)) { throw 'API failed to become ready within timeout.' }

    if ($null -ne $FreshnessCheck) {
      if (-not (& $FreshnessCheck)) { throw 'API ready but source freshness check failed (injected).' }
    } else {
      $l2 = Get-PortListener -Port 3016
      $fresh = Test-SourceFresh -CurrentFingerprint $SourceFingerprint -Record $record -ListenerPid ([int]$l2.pid)
      if (-not $fresh.fresh) { throw "API ready but source freshness check failed: $($fresh.reason)" }
    }
    return $api
  } catch {
    # Clean up ONLY this freshly-started process (full identity required) and
    # this run's pid/record. Never touch a process that is not ours.
    if ($null -ne $CleanupProcess) {
      & $CleanupProcess -ProcessId $startedPid | Out-Null
    } else {
      Stop-ApiProcessIfControlled -ProcessId $startedPid -RepoRoot $RepoRoot -CommandMarker $CommandMarker
    }
    Remove-Item -LiteralPath $pidFile -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $recordPath -Force -ErrorAction SilentlyContinue
    throw
  }
}

# Orchestrates the API start decision into an actual outcome. Dependencies are
# injectable (ReadyProbe / ProcessStarter / ProcessStopper / CleanupProcess)
# so the offline regression can assert the reuse/restart/fail-closed flow
# without real processes or providers.
function Invoke-ApiStart {
  param(
    [string]$AcceptanceRoot,
    [string]$RepoRoot,
    [string]$NodeExe,
    [string]$SourceFingerprint,
    [object]$Listener,
    [object]$Record,
    [int]$PidFileValue,
    [string]$CommandMarker = 'src/server.ts',
    [string]$DesiredTextProviderMode = '',
    [string]$DesiredRuntimeProfile = '',
    [string]$DesiredMediaExecutionMode = 'disabled',
    [bool]$DesiredMediaProductEnabled = $false,
    [int]$DesiredMaxRealImages = 0,
    [scriptblock]$ReadyProbe = $null,
    [scriptblock]$ProcessStarter = $null,
    [scriptblock]$ProcessStopper = $null,
    [scriptblock]$CleanupProcess = $null,
    [scriptblock]$FreshnessCheck = $null,
    [int]$ReadyTimeoutSec = 20,
    [int]$ReadyPollMs = 500
  )

  $decision = Resolve-ApiStartDecision -SourceFingerprint $SourceFingerprint -Listener $Listener -Record $Record -PidFileValue $PidFileValue -RepoRoot $RepoRoot -CommandMarker $CommandMarker -DesiredTextProviderMode $DesiredTextProviderMode -DesiredRuntimeProfile $DesiredRuntimeProfile

  $stopIt = {
    param([int]$TargetPid)
    if ($null -ne $ProcessStopper) { & $ProcessStopper -ProcessId $TargetPid | Out-Null }
    else { Stop-ApiProcessIfControlled -ProcessId $TargetPid -RepoRoot $RepoRoot -CommandMarker $CommandMarker -Strict }
  }

  switch ($decision.action) {
    'StartNew' {
      $null = Start-ApiAndWait -AcceptanceRoot $AcceptanceRoot -RepoRoot $RepoRoot -NodeExe $NodeExe -SourceFingerprint $SourceFingerprint -CommandMarker $CommandMarker -TextProviderMode $DesiredTextProviderMode -RuntimeProfile $DesiredRuntimeProfile -MediaExecutionMode $DesiredMediaExecutionMode -MediaProductEnabled $DesiredMediaProductEnabled -MaxRealImages $DesiredMaxRealImages -Probe $ReadyProbe -ProcessStarter $ProcessStarter -CleanupProcess $CleanupProcess -FreshnessCheck $FreshnessCheck -ReadyTimeoutSec $ReadyTimeoutSec -ReadyPollMs $ReadyPollMs
      return [pscustomobject]@{ outcome = 'started'; stopPid = $null }
    }
    'Reuse' {
      if (Test-ApiReady -Probe $ReadyProbe) {
        return [pscustomobject]@{ outcome = 'reuse'; stopPid = $null }
      }
      # fingerprint matched but /ready failed -> at most one controlled restart
      & $stopIt -TargetPid ([int]$decision.stopPid)
      Start-Sleep -Milliseconds 500
      $null = Start-ApiAndWait -AcceptanceRoot $AcceptanceRoot -RepoRoot $RepoRoot -NodeExe $NodeExe -SourceFingerprint $SourceFingerprint -CommandMarker $CommandMarker -TextProviderMode $DesiredTextProviderMode -RuntimeProfile $DesiredRuntimeProfile -MediaExecutionMode $DesiredMediaExecutionMode -MediaProductEnabled $DesiredMediaProductEnabled -MaxRealImages $DesiredMaxRealImages -Probe $ReadyProbe -ProcessStarter $ProcessStarter -CleanupProcess $CleanupProcess -FreshnessCheck $FreshnessCheck -ReadyTimeoutSec $ReadyTimeoutSec -ReadyPollMs $ReadyPollMs
      return [pscustomobject]@{ outcome = 'restart_after_reuse_fail'; stopPid = [int]$decision.stopPid }
    }
    'Restart' {
      & $stopIt -TargetPid ([int]$decision.stopPid)
      Start-Sleep -Milliseconds 500
      $null = Start-ApiAndWait -AcceptanceRoot $AcceptanceRoot -RepoRoot $RepoRoot -NodeExe $NodeExe -SourceFingerprint $SourceFingerprint -CommandMarker $CommandMarker -TextProviderMode $DesiredTextProviderMode -RuntimeProfile $DesiredRuntimeProfile -MediaExecutionMode $DesiredMediaExecutionMode -MediaProductEnabled $DesiredMediaProductEnabled -MaxRealImages $DesiredMaxRealImages -Probe $ReadyProbe -ProcessStarter $ProcessStarter -CleanupProcess $CleanupProcess -FreshnessCheck $FreshnessCheck -ReadyTimeoutSec $ReadyTimeoutSec -ReadyPollMs $ReadyPollMs
      return [pscustomobject]@{ outcome = 'restart'; stopPid = [int]$decision.stopPid }
    }
    default {
      throw "FAIL-CLOSED: $($decision.reason)"
    }
  }
}

# Final API/Web readiness wait. Exhausting either loop is a hard failure
# (must NOT fall through to status.ps1 and exit 0).
function Wait-ApiAndWebReady {
  param(
    [scriptblock]$ApiProbe = $null,
    [scriptblock]$WebProbe = $null,
    [int]$MaxAttempts = 40,
    [int]$PollMs = 500
  )
  $apiProbe = $ApiProbe
  if ($null -eq $apiProbe) {
    $apiProbe = { try { (Invoke-RestMethod -Uri 'http://127.0.0.1:3016/ready' -TimeoutSec 2).ok -eq $true } catch { $false } }
  }
  $webProbe = $WebProbe
  if ($null -eq $webProbe) {
    $webProbe = { try { (Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:5176/' -TimeoutSec 2).StatusCode -eq 200 } catch { $false } }
  }

  $apiOk = $false
  for ($i = 0; $i -lt $MaxAttempts; $i++) {
    $r = $false; try { $r = & $apiProbe } catch { $r = $false }
    if ($r) { $apiOk = $true; break }
    Start-Sleep -Milliseconds $PollMs
  }
  if (-not $apiOk) { throw 'API did not become ready after startup wait loop.' }

  $webOk = $false
  for ($i = 0; $i -lt $MaxAttempts; $i++) {
    $r = $false; try { $r = & $webProbe } catch { $r = $false }
    if ($r) { $webOk = $true; break }
    Start-Sleep -Milliseconds $PollMs
  }
  if (-not $webOk) { throw 'Web did not become ready after startup wait loop.' }
}

# Web identity: node.exe + exact Vite CLI path under current repoRoot.
function Test-WebCommandIdentity {
  param([string]$ExecutablePath, [string]$CommandLine, [string]$RepoRoot)
  if ([string]::IsNullOrWhiteSpace($ExecutablePath)) { return $false }
  if ($ExecutablePath -notlike '*node.exe') { return $false }
  if ([string]::IsNullOrWhiteSpace($CommandLine)) { return $false }
  $expectedVite = Normalize-PathKey (Join-Path $RepoRoot 'apps\web\node_modules\vite\bin\vite.js')
  if ($expectedVite -eq '') { return $false }
  $normCmd = Normalize-PathKey $CommandLine
  if ($normCmd -notlike ('*' + $expectedVite + '*')) { return $false }
  return $true
}

# Pure stop decision. Full identity + pid-file/listener/record consistency
# must ALL match before a process is stopped; otherwise FailClosed (no kill).
function Resolve-StopAction {
  param(
    [string]$Kind,
    [int]$PidFileValue,
    [object]$Listener,
    [object]$PidFileProc,
    [object]$Record,
    [string]$RepoRoot,
    [string]$CommandMarker = 'src/server.ts'
  )
  $listenerPid = 0
  if ($null -ne $Listener) { $listenerPid = [int]$Listener.pid }

  if ($PidFileValue -le 0 -and $listenerPid -le 0) {
    return [pscustomobject]@{ action = 'none'; reason = 'no process'; stopPid = $null }
  }
  if ($listenerPid -gt 0 -and $PidFileValue -ne $listenerPid) {
    return [pscustomobject]@{ action = 'failclosed'; reason = 'port owner != pid file'; stopPid = $null }
  }
  if ($Kind -eq 'api' -and $null -ne $Record) {
    if ([int]$Record.pid -ne $PidFileValue) {
      return [pscustomobject]@{ action = 'failclosed'; reason = 'record pid mismatch'; stopPid = $null }
    }
    if ([string]::IsNullOrWhiteSpace([string]$Record.repoRoot) -or (Normalize-PathKey ([string]$Record.repoRoot)) -ne (Normalize-PathKey $RepoRoot)) {
      return [pscustomobject]@{ action = 'failclosed'; reason = 'record repoRoot mismatch'; stopPid = $null }
    }
    if (([string]$Record.commandMarker) -ne $CommandMarker) {
      return [pscustomobject]@{ action = 'failclosed'; reason = 'record commandMarker mismatch'; stopPid = $null }
    }
  }

  $targetPid = 0
  $exec = $null; $cmd = $null
  if ($listenerPid -gt 0) {
    $targetPid = $listenerPid
    $exec = $Listener.executablePath
    $cmd = $Listener.commandLine
  } elseif ($null -ne $PidFileProc) {
    $targetPid = $PidFileValue
    $exec = $PidFileProc.executablePath
    $cmd = $PidFileProc.commandLine
  } else {
    return [pscustomobject]@{ action = 'none'; reason = 'process already gone'; stopPid = $null }
  }

  $identityOk = $false
  if ($Kind -eq 'api') {
    $identityOk = Test-ApiCommandIdentity -ExecutablePath $exec -CommandLine $cmd -RepoRoot $RepoRoot -CommandMarker $CommandMarker
  } else {
    $identityOk = Test-WebCommandIdentity -ExecutablePath $exec -CommandLine $cmd -RepoRoot $RepoRoot
  }
  if (-not $identityOk) {
    return [pscustomobject]@{ action = 'failclosed'; reason = 'process identity mismatch'; stopPid = $null }
  }
  return [pscustomobject]@{ action = 'stop'; reason = 'controlled'; stopPid = $targetPid }
}

# Orchestrates a full controlled stop of API + Web. Stops ONLY precisely
# identified controlled PIDs, then clears pid/record files. Any FailClosed
# decision aborts (throw) before any process is touched.
function Invoke-StopAll {
  param(
    [string]$AcceptanceRoot,
    [string]$RepoRoot,
    [string]$CommandMarker,
    [object]$ApiListener,
    [object]$ApiPidFileProc,
    [int]$ApiPidFileValue,
    [object]$ApiRecord,
    [object]$WebListener,
    [object]$WebPidFileProc,
    [int]$WebPidFileValue,
    [scriptblock]$ProcessStopper = $null,
    [scriptblock]$ProcessIdentityResolver = $null
  )
  $apiStop = Resolve-StopAction -Kind 'api' -PidFileValue $ApiPidFileValue -Listener $ApiListener -PidFileProc $ApiPidFileProc -Record $ApiRecord -RepoRoot $RepoRoot -CommandMarker $CommandMarker
  $webStop = Resolve-StopAction -Kind 'web' -PidFileValue $WebPidFileValue -Listener $WebListener -PidFileProc $WebPidFileProc -Record $null -RepoRoot $RepoRoot -CommandMarker $CommandMarker

  if ($apiStop.action -eq 'failclosed') { throw "Refusing to stop API: $($apiStop.reason)" }
  if ($webStop.action -eq 'failclosed') { throw "Refusing to stop Web: $($webStop.reason)" }

  if ($null -eq $ProcessIdentityResolver) {
    $ProcessIdentityResolver = {
      param([int]$ProcessId)
      $proc = Get-CimInstance Win32_Process -Filter "ProcessId=$ProcessId" -ErrorAction SilentlyContinue
      if ($null -eq $proc) { return $null }
      return [pscustomobject]@{
        pid = [int]$proc.ProcessId
        executablePath = [string]$proc.ExecutablePath
        commandLine = [string]$proc.CommandLine
      }
    }
  }

  $stopPlans = New-Object System.Collections.Generic.List[object]
  if ($apiStop.action -eq 'stop') { $stopPlans.Add([pscustomobject]@{ kind = 'api'; pid = [int]$apiStop.stopPid }) }
  if ($webStop.action -eq 'stop') { $stopPlans.Add([pscustomobject]@{ kind = 'web'; pid = [int]$webStop.stopPid }) }

  $assertCurrentIdentity = {
    param([object]$Plan)
    $current = & $ProcessIdentityResolver -ProcessId ([int]$Plan.pid)
    if ($null -eq $current -or [int]$current.pid -ne [int]$Plan.pid) {
      throw "Refusing to stop $($Plan.kind): identity changed before stop"
    }
    $matches = if ($Plan.kind -eq 'api') {
      Test-ApiCommandIdentity -ExecutablePath $current.executablePath -CommandLine $current.commandLine -RepoRoot $RepoRoot -CommandMarker $CommandMarker
    } else {
      Test-WebCommandIdentity -ExecutablePath $current.executablePath -CommandLine $current.commandLine -RepoRoot $RepoRoot
    }
    if (-not $matches) { throw "Refusing to stop $($Plan.kind): identity changed before stop" }
  }

  # Validate every target before touching any process, then re-check immediately
  # before the actual stop to close the PID-reuse window between decision and kill.
  foreach ($plan in $stopPlans) { & $assertCurrentIdentity -Plan $plan }
  foreach ($plan in $stopPlans) {
    & $assertCurrentIdentity -Plan $plan
    if ($null -ne $ProcessStopper) { & $ProcessStopper -ProcessId ([int]$plan.pid) | Out-Null }
    else { Stop-Process -Id ([int]$plan.pid) -ErrorAction SilentlyContinue }
  }

  $apiPidFile = Join-Path $AcceptanceRoot 'runtime\api.pid'
  $apiRecordPath = Join-Path $AcceptanceRoot 'runtime\api.runtime.json'
  $webPidFile = Join-Path $AcceptanceRoot 'runtime\web.pid'
  Remove-Item -LiteralPath $apiPidFile -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $apiRecordPath -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $webPidFile -Force -ErrorAction SilentlyContinue

  return @($stopPlans | ForEach-Object { [int]$_.pid })
}

# Pure freshness verdict for status.ps1. fresh=true ONLY when /ready,
# fingerprint, pid-file/listener/record PID, record repoRoot/commandMarker and
# the listener's full process identity all agree. reason never contains secrets.
function Resolve-SourceFreshness {
  param(
    [string]$SourceFingerprint,
    [object]$Record,
    [object]$Listener,
    [int]$PidFileValue,
    [bool]$ApiReady,
    [string]$RepoRoot,
    [string]$CommandMarker = 'src/server.ts'
  )
  if (-not $ApiReady) { return [pscustomobject]@{ fresh = $false; reason = 'api not ready' } }
  $listenerPid = 0
  if ($null -ne $Listener) { $listenerPid = [int]$Listener.pid }
  if ($listenerPid -le 0) { return [pscustomobject]@{ fresh = $false; reason = 'no listener on 3016' } }
  if ($PidFileValue -le 0 -or $PidFileValue -ne $listenerPid) { return [pscustomobject]@{ fresh = $false; reason = 'pid file vs listener mismatch' } }
  if ($null -eq $Record) { return [pscustomobject]@{ fresh = $false; reason = 'no runtime record' } }
  if ([int]$Record.pid -ne $listenerPid) { return [pscustomobject]@{ fresh = $false; reason = 'record pid mismatch' } }
  if ([string]::IsNullOrWhiteSpace([string]$Record.repoRoot) -or (Normalize-PathKey ([string]$Record.repoRoot)) -ne (Normalize-PathKey $RepoRoot)) { return [pscustomobject]@{ fresh = $false; reason = 'record repoRoot mismatch' } }
  if (([string]$Record.commandMarker) -ne $CommandMarker) { return [pscustomobject]@{ fresh = $false; reason = 'record commandMarker mismatch' } }
  if (([string]$Record.sourceFingerprint) -ne $SourceFingerprint) { return [pscustomobject]@{ fresh = $false; reason = 'fingerprint mismatch' } }
  if (-not (Test-ApiCommandIdentity -ExecutablePath $Listener.executablePath -CommandLine $Listener.commandLine -RepoRoot $RepoRoot -CommandMarker $CommandMarker)) {
    return [pscustomobject]@{ fresh = $false; reason = 'listener identity mismatch' }
  }
  return [pscustomobject]@{ fresh = $true; reason = 'ok' }
}

# =====================================================================
# Main flow
# =====================================================================
if (-not $OfflineSelfTest) {
  $ErrorActionPreference = "Stop"

  $repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..\..")).Path
  $envFile = Join-Path $AcceptanceRoot ".env.acceptance"
  if (-not (Test-Path -LiteralPath (Join-Path $AcceptanceRoot ".beauty-industry-acceptance"))) { throw "Unmarked acceptance directory." }
  $runtimeProfile = Resolve-AcceptanceRuntimeProfile -AcceptanceRoot $AcceptanceRoot
  $approvedTextRequested = [bool]$EnableApprovedText -or $runtimeProfile -eq "xhs_user_acceptance_v1"
  $approvedMediaRequested = [bool]$EnableApprovedMedia -or $runtimeProfile -eq "xhs_user_acceptance_v1"
  Get-Content -LiteralPath $envFile -Encoding utf8 | ForEach-Object {
    if ($_ -match "^([^#][^=]*)=(.*)$") { [Environment]::SetEnvironmentVariable($matches[1].Trim(), $matches[2].Trim(), "Process") }
  }
  $textProviderMode = "controlled_mock"
  if ($approvedTextRequested) {
    $textApprovalFile = Join-Path $AcceptanceRoot ".env.text-approval"
    if (-not (Test-Path -LiteralPath $textApprovalFile)) {
      throw "Approved text mode requires the controlled .env.text-approval outside the repository."
    }
    Get-Content -LiteralPath $textApprovalFile -Encoding utf8 | ForEach-Object {
      if ($_ -match "^(DEEPSEEK_API_KEY|DEEPSEEK_BASE_URL|DEEPSEEK_MODEL)=(.*)$") {
        [Environment]::SetEnvironmentVariable($matches[1].Trim(), $matches[2].Trim(), "Process")
      }
    }
    if ([string]::IsNullOrWhiteSpace($env:DEEPSEEK_API_KEY)) {
      $apiEnvFile = Join-Path $repoRoot "apps\api\.env"
      if (Test-Path -LiteralPath $apiEnvFile) {
        Get-Content -LiteralPath $apiEnvFile -Encoding utf8 | ForEach-Object {
          if ($_ -match "^DEEPSEEK_API_KEY=(.*)$" -and -not [string]::IsNullOrWhiteSpace($matches[1].Trim())) {
            [Environment]::SetEnvironmentVariable("DEEPSEEK_API_KEY", $matches[1].Trim(), "Process")
          }
        }
      }
    }
    if ([string]::IsNullOrWhiteSpace($env:DEEPSEEK_API_KEY) -or [string]::IsNullOrWhiteSpace($env:DEEPSEEK_BASE_URL)) {
      throw "Approved text mode requires configured DeepSeek key and base URL."
    }
    if ($env:DEEPSEEK_MODEL -ne "deepseek-v4-pro") { throw "XHS user acceptance profile requires deepseek-v4-pro." }
    [Environment]::SetEnvironmentVariable("LLM_MOCK_MODE", "false", "Process")
    [Environment]::SetEnvironmentVariable("USE_MOCK_LLM", "false", "Process")
    $textProviderMode = "configured_provider"
  }
  if ($EnableApprovedDailyBrief) {
    if (-not $approvedTextRequested) { throw "Approved daily brief mode requires approved text mode." }
    $dailyApprovalFile = Join-Path $AcceptanceRoot ".env.daily-brief-approval"
    if (-not (Test-Path -LiteralPath $dailyApprovalFile)) { throw "Approved daily brief mode requires the controlled .env.daily-brief-approval outside the repository." }
    $allowedDailyKeys = @(
      "BEAUTY_DAILY_BRIEF_RUNTIME_MODE", "BEAUTY_DAILY_BRIEF_SCHEDULER_ENABLED", "BEAUTY_DAILY_BRIEF_RECURRING_APPROVED",
      "BEAUTY_DAILY_BRIEF_SCHEDULER_TENANT_ID", "BEAUTY_DAILY_BRIEF_SCHEDULER_USER_ID", "BEAUTY_DAILY_BRIEF_MANUAL_RETRY_APPROVED",
      "BEAUTY_DAILY_BRIEF_DAILY_NETWORK_REQUEST_LIMIT", "BEAUTY_DAILY_BRIEF_DAILY_MODEL_CALL_LIMIT", "BEAUTY_DAILY_BRIEF_DAILY_COST_LIMIT_YUAN",
      "BEAUTY_DAILY_BRIEF_MONTHLY_NETWORK_REQUEST_LIMIT", "BEAUTY_DAILY_BRIEF_MONTHLY_MODEL_CALL_LIMIT", "BEAUTY_DAILY_BRIEF_MONTHLY_COST_LIMIT_YUAN"
    )
    Get-Content -LiteralPath $dailyApprovalFile -Encoding utf8 | ForEach-Object {
      if ($_ -match "^([^#][^=]*)=(.*)$" -and $allowedDailyKeys -contains $matches[1].Trim()) {
        [Environment]::SetEnvironmentVariable($matches[1].Trim(), $matches[2].Trim(), "Process")
      }
    }
    if ($env:BEAUTY_DAILY_BRIEF_RUNTIME_MODE -ne "live" -or $env:BEAUTY_DAILY_BRIEF_RECURRING_APPROVED -ne "true") { throw "Approved daily brief mode is not live and recurring-approved." }
  }
  $mediaApprovalFile = Join-Path $AcceptanceRoot ".env.media-approval"
  if ($approvedMediaRequested -and (Test-Path -LiteralPath $mediaApprovalFile)) {
    Get-Content -LiteralPath $mediaApprovalFile -Encoding utf8 | ForEach-Object {
      if ($_ -match "^([^#][^=]*)=(.*)$") { [Environment]::SetEnvironmentVariable($matches[1].Trim(), $matches[2].Trim(), "Process") }
    }
  }
  if ($approvedMediaRequested) {
    if (-not (Test-Path -LiteralPath $mediaApprovalFile)) { throw "Approved media mode requires the controlled .env.media-approval outside the repository." }
    if ($env:BEAUTY_MEDIA_EXECUTION_MODE -ne "real" -or $env:BEAUTY_MEDIA_PRODUCT_ENABLED -ne "true") { throw "Approved XHS media profile must be real and product-enabled." }
    if ($env:LANQI_MEDIA_EXECUTION_MODE -ne "real" -or $env:LANQI_MEDIA_ASSET_STORAGE -ne "local") { throw "Approved XHS media profile must enable the underlying real provider with local storage." }
    if ($env:BEAUTY_MEDIA_REAL_EXECUTION_APPROVED -ne "true" -or $env:LANQI_MEDIA_REAL_EXECUTION_APPROVED -ne "true") { throw "Approved XHS media profile is missing the explicit real-execution approvals." }
    if ([int]$env:BEAUTY_MEDIA_MAX_REAL_IMAGES -ne 3) { throw "Approved XHS media profile must be capped at three images." }
    if ([decimal]$env:BEAUTY_MEDIA_MAX_PROVIDER_COST_YUAN -le 0 -or [decimal]$env:BEAUTY_MEDIA_MAX_PROVIDER_COST_YUAN -gt 1) { throw "Approved XHS media profile exceeds the local acceptance cost boundary." }
    if ([int]$env:BEAUTY_MEDIA_IMAGE_CREDITS -ne 100 -or $env:BEAUTY_MEDIA_ASSET_STORAGE -ne "local") { throw "Approved XHS media profile must use the 300-credit three-image contract and local storage." }
    if ($env:LANQI_MEDIA_IMAGE_MODEL -ne "wan2.7-image") { throw "Approved XHS media profile requires wan2.7-image." }
  }
  $mediaExecutionMode = if ($approvedMediaRequested) { [string]$env:BEAUTY_MEDIA_EXECUTION_MODE } else { "disabled" }
  $mediaProductEnabled = $approvedMediaRequested -and $env:BEAUTY_MEDIA_PRODUCT_ENABLED -eq "true"
  $maxRealImages = if ($approvedMediaRequested) { [int]$env:BEAUTY_MEDIA_MAX_REAL_IMAGES } else { 0 }
  $pgBin = "C:\Program Files\PostgreSQL\17\bin"
  $nodeExe = "C:\Program Files\nodejs\node.exe"

  & (Join-Path $pgBin "pg_isready.exe") -h 127.0.0.1 -p 55434 *> $null
  if ($LASTEXITCODE -ne 0) {
    & (Join-Path $pgBin "pg_ctl.exe") start -D (Join-Path $AcceptanceRoot "pgdata") -l (Join-Path $AcceptanceRoot "logs\postgres.log") -o "-h 127.0.0.1 -p 55434"
  }

  # ---- API start decision: source fingerprint + runtime record ----
  $commandMarker = 'src/server.ts'
  $sourceFingerprint = Get-SourceFingerprint -RepoRoot $repoRoot
  $listener = Get-PortListener -Port 3016
  $record = Read-RuntimeRecord -RuntimeDir (Join-Path $AcceptanceRoot 'runtime') -Name 'api.runtime.json'

  $pidFile = Join-Path $AcceptanceRoot 'runtime\api.pid'
  $pidFileValue = 0
  if (Test-Path -LiteralPath $pidFile) {
    $raw = (Get-Content -LiteralPath $pidFile -Raw -ErrorAction SilentlyContinue).Trim()
    [int]::TryParse($raw, [ref]$pidFileValue) | Out-Null
  }

  # One-time safe migration from the legacy TSX CLI parent/child layout.
  # A mismatched PID is never stopped unless both processes are freshly
  # verified as the exact current-repo parent/child pair.
  if ($null -ne $listener -and $pidFileValue -gt 0 -and $pidFileValue -ne [int]$listener.pid -and $null -eq $record) {
    $legacyParentRaw = Get-CimInstance Win32_Process -Filter "ProcessId=$pidFileValue" -ErrorAction SilentlyContinue
    $legacyParent = if ($null -eq $legacyParentRaw) { $null } else {
      [pscustomobject]@{
        pid = [int]$legacyParentRaw.ProcessId
        parentPid = [int]$legacyParentRaw.ParentProcessId
        executablePath = [string]$legacyParentRaw.ExecutablePath
        commandLine = [string]$legacyParentRaw.CommandLine
      }
    }
    $tsxJunction = Get-Item -LiteralPath (Join-Path $repoRoot 'apps\api\node_modules\tsx') -Force
    $resolvedPreflight = Join-Path ([string]$tsxJunction.Target) 'dist\preflight.cjs'
    if (Test-LegacyApiPairIdentity -Parent $legacyParent -Child $listener -RepoRoot $repoRoot -ExpectedPreflightPath $resolvedPreflight -CommandMarker $commandMarker) {
      Stop-LegacyApiPairIfControlled -ParentPid $pidFileValue -ChildPid ([int]$listener.pid) -RepoRoot $repoRoot -ExpectedPreflightPath $resolvedPreflight -CommandMarker $commandMarker
      Remove-Item -LiteralPath $pidFile -Force -ErrorAction SilentlyContinue
      $listener = $null
      $pidFileValue = 0
    }
  }

  $result = Invoke-ApiStart -AcceptanceRoot $AcceptanceRoot -RepoRoot $repoRoot -NodeExe $nodeExe -SourceFingerprint $sourceFingerprint -Listener $listener -Record $record -PidFileValue $pidFileValue -CommandMarker $commandMarker -DesiredTextProviderMode $textProviderMode -DesiredRuntimeProfile $runtimeProfile -DesiredMediaExecutionMode $mediaExecutionMode -DesiredMediaProductEnabled $mediaProductEnabled -DesiredMaxRealImages $maxRealImages
  Write-Output ("api_outcome=" + $result.outcome + ";fingerprint_short=" + (Get-FingerprintShort $sourceFingerprint))

  # ---- Web process (behavior kept from original) ----
  $webReady = $false
  try { $webReady = (Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:5176/" -TimeoutSec 2).StatusCode -eq 200 } catch {}
  if (-not $webReady) {
    $web = Start-Process -FilePath $nodeExe -ArgumentList @((Join-Path $repoRoot "apps\web\node_modules\vite\bin\vite.js"), "--host", "127.0.0.1", "--port", "5176") -WorkingDirectory (Join-Path $repoRoot "apps\web") -WindowStyle Hidden -RedirectStandardOutput (Join-Path $AcceptanceRoot "logs\web.stdout.log") -RedirectStandardError (Join-Path $AcceptanceRoot "logs\web.stderr.log") -PassThru
    Set-Content -LiteralPath (Join-Path $AcceptanceRoot "runtime\web.pid") -Value $web.Id -Encoding ascii
  }

  Wait-ApiAndWebReady
  if ($approvedTextRequested) {
    $ready = Invoke-RestMethod -Uri 'http://127.0.0.1:3016/ready' -TimeoutSec 3
    if (-not [bool]$ready.checks.llm.configured) {
      throw "Approved text mode started without a configured Provider."
    }
  }
  & (Join-Path $PSScriptRoot "status.ps1") -AcceptanceRoot $AcceptanceRoot
}
