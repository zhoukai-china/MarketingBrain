# offline-source-freshness-regression.ps1
# 纯离线回归：验证「源码指纹 + 受控旧进程身份 + 安全重启 + fail-closed + 失败清理」。
# 不调用真实 Provider，不操作当前真实验收进程，全部使用 fixture/mock。

param(
  [switch]$KeepTemp
)

$ErrorActionPreference = "Stop"

$here = Split-Path -Parent $MyInvocation.MyCommand.Path
# 加载共享函数（-OfflineSelfTest 只加载函数，不执行主流程）
. (Join-Path $here "start.ps1") -OfflineSelfTest -AcceptanceRoot "unused"

# ---- 断言基础设施 ----
$script:Pass = 0
$script:Fail = 0
$script:Rows = New-Object System.Collections.Generic.List[object]

function Record([string]$Scenario, [string]$Result, [string]$Detail) {
  $script:Rows.Add([pscustomobject]@{ scenario = $Scenario; result = $Result; detail = $Detail })
  if ($Result -eq 'PASS') { $script:Pass++ } else { $script:Fail++ }
  Write-Output ("{0,-5} {1}" -f $Result, $Scenario)
}

function Assert-Equal([string]$Scenario, $Expected, $Actual) {
  if ($Expected -eq $Actual) { Record $Scenario 'PASS' "expected=$Expected actual=$Actual" }
  else { Record $Scenario 'FAIL' "expected=$Expected actual=$Actual" }
}

function Assert-True([string]$Scenario, [bool]$Condition, [string]$Detail = '') {
  if ($Condition) { Record $Scenario 'PASS' $Detail }
  else { Record $Scenario 'FAIL' $Detail }
}

function Assert-Throws([string]$Scenario, [scriptblock]$Body) {
  $thrown = $false
  try { & $Body | Out-Null } catch { $thrown = $true }
  Assert-True $Scenario $thrown 'expected an exception (fail-closed)'
}

# ---- fixture：含中文 + 空格的临时目录 ----
$fixtureRoot = Join-Path $env:TEMP ("beauty回归 测试 " + [guid]::NewGuid().ToString('N'))
$repo = Join-Path $fixtureRoot "源码 仓库"
$acc  = Join-Path $fixtureRoot "验收 环境"
$srcDirs = @(
  "apps/api/src",
  "packages/agent/src",
  "packages/shared/src",
  "packages/skills/src",
  "packages/skills/skills",
  "mcp-skills/skills"
)
foreach ($d in $srcDirs) {
  New-Item -ItemType Directory -Path (Join-Path $repo $d) -Force | Out-Null
}
New-Item -ItemType Directory -Path (Join-Path $acc "runtime") -Force | Out-Null

Set-Content -LiteralPath (Join-Path $repo "apps/api/src/server.ts") -Value 'export const api = 1;' -Encoding utf8
Set-Content -LiteralPath (Join-Path $repo "packages/agent/src/agent.ts") -Value 'export const agent = 1;' -Encoding utf8
Set-Content -LiteralPath (Join-Path $repo "packages/shared/src/shared.ts") -Value 'export const shared = 1;' -Encoding utf8
Set-Content -LiteralPath (Join-Path $repo "packages/skills/src/skill.ts") -Value 'export const skill = 1;' -Encoding utf8
Set-Content -LiteralPath (Join-Path $repo "packages/skills/skills/contract.json") -Value '{"version":"1.0.0"}' -Encoding utf8
Set-Content -LiteralPath (Join-Path $repo "mcp-skills/skills/SKILL.md") -Value 'version: 1.0.0' -Encoding utf8

Write-Output "fixture_repo=$repo"
Write-Output "fixture_acc=$acc"
Write-Output ""

