# 思潼AI增长OS v2 架构方案

## 1. 产品原则

思潼AI增长OS v2 不是通用聊天 AI，而是面向中国本地商家与连锁品牌的垂直经营增长 Agent。产品卖点是专业方法论、主动经营建议、自动化推送、文件/录音/经营数据分析，而不是简单模型对话。

核心原则：

- 老版不动，新版独立开发、独立部署、独立数据库。
- 生产环境只使用国内模型与国内基础设施。
- 标准版解决日常经营输出，高级版解决数据分析、管理协作、报告交付。
- 每个商家/品牌是一个 `tenant`，所有数据必须按 `tenant_id` 隔离。
- Agent 能力通过可版本化的 Skill 管理，不把大 prompt 塞进业务代码。

## 2. 系统分层

```text
H5 / Web Workbench / Admin
        ↓
Fastify API
        ↓
业务服务层
用户 / 租户 / 套餐 / 积分 / 文件 / 订单 / 自动化
        ↓
Agent Orchestrator
画像读取 / 场景判断 / Skill 路由 / Prompt 组装 / 质检 / 计费
        ↓
Domestic LLM Provider
DeepSeek / 国内模型中转
        ↓
PostgreSQL / OSS / Redis
```

## 3. 账号与租户模型

```text
tenant: 一个本地商家或一个连锁品牌
store: 连锁品牌下的门店，本地商家可只有一个默认门店
user: 具体账号
membership: user 在 tenant 下的角色
subscription: tenant 购买的套餐
credit_account: tenant 共享积分账户
```

角色：

- owner：老板/品牌负责人，可付费、看全部数据、管理账号。
- admin：管理员，可配置资料和看运营数据。
- operator：运营，可使用内容、选题、朋友圈、投流等能力。
- manager：店长，可看自己门店的数据和建议。
- staff：员工，可提交工作内容、录音卡、查看分配建议。

## 4. Agent 执行链路

```text
用户输入
  ↓
验证 user_id / tenant_id / role
  ↓
读取 tenant profile 与历史上下文
  ↓
判断 local_business / chain_brand
  ↓
选择 skill
  ↓
校验套餐权限
  ↓
组装系统 prompt + skill prompt + 画像 + 输入
  ↓
调用国内模型
  ↓
质量检查：是否泛泛、是否跑题、是否缺动作
  ↓
扣积分并记录流水
  ↓
保存 agent run 与消息
  ↓
返回结果
```

## 5. 自动化能力

自动化引擎第一版先预留任务模型，后续接入 Redis + BullMQ。

任务类型：

- 每日经营建议
- 每周选题推送
- 朋友圈文案推送
- 沉默客户唤醒
- 资料补全追问
- 套餐到期提醒
- 高级版文件分析提醒
- 录音卡工作内容分析

## 6. 质量闭环

后台记录每次 Agent 运行：

- 输入、输出、skill、skill 版本
- 场景判断、本地/连锁识别结果
- 模型供应商和 token/成本估算
- 用户反馈与人工标注
- 质量问题类型

修复方式优先级：

1. 更新 skill prompt。
2. 增加 examples。
3. 增加输出结构约束。
4. 增加行业知识库。
5. 形成回归测试集。

第一阶段不做模型微调，先做可回滚、可测试的 Agent 能力迭代。

