# 美业行业智能体本地验收环境

- 仅监听 `127.0.0.1`：PostgreSQL `55434`、API `3016`、Web `5176`。
- 默认文本 Provider 为受控 mock，只验证路由、合同和失败边界，不能冒充正式模型质量。取得明确文本费用授权后，可在验收根目录的已忽略 `.env.text-approval` 保存受控 DeepSeek 配置并显式使用 `start.ps1 -EnableApprovedText`；脚本要求 `/ready` 证明 Provider 已配置，配置不得写入仓库、日志或回复。DeepSeek 密钥仅允许从 `apps/api/.env` 读取到启动进程内，不复制到验收目录或 runtime 记录。
- `.env.acceptance` 和数据库放在源码目录之外的持久验收根目录；不得提交或展示其中凭据。
- `setup.ps1` 只初始化带标记的专用目录，并将全部迁移连续执行两次验证幂等。
- `start.ps1`、`status.ps1`、`stop.ps1` 只操作本环境记录的端口和进程。
- WorkBuddy secret 仅在产品连接管理页创建时显示一次；列表只显示 prefix，服务端只保存 hash。
- 默认启动不读取历史 `.env.media-approval`，因此不会启用真实图片/视频 Provider。一次性真实媒体终验仍可显式使用 `start.ps1 -EnableApprovedMedia`。
- 已完成真实文字与三图放行的本机 XHS 用户验收环境，可在该 AcceptanceRoot 写入无密钥标记 `.xhs-user-acceptance-profile`，内容必须精确为 `xhs_user_acceptance_v1`。之后正式 `stop.ps1` / `start.ps1` 会重新校验 `.env.text-approval`、`.env.media-approval`、固定 `deepseek-v4-pro`、`wan2.7-image`、单批 3 张、300 积分、本地存储和人民币上限，再恢复 `configured_provider + real/max3`；未知标记或任一配置不匹配均 fail-closed。该标记只在明确的本机 AcceptanceRoot 生效，不进入生产配置，也不会自动触发任何 Provider。
- runtime 记录只保存非敏感的 `runtimeProfile`、文本/媒体模式、产品开关和最多图片数；启动决策必须同时匹配源码指纹、PID/命令身份和 runtime profile，不能仅因文本模式相同而复用错误媒体配置。需要撤销本机真实验收能力时，先按正式身份门禁停止环境，再删除 AcceptanceRoot 内的 `.xhs-user-acceptance-profile` 与对应 approval 文件并以默认方式启动。
- 受邀验收用户的图片按钮不得依赖开发人员遗留的一次性 grant：仅当仓库外 `.env.acceptance` 明确设置 `BEAUTY_MEDIA_PRODUCT_ENABLED=true`，同时服务端确认 `beauty-industry` 租户 entitlement、积分、单批最多 3 张、人民币硬预算、本地存储和 Provider 配置全部通过时才允许确认。该产品级开关不绕过用户显式确认、账本或幂等。