# ---- mock 依赖 ----
$state = @{
  stopped = (New-Object System.Collections.Generic.List[int])
  cleaned = (New-Object System.Collections.Generic.List[int])
  probeN  = 0
}
$probeFalse = { return $false }
$probeTrue  = { return $true }
$probeFailThenOk = { $state.probeN++; return ($state.probeN -ne 1) }.GetNewClosure()
$starterOk   = { param($RepoRoot, $TsxPreflight, $WorkingDir, $Stdout, $Stderr) return [pscustomobject]@{ Id = 555 } }
$starterFail = { param($RepoRoot, $TsxPreflight, $WorkingDir, $Stdout, $Stderr) throw 'mock: cannot spawn process' }
$stopperMock  = { param([int]$ProcessId) $state.stopped.Add($ProcessId) }.GetNewClosure()
$cleanupMock  = { param([int]$ProcessId) $state.cleaned.Add($ProcessId) }.GetNewClosure()
$freshOk   = { return $true }

# ---- 进程对象（身份绑定当前 repo 的 tsx 路径） ----
$tsxPath = Join-Path $repo 'apps\api\node_modules\tsx\dist\cli.mjs'
$controlledListener = [pscustomobject]@{
  pid            = 100
  executablePath = 'C:\Program Files\nodejs\node.exe'
  commandLine    = '"C:\Program Files\nodejs\node.exe" "' + $tsxPath + '" src/server.ts'
}
$foreignListener = [pscustomobject]@{
  pid            = 200
  executablePath = 'C:\Windows\System32\svchost.exe'
  commandLine    = 'svchost.exe -k netsvcs'
}
$otherRepoTsx = 'D:\其他仓库\apps\api\node_modules\tsx\dist\cli.mjs'
$foreignSameMarker = [pscustomobject]@{
  pid            = 100
  executablePath = 'C:\Program Files\nodejs\node.exe'
  commandLine    = '"C:\Program Files\nodejs\node.exe" "' + $otherRepoTsx + '" src/server.ts'
}
$listenerReused = [pscustomobject]@{
  pid            = 300
  executablePath = 'C:\Program Files\nodejs\node.exe'
  commandLine    = '"C:\Program Files\nodejs\node.exe" "' + $tsxPath + '" src/server.ts'
}
$tsxPreflightPath = Join-Path $repo 'apps\api\node_modules\tsx\dist\preflight.cjs'
$directApiListener = [pscustomobject]@{
  pid            = 400
  executablePath = 'C:\Program Files\nodejs\node.exe'
  commandLine    = '"C:\Program Files\nodejs\node.exe" --require "' + $tsxPreflightPath + '" --import tsx src/server.ts'
}
$legacyParent = [pscustomobject]@{
  pid            = 500
  parentPid      = 1
  executablePath = 'C:\Program Files\nodejs\node.exe'
  commandLine    = '"C:\Program Files\nodejs\node.exe" "' + $tsxPath + '" src/server.ts'
}
$legacyChild = [pscustomobject]@{
  pid            = 501
  parentPid      = 500
  executablePath = 'C:\Program Files\nodejs\node.exe'
  commandLine    = '"C:\Program Files\nodejs\node.exe" --require "' + $tsxPreflightPath + '" --import loader.mjs src/server.ts'
}

# =====================================================================
# A. 先证明「旧逻辑」在"源码变化但 /ready 仍成功"时会错误复用
# =====================================================================
function Get-LegacyDecision([bool]$ApiReady) {
  if ($ApiReady) { return 'Reuse' } else { return 'StartNew' }
}

$fp1 = Get-SourceFingerprint -RepoRoot $repo
$legacy = Get-LegacyDecision -ApiReady $true
Assert-Equal "旧逻辑(仅检查/ready)：源码变化但 ready=ok 时的决策" 'Reuse' $legacy

# =====================================================================
# 1. 指纹可重复 / 幂等
# =====================================================================
$fpA = Get-SourceFingerprint -RepoRoot $repo
$fpB = Get-SourceFingerprint -RepoRoot $repo
Assert-Equal "指纹可重复（两次计算一致）" $fpA $fpB
Assert-True "单进程Node+TSX命令绑定当前仓库" (Test-ApiCommandIdentity -ExecutablePath $directApiListener.executablePath -CommandLine $directApiListener.commandLine -RepoRoot $repo -CommandMarker 'src/server.ts') "direct API identity must match"
Assert-True "历史TSX父子进程可被精确识别" (Test-LegacyApiPairIdentity -Parent $legacyParent -Child $legacyChild -RepoRoot $repo -ExpectedPreflightPath $tsxPreflightPath -CommandMarker 'src/server.ts') "legacy parent/child must be repo-bound"

