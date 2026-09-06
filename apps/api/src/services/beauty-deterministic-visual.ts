import { createHash } from "node:crypto";
import { createCanvas } from "@napi-rs/canvas";
import {
  BEAUTY_DETERMINISTIC_VISUAL_VERSION,
  type BeautyImageRole
} from "../products/beauty-industry/media-contract.js";

export { BEAUTY_DETERMINISTIC_VISUAL_VERSION } from "../products/beauty-industry/media-contract.js";

export type BeautyDeterministicVisualTheme = {
  configVersion: string;
  tokenName: string;
  primary: string;
  primaryDark: string;
  primaryLight: string;
  surface: string;
};

export type BeautyDeterministicVisualReceipt = {
  version: typeof BEAUTY_DETERMINISTIC_VISUAL_VERSION;
  source: "deterministic_canvas";
  role: BeautyImageRole;
  layout: "reception_consultation" | "treatment_room" | "aftercare_consultation";
  scenePolicy: "generic_beauty_store_non_reference";
  scene: "reception_consultation" | "treatment_room" | "aftercare_consultation";
  taskSnapshotHash: string;
  paletteHash: string;
  sha256: string;
  contentType: "image/png";
  width: 768;
  height: 1024;
  shapeCount: number;
  elementCount: number;
};

const WIDTH = 768 as const;
const HEIGHT = 1024 as const;

export async function generateBeautyDeterministicVisual(input: {
  role: BeautyImageRole;
  taskSnapshotHash: string;
  theme: BeautyDeterministicVisualTheme;
}): Promise<{ bytes: Buffer; receipt: BeautyDeterministicVisualReceipt }> {
  assertHash(input.taskSnapshotHash, "beauty_deterministic_visual_task_hash_invalid");
  const palette = validateTheme(input.theme);
  const paletteHash = createHash("sha256").update(JSON.stringify(input.theme)).digest("hex");
  const seed = createHash("sha256")
    .update(`${BEAUTY_DETERMINISTIC_VISUAL_VERSION}:${input.role}:${input.taskSnapshotHash}:${paletteHash}`)
    .digest();
  const random = seededRandom(seed);
  const canvas = createCanvas(WIDTH, HEIGHT);
  const context = canvas.getContext("2d");

  const background = context.createLinearGradient(0, 0, WIDTH, HEIGHT);
  background.addColorStop(0, palette.surface);
  background.addColorStop(0.52, palette.primaryLight);
  background.addColorStop(1, palette.surface);
  context.fillStyle = background;
  context.fillRect(0, 0, WIDTH, HEIGHT);

  drawRoomShell(context, palette, random);
  const layout = input.role === "cover" ? "reception_consultation" : input.role === "content" ? "treatment_room" : "aftercare_consultation";
  const elementCount = input.role === "cover"
    ? drawReceptionConsultation(context, palette, random)
    : input.role === "content"
      ? drawTreatmentRoom(context, palette, random)
      : drawAftercareConsultation(context, palette, random);
  const shapeCount = elementCount + 6;

  const bytes = await canvas.encode("png");
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  return {
    bytes,
    receipt: {
      version: BEAUTY_DETERMINISTIC_VISUAL_VERSION,
      source: "deterministic_canvas",
      role: input.role,
      layout,
      scenePolicy: "generic_beauty_store_non_reference",
      scene: layout,
      taskSnapshotHash: input.taskSnapshotHash,
      paletteHash,
      sha256,
      contentType: "image/png",
      width: WIDTH,
      height: HEIGHT,
      shapeCount,
      elementCount
    }
  };
}

