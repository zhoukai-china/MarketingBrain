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
  await page.goto(BASE + '/agents', { waitUntil: 'networkidle2', timeout: 30000 });
  await wait(1200);

  console.log('=== 顶栏状态（未登录） ===');
  const top = await page.evaluate(() => {
    const bar = document.querySelector('header,.eh-topbar,.topbar,body > div > div');
    const all = Array.from(document.querySelectorAll('body *'))
      .filter((e) => e.getBoundingClientRect().top < 90 && e.getBoundingClientRect().height > 0)
      .map((e) => (e.innerText || '').trim().replace(/\s+/g, ' '))
      .filter((t) => t && t.length < 60);
    return [...new Set(all)].slice(0, 14);
  });
  console.log(JSON.stringify(top, null, 1));

  console.log('\n=== 点「未登录 / 点击登录」 ===');
  const clicked = await clickByText(page, '未登录|点击登录|登录');
  console.log('点到:', clicked, '| URL:', page.url());
  await wait(2500);
  const s = await scan(page);
  await shot(page, '12-login');
  console.log('path:', s.url, '| title:', s.title);
  console.log('--- 登录页文案 ---');
  s.texts.slice(0, 35).forEach((x, i) => console.log(String(i).padStart(2), x.t));
  console.log('--- 输入控件 ---');
  console.log(JSON.stringify(s.inputs));
  console.log('--- 可点击 ---');
  s.clicks.slice(0, 20).forEach((x, i) => console.log(String(i).padStart(2), JSON.stringify(x.label)));

  console.log('\n=== 其他 Tab：AI案例 / 购物车 / 我的 ===');
  for (const name of ['AI案例', '购物车', '我的']) {
    await page.goto(BASE + '/agents', { waitUntil: 'networkidle2', timeout: 30000 });
    await wait(1000);
    const ok = await clickByText(page, name);
    await wait(1800);
    const st = await scan(page);
    await shot(page, `13-tab-${name}`);
    console.log(`\n[${name}] 点击=${ok} path=${st.url}`);
    console.log('  文案:', st.texts.slice(0, 22).map((x) => x.t).join(' ｜ ').slice(0, 500));
  }

  console.log('\n=== 充值页 ===');
  await page.goto(BASE + '/agents', { waitUntil: 'networkidle2', timeout: 30000 });
  await wait(1000);
  const ok2 = await clickByText(page, '^充值$');
  await wait(2000);
  const st2 = await scan(page);
  await shot(page, '14-recharge');
  console.log(`点击=${ok2} path=${st2.url}`);
  console.log('  文案:', st2.texts.slice(0, 25).map((x) => x.t).join(' ｜ ').slice(0, 500));

  console.log('\n--- JS 异常 ---');
  console.log(errors.length ? errors.join('\n') : '(无)');
  await browser.close();
})().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