# =====================================================================
# 2. 指纹反映源码变化
# =====================================================================
Set-Content -LiteralPath (Join-Path $repo "apps/api/src/server.ts") -Value 'export const api = 2; // changed' -Encoding utf8
$fp2 = Get-SourceFingerprint -RepoRoot $repo
Assert-True "指纹随源码变化而变化" ($fp1 -ne $fp2) "fp1=$fp1 fp2=$fp2"

$fpBeforeSkillAsset = $fp2
Set-Content -LiteralPath (Join-Path $repo "packages/skills/skills/contract.json") -Value '{"version":"1.0.1"}' -Encoding utf8
$fpAfterSkillAsset = Get-SourceFingerprint -RepoRoot $repo
Assert-True "指纹随正式 Skill 合同变化而变化" ($fpBeforeSkillAsset -ne $fpAfterSkillAsset) "before=$fpBeforeSkillAsset after=$fpAfterSkillAsset"
$fp2 = $fpAfterSkillAsset

$recMatch = [pscustomobject]@{ sourceFingerprint = $fp2; pid = 100; repoRoot = $repo; commandMarker = 'src/server.ts' }

# =====================================================================
# 3. 场景1：同一源码、正确 PID -> 复用
# =====================================================================
$d1 = Resolve-ApiStartDecision -SourceFingerprint $fp2 -Listener $controlledListener -Record $recMatch -PidFileValue 100 -RepoRoot $repo
Assert-Equal "场景1 同源码+正确PID -> Reuse" 'Reuse' $d1.action
$recControlledText = [pscustomobject]@{ sourceFingerprint = $fp2; pid = 100; repoRoot = $repo; commandMarker = 'src/server.ts'; textProviderMode = 'controlled_mock' }
$recConfiguredText = [pscustomobject]@{ sourceFingerprint = $fp2; pid = 100; repoRoot = $repo; commandMarker = 'src/server.ts'; textProviderMode = 'configured_provider' }
$d1ModeChanged = Resolve-ApiStartDecision -SourceFingerprint $fp2 -Listener $controlledListener -Record $recControlledText -PidFileValue 100 -RepoRoot $repo -DesiredTextProviderMode 'configured_provider'
Assert-Equal "场景1 文本模式由mock切正式 -> Restart" 'Restart' $d1ModeChanged.action
$d1ModeMatched = Resolve-ApiStartDecision -SourceFingerprint $fp2 -Listener $controlledListener -Record $recConfiguredText -PidFileValue 100 -RepoRoot $repo -DesiredTextProviderMode 'configured_provider'
Assert-Equal "场景1 正式文本模式一致 -> Reuse" 'Reuse' $d1ModeMatched.action
$recConfiguredTextSafeMedia = [pscustomobject]@{
  sourceFingerprint = $fp2
  pid = 100
  repoRoot = $repo
  commandMarker = 'src/server.ts'
  textProviderMode = 'configured_provider'
  runtimeProfile = 'safe_default'
}
$d1AcceptanceProfileChanged = Resolve-ApiStartDecision -SourceFingerprint $fp2 -Listener $controlledListener -Record $recConfiguredTextSafeMedia -PidFileValue 100 -RepoRoot $repo -DesiredTextProviderMode 'configured_provider' -DesiredRuntimeProfile 'xhs_user_acceptance_v1'
Assert-Equal "场景1 文本模式相同但XHS验收能力配置不同 -> Restart" 'Restart' $d1AcceptanceProfileChanged.action
Assert-Equal "场景1a 无持久验收标记 -> 安全默认" 'safe_default' (Resolve-AcceptanceRuntimeProfile -AcceptanceRoot $acc)
Set-Content -LiteralPath (Join-Path $acc '.xhs-user-acceptance-profile') -Value 'xhs_user_acceptance_v1' -Encoding utf8
Assert-Equal "场景1b 显式持久标记 -> XHS用户验收配置" 'xhs_user_acceptance_v1' (Resolve-AcceptanceRuntimeProfile -AcceptanceRoot $acc)
Set-Content -LiteralPath (Join-Path $acc '.xhs-user-acceptance-profile') -Value 'unknown_profile' -Encoding utf8
Assert-Throws "场景1c 未知持久标记 -> FailClosed" { Resolve-AcceptanceRuntimeProfile -AcceptanceRoot $acc }
Remove-Item -LiteralPath (Join-Path $acc '.xhs-user-acceptance-profile') -Force

