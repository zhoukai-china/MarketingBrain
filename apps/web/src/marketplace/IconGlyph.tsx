// 商城统一矢量图标（手绘 24×24 线性 glyph 库，stroke 2 圆头，颜色走 currentColor）。
// 设计稿：docs/workspace/图标重设计方案-20260929.html（风格 B 暖白浮雕应用中）。
// 覆盖：金刚区 7 格 / F4-F6 商品封面 / AI 案例封面。替换 emoji 与原型提取照片。

import type { CSSProperties } from "react";

const GLYPHS: Record<string, string> = {
  // 金刚区
  pen: '<path d="M17 3a2.8 2.8 0 0 1 4 4L8 20l-5 1 1-5L17 3z"/>',
  chat: '<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22z"/><path d="M8 10h8M8 14h5"/>',
  compass: '<circle cx="12" cy="12" r="9"/><path d="m16.2 7.8-2 6.3-6.4 2.1 2-6.3z"/>',
  chip: '<rect x="7" y="7" width="10" height="10" rx="2"/><path d="M9.5 7V4M14.5 7V4M9.5 20v-3M14.5 20v-3M7 9.5H4M7 14.5H4M20 9.5h-3M20 14.5h-3"/>',
  cap: '<path d="m2 9 10-5 10 5-10 5L2 9z"/><path d="M6 11.5V16c0 1.7 2.7 3 6 3s6-1.3 6-3v-4.5"/><path d="M22 9v5"/>',
  factory: '<path d="M3 21V9l6 4V9l6 4V4h6v17H3z"/><path d="M17 17h2M13 17h2"/>',
  store: '<path d="M3 9l1.5-5h15L21 9"/><path d="M4 9v11a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1V9"/><path d="M9 21v-6h6v6"/><path d="M3 9c0 1.4 1.2 2.5 2.7 2.5S8.4 10.4 8.4 9c0 1.4 1.2 2.5 2.7 2.5s2.7-1.1 2.7-2.5c0 1.4 1.2 2.5 2.7 2.5s2.7-1.1 2.7-2.5c0 1.4 1.2 2.5 2.7 2.5S19.2 10.4 19.2 9c0 1.4 1.2 2.5 2.7 2.5"/>',
  // 商品
  mic: '<rect x="9" y="2.5" width="6" height="11" rx="3"/><path d="M5 10a7 7 0 0 0 14 0M12 17.5v3.5M8.5 21h7"/>',
  robot: '<rect x="4" y="8" width="16" height="12" rx="3"/><circle cx="12" cy="4.5" r="1.5"/><path d="M12 6v2"/><circle cx="9" cy="13.5" r="1.1"/><circle cx="15" cy="13.5" r="1.1"/><path d="M9.5 17h5"/>',
  sparkcap: '<path d="m2 10 10-5 10 5-10 5L2 10z"/><path d="M6 12.5V17c0 1.6 2.7 2.8 6 2.8s6-1.2 6-2.8v-4.5"/><path d="m19 2 .7 1.6 1.6.7-1.6.7L19 6.6l-.7-1.6-1.6-.7 1.6-.7L19 2z"/>',
  chart: '<path d="M3 3v18h18"/><path d="m7 14 4-4 3 3 5.5-6"/><path d="M15.5 7H20v4.5"/>',
  pack: '<path d="M21 8l-9-5-9 5v8l9 5 9-5V8z"/><path d="M3 8l9 5 9-5M12 13v9"/>',
  clapper: '<path d="M3 11h18v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-8z"/><path d="M20.2 6 3.6 10.9l-.6-2c-.3-1.1.3-2.2 1.4-2.5l12.9-3.8c1.1-.3 2.2.3 2.5 1.4L20.2 6z"/><path d="m7 5.5 2 3.2M12.3 4l2 3.2"/>',
  // 案例
  badge: '<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="8.5" cy="11" r="2"/><path d="M13.5 9.5H18M13.5 13H18M6 16.5h12"/>',
  paw: '<circle cx="7" cy="8" r="1.7"/><circle cx="12" cy="6.3" r="1.7"/><circle cx="17" cy="8" r="1.7"/><path d="M12 10.5c3.1 0 5.6 2.3 5.6 4.9 0 1.9-1.5 3-3.1 3-1 0-1.7-.5-2.5-.5s-1.5.5-2.5.5c-1.6 0-3.1-1.1-3.1-3 0-2.6 2.5-4.9 5.6-4.9z"/>',
  playback: '<circle cx="12" cy="12" r="9"/><path d="m10 8.2 6 3.8-6 3.8V8.2z"/>',
  liveset: '<rect x="9" y="8" width="6" height="8" rx="3"/><path d="M6.5 11.5a5.5 5.5 0 0 1 11 0M12 16v3"/><path d="M4 8a9.5 9.5 0 0 1 3.2-3.4M20 8a9.5 9.5 0 0 0-3.2-3.4"/>',
  calc: '<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M8.5 6.5h7"/><path d="M8.5 11h.01M12 11h.01M15.5 11h.01M8.5 14.5h.01M12 14.5h.01M15.5 14.5h.01M8.5 18h.01M12 18h.01M15.5 18h.01"/>',
  sparkle: '<path d="M12 3.5 13.8 8l4.7 1.8-4.7 1.8L12 16.2l-1.8-4.6L5.5 9.8 10.2 8 12 3.5z"/><path d="m19 15.5.6 1.5 1.5.6-1.5.6-.6 1.5-.6-1.5-1.5-.6 1.5-.6.6-1.5z"/>',
  cake: '<path d="M4 21h16v-6.5a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2V21z"/><path d="M12 12.5V9M9 12.5V9.5M15 12.5V9.5"/><path d="M4 17.5c2 1.4 3.5-1 5.5 0s4-1 6 0 3.5-1 4.5-.5"/>',
  dumbbell: '<path d="M6.5 8.5v7M17.5 8.5v7M4 10v4M20 10v4M6.5 12h11"/>',
  cupbot: '<path d="M6 9h12l-1.3 10.2a2 2 0 0 1-2 1.8H9.3a2 2 0 0 1-2-1.8L6 9z"/><path d="M6.3 9A3.2 3.2 0 0 1 9.5 6h5a3.2 3.2 0 0 1 3.2 3"/><path d="M14 4.5 16 2"/>',
  bulb: '<path d="M12 3a6 6 0 0 1 3.6 10.8c-.7.5-1.1 1.3-1.1 2.2H9.5c0-.9-.4-1.7-1.1-2.2A6 6 0 0 1 12 3z"/><path d="M9.5 19h5M10.5 21.5h3"/>',
  // UI 小图标（TabBar/横幅/按钮）
  gift: '<rect x="3" y="8" width="18" height="4" rx="1"/><path d="M12 8v13M19 12v7a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-7M7.5 8a2.5 2.5 0 0 1 0-5C11 3 12 8 12 8s1-5 4.5-5a2.5 2.5 0 0 1 0 5"/>',
  cart: '<circle cx="9" cy="20" r="1.6"/><circle cx="17" cy="20" r="1.6"/><path d="M3 3h2l2.6 12.4a1 1 0 0 0 1 .6h8.7a1 1 0 0 0 1-.8L20 7H6"/>',
  home: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/><path d="M9.5 21v-7h5v7"/>',
  book: '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 3.6-6.5 8-6.5s8 2.5 8 6.5"/>',
  bolt: '<path d="M13 2 4 14h6l-1 8 9-12h-6l1-8z"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.2 9a3 3 0 0 1 5.8 1c0 2-3 2.4-3 4"/><path d="M12 17.5h.01"/>',
  target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.2"/>',
  users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  tag: '<path d="M12 2H2v10l9.3 9.3a1 1 0 0 0 1.4 0l8.6-8.6a1 1 0 0 0 0-1.4L12 2z"/><circle cx="7" cy="7" r="1.3"/>',
  rocket: '<path d="M4.5 16.5c-1.5 1.3-2 5-2 5s3.7-.5 5-2c.7-.8.7-2 0-2.8-.8-.7-2.2-.7-3 .2z"/><path d="M12 15l-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z"/><path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5"/>',
  pin: '<path d="M12 21s-7-5.5-7-11a7 7 0 0 1 14 0c0 5.5-7 11-7 11z"/><circle cx="12" cy="10" r="2.5"/>',
  map: '<path d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2z"/><path d="M9 4v14M15 6v14"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.2-4.2"/>',
  star: '<path d="m12 2 3.1 6.3 6.9 1-5 4.9 1.2 6.8L12 17.8 5.8 21l1.2-6.8-5-4.9 6.9-1L12 2z"/>',
  gem: '<path d="M6 3h12l4 6-10 12L2 9l4-6z"/><path d="M2 9h20M9.5 3 8 9l4 12 4-12-1.5-6"/>',
  tv: '<rect x="2" y="7" width="20" height="14" rx="2"/><path d="m17 2-5 5-5-5"/>',
  clipboard: '<rect x="8" y="2" width="8" height="4" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/>',
  heart: '<path d="M19.5 12.6 12 20l-7.5-7.4a5 5 0 1 1 7.5-6.6 5 5 0 1 1 7.5 6.6z"/>',
  flask: '<path d="M10 2v6L4 19a2 2 0 0 0 1.8 3h12.4A2 2 0 0 0 20 19L14 8V2"/><path d="M8.5 2h7M7 15h10"/>',
  brain: '<path d="M9.5 2A2.5 2.5 0 0 0 7 4.5v.55A3.5 3.5 0 0 0 4.5 8.5c0 .74.23 1.43.62 2A3.5 3.5 0 0 0 4 13.5 3.5 3.5 0 0 0 7 17v.5A2.5 2.5 0 0 0 9.5 20h.5V2h-.5z"/><path d="M14.5 2A2.5 2.5 0 0 1 17 4.5v.55a3.5 3.5 0 0 1 2.5 3.45c0 .74-.23 1.43-.62 2a3.5 3.5 0 0 1 1.12 3A3.5 3.5 0 0 1 17 17v.5a2.5 2.5 0 0 1-2.5 2.5H14V2h.5z"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  flag: '<path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><path d="M4 22v-7"/>',
  briefcase: '<rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/>',
  megaphone: '<path d="m3 11 18-5v12L3 14v-3z"/><path d="M11.6 16.8a3 3 0 1 1-5.8-1.6"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5M12 15V3"/>',
  key: '<circle cx="7.5" cy="15.5" r="4.5"/><path d="m21 2-9.6 9.6M15.5 7.5l3 3L22 7l-3-3"/>',
  health: '<rect x="3" y="3" width="18" height="18" rx="4"/><path d="M12 8v8M8 12h8"/>',
  shield: '<path d="M12 22s8-3.5 8-10V5l-8-3-8 3v7c0 6.5 8 10 8 10z"/><path d="m9 11.5 2 2 4-4.5"/>',
  warning: '<path d="M12 3 2.5 20h19L12 3z"/><path d="M12 10v4M12 17.5h.01"/>',
  calendar: '<rect x="3" y="4" width="18" height="17" rx="2"/><path d="M3 9h18M8 2v4M16 2v4"/>',
  logout: '<path d="M10 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h5"/><path d="M15 8l4 4-4 4"/><path d="M19 12H9"/>'
};

