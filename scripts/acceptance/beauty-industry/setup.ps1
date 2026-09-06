param(
  [string]$AcceptanceRoot = "F:\思潼AI增长os\test-environments\beauty-industry-acceptance-20260821"
)
$ErrorActionPreference = "Stop"

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..\..")).Path
$marker = Join-Path $AcceptanceRoot ".beauty-industry-acceptance"
$pgBin = "C:\Program Files\PostgreSQL\17\bin"
$nodeExe = "C:\Program Files\nodejs\node.exe"
$pgPort = 55434
$dbName = "beauty_industry_acceptance_20260821"
$dbUser = "beauty_acceptance"

if (Test-Path -LiteralPath $AcceptanceRoot) {
  $entries = @(Get-ChildItem -LiteralPath $AcceptanceRoot -Force -ErrorAction Stop)
  if ($entries.Count -gt 0 -and -not (Test-Path -LiteralPath $marker)) {
    throw "Refusing to reuse a non-empty unmarked acceptance directory."
  }
} else {
  New-Item -ItemType Directory -Path $AcceptanceRoot | Out-Null
}

foreach ($name in @("logs", "runtime", "backups", "reports")) {
  New-Item -ItemType Directory -Path (Join-Path $AcceptanceRoot $name) -Force | Out-Null
}
if (-not (Test-Path -LiteralPath $marker)) {
  Set-Content -LiteralPath $marker -Value "beauty-industry acceptance environment`ncreated=2026-08-21" -Encoding utf8
}

function New-SafeSecret([int]$bytes) {
  $buffer = New-Object byte[] $bytes
  [System.Security.Cryptography.RandomNumberGenerator]::Fill($buffer)
  return [Convert]::ToBase64String($buffer).TrimEnd("=").Replace("+", "-").Replace("/", "_")
}

$envFile = Join-Path $AcceptanceRoot ".env.acceptance"
if (-not (Test-Path -LiteralPath $envFile)) {
  $dbPassword = New-SafeSecret 30
  $jwtSecret = New-SafeSecret 48
  $knowledgeKey = New-SafeSecret 32
  $lines = @(
    "NODE_ENV=development",
    "DATA_MODE=database",
    "API_HOST=127.0.0.1",
    "PORT=3016",
    "DATABASE_URL=postgresql://${dbUser}:${dbPassword}@127.0.0.1:${pgPort}/${dbName}?schema=public",
    "JWT_SECRET=${jwtSecret}",
    "KNOWLEDGE_CREDENTIALS_KEY=${knowledgeKey}",
    "LLM_PROVIDER=deepseek",
    "DEEPSEEK_MODEL=deepseek-v4-pro",
    "LLM_MOCK_MODE=true",
    "USE_MOCK_LLM=true",
    "SKILL_MCP_REQUIRED=false",
    "WORKBUDDY_MCP_ENABLED=true",
    "WORKBUDDY_MCP_PUBLIC_URL=http://127.0.0.1:3016/integrations/workbuddy/mcp",
    "NEW_USER_LOCAL_TRIAL_CREDITS=500",
    "INVITE_REQUIRED=false",
    "WECHAT_AUTH_REQUIRED=false",
    "LANQI_MEDIA_EXECUTION_MODE=disabled",
    "LANQI_MEDIA_REAL_EXECUTION_APPROVED=false",
    "CONTINUOUS_IMPROVEMENT_ENABLED=false",
    "CONTINUOUS_IMPROVEMENT_AUTO_PERSIST=false",
    "CONTINUOUS_IMPROVEMENT_AUTO_ACTIVATE=false"
  )
  Set-Content -LiteralPath $envFile -Value $lines -Encoding utf8
}

Get-Content -LiteralPath $envFile -Encoding utf8 | ForEach-Object {
  if ($_ -match "^([^#][^=]*)=(.*)$") {
    [Environment]::SetEnvironmentVariable($matches[1].Trim(), $matches[2].Trim(), "Process")
  }
}

$pgData = Join-Path $AcceptanceRoot "pgdata"
if (-not (Test-Path -LiteralPath (Join-Path $pgData "PG_VERSION"))) {
  $passwordFile = Join-Path $AcceptanceRoot "runtime\pg-password.tmp"
  Set-Content -LiteralPath $passwordFile -Value $env:DATABASE_URL.Split(":")[2].Split("@")[0] -Encoding ascii -NoNewline
  try {
    & (Join-Path $pgBin "initdb.exe") -D $pgData -U $dbUser -A scram-sha-256 --pwfile=$passwordFile --encoding=UTF8 --locale=C | Out-File (Join-Path $AcceptanceRoot "logs\initdb.log") -Encoding utf8
    if ($LASTEXITCODE -ne 0) { throw "PostgreSQL initdb failed." }
  } finally {
    Remove-Item -LiteralPath $passwordFile -Force -ErrorAction SilentlyContinue
  }
}

$ready = & (Join-Path $pgBin "pg_isready.exe") -h 127.0.0.1 -p $pgPort 2>$null
if ($LASTEXITCODE -ne 0) {
  & (Join-Path $pgBin "pg_ctl.exe") start -D $pgData -l (Join-Path $AcceptanceRoot "logs\postgres.log") -o "-h 127.0.0.1 -p $pgPort"
  if ($LASTEXITCODE -ne 0) { throw "PostgreSQL failed to start." }
}

$env:PGPASSWORD = $env:DATABASE_URL.Split(":")[2].Split("@")[0]
$exists = & (Join-Path $pgBin "psql.exe") -h 127.0.0.1 -p $pgPort -U $dbUser -d postgres -Atc "SELECT 1 FROM pg_database WHERE datname='$dbName'"
if ($exists -ne "1") {
  & (Join-Path $pgBin "createdb.exe") -h 127.0.0.1 -p $pgPort -U $dbUser $dbName
  if ($LASTEXITCODE -ne 0) { throw "Acceptance database creation failed." }
}

$prismaCli = Join-Path $repoRoot "packages\db\node_modules\prisma\build\index.js"
$schema = Join-Path $repoRoot "packages\db\prisma\schema.prisma"
foreach ($pass in 1..2) {
  & $nodeExe $prismaCli migrate deploy --schema $schema *> (Join-Path $AcceptanceRoot "logs\migrate-$pass.log")
  if ($LASTEXITCODE -ne 0) { throw "Migration pass $pass failed; see the acceptance log." }
}

$gitignore = @(
  ".env.acceptance",
  "runtime/",
  "logs/",
  "pgdata/",
  "backups/",
  "reports/"
)
Set-Content -LiteralPath (Join-Path $AcceptanceRoot ".gitignore") -Value $gitignore -Encoding utf8
Write-Output "beauty_acceptance_setup=ok;database=$dbName;postgres_port=$pgPort;secrets=not_displayed"
