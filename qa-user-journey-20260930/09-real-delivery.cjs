const { launch, shot, BASE } = require('./lib.cjs');
const fs = require('fs');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const out = [];
const log = (...a) => { const s = a.join(' '); out.push(s); console.log(s); };

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

async function send(page, text) {
  await page.evaluate(() => {
    const el = document.querySelector('input:not([type="search"]),textarea,[contenteditable="true"]');
    if (el) el.focus();
  });
  await page.keyboard.type(text, { delay: 10 });
  await wait(300);
  return await clickByText(page, '^发送$');
}

(async () => {
  const { browser, page, errors } = await launch(true);

  // 登录拿算力
  await page.goto(BASE + '/login', { waitUntil: 'networkidle2', timeout: 20000 });
  await wait(1200);
  await page.evaluate(() => { const el = document.querySelector('input:not([type="search"])'); if (el) el.focus(); });
  await page.keyboard.type('测试火锅店', { delay: 20 });
  await wait(300);
  await clickByText(page, '进入思潼AI');
  await wait(3500);
  log('登录后算力:', await page.evaluate(() => (document.body.innerText.match(/算力\s*(\S+)/) || [])[1]));

  await page.goto(BASE + '/agent/ipzone__copy/workbench', { waitUntil: 'networkidle2', timeout: 20000 });
  await wait(1500);

  const answers = ['社区火锅店', '人均59元，鲜切牛肉现切', '抖音', '点团购链接到店核销', '内容十件套', '老板出镜'];
  log('\n=== 逐题作答 ===');
  for (let i = 0; i < 8; i++) {
    const p = await page.evaluate(() => {
      const m = /(\d+)\s*\/\s*6/.exec(document.body.innerText);
      return m ? Number(m[1]) : -1;
    });
    if (p >= 6) { log('进度已满:', p); break; }
    const q = await page.evaluate(() => {
      const ts = document.body.innerText.split('\n').map((t) => t.trim()).filter(Boolean);
      const qs = ts.filter((t) => /[？?]$/.test(t) && t.length < 40 && !/赶时间/.test(t));
      return qs.length ? qs[qs.length - 1] : '(未识别)';
    });
    const a = answers[p] || answers[answers.length - 1];
    await send(page, a);
    await wait(2800);
    const np = await page.evaluate(() => {
      const m = /(\d+)\s*\/\s*6/.exec(document.body.innerText);
      return m ? Number(m[1]) : -1;
    });
    log(`[${p}/6] 问: ${q} → 答: ${a} → 新进度 ${np}`);
  }
  await shot(page, '25-brief-clean', true);

  const balBefore = await page.evaluate(() => (document.body.innerText.match(/算力\s*(\d+)/) || [])[1]);
  log('\n生成前算力:', balBefore);
  const t0 = Date.now();
  const ok = await clickByText(page, '开始创作');
  log('点开始创作:', ok, '开始计时');

  let result = '（未获得交付物）';
  for (let t = 1; t <= 20; t++) {
    await wait(6000);
    const el = ((Date.now() - t0) / 1000).toFixed(0);
    const r = await page.evaluate(() => {
      const t = document.body.innerText.replace(/\s+/g, ' ');
      const hasContent = /标题|正文|话题|口播|拍摄/.test(t.slice(-1500));
      return { url: location.pathname, tail: t.slice(-560), len: t.length };
    });
    log(`--- ${el}s --- len=${r.len} ${r.tail.slice(0, 260)}`);
    if (/失败|错误|不足|已过期|异常/.test(r.tail)) { result = '报错: ' + r.tail.slice(-260); await shot(page, '26-error'); break; }
    if (r.len > 3000 && /标题|口播|话题/.test(r.tail)) { result = '拿到交付物'; await shot(page, '27-delivered', true); break; }
    if (el > 110) { log('（超 110s 停止）'); await shot(page, '26-timeout', true); break; }
  }
  log('\n最终结果:', result);
  log('生成后算力:', await page.evaluate(() => (document.body.innerText.match(/算力\s*(\d+)/) || [])[1]));

  log('\n--- JS 异常 ---');
  log(errors.length ? errors.join('\n') : '(无)');
  fs.writeFileSync('/Users/zhoukai/code/MarketingBrain/qa-user-journey-20260930/09-result.txt', out.join('\n'));
  await browser.close();
})().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
