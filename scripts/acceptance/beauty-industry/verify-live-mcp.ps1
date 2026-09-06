param([string]$AcceptanceRoot = "F:\思潼AI增长os\test-environments\beauty-industry-acceptance-20260821")
$ErrorActionPreference = "Stop"
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..\..")).Path
$envFile = Join-Path $AcceptanceRoot ".env.acceptance"
Get-Content -LiteralPath $envFile -Encoding utf8 | ForEach-Object {
  if ($_ -match "^([^#][^=]*)=(.*)$") { [Environment]::SetEnvironmentVariable($matches[1].Trim(), $matches[2].Trim(), "Process") }
}
$env:BEAUTY_ACCEPTANCE_API_URL = "http://127.0.0.1:3016"
$env:BEAUTY_ACCEPTANCE_REPORT_DIR = Join-Path $AcceptanceRoot "reports"
$env:NODE_ENV = "test"
& "C:\Program Files\nodejs\node.exe" (Join-Path $repoRoot "apps\api\node_modules\tsx\dist\cli.mjs") (Join-Path $repoRoot "scripts\verify-beauty-industry-live-mcp.ts")
if ($LASTEXITCODE -ne 0) { throw "Live MCP acceptance failed." }
