# 构建增量发布归档（带 override 目录）：文本统一 LF 化，二进制原样复制。
# 与 build-release-archive.ps1 的唯一区别：若 -OverrideDir 下存在同名相对路径，则从 override 目录取内容。
# 用途：把另一条任务尚未发布的本地改动挡在发布包外——那些文件改用服务器上已部署的版本。
# 用法: powershell -File scripts/tmp/build-release-archive-override.ps1 -RepoRoot <path> -FileList <path> -OutArchive <path> -StageRoot <path> -OverrideDir <path>
param(
  [Parameter(Mandatory=$true)][string]$RepoRoot,
  [Parameter(Mandatory=$true)][string]$FileList,
  [Parameter(Mandatory=$true)][string]$OutArchive,
  [Parameter(Mandatory=$true)][string]$StageRoot,
  [string]$OverrideDir = ""
)
$ErrorActionPreference = "Stop"
$RepoRoot = (Resolve-Path -LiteralPath $RepoRoot).Path
if ($OverrideDir -ne "") { $OverrideDir = (Resolve-Path -LiteralPath $OverrideDir).Path }
$binaryExt = @(".mp4", ".png", ".jpg", ".jpeg", ".gif", ".webp", ".pdf", ".db", ".zip", ".gz", ".tgz", ".ico", ".woff", ".woff2",
  ".docx", ".xlsx", ".pptx", ".pyc", ".pyo", ".ttf", ".otf", ".eot", ".wasm", ".7z", ".tar", ".mp3", ".wav", ".m4a", ".bin")

if (Test-Path -LiteralPath $StageRoot) { Remove-Item -LiteralPath $StageRoot -Recurse -Force }
New-Item -ItemType Directory -Path $StageRoot -Force | Out-Null

$rels = [System.IO.File]::ReadAllLines($FileList, (New-Object System.Text.UTF8Encoding($false))) | Where-Object { $_ -ne "" }
$count = 0
$overridden = @()
foreach ($rel in $rels) {
  $src = Join-Path $RepoRoot ($rel -replace '/', '\')
  if ($OverrideDir -ne "") {
    $alt = Join-Path $OverrideDir ($rel -replace '/', '\')
    if (Test-Path -LiteralPath $alt -PathType Leaf) { $src = $alt; $overridden += $rel }
  }
  if (-not (Test-Path -LiteralPath $src -PathType Leaf)) { throw "missing source file: $rel" }
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

Write-Output "overridden from OverrideDir: $($overridden.Count)"
foreach ($o in ($overridden | Sort-Object)) { Write-Output "  override: $o" }

if (Test-Path -LiteralPath $OutArchive) { Remove-Item -LiteralPath $OutArchive -Force }
Push-Location $StageRoot
try {
  & tar.exe -czf $OutArchive -C $StageRoot .
  if ($LASTEXITCODE -ne 0) { throw "tar failed with exit code $LASTEXITCODE" }
} finally {
  Pop-Location
}
Write-Output "packaged $count files -> $OutArchive"
