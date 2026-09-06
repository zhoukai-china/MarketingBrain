param(
  [string]$WebBaseUrl = $env:SITONG_WEB_BASE_URL,
  [string]$ApiBaseUrl = $env:SITONG_API_BASE_URL,
  [ValidateSet("franchise", "store_visit", "student", "partner")]
  [string]$Target = "franchise",
  [int]$TimeoutSec = 120,
  [string]$EvidenceDirectory = (Join-Path $env:TEMP "sitong-fip-content-e2e")
)

$ErrorActionPreference = "Stop"
if (-not $WebBaseUrl -or -not $ApiBaseUrl) { throw "SITONG_WEB_BASE_URL and SITONG_API_BASE_URL are required." }

function Assert-LocalHttpUrl([string]$Value, [string]$Name) {
  $uri = [Uri]$Value
  if ($uri.Scheme -ne "http" -or $uri.Host -notin @("127.0.0.1", "localhost")) { throw "$Name must be a local HTTP URL." }
  return $uri
}

function Invoke-FipJson([string]$Method, [string]$Path, [hashtable]$Headers = @{}, [object]$Body = $null) {
  $parameters = @{ Uri = "$($script:ApiOrigin)$Path"; Method = $Method; Headers = $Headers; TimeoutSec = $TimeoutSec }
  if ($null -ne $Body) { $parameters.ContentType = "application/json"; $parameters.Body = ($Body | ConvertTo-Json -Depth 10 -Compress) }
  return Invoke-RestMethod @parameters
}

function Get-FipStatus([string]$Path, [hashtable]$Headers) {
  try {
    $response = Invoke-WebRequest -UseBasicParsing -Uri "$($script:ApiOrigin)$Path" -Method GET -Headers $Headers -TimeoutSec $TimeoutSec
    return [int]$response.StatusCode
  } catch {
    if ($_.Exception.Response -and $_.Exception.Response.StatusCode) { return [int]$_.Exception.Response.StatusCode }
    throw
  }
}

function Invoke-Bsk([string[]]$Arguments) {
  $output = & bsk @Arguments 2>&1 | Out-String
  if ($LASTEXITCODE -ne 0) { throw "bsk failed: $($Arguments[0])`n$output" }
  return $output
}

function Assert-SnapshotContains([string]$Snapshot, [string]$Expected, [string]$Message) {
  if (-not $Snapshot.Contains($Expected)) { throw $Message }
}

function Assert-SnapshotNotContains([string]$Snapshot, [string]$Unexpected, [string]$Message) {
  if ($Snapshot.Contains($Unexpected)) { throw $Message }
}

$webUri = Assert-LocalHttpUrl $WebBaseUrl "WebBaseUrl"
$apiUri = Assert-LocalHttpUrl $ApiBaseUrl "ApiBaseUrl"
$script:ApiOrigin = $apiUri.GetLeftPart([UriPartial]::Authority)
$webOrigin = $webUri.GetLeftPart([UriPartial]::Authority)

if (-not (Get-Command bsk -ErrorAction SilentlyContinue)) { throw "browser-skill CLI bsk is unavailable." }
Invoke-Bsk @("status", "--json") | Out-Null

$ready = Invoke-FipJson "GET" "/ready"
if (-not $ready.ok -or $ready.dataMode -ne "database") { throw "FIP browser E2E requires a ready database-mode API." }

$case = switch ($Target) {
  "franchise" { @{ identity = "餐饮品牌创始人"; customer = "有餐饮经验的创业者"; goal = "获取加盟咨询"; topic = "加盟前先核对哪三个经营条件"; evidence = "创始人已确认：加盟条件需沟通确认"; relation = "帮助创业者先判断是否值得发起加盟咨询"; cta = "如需判断是否适合，请发起加盟咨询并申请条件评估。" } }
  "store_visit" { @{ identity = "社区餐饮主理人"; customer = "周边午晚餐消费者"; goal = "促进团购到店"; topic = "午休只有30分钟，怎样选到不踩雷的工作日套餐"; evidence = "录音确认：套餐与到店时间待门店复核"; relation = "引导附近消费者先查看团购并预约到店"; cta = "请先查看团购并预约到店，具体时间待确认。" } }
  "student" { @{ identity = "皮肤管理培训创始人"; customer = "计划转行的初学者"; goal = "获取课程咨询"; topic = "报名前先确认自己缺的不是一个证书"; evidence = "创始人已确认：课程适用条件需咨询判断"; relation = "让目标学员先咨询课程是否适合自己"; cta = "请先发起课程咨询，确认试听与报名条件。" } }
  "partner" { @{ identity = "区域联营项目负责人"; customer = "本地渠道合作伙伴"; goal = "获取合作意向"; topic = "先把双方要投入的资源讲清，合作才不会卡在第一步"; evidence = "项目负责人确认：合作条件需资格判断"; relation = "引导渠道伙伴提交合作意向并进入资格判断"; cta = "请提交合作意向，再进入资格判断与方案沟通。" } }
}