# =====================================================================
# 4. 场景2：源码变化、受控旧 API -> 重启
# =====================================================================
$d2 = Resolve-ApiStartDecision -SourceFingerprint $fp1 -Listener $controlledListener -Record $recMatch -PidFileValue 100 -RepoRoot $repo
Assert-Equal "场景2 源码变化+受控旧API -> Restart" 'Restart' $d2.action
Assert-True "场景2 只停受控旧PID" ([int]$d2.stopPid -eq 100) "stopPid=$($d2.stopPid)"

# =====================================================================
# 5. 场景3：3016 被未知进程占用 -> 拒绝且不停止
# =====================================================================
$d3 = Resolve-ApiStartDecision -SourceFingerprint $fp2 -Listener $foreignListener -Record $null -PidFileValue 0 -RepoRoot $repo
Assert-Equal "场景3 未知进程占3016 -> FailClosed" 'FailClosed' $d3.action
Assert-True "场景3 不停止任何进程" ($null -eq $d3.stopPid) "stopPid=$($d3.stopPid)"

# =====================================================================
# 6. 场景4：PID 文件过期 -> 拒绝误杀
# =====================================================================
$d4 = Resolve-ApiStartDecision -SourceFingerprint $fp2 -Listener $controlledListener -Record $null -PidFileValue 999 -RepoRoot $repo
Assert-Equal "场景4 PID文件过期 -> FailClosed" 'FailClosed' $d4.action
Assert-True "场景4 不停止任何进程" ($null -eq $d4.stopPid) "stopPid=$($d4.stopPid)"

# =====================================================================
# 7. 场景5：PID 已被其他程序复用 -> 拒绝误杀
# =====================================================================
$d5 = Resolve-ApiStartDecision -SourceFingerprint $fp2 -Listener $listenerReused -Record $null -PidFileValue 100 -RepoRoot $repo
Assert-Equal "场景5 PID复用 -> FailClosed" 'FailClosed' $d5.action
Assert-True "场景5 不停止任何进程" ($null -eq $d5.stopPid) "stopPid=$($d5.stopPid)"

# =====================================================================
# 8. 场景6：API 启动失败 / 超时 -> 明确失败（fail-closed）
# =====================================================================
Assert-True "场景6a /ready 超时 -> Wait-ApiReady 返回 false" (-not (Wait-ApiReady -Probe $probeFalse -TimeoutSec 1 -PollMs 100)) "Wait-ApiReady=false"

Assert-Throws "场景6a 超时 -> Start-ApiAndWait 明确失败" {
  Start-ApiAndWait -AcceptanceRoot $acc -RepoRoot $repo -NodeExe "C:\Program Files\nodejs\node.exe" -SourceFingerprint $fp2 -CommandMarker 'src/server.ts' -Probe $probeFalse -ProcessStarter $starterOk -CleanupProcess $cleanupMock -FreshnessCheck $freshOk -ReadyTimeoutSec 1 -ReadyPollMs 50
}

Assert-Throws "场景6b 启动失败 -> 明确失败" {
  Start-ApiAndWait -AcceptanceRoot $acc -RepoRoot $repo -NodeExe "C:\Program Files\nodejs\node.exe" -SourceFingerprint $fp2 -CommandMarker 'src/server.ts' -Probe $probeTrue -ProcessStarter $starterFail -CleanupProcess $cleanupMock -FreshnessCheck $freshOk -ReadyTimeoutSec 1 -ReadyPollMs 50
}

# =====================================================================
# 9. 场景7：新进程 /ready 成功但源码指纹不一致 -> 验收失败
# =====================================================================
$recStale = [pscustomobject]@{ sourceFingerprint = 'DEADBEEF00000000'; pid = 100; commandMarker = 'src/server.ts' }
$fresh7 = Test-SourceFresh -CurrentFingerprint $fp2 -Record $recStale -ListenerPid 100
Assert-True "场景7 /ready成功但指纹不一致 -> 不报告可用" (-not $fresh7.fresh) "reason=$($fresh7.reason)"

