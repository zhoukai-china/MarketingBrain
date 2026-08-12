# 原始 Skill MCP 接入说明

## 目标

思潼AI 不再把原始 Skill 内容改写进业务代码。

服务器保存原始 `SKILL.md` 文件，API 通过 MCP 工具读取原始 Skill，Agent 再把 MCP 返回的 Skill 包注入模型上下文。

这样后期维护时，只需要更新服务器上的原始 Skill 文件，不需要改 `packages/agent` 或 `packages/skills` 里的业务 prompt。

## 文件位置

本仓库内置原始 Skill：

```text
mcp-skills/skills/{skillId}/SKILL.md
```

生产服务器建议放在：

```text
/opt/Sitong-os-v2/mcp-skills/skills/{skillId}/SKILL.md
```

## MCP 工具

API 暴露 MCP JSON-RPC 端点：

```text
POST /mcp
GET  /mcp/status
```

工具：

```text
sitong_original_skill.list
sitong_original_skill.load
```

`sitong_original_skill.load` 参数：

```json
{
  "skillId": "baolu_content_creator"
}
```

返回内容包含：

```json
{
  "skillId": "baolu_content_creator",
  "source": "original-skill-mcp",
  "files": [{ "path": "SKILL.md", "chars": 13473 }],
  "prompt": "..."
}
```

## 环境变量

开发环境：

```env
SKILL_MCP_URL=http://127.0.0.1:3011/mcp
SKILL_MCP_TOKEN=
SKILL_MCP_REQUIRED=false
SKILL_MCP_INVOKE_TIMEOUT_MS=420000
ORIGINAL_SKILL_ROOT=mcp-skills/skills
```

生产环境：

```env
SKILL_MCP_URL=http://127.0.0.1:3002/mcp
SKILL_MCP_TOKEN=
SKILL_MCP_REQUIRED=true
SKILL_MCP_INVOKE_TIMEOUT_MS=420000
ORIGINAL_SKILL_ROOT=/opt/Sitong-os-v2/mcp-skills/skills
```

`SKILL_MCP_REQUIRED=true` 时，MCP 拉取失败会直接报错，不再回落到本地 `prompt.md`。

`SKILL_MCP_INVOKE_TIMEOUT_MS` 是完整 Agent 执行的外层超时，必须长于内部模型规划、主生成和质量修复所需总时间。原始 Skill 包读取仍使用更短的 `SKILL_MCP_TIMEOUT_MS`；读取失败不会写入永久缓存，下一次请求可以重新加载。

## 调用链

```text
用户输入
  -> routeSkill 选择 skillId
  -> loadSkillPrompt(skillId)
  -> MCP tools/call: sitong_original_skill.load
  -> 读取原始 SKILL.md
  -> buildAgentMessages 注入原始 Skill 包
  -> 国内模型生成结果
  -> 质量检查/返工/兜底
```

## 维护方式

更新 Skill 时，直接替换：

```text
mcp-skills/skills/{skillId}/SKILL.md
```

然后重启 API 服务即可。

如果未来要拆成独立 MCP 服务，只需要把 `SKILL_MCP_URL` 指向独立服务地址，思潼AI 主应用不用改调用方式。

## 验证

检查 MCP 是否找到原始 Skill：

```bash
curl http://127.0.0.1:3002/mcp/status
```

调用 MCP 读取 Skill：

```bash
curl -s http://127.0.0.1:3002/mcp \
  -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":"load","method":"tools/call","params":{"name":"sitong_original_skill.load","arguments":{"skillId":"baolu_content_creator"}}}'
```

上线前检查：

```bash
pnpm prelaunch:check -- --env /etc/Sitong-secrets/Sitong-os-v2.env
```
