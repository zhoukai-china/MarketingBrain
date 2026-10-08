# HANDOFF · 古人经营智慧（gu-ren）前端 QA 修复清单

> **一句话任务**：修复 `gu-ren-service/web/gu-ren-app-20261006.html` 的 4 处缺陷——流式 `error` 事件静默失败、`/balance` 失败误清用户 Key、「真说过?」误删「先生小传」、四段结构偶发塌陷——其余为体验优化项（见下方 P3）。

- **来源**：全量 QA 测试报告（2026-10-08），移动端 390×844 + 桌面端 1280×900 双视口，真实浏览器 + 后端接口直连 + 网络拦截复现。
- **测试结论**：核心链路全通，无 P0；共 2×P1、2×P2、5×P3。本文件给可直接落地的修复点（含行号与改法）。
- **目标文件**：`gu-ren-service/web/gu-ren-app-20261006.html`（与线上 `/gu-ren/index.html` 一致）。

---

## P1-1 · 流式 `error` 事件被静默吞掉（静默失败）

- **位置**：`streamChat()`，约 **L378**
- **现状**：
  ```js
  if (ev && data){ try { onEvent(ev, JSON.parse(data)); } catch (e) {} }
  ```
- **现象**：模型中途出错（SSE `event: error`）时，用户在 `askGu` 里看不到任何报错，却收到一张"看似完成"的卡片——只有先生名 + 段标题 + 合规声明、正文为空（或部分 delta 半截），误以为已答完。
- **根因**：`onEvent` 内 `error` 分支 `throw new Error(...)` 被外层空 `catch` 吞掉，`askGu` 的 `catch(showError)` 永不触发；随后把 `acc` 当成功结果渲染并追加合规声明。
- **修复**：把 `error` 事件直接抛出，使其冒泡到 `askGu` 的 catch。
  ```js
  if (ev && data){
    if (ev === 'error') {
      let d = {}; try { d = JSON.parse(data); } catch (_) {}
      const err = new Error((d && (d.message || d.detail)) || '生成失败');
      err.status = 500; throw err;     // 让 askGu 的 catch 正常走 showError
    }
    onEvent(ev, JSON.parse(data));
  }
  ```
- **验证**：网络拦截 `/gu/chat` 返回 `200 + event: error`，应出现"这厢失手了"错误卡，而非空卡。

## P1-2 · `/balance` 失败会把用户 Key 清空 → 当日额度被重置

- **位置**：`refreshBalance()`，约 **L387**
- **现状**：
  ```js
  } catch (e) {
    KEY = ''; localStorage.removeItem('gu_api_key');   // Key 失效：清掉，下次发送自动重连游客 Key
  }
  ```
- **现象**：`refreshBalance` 在每次成功回答后、以及初始化时调用；一旦 `/balance` 因**网络抖动等任何异常**失败，就清空 Key。下次发送静默申请新游客 Key → **当日 10 次额度重置**（且游客 Key 本就不绑设备，清 localStorage 即可再领）。收费上线后构成计费/风控漏洞。
- **修复**：仅 401/403（Key 真正失效）才清 Key；其他错误保留 Key 静默重试。
  ```js
  } catch (e) {
    if (e && (e.status === 401 || e.status === 403)) {
      KEY = ''; localStorage.removeItem('gu_api_key');
    }
    // 其余错误（网络抖动等）保留 key，下次发送会自动重连
  }
  ```
- **附加建议**：游客 Key 增加设备/IP 维度限流，防止额度被重置绕过。

## P2-1 · 点「真说过?」误删「先生小传」卡片

- **位置**：`onTap()` 内 `data-know` 分支，约 **L495**
- **现状**：
  ```js
  const old = chat.querySelector('.know'); if (old){ old.remove(); }
  ```