# =====================================================================
# 10. 场景8：路径含中文和空格 -> 正常
# =====================================================================
$rec8 = [ordered]@{ sourceFingerprint = $fp2; pid = 100; startedAt = (Get-Date).ToString('o'); repoRoot = $repo; commandMarker = 'src/server.ts' }
Write-RuntimeRecord -RuntimeDir (Join-Path $acc "runtime") -Name "api.runtime.json" -Record $rec8
$read8 = Read-RuntimeRecord -RuntimeDir (Join-Path $acc "runtime") -Name "api.runtime.json"
Assert-True "场景8 中文+空格路径 记录读写正常" ($null -ne $read8 -and ([string]$read8.sourceFingerprint) -eq $fp2) "fingerprint roundtrip ok"
Assert-True "场景8 记录不含环境变量/密钥" (-not ([string]$read8 | Select-String -Pattern 'JWT|DATABASE_URL|SECRET|KEY' -Quiet)) "no secret keys in record"

# =====================================================================
# 11. 场景9：重复执行幂等
# =====================================================================
$d9a = Resolve-ApiStartDecision -SourceFingerprint $fp2 -Listener $controlledListener -Record $recMatch -PidFileValue 100 -RepoRoot $repo
$d9b = Resolve-ApiStartDecision -SourceFingerprint $fp2 -Listener $controlledListener -Record $recMatch -PidFileValue 100 -RepoRoot $repo
Assert-True "场景9 决策幂等（同输入同输出）" ($d9a.action -eq $d9b.action) "action=$($d9a.action)"
$fp9a = Get-SourceFingerprint -RepoRoot $repo
$fp9b = Get-SourceFingerprint -RepoRoot $repo
Assert-True "场景9 指纹幂等" ($fp9a -eq $fp9b) "fp=$fp9a"

# =====================================================================
# 新增 N1-N6（Codex 修订要求）
# =====================================================================

# N1：同 PID、同 src/server.ts、不同仓库路径 -> FailClosed，不停止
$dN1 = Resolve-ApiStartDecision -SourceFingerprint $fp2 -Listener $foreignSameMarker -Record $null -PidFileValue 100 -RepoRoot $repo
Assert-Equal "N1 同PID同marker异仓库 -> FailClosed" 'FailClosed' $dN1.action
Assert-True "N1 不停止任何进程" ($null -eq $dN1.stopPid) "stopPid=$($dN1.stopPid)"

# N2：runtime record 的 repoRoot 不一致 -> FailClosed
$recOtherRepo = [pscustomobject]@{ sourceFingerprint = $fp2; pid = 100; repoRoot = 'D:\其他仓库'; commandMarker = 'src/server.ts' }
$dN2 = Resolve-ApiStartDecision -SourceFingerprint $fp2 -Listener $controlledListener -Record $recOtherRepo -PidFileValue 100 -RepoRoot $repo
Assert-Equal "N2 record repoRoot 不一致 -> FailClosed" 'FailClosed' $dN2.action
Assert-True "N2 不停止任何进程" ($null -eq $dN2.stopPid) "stopPid=$($dN2.stopPid)"

# N3：指纹一致但 /ready=false -> 不得 Reuse；最多一次受控重启
$state.probeN = 0
$state.stopped.Clear()
$rN3 = Invoke-ApiStart -AcceptanceRoot $acc -RepoRoot $repo -NodeExe "C:\Program Files\nodejs\node.exe" -SourceFingerprint $fp2 -Listener $controlledListener -Record $recMatch -PidFileValue 100 -CommandMarker 'src/server.ts' -ReadyProbe $probeFailThenOk -ProcessStarter $starterOk -ProcessStopper $stopperMock -CleanupProcess $cleanupMock -FreshnessCheck $freshOk -ReadyTimeoutSec 1 -ReadyPollMs 50
Assert-Equal "N3 指纹一致但ready=false -> restart_after_reuse_fail" 'restart_after_reuse_fail' $rN3.outcome
Assert-True "N3 受控停止被调用一次(pid=100)" ($state.stopped.Count -eq 1 -and $state.stopped[0] -eq 100) "stopped=$($state.stopped.Count)"

