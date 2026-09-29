const puppeteer = require("/Users/zhoukai/.workbuddy/binaries/node/workspace/node_modules/puppeteer-core");
const HS = process.env.HOME + "/Library/Caches/ms-playwright/chromium_headless_shell-1223/chrome-headless-shell-mac-arm64/chrome-headless-shell";
(async () => {
  const b = await puppeteer.launch({ executablePath: HS, headless: true, args: ["--no-sandbox"] });
  const p = await b.newPage();
  await p.setViewport({ width: 1440, height: 1000 });
  await p.goto("http://localhost:5174/agents", { waitUntil: "networkidle2" });
  await new Promise(r => setTimeout(r, 1800));
  const r = await p.evaluate(() => {
    const csPseudo = (el, ps) => getComputedStyle(el, ps);
    const prod = document.querySelector(".eh .eco-product");
    const pimg = document.querySelector(".eh .eco-p-img");
    const cons = document.querySelector(".eh-cons-card");
    const kk = document.querySelector(".eh .eco-kk-ico");
    const wave = document.querySelector(".eh-wave i");
    const banner = document.querySelector(".eco-invite-banner");
    const bh = document.querySelector(".eh-brand-hero");
    const mini = document.querySelector(".eco-mall-page .eh-mini");
    const heroBtn = document.querySelector(".eh-big");
    const av = (el, ps) => el ? csPseudo(el, ps).animationName : "N/A";
    return {
      // 关
      cardTopFlow: av(prod, "::before"),        // 员工卡顶部流光 → none
      ringSpin: pimg ? csPseudo(pimg, "::before").borderTopStyle + "/" + csPseudo(pimg, "::before").display : "N/A", // 旋环 → display none
      consScan: cons ? csPseudo(cons.querySelector(".eh-scanline")).display : "N/A",
      consAvaGlow: av(cons && cons.querySelector(".eh-cons-ava")),
      bannerBg: banner ? getComputedStyle(banner).backgroundColor : "N/A",
      bhBg: bh ? getComputedStyle(bh).backgroundImage.slice(0, 24) : "N/A",
      // 留
      kkBreath: av(kk),                          // 瓷贴呼吸 → ehKkBreath
      heroWave: av(wave),                        // Hero 波形 → ehWv
      heroBtnSheen: heroBtn ? csPseudo(heroBtn, "::after").animationName : "N/A", // 主CTA流光
      homeRecharge: mini ? csPseudo(mini, "::after").animationName : "N/A"        // 首页充值流光（上一轮用户要求保留）
    };
  });
  console.log(JSON.stringify(r, null, 2));
  await b.close();
})();
