const { launch, scan, shot, BASE } = require('./lib.cjs');

(async () => {
  const { browser, page, errors } = await launch(true);
  const t0 = Date.now();
  await page.goto(BASE + '/agents', { waitUntil: 'networkidle2', timeout: 30000 });
  const loadMs = Date.now() - t0;
  await new Promise((r) => setTimeout(r, 1200));

  const s = await scan(page);
  await shot(page, '01-home-top');
  await shot(page, '01-home-full', true);

  console.log('=== 首页 /agents ===');
  console.log('加载耗时(ms):', loadMs);
  console.log('title:', s.title, '| path:', s.url);
  console.log('\n--- 页面可见文案（前 70 条）---');
  s.texts.slice(0, 70).forEach((x, i) => console.log(String(i).padStart(2), `[${x.tag}]`, x.t));
  console.log('\n--- 可点击元素（前 45 个）---');
  s.clicks.slice(0, 45).forEach((x, i) => console.log(String(i).padStart(2), `[${x.tag}]`, JSON.stringify(x.label), x.href ? '-> ' + x.href : '', x.cls ? '.' + x.cls : ''));
  console.log('\n--- 输入控件 ---');
  console.log(JSON.stringify(s.inputs, null, 1));
  console.log('\n--- JS 异常 / 控制台错误 ---');
  console.log(errors.length ? errors.join('\n') : '(无)');

  await browser.close();
})().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
