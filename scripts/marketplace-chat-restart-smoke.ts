/**
 * 2026-09-17 现场缺陷回归（用户：「既不能重新开始 也不能正确识别复盘文件」）。
 *
 * 两句人话必须成立：
 *   ① 在对话框里打「重新开始」= 真的重开一轮（不是被当成当前这一轮的答案，
 *      更不是回一句「先别急——我还没拿到你的数据」把人困住）；
 *   ② 重开要清干净——填写内容、附件、本机留存一起清，不能把上一轮的文件悄悄带进新一轮。
 *
 * 纯离线：一部分跑真实的 `isRestartCommand()`，一部分是源码契约（防止把分支挪到
 * 「补充信息」后面、或者又把附件清理删掉）。
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { isRestartCommand } from "../apps/web/src/marketplace/chat-commands.js";

function main(): void {
  // --- ① 命令识别：整句匹配 ---
  const commands = ["重新开始", "重新开始。", "重新开始！", " 重新开始 ", "请重新开始", "重新开始吧", "重来", "重开", "重新填", "从头开始", "再来一次"];
  for (const value of commands) {
    assert.equal(isRestartCommand(value), true, `「${value}」必须被当成重开命令`);
  }

  // --- 不能劫持正常回答：句子里还有别的字就照常当答案 ---
  const notCommands = ["重新开始写文案", "复盘", "重新开始的原因是我换了个账号", "重新", "开始重新做一版选题", ""];
  for (const value of notCommands) {
    assert.equal(isRestartCommand(value), false, `「${value}」不能被当成重开命令`);
  }

  // --- ② 源码契约：分支位置与清理范围 ---
  const app = readFileSync("apps/web/src/marketplace/AgentChatPage.tsx", "utf8");
  const send = app.indexOf("async function submitAnswer(");
  assert.ok(send > 0, "AgentChatPage 必须还有 submitAnswer()");
  const body = app.slice(send, app.indexOf("function confirmBrief()", send));

  const restartBranch = body.indexOf("isRestartCommand(value)");
  const supplementBranch = body.indexOf("if (awaitingSupplement)");
  /**
   * 2026-09-21：对话页把 flow.slots 解构成局部 `slots` 之后，这条取值一直取不到（-1），
   * 「重开分支必须在数据闸门之前」的守护实际失效。这里只对齐变量名，语义不变。
   */
  const vidrevGate = body.indexOf('slots[step].key === "data"');
  assert.ok(restartBranch > 0, "submitAnswer() 必须先认「重新开始」命令");
  assert.ok(
    restartBranch < supplementBranch && restartBranch < vidrevGate,
    "「重新开始」分支必须在「补充信息」和视频复盘数据闸门之前，否则还是会被吃掉"
  );

  const resetStart = app.indexOf("function resetConversationState()");
  assert.ok(resetStart > 0, "必须把重开要清的东西收在 resetConversationState() 里");
  const resetBody = app.slice(resetStart, app.indexOf("function restart()", resetStart));
  assert.ok(
    resetBody.includes("setAttachments([])"),
    "重开必须清掉已上传附件——否则新一轮会带着上一轮的数据表跑"
  );
  assert.ok(
    /localStorage\.removeItem\(`sitong_chat_\$\{runSku\??\.skuCode\}`\)/.test(resetBody),
    "重开必须清本机留存"
  );
  assert.ok(resetBody.includes("setAnswers({})") && resetBody.includes("setStep(0)"), "重开必须清填写内容并回到第一轮");

  const restartFn = app.slice(app.indexOf("function restart()"));
  assert.ok(restartFn.includes("resetConversationState()"), "「再问一次 / 重新开始」按钮必须复用同一套清理");

  /**
   * 2026-09-17 用户第二次现场（文案智能体）：「打了重新开始也没有正确重新开始 应该做一个重新开始的功能
   * 才对 每个智能体都要有一个重新开始的功能才对」——验证两件事：
   *   ① 页面上必须有**看得见**的「↺ 重新开始」按钮（不能只有输入框口令）；
   *   ② 按钮在「补充信息」状态下也要在（那一轮最容易卡住），点了就走同一套重置。
   */
  assert.ok(app.includes("↺ 重新开始"), "对话页必须有看得见的「↺ 重新开始」按钮，不能只靠输入口令");
  assert.ok(
    /hasProgress\s*=[\s\S]{0,200}awaitingSupplement/.test(app),
    "「补充信息」等状态下也必须算「已开始」，重启按钮要显示"
  );
  assert.ok(
    /onClick=\{restart\}/.test(app),
    "「↺ 重新开始」按钮必须直接调用 restart()（与口令走同一套重置）"
  );
  // 每个货架智能体都用同一个对话页组件渲染，所以这个按钮对所有智能体生效。
  assert.ok(
    app.includes("MarketplaceAgentChatPage"),
    "对话页组件必须是所有货架智能体共用的那一个（按钮因此覆盖全部智能体）"
  );

  // 本机留存不含附件正文：恢复到「数据」这一轮时必须明说「文件要重新传」。
  assert.ok(
    app.includes("上传的文件不会保存在浏览器里"),
    "恢复本机留存时，视频复盘的「数据」轮必须说明附件需要重新上传"
  );

  console.log(
    JSON.stringify({
      result: "MARKETPLACE_CHAT_RESTART_PASS",
      restartCommands: commands.length,
      nonCommands: notCommands.length,
      attachmentsClearedOnRestart: true,
      resetBeforeVidrevGate: true
    })
  );
}

main();
