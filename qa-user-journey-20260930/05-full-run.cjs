const { launch, scan, shot, BASE } = require('./lib.cjs');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const ANSWERS = {
  '产品': '社区火锅店，人均59元',
  '卖点': '鲜切牛肉现切现上，营业到凌晨2点',
  '平台': '抖音',
  '动作': '到店核销，点团购链接',
  '深度': '内容十件套',
  '出镜': '老板出镜',
};

async function state(page) {
  return await page.evaluate(() => {
    const vis = (el) => {
      const s = getComputedStyle(el);
      return s.display !== 'none' && s.visibility !== 'hidden' && el.getBoundingClientRect().height > 0;
    };
    const texts = [];
    const seen = new Set();
    document.querySelectorAll('body *').forEach((el) => {
      if (!vis(el)) return;
      const own = Array.from(el.childNodes).filter((n) => n.nodeType === 3).map((n) => n.textContent.trim()).filter(Boolean).join(' ');
      if (!own || seen.has(own)) return;
      seen.add(own);
      texts.push(own);
    });
    const prog = texts.find((t) => /^\s*\d+\s*\/\s*6\s*$/.test(t)) || texts.find((t) => /引导中/.test(t)) || '?';
    // 当前问题 = 最后一个带问号的可见文本
    const qs = texts.filter((t) => /[？?]$/.test(t));
    const q = qs.length ? qs[qs.length - 1] : '';
    // 推荐选项
    const opts = Array.from(document.querySelectorAll('button')).filter(vis)
      .map((b) => (b.innerText || '').trim().replace(/\s+/g, ' '))
      .filter((t) => t && t.length < 40 && !/发送|重置|返回|充值|开始创作|先铺底稿/.test(t));
    const startBtn = Array.from(document.querySelectorAll('button')).filter(vis).find((b) => /开始创作/.test(b.innerText || ''));
    return {
      prog, q, opts,
      startDisabled: startBtn ? !!startBtn.disabled : null,
      startText: startBtn ? (startBtn.innerText || '').trim().replace(/\s+/g, ' ') : null,
      url: location.pathname,
    };
  });
}

async function answer(page, text) {
  const ok = await page.evaluate(() => {
    const el = document.querySelector('input:not([type="search"]),textarea,[contenteditable="true"]');
    if (!el) return false;
    el.focus();
    return true;
  });
  if (!ok) return false;
  await page.keyboard.type(text, { delay: 10 });
  await wait(250);
  const sent = await page.evaluate(() => {
    const b = Array.from(document.querySelectorAll('button')).find((e) => /发送/.test(e.innerText || ''));
    if (!b) return false;
    b.click();
    return true;
  });
  return sent;
}

(async () => {
  const { browser, page, errors } = await launch(true);
  await page.goto(BASE + '/agent/ipzone__copy/workbench', { waitUntil: 'networkidle2', timeout: 30000 });
  await wait(1500);

  const log = [];
  console.log('=== 自适应走完 6 问引导 ===');
  for (let i = 0; i < 8; i++) {
    const st = await state(page);
    console.log(`\n[轮${i + 1}] 进度=${st.prog} | 当前问题=${st.q}`);
    console.log(`      推荐选项: ${JSON.stringify(st.opts.slice(0, 5))}`);
    console.log(`      开始创作按钮: ${st.startText} disabled=${st.startDisabled}`);
    const m = /(\d+)\s*\/\s*6/.exec(st.prog);
    if (m && Number(m[1]) >= 6) { console.log('      引导已完成'); break; }

    let key = '产品';
    for (const k of Object.keys(ANSWERS)) if (st.q.includes(k)) key = k;
    const a = ANSWERS[key];
    const sent = await answer(page, a);
    console.log(`      回答[${key}]: ${a} → 发送=${sent}`);
    await wait(2800);
    log.push({ round: i + 1, q: st.q, a });
  }

  const stEnd = await state(page);
  console.log('\n=== 引导结束状态 ===');
  console.log('进度:', stEnd.prog, '| 开始创作 disabled:', stEnd.startDisabled, '|', stEnd.startText);
  await shot(page, '09-brief-complete', true);

  console.log('\n=== 真正点「开始创作」，计时观察 ===');
  const t0 = Date.now();
  await page.evaluate(() => {
    const b = Array.from(document.querySelectorAll('button')).find((e) => /开始创作/.test(e.innerText || ''));
    if (b) b.click();
  });

  for (let t = 1; t <= 12; t++) {
    await wait(5000);
    const el = Date.now() - t0;
    const s = await page.evaluate(() => {
      const texts = [];
      const seen = new Set();
      document.querySelectorAll('body *').forEach((e) => {
        const own = Array.from(e.childNodes).filter((n) => n.nodeType === 3).map((n) => n.textContent.trim()).filter(Boolean).join(' ');
        if (!own || seen.has(own)) return;
        if (own.length > 200) return;
        seen.add(own);
        texts.push(own);
      });
      const tail = texts.slice(-14).join(' ｜ ');
      return { url: location.pathname, tail: tail.slice(0, 600) };
    });
    console.log(`\n--- ${el / 1000}s --- url=${s.url}`);
    console.log('   ', s.tail);
    if (/登录|验证|算力不足|余额|失败|错误/.test(s.tail) || s.url !== stEnd.url) {
      await shot(page, `10-t${t}-state`);
    }
    if (el > 60000) { console.log('（超过 60s，停止观察）'); break; }
  }

  await shot(page, '11-final', true);
  console.log('\n--- JS 异常 ---');
  console.log(errors.length ? errors.join('\n') : '(无)');
  await browser.close();
})().catch((e) => { console.error('FATAL', e.message, e.stack?.slice(0, 300)); process.exit(1); });
