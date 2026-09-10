# 构建增量发布归档：文本文件统一 LF 化，二进制原样复制，保证 Linux 端逐字节可用。
# 用法: powershell -File scripts/tmp/build-release-archive.ps1 -RepoRoot <path> -FileList <path> -OutArchive <path> -StageRoot <path>
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
# 注意：Windows 自带 tar.exe 无法把含非 ASCII 路径的清单文件（-T）转换为 wchar_t，
# 必须改为 -C <StageRoot> . 直接归档目录内容；Windows 写出的 UTF-8 文件名在 Linux 侧解包正常。
Push-Location $StageRoot
try {
  & tar.exe -czf $OutArchive -C $StageRoot .
  if ($LASTEXITCODE -ne 0) { throw "tar failed with exit code $LASTEXITCODE" }
} finally {
  Pop-Location
}
Write-Output "packaged $count files -> $OutArchive"