# Create tenant-scoped desensitized fixtures. The accepted draft is patched directly;
# the empty draft is reserved for browser-controlled failure/cancellation. This
# script never sends a /generate request to the API.
$login = Invoke-FipJson "POST" "/auth/dev-login" @{} @{ tenantRole = "personal_ip"; tenantName = "FIP页面验收-$Target"; planCode = "ip_standard"; industry = "创始人IP获客" }
if (-not $login.token) { throw "dev-login did not return a scoped token." }
$authHeaders = @{ Authorization = "Bearer $($login.token)" }
$subject = Invoke-FipJson "POST" "/knowledge-base/subjects" $authHeaders @{ subjectType = "ip"; name = "FIP页面验收主体-$Target"; industry = "创始人IP获客" }
$subjectId = $subject.subject.id
Invoke-FipJson "PUT" "/agents/acquisition/founder-ip-goal-briefs" $authHeaders @{ subjectId = $subjectId; target = $Target; identity = $case.identity; targetCustomer = $case.customer; acquisitionGoal = $case.goal; offer = "已确认条件需在咨询中说明"; accountStage = "稳定更新期"; industry = "创始人IP获客"; benchmarkAccounts = @() } | Out-Null
$draftInput = @{ subjectId = $subjectId; target = $Target; topic = $case.topic; audience = $case.customer; sourceEvidence = $case.evidence; factBoundary = "案例、数字、价格和政策待核验，不得写成事实"; goalRelation = $case.relation }
$acceptedDraft = Invoke-FipJson "POST" "/agents/acquisition/founder-ip-content-drafts" $authHeaders $draftInput
$draftId = $acceptedDraft.draft.id
$fixtureContent = @"
# $($case.topic)

目标人群：$($case.customer)

获客目标简报：$($case.customer)；$($case.goal)

来源依据：$($case.evidence)

与获客目标的关系：$($case.relation)

## 开场钩子
$($case.topic)？先别急着下结论，只核对已经确认的经营条件。

## 核心观点
面向$($case.customer)，先说明可确认条件，再把案例、数字、价格和政策保持待确认，不把待核验信息写成事实。

## 承接动作
$($case.cta)
"@
Invoke-FipJson "PATCH" "/agents/acquisition/founder-ip-content-drafts/$draftId" $authHeaders @{ content = $fixtureContent } | Out-Null
$emptyDraft = Invoke-FipJson "POST" "/agents/acquisition/founder-ip-content-drafts" $authHeaders $draftInput
$emptyDraftId = $emptyDraft.draft.id

$foreign = Invoke-FipJson "POST" "/auth/dev-login" @{} @{ tenantRole = "personal_ip"; tenantName = "FIP页面隔离租户"; planCode = "ip_standard"; industry = "创始人IP获客" }
$foreignHeaders = @{ Authorization = "Bearer $($foreign.token)" }
if ((Get-FipStatus "/agents/acquisition/founder-ip-content-drafts/$draftId" $foreignHeaders) -ne 404) { throw "Cross-tenant draft read must return 404." }

