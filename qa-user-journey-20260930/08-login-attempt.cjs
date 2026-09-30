const { launch, scan, shot, BASE } = require('./lib.cjs');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

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

(async () => {
  const { browser, page, errors } = await launch(true);
  await page.goto(BASE + '/login', { waitUntil: 'networkidle2', timeout: 20000 });
  await wait(1500);

  console.log('=== 登录页完整结构 ===');
  const s0 = await scan(page);
  s0.texts.forEach((x, i) => console.log(String(i).padStart(2), x.t));
  console.log('可点击:', JSON.stringify(s0.clicks.map((c) => c.label)));
  console.log('输入框:', JSON.stringify(s0.inputs));
  await shot(page, '20-login-page', true);

  console.log('\n=== 尝试登录：只填企业名 ===');
  await page.evaluate(() => {
    const el = document.querySelector('input:not([type="search"])');
    if (el) el.focus();
  });
  await page.keyboard.type('测试火锅店', { delay: 25 });
  await wait(400);
  const okGo = await clickByText(page, '进入思潼AI|进入|登录|开通');
  console.log('点进入:', okGo);
  await wait(4000);
  console.log('URL:', page.url());
  const s1 = await page.evaluate(() => document.body.innerText.replace(/\s+/g, ' ').slice(0, 500));
  console.log('落地页文本:', s1);
  await shot(page, '21-after-login');

  // 看顶栏余额是否变化
  const bal = await page.evaluate(() => {
    const t = document.body.innerText.replace(/\s+/g, ' ');
    const m = /算力\s*([^\s]{1,10})/.exec(t);
    return m ? m[1] : '(未识别)';
  });
  console.log('顶栏算力值:', bal);

  console.log('\n=== 如有身份，重跑一次文案工作台 ===');
  await page.goto(BASE + '/agent/ipzone__copy/workbench', { waitUntil: 'networkidle2', timeout: 20000 });
  await wait(1500);
  // 快速填完 6 问
  for (let i = 0; i < 7; i++) {
    const done = await page.evaluate(() => /6\s*\/\s*6/.test(document.body.innerText));
    if (done) { console.log('  引导已满 6/6'); break; }
    await page.evaluate(() => {
      const el = document.querySelector('input:not([type="search"]),textarea,[contenteditable="true"]');
      if (el) el.focus();
    });
    await page.keyboard.type('社区火锅店，人均59元鲜切牛肉，抖音，到店核销，内容十件套，老板出镜', { delay: 8 });
    await wait(300);
    await clickByText(page, '^发送$');
    await wait(2800);
    const p = await page.evaluate(() => {
      const m = /(\d+)\s*\/\s*6/.exec(document.body.innerText);
      return m ? m[1] : '?';
    });
    console.log('  轮', i + 1, '进度', p);
  }
  await shot(page, '22-wb-loggedin');

  const t0 = Date.now();
  await clickByText(page, '开始创作');
  console.log('\n已点开始创作，开始计时…');
  for (let t = 1; t <= 10; t++) {
    await wait(6000);
    const el = Date.now() - t0;
    const r = await page.evaluate(() => {
      const t = document.body.innerText.replace(/\s+/g, ' ');
      return { url: location.pathname, tail: t.slice(-420) };
    });
    console.log(`\n--- ${(el / 1000).toFixed(0)}s --- ${r.url}`);
    console.log('   ', r.tail);
    if (/失败|错误|不足|登录已过期/.test(r.tail)) { await shot(page, `23-err-${t}`); break; }
    if (el > 60000) { console.log('（超时 60s 停止）'); break; }
  }
  await shot(page, '24-final-loggedin', true);

  console.log('\n--- JS 异常 ---');
  console.log(errors.length ? errors.join('\n') : '(无)');
  await browser.close();
})().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
