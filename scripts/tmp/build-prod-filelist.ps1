# Build the file list for a production release archive: tracked + untracked (not ignored),
# excluding runtime/temp/secret paths.
# Usage: powershell -File scripts/tmp/build-prod-filelist.ps1 -RepoRoot <path> -OutList <path>
# NOTE: keep this file ASCII-only. Windows PowerShell 5.1 reads .ps1 without BOM as ANSI,
# which can swallow line breaks after non-ASCII comment text and silently comment out code.
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
# Local release artifacts left in the repo root (release-*.tar.gz etc.) must not enter the next archive.
$artifactPattern = '^release-.*\.(tar\.gz|tgz|tar|zip)$|^[^/]+\.tar\.gz$'
$envPattern = '(^|/)\.env'

$all = @($tracked) + @($untracked)
$keep = $all |
  Where-Object { $_ -and $_ -notmatch $excludePattern -and $_ -notmatch $envPattern -and $_ -notmatch $artifactPattern } |
  ForEach-Object { $_ -replace '\\', '/' } |
  Sort-Object -Unique

$missing = @()
$deleted = @()
foreach ($rel in $keep) {
  $full = Join-Path $RepoRoot ($rel -replace '/', '\')
  if (-not (Test-Path -LiteralPath $full -PathType Leaf)) {
    # Files still tracked by git but intentionally deleted in this release
    # (PLAT-18 style "remove legacy pages" releases).
    # They must not enter the archive nor fail the whole release; instead write a
    # separate delete list so deployment can remove the same stale paths on the server.
    $deleted += $rel
  }
}
Write-Output "kept candidates: $($keep.Count); intentionally deleted: $($deleted.Count)"
if ($deleted.Count -gt 0) {
  Write-Output "intentionally deleted (kept out of the archive): $($deleted.Count) files"
  $keep = @($keep | Where-Object { $deleted -notcontains $_ })
  $deletedList = $OutList + ".deleted.txt"
  [System.IO.File]::WriteAllLines($deletedList, $deleted, (New-Object System.Text.UTF8Encoding($false)))
  Write-Output "deleted list written: $deletedList"
}
if ($missing.Count -gt 0) { throw ("missing local files:`n" + ($missing -join "`n")) }

[System.IO.File]::WriteAllLines($OutList, $keep, (New-Object System.Text.UTF8Encoding($false)))
Write-Output "filelist written: $($keep.Count) files -> $OutList"