- **现象**：点击回答右上角「真说过?」后，顶部的"先生小传"卡片被删除（被"演义校正"替换）。
- **根因**：`querySelector('.know')` 命中 DOM 中**第一个** `.know`——即"先生小传"（它与纠偏卡共用 `.know` 类），并非上一次的纠偏卡。
- **修复**：只删"演义校正"卡。给纠偏卡加专用类并精确选择：
  ```js
  const old = Array.from(chat.querySelectorAll('.bub.know-correction'))
                  .find(b => /演\s*义\s*校\s*正/.test(b.textContent));
  if (old) old.remove();
  // 插入时给纠偏卡加 class：
  row.insertAdjacentElement('afterend',
    el(`<div class="bub know know-correction"><div class="k-h">演 义 校 正</div>...</div>`));
  ```

## P2-2 · 四段结构偶发塌陷为纯文本（鲁棒性）

- **位置**：`parseSections()`，约 **L215–234**
- **现象**：四段卡依赖模型**严格**输出 `【<head>】/【经营映射】/【可执行动作】/【风险提示】`。一旦首标记偏差（6 位先生抽样中孙子出现 1 次），整卡降级为单段纯文本（`plainHTML`），结构丢失。
- **修复建议**（前端 + 提示词双管齐下）：
  1. **放宽解析**：只要命中 `经营映射 / 可执行动作 / 风险提示` 中**任意一段**，就按四段卡渲染命中的段，未命中的段留空，不要因首标记偏差整卡降级。
  2. **头标记容错**：接受 `【X之见】/【X鉴】/【X】` 等多种形式作为首标记。
  3. **提示词侧**：在 system prompt 对四个标记做硬约束（示例输出钉死格式）。
- **验证**：对 6 位先生各发 1 条，确认均渲染为四段卡（或至少命中段卡），无塌陷。

---

## P3 · 体验优化项（不阻塞上线，建议排期）

| 项 | 位置 | 说明 / 改法 |
|---|---|---|
| 次数徽标刷新回退 | `bootData()` ~L566 / `updateQuota()` ~L557 | `/balance` 只返回积分余额，不含当日剩余；刷新后徽标回退"限时免费·每日 10 次"。建议 `/balance`（或新接口）返回当日剩余次数并在初始化回填。 |
| 移动端点按热区 < 44px | CSS `.chip` L112 / `.send` L128 / `.bk` L133 / `.field` L125 | chip 32px、发送 36px、返回 30px、输入框 40px。提升到 ≥44px（加 `min-height`/`padding`）。 |
| 无障碍缺失 | HTML `index.html` | 顾问卡 `.adv` 为 `<div>` 无 `role`/`tabindex`，键盘不可达（旁 chip 是 `<button>` 正常）；输入框/发送按钮无可访问名称。补 `role="button" tabindex="0"` + 键盘事件；输入框补 `aria-label`，发送补 `aria-label`。 |
| 残留代码 | `ARTMAP` ~L191 / `.keychip` CSS | `ARTMAP` 中键 `sun:'sun'` 疑似应为 `sunzi`（现靠 fallback 兜底，无可见影响，属隐患）；`.keychip` CSS 无对应 DOM，可清理。 |
| 大厅上下文不落库 | `onTap()` chip 分支 L489 | 大厅点场景 chip → 会诊卡 → 点 CTA 进入对谈后，刚才那句不进会话历史。轻微，按需处理。 |
| `esc()` 不转义引号 | `esc()` ~L214 | 服务端下发 `data-chip` 用 `esc()` 拼属性，若含 `"` 会破坏属性；当前数据安全，属加固项。 |

## 回归验证清单（修复后必跑）
1. 网络拦截 `/gu/chat` 返回 `event: error` → 应出现错误卡，不再现空卡（P1-1）。
2. 拦截 `/balance` 返回 500 → Key 仍存在、徽标/额度不变（P1-2）。
3. 重复点击「真说过?」→ "先生小传"始终保留，只切换纠偏卡（P2-1）。
4. 6 位先生各发 1 条 → 均四段卡，无塌陷（P2-2）。
5. 回归冒烟：大厅→会诊→对谈→流式回答→换人→返回大厅；空发送/回车/连点守卫；额度第 11 次 429。

---
*附：完整测试报告（含截图）见 QA 产出 `全量测试报告-古人经营智慧.html`。*
