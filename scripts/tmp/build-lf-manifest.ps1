# 生成「LF 归一化」SHA256 清单，用于和 Linux 服务器上的工作树逐文件比对。
# 用法： powershell -File scripts/tmp/build-lf-manifest.ps1 -RepoRoot <path> -OutFile <path> [-PathListFile <path>]
param(
  [Parameter(Mandatory=$true)][string]$RepoRoot,
  [Parameter(Mandatory=$true)][string]$OutFile,
  [string]$PathListFile = ""
)

$ErrorActionPreference = "Stop"
$RepoRoot = (Resolve-Path -LiteralPath $RepoRoot).Path

function Get-RelativeFiles {
  param([string]$Root)
  $patterns = @(
    "apps/api/src",
    "apps/web/src",
    "apps/api/scripts",
    "packages/*/src",
    "packages/db/prisma",
    "mcp-skills/skills",
    "scripts"
  )
  $files = New-Object System.Collections.Generic.List[string]
  foreach ($p in $patterns) {
    $full = Join-Path $Root $p
    if (Test-Path -LiteralPath $full) {
      Get-ChildItem -LiteralPath $full -Recurse -File | ForEach-Object { $files.Add($_) }
    }
  }
  foreach ($single in @("apps/web/index.html","apps/web/vite.config.ts","apps/web/package.json","package.json","pnpm-workspace.yaml","pnpm-lock.yaml","tsconfig.base.json")) {
    $full = Join-Path $Root $single
    if (Test-Path -LiteralPath $full) { $files.Add((Get-Item -LiteralPath $full)) }
  }
  return $files
}

function Get-LfSha {
  param([string]$Path)
  $bytes = [System.IO.File]::ReadAllBytes($Path)
  $out = New-Object System.Collections.Generic.List[byte]
  for ($i = 0; $i -lt $bytes.Length; $i++) {
    if ($bytes[$i] -eq 13 -and ($i + 1) -lt $bytes.Length -and $bytes[$i + 1] -eq 10) { continue }
    $out.Add($bytes[$i])
  }
  $sha = [System.Security.Cryptography.SHA256]::Create()
  $hash = $sha.ComputeHash($out.ToArray())
  return ([System.BitConverter]::ToString($hash) -replace '-', '').ToLowerInvariant()
}

$lines = New-Object System.Collections.Generic.List[string]
if ($PathListFile -ne "" -and (Test-Path -LiteralPath $PathListFile)) {
  $relPaths = Get-Content -LiteralPath $PathListFile | Where-Object { $_ -ne "" }
  $items = foreach ($rel in $relPaths) {
    $full = Join-Path $RepoRoot ($rel -replace '/', '\')
    if (Test-Path -LiteralPath $full -PathType Leaf) { [PSCustomObject]@{ Rel = $rel; Full = $full } }
    else { [PSCustomObject]@{ Rel = $rel; Full = $null } }
  }
} else {
  $items = Get-RelativeFiles -Root $RepoRoot | ForEach-Object {
    $rel = $_.FullName.Substring($RepoRoot.Length + 1) -replace '\\', '/'
    [PSCustomObject]@{ Rel = $rel; Full = $_.FullName }
  }
}

foreach ($it in ($items | Sort-Object Rel)) {
  if ($null -eq $it.Full) { $lines.Add("MISSING_LOCAL  $($it.Rel)"); continue }
  $lines.Add("$(Get-LfSha -Path $it.Full)  $($it.Rel)")
}

$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($OutFile, (($lines -join "`n") + "`n"), $utf8NoBom)
Write-Output "manifest entries: $($lines.Count) -> $OutFile"
