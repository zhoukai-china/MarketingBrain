param([string]$RepoRoot = "F:\思潼AI增长os\baolu-os-v2-source")
# 从 HEAD 的原始字节重建两个文档，只插入本任务自己的段落，保留原文件结尾字节，
# 以免把别人未提交的改动或纯 EOF 空白带进本次提交。
$ErrorActionPreference = "Stop"
$utf8 = New-Object System.Text.UTF8Encoding($false)

Push-Location $RepoRoot
try {
  $work = Join-Path $env:TEMP "qa013-assemble2"
  New-Item -ItemType Directory -Force -Path $work | Out-Null

  # ---- docs/BUG_REGRESSIONS.md ----
  $bugPath = "docs/BUG_REGRESSIONS.md"
  $bugRawFile = Join-Path $work "bug-raw.md"
  cmd /c "git show HEAD:$bugPath > `"$bugRawFile`""
  $bugRaw = [System.IO.File]::ReadAllText($bugRawFile, $utf8)
  $bugAnchor = "# Bug 回归台账`n"
  if (-not $bugRaw.StartsWith($bugAnchor)) { throw "BUG_REGRESSIONS 起始锚点不匹配" }
  $bugRest = $bugRaw.Substring($bugAnchor.Length)
  $bugSectionFile = Join-Path $RepoRoot "scripts/tmp/qa-013-section.md"
  $bugSection = ([System.IO.File]::ReadAllText($bugSectionFile, $utf8)).Replace("`r`n", "`n").TrimEnd("`n")
  $bugNew = $bugAnchor + "`n" + $bugSection + "`n`n" + $bugRest
  $bugOut = Join-Path $work "bug-new.md"
  [System.IO.File]::WriteAllText($bugOut, $bugNew, $utf8)
  $bugSha = (& git hash-object -w -- $bugOut).Trim()
  if ($LASTEXITCODE -ne 0) { throw "hash-object 失败 (BUG_REGRESSIONS)" }
  & git update-index --add --cacheinfo "100644,$bugSha,$bugPath"
  if ($LASTEXITCODE -ne 0) { throw "update-index 失败 (BUG_REGRESSIONS)" }
  Write-Output "BUG_REGRESSIONS blob=$bugSha"

  # ---- docs/CURRENT_DEPLOYMENT_STATUS.md ----
  $depPath = "docs/CURRENT_DEPLOYMENT_STATUS.md"
  $depRawFile = Join-Path $work "dep-raw.md"
  cmd /c "git show HEAD:$depPath > `"$depRawFile`""
  $depRaw = [System.IO.File]::ReadAllText($depRawFile, $utf8)
  $depAnchor = "# 当前部署状态`n"
  if (-not $depRaw.StartsWith($depAnchor)) { throw "CURRENT_DEPLOYMENT_STATUS 起始锚点不匹配" }
  $depRest = $depRaw.Substring($depAnchor.Length)
  $i1 = $depRest.IndexOf("`n")
  if ($i1 -lt 0) { throw "CURRENT_DEPLOYMENT_STATUS 结构不匹配（缺换行）" }
  $after = $depRest.Substring($i1 + 1)
  $i2 = $after.IndexOf("`n")
  if ($i2 -lt 0) { throw "CURRENT_DEPLOYMENT_STATUS 结构不匹配（缺更新时间行）" }
  if (-not $after.Substring(0, $i2).StartsWith("更新时间：")) { throw "CURRENT_DEPLOYMENT_STATUS 更新时间行不匹配" }
  $depTailRaw = $after.Substring($i2)
  $depSectionFile = Join-Path $RepoRoot "scripts/tmp/deploy-splash-section.md"
  $depSection = ([System.IO.File]::ReadAllText($depSectionFile, $utf8)).Replace("`r`n", "`n").TrimEnd("`n")
  $newUpdated = "更新时间：2026-09-11（最近一次为 **兰琪内测实例免登录中间页消除（QA-20260911-013）上测试实例，生产由同期 20260911-mobile-topbar-prod1 全量包带上**，见下方顶部条目；此前为工作区在途改动全量发布（PLAT-13 电脑端微信扫码登录等）、兰琪 LQ-19 顾问「来源」标签口径修复、WorkBuddy 报告核验后的 LQ-19 公域获客修复、微信登录失败路径修正、一次性验收租户回收、P0 身份头冒充修复、兰琪生产数据收尾与 LQ-19 首发布；2026-08-03 清单保留为当时状态）"
  $depNew = $depAnchor + "`n" + $newUpdated + "`n`n" + $depSection + "`n`n" + $depTailRaw
  $depOut = Join-Path $work "dep-new.md"
  [System.IO.File]::WriteAllText($depOut, $depNew, $utf8)
  $depSha = (& git hash-object -w -- $depOut).Trim()
  if ($LASTEXITCODE -ne 0) { throw "hash-object 失败 (CURRENT_DEPLOYMENT_STATUS)" }
  & git update-index --add --cacheinfo "100644,$depSha,$depPath"
  if ($LASTEXITCODE -ne 0) { throw "update-index 失败 (CURRENT_DEPLOYMENT_STATUS)" }
  Write-Output "CURRENT_DEPLOYMENT_STATUS blob=$depSha"
} finally {
  Pop-Location
}
