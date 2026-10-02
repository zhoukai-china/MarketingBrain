import { useEffect, useRef, useState } from "react";

/**
 * 邀请海报（2026-09-30 用户：海报要能下载成图片发出去，再做几个精美版本挑一挑）。
 *
 * 实现口径：**直接用 Canvas 画成位图**，不走 html2canvas 截 DOM——
 * 预览就是最终下载的那张 PNG（720×1080，微信可直接发），没有 DOM→图片的样式还原问题。
 * 三个版本共用一套排版骨架（品牌行 / 主标题 / 双奖励 / 二维码 / 链接与邀请码），只换配色与装饰：
 * - national 国庆红金：红底金字 + 10·1 角标 + 金色发丝内框；
 * - warm 暖橙商场：奶油底橙主色，与商城一致的品牌感；
 * - ink 深墨鎏金：深底金线，克制高级。
 */

export interface InvitePosterData {
  link: string | null;
  qrSvg: string | null;
  code: string | null;
  campaignActive: boolean;
  busy?: boolean;
}

const W = 720;
const H = 1080;

const VERSIONS = [
  { key: "national", name: "国庆红金" },
  { key: "warm", name: "暖橙商场" },
  { key: "ink", name: "深墨鎏金" }
] as const;
type VersionKey = (typeof VERSIONS)[number]["key"];

function qrToImage(qrSvg: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("qr_decode_failed"));
    // SVG 字符串 → data URL（qrcode 包输出的 SVG 无脚本，安全）
    img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(qrSvg);
  });
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

const FONT = "'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', sans-serif";
const MONO = "ui-monospace, Menlo, Consolas, monospace";

/**
 * 2026-10-02：微信内置浏览器（iOS/Android）**不支持网页触发文件下载**——
 * 点「下载海报」时微信会拦截 blob 下载并弹出它的提示「可在浏览器打开此网页来下载文件。」，
 * 该提示正好盖住海报。微信里的正确姿势是把海报渲染成真正的 <img> 让用户**长按保存到相册**。
 * 因此：微信环境不触发下载，改为「查看大图 + 长按保存」；普通浏览器保持原下载行为。
 */
const IS_WECHAT = typeof navigator !== "undefined" && /micromessenger/i.test(navigator.userAgent);

function fillTextCentered(ctx: CanvasRenderingContext2D, text: string, cx: number, y: number, font: string, color: string): void {
  ctx.font = font;
  ctx.fillStyle = color;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, cx, y);
}

/**
 * 按最大可用宽度收敛字号后居中绘制：文字过长时自动逐档缩号，避免两侧被画面裁掉。
 * 2026-10-02：主标题「邀请好友 · 注册即得 100 算力」在 720 宽画布上 56px 会溢出，
 * 改为自适应（上限仍 56px，够宽就保持原字号）。
 */
function fillTextCenteredFit(
  ctx: CanvasRenderingContext2D,
  text: string,
  cx: number,
  y: number,
  weight: number,
  maxSize: number,
  minSize: number,
  maxWidth: number,
  color: string
): void {
  let size = maxSize;
  ctx.font = `${weight} ${size}px ${FONT}`;
  while (size > minSize && ctx.measureText(text).width > maxWidth) {
    size -= 2;
    ctx.font = `${weight} ${size}px ${FONT}`;
  }
  fillTextCentered(ctx, text, cx, y, `${weight} ${size}px ${FONT}`, color);
}

/* ------------------------------------------------------------------ */
/* 三个版本的皮肤：背景 / 主色 / 辅色 / 徽标文案                        */
/* ------------------------------------------------------------------ */

interface Skin {
  bg: (ctx: CanvasRenderingContext2D) => void;
  fg: string;
  accent: string;
  soft: string;
  hairline: string;
  badge: string;
  badgeBg: string;
  qrBox: string;
  decor?: (ctx: CanvasRenderingContext2D) => void;
}

