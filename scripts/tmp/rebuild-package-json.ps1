# 重建根 package.json：以 HEAD 为基线，补回被 PowerShell 管道截断的工作区内容。
# 证据来源：scripts/tmp/qa-full-plat18.log（2026-09-12 07:39 真实 qa:full 运行记录）
# 与 scripts/tmp/qa-fast-plat18-batch12.log，它们逐条打印了当时 package.json 的脚本体。
$ErrorActionPreference = "Stop"
$repo = "F:\思潼AI增长os\baolu-os-v2-source"
Push-Location $repo
try {
  $head = Join-Path $env:TEMP "head-package.json"
  if (-not (Test-Path $head)) { throw "缺少 $head（应由 git show HEAD:package.json 生成）" }
  $t = [System.IO.File]::ReadAllText($head)
  # 统一成 LF：仓库里的 package.json 是 LF，PS 的 Set-Content 会写成 CRLF。
  $t = $t.Replace("`r`n", "`n")

  function Add-After {
    param([string]$Text, [string]$Anchor, [string[]]$Lines, [string]$Tag)
    $needle = $Anchor + "`n"
    if (-not $Text.Contains($needle)) { throw "锚点未找到：$Tag" }
    return $Text.Replace($needle, $needle + (($Lines | ForEach-Object { $_ }) -join "`n") + "`n")
  }

  $t = Add-After $t `
    '    "marketplace:reference-case-neutral-smoke": "node apps/api/node_modules/tsx/dist/cli.mjs scripts/marketplace-reference-case-neutral-smoke.ts",' `
    @(
      '    "marketplace:sku-link-contract-smoke": "node apps/api/node_modules/tsx/dist/cli.mjs scripts/marketplace-sku-link-contract-smoke.ts",'
      '    "marketplace:sku-link-regression": "node scripts/marketplace-sku-link-regression.mjs",'
    ) "marketplace:sku-link"

  $t = Add-After $t `
    '    "marketplace:vidrev-contract-smoke": "node apps/api/node_modules/tsx/dist/cli.mjs scripts/marketplace-vidrev-contract-smoke.ts",' `
    @(
      '    "marketplace:vidrev-run-smoke": "node apps/api/node_modules/tsx/dist/cli.mjs scripts/marketplace-vidrev-run-smoke.ts",'
      '    "marketplace:vidrev-browser-e2e": "node scripts/marketplace-vidrev-browser-e2e.mjs",'
      '    "marketplace:trial-grant-smoke": "node apps/api/node_modules/tsx/dist/cli.mjs scripts/marketplace-trial-grant-smoke.ts",'
      '    "marketplace:trial-grant-admin-smoke": "node apps/api/node_modules/tsx/dist/cli.mjs scripts/marketplace-trial-grant-admin-smoke.ts",'
    ) "marketplace:vidrev/trial-grant"

  $t = Add-After $t `
    '    "auth:wechat-login-failure-paths-smoke": "node apps/api/node_modules/tsx/dist/cli.mjs scripts/wechat-login-failure-paths-smoke.ts",' `
    @(
      '    "auth:wechat-login-bridge-smoke": "node apps/api/node_modules/tsx/dist/cli.mjs scripts/wechat-login-bridge-smoke.ts",'
      '    "auth:login-wechat-qr-browser-smoke": "node scripts/login-wechat-qr-browser-smoke.mjs",'
    ) "auth:wechat"

  $t = Add-After $t `
    '    "auth:login-entry-production-check": "node scripts/login-entry-production-render-check.mjs",' `
    @(
      '    "platform:route-contract-smoke": "node scripts/platform-route-contract-smoke.mjs",'
      '    "platform:route-browser-e2e": "node scripts/platform-route-browser-e2e.mjs",'
    ) "platform:route"

  $t = Add-After $t `
    '    "lanqi:media-generation-smoke": "node apps/api/node_modules/tsx/dist/cli.mjs scripts/lanqi-media-generation-smoke.ts",' `
    @(
      '    "lanqi:media-staging-smoke": "node apps/api/node_modules/tsx/dist/cli.mjs scripts/lanqi-media-staging-smoke.ts",'
    ) "lanqi:media-staging"

  $oldFast = '"qa:fast": "pnpm db:client-model-check && pnpm beauty-industry:image-asset-url-policy-p1-smoke && pnpm beauty-industry:image-generation-success-p1-smoke && pnpm beauty-industry:image-signage-carrier-prompt-p1-smoke && pnpm beauty-industry:image-composition-p1-smoke && pnpm beauty-industry:deterministic-visual-delivery-p1-smoke && pnpm beauty-industry:xhs-same-page-image-p1-smoke && pnpm lint:structure && pnpm quality:assets && pnpm quality:evals && pnpm marketplace:reference-case-neutral-smoke && pnpm auth:product-login-smoke && pnpm auth:identity-header-spoof-smoke && pnpm auth:wechat-login-failure-paths-smoke && pnpm lanqi:test-splash-contract-smoke && pnpm lanqi:brand-nav-contract-smoke && pnpm typecheck"'
  $newFast = '"qa:fast": "pnpm db:client-model-check && pnpm beauty-industry:image-asset-url-policy-p1-smoke && pnpm beauty-industry:image-generation-success-p1-smoke && pnpm beauty-industry:image-signage-carrier-prompt-p1-smoke && pnpm beauty-industry:image-composition-p1-smoke && pnpm beauty-industry:deterministic-visual-delivery-p1-smoke && pnpm beauty-industry:xhs-same-page-image-p1-smoke && pnpm lint:structure && pnpm quality:assets && pnpm quality:evals && pnpm marketplace:reference-case-neutral-smoke && pnpm marketplace:sku-link-contract-smoke && pnpm auth:product-login-smoke && pnpm auth:identity-header-spoof-smoke && pnpm auth:wechat-login-failure-paths-smoke && pnpm auth:wechat-login-bridge-smoke && pnpm lanqi:test-splash-contract-smoke && pnpm lanqi:brand-nav-contract-smoke && pnpm platform:route-contract-smoke && pnpm typecheck"'
  if (-not $t.Contains($oldFast)) { throw "qa:fast 锚点未找到" }
  $t = $t.Replace($oldFast, $newFast)

  $oldLq = "pnpm lanqi:media-generation-smoke && pnpm lanqi:image-studio-smoke"
  $newLq = "pnpm lanqi:media-generation-smoke && pnpm lanqi:media-staging-smoke && pnpm lanqi:image-studio-smoke"
  if (-not $t.Contains($oldLq)) { throw "qa:lanqi-foundation 锚点未找到" }
  $t = $t.Replace($oldLq, $newLq)

  $json = $t | ConvertFrom-Json
  [System.IO.File]::WriteAllText((Join-Path $repo "package.json"), $t, (New-Object System.Text.UTF8Encoding($false)))
  Write-Output ("rebuilt package.json: {0} scripts" -f $json.scripts.PSObject.Properties.Name.Count)
} finally {
  Pop-Location
}
