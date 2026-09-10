# 生成生产发布归档的文件清单：tracked + untracked（未忽略），排除运行期/临时/密钥路径。
# 用法: powershell -File scripts/tmp/build-prod-filelist.ps1 -RepoRoot <path> -OutList <path>
param(
  [Parameter(Mandatory=$true)][string]$RepoRoot,
  [Parameter(Mandatory=$true)][string]$OutList
)
$ErrorActionPreference = "Stop"
$RepoRoot = (Resolve-Path -LiteralPath $RepoRoot).Path
Push-Location $RepoRoot
try {
  $tracked = & git -c core.quotepath=false ls-files
  $untracked = & git -c core.quotepath=false ls-files -o --exclude-standard
  if ($LASTEXITCODE -ne 0) { throw "git ls-files failed" }
} finally {
  Pop-Location
}

$excludePattern = '^(node_modules/|\.qa/|\.debug/|\.deploy/|reports/|videos/|release/|deploy-package/|\.tmp|_tmp|logs/|uploads/|work/|\.codex|\.esbuild-repair|\.pnpm-store|scripts/tmp/|prisma/)|(__pycache__/)|\.(pyc|pyo|db)$'
$envPattern = '(^|/)\.env'

$all = @($tracked) + @($untracked)
$keep = $all |
  Where-Object { $_ -and $_ -notmatch $excludePattern -and $_ -notmatch $envPattern } |
  ForEach-Object { $_ -replace '\\', '/' } |
  Sort-Object -Unique

$missing = @()
foreach ($rel in $keep) {
  if (-not (Test-Path -LiteralPath (Join-Path $RepoRoot ($rel -replace '/', '\')) -PathType Leaf)) { $missing += $rel }
}
if ($missing.Count -gt 0) { throw ("missing local files:`n" + ($missing -join "`n")) }

[System.IO.File]::WriteAllLines($OutList, $keep, (New-Object System.Text.UTF8Encoding($false)))
Write-Output "filelist written: $($keep.Count) files -> $OutList"
