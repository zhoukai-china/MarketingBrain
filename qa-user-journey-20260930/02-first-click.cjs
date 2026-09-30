const { launch, scan, shot, BASE } = require('./lib.cjs');

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const { browser, page, errors } = await launch(true);
  await page.goto(BASE + '/agents', { waitUntil: 'networkidle2', timeout: 30000 });
  await wait(1200);

  console.log('=== 步骤 2：新用户第一次点击「今天要发内容」 ===');
  const before = page.url();
  await page.evaluate(() => {
    const items = Array.from(document.querySelectorAll('.eco-today-item'));
    const t = items.find((e) => /今天要发内容/.test(e.innerText));
    (t || items[0]).click();
  });
  await wait(2500);
  const after = page.url();
  console.log('点击前:', before);
  console.log('点击后:', after);
  const s2 = await scan(page);
  await shot(page, '02-after-today-task');
  console.log('path:', s2.url, '| title:', s2.title);
  console.log('--- 落地页文案（前 40 条）---');
  s2.texts.slice(0, 40).forEach((x, i) => console.log(String(i).padStart(2), x.t));
  console.log('--- 输入控件 ---');
  console.log(JSON.stringify(s2.inputs));

  // 回首页，点秦文卡片
  console.log('\n=== 步骤 3：回到首页，点智能体「秦文」卡片 ===');
  await page.goto(BASE + '/agents', { waitUntil: 'networkidle2', timeout: 30000 });
  await wait(1200);
  const clicked = await page.evaluate(() => {
    const cards = Array.from(document.querySelectorAll('body *')).filter(
      (e) => /秦文/.test(e.innerText || '') && e.getBoundingClientRect().height > 60 && e.getBoundingClientRect().height < 320
    );
    if (!cards.length) return false;
    cards[cards.length - 1].click();
    return true;
  });
  console.log('是否点到卡片:', clicked);
  await wait(2500);
  const s3 = await scan(page);
  await shot(page, '03-agent-detail', true);
  console.log('path:', s3.url, '| title:', s3.title);
  console.log('--- 详情页文案（前 55 条）---');
  s3.texts.slice(0, 55).forEach((x, i) => console.log(String(i).padStart(2), x.t));
  console.log('--- 可点击（前 25）---');
  s3.clicks.slice(0, 25).forEach((x, i) => console.log(String(i).padStart(2), JSON.stringify(x.label), x.href || ''));

  console.log('\n--- JS 异常 ---');
  console.log(errors.length ? errors.join('\n') : '(无)');
  await browser.close();
})().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
