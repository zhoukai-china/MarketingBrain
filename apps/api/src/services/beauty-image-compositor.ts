import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { GlobalFonts, createCanvas, loadImage } from "@napi-rs/canvas";
import type { BeautyImageRole } from "../products/beauty-industry/media-contract.js";

export const BEAUTY_IMAGE_COMPOSITION_VERSION = "beauty-image-composition-v1.1" as const;

const FONT_ALIAS = "BeautyDeliveryCjk";
const FONT_CANDIDATES = process.platform === "win32"
  ? ["C:\\Windows\\Fonts\\msyhbd.ttc", "C:\\Windows\\Fonts\\msyh.ttc", "C:\\Windows\\Fonts\\simhei.ttf"]
  : [
      "/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc",
      "/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc",
      "/usr/share/fonts/truetype/noto/NotoSansCJK-Bold.ttc"
    ];
let fontReady = false;

export type BeautyImageCompositionReceipt = {
  version: typeof BEAUTY_IMAGE_COMPOSITION_VERSION;
  contentType: "image/png";
  width: number;
  height: number;
  fontFamily: typeof FONT_ALIAS;
  overlayTextHash: string;
  finalSha256: string;
  finalBytes: number;
  layout: "cover_title" | "content_short_line" | "engagement_short_line";
  fontSize: number;
  lineHeight: number;
  lineCount: number;
  maxLines: number;
  horizontalPadding: number;
};

export type BeautyImageOverlayLayout = {
  text: string;
  lines: string[];
  fontSize: number;
  lineHeight: number;
  maxLines: number;
  horizontalPadding: number;
  maxTextWidth: number;
};

const ROLE_LAYOUT: Record<BeautyImageRole, { preferredWidthRatio: number; minimumWidthRatio: number; maxLines: number }> = {
  cover: { preferredWidthRatio: 0.068, minimumWidthRatio: 0.044, maxLines: 3 },
  content: { preferredWidthRatio: 0.054, minimumWidthRatio: 0.040, maxLines: 2 },
  engagement: { preferredWidthRatio: 0.054, minimumWidthRatio: 0.040, maxLines: 2 }
};

export async function composeBeautyCustomerImage(input: {
  sourceBytes: Buffer;
  role: BeautyImageRole;
  overlayText: string;
}): Promise<{ bytes: Buffer; receipt: BeautyImageCompositionReceipt }> {
  const source = await loadImage(input.sourceBytes);
  if (!source.width || !source.height) throw new Error("beauty_image_source_decode_failed");
  const layout = preflightBeautyImageOverlay({ role: input.role, overlayText: input.overlayText, width: source.width, height: source.height });
  const canvas = createCanvas(source.width, source.height);
  const context = canvas.getContext("2d");
  context.drawImage(source, 0, 0, source.width, source.height);

  context.font = `700 ${layout.fontSize}px ${FONT_ALIAS}`;
  const blockHeight = layout.lines.length * layout.lineHeight;
  const baseline = source.height - Math.round(source.height * 0.075) - blockHeight + layout.lineHeight;

  const gradient = context.createLinearGradient(0, source.height * 0.48, 0, source.height);
  gradient.addColorStop(0, "rgba(20, 13, 9, 0)");
  gradient.addColorStop(0.62, "rgba(20, 13, 9, 0.30)");
  gradient.addColorStop(1, "rgba(20, 13, 9, 0.78)");
  context.fillStyle = gradient;
  context.fillRect(0, source.height * 0.48, source.width, source.height * 0.52);

  context.textAlign = "center";
  context.textBaseline = "alphabetic";
  context.fillStyle = "#FFFFFF";
  context.shadowColor = "rgba(0,0,0,0.55)";
  context.shadowBlur = Math.max(3, Math.round(layout.fontSize * 0.10));
  context.shadowOffsetY = Math.max(2, Math.round(layout.fontSize * 0.05));
  layout.lines.forEach((line, index) => context.fillText(line, source.width / 2, baseline + index * layout.lineHeight, layout.maxTextWidth));

  const bytes = await canvas.encode("png");
  const overlayTextHash = createHash("sha256").update(layout.text).digest("hex");
  const finalSha256 = createHash("sha256").update(bytes).digest("hex");
  return {
    bytes,
    receipt: {
      version: BEAUTY_IMAGE_COMPOSITION_VERSION,
      contentType: "image/png",
      width: source.width,
      height: source.height,
      fontFamily: FONT_ALIAS,
      overlayTextHash,
      finalSha256,
      finalBytes: bytes.length,
      layout: input.role === "cover" ? "cover_title" : input.role === "content" ? "content_short_line" : "engagement_short_line",
      fontSize: layout.fontSize,
      lineHeight: layout.lineHeight,
      lineCount: layout.lines.length,
      maxLines: layout.maxLines,
      horizontalPadding: layout.horizontalPadding
    }
  };
}

