# HANDOFF · OS-v2 IP定位智能体（ipzone__ip-pos）

**一句话任务话术（直接发 Codex）：**

> OS-v2 IP定位智能体（ipzone__ip-pos）生产实例端到端 QA 已通过：真实账号走完 6 步访谈→确认卡→8 章完整全案，0 报错，单次消耗 400 积分，会话持久化正常；此前 v1 报告的「进度条不推进」与「第6步按钮文案提前变化」两项已用 DOM 证据（progress_log.json）证伪，无需改动；仅 2 处低优先级文案待优化——①低积分 402 提示同时写「本次不消耗积分」与「当前积分不足」自相矛盾；②开场白说「5轮」但 UI 为 6 步——均不阻塞上线；测试实例免登录账号仅 100 积分，复现全案生成需充 ≥500 积分或临时跳过计费。

**证据：**
- 完整报告：`qa-ip-pos/QA-Report-ipzone__ip-pos-20260917.md`
- 进度条推进 DOM 证据：`qa-ip-pos/progress_log.json`
- 全案产出：`qa-ip-pos/final_real.txt`
- 走查日志（0 错误）：`qa-ip-pos/login_real.log`

**实例地址：**
- 测试：`https://api.lcppch.top/lanqi-test/agent/ipzone__ip-pos/chat`
- 生产：`https://api.lcppch.top/os-v2/agent/ipzone__ip-pos/chat`
