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

function fillTextCentered(ctx: CanvasRenderingContext2D, text: string, cx: number, y: number, font: string, color: string): void {
  ctx.font = font;
  ctx.fillStyle = color;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, cx, y);
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
  fillTextCentered(ctx, "好友开通 · 各得 100 算力", cx, 246, `900 56px ${FONT}`, skin.accent);

  // 奖励双栏
  const rewards: Array<[string, string]> = [
    ["100", "好友注册立得"],
    ["100", "好友消耗满 50 你得"]
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

  // 链接 + 邀请码
  const link = data.link ?? "生成中…";
  ctx.font = `500 24px ${MONO}`;
  ctx.fillStyle = skin.soft;
  ctx.textAlign = "center";
  let shown = link;
  while (ctx.measureText(shown).width > W - 140 && shown.length > 8) shown = shown.slice(0, -2);
  if (shown !== link) shown += "…";
  ctx.fillText(shown, cx, 986);

  fillTextCentered(ctx, data.code ? `邀请码 ${data.code}` : " ", cx, 1026, `700 26px ${MONO}`, skin.accent);

  // 底部品牌行
  fillTextCentered(ctx, "智能体 · 数字员工 · AI 硬件 · AI 课程，一站配齐", cx, H - 56, `500 22px ${FONT}`, skin.soft);
}

/* ------------------------------------------------------------------ */

export function InvitePoster({ data }: { data: InvitePosterData }) {
  const [version, setVersion] = useState<VersionKey>("national");
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    let cancelled = false;
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
    })();
    return () => {
      cancelled = true;
    };
  }, [version, data.link, data.qrSvg, data.code, data.campaignActive, data.busy]);

  function download(): void {
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
        <canvas ref={canvasRef} width={W} height={H} className="eh-ips-canvas" aria-label="邀请海报预览" />
      </div>
      <button type="button" className="eh-ips-dl" onClick={download} disabled={!data.link}>
        ⬇ 下载海报图片（发给好友）
      </button>
      <p className="eh-ips-note">720 × 1080 PNG · 微信 / 朋友圈直接发；切版本即刻换样式。</p>
    </div>
  );
}
