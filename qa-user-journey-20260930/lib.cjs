const puppeteer = require('puppeteer-core');

const CHROME = '/Users/zhoukai/.cache/puppeteer/chrome-headless-shell/mac_arm-150.0.7871.24/chrome-headless-shell-mac-arm64/chrome-headless-shell';
const BASE = 'http://127.0.0.1:5174';

async function launch(mobile = true) {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'shell',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--no-proxy-server',
      '--disable-dev-shm-usage',
      '--disable-gpu',
    ],
    defaultViewport: mobile
      ? { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true }
      : { width: 1440, height: 900, deviceScaleFactor: 1 },
  });
  const page = await browser.newPage();
  if (mobile) {
    await page.setUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1');
  }
  const errors = [];
  page.on('pageerror', (e) => errors.push('JS异常: ' + String(e.message).slice(0, 160)));
  page.on('console', (m) => {
    if (m.type() === 'error') {
      const t = m.text();
      if (!/favicon|401|Failed to load resource/i.test(t)) errors.push('控制台错误: ' + t.slice(0, 160));
    }
  });
  return { browser, page, errors };
}

// 提取页面的"用户能看到的东西"：可见文本块 + 可点击元素
async function scan(page) {
  return await page.evaluate(() => {
    const vis = (el) => {
      const s = getComputedStyle(el);
      if (s.display === 'none' || s.visibility === 'hidden' || s.opacity === '0') return false;
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    };
    const out = { title: document.title, url: location.pathname, texts: [], clicks: [], inputs: [] };

    // 可见文本（去重、去空白，保留顺序）
    const seen = new Set();
    document.querySelectorAll('body *').forEach((el) => {
      if (!vis(el)) return;
      const own = Array.from(el.childNodes)
        .filter((n) => n.nodeType === 3)
        .map((n) => n.textContent.trim())
        .filter(Boolean)
        .join(' ');
      if (!own) return;
      if (seen.has(own)) return;
      seen.add(own);
      const tag = el.tagName.toLowerCase();
      out.texts.push({ tag, t: own.slice(0, 120) });
    });

    // 可点击
    const cs = new Set();
    document.querySelectorAll('a,button,[role="button"],[onclick],.eb-card,.sku-card,[data-nav]').forEach((el) => {
      if (!vis(el)) return;
      const label = (el.innerText || el.getAttribute('aria-label') || el.title || '').trim().replace(/\s+/g, ' ').slice(0, 60);
      if (!label) return;
      const key = label;
      if (cs.has(key)) return;
      cs.add(key);
      out.clicks.push({
        tag: el.tagName.toLowerCase(),
        label,
        href: el.getAttribute('href') || '',
        cls: (el.className || '').toString().slice(0, 48),
      });
    });

    document.querySelectorAll('input,textarea,[contenteditable="true"]').forEach((el) => {
      if (!vis(el)) return;
      out.inputs.push({
        tag: el.tagName.toLowerCase(),
        ph: el.getAttribute('placeholder') || '',
        type: el.getAttribute('type') || '',
      });
    });
    return out;
  });
}

async function shot(page, name, full = false) {
  const dir = '/Users/zhoukai/code/MarketingBrain/qa-user-journey-20260930';
  await page.screenshot({ path: `${dir}/${name}.png`, fullPage: full });
  return `${dir}/${name}.png`;
}

module.exports = { launch, scan, shot, BASE };
