const { launch, scan, shot, BASE } = require('./lib.cjs');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function clickByText(page, re, tag = 'button') {
  return await page.evaluate((reSrc, tag) => {
    const rx = new RegExp(reSrc);
    const els = Array.from(document.querySelectorAll(tag + ',a,[role="button"]'));
    const el = els.find((e) => rx.test((e.innerText || '').trim()) && e.getBoundingClientRect().height > 0);
    if (!el) return false;
    el.click();
    return true;
  }, re, tag);
}

async function clickInput(page) {
  return await page.evaluate(() => {
    const el = document.querySelector('input:not([type="search"]),textarea,[contenteditable="true"]');
    if (!el) return false;
    el.focus();
    return el.getAttribute('placeholder') || '(输入框)';
  });
}

(async () => {
  const { browser, page, errors } = await launch(true);
  await page.goto(BASE + '/agent/ipzone__copy/workbench', { waitUntil: 'networkidle2', timeout: 30000 });
  await wait(1500);

  console.log('=== 步骤 5：真实走 6 问引导（点推荐选项 / 打字） ===');
  const ph = await clickInput(page);
  console.log('输入框 placeholder:', ph);

  const steps = [
    { pick: '餐饮门店', type: '' },
    { pick: '抖音', type: '' },
    { pick: '', type: '人均59元的社区火锅，主打鲜切牛肉和夜宵到凌晨2点' },
    { pick: '', type: '到店核销，希望用户点团购链接' },
    { pick: '深度', type: '' },
    { pick: '不出镜', type: '' },
  ];

  for (let i = 0; i < steps.length; i++) {
    const st = steps[i];
    let ok = false;
    if (st.pick) ok = await clickByText(page, st.pick);
    if (!ok && st.type) {
      await clickInput(page);
      await page.keyboard.type(st.type, { delay: 12 });
      await wait(300);
      ok = await clickByText(page, '^发送$');
    }
    await wait(2600);
    const s = await scan(page);
    const brief = s.texts.filter((x) => /\/\s*6/.test(x.t)).map((x) => x.t)[0] || '?';
    const lastQ = s.texts.slice(-6).map((x) => x.t).join(' | ').slice(0, 160);
    console.log(`第${i + 1}步 [${st.pick || st.type.slice(0, 12)}] ok=${ok} | 进度=${brief}`);
    console.log('        最近文案:', lastQ);
  }

  await shot(page, '07-brief-filled', true);

  console.log('\n=== 步骤 6：点「开始创作」（真正要花钱的一步） ===');
  const t0 = Date.now();
  const clicked = await clickByText(page, '开始创作');
  console.log('点到开始创作:', clicked, '| URL:', page.url());
  await wait(6000);
  const s = await scan(page);
  await shot(page, '08-after-generate');
  console.log('6 秒后 URL:', page.url(), '| 耗时', Date.now() - t0, 'ms');
  console.log('--- 页面文案（后 45 条）---');
  s.texts.slice(-45).forEach((x, i) => console.log(String(i).padStart(2), x.t));
  console.log('--- 可点击（后 15）---');
  s.clicks.slice(-15).forEach((x, i) => console.log(String(i).padStart(2), JSON.stringify(x.label)));

  console.log('\n--- JS 异常 ---');
  console.log(errors.length ? errors.join('\n') : '(无)');
  await browser.close();
})().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