function drawRoomShell(
  context: ReturnType<ReturnType<typeof createCanvas>["getContext"]>,
  palette: ReturnType<typeof validateTheme>,
  random: () => number
): void {
  const wall = context.createLinearGradient(0, 0, WIDTH, 760);
  wall.addColorStop(0, palette.surface);
  wall.addColorStop(0.58, mix(palette.surface, palette.primaryLight, 0.34));
  wall.addColorStop(1, mix(palette.surface, palette.primaryLight, 0.12));
  context.fillStyle = wall;
  context.fillRect(0, 0, WIDTH, 760);

  const glow = context.createRadialGradient(150 + random() * 40, 220, 0, 150, 220, 520);
  glow.addColorStop(0, "rgba(255,255,255,0.92)");
  glow.addColorStop(1, rgba(palette.primaryLight, 0));
  context.fillStyle = glow;
  context.fillRect(0, 0, WIDTH, 760);

  const floor = context.createLinearGradient(0, 720, 0, HEIGHT);
  floor.addColorStop(0, mix(palette.surface, palette.primaryLight, 0.18));
  floor.addColorStop(1, mix(palette.surface, palette.primaryDark, 0.08));
  context.fillStyle = floor;
  context.fillRect(0, 720, WIDTH, HEIGHT - 720);
  context.fillStyle = rgba(palette.primaryDark, 0.12);
  context.fillRect(0, 718, WIDTH, 5);
}

function drawReceptionConsultation(
  context: ReturnType<ReturnType<typeof createCanvas>["getContext"]>,
  palette: ReturnType<typeof validateTheme>,
  _random: () => number
): number {
  drawArchedMirror(context, 92, 190, 210, 350, palette);
  drawPendantLight(context, 520, 80, palette);
  drawSofa(context, 350, 500, 330, 190, palette);
  drawRoundTable(context, 300, 670, 128, palette);
  drawPlant(context, 650, 455, 0.9, palette);
  drawRug(context, 150, 710, 500, 130, palette);
  return 6;
}

function drawTreatmentRoom(
  context: ReturnType<ReturnType<typeof createCanvas>["getContext"]>,
  palette: ReturnType<typeof validateTheme>,
  _random: () => number
): number {
  drawArchedMirror(context, 72, 165, 215, 345, palette);
  drawWallCircle(context, 560, 245, 108, palette);
  drawTreatmentBed(context, 145, 535, 485, 185, palette);
  drawFloorLamp(context, 94, 350, palette);
  drawPlant(context, 650, 385, 0.72, palette);
  drawRug(context, 105, 710, 570, 125, palette);
  return 6;
}

function drawAftercareConsultation(context: ReturnType<ReturnType<typeof createCanvas>["getContext"]>, palette: ReturnType<typeof validateTheme>, random: () => number): number {
  drawArchedMirror(context, 445, 150, 220, 330, palette);
  drawWallCircle(context, 190, 260, 92, palette);
  drawCurvedSeat(context, 115, 545, palette, -0.08);
  drawCurvedSeat(context, 505, 545, palette, 0.08);
  drawRoundTable(context, 322, 570, 150, palette);
  drawPlant(context, 620, 430, 0.75, palette);
  drawRug(context, 105, 700, 560, 140, palette);
  const highlight = context.createRadialGradient(380 + random() * 18, 520, 0, 380, 520, 290);
  highlight.addColorStop(0, "rgba(255,255,255,0.55)");
  highlight.addColorStop(1, "rgba(255,255,255,0)");
  context.fillStyle = highlight;
  context.fillRect(100, 320, 560, 460);
  return 7;
}

function drawArchedMirror(context: ReturnType<ReturnType<typeof createCanvas>["getContext"]>, x: number, y: number, width: number, height: number, palette: ReturnType<typeof validateTheme>): void {
  context.save();
  context.beginPath();
  context.moveTo(x, y + height);
  context.lineTo(x, y + width / 2);
  context.arc(x + width / 2, y + width / 2, width / 2, Math.PI, 0);
  context.lineTo(x + width, y + height);
  context.closePath();
  const glass = context.createLinearGradient(x, y, x + width, y + height);
  glass.addColorStop(0, "rgba(255,255,255,0.88)");
  glass.addColorStop(1, rgba(palette.primaryLight, 0.42));
  context.fillStyle = glass;
  context.fill();
  context.lineWidth = 12;
  context.strokeStyle = rgba(palette.primaryDark, 0.26);
  context.stroke();
  context.restore();
}

