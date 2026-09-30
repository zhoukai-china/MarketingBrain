const { launch, BASE } = require('./lib.cjs');
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
    b.click();
    return (b.innerText || '').trim().replace(/\s+/g, ' ').slice(0, 30);
  });
}

(async () => {
  const { browser, page } = await launch(true);
  const reqs = [];
  page.on('request', (r) => {
    if (/api|chat|run|generate|agent/i.test(r.url()) && r.resourceType() !== 'document') {
      reqs.push({ t: 'REQ', m: r.method(), u: r.url().replace(BASE, '').slice(0, 90) });
    }
  });
  page.on('response', async (r) => {
    const u = r.url();
    if (!/api|chat|run|generate|agent/i.test(u)) return;
    let body = '';
    try { body = (await r.text()).slice(0, 240); } catch (e) { body = '(无法读取)'; }
    reqs.push({ t: 'RES', s: r.status(), u: u.replace(BASE, '').slice(0, 90), b: body.replace(/\s+/g, ' ') });
  });

  await page.goto(BASE + '/login', { waitUntil: 'networkidle2', timeout: 20000 });
  await wait(1200);
  await page.evaluate(() => { const el = document.querySelector('input:not([type="search"])'); if (el) el.focus(); });
  await page.keyboard.type('测试火锅店', { delay: 20 });
  await wait(300);
  await clickByText(page, '进入思潼AI');
  await wait(3000);

  await page.goto(BASE + '/agent/ipzone__copy/workbench', { waitUntil: 'networkidle2', timeout: 20000 });
  await wait(1500);
  reqs.length = 0;

  log('=== 填简报（点选项）===');
  for (let i = 0; i < 9; i++) {
    const pending = await page.evaluate(() => (document.body.innerText.match(/待填/g) || []).length);
    if (pending === 0) { log('填满'); break; }
    await pickFirstOption(page);
    await wait(2400);
  }

  log('\n=== 点开始创作，监控网络 ===');
  reqs.length = 0;
  await clickByText(page, '开始创作');
  await wait(20000);
  reqs.forEach((r) => log(`[${r.t}] ${r.s || ''} ${r.m || ''} ${r.u} ${r.b || ''}`));
  if (!reqs.length) log('（20 秒内没有任何 API 请求 —— 前端根本没发请求）');

  log('\n页面尾部:', await page.evaluate(() => document.body.innerText.replace(/\s+/g, ' ').slice(-300)));
  fs.writeFileSync('/Users/zhoukai/code/MarketingBrain/qa-user-journey-20260930/11-result.txt', out.join('\n'));
  await browser.close();
})().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