const SKINS: Record<VersionKey, Skin> = {
  national: {
    bg: (ctx) => {
      const g = ctx.createLinearGradient(0, 0, W, H);
      g.addColorStop(0, "#C0392B");
      g.addColorStop(0.55, "#B3271E");
      g.addColorStop(1, "#8C140C");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
    },
    fg: "#FFF6E8",
    accent: "#FFD98A",
    soft: "rgba(255,240,214,.85)",
    hairline: "rgba(255,224,160,.45)",
    badge: "#8C140C",
    badgeBg: "#FFD98A",
    qrBox: "#FFFDF6",
    decor: (ctx) => {
      // 左上角旗面渐隐条 + 右上光斑（点缀，不铺满）
      const widths = [64, 48, 32, 20, 12];
      widths.forEach((wd, i) => {
        ctx.fillStyle = `rgba(255,217,138,${0.9 - i * 0.16})`;
        ctx.fillRect(48, 132 + i * 18, wd, 10);
      });
      const glow = ctx.createRadialGradient(W - 60, 90, 10, W - 60, 90, 200);
      glow.addColorStop(0, "rgba(255,217,138,.28)");
      glow.addColorStop(1, "rgba(255,217,138,0)");
      ctx.fillStyle = glow;
      ctx.fillRect(W - 280, 0, 280, 320);
    }
  },
  warm: {
    bg: (ctx) => {
      ctx.fillStyle = "#FFF9F2";
      ctx.fillRect(0, 0, W, H);
      // 底部暖橙色压角（点缀）
      const g = ctx.createLinearGradient(0, H - 260, 0, H);
      g.addColorStop(0, "rgba(242,83,0,0)");
      g.addColorStop(1, "rgba(242,83,0,.14)");
      ctx.fillStyle = g;
      ctx.fillRect(0, H - 260, W, 260);
    },
    fg: "#2B1B10",
    accent: "#F25300",
    soft: "#94796B",
    hairline: "rgba(232,101,26,.35)",
    badge: "#FFFFFF",
    badgeBg: "#F25300",
    qrBox: "#FFFFFF",
    decor: (ctx) => {
      ctx.strokeStyle = "rgba(232,101,26,.16)";
      ctx.lineWidth = 2;
      for (let i = 0; i < 3; i += 1) {
        ctx.beginPath();
        ctx.arc(W + 40, 120 + i * 26, 130 + i * 30, Math.PI, Math.PI * 1.9);
        ctx.stroke();
      }
    }
  },
  ink: {
    bg: (ctx) => {
      ctx.fillStyle = "#1C1712";
      ctx.fillRect(0, 0, W, H);
      const g = ctx.createRadialGradient(W / 2, 240, 40, W / 2, 240, 520);
      g.addColorStop(0, "rgba(232,200,122,.14)");
      g.addColorStop(1, "rgba(232,200,122,0)");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, 620);
    },
    fg: "#F5EAD6",
    accent: "#E8C87A",
    soft: "rgba(245,234,214,.66)",
    hairline: "rgba(232,200,122,.4)",
    badge: "#1C1712",
    badgeBg: "#E8C87A",
    qrBox: "#FBF6EA",
    decor: undefined
  }
};

/* ------------------------------------------------------------------ */

function drawPoster(ctx: CanvasRenderingContext2D, version: VersionKey, data: InvitePosterData, qr: HTMLImageElement | null): void {
  const skin = SKINS[version];
  ctx.clearRect(0, 0, W, H);
  skin.bg(ctx);
  skin.decor?.(ctx);

  // 金色/品牌色发丝内框（海报的「装裱线」）
  ctx.strokeStyle = skin.hairline;
  ctx.lineWidth = 1.5;
  roundRect(ctx, 26, 26, W - 52, H - 52, 26);
  ctx.stroke();

  const cx = W / 2;

  // 徽标（角标胶囊）
  const badgeText = version === "national" ? "10·1 国庆限定" : "限时邀享";
  ctx.font = `700 26px ${FONT}`;
  const bw = ctx.measureText(badgeText).width + 44;
  roundRect(ctx, cx - bw / 2, 62, bw, 46, 23);
  ctx.fillStyle = skin.badgeBg;
  ctx.fill();
  fillTextCentered(ctx, badgeText, cx, 86, `700 26px ${FONT}`, skin.badge);

  // 品牌行
  fillTextCentered(ctx, "思潼 AI 商城", cx, 176, `800 40px ${FONT}`, skin.fg);

  // 主标题
  // 主标题（自适应字号：过长自动收号，避免左右被裁）
  fillTextCenteredFit(ctx, "邀请好友 · 注册即得 100 算力", cx, 246, 900, 56, 40, W - 128, skin.accent);

  // 奖励双栏
  const rewards: Array<[string, string]> = [
    ["100", "好友注册立得"],
    ["100", "好友注册 · 你即得"]
  ];
  rewards.forEach(([num, label], i) => {
    const x = cx + (i === 0 ? -150 : 150);
    fillTextCentered(ctx, num, x, 342, `900 96px ${FONT}`, skin.accent);
    fillTextCentered(ctx, label, x, 412, `500 26px ${FONT}`, skin.soft);
  });
  // 分隔发丝线
  ctx.strokeStyle = skin.hairline;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(cx, 306);
  ctx.lineTo(cx, 424);
  ctx.stroke();

  // 二维码白盒
  const box = 380;
  const boxY = 476;
  roundRect(ctx, cx - box / 2, boxY, box, box, 28);
  ctx.fillStyle = skin.qrBox;
  ctx.fill();
  ctx.strokeStyle = skin.hairline;
  ctx.lineWidth = 1.5;
  roundRect(ctx, cx - box / 2, boxY, box, box, 28);
  ctx.stroke();
  if (qr) {
    ctx.drawImage(qr, cx - 150, boxY + 40, 300, 300);
  } else {
    fillTextCentered(ctx, data.busy ? "二维码生成中…" : "二维码生成中…", cx, boxY + box / 2, `700 30px ${FONT}`, "#B0A394");
  }
  fillTextCentered(ctx, "扫码或长按识别 · 立即开通", cx, boxY + box + 44, `600 30px ${FONT}`, skin.fg);

  // 邀请码（2026-09-30 用户：地址 URL 行去掉——二维码里已编码链接，文字行碍眼还容易露出本地域名）
  fillTextCentered(ctx, data.code ? `邀请码 ${data.code}` : " ", cx, 986, `700 26px ${MONO}`, skin.accent);

  // 底部品牌行
  fillTextCentered(ctx, "智能体 · 数字员工 · AI 硬件 · AI 课程，一站配齐", cx, H - 56, `500 22px ${FONT}`, skin.soft);
}

