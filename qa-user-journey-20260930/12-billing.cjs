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
async function pickFirstOption(page) {
  return await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button')).filter((b) => {
      const r = b.getBoundingClientRect();
      const t = (b.innerText || '').trim();
      return r.height > 0 && r.height < 90 && t && t.length < 46 &&
        !/发送|重置|返回|充值|开始创作|先铺底稿|首页|案例|购物车|我的/.test(t);
    });
    if (!btns.length) return null;
    const b = btns[0]; b.click(); return (b.innerText || '').trim().replace(/\s+/g, ' ').slice(0, 26);
  });
}
const bal = (page) => page.evaluate(() => {
  const t = document.body.innerText;
  const m = /算力\s*([\d—-]+)/.exec(t);
  return m ? m[1] : '?';
});

(async () => {
  const { browser, page, errors } = await launch(true);
  await page.goto(BASE + '/login', { waitUntil: 'networkidle2', timeout: 20000 });
  await wait(1200);
  await page.evaluate(() => { const el = document.querySelector('input:not([type="search"])'); if (el) el.focus(); });
  await page.keyboard.type('测试火锅店', { delay: 20 });
  await wait(300);
  await clickByText(page, '进入思潼AI');
  await wait(3000);
  log('登录后算力:', await bal(page));

  await page.goto(BASE + '/agent/ipzone__copy/workbench', { waitUntil: 'networkidle2', timeout: 20000 });
  await wait(1600);
  for (let i = 0; i < 9; i++) {
    const p = await page.evaluate(() => (document.body.innerText.match(/待填/g) || []).length);
    if (p === 0) break;
    await pickFirstOption(page);
    await wait(2300);
  }
  log('生成前算力:', await bal(page));

  const t0 = Date.now();
  await clickByText(page, '开始创作');
  let done = false;
  for (let t = 1; t <= 15; t++) {
    await wait(4000);
    const r = await page.evaluate(() => {
      const t = document.body.innerText.replace(/\s+/g, ' ');
      return { len: t.length, has: /话题|口播|正文|标题/.test(t.slice(-1200)) };
    });
    const el = ((Date.now() - t0) / 1000).toFixed(0);
    if (r.len > 3000 && r.has) { log(`✅ ${el}s 出现交付内容（文本长度 ${r.len}）`); done = true; break; }
  }
  if (!done) log('❌ 60s 内未出现交付内容');
  await wait(3000);
  log('生成后算力:', await bal(page));

  const r = await page.evaluate(() => {
    const t = document.body.innerText.replace(/\s+/g, ' ');
    return {
      placeholder: (t.match(/待补充|待填|XXX|占位/g) || []).length,
      tail: t.slice(-700),
      hasExport: /导出|Word|WPS|复制/.test(t),
    };
  });
  log('\n交付物里「待补充/占位」出现次数:', r.placeholder);
  log('是否有导出/复制入口:', r.hasExport);
  log('\n交付内容尾部:\n', r.tail);
  await shot(page, '31-delivery-final', true);

  // 我的订单
  await page.goto(BASE + '/agents', { waitUntil: 'networkidle2', timeout: 20000 });
  await wait(1200);
  await clickByText(page, '^我的$');
  await wait(2500);
  const mine = await page.evaluate(() => document.body.innerText.replace(/\s+/g, ' ').slice(0, 460));
  log('\n=== 我的（生成后）===\n', mine);
  await shot(page, '32-mine-after', true);

  log('\n--- JS 异常 ---');
  log(errors.length ? errors.join('\n') : '(无)');
  fs.writeFileSync('/Users/zhoukai/code/MarketingBrain/qa-user-journey-20260930/12-result.txt', out.join('\n'));
  await browser.close();
})().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
