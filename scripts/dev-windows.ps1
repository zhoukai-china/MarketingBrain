$ErrorActionPreference = "Stop"

$runtimeRoot = "C:\Users\book\.cache\codex-runtimes\codex-primary-runtime\dependencies"
$env:PATH = "$runtimeRoot\node\bin;$runtimeRoot\bin;$env:PATH"
if (-not $env:DATABASE_URL) {
  $env:DATABASE_URL = "postgresql://baolu:password@localhost:5432/baolu_os_v2"
}
if (-not $env:DATA_MODE) {
  $env:DATA_MODE = "demo"
}
if (-not $env:VITE_API_BASE_URL) {
  $env:VITE_API_BASE_URL = "http://localhost:3011"
}

New-Item -ItemType Directory -Force -Path ".\logs" | Out-Null

Start-Process -FilePath "powershell" -ArgumentList @(
  "-NoProfile",
  "-ExecutionPolicy",
  "Bypass",
  "-Command",
  "`$env:PATH='$env:PATH'; `$env:DATABASE_URL='$env:DATABASE_URL'; `$env:DATA_MODE='$env:DATA_MODE'; pnpm --filter @baolu/api dev"
) -WorkingDirectory (Get-Location) -WindowStyle Hidden -RedirectStandardOutput ".\logs\api.out.log" -RedirectStandardError ".\logs\api.err.log"

Start-Process -FilePath "powershell" -ArgumentList @(
  "-NoProfile",
  "-ExecutionPolicy",
  "Bypass",
  "-Command",
  "`$env:PATH='$env:PATH'; `$env:VITE_API_BASE_URL='$env:VITE_API_BASE_URL'; pnpm --filter @baolu/web dev"
) -WorkingDirectory (Get-Location) -WindowStyle Hidden -RedirectStandardOutput ".\logs\web.out.log" -RedirectStandardError ".\logs\web.err.log"

Start-Sleep -Seconds 3
Write-Host "API: http://localhost:3011"
Write-Host "Web: http://localhost:5174"
