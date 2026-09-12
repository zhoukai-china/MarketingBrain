# Build an incremental release archive: text files normalized to LF, binaries copied as-is,
# so the Linux side gets byte-exact content.
# Usage: powershell -File scripts/tmp/build-release-archive.ps1 -RepoRoot <path> -FileList <path> -OutArchive <path> -StageRoot <path>
# NOTE: keep this file ASCII-only. Windows PowerShell 5.1 reads .ps1 without BOM as ANSI,
# which can swallow line breaks after non-ASCII comment text and silently comment out code.
param(
  [Parameter(Mandatory=$true)][string]$RepoRoot,
  [Parameter(Mandatory=$true)][string]$FileList,
  [Parameter(Mandatory=$true)][string]$OutArchive,
  [Parameter(Mandatory=$true)][string]$StageRoot
)
$ErrorActionPreference = "Stop"
$RepoRoot = (Resolve-Path -LiteralPath $RepoRoot).Path
$binaryExt = @(".mp4", ".png", ".jpg", ".jpeg", ".gif", ".webp", ".pdf", ".db", ".zip", ".gz", ".tgz", ".ico", ".woff", ".woff2",
  ".docx", ".xlsx", ".pptx", ".pyc", ".pyo", ".ttf", ".otf", ".eot", ".wasm", ".7z", ".tar", ".mp3", ".wav", ".m4a", ".bin")

if (Test-Path -LiteralPath $StageRoot) { Remove-Item -LiteralPath $StageRoot -Recurse -Force }
New-Item -ItemType Directory -Path $StageRoot -Force | Out-Null

$rels = [System.IO.File]::ReadAllLines($FileList, (New-Object System.Text.UTF8Encoding($false))) | Where-Object { $_ -ne "" }
$count = 0
foreach ($rel in $rels) {
  $src = Join-Path $RepoRoot ($rel -replace '/', '\')
  if (-not (Test-Path -LiteralPath $src -PathType Leaf)) { throw "missing local file: $rel" }
  $dst = Join-Path $StageRoot ($rel -replace '/', '\')
  New-Item -ItemType Directory -Path (Split-Path -Parent $dst) -Force | Out-Null
  $ext = [System.IO.Path]::GetExtension($rel).ToLowerInvariant()
  if ($binaryExt -contains $ext) {
    Copy-Item -LiteralPath $src -Destination $dst -Force
  } else {
    $text = [System.IO.File]::ReadAllText($src)
    $text = $text -replace "`r`n", "`n" -replace "`r", "`n"
    $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText($dst, $text, $utf8NoBom)
  }
  $count++
}

if (Test-Path -LiteralPath $OutArchive) { Remove-Item -LiteralPath $OutArchive -Force }
# Note: Windows built-in tar.exe cannot convert non-ASCII paths from a list file (-T) to
# wchar_t, so archive the staged directory directly via -C <StageRoot> . instead.
# UTF-8 file names written by Windows unpack correctly on Linux.
Push-Location $StageRoot
try {
  & tar.exe -czf $OutArchive -C $StageRoot .
  if ($LASTEXITCODE -ne 0) { throw "tar failed with exit code $LASTEXITCODE" }
} finally {
  Pop-Location
}
Write-Output "packaged $count files -> $OutArchive"