New-Item -ItemType Directory -Force -Path $EvidenceDirectory | Out-Null
$sessionId = $null
try {
  $started = Invoke-Bsk @("session", "start", "--width", "1440", "--height", "1000", "--json")
  try { $startedJson = $started | ConvertFrom-Json; $sessionId = $startedJson.session_id ?? $startedJson.sessionId ?? $startedJson.id } catch { }
  if (-not $sessionId -and $started -match '\b[a-z]{4}\b') { $sessionId = $Matches[0] }
  if (-not $sessionId) { throw "Could not determine the browser-skill session id." }

  Invoke-Bsk @("navigate", $webOrigin, "--session", $sessionId, "--wait-until", "domcontentloaded", "--timeout", "30s") | Out-Null
  $tokenJson = $login.token | ConvertTo-Json -Compress
  Invoke-Bsk @("evaluate", "localStorage.setItem('store_os_token', $tokenJson); 'ok'", "--session", $sessionId, "--quiet") | Out-Null
  $contentUrl = "$webOrigin/agents/acquisition?system=content_plan&fipDraft=$([Uri]::EscapeDataString($draftId))&apiBase=$([Uri]::EscapeDataString($script:ApiOrigin))"
  Invoke-Bsk @("navigate", $contentUrl, "--session", $sessionId, "--wait-until", "networkidle", "--timeout", "45s") | Out-Null
  Invoke-Bsk @("evaluate", "window.__fipE2eErrors=[]; window.__fipE2eNetwork=[]; window.addEventListener('error',e=>window.__fipE2eErrors.push(String(e.message||e.error))); window.addEventListener('unhandledrejection',e=>window.__fipE2eErrors.push(String(e.reason))); const originalFetch=window.fetch.bind(window); window.fetch=async(...args)=>{const response=await originalFetch(...args); window.__fipE2eNetwork.push({url:String(args[0]),status:response.status,method:String(args[1]?.method||'GET')}); return response}; 'capture-installed'", "--session", $sessionId, "--quiet") | Out-Null
  $desktopSnapshot = Invoke-Bsk @("snapshot", "--session", $sessionId, "--max-tokens", "12000")
  Assert-SnapshotContains $desktopSnapshot "可编辑内容草稿" "Desktop content editor was not visible."
  Assert-SnapshotContains $desktopSnapshot $case.topic "Desktop page did not restore the selected topic."
  Assert-SnapshotContains $desktopSnapshot "进入投流系统查看预览" "Accepted content did not expose the preview entry."
  Invoke-Bsk @("click", "--selector", "[data-testid='fip-content-save']", "--session", $sessionId) | Out-Null
  Invoke-Bsk @("wait-ms", "800ms", "--session", $sessionId) | Out-Null
  $savedSnapshot = Invoke-Bsk @("snapshot", "--session", $sessionId, "--max-tokens", "12000")
  Assert-SnapshotContains $savedSnapshot "内容草稿已保存，可刷新后恢复" "Saving did not reach its success state."
  $browserState = Invoke-Bsk @("evaluate", "JSON.stringify({errors:window.__fipE2eErrors||[],network:window.__fipE2eNetwork||[]})", "--session", $sessionId, "--quiet")
  if ($browserState -notmatch '"errors":\[\]' -or $browserState -notmatch '"status":200' -or $browserState -notmatch '"method":"PATCH"') { throw "Desktop console/network acceptance failed." }
  Invoke-Bsk @("screenshot", "--session", $sessionId, "--out", (Join-Path $EvidenceDirectory "fip-content-desktop.png")) | Out-Null

  Invoke-Bsk @("reload", "--session", $sessionId, "--wait-until", "networkidle", "--timeout", "45s") | Out-Null
  $restoredSnapshot = Invoke-Bsk @("snapshot", "--session", $sessionId, "--max-tokens", "12000")
  Assert-SnapshotContains $restoredSnapshot $case.topic "Refresh did not restore the selected topic."
  Assert-SnapshotContains $restoredSnapshot "进入投流系统查看预览" "Refresh did not restore the accepted draft."

  Invoke-Bsk @("emulate", "--session", $sessionId, "--width", "390", "--height", "844", "--dpr", "1", "--mobile", "--touch") | Out-Null
  Invoke-Bsk @("reload", "--session", $sessionId, "--wait-until", "networkidle", "--timeout", "45s") | Out-Null
  $mobileSnapshot = Invoke-Bsk @("snapshot", "--session", $sessionId, "--max-tokens", "12000")
  Assert-SnapshotContains $mobileSnapshot "可编辑内容草稿" "390px content editor was not visible."
  $overflow = Invoke-Bsk @("evaluate", "document.documentElement.scrollWidth <= window.innerWidth + 1", "--session", $sessionId, "--quiet")
  if ($overflow -notmatch 'true') { throw "390px page has horizontal overflow." }
  Invoke-Bsk @("screenshot", "--session", $sessionId, "--out", (Join-Path $EvidenceDirectory "fip-content-390.png")) | Out-Null
  Invoke-Bsk @("click", "--selector", "[data-testid='fip-content-back-to-topics']", "--session", $sessionId) | Out-Null
  $backSnapshot = Invoke-Bsk @("snapshot", "--session", $sessionId, "--max-tokens", "12000")
  Assert-SnapshotContains $backSnapshot "创始人 IP 选题系统" "Returning to the topic system failed."

  # Controlled 503: browser fetch is intercepted before it can reach /generate.
  $pendingUrl = "$webOrigin/agents/acquisition?system=content_plan&fipDraft=$([Uri]::EscapeDataString($emptyDraftId))&apiBase=$([Uri]::EscapeDataString($script:ApiOrigin))"
  Invoke-Bsk @("navigate", $pendingUrl, "--session", $sessionId, "--wait-until", "networkidle", "--timeout", "45s") | Out-Null
  $pendingSnapshot = Invoke-Bsk @("snapshot", "--session", $sessionId, "--max-tokens", "12000")
  Assert-SnapshotContains $pendingSnapshot "内容草稿尚未生成" "Empty draft did not expose its recoverable initial state."
  Invoke-Bsk @("evaluate", "window.__fipGenerateCalls=0; const realFetch=window.fetch.bind(window); window.fetch=(input,init={})=>{if(String(input).includes('/founder-ip-content-drafts/')&&String(input).endsWith('/generate')){window.__fipGenerateCalls++; return Promise.resolve(new Response(JSON.stringify({message:'受控失败：请稍后重试。'}),{status:503,headers:{'Content-Type':'application/json'}}));} return realFetch(input,init)}; 'failure-intercepted'", "--session", $sessionId, "--quiet") | Out-Null
  Invoke-Bsk @("click", "--selector", "[data-testid='fip-content-retry']", "--session", $sessionId) | Out-Null
  Invoke-Bsk @("wait-ms", "400ms", "--session", $sessionId) | Out-Null
  $failureSnapshot = Invoke-Bsk @("snapshot", "--session", $sessionId, "--max-tokens", "12000")
  Assert-SnapshotContains $failureSnapshot "内容生成未完成：受控失败：请稍后重试。" "Controlled failure was not visible."
  Assert-SnapshotNotContains $failureSnapshot "进入投流系统查看预览" "Failed content must not expose traffic preview."
  $failureCalls = Invoke-Bsk @("evaluate", "window.__fipGenerateCalls", "--session", $sessionId, "--quiet")
  if ($failureCalls -notmatch '1') { throw "Controlled failure must issue exactly one intercepted request." }

  # Controlled cancellation: pending fetch rejects only when the UI AbortController fires.
  Invoke-Bsk @("reload", "--session", $sessionId, "--wait-until", "networkidle", "--timeout", "45s") | Out-Null
  Invoke-Bsk @("evaluate", "window.__fipGenerateCalls=0; const realFetch=window.fetch.bind(window); window.fetch=(input,init={})=>{if(String(input).includes('/founder-ip-content-drafts/')&&String(input).endsWith('/generate')){window.__fipGenerateCalls++; return new Promise((resolve,reject)=>{const abort=()=>reject(new DOMException('Aborted','AbortError')); if(init.signal?.aborted) abort(); else init.signal?.addEventListener('abort',abort,{once:true});});} return realFetch(input,init)}; 'cancel-intercepted'", "--session", $sessionId, "--quiet") | Out-Null
  Invoke-Bsk @("click", "--selector", "[data-testid='fip-content-retry']", "--session", $sessionId) | Out-Null
  Invoke-Bsk @("wait-ms", "100ms", "--session", $sessionId) | Out-Null
  $busyState = Invoke-Bsk @("evaluate", 'JSON.stringify({calls:window.__fipGenerateCalls,disabled:document.querySelector("[data-testid=fip-content-retry]")?.disabled===true,stop:!!document.querySelector("[data-testid=fip-content-stop]")})', "--session", $sessionId, "--quiet")
  if ($busyState -notmatch '"calls":1' -or $busyState -notmatch '"disabled":true' -or $busyState -notmatch '"stop":true') { throw "Duplicate-click/single-flight browser state failed." }
  Invoke-Bsk @("click", "--selector", "[data-testid='fip-content-stop']", "--session", $sessionId) | Out-Null
  Invoke-Bsk @("wait-ms", "300ms", "--session", $sessionId) | Out-Null
  $cancelSnapshot = Invoke-Bsk @("snapshot", "--session", $sessionId, "--max-tokens", "12000")
  Assert-SnapshotContains $cancelSnapshot "内容生成未完成：已停止本次内容生成。" "Cancelled generation was not visible."
  Assert-SnapshotNotContains $cancelSnapshot "进入投流系统查看预览" "Cancelled content must not expose traffic preview."

  # Browser-level tenant isolation: the foreign tenant sees a safe restore error, never draft content.
  $foreignTokenJson = $foreign.token | ConvertTo-Json -Compress
  Invoke-Bsk @("evaluate", "localStorage.setItem('store_os_token', $foreignTokenJson); 'foreign-token-set'", "--session", $sessionId, "--quiet") | Out-Null
  Invoke-Bsk @("navigate", $contentUrl, "--session", $sessionId, "--wait-until", "networkidle", "--timeout", "45s") | Out-Null
  $isolationSnapshot = Invoke-Bsk @("snapshot", "--session", $sessionId, "--max-tokens", "12000")
  Assert-SnapshotContains $isolationSnapshot "内容草稿恢复失败" "Foreign tenant did not receive the safe restore error."
  Assert-SnapshotNotContains $isolationSnapshot $case.evidence "Foreign tenant page leaked source evidence."
  Invoke-Bsk @("screenshot", "--session", $sessionId, "--out", (Join-Path $EvidenceDirectory "fip-content-tenant-isolation.png")) | Out-Null

  Write-Output "founder_ip_content_browser_e2e:PASS target=$Target desktop=PASS mobile390=PASS save=PASS refresh=PASS back=PASS failure=PASS cancel=PASS duplicate=PASS tenant_isolation=PASS model_requests=0"
}
finally {
  if ($sessionId) { & bsk session stop $sessionId | Out-Null }
}
