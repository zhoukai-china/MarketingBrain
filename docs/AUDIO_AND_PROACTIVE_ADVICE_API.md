# 录音卡与主动经营建议 API

本文档记录门店 AI 增长 OS 第一版的录音卡接入方式，以及主动经营建议的触发逻辑。

## 核心原则

- 所有接口运行在中国境内服务器，模型调用只走已配置的国内模型链路。
- 每条录音卡必须绑定到当前商家的工作区，不能跨商家读取或分析。
- 录音卡不是单纯转文字，最终要生成获客、销售、交付、管理、风险提醒等经营建议。
- 如果信息不足，咨询师一次只追问一个关键问题，不要让商家一次填很多表。

## 主动经营消息

`GET /os-v2/api/proactive/feed`

用途：用户打开 H5 咨询室时，系统自动拉取今天应该主动推给他的消息，包括 AI 日报、录音卡经营复盘、继续执行提醒。

请求头：

```http
Authorization: Bearer <用户登录 token>
Content-Type: application/json
```

返回示例：

```json
{
  "dataMode": "database",
  "items": [
    {
      "id": "ai-daily-2026-06-29",
      "type": "ai_daily",
      "title": "今日 AI 日报",
      "skillId": "ai_daily_brief",
      "content": "今日 AI 日报已送达...",
      "createdAt": "2026-06-29T09:00:00.000Z"
    }
  ]
}
```

前端处理：把 `items` 当成咨询师消息插入聊天流。长内容需要拆成多段气泡，不要做成后台列表。

## 录音卡绑定

一个商家可以绑定多款录音卡。当前支持两种模式：

- `webhook`：录音卡厂商主动把转写内容推送到本系统。
- `pull`：本系统按配置主动调用录音卡厂商 API，抓取转写内容。

### 创建绑定

`POST /os-v2/api/audio-card-bindings`

请求头：

```http
Authorization: Bearer <用户登录 token>
Content-Type: application/json
```

Webhook 模式请求体：

```json
{
  "provider": "recording_card",
  "label": "店长每日录音卡",
  "description": "每天收集店长复盘、员工反馈、顾客问题",
  "mode": "webhook"
}
```

Pull 模式请求体：

```json
{
  "provider": "vendor_a",
  "label": "某某 AI 录音卡",
  "description": "每天主动拉取录音转写",
  "mode": "pull",
  "pullConfig": {
    "endpoint": "https://api.vendor.cn/records",
    "method": "GET",
    "authType": "bearer",
    "authToken": "<厂商 API token>",
    "itemsPath": "data.list",
    "transcriptPath": "text",
    "summaryPath": "summary",
    "staffNamePath": "staff.name",
    "storeNamePath": "store.name",
    "workDatePath": "date",
    "metricsPath": "metrics"
  }
}
```

注意：Pull 模式的 `endpoint` 必须通过国内网络白名单校验。新增厂商时，需要把厂商域名加到服务器环境变量的国内出站白名单。

返回值：

```json
{
  "binding": {
    "bindingId": "acb_xxx",
    "mode": "webhook",
    "webhookUrl": "https://api.lcppch.top/os-v2/api/audio-card-webhooks/acb_xxx",
    "pullUrl": "https://api.lcppch.top/os-v2/api/audio-card-bindings/acb_xxx/pull",
    "tokenHeader": "x-Sitong-webhook-token"
  },
  "webhookToken": "只返回一次，务必保存"
}
```

### 查看绑定

`GET /os-v2/api/audio-card-bindings`

用途：查看当前商家已经创建的录音卡绑定。不会返回 token 明文。

## Webhook 推送录音卡

`POST /os-v2/api/audio-card-webhooks/:bindingId`

请求头：

```http
Content-Type: application/json
x-Sitong-webhook-token: <创建绑定时返回的 webhookToken>
```

请求体：

```json
{
  "staffName": "张店长",
  "storeName": "思潼烧烤大连店",
  "workDate": "2026-06-29",
  "transcript": "今天来了18桌，晚高峰排队但翻台慢，3个顾客问会员卡没有成交...",
  "summary": "晚高峰翻台和会员卡成交偏弱",
  "metrics": {
    "customerCount": 18,
    "memberCardLeads": 3,
    "memberCardClosed": 0
  },
  "metadata": {
    "externalCardId": "rec_20260629_001"
  }
}
```

系统收到后会自动保存录音卡，并立即调用经营增长顾问生成经营复盘。生成结果会进入主动消息 feed，用户下次打开咨询室即可看到。

## Pull 主动抓取录音卡

`POST /os-v2/api/audio-card-bindings/:bindingId/pull`

请求头：

```http
Authorization: Bearer <用户登录 token>
Content-Type: application/json
```

用途：按绑定时的 `pullConfig` 调用外部录音卡 API，最多一次抓取并分析 5 条记录。后续可以接定时任务，每天晚上自动调用这个接口。

字段映射规则：

- `itemsPath`：从厂商返回 JSON 中取列表的位置，例如 `data.list`。不填时把整个响应当作一条或一组记录。
- `transcriptPath`：录音转写全文字段，必填映射，默认 `transcript`。
- `summaryPath`：摘要字段。
- `staffNamePath`：员工姓名字段。
- `storeNamePath`：门店名称字段。
- `workDatePath`：工作日期字段。
- `metricsPath`：指标对象字段。

## 手动提交与分析

`POST /os-v2/api/audio-cards`

用途：手动提交一条录音卡或工作记录。

`POST /os-v2/api/audio-cards/:id/analyze`

用途：手动触发分析。系统会调用经营增长顾问，把录音内容转成：

- 老板先看的平衡结论
- 有录音证据的沟通或经营亮点，以及复制、强化、团队推广方案
- 销售、获客、交付和管理等板块的问题优化建议
- 明天最该做的三件事
- 拓客建议
- 销售跟进建议
- 管理和交付提醒
- 需要老板追问员工补充的信息

建议的数量与篇幅默认按“约一半问题优化 + 约一半优势放大”组织。每条优势必须包含亮点证据、有效原因、放大动作和验证指标；正向证据不足时必须明确说明，不得编造表扬。

## 主动建议触发逻辑

- 每天 9 点：推送 AI 日报。用户打开系统即看到“今日 AI 日报已送达”。
- 每天 18 点到 22 点：如果当天有录音卡或工作记录，自动生成今日经营复盘。
- 每周一 9 点：根据经营记忆和历史对话生成本周选题、销售、投流和管理建议。
- 用户连续 3 天未打开系统：推送轻量提醒，召回用户回到咨询室。

后续接入定时任务时，推荐把 Pull 模式绑定按商家逐个执行，并把失败日志写入 `AutomationTask`，避免某个厂商接口失败影响其他商家。
