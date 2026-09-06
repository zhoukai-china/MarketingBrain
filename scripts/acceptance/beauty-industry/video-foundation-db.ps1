param([int]$Port = 55445,[ValidateSet('BY45','BY46','BY50','BY51','BY54')][string]$Suite='BY45')
$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path (Join-Path $PSScriptRoot '../../..')).Path
. (Join-Path $PSScriptRoot 'start.ps1') -OfflineSelfTest
$pgBin = 'C:\Program Files\PostgreSQL\17\bin'
if (-not (Test-Path -LiteralPath (Join-Path $pgBin 'pg_ctl.exe'))) { throw 'PostgreSQL 17 unavailable' }
if ($Port -lt 55440 -or $Port -gt 55499) { throw 'Only isolated fixture ports allowed' }
if (Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue) { throw 'Port occupied; no process will be changed' }
$session = [guid]::NewGuid().ToString('N')
$base = Join-Path (Split-Path $repo -Parent) 'test-environments'
$root = Join-Path $base "$($Suite.ToLower())-offline-$session"
if (Test-Path -LiteralPath $root) { throw 'Never reuse an existing database or runtime' }
New-Item -ItemType Directory -Path $root | Out-Null
$data = Join-Path $root 'pgdata'
$record = [ordered]@{ task=$Suite; session=$session; repo=$repo; root=$root; data=$data; port=$Port; sourceFingerprint=(Get-SourceFingerprint $repo); startedAt=[DateTime]::UtcNow.ToString('o'); providerCalls=0; costYuan=0; state='created' }
$recordPath = Join-Path $root 'runtime.json'
$record | ConvertTo-Json | Set-Content -LiteralPath $recordPath -Encoding UTF8
$started = $false
$priorUrl = $env:DATABASE_URL
$priorTestUrl = $env:BY45_DB_URL
$priorOwned = $env:BY45_DB_OWNED
function Assert-OwnedPostgres {
  $pidFile = Join-Path $data 'postmaster.pid'
  if (-not (Test-Path -LiteralPath $pidFile)) { throw 'Missing owned pid record; fail closed' }
  $lines = Get-Content -LiteralPath $pidFile
  $pgProcessId = [int]$lines[0]
  if ((Normalize-PathKey $lines[1]) -ne (Normalize-PathKey $data)) { throw 'Data identity mismatch' }
  $process = Get-CimInstance Win32_Process -Filter "ProcessId=$pgProcessId"
  $listeners = @(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction Stop)
  if (-not $process -or (Normalize-PathKey $process.ExecutablePath) -ne (Normalize-PathKey (Join-Path $pgBin 'postgres.exe')) -or -not (Normalize-PathKey $process.CommandLine).Contains((Normalize-PathKey $data)) -or $listeners.Count -eq 0 -or @($listeners | Where-Object OwningProcess -ne $pgProcessId).Count -gt 0) { throw 'Listener/command/runtime identity mismatch; no stop permitted' }
  if ($record.Contains('pid') -and $record.pid -ne $pgProcessId) { throw 'Recorded pid drift' }
  return $pgProcessId
}
Push-Location $repo
try {
  & (Join-Path $pgBin 'initdb.exe') -D $data -U by45_fixture --auth-local=trust --auth-host=trust --encoding=UTF8 --locale=C *> (Join-Path $root 'init.log')
  if ($LASTEXITCODE -ne 0) { throw 'initdb failed' }
  # Direct native invocation under Windows PowerShell can retain inherited handles from postgres.
  # Own the launcher, redirect both handles to files, and bound the start wait.
  $launcher = Start-Process -FilePath (Join-Path $pgBin 'pg_ctl.exe') -ArgumentList @('-D', "`"$data`"", '-l', "`"$(Join-Path $root 'postgres.log')`"", '-o', "`"-h 127.0.0.1 -p $Port`"", '-w','-t','30','start') -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $root 'start.log') -RedirectStandardError (Join-Path $root 'start-error.log')
  if (-not $launcher.WaitForExit(40000)) { throw 'Owned launcher timeout; inspect root, do not claim another process' }
  if ($null -ne $launcher.ExitCode -and $launcher.ExitCode -ne 0) { throw 'Owned launcher failed' }
  # Windows PowerShell may release ExitCode after WaitForExit; listener/data/absolute command
  # identity is mandatory below regardless of launcher status, never inferred from an exit code.
  $started=$true
  $record.pid = Assert-OwnedPostgres
  $record.state='running'; $record | ConvertTo-Json | Set-Content -LiteralPath $recordPath -Encoding UTF8
  & (Join-Path $pgBin 'createdb.exe') -h 127.0.0.1 -p $Port -U by45_fixture by45_fixture
  if ($LASTEXITCODE -ne 0) { throw 'create empty fixture database failed' }
  $env:DATABASE_URL="postgresql://by45_fixture@127.0.0.1:$Port/by45_fixture?schema=public"
  $env:BY45_DB_URL=$env:DATABASE_URL; $env:BY45_DB_OWNED='true'
  & pnpm.cmd --filter '@baolu/db' exec prisma db push --skip-generate *> (Join-Path $root 'schema.log')
  if ($LASTEXITCODE -ne 0) { throw 'Empty fixture schema setup failed' }
  $testScript = if($Suite -eq 'BY54'){'scripts/beauty-seedance-execution-smoke.ts'}elseif($Suite -eq 'BY51'){'scripts/beauty-usage-metering-smoke.ts'}elseif($Suite -eq 'BY50'){'scripts/beauty-video-execution-smoke.ts'}elseif($Suite -eq 'BY46'){'scripts/beauty-video-material-authorization-smoke.ts'}else{'scripts/beauty-video-replication-foundation-smoke.ts'}
  & node (Join-Path $repo 'apps/api/node_modules/tsx/dist/cli.mjs') (Join-Path $repo $testScript) *> (Join-Path $root 'test.log')
  if ($LASTEXITCODE -ne 0) { throw "Isolated database smoke failed; sanitized test evidence: $root" }
  if ($Suite -eq 'BY51') {
    & node (Join-Path $repo 'apps/api/node_modules/tsx/dist/cli.mjs') (Join-Path $repo 'scripts/beauty-video-execution-smoke.ts') *> (Join-Path $root 'video-http-test.log')
    if ($LASTEXITCODE -ne 0) { throw "Isolated video integration smoke failed: $root" }
  }
  $record.result='PASS'
} finally {
  try {
    if ($started) {
      $null=Assert-OwnedPostgres
      & (Join-Path $pgBin 'pg_ctl.exe') -D $data -m fast -w -t 30 stop *> (Join-Path $root 'stop.log')
      if ($LASTEXITCODE -ne 0 -or (Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)) { throw 'Owned stop not verified' }
      $record.state='stopped'; $record.stoppedAt=[DateTime]::UtcNow.ToString('o')
    }
    $record | ConvertTo-Json | Set-Content -LiteralPath $recordPath -Encoding UTF8
  } finally {
    $env:DATABASE_URL=$priorUrl; $env:BY45_DB_URL=$priorTestUrl; $env:BY45_DB_OWNED=$priorOwned
    Pop-Location
  }
  Write-Output "BY45_DB_AUDIT=$root"
}
