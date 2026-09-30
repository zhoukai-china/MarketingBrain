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

  console.log('=== A. 直接访问 /login 是否存在 ===');
  await page.goto(BASE + '/login', { waitUntil: 'networkidle2', timeout: 20000 }).catch(() => {});
  await wait(1500);
  let s = await scan(page);
  console.log('path:', s.url, '| title:', s.title);
  console.log('文案前 15:', s.texts.slice(0, 15).map((x) => x.t).join(' ｜ ').slice(0, 300));
  console.log('输入控件:', JSON.stringify(s.inputs));

  console.log('\n=== B. 首页「充值」按钮：点后 3 秒看有无弹层 ===');
  await page.goto(BASE + '/agents', { waitUntil: 'networkidle2', timeout: 20000 });
  await wait(1200);
  const before = await page.evaluate(() => document.body.innerText.length);
  const okR = await clickByText(page, '^充值$');
  await wait(3000);
  const after = await page.evaluate(() => {
    const dialogs = Array.from(document.querySelectorAll('div'))
      .filter((e) => {
        const st = getComputedStyle(e);
        return /fixed|absolute/.test(st.position) && e.getBoundingClientRect().height > 120;
      })
      .map((e) => (e.innerText || '').trim().replace(/\s+/g, ' ').slice(0, 200));
    return { len: document.body.innerText.length, dialogs: [...new Set(dialogs)].slice(0, 6) };
  });
  console.log('点到充值:', okR, '| 文本长度 before/after:', before, '->', after.len);
  console.log('弹层:', JSON.stringify(after.dialogs, null, 1));
  await shot(page, '15-recharge-click');

  console.log('\n=== C. 购物车 Tab：点后是否有任何变化 ===');
  const okC = await clickByText(page, '^购物车$');
  await wait(2500);
  const c = await page.evaluate(() => ({
    url: location.pathname,
    hasCart: /购物车/.test(document.body.innerText),
    snippet: document.body.innerText.replace(/\s+/g, ' ').slice(0, 260),
  }));
  console.log('点到购物车:', okC, '| path:', c.url);
  console.log('页面开头文本:', c.snippet);
  await shot(page, '16-cart');

  console.log('\n=== D. 「我的」页 → 每日签到（能不能拿到算力） ===');
  await clickByText(page, '^我的$');
  await wait(2000);
  await shot(page, '17-mine', true);
  const mineBefore = await page.evaluate(() => document.body.innerText.replace(/\s+/g, ' ').slice(0, 400));
  console.log('我的页:', mineBefore);
  const okS = await clickByText(page, '签到');
  await wait(3000);
  const mineAfter = await page.evaluate(() => document.body.innerText.replace(/\s+/g, ' ').slice(0, 400));
  console.log('\n点签到:', okS);
  console.log('签到后:', mineAfter);
  await shot(page, '18-after-signin');

  console.log('\n=== E. 搜索框试用 ===');
  await page.goto(BASE + '/agents', { waitUntil: 'networkidle2', timeout: 20000 });
  await wait(1000);
  await page.evaluate(() => {
    const el = document.querySelector('input[type="search"]');
    if (el) el.focus();
  });
  await page.keyboard.type('直播', { delay: 30 });
  await wait(2500);
  const sr = await page.evaluate(() => document.body.innerText.replace(/\s+/g, ' ').slice(0, 400));
  console.log('搜「直播」后:', sr);
  await shot(page, '19-search');

  console.log('\n--- JS 异常 ---');
  console.log(errors.length ? errors.join('\n') : '(无)');
  await browser.close();
})().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