export type IconGlyphName = keyof typeof GLYPHS;

export function IconGlyph({ name, size = 30, style, className }: { name: string; size?: number; style?: CSSProperties; className?: string }) {
  const body = GLYPHS[name] ?? GLYPHS.sparkle;
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      width={size}
      height={size}
      style={style}
      className={className}
      aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: body }}
    />
  );
}

/* ---------- emoji → glyph 自动映射（详情页/工作台 icon 字段与固定 UI emoji） ---------- */
const EMOJI_MAP: Record<string, string> = {
  "🧭": "compass", "🎯": "target", "👤": "user", "👥": "users", "💰": "chart", "📊": "chart", "💎": "gem",
  "🏷": "tag", "⚔": "bolt", "✍": "pen", "🚀": "rocket", "📌": "pin", "🗺": "map",
  "✅": "check", "🔍": "search", "🎬": "clapper", "🎤": "mic", "📣": "megaphone", "📦": "pack",
  "🌟": "star", "⭐": "star", "⏱": "clock", "🏁": "flag", "💼": "briefcase", "🩺": "health",
  "🧬": "sparkle", "💔": "heart", "❤": "heart", "💚": "heart", "🔬": "flask", "🧠": "brain",
  "📋": "clipboard", "📺": "tv", "📱": "tv", "🔧": "check", "🧩": "pack", "▶": "playback",
  "🏪": "store", "🏭": "factory", "💪": "dumbbell", "📥": "download", "🔑": "key", "💤": "clock",
  "⚡": "bolt", "📲": "bolt", "📄": "clipboard", "🎁": "gift", "🛒": "cart", "🧰": "pack",
  "😲": "star", "😮": "star", "✨": "sparkle", "🛡": "shield", "⚠": "warning", "🗂": "clipboard"
};

/** emoji→glyph 自动渲染：映射命中画线性图标，否则原样展示（内容级 emoji 兜底）。 */
export function IconAuto({ v, size = 14 }: { v: string; size?: number }) {
  const key = v.replace(/\uFE0F/g, "").trim();
  const g = EMOJI_MAP[key];
  if (g) return <IconGlyph name={g} size={size} className="eh-ig" style={{ display: "inline", verticalAlign: "-2px" }} />;
  return <span className="eh-emoji-fallback">{v}</span>;
}

/** 字符串开头的 emoji 转 glyph（如 "🧭 角色" → [compass 图标] 角色）。 */
export function IconLead({ text, size = 13 }: { text: string; size?: number }) {
  const m = text.match(/^(\S{1,2})\s*(.*)$/u);
  if (m) {
    const key = m[1].replace(/\uFE0F/g, "");
    const g = EMOJI_MAP[key];
    if (g) return <><IconGlyph name={g} size={size} className="eh-ig" style={{ display: "inline", verticalAlign: "-2px" }} /> {m[2]}</>;
  }
  return <>{text}</>;
}
