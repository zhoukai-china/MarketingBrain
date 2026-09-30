const { launch, scan, shot, BASE } = require('./lib.cjs');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const { browser, page, errors } = await launch(true);
  await page.goto(BASE + '/agent/ipzone__copy/detail', { waitUntil: 'networkidle2', timeout: 30000 });
  await wait(1500);

  console.log('=== 步骤 4：未登录点「⚡ 立即使用」 ===');
  await page.evaluate(() => {
    const b = Array.from(document.querySelectorAll('button,a')).find((e) => /立即使用/.test(e.innerText || ''));
    if (b) b.click();
  });
  await wait(3000);
  const s = await scan(page);
  await shot(page, '04-after-try-use');
  console.log('落地 URL:', page.url());
  console.log('title:', s.title);
  console.log('--- 文案（前 45 条）---');
  s.texts.slice(0, 45).forEach((x, i) => console.log(String(i).padStart(2), x.t));
  console.log('--- 输入控件 ---');
  console.log(JSON.stringify(s.inputs));
  console.log('--- 可点击（前 20）---');
  s.clicks.slice(0, 20).forEach((x, i) => console.log(String(i).padStart(2), JSON.stringify(x.label)));

  // 如果进了工作台，试着真的发一句话
  const inWb = /workbench|chat/i.test(page.url());
  console.log('\n是否进入工作台:', inWb);
  if (inWb) {
    console.log('\n=== 步骤 5：像真实用户一样发一句话 ===');
    const typed = await page.evaluate(() => {
      const el = document.querySelector('textarea,input[type="text"],[contenteditable="true"]');
      if (!el) return false;
      el.focus();
      return true;
    });
    console.log('找到输入框:', typed);
    if (typed) {
      await page.type('textarea,input[type="text"],[contenteditable="true"]', '给一家社区火锅店写一条抖音文案，主打人均59元', { delay: 20 });
      await wait(600);
      await shot(page, '05-typed');
      console.log('已输入，尝试发送…');
      await page.evaluate(() => {
        const b = Array.from(document.querySelectorAll('button')).find((e) => /发送/.test(e.innerText || ''));
        if (b) b.click();
      });
      await wait(8000);
      const s2 = await scan(page);
      await shot(page, '06-after-send');
      console.log('发送后 URL:', page.url());
      console.log('--- 发送后新增文案（后 40 条）---');
      s2.texts.slice(-40).forEach((x, i) => console.log(String(i).padStart(2), x.t));
    }
  }

  console.log('\n--- JS 异常 ---');
  console.log(errors.length ? errors.join('\n') : '(无)');
  await browser.close();
})().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
