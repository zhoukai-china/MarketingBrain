const puppeteer = require('puppeteer-core');
const EXEC = '/Users/zhoukai/.cache/puppeteer/chrome-headless-shell/mac_arm-150.0.7871.24/chrome-headless-shell-mac-arm64/chrome-headless-shell';

(async () => {
  const browser = await puppeteer.launch({
    executablePath: EXEC,
    headless: true,
    args: ['--no-proxy-server', '--no-sandbox', '--disable-setuid-sandbox'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });
  const fails = [];
  try {
    await page.goto('http://localhost:5174/login', { waitUntil: 'networkidle2', timeout: 60000 });
  } catch (e) { fails.push('goto: ' + e.message); }
  await page.waitForSelector('.loginPage', { timeout: 20000 }).catch(e => fails.push('no .loginPage'));

  const r = await page.evaluate(() => {
    const out = {};
    const lp = document.querySelector('.loginPage');
    const cs = lp && getComputedStyle(lp);
    out.loginBgImage = cs ? cs.backgroundImage.slice(0, 50) : null;
    const mark = document.querySelector('.lhw-mark');
    out.mark = mark ? mark.textContent.trim() : null;
    const h2 = document.querySelector('.loginHeroWall h2');
    out.h2 = h2 ? h2.textContent.replace(/\s+/g, '') : null;
    const tag = document.querySelector('.lhw-tag');
    out.tag = tag ? tag.textContent.trim() : null;
    const submit = document.querySelector('.loginSubmit');
    const scs = submit && getComputedStyle(submit);
    out.submitBg = scs ? scs.backgroundImage.slice(0, 70) : null;
    const wall = document.querySelector('.loginHeroWall');
    out.wallBg = wall ? getComputedStyle(wall).backgroundColor : null;
    const o = document.querySelector('.lhw-orbit');
    out.orbitColor = o ? getComputedStyle(o).color : null;
    return out;
  });
  console.log('CAPTURED:', JSON.stringify(r, null, 2));

  const checks = [
    ['印记 = 潼', r.mark === '潼'],
    ['主标含「一处入口」', (r.h2 || '').includes('一处入口')],
    ['主标含「贯通全平台智能体」', (r.h2 || '').includes('贯通全平台智能体')],
    ['副标含「结果导向」', (r.tag || '').includes('结果导向')],
    ['登录页深色渐变底', /gradient/.test(r.loginBgImage || '')],
    ['品牌墙深色 rgb(16,16,20)', r.wallBg === 'rgb(16, 16, 20)'],
    ['提交按钮橙渐变', /gradient/.test(r.submitBg || '') && /255,\s*138,\s*61/.test(r.submitBg || '')],
    ['圆弧橙色 rgb(255,138,61)', (r.orbitColor || '').replace(/\s/g, '') === 'rgb(255,138,61)'],
  ];
  let allPass = true;
  for (const [n, v] of checks) { console.log((v ? 'PASS' : 'FAIL') + ' - ' + n); if (!v) allPass = false; }
  console.log(allPass ? '\nALL PASS' : '\nSOME FAIL');
  await browser.close();
  process.exit(allPass ? 0 : 1);
})().catch(e => { console.error('SCRIPT ERROR', e); process.exit(2); });