/* ------------------------------------------------------------------ */

export function InvitePoster({ data }: { data: InvitePosterData }) {
  const [version, setVersion] = useState<VersionKey>("national");
  // 预览用真正的 <img>（由隐藏 canvas 转出的 data URL），这样微信里可长按保存；
  // canvas 仅作离屏渲染器，不再直接展示。
  const [preview, setPreview] = useState<string>("");
  const [zoom, setZoom] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    let cancelled = false;
    setPreview(""); // 切版本先清空，避免旧图残留
    void (async () => {
      let qr: HTMLImageElement | null = null;
      if (data.qrSvg) {
        try {
          qr = await qrToImage(data.qrSvg);
        } catch {
          qr = null;
        }
      }
      if (cancelled) return;
      drawPoster(ctx, version, data, qr);
      try {
        setPreview(canvas.toDataURL("image/png"));
      } catch {
        setPreview("");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [version, data.link, data.qrSvg, data.code, data.campaignActive, data.busy]);

  /** 微信里不触发下载（会被拦截并弹「可在浏览器打开…」盖住海报），改为看大图+长按保存。 */
  function save(): void {
    if (IS_WECHAT) {
      setZoom(true);
      return;
    }
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.toBlob((blob) => {
      if (!blob) return;
      const name = VERSIONS.find((v) => v.key === version)?.name ?? "海报";
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `思潼AI邀请海报-${name}.png`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 4000);
    }, "image/png");
  }

  return (
    <div className="eh-ips">
      <div className="eh-ips-tabs" role="tablist" aria-label="海报版本">
        {VERSIONS.map((v) => (
          <button
            key={v.key}
            type="button"
            role="tab"
            aria-selected={version === v.key}
            className={"eh-ips-tab" + (version === v.key ? " on" : "")}
            onClick={() => setVersion(v.key)}
          >
            {v.name}
          </button>
        ))}
      </div>
      <div className="eh-ips-stage">
        {/* 离屏渲染画布（不展示） */}
        <canvas ref={canvasRef} width={W} height={H} className="eh-ips-canvas-src" aria-hidden="true" />
        {preview ? (
          <img
            src={preview}
            alt="邀请海报预览"
            className="eh-ips-canvas"
            onClick={() => {
              if (IS_WECHAT) setZoom(true);
            }}
          />
        ) : (
          <div className="eh-ips-canvas eh-ips-ph">海报生成中…</div>
        )}
        {IS_WECHAT && preview ? <span className="eh-ips-longpress">长按保存 ↙</span> : null}
      </div>
      {/* 微信：查看大图/长按保存不依赖邀请链接，链接未就绪也能用；非微信：无链接则禁用下载 */}
      <button type="button" className="eh-ips-dl" onClick={save} disabled={IS_WECHAT ? false : !data.link}>
        {IS_WECHAT ? "查看大图 · 长按保存到相册" : "⬇ 下载海报图片（发给好友）"}
      </button>
      <p className="eh-ips-note">
        {IS_WECHAT
          ? "长按上方海报图片 → 选择「保存图片」，即可发到微信 / 朋友圈（720 × 1080 PNG）。"
          : "720 × 1080 PNG · 微信 / 朋友圈直接发；切版本即刻换样式。"}
      </p>

      {zoom && preview ? (
        <div className="eh-ips-zoom" onClick={() => setZoom(false)} role="dialog" aria-modal="true" aria-label="邀请海报大图">
          <button type="button" className="eh-ips-zoom-x" onClick={() => setZoom(false)} aria-label="关闭">
            ✕
          </button>
          <img
            src={preview}
            alt="邀请海报大图"
            className="eh-ips-zoom-img"
            onClick={(event) => event.stopPropagation()}
          />
          <p className="eh-ips-zoom-tip">长按图片 → 保存到相册 → 发给好友</p>
        </div>
      ) : null}
    </div>
  );
}