# N4：受控重启后仍不 ready -> 非零失败
$recStaleFp = [pscustomobject]@{ sourceFingerprint = 'OLD'; pid = 100; repoRoot = $repo; commandMarker = 'src/server.ts' }
Assert-Throws "N4 受控重启后仍不ready -> 非零失败" {
  Invoke-ApiStart -AcceptanceRoot $acc -RepoRoot $repo -NodeExe "C:\Program Files\nodejs\node.exe" -SourceFingerprint $fp2 -Listener $controlledListener -Record $recStaleFp -PidFileValue 100 -CommandMarker 'src/server.ts' -ReadyProbe $probeFalse -ProcessStarter $starterOk -ProcessStopper $stopperMock -CleanupProcess $cleanupMock -FreshnessCheck $freshOk -ReadyTimeoutSec 1 -ReadyPollMs 50
}

# N5：启动后超时 -> 只清理本次新进程、PID 文件和 runtime record
Remove-Item -LiteralPath (Join-Path $acc 'runtime\api.pid') -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath (Join-Path $acc 'runtime\api.runtime.json') -Force -ErrorAction SilentlyContinue
$state.cleaned.Clear()
Assert-Throws "N5 启动后超时 -> 明确失败" {
  Start-ApiAndWait -AcceptanceRoot $acc -RepoRoot $repo -NodeExe "C:\Program Files\nodejs\node.exe" -SourceFingerprint $fp2 -CommandMarker 'src/server.ts' -Probe $probeFalse -ProcessStarter $starterOk -CleanupProcess $cleanupMock -FreshnessCheck $freshOk -ReadyTimeoutSec 1 -ReadyPollMs 50
}
Assert-True "N5 仅清理本次新进程(pid=555)" ($state.cleaned.Count -eq 1 -and $state.cleaned[0] -eq 555) "cleaned=$($state.cleaned.Count)"
Assert-True "N5 PID 文件已删除" (-not (Test-Path -LiteralPath (Join-Path $acc 'runtime\api.pid'))) "api.pid removed"
Assert-True "N5 runtime record 已删除" (-not (Test-Path -LiteralPath (Join-Path $acc 'runtime\api.runtime.json'))) "api.runtime.json removed"

# N6：主流程最终等待耗尽 -> 不得以成功退出
Assert-Throws "N6 API等待耗尽 -> 非零失败" {
  Wait-ApiAndWebReady -ApiProbe $probeFalse -MaxAttempts 2 -PollMs 10
}
Assert-Throws "N6 Web等待耗尽 -> 非零失败" {
  Wait-ApiAndWebReady -ApiProbe { return $true } -WebProbe { return $false } -MaxAttempts 2 -PollMs 10
}

# =====================================================================
# 第二轮新增 R1-R7（Codex 第二轮修订要求）
# =====================================================================

$vitePath = Join-Path $repo 'apps\web\node_modules\vite\bin\vite.js'
$webListener = [pscustomobject]@{
  pid            = 200
  executablePath = 'C:\Program Files\nodejs\node.exe'
  commandLine    = '"C:\Program Files\nodejs\node.exe" "' + $vitePath + '" --host 127.0.0.1 --port 5176'
}
$otherVite = 'D:\其他仓库\apps\web\node_modules\vite\bin\vite.js'
$foreignWebListener = [pscustomobject]@{
  pid            = 200
  executablePath = 'C:\Program Files\nodejs\node.exe'
  commandLine    = '"C:\Program Files\nodejs\node.exe" "' + $otherVite + '" --port 5176'
}
$recApi = [pscustomobject]@{ sourceFingerprint = $fp2; pid = 100; repoRoot = $repo; commandMarker = 'src/server.ts' }

# R1：stop 遇同 PID、同 src/server.ts、异 repoRoot 的 API -> FailClosed，停止 0
$state.stopped.Clear()
Assert-Throws "R1 stop异仓库API -> FailClosed" {
  Invoke-StopAll -AcceptanceRoot $acc -RepoRoot $repo -CommandMarker 'src/server.ts' -ApiListener $foreignSameMarker -ApiPidFileProc $null -ApiPidFileValue 100 -ApiRecord $null -WebListener $null -WebPidFileProc $null -WebPidFileValue 0 -ProcessStopper $stopperMock
}
Assert-True "R1 停止次数0" ($state.stopped.Count -eq 0) "stopped=$($state.stopped.Count)"

