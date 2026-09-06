# 美业运行资产审计与非破坏性去旧（2026-08-26）

## 结论

- 当前 8 个公开结果型 capability 均由 `BEAUTY_WORKFLOWS` 显式注册，并各自解析到唯一 tool、scope、workflow、版本钉死 Skill chain、正式输出合同和 renderer。
- `packages/skills/skills` 是 `@baolu/skills` 读取的可执行 Prompt、质量合同和样例目录；`mcp-skills/skills` 是 Skill MCP 与 agent catalog 使用的 Codex 正式 Skill 源目录。两者职责不同，不能凭目录名删除任一方。
- `mcp-skills/candidates`、`intake`、`quarantine` 与个人 `.codex/skills` 的运行源码引用和当前构建产物引用均为 0。
- 固定美业 capability 未命中专属 controlled fixture 时，在旧通用九件套 fallback 之前抛出 `controlled_beauty_capability_fixture_missing`；通用 fallback 只保留给非美业旧调用方。
- 历史 AgentRun 直接读取已保存的 `skillId`、`skillVersion` 和 `output`，不经当前 fallback 重算；旧 `/content-ten` 仅为当前工具的 URL 兼容别名。
- 本次没有物理删除、数据库清理或不可逆移动。当前无满足完整证据链的物理删除候选。

机器可读清单与哈希见 `runtime-assets.json`，执行门禁为 `pnpm.cmd beauty-industry:runtime-assets-governance-smoke`。

## Active 依赖图

| Capability | Tool / scope | 固定 Skill chain | Renderer |
|---|---|---|---|
| `beauty_xiaohongshu_package` | `beauty.xiaohongshu_package` / `acquisition:xhs` | `wechat-xhs-content-line@1.0.2` + `beauty-industry-xhs@1.1.0` + `beauty-industry-compliance@1.0.0` | `BeautyIndustryAcquisitionPage.tsx` 三层交付 |
| `topic_inspiration` | `beauty.topic_ideas` / `acquisition:topics` | `baolu_topics@2.1.2` + `beauty-industry-content-diff@1.1.0` + `beauty-industry-compliance@1.0.0` | `TopicSystemWorkbench.tsx` |
| `content_plan` | `beauty.content_ten_pack` / `acquisition:video-content` | `baolu_content_creator@5.0.0` + 两个美业约束 | `BeautyContentTenWorkbench.tsx` |
| `shooting_editing` | `beauty.video_content_review` / `acquisition:video-content-review` | `baolu_content_creator@5.0.0` 拍摄剪辑合同 + 两个美业约束 | 专属视频内容复盘工作台 |
| `video_data_review` | `beauty.video_data_review` / `acquisition:video-data-review` | `baolu_review_engine@2.0.0` + 两个美业约束 | 专属视频数据复盘工作台 |
| `live_script` | `beauty.live_script` / `acquisition:live` | `live_script_planner@3.0.0` + 合规约束 | 直播话术结果页 |
| `live_review` | `beauty.live_review` / `acquisition:live-review` | `baolu_live_review_engine@3.0.0` + 合规约束 | 专属直播复盘工作台 |
| `beauty_sales` | `beauty.sales_advice` / `sales:advice` | `sales_growth_advisor@3.0.0` + 合规约束 | 销售结果页 |

Web 与 WorkBuddy 都进入同一 `mcp-adapter → execution → output-contract`，没有第二套 Prompt 或模糊能力选择。

## 分类与处置

| 分类 | 资产 | 处置 |
|---|---|---|
| `ACTIVE_CANONICAL` | 上表 10 个正式 Skill 双目录副本、固定 workflow、output contract、受控输出 adapter、renderer | 保留；版本/合同/内容哈希漂移即门禁失败 |
| `HISTORICAL_PINNED` | AgentRun/Step 版本与保存输出、旧 `/content-ten` URL 别名、暂停中的 `beauty_daily_brief@1.0.0` | 只读保留；不得用当前 fallback 重算或借旧 URL 选择旧 Skill |
| `LEGACY_REFERENCED` | `domestic-chat-provider.ts` 非美业通用九件套 fallback | 暂保留给非美业旧调用方；固定美业链已逻辑隔离，迁移其他调用方须另立任务 |
| `LEGACY_UNREFERENCED` | 无已确认对象 | 不做猜测性迁移或删除 |
| `WORKBUDDY_CANDIDATE` | `mcp-skills/candidates`、`intake`（quarantine 当前不存在） | 已处于非运行隔离区；运行引用 0，不移动、不删除 |
| `GENERATED_COPY` | `apps/api/dist`、`apps/web/dist`、`packages/skills/dist` | 非源代码；只审计候选引用，不以修改 dist 代替源码修复 |

四份 `packages/skills/skills/lanqi-{compliance,content-diff,xhs,zhaoshang}` 是已注册的兰琪正式质量包，不是美业 active chain，也不是 WorkBuddy 候选。其运行内容未改；本轮只把 `sample-grade.md` 标题规范为质量门禁要求的“用户输入：/样板输出：”，保留原文与 provenance，`quality:assets` 已转绿。

## 恢复和删除边界

- 本轮仅新增审计清单、静态门禁和可逆文档标记，无需资产恢复操作。
- 未来物理删除前必须另交：精确绝对路径与仓库相对路径、内容哈希、全仓和部署包 0 引用、历史/回滚影响、备份位置、恢复命令、删除后专项/历史回放/全量测试计划。
- 当前 `safeCandidates=[]`、`physicalDeletion.approved=false`，因此没有可执行删除命令。
