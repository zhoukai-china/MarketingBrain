# 多任务并行开发：worktree 隔离约定

> 目的：多个 Codex 任务同时开发时，绝不共享同一个 checkout，避免磁盘互相覆盖。
> 本文件是可执行约定；红线以 `docs/agents/AGENTS.md` 为准。

## 核心规则

- 一个任务 = 一个分支 + 一个独立 worktree。
- `main` 只做集成线，并行期只有集成者提交 `main`。
- 新 Codex 任务的 cwd 必须指向它自己的 worktree，**不得指向主源码目录**
  `F:\思潼AI增长os\baolu-os-v2-source`。
- 并发编码任务最多 2 个；公共热点文件（routes、schema、`packages/*` index 等）重叠时
  停止并行，改为串行合并 + 回归。

## 位置与磁盘

- 主源码仓库：`F:\思潼AI增长os\baolu-os-v2-source`（唯一开发主目录）。
- app 自动创建的工作树：`C:\Users\book\.codex\worktrees\<hash>\baolu-os-v2-source`，
  只是源码 checkout（约几十 MB），不含依赖。
- 依赖走 pnpm store `F:\.pnpm-store` —— 包体数据在 F 盘，工作树里 `pnpm install`
  不会把依赖复制到 C 盘。
- 若要让工作树目录本身也落到 F 盘：在没有活动工作树时，把
  `C:\Users\book\.codex\worktrees` 改成指向 F 盘的**目录联接（junction）**；
  有活动工作树时先别动。

## 开一个新任务

Codex 桌面版新建任务自带「新建本地工作树」，**工作树由 app 自动创建**。标准流程：

1. 用户在 app 新建任务，环境选「新建本地工作树」，把需求发进去。
2. **任务自己的智能体开工前先自检**（不用等调度者，照本节做）：
   - `git worktree list`：确认自己在独立工作树上，且**不在**主源码目录
     `F:\思潼AI增长os\baolu-os-v2-source` 上。若发现自己在主目录上，说明任务建错了，
     停下报告，不要直接开发。
   - 按产品路由定任务编号（`TW` / `FIP` / `LQ` / `PLAT`，见 `docs/agents/AGENTS.md`）。
   - app 默认给的是游离 HEAD，把自己绑到命名分支：
     `git -C <当前工作树绝对路径> checkout -B codex/<任务代号>`
     （分支已存在则 `git checkout codex/<任务代号>`）。绑定前后提交点与文件都不变，
     只是让后续提交落到命名分支上。
3. 之后该任务的提交都落在 `codex/<任务代号>`。

## 收尾与合并

```powershell
# 集成者回到主目录 main
git merge codex/<任务代号>

# 任务完成、分支已合并后，先确认无未提交改动再删除
git -C <worktree 绝对路径> status --short   # 应为空
git worktree remove <worktree 绝对路径>
git branch -d codex/<任务代号>
```

## 检查与红线

- 同一智能体同一时间只做一个编码任务。
- 不同智能体最多并行两个编码任务，且必须在不同 worktree。
- 产品定义、知识整理、Eval 设计可与另一个产品的编码任务并行。
- 删除 worktree / 分支前，先 `git -C <worktree> status --short` 确认无未提交改动；
  物理删除是破坏性动作，需明确授权。