function drawWindow(context: ReturnType<ReturnType<typeof createCanvas>["getContext"]>, x: number, y: number, width: number, height: number, palette: ReturnType<typeof validateTheme>): void {
  roundedRect(context, x, y, width, height, 20);
  const glass = context.createLinearGradient(x, y, x + width, y + height);
  glass.addColorStop(0, "rgba(255,255,255,0.96)");
  glass.addColorStop(1, rgba(palette.primaryLight, 0.5));
  context.fillStyle = glass;
  context.fill();
  context.lineWidth = 10;
  context.strokeStyle = rgba(palette.primaryDark, 0.18);
  context.stroke();
  context.lineWidth = 5;
  context.beginPath();
  context.moveTo(x + width / 2, y + 8);
  context.lineTo(x + width / 2, y + height - 8);
  context.moveTo(x + 8, y + height * 0.56);
  context.lineTo(x + width - 8, y + height * 0.56);
  context.stroke();
}

function drawSofa(context: ReturnType<ReturnType<typeof createCanvas>["getContext"]>, x: number, y: number, width: number, height: number, palette: ReturnType<typeof validateTheme>): void {
  shadow(context, x + 15, y + height - 5, width - 30, 42);
  fillRounded(context, x, y, width, height, 46, mix(palette.surface, palette.primaryLight, 0.7));
  fillRounded(context, x + 24, y - 55, width - 48, 112, 36, mix(palette.surface, palette.primaryLight, 0.46));
  fillRounded(context, x - 18, y + 54, 70, 112, 24, palette.primaryLight);
  fillRounded(context, x + width - 52, y + 54, 70, 112, 24, palette.primaryLight);
  fillRounded(context, x + 62, y + 30, 92, 72, 20, rgba(palette.primary, 0.2));
}

function drawTreatmentBed(context: ReturnType<ReturnType<typeof createCanvas>["getContext"]>, x: number, y: number, width: number, height: number, palette: ReturnType<typeof validateTheme>): void {
  shadow(context, x + 35, y + height - 5, width - 70, 45);
  const bed = context.createLinearGradient(x, y, x, y + height);
  bed.addColorStop(0, "#FFFEFA");
  bed.addColorStop(1, mix(palette.surface, palette.primaryLight, 0.32));
  context.fillStyle = bed;
  context.beginPath();
  context.ellipse(x + width / 2, y + height / 2, width / 2, height / 2, -0.05, 0, Math.PI * 2);
  context.fill();
  context.fillStyle = mix(palette.surface, palette.primaryLight, 0.38);
  context.beginPath();
  context.ellipse(x + 105, y + 72, 82, 42, -0.12, 0, Math.PI * 2);
  context.fill();
  context.strokeStyle = rgba(palette.primaryDark, 0.38);
  context.lineWidth = 14;
  context.lineCap = "round";
  context.beginPath();
  context.moveTo(x + 95, y + height * 0.82);
  context.lineTo(x + 72, y + height + 64);
  context.moveTo(x + width - 95, y + height * 0.82);
  context.lineTo(x + width - 65, y + height + 64);
  context.stroke();
}

function drawCurvedSeat(context: ReturnType<ReturnType<typeof createCanvas>["getContext"]>, x: number, y: number, palette: ReturnType<typeof validateTheme>, rotation: number): void {
  context.save();
  context.translate(x + 85, y + 100);
  context.rotate(rotation);
  shadow(context, -65, 105, 130, 34);
  context.fillStyle = mix(palette.surface, palette.primaryLight, 0.64);
  context.beginPath();
  context.ellipse(0, 5, 78, 104, 0, 0, Math.PI * 2);
  context.fill();
  context.strokeStyle = rgba(palette.primaryDark, 0.42);
  context.lineWidth = 13;
  context.lineCap = "round";
  context.beginPath();
  context.moveTo(-38, 78);
  context.lineTo(-52, 165);
  context.moveTo(38, 78);
  context.lineTo(52, 165);
  context.stroke();
  context.restore();
}

function drawRoundTable(context: ReturnType<ReturnType<typeof createCanvas>["getContext"]>, x: number, y: number, width: number, palette: ReturnType<typeof validateTheme>): void {
  shadow(context, x - width / 2, y + 85, width, 32);
  context.fillStyle = mix(palette.surface, palette.primaryLight, 0.34);
  context.beginPath();
  context.ellipse(x, y, width / 2, width * 0.2, 0, 0, Math.PI * 2);
  context.fill();
  context.fillStyle = rgba(palette.primaryDark, 0.45);
  context.fillRect(x - 8, y + 12, 16, 100);
  context.beginPath();
  context.ellipse(x, y + 112, 56, 13, 0, 0, Math.PI * 2);
  context.fill();
}

