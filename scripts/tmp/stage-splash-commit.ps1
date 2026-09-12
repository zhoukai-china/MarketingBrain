param([string]$RepoRoot = "F:\思潼AI增长os\baolu-os-v2-source")
# 只把「兰琪内测中间页消除（QA-20260911-013）」这一条工作线的改动放进暂存区。
# main.tsx / package.json 的工作区里混着别的工作线（PLAT-13 微信扫码登录、平台首页
# /market→/agents 更名、移动端 device 判定），因此按 hunk 白名单筛选后再 --cached
# 应用，避免把别人的半成品和它依赖的未跟踪文件一起提交。
$ErrorActionPreference = "Stop"
$utf8 = New-Object System.Text.UTF8Encoding($false)

Push-Location $RepoRoot
try {
  $work = Join-Path $env:TEMP "qa013-stage"
  New-Item -ItemType Directory -Force -Path $work | Out-Null

  function Select-Hunks {
    param([string]$Path, [string[]]$KeepHeaders, [string]$Tag)
    $rawFile = Join-Path $work "$Tag.raw.patch"
    cmd /c "git diff -- `"$Path`" > `"$rawFile`""
    $text = [System.IO.File]::ReadAllText($rawFile, $utf8)
    $lines = $text -split "`n"
    $out = New-Object System.Collections.Generic.List[string]
    $keep = $false
    $seenHunk = $false
    foreach ($line in $lines) {
      if ($line.StartsWith("@@")) {
        $seenHunk = $true
        $keep = $false
        foreach ($h in $KeepHeaders) { if ($line.StartsWith($h)) { $keep = $true } }
      }
      if ((-not $seenHunk) -or $keep) { $out.Add($line) }
    }
    $patchFile = Join-Path $work "$Tag.filtered.patch"
    $body = ($out -join "`n")
    if (-not $body.EndsWith("`n")) { $body += "`n" }
    [System.IO.File]::WriteAllText($patchFile, $body, $utf8)
    return $patchFile
  }

  # ---- apps/web/src/main.tsx ----
  $mainPatch = Select-Hunks -Path "apps/web/src/main.tsx" -Tag "main" -KeepHeaders @(
    "@@ -1,9 +1,13 @@",
    "@@ -239,11 +275,19 @@",
    "@@ -251,11 +295,31 @@"
  )
  & git apply --cached --whitespace=nowarn -- $mainPatch
  if ($LASTEXITCODE -ne 0) { throw "main.tsx hunk 应用失败" }

  # ---- package.json ----（qa:fast 那一行同时被别的工作线改过，这里手工去掉他们那段）
  $pkgPatch = Select-Hunks -Path "package.json" -Tag "pkg" -KeepHeaders @("@@ -80,10 +87,12 @@")
  $pkgText = [System.IO.File]::ReadAllText($pkgPatch, $utf8)
  $needle = ' && pnpm auth:wechat-login-bridge-smoke'
  if (-not $pkgText.Contains($needle)) { throw "package.json 白名单 hunk 里没找到预期的 qa:fast 行" }
  $pkgText = $pkgText.Replace($needle, "")
  [System.IO.File]::WriteAllText($pkgPatch, $pkgText, $utf8)
  & git apply --cached --whitespace=nowarn -- $pkgPatch
  if ($LASTEXITCODE -ne 0) { throw "package.json hunk 应用失败" }

  Write-Output "hunks staged"
} finally {
  Pop-Location
}
