# BY-53 Seedance默认关闭协议适配

状态：已完成 / idle（2026-09-05；仅零调用协议层，范围P0/P1=0）

## 归属与范围

美业通用核心，非兰琪品牌包；中风险，串行。依据SEEDANCE_ROUTE_REVIEW已核官方2.0合同建立独立submit/get、素材Schema与BY51用量适配。首个可构造profile仅2图/5秒/720p/9:16。默认disabled，测试只注入合成transport；不接公共route、不给现有wan驱动换模型，不新增队列/数据库/积分价格。

## 不做

不读密钥、不联网、不上传、不创建grant/邀请、不改环境、不生成视频、不部署；暂停XHS/经营问答/BY19/20/43/BY44外部不恢复。用户声明和URL格式不能冒充官方肖像授权。真实授权核验、持久许可/预算/计量事务接线未完成时不开放。

## 验收

1. 固定2.0型号/字段；角色、格式、大小、时长、音频依赖与首帧混用严格拒绝。
2. 仅服务端resolver取得本租户/用户/店/用途/版本/有效期/平台肖像授权素材；任意URL、asset参数和伪造主体拒绝。
3. POST只一次；无id/超时/错误保持unknown不可重放；GET计数、退避、Retry-After、终态不明均可解释；HTTP200不是业务成功。
4. URL/重定向/响应体/超时失败关闭；没有原始正文/密钥/签名URL遥测。completion/total不重复计费，缺usage未知不为0。
5. 同批三轮离线正常/异常/跨租户/重放/用量测试，相邻wan/账本/权限不退化，qa:full含build、diff检查。

## 基线/红灯

- `pnpm.cmd beauty-industry:video-foundation-smoke` PASS（3轮、Provider0），日志：`F:/思潼AI增长os/test-environments/by53-offline-20260905/logs/baseline.log`。
- 开始git status482项，保护所有既有修改；无回退/整体提交。
- 修复前新smoke断言`seedance_explicit_adapter_missing`稳定失败；这是新能力缺口，不伪造旧wan线上Bug。根因为原wan字段/状态/秒计量不能代表官方Ark协议，不能通过换model字符串接通。
- `seedance-green.log`及最终qa-full.log三轮PASS；原公开seedance_creative仍返回尚未开放。

## 文件归属与交接

实际文件归属（全部美业通用核心/工程合同，无兰琪品牌知识）：

- 新增`apps/api/src/services/beauty-seedance-adapter.ts`：严格2.0参考Schema、server evidence port、仅fixture协议工厂、atomic journal port、submit/get、BY51 UsageMeasure；SHA256=`F467A7D8A04AE2258A7A5E9F2938B23CA4CA292A59102ACD44E1043B8AA6A268`。
- 新增`scripts/beauty-seedance-adapter-smoke.ts`：三轮合成输入/权限/状态/传输/用量防错；SHA256=`80470E31D38CC5B27F30546581C6E8B702D800EF521197977EE07C713B70A5A3`。
- `package.json`本轮仅新增seedance-adapter-smoke一项与qa:regression链头，保留所有旧脚本/他人改动。
- 新增本任务卡及`SEEDANCE_ADAPTER.md`；更新STATUS/TEST_MATRIX/PRODUCT/WORKFLOW/CONTRACTS/tasks README/BUG_REGRESSIONS顶部记录。不改Skill、wan driver、DB schema、页面、环境脚本；无候选/个人Skill运行引用。
- 起止git status条目482→484（含被Git折叠的既有未跟踪文档目录，不等同物理文件数）；不commit/reset/move/delete，不整体提交其他任务资产。回滚只撤本轮新服务/smoke及package两处接入和本轮文档段，不回退既有脏改。

## 最终验证与限制

- `pnpm.cmd beauty-industry:video-foundation-smoke` PASS，旧wan三轮、零调用基线。
- `node apps/api/node_modules/tsx/dist/cli.mjs scripts/beauty-seedance-adapter-smoke.ts` / `pnpm.cmd beauty-industry:seedance-adapter-smoke` PASS，同批三轮；最终另补旧公开guard静态调用断言后专项再PASS。
- `pnpm.cmd --filter @baolu/api typecheck` PASS。
- `pnpm.cmd qa:full`最终exit0（`logs/qa-full.log`），包含qa:fast、qa:regression、新专项、API/Web/Agent/Shared/DB/Skills等typecheck与build；旧素材权限、执行/账本、BY51计量、OSS、MCP/品牌/相邻合同回归PASS。
- `git diff --check` PASS。只新增测试guard后不改生产代码，不重复全量烧时间；文档最后校验可读/链接。
- 安全场景：并发submit只一POST；保存失败/无id/超时不重放；重建adapter、GETlease过期/20次/Retry-After恢复；HTTP200缺正式结果仍unknown；双租户/店/用户及授权变更拒绝；总量/缓存不重复计费，缺usage未知，原始异常/响应/签名URL不进事件。
- 未运行真实Provider、外网、真实DB/HTTP、视频生成/下载/质量；无DOM/route变化不重复桌面/390pxE2E。此适配器没有live配置/密钥接口，仅合成Bearer注入。不能把内存port视为持久并发保证，也不能把DNS元数据格式视为真实云授权。
- 环境：仅日志目录`F:/思潼AI增长os/test-environments/by53-offline-20260905`，不建PG/API/Web/浏览器进程，BY52已停环境不动，无端口/PID/runtime认领或邀请。所有本轮测试已退出；费用¥0、真实Provider/外网/上传0。
- 下一唯一零费用接线：服务端Ark素材授权resolver + 现有持久执行许可/账本事务和DNS-pinned transport；缺官方审核/新用途权限/预算时默认disabled，真实授权与费用另行合并申请。BY19/20和其余暂停范围不恢复。

无需用户现在测试；本轮协议范围P0/P1=0不代表整个视频产品放行，真实视频尚未生成。