# R2：stop 遇异 repoRoot 的 Vite listener -> FailClosed，停止 0
$state.stopped.Clear()
Assert-Throws "R2 stop异仓库Vite -> FailClosed" {
  Invoke-StopAll -AcceptanceRoot $acc -RepoRoot $repo -CommandMarker 'src/server.ts' -ApiListener $null -ApiPidFileProc $null -ApiPidFileValue 0 -ApiRecord $null -WebListener $foreignWebListener -WebPidFileProc $null -WebPidFileValue 200 -ProcessStopper $stopperMock
}
Assert-True "R2 停止次数0" ($state.stopped.Count -eq 0) "stopped=$($state.stopped.Count)"

# R3：API record repoRoot / marker / PID 任一不一致 -> FailClosed，停止 0
$recBadRepo = [pscustomobject]@{ sourceFingerprint = $fp2; pid = 100; repoRoot = 'D:\其他仓库'; commandMarker = 'src/server.ts' }
$state.stopped.Clear()
Assert-Throws "R3a record repoRoot不一致 -> FailClosed" {
  Invoke-StopAll -AcceptanceRoot $acc -RepoRoot $repo -CommandMarker 'src/server.ts' -ApiListener $controlledListener -ApiPidFileProc $null -ApiPidFileValue 100 -ApiRecord $recBadRepo -WebListener $null -WebPidFileProc $null -WebPidFileValue 0 -ProcessStopper $stopperMock
}
Assert-True "R3a 停止次数0" ($state.stopped.Count -eq 0) "stopped=$($state.stopped.Count)"

$recBadMarker = [pscustomobject]@{ sourceFingerprint = $fp2; pid = 100; repoRoot = $repo; commandMarker = 'other.ts' }
$state.stopped.Clear()
Assert-Throws "R3b record marker不一致 -> FailClosed" {
  Invoke-StopAll -AcceptanceRoot $acc -RepoRoot $repo -CommandMarker 'src/server.ts' -ApiListener $controlledListener -ApiPidFileProc $null -ApiPidFileValue 100 -ApiRecord $recBadMarker -WebListener $null -WebPidFileProc $null -WebPidFileValue 0 -ProcessStopper $stopperMock
}
Assert-True "R3b 停止次数0" ($state.stopped.Count -eq 0) "stopped=$($state.stopped.Count)"

$recBadPid = [pscustomobject]@{ sourceFingerprint = $fp2; pid = 999; repoRoot = $repo; commandMarker = 'src/server.ts' }
$state.stopped.Clear()
Assert-Throws "R3c record PID不一致 -> FailClosed" {
  Invoke-StopAll -AcceptanceRoot $acc -RepoRoot $repo -CommandMarker 'src/server.ts' -ApiListener $controlledListener -ApiPidFileProc $null -ApiPidFileValue 100 -ApiRecord $recBadPid -WebListener $null -WebPidFileProc $null -WebPidFileValue 0 -ProcessStopper $stopperMock
}
Assert-True "R3c 停止次数0" ($state.stopped.Count -eq 0) "stopped=$($state.stopped.Count)"

# R4：status record repoRoot 不一致 -> source_fresh=false
$f4 = Resolve-SourceFreshness -SourceFingerprint $fp2 -Record $recBadRepo -Listener $controlledListener -PidFileValue 100 -ApiReady $true -RepoRoot $repo -CommandMarker 'src/server.ts'
Assert-True "R4 record repoRoot不一致 -> fresh=false" (-not $f4.fresh) "reason=$($f4.reason)"

# R5：status listener 身份不匹配 -> source_fresh=false
$f5 = Resolve-SourceFreshness -SourceFingerprint $fp2 -Record $recApi -Listener $foreignSameMarker -PidFileValue 100 -ApiReady $true -RepoRoot $repo -CommandMarker 'src/server.ts'
Assert-True "R5 listener身份不匹配 -> fresh=false" (-not $f5.fresh) "reason=$($f5.reason)"

