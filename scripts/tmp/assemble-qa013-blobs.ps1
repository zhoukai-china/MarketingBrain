param([string]$RepoRoot = "F:\思潼AI增长os\baolu-os-v2-source")
$ErrorActionPreference = "Stop"
$utf8 = New-Object System.Text.UTF8Encoding($false)
[Console]::OutputEncoding = $utf8
$OutputEncoding = $utf8

Push-Location $RepoRoot
try {
  # BUG_REGRESSIONS.md：在标题后插入本任务条目，只索引这一处改动。
  $bugPath = "docs/BUG_REGRESSIONS.md"
  $bugHead = ((& git show "HEAD:$bugPath") -join "`n")
  $bugSection = ([System.IO.File]::ReadAllText((Join-Path $RepoRoot "scripts/tmp/qa-013-section.md")) -replace "`r`n", "`n").TrimEnd("`n")
  $bugAnchor = "# Bug 回归台账`n"
  if (-not $bugHead.StartsWith($bugAnchor)) { throw "BUG_REGRESSIONS 起始锚点不匹配" }
  $bugNew = $bugHead.Substring(0, $bugAnchor.Length) + "`n" + $bugSection + "`n`n" + $bugHead.Substring($bugAnchor.Length)
  $bugTmp = Join-Path $env:TEMP "qa013-bug-regressions.md"
  [System.IO.File]::WriteAllText($bugTmp, $bugNew, $utf8)
  $bugSha = (& git hash-object -w -- $bugTmp).Trim()
  & git update-index --add --cacheinfo "100644,$bugSha,$bugPath"
  Write-Output "BUG_REGRESSIONS blob=$bugSha"

  # CURRENT_DEPLOYMENT_STATUS.md：替换「更新时间」行并在其后插入本轮发布条目。
  $depPath = "docs/CURRENT_DEPLOYMENT_STATUS.md"
  $depHead = ((& git show "HEAD:$depPath") -join "`n")
  $depLines = $depHead -split "`n"
  if ($depLines[0] -ne "# 当前部署状态" -or $depLines[1] -ne "" -or -not $depLines[2].StartsWith("更新时间：")) { throw "CURRENT_DEPLOYMENT_STATUS 头部结构不匹配" }
  $depSection = ([System.IO.File]::ReadAllText((Join-Path $RepoRoot "scripts/tmp/deploy-splash-section.md")) -replace "`r`n", "`n").TrimEnd("`n")
  $newUpdated = "更新时间：2026-09-11（最近一次为 **兰琪内测实例免登录中间页消除（QA-20260911-013）上测试实例，生产由同期 20260911-mobile-topbar-prod1 全量包带上**，见下方顶部条目；此前为工作区在途改动全量发布（PLAT-13 电脑端微信扫码登录等）、兰琪 LQ-19 顾问「来源」标签口径修复、WorkBuddy 报告核验后的 LQ-19 公域获客修复、微信登录失败路径修正、一次性验收租户回收、P0 身份头冒充修复、兰琪生产数据收尾与 LQ-19 首发布；2026-08-03 清单保留为当时状态）"
  $tail = ($depLines[3..($depLines.Length - 1)]) -join "`n"
  $depNew = "# 当前部署状态`n`n" + $newUpdated + "`n`n" + $depSection + "`n`n" + $tail
  $depTmp = Join-Path $env:TEMP "qa013-current-deployment-status.md"
  [System.IO.File]::WriteAllText($depTmp, $depNew, $utf8)
  $depSha = (& git hash-object -w -- $depTmp).Trim()
  & git update-index --add --cacheinfo "100644,$depSha,$depPath"
  Write-Output "CURRENT_DEPLOYMENT_STATUS blob=$depSha"
} finally {
  Pop-Location
}