export function preflightBeautyImageOverlay(input: {
  role: BeautyImageRole;
  overlayText: string;
  width: number;
  height: number;
}): BeautyImageOverlayLayout {
  const text = normalizeOverlayText(input.overlayText);
  if (!text) throw new Error("beauty_image_overlay_text_required");
  if (/\p{Extended_Pictographic}/u.test(text)) throw new Error("beauty_image_overlay_unsupported_symbol");
  if (hasRepeatedSemanticSegment(text)) throw new Error("beauty_image_overlay_repeated_segment");
  if (!Number.isFinite(input.width) || !Number.isFinite(input.height) || input.width < 240 || input.height < 320) {
    throw new Error("beauty_image_overlay_invalid_canvas");
  }
  ensureCjkFont();

  const canvas = createCanvas(input.width, input.height);
  const context = canvas.getContext("2d");
  const limits = ROLE_LAYOUT[input.role];
  const horizontalPadding = Math.round(input.width * 0.085);
  const maxTextWidth = input.width - horizontalPadding * 2;
  const preferred = Math.max(30, Math.round(input.width * limits.preferredWidthRatio));
  const minimum = Math.max(26, Math.round(input.width * limits.minimumWidthRatio));

  for (let fontSize = preferred; fontSize >= minimum; fontSize -= 1) {
    context.font = `700 ${fontSize}px ${FONT_ALIAS}`;
    const lines = wrapCompleteText(context, text, maxTextWidth);
    const lineHeight = Math.round(fontSize * 1.32);
    if (lines.length > limits.maxLines) continue;
    if (lines.some((line) => context.measureText(line).width > maxTextWidth)) continue;
    if (lines.length * lineHeight > input.height * 0.25) continue;
    return { text, lines, fontSize, lineHeight, maxLines: limits.maxLines, horizontalPadding, maxTextWidth };
  }
  throw new Error("beauty_image_overlay_too_long");
}

function ensureCjkFont(): void {
  if (fontReady) return;
  const fontPath = FONT_CANDIDATES.find((candidate) => existsSync(candidate));
  if (!fontPath || !GlobalFonts.registerFromPath(fontPath, FONT_ALIAS)) throw new Error("beauty_image_cjk_font_unavailable");
  fontReady = true;
}

function normalizeOverlayText(value: string): string {
  return value
    .normalize("NFC")
    .replace(/[#*_`|<>\r\n]+/g, " ")
    .replace(/^\s*(?:(?:标题|方案)\s*[一二三四五六七八九十\d]+|[一二三四五六七八九十\d]+)\s*[.、：:)）-]+\s*/u, "")
    .replace(/\s+/g, " ")
    .trim();
}

function wrapCompleteText(
  context: ReturnType<ReturnType<typeof createCanvas>["getContext"]>,
  text: string,
  maxWidth: number
): string[] {
  const characters = [...text];
  const lines: string[] = [];
  let current = "";
  for (const character of characters) {
    const candidate = `${current}${character}`;
    if (current && context.measureText(candidate).width > maxWidth) {
      lines.push(current);
      current = character;
    } else current = candidate;
  }
  if (current) lines.push(current);
  return lines;
}

function hasRepeatedSemanticSegment(value: string): boolean {
  const normalized = value.toLocaleLowerCase("zh-CN").replace(/[\p{P}\p{S}\s]+/gu, "");
  const characters = [...normalized];
  const maximumLength = Math.floor(characters.length / 2);
  for (let length = maximumLength; length >= 5; length -= 1) {
    for (let start = 0; start + length * 2 <= characters.length + length; start += 1) {
      const segment = characters.slice(start, start + length).join("");
      if (!segment) continue;
      const remainder = characters.slice(start + length).join("");
      if (remainder.includes(segment)) return true;
    }
  }
  return false;
}
