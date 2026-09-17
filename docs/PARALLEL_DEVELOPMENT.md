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

## 开一个新任务

在源码仓库根目录执行：

```powershell
git worktree add ../worktrees/<任务代号> -b codex/<任务代号>
```

新 Codex 任务的工作目录指向 `git worktree list` 里该任务对应的绝对路径
（例如 `F:\思潼AI增长os\worktrees\<任务代号>`），不要指向主源码目录。

## 收尾与合并

```powershell
# 集成者回到主目录 main
git merge codex/<任务代号>

# 任务完成、分支已合并后，先确认无未提交改动再删除
git -C ../worktrees/<任务代号> status --short   # 应为空
git worktree remove ../worktrees/<任务代号>
git branch -d codex/<任务代号>
```

## 检查与红线

- 同一智能体同一时间只做一个编码任务。
- 不同智能体最多并行两个编码任务，且必须在不同 worktree。
- 产品定义、知识整理、Eval 设计可与另一个产品的编码任务并行。
- 删除 worktree / 分支前，先 `git -C <worktree> status --short` 确认无未提交改动；
  物理删除是破坏性动作，需明确授权。