function drawPlant(context: ReturnType<ReturnType<typeof createCanvas>["getContext"]>, x: number, y: number, scale: number, palette: ReturnType<typeof validateTheme>): void {
  context.save();
  context.translate(x, y);
  context.scale(scale, scale);
  context.strokeStyle = rgba(palette.primaryDark, 0.52);
  context.lineWidth = 7;
  for (const [dx, dy] of [[-48, -92], [-18, -138], [22, -120], [52, -82], [8, -168]]) {
    context.beginPath(); context.moveTo(0, 45); context.quadraticCurveTo(dx * 0.35, dy * 0.28, dx, dy); context.stroke();
    context.fillStyle = rgba(palette.primary, 0.58);
    context.beginPath(); context.ellipse(dx, dy, 31, 15, Math.atan2(dy, dx), 0, Math.PI * 2); context.fill();
  }
  fillRounded(context, -55, 42, 110, 105, 24, mix(palette.surface, palette.primary, 0.22));
  context.restore();
}

function drawPendantLight(context: ReturnType<ReturnType<typeof createCanvas>["getContext"]>, x: number, y: number, palette: ReturnType<typeof validateTheme>): void {
  context.strokeStyle = rgba(palette.primaryDark, 0.36); context.lineWidth = 5;
  context.beginPath(); context.moveTo(x, 0); context.lineTo(x, y + 110); context.stroke();
  context.fillStyle = mix(palette.surface, palette.primaryLight, 0.4);
  context.beginPath(); context.arc(x, y + 135, 54, Math.PI, 0); context.closePath(); context.fill();
  const glow = context.createRadialGradient(x, y + 150, 0, x, y + 150, 170);
  glow.addColorStop(0, "rgba(255,248,218,0.46)"); glow.addColorStop(1, "rgba(255,248,218,0)");
  context.fillStyle = glow; context.fillRect(x - 180, y, 360, 360);
}

function drawFloorLamp(context: ReturnType<ReturnType<typeof createCanvas>["getContext"]>, x: number, y: number, palette: ReturnType<typeof validateTheme>): void {
  context.strokeStyle = rgba(palette.primaryDark, 0.42); context.lineWidth = 9;
  context.beginPath(); context.moveTo(x, y + 300); context.quadraticCurveTo(x + 25, y + 40, x + 155, y); context.stroke();
  context.fillStyle = mix(palette.surface, palette.primaryLight, 0.45);
  context.beginPath(); context.arc(x + 160, y + 14, 48, Math.PI, 0); context.closePath(); context.fill();
}

function drawSideCabinet(context: ReturnType<ReturnType<typeof createCanvas>["getContext"]>, x: number, y: number, width: number, height: number, palette: ReturnType<typeof validateTheme>): void {
  fillRounded(context, x, y, width, height, 18, mix(palette.surface, palette.primaryLight, 0.46));
  context.strokeStyle = rgba(palette.primaryDark, 0.25); context.lineWidth = 4;
  context.beginPath(); context.moveTo(x + 10, y + height * 0.55); context.lineTo(x + width - 10, y + height * 0.55); context.stroke();
  context.fillStyle = rgba(palette.primaryDark, 0.38); context.beginPath(); context.arc(x + width - 18, y + height * 0.28, 4, 0, Math.PI * 2); context.fill();
}

function drawWallCircle(context: ReturnType<ReturnType<typeof createCanvas>["getContext"]>, x: number, y: number, radius: number, palette: ReturnType<typeof validateTheme>): void {
  context.fillStyle = "rgba(255,255,255,0.72)"; context.beginPath(); context.arc(x, y, radius, 0, Math.PI * 2); context.fill();
  context.strokeStyle = rgba(palette.primaryDark, 0.2); context.lineWidth = 9; context.stroke();
}

