const { launch, shot, BASE } = require('./lib.cjs');
const fs = require('fs');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const out = [];
const log = (...a) => { const s = a.join(' '); out.push(s); console.log(s); };

async function briefState(page) {
  return await page.evaluate(() => {
    const t = document.body.innerText;
    const pending = (t.match(/待填/g) || []).length;
    const prog = (t.match(/(\d+)\s*\/\s*6/) || [])[1];
    const startBtn = Array.from(document.querySelectorAll('button')).find((b) => /开始创作/.test(b.innerText || ''));
    return { pending, prog, disabled: startBtn ? !!startBtn.disabled : null };
  });
}

async function clickByText(page, re) {
  return await page.evaluate((src) => {
    const rx = new RegExp(src);
    const el = Array.from(document.querySelectorAll('button,a,[role="button"]'))
      .find((e) => rx.test((e.innerText || '').trim()) && e.getBoundingClientRect().height > 0);
    if (!el) return false;
    el.click();
    return true;
  }, re);
}

// 点当前可见的第一个"推荐选项"按钮（排除功能按钮）
async function pickFirstOption(page) {
  return await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button')).filter((b) => {
      const r = b.getBoundingClientRect();
      const t = (b.innerText || '').trim();
      return r.height > 0 && r.height < 90 && t && t.length < 46 &&
        !/发送|重置|返回|充值|开始创作|先铺底稿|首页|案例|购物车|我的/.test(t);
    });
    if (!btns.length) return null;
    const b = btns[0];
    const label = (b.innerText || '').trim().replace(/\s+/g, ' ');
    b.click();
    return label;
  });
}

(async () => {
  const { browser, page, errors } = await launch(true);
  await page.goto(BASE + '/login', { waitUntil: 'networkidle2', timeout: 20000 });
  await wait(1200);
  await page.evaluate(() => { const el = document.querySelector('input:not([type="search"])'); if (el) el.focus(); });
  await page.keyboard.type('测试火锅店', { delay: 20 });
  await wait(300);
  await clickByText(page, '进入思潼AI');
  await wait(3000);

  await page.goto(BASE + '/agent/ipzone__copy/workbench', { waitUntil: 'networkidle2', timeout: 20000 });
  await wait(1800);
  log('初始:', JSON.stringify(await briefState(page)));

  log('\n=== 用「点推荐选项」方式填满简报 ===');
  for (let i = 0; i < 10; i++) {
    const st = await briefState(page);
    log(`轮${i + 1}: 进度=${st.prog} 待填=${st.pending} 按钮disabled=${st.disabled}`);
    if (st.pending === 0) { log('所有字段已填'); break; }
    const picked = await pickFirstOption(page);
    log('   点了选项:', picked);
    await wait(2600);
  }
  await shot(page, '28-brief-all-filled', true);
  const stEnd = await briefState(page);
  log('\n最终简报状态:', JSON.stringify(stEnd));

  if (stEnd.pending === 0 && stEnd.disabled === false) {
    const bal0 = await page.evaluate(() => (document.body.innerText.match(/算力\s*(\d+)/) || [])[1]);
    log('\n=== 点开始创作（算力', bal0, '）===');
    const t0 = Date.now();
    await clickByText(page, '开始创作');
    for (let t = 1; t <= 18; t++) {
      await wait(6000);
      const el = ((Date.now() - t0) / 1000).toFixed(0);
      const r = await page.evaluate(() => {
        const t = document.body.innerText.replace(/\s+/g, ' ');
        return { len: t.length, tail: t.slice(-500) };
      });
      log(`${el}s len=${r.len} | ${r.tail.slice(0, 200)}`);
      if (/失败|错误|不足|已过期/.test(r.tail)) { await shot(page, '29-err'); break; }
      if (r.len > 3500) { await shot(page, '30-delivered', true); log('疑似产出内容'); break; }
      if (el > 100) { log('超时停止'); await shot(page, '29-timeout', true); break; }
    }
    log('生成后算力:', await page.evaluate(() => (document.body.innerText.match(/算力\s*(\d+)/) || [])[1]));
  } else {
    log('\n未满足生成条件，跳过生成');
  }

  log('\n--- JS 异常 ---');
  log(errors.length ? errors.join('\n') : '(无)');
  fs.writeFileSync('/Users/zhoukai/code/MarketingBrain/qa-user-journey-20260930/10-result.txt', out.join('\n'));
  await browser.close();
})().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
