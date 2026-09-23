# HANDOFF · 把 41 个 Skill 推送到周凯仓库

> 生成 2026-09-23 · 由保禄的 WorkBuddy 会话产出 · **交给另一个任务执行**
> 本文件自包含，读完即可动手，不需要回看原会话。

---

## 一、任务一句话

把本地 `C:\Users\book\.workbuddy\skills\` 下的 **41 个 skill** 推送到
`git@github.com:zhoukai-china/MarketingBrain.git`，落点 `mcp-skills/skills/<名称>/`。
**upsert（合并式）**：只增改本地这些文件，**不整目录覆盖、不删服务器已有文件**。

| 项 | 值 |
|---|---|
| 数量 | **41 个**（新建 28 + 覆盖更新 13） |
| 源目录 | `C:\Users\book\.workbuddy\skills\<本地目录名>\` |
| 目标目录 | `<clone>\mcp-skills\skills\<仓库目录名>\` |
| 不推的 | 10 个仓库已逐文件一致、3 个 `.local-only` 标记、6 个本轮已删 |
| 客户线 | 2 个 `lanqi-*`（建议只入仓、不上架商城） |

---

## 二、⚠️ 执行前必读：3 个已踩过的坑

**坑 1 · 必须脱离沙箱跑 git。**
bash 沙箱会拦截 `~/.ssh` 读取，直接报 `git@github.com: Permission denied (publickey)`，
且会**静默卡住十几分钟**。执行 git 命令时必须在工具调用里开沙箱外模式
（`dangerouslyDisableSandbox: true`），届时会弹授权框，点允许。

**坑 2 · 不要用 `| tail` 管道。**
`git clone ... 2>&1 | tail -8` 会缓冲输出，看起来像卡死。改用
`> 日志文件 2>&1`，再用 Read 看日志。

**坑 3 · 克隆用稀疏 + 过滤，别全量拉。**
仓库是全量应用仓（apps/prisma/infra/scripts/videos），全量 clone 很慢。
用 `--filter=blob:none --sparse`，只检出 `mcp-skills/skills/` 一个目录即可。

---

## 三、执行步骤

### 环境
```bash
GIT="C:/Users/book/.workbuddy/binaries/PortableGit/versions/1.2.0/cmd/git.exe"
PY="C:/Users/book/.workbuddy/binaries/python/versions/3.13.12/python.exe"
cd "C:/Users/book/WorkBuddy/2026-09-22-19-02-14"
export GIT_SSH_COMMAND="ssh -o StrictHostKeyChecking=accept-new -o BatchMode=yes -o ConnectTimeout=20"
```

### 步骤 1 · 稀疏克隆（沙箱外）
```bash
"$GIT" clone --filter=blob:none --sparse git@github.com:zhoukai-china/MarketingBrain.git mb_push > _clone.log 2>&1
cd mb_push
"$GIT" sparse-checkout set mcp-skills/skills
```

### 步骤 2 · upsert 复制（脚本已备好）
```bash
cd "C:/Users/book/WorkBuddy/2026-09-22-19-02-14"
"$PY" _push_copy.py      # 读 _push_map.json，按映射复制 41 个 skill
```
脚本行为：递归复制，**跳过** `__pycache__` / `*.pyc` / `.local-only` / `.DS_Store`；
同名文件覆盖，服务器独有文件保留。

### 步骤 3 · 提交并推送（沙箱外）
```bash
cd mb_push
"$GIT" checkout -b skill-sync/20260923
"$GIT" add mcp-skills/skills
"$GIT" status --short | head -60          # 核对：约 41 个目录变更
"$GIT" commit -m "feat(skills): 同步 41 个 skill（28 新建 / 13 更新）"
"$GIT" push -u origin skill-sync/20260923
```

> 推的是**新分支** `skill-sync/20260923`，**没有动 main**。合并与否交给周凯决定。
> 若确需直接进 main，把最后一步换成 `git push origin HEAD:main`（建议先跟周凯确认）。

---

## 四、映射表（41 个）

| # | 本地目录 | 仓库目录 | 动作 | 备注 |
|---|---|---|---|---|
| 1 | `baolu-digital-twin` | `baolu_digital_twin` | 新建 |  |
| 2 | `baolu-dou-plus` | `baolu_dou_plus` | 新建 |  |
| 3 | `baolu-expert-orchestrator` | `baolu_expert_orchestrator` | 新建 |  |
| 4 | `baolu-local-push` | `baolu_local_push` | 新建 |  |
| 5 | `baolu-smart-cut` | `baolu_smart_cut` | 新建 |  |
| 6 | `baolu-weixin-dou` | `baolu_weixin_dou` | 新建 |  |
| 7 | `beauty-recruit` | `beauty_recruit` | 新建 |  |
| 8 | `contract-docx` | `contract_docx` | 新建 |  |
| 9 | `enterprise-diagnosis` | `enterprise_diagnosis` | 新建 |  |
| 10 | `guanfang-dou-plus-ads` | `guanfang_dou_plus_ads` | 新建 |  |
| 11 | `guanfang-local-push-ads` | `guanfang_local_push_ads` | 新建 |  |
| 12 | `industry-hotspot-content` | `industry_hotspot_content` | 新建 |  |
| 13 | `interview-mastery` | `interview_mastery` | 新建 |  |
| 14 | `investment-return-card` | `investment_return_card` | 新建 |  |
| 15 | `ip-four-piece` | `ip_four_piece` | 新建 |  |
| 16 | `lanqi-live-script` | `lanqi-live-script` | 新建 | 🔸客户线 |
| 17 | `lanqi-topic-ideas` | `lanqi-topic-ideas` | 新建 | 🔸客户线 |
| 18 | `liuliang-fangfalun` | `liuliang_fangfalun` | 新建 |  |
| 19 | `live-compliance` | `live_compliance` | 新建 |  |
| 20 | `meiye-ai-daily-brief` | `meiye_ai_daily_brief` | 新建 |  |
| 21 | `meiye-live-script` | `meiye_live_script` | 新建 |  |
| 22 | `private-deal-playbook` | `private_deal_playbook` | 新建 |  |
| 23 | `sales-funnel-review` | `sales_funnel_review` | 新建 |  |
| 24 | `store-visit-review` | `store_visit_review` | 新建 |  |
| 25 | `video-review-engine` | `video_review_engine` | 新建 |  |
| 26 | `waimai-growth` | `waimai_growth` | 新建 |  |
| 27 | `xiaohongshu-operations-expert` | `xiaohongshu_operations_expert` | 新建 |  |
| 28 | `xuehui-methodology` | `xuehui_methodology` | 新建 |  |
| 29 | `baolu-ad-manager` | `baolu_ad_manager` | 覆盖 |  |
| 30 | `baolu-content-creator` | `baolu_content_creator` | 覆盖 |  |
| 31 | `baolu-finance-advisor` | `baolu_finance_advisor` | 覆盖 |  |
| 32 | `baolu-live-review-engine` | `baolu_live_review_engine` | 覆盖 |  |
| 33 | `baolu-shangxueyuan` | `baolu_shangxueyuan` | 覆盖 |  |
| 34 | `baolu-topics` | `baolu_topics` | 覆盖 |  |
| 35 | `customer-acquisition-diagnosis` | `customer_acquisition_diagnosis` | 覆盖 |  |
| 36 | `delivery-standardization` | `delivery_standardization` | 覆盖 |  |
| 37 | `hr-director-consultant` | `hr_director_consultant` | 覆盖 |  |
| 38 | `ip-positioning` | `ip_positioning` | 覆盖 |  |
| 39 | `live-script-planner` | `live_script_planner` | 覆盖 |  |
| 40 | `moments-generator` | `moments_generator` | 覆盖 |  |
| 41 | `sales-growth-advisor` | `sales_growth_advisor` | 覆盖 |  |

> 命名规则：仓库里已有同名 skill 的（覆盖组）沿用**仓库现用名**；
> 新增的除 `lanqi-*` 保持 kebab 外，一律转 snake_case。

---

## 五、注意事项

1. **别碰 `packages/skills/skills/`。** 那是部署薄壳（`contract.json` + `prompt.md` + `examples/`），
   属于构建产物，数量与 `mcp-skills/skills/` 并不一一对应。本次**只推规范源**，
   薄壳是否重生成由周凯的构建流程决定。
2. **lanqi\* 是红线。** 服务器 `packages/skills/skills/lanqi-*` 与 `lanqi-hq-manifest.json` 客户在用，
   这次只在 `mcp-skills/skills/` 下增改，不要动 deploy 侧。
3. **大文件提醒**：`baolu_local_push`、`guanfang_local_push_ads` 各约 1.2 MB，
   `baolu_digital_twin` 约 231 KB，推送时留意。
4. **`.local-only` 标记**：这 3 个 skill 目录里有此空标记文件，表示"留本地不推送"，
   脚本会自动跳过；如果哪天要推，先删标记。
5. 提交前用 `git status --short` 核对变更数量，异常（比如几百个删除）立刻停下。

---

## 六、验收标准

- [ ] `git status --short` 显示约 41 个 skill 目录的新增/修改，**没有大面积删除**
- [ ] `mcp-skills/skills/` 下 41 个目标目录都存在且含 `SKILL.md`
- [ ] push 成功，远端出现分支 `skill-sync/20260923`
- [ ] 本地 54 个 skill 中，13 个（10 一致 + 3 local-only）**未出现**在变更里

---

## 七、相关文件（都在 `C:\Users\book\WorkBuddy\2026-09-22-19-02-14\`）

| 文件 | 用途 |
|---|---|
| `推送映射表.csv` | 41 行映射（本地名 → 仓库名），机器可读 |
| `_push_map.json` | 同上，JSON 版，供脚本读取 |
| `_push_copy.py` | 执行 upsert 复制的脚本（已就绪） |
| `推送清单_给周凯确认.md` | 完整清单（含跳过项、技术要求），给人看的版本 |
| `_push_plan.json` / `_push_upd_diff.json` | 分类与逐文件差异比对原始数据 |