# R6：status PID 文件与 listener 不一致 -> source_fresh=false
$f6 = Resolve-SourceFreshness -SourceFingerprint $fp2 -Record $recApi -Listener $controlledListener -PidFileValue 999 -ApiReady $true -RepoRoot $repo -CommandMarker 'src/server.ts'
Assert-True "R6 pid文件vs listener不一致 -> fresh=false" (-not $f6.fresh) "reason=$($f6.reason)"

# R7：正常受控 API/Web -> 仅停止两个精确受控 PID 并清理文件
$runtimeDir = Join-Path $acc 'runtime'
Set-Content -LiteralPath (Join-Path $runtimeDir 'api.pid') -Value '100' -Encoding ascii
Set-Content -LiteralPath (Join-Path $runtimeDir 'web.pid') -Value '200' -Encoding ascii
$recApiWrite = [ordered]@{ sourceFingerprint = $fp2; pid = 100; startedAt = (Get-Date).ToString('o'); repoRoot = $repo; commandMarker = 'src/server.ts' }
Write-RuntimeRecord -RuntimeDir $runtimeDir -Name 'api.runtime.json' -Record $recApiWrite
$state.stopped.Clear()
$stableIdentityResolver = {
  param([int]$ProcessId)
  if ($ProcessId -eq 100) { return $controlledListener }
  if ($ProcessId -eq 200) { return $webListener }
  return $null
}
$stopList = Invoke-StopAll -AcceptanceRoot $acc -RepoRoot $repo -CommandMarker 'src/server.ts' -ApiListener $controlledListener -ApiPidFileProc $null -ApiPidFileValue 100 -ApiRecord $recApi -WebListener $webListener -WebPidFileProc $null -WebPidFileValue 200 -ProcessStopper $stopperMock -ProcessIdentityResolver $stableIdentityResolver
Assert-True "R7 仅停止两个精确受控PID" ($state.stopped.Count -eq 2 -and $state.stopped[0] -eq 100 -and $state.stopped[1] -eq 200) "stopped=$($state.stopped -join ',')"
Assert-True "R7 api.pid 已清理" (-not (Test-Path -LiteralPath (Join-Path $runtimeDir 'api.pid'))) "api.pid removed"
Assert-True "R7 web.pid 已清理" (-not (Test-Path -LiteralPath (Join-Path $runtimeDir 'web.pid'))) "web.pid removed"
Assert-True "R7 api.runtime.json 已清理" (-not (Test-Path -LiteralPath (Join-Path $runtimeDir 'api.runtime.json'))) "record removed"

# R8：决策通过后、实际 Stop-Process 前 PID 被复用 -> 再次 FailClosed，停止 0
$state.stopped.Clear()
$state.identityCalls = 0
$flipIdentityResolver = {
  param([int]$ProcessId)
  $state.identityCalls++
  if ($state.identityCalls -eq 1) { return $controlledListener }
  return $foreignSameMarker
}
$r8Error = ''
try {
  Invoke-StopAll -AcceptanceRoot $acc -RepoRoot $repo -CommandMarker 'src/server.ts' -ApiListener $controlledListener -ApiPidFileProc $null -ApiPidFileValue 100 -ApiRecord $recApi -WebListener $null -WebPidFileProc $null -WebPidFileValue 0 -ProcessStopper $stopperMock -ProcessIdentityResolver $flipIdentityResolver
} catch {
  $r8Error = $_.Exception.Message
}
Assert-True "R8 Stop-Process前PID复用 -> FailClosed且停止0" ($r8Error -like '*identity changed before stop*' -and $state.stopped.Count -eq 0 -and $state.identityCalls -eq 2) "error=$r8Error stopped=$($state.stopped.Count) identityCalls=$($state.identityCalls)"

# =====================================================================
# 汇总
# =====================================================================
Write-Output ""
Write-Output "========================================"
Write-Output ("TOTAL: PASS={0} FAIL={1}" -f $script:Pass, $script:Fail)
Write-Output "========================================"

# 清理临时目录
if (-not $KeepTemp) {
  Remove-Item -LiteralPath $fixtureRoot -Recurse -Force -ErrorAction SilentlyContinue
}

if ($script:Fail -gt 0) { exit 1 } else { exit 0 }