function drawWallShelf(context: ReturnType<ReturnType<typeof createCanvas>["getContext"]>, x: number, y: number, width: number, palette: ReturnType<typeof validateTheme>): void {
  context.fillStyle = rgba(palette.primaryDark, 0.35); context.fillRect(x, y, width, 10);
  for (let index = 0; index < 3; index += 1) {
    fillRounded(context, x + 24 + index * 70, y - 58 - index * 5, 48, 50 + index * 5, 12, mix(palette.surface, palette.primaryLight, 0.56));
  }
}

function drawRug(context: ReturnType<ReturnType<typeof createCanvas>["getContext"]>, x: number, y: number, width: number, height: number, palette: ReturnType<typeof validateTheme>): void {
  context.fillStyle = rgba(palette.primary, 0.09); context.beginPath(); context.ellipse(x + width / 2, y + height / 2, width / 2, height / 2, 0, 0, Math.PI * 2); context.fill();
}

function shadow(context: ReturnType<ReturnType<typeof createCanvas>["getContext"]>, x: number, y: number, width: number, height: number): void {
  context.fillStyle = "rgba(24,44,38,0.12)"; context.beginPath(); context.ellipse(x + width / 2, y + height / 2, width / 2, height / 2, 0, 0, Math.PI * 2); context.fill();
}

function fillRounded(context: ReturnType<ReturnType<typeof createCanvas>["getContext"]>, x: number, y: number, width: number, height: number, radius: number, fill: string): void {
  roundedRect(context, x, y, width, height, radius); context.fillStyle = fill; context.fill();
}

function roundedRect(context: ReturnType<ReturnType<typeof createCanvas>["getContext"]>, x: number, y: number, width: number, height: number, radius: number): void {
  const r = Math.min(radius, width / 2, height / 2);
  context.beginPath(); context.moveTo(x + r, y); context.lineTo(x + width - r, y); context.quadraticCurveTo(x + width, y, x + width, y + r); context.lineTo(x + width, y + height - r); context.quadraticCurveTo(x + width, y + height, x + width - r, y + height); context.lineTo(x + r, y + height); context.quadraticCurveTo(x, y + height, x, y + height - r); context.lineTo(x, y + r); context.quadraticCurveTo(x, y, x + r, y); context.closePath();
}

function validateTheme(theme: BeautyDeterministicVisualTheme) {
  if (!theme.configVersion.trim() || !theme.tokenName.trim()) throw new Error("beauty_deterministic_visual_theme_invalid");
  for (const color of [theme.primary, theme.primaryDark, theme.primaryLight, theme.surface]) {
    if (!/^#[0-9a-f]{6}$/iu.test(color)) throw new Error("beauty_deterministic_visual_theme_invalid");
  }
  return Object.freeze({
    primary: theme.primary.toUpperCase(),
    primaryDark: theme.primaryDark.toUpperCase(),
    primaryLight: theme.primaryLight.toUpperCase(),
    surface: theme.surface.toUpperCase()
  });
}

function rgba(hex: string, alpha: number): string {
  const normalized = hex.slice(1);
  const red = Number.parseInt(normalized.slice(0, 2), 16);
  const green = Number.parseInt(normalized.slice(2, 4), 16);
  const blue = Number.parseInt(normalized.slice(4, 6), 16);
  return `rgba(${red},${green},${blue},${Math.max(0, Math.min(1, alpha)).toFixed(4)})`;
}

function mix(left: string, right: string, ratio: number): string {
  const bounded = Math.max(0, Math.min(1, ratio));
  const leftValue = left.slice(1);
  const rightValue = right.slice(1);
  const channel = (offset: number) => Math.round(
    Number.parseInt(leftValue.slice(offset, offset + 2), 16) * (1 - bounded)
    + Number.parseInt(rightValue.slice(offset, offset + 2), 16) * bounded
  ).toString(16).padStart(2, "0");
  return `#${channel(0)}${channel(2)}${channel(4)}`;
}

function seededRandom(seed: Buffer): () => number {
  let state = seed.readUInt32BE(0) || 0x9e3779b9;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 0x1_0000_0000;
  };
}

function assertHash(value: string, code: string): void {
  if (!/^[a-f0-9]{64}$/u.test(value)) throw new Error(code);
}
