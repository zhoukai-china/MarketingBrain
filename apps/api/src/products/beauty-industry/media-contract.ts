import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { parseBeautyXhsDelivery } from "./xhs-delivery.js";

const require = createRequire(import.meta.url);
const { PNG } = require("pngjs") as { PNG: { sync: { read(bytes: Buffer): { width: number; height: number; data: Buffer } } } };

export type BeautyImageRole = "cover" | "content" | "engagement";

export interface BeautyImageDirection {
  index: number;
  role: BeautyImageRole;
  label: string;
  positivePrompt: string;
  negativePrompt: string;
  postProductionText: string;
}

export const BEAUTY_XHS_IMAGE_PLAN_VERSION = "beauty-xhs-image-plan-v2" as const;
export const BEAUTY_IMAGE_PROVIDER_PROMPT_VERSION = "beauty-image-provider-prompt-v1.7" as const;
export const BEAUTY_IMAGE_COMMERCIAL_PHOTO_CONTRACT_VERSION = "beauty-image-commercial-photo-v1" as const;
export const BEAUTY_IMAGE_SAFETY_DETECTOR_VERSION = "beauty-image-safety-v2.16" as const;
export const BEAUTY_IMAGE_CONTENT_ROLE_CONTRACT_VERSION = "beauty-image-content-role-contract-v1" as const;
export const BEAUTY_DETERMINISTIC_VISUAL_VERSION = "beauty-deterministic-visual-v2" as const;

export type BeautyDeterministicVisualReceiptContract = {
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

export interface BeautyXhsImageDeliveryPlan {
  version: typeof BEAUTY_XHS_IMAGE_PLAN_VERSION;
  imageCount: 1 | 3;
  ratio: "3:4";
  linkedTitle: string;
  customerBoundary: string;
  rightsBoundary: string;
  directions: Array<{
    index: number;
    role: BeautyImageRole;
    label: string;
    purpose: string;
    composition: string;
    textStrategy: string;
  }>;
}

export type BeautyImageOverlay = {
  role: BeautyImageRole;
  text: string;
  source: "selected_title" | "customer_body" | "customer_engagement";
};

export type BeautyImageSafetyReason =
  | "qr_or_barcode_like"
  | "visible_text_or_brand_like"
  | "interface_or_watermark_like"
  | "person_or_device_like"
  | "multi_panel_layout"
  | "content_semantics_unverified"
  | "unsupported_image_format"
  | "image_decode_failed";

export interface BeautyImageSafetyEvidence {
  detectorType: "qr_finder_pattern" | "barcode_stripes" | "glyph_sequence" | "corner_watermark" | "ui_layout" | "person_device_geometry" | "content_role_layout" | "content_role_semantics" | "format" | "decode";
  reason: BeautyImageSafetyReason;
  decision: "rejected" | "manual_review_required";
  confidence: number;
  bbox: { x: number; y: number; width: number; height: number };
  metrics: Record<string, number | string | boolean>;
  decodedTextHash?: string;
}

export interface BeautyImageSafetyResult {
  status: "passed" | "rejected" | "manual_review_required";
  reasons: BeautyImageSafetyReason[];
  evidence: BeautyImageSafetyEvidence[];
  detectorVersion: typeof BEAUTY_IMAGE_SAFETY_DETECTOR_VERSION;
  width?: number;
  height?: number;
  sha256: string;
  boundary: "deterministic_risk_screen_only";
}

export interface BeautyContentRoleContractResult {
  version: typeof BEAUTY_IMAGE_CONTENT_ROLE_CONTRACT_VERSION;
  status: "rejected" | "manual_review_required";
  reasons: Array<"multi_panel_layout" | "content_semantics_unverified">;
  evidence: BeautyImageSafetyEvidence[];
  width?: number;
  height?: number;
  sha256: string;
  layoutChecks: { singleScene: boolean; dividerBandCount: number };
  semanticChecks: { packagingCarrier: "unsupported_locally" };
  boundary: "deterministic_layout_only_no_object_semantics";
}

const PROVIDER_NEGATIVE_SAFETY = "people, customer portrait, face, hands, real identifiable store, text, letters, numbers, pseudo text, gibberish, logo, brand mark, trademark, QR code, barcode, watermark, AI mark, interface, poster, information card, data table layout, button, label, price, discount, medical claim, treatment promise, customer case, before-and-after comparison, signage wall, reception logo wall, poster frame, price list, display board, countertop sign, table sign, desk sign, standing sign, display plaque, menu, flyer, brochure, QR payment sign, payment placard, front desk, reception counter, checkout counter, service counter, product display shelf, freestanding pedestal, screen, product label, printed packaging";
const ENGAGEMENT_NEGATIVE_SAFETY = "poster layout, card layout, checklist, infographic, social media interface, button, dialog box, title bar, caption area, blank copy area, hand, fingers, wrist, smartphone, phone screen, electronic device, device frame";
const SIGNAGE_CARRIER_FREE_COMPOSITION = "Use an oblique camera angle across the room. Keep plain textured wall surfaces broken up by curtains, timber slats, greenery or soft shadow. Frame the reception view around seating, floor, curtains, timber slats and greenery, not a reception counter. No central feature wall, no front-facing reception branding wall, no signage-bearing surface, no poster or menu display zone, no front desk, no reception counter, no checkout counter, no service counter, no product display shelf, no freestanding pedestal, no screen. If a table is essential to the role, keep its entire surface fully empty, uninterrupted and viewed obliquely, with no cards, plaques, stands, menus, flyers, brochures, QR payment signs, screens, devices, products or packaging.";
const MIN_EDGE_SEQUENCE_PIXEL_DENSITY = 0.09;
const MIN_GLYPH_LIKE_COMPONENT_RATIO = 1;
const MIN_CORNER_COMPONENT_HEIGHT_TO_UNION_HEIGHT = 0.55;
const MIN_PANEL_GRID_OCCUPANCY = 0.6;
const MIN_QR_FINDER_PATTERN_AGREEMENT = 0.72;
const MIN_BARCODE_EDGE_GROUP_DENSITY = 0.08;
const MIN_SPARSE_MARK_EDGE_GROUP_DENSITY = 0.07;
const MIN_BARCODE_EDGE_GROUPS = 14;
const MIN_ENCODED_STRIPE_MINOR_QUIET_ZONE = 0.45;
const MAX_ENCODED_STRIPE_EDGE_PERSISTENCE = 0.9;
const MIN_BARCODE_EDGE_INTERVAL_VARIATION = 0.35;
const MAX_BARCODE_EDGE_INTERVAL_VARIATION = 0.62;
const MIN_DISPLAY_TEXT_EDGE_PIXEL_DENSITY = 0.25;
const MAX_DISPLAY_TEXT_BASELINE_DEVIATION = 1.25;
const MAX_DISPLAY_TEXT_HEIGHT_VARIATION = 0.12;
const TOP_DISPLAY_TEXT_MAX_Y_RATIO = 0.2;
const TOP_DISPLAY_TEXT_MIN_ROW_TRANSITION_RATIO = 0.085;
const TOP_DISPLAY_TEXT_MIN_CONSECUTIVE_ROWS_RATIO = 0.008;
const TOP_DISPLAY_TEXT_MIN_HORIZONTAL_COVERAGE = 0.2;
const TOP_DISPLAY_TEXT_MAX_HORIZONTAL_COVERAGE = 0.85;
const TOP_DISPLAY_TEXT_MIN_LUMINANCE_DELTA = 18;
const TOP_CONNECTED_TEXT_MIN_WIDTH_RATIO = 0.1;
const TOP_CONNECTED_TEXT_MAX_WIDTH_RATIO = 0.35;
const TOP_CONNECTED_TEXT_MIN_HEIGHT_RATIO = 0.02;
const TOP_CONNECTED_TEXT_MAX_HEIGHT_RATIO = 0.08;
const TOP_CONNECTED_TEXT_MIN_FILL = 0.45;
const TOP_CONNECTED_TEXT_MIN_ASPECT_RATIO = 2;
const TOP_CONNECTED_TEXT_MAX_ASPECT_RATIO = 6;
const CENTER_DISPLAY_TEXT_MIN_Y_RATIO = 0.2;
const CENTER_DISPLAY_TEXT_MAX_Y_RATIO = 0.55;
const CENTER_DISPLAY_TEXT_MIN_ROW_TRANSITION_RATIO = 0.13;
const CENTER_DISPLAY_TEXT_MIN_CONSECUTIVE_ROWS_RATIO = 0.012;
const CENTER_DISPLAY_TEXT_MAX_BAND_GAP_RATIO = 0.08;
const CENTER_DISPLAY_TEXT_MAX_CENTER_DRIFT_RATIO = 0.12;

const ROLE_ART_DIRECTION: Record<BeautyImageRole, { purpose: string; composition: string; providerInstruction: string }> = {
  cover: {
    purpose: "承接默认标题，让目标顾客一眼识别本次主题",
    composition: "主体明确、上方或侧上方留出后期标题安全区",
    providerInstruction: "Editorial commercial interior photography of a premium contemporary beauty studio reception and consultation area. One clear focal point, layered foreground and background, realistic soft daylight, refined natural materials, warm neutral palette, clean upper-side negative space for later server-side typography, complete photographic composition."
  },
  content: {
    purpose: "补充正文中的项目与日常护理信息",
    composition: "近景环境与无包装材质细节，画面只表达一个信息",
    providerInstruction: "Editorial commercial interior photography of a serene professional beauty treatment room. Show one coherent care scene with clean folded towels, soft textiles, glass, stone, wood and subtle greenery, realistic material detail and natural daylight, strong depth and balanced composition, no product packaging."
  },
  engagement: {
    purpose: "以与正文主题一致的静物或环境细节自然收尾",
    composition: "与正文主题一致的完整纯摄影画面，使用静物或环境细节自然收尾，不预留文案区",
    providerInstruction: "Editorial commercial lifestyle interior photography of a calm aftercare consultation lounge in a premium contemporary beauty studio. Use two chairs, a small round table, soft textiles, warm realistic lighting and refined material depth. Complete photographic composition without poster structure or copy area."
  }
};

const DIRECTION_HEADINGS = [
  { role: "cover" as const, label: "封面图", pattern: /配图方向(?:一|1)\s*[｜|·:-]?\s*封面图/i },
  { role: "content" as const, label: "内容图", pattern: /配图方向(?:二|2)\s*[｜|·:-]?\s*内容图/i },
  { role: "engagement" as const, label: "互动承接图", pattern: /配图方向(?:三|3)\s*[｜|·:-]?\s*互动承接图/i }
];

export function parseBeautyImageDirections(output: string, imageCount: 1 | 3): BeautyImageDirection[] {
  const normalized = output.replace(/\r\n/g, "\n");
  const matches = DIRECTION_HEADINGS.map((definition) => ({ definition, match: definition.pattern.exec(normalized) }));
  const directions = matches.map((entry, index) => {
    if (!entry.match) throw new Error(`beauty_image_direction_missing:${entry.definition.role}`);
    const start = entry.match.index + entry.match[0].length;
    const next = matches.slice(index + 1).map((item) => item.match?.index).find((value): value is number => typeof value === "number") ?? normalized.length;
    const section = normalized.slice(start, next);
    const positive = capturePrompt(section, /(?:^|\n)\s*#{0,4}\s*正向视觉提示词(?:\s*[：:]\s*|\s*\n)([\s\S]*?)(?=\n\s*#{0,4}\s*(?:负向(?:视觉)?提示词|后期中文叠字|后期叠字|视觉参数)(?:\s*[：:]|\s*\n)|$)/i);
    const negative = capturePrompt(section, /(?:^|\n)\s*#{0,4}\s*负向(?:视觉)?提示词(?:\s*[：:]\s*|\s*\n)([\s\S]*?)(?=\n\s*#{0,4}\s*(?:后期中文叠字|后期叠字|视觉参数)(?:\s*[：:]|\s*\n)|$)/i);
    const postProductionText = capturePrompt(section, /(?:^|\n)\s*#{0,4}\s*(?:后期中文叠字|后期叠字)(?:\s*[：:]\s*|\s*\n)([\s\S]*?)(?=\n\s*#{0,4}\s*视觉参数(?:\s*[：:]|\s*\n)|$)/i);
    if (positive.length < 10 || negative.length < 5) throw new Error(`beauty_image_prompt_incomplete:${entry.definition.role}`);
    return { index, role: entry.definition.role, label: entry.definition.label, positivePrompt: positive.slice(0, 5000), negativePrompt: negative.slice(0, 5000), postProductionText: postProductionText.slice(0, 500) };
  });
  return directions.slice(0, imageCount);
}

export function buildBeautyImageProviderInput(
  direction: BeautyImageDirection,
  requirements: { overallVisualRequirements?: string; prohibitedContent?: string } = {}
): { prompt: string; negativePrompt: string; watermark: false; providerPromptVersion: typeof BEAUTY_IMAGE_PROVIDER_PROMPT_VERSION; commercialPhotoContractVersion: typeof BEAUTY_IMAGE_COMMERCIAL_PHOTO_CONTRACT_VERSION } {
  const source = `${direction.positivePrompt} ${requirements.overallVisualRequirements ?? ""}`;
  const style = inferCommercialPhotoStyle(source);
  const subject = inferBeautyServiceContext(source);
  const role = ROLE_ART_DIRECTION[direction.role];
  const prompt = [
    role.providerInstruction,
    SIGNAGE_CARRIER_FREE_COMPOSITION,
    subject,
    style,
    "Vertical 3:4 composition, 768 by 1024 delivery intent. Premium editorial quality, realistic lighting and shadows, physically plausible perspective, authentic material texture, elegant spatial depth, restrained styling, no cheap geometric illustration look.",
    "Pure photographic scene only. No people, no identifiable customer, no real identifiable store, no product branding, no text, no letters, no numbers, no logo, no QR code, no barcode, no watermark, no user interface. Chinese copy will be added later by the server and must not appear in this base image."
  ].filter(Boolean).join(" ");
  const negativePrompt = direction.role === "engagement"
    ? `${PROVIDER_NEGATIVE_SAFETY}, ${ENGAGEMENT_NEGATIVE_SAFETY}, flat vector art, simple geometric illustration, clip art, low-detail render, plastic material, distorted architecture`
    : `${PROVIDER_NEGATIVE_SAFETY}, flat vector art, simple geometric illustration, clip art, low-detail render, plastic material, distorted architecture`;
  return {
    prompt,
    negativePrompt,
    watermark: false,
    providerPromptVersion: BEAUTY_IMAGE_PROVIDER_PROMPT_VERSION,
    commercialPhotoContractVersion: BEAUTY_IMAGE_COMMERCIAL_PHOTO_CONTRACT_VERSION
  };
}

function inferCommercialPhotoStyle(value: string): string {
  const styles: string[] = [];
  if (/暖|温暖|暖色/u.test(value)) styles.push("warm neutral color grading");
  if (/干净|清爽|洁净/u.test(value)) styles.push("immaculate but lived-in cleanliness");
  if (/自然光|日光|窗光/u.test(value)) styles.push("soft natural daylight");
  if (/高级|质感|精致|奢华/u.test(value)) styles.push("refined premium editorial styling");
  if (/极简|简洁/u.test(value)) styles.push("minimal contemporary styling");
  if (/摄影|写实|真实/u.test(value)) styles.push("photorealistic commercial photography");
  return styles.length ? styles.join(", ") : "warm refined commercial photography with soft natural daylight";
}

function inferBeautyServiceContext(value: string): string {
  if (/美甲/u.test(value)) return "The scene subtly communicates professional nail care through clean workstation materials without tools that carry text or branding.";
  if (/美睫|睫毛/u.test(value)) return "The scene subtly communicates a calm eyelash care consultation environment without showing a person or procedure.";
  if (/头疗|头皮|养发/u.test(value)) return "The scene subtly communicates a calm non-medical scalp and hair care environment without showing a person or treatment claim.";
  if (/皮肤|护肤|补水|问题肌|护理/u.test(value)) return "The scene subtly communicates professional non-medical skincare and daily care without showing a person, diagnosis, treatment claim or before-and-after result.";
  return "The scene communicates a professional non-medical beauty care experience without inventing a specific store, customer or result.";
}

export function buildBeautyImageDeliveryPlan(input: {
  output: string;
  imageCount: 1 | 3;
  textSkillVersion: string;
}): BeautyXhsImageDeliveryPlan {
  const delivery = parseBeautyXhsDelivery(input.output, false);
  const directions = parseBeautyImageDirections(input.output, input.imageCount);
  const linkedTitle = delivery.customerDeliverable.titles[0]?.trim();
  if (!linkedTitle) throw new Error("beauty_image_linked_title_missing");
  return {
    version: BEAUTY_XHS_IMAGE_PLAN_VERSION,
    imageCount: input.imageCount,
    ratio: "3:4",
    linkedTitle,
    customerBoundary: "图片只生成纯画面；中文标题和互动短句由门店在成图后期另行叠加，不依赖绘图模型生成文字。",
    rightsBoundary: "本版默认无人物、无顾客肖像、无品牌、无特定门店实景；不使用未经确认的价格、疗效、案例或经营事实。",
    directions: directions.map((direction) => ({
      index: direction.index,
      role: direction.role,
      label: direction.label,
      purpose: ROLE_ART_DIRECTION[direction.role].purpose,
      composition: ROLE_ART_DIRECTION[direction.role].composition,
      textStrategy: direction.role === "engagement"
        ? "中文互动文案仅作为网页文字交付或后期叠字元数据，不进入图片生成画面"
        : "中文文字仅后期叠加"
    }))
  };
}

export function buildBeautyImageOverlays(input: { output: string; selectedTitle?: string }): BeautyImageOverlay[] {
  const delivery = parseBeautyXhsDelivery(input.output, false);
  const directions = parseBeautyImageDirections(input.output, 3);
  const requestedTitle = normalizeCustomerOverlay(input.selectedTitle ?? "");
  const selectedTitle = requestedTitle
    ? delivery.customerDeliverable.titles.find((title) => normalizeCustomerOverlay(title) === requestedTitle)
    : delivery.customerDeliverable.titles[0];
  if (!selectedTitle) throw new Error("beauty_image_selected_title_invalid");
  const contentInstruction = normalizeCustomerOverlay(directions.find((item) => item.role === "content")?.postProductionText ?? "");
  const engagementInstruction = normalizeCustomerOverlay(directions.find((item) => item.role === "engagement")?.postProductionText ?? "");
  const bodyLine = isCustomerReadyOverlay(contentInstruction)
    ? contentInstruction
    : firstCustomerSentence(delivery.customerDeliverable.body) || firstCustomerSentence(selectedTitle);
  const engagementLine = isCustomerReadyOverlay(engagementInstruction)
    ? engagementInstruction
    : firstCustomerSentence(delivery.customerDeliverable.engagement) || "欢迎留言说说你的关注点";
  return [
    { role: "cover", text: selectedTitle, source: "selected_title" },
    { role: "content", text: bodyLine, source: "customer_body" },
    { role: "engagement", text: engagementLine, source: "customer_engagement" }
  ];
}

function firstCustomerSentence(value: string): string {
  const normalized = normalizeCustomerOverlay(value).split(/[。！？!?；;]/u)[0]?.trim() ?? "";
  return normalized;
}

function isCustomerReadyOverlay(value: string): boolean {
  return Boolean(value) && !/(?:后期|叠加|短句|标题|待补|核验|提示词|文案区)/u.test(value);
}

function normalizeCustomerOverlay(value: string): string {
  return value.normalize("NFKC").replace(/[#*_`|<>\r\n]+/g, " ").replace(/\s+/g, " ").trim();
}

export function assessBeautyImageSafety(
  bytes: Buffer,
  input: { contentType: string; sha256?: string }
): BeautyImageSafetyResult {
  const sha256 = input.sha256 ?? createHash("sha256").update(bytes).digest("hex");
  const base = { detectorVersion: BEAUTY_IMAGE_SAFETY_DETECTOR_VERSION, sha256, boundary: "deterministic_risk_screen_only" as const };
  if (input.contentType !== "image/png") return { ...base, status: "rejected", reasons: ["unsupported_image_format"], evidence: [fixedEvidence("format", "unsupported_image_format")] };
  try {
    const image = PNG.sync.read(bytes);
    const sampled = sampleLuminance(image.data, image.width, image.height, 512);
    const evidence = [
      ...detectQrEvidence(sampled, image.width, image.height),
      ...detectBarcodeEvidence(sampled, image.width, image.height),
      ...detectCornerWatermarkEvidence(sampled, image.width, image.height),
      ...detectGlyphEvidence(sampled, image.width, image.height),
      ...detectInterfaceEvidence(sampled, image.width, image.height),
      ...detectPersonDeviceEvidence(sampled, image.width, image.height)
    ];
    const reasons = [...new Set(evidence.map((item) => item.reason))];
    const status = evidence.some((item) => item.decision === "rejected") ? "rejected" : evidence.length ? "manual_review_required" : "passed";
    return { ...base, status, reasons, evidence, width: image.width, height: image.height };
  } catch {
    return { ...base, status: "rejected", reasons: ["image_decode_failed"], evidence: [fixedEvidence("decode", "image_decode_failed")] };
  }
}

export function assessBeautyContentRoleContract(
  bytes: Buffer,
  input: { contentType: string; sha256?: string }
): BeautyContentRoleContractResult {
  const sha256 = input.sha256 ?? createHash("sha256").update(bytes).digest("hex");
  const base = {
    version: BEAUTY_IMAGE_CONTENT_ROLE_CONTRACT_VERSION,
    sha256,
    semanticChecks: { packagingCarrier: "unsupported_locally" as const },
    boundary: "deterministic_layout_only_no_object_semantics" as const
  };
  if (input.contentType !== "image/png") {
    return {
      ...base,
      status: "rejected",
      reasons: ["multi_panel_layout"],
      evidence: [fixedEvidence("format", "unsupported_image_format")],
      layoutChecks: { singleScene: false, dividerBandCount: 0 }
    };
  }
  try {
    const image = PNG.sync.read(bytes);
    const sampled = sampleLuminance(image.data, image.width, image.height, 512);
    const layout = detectMultiPanelContentLayout(sampled, image.width, image.height);
    if (layout) {
      return {
        ...base,
        status: "rejected",
        reasons: ["multi_panel_layout"],
        evidence: [layout],
        width: image.width,
        height: image.height,
        layoutChecks: { singleScene: false, dividerBandCount: Number(layout.metrics.dividerBandCount) }
      };
    }
    return {
      ...base,
      status: "manual_review_required",
      reasons: ["content_semantics_unverified"],
      evidence: [evidence("content_role_semantics", "content_semantics_unverified", "manual_review_required", 1, { x: 0, y: 0, width: image.width, height: image.height }, {
        contractVersion: BEAUTY_IMAGE_CONTENT_ROLE_CONTRACT_VERSION,
        packagingCarrierDetection: "unsupported_locally",
        localObjectModelConfigured: false,
        deterministicLayoutPassed: true
      })],
      width: image.width,
      height: image.height,
      layoutChecks: { singleScene: true, dividerBandCount: 0 }
    };
  } catch {
    return {
      ...base,
      status: "rejected",
      reasons: ["multi_panel_layout"],
      evidence: [fixedEvidence("decode", "image_decode_failed")],
      layoutChecks: { singleScene: false, dividerBandCount: 0 }
    };
  }
}

export function assessBeautyImageQualityForRole(
  bytes: Buffer,
  input: { contentType: string; role: BeautyImageRole; sha256?: string; deterministicReceipt?: BeautyDeterministicVisualReceiptContract }
): BeautyImageSafetyResult {
  const safety = assessBeautyImageSafety(bytes, input);
  if (safety.status !== "passed") return safety;
  if (input.deterministicReceipt) {
    const receipt = input.deterministicReceipt;
    const valid = receipt.version === BEAUTY_DETERMINISTIC_VISUAL_VERSION
      && receipt.source === "deterministic_canvas"
      && receipt.role === input.role
      && receipt.contentType === "image/png"
      && receipt.width === 768
      && receipt.height === 1024
      && receipt.sha256 === safety.sha256
      && /^[a-f0-9]{64}$/u.test(receipt.taskSnapshotHash)
      && /^[a-f0-9]{64}$/u.test(receipt.paletteHash)
      && receipt.scenePolicy === "generic_beauty_store_non_reference"
      && receipt.scene === receipt.layout
      && receipt.shapeCount > 0
      && receipt.elementCount >= 5;
    if (valid) return safety;
    return {
      ...safety,
      status: "rejected",
      reasons: ["image_decode_failed"],
      evidence: [fixedEvidence("decode", "image_decode_failed")]
    };
  }
  if (input.role !== "content") return safety;
  const roleContract = assessBeautyContentRoleContract(bytes, input);
  return {
    ...safety,
    status: roleContract.status,
    reasons: roleContract.reasons,
    evidence: roleContract.evidence,
    boundary: "deterministic_risk_screen_only",
    width: roleContract.width,
    height: roleContract.height
  };
}

export function inspectBeautyImageBarcodeCandidatesForEval(bytes: Buffer): Array<{
  bbox: Box;
  orientation: "vertical" | "horizontal";
  edgeGroups: number;
  directionConsistency: number;
  quietZoneScore: number;
  stripeScore: number;
  edgeGroupDensity: number;
  edgeIntervalVariation: number;
  edgeWidthVariation: number;
  gapWidthVariation: number;
  primaryAxisEdgeDensity: number;
  crossAxisEdgeDensity: number;
  minorQuietZoneScore: number;
  edgePersistence: number;
  minimumEdgeGroupDensity: number;
  minimumSparseMarkEdgeGroupDensity: number;
  minimumEdgeIntervalVariation: number;
  maximumEdgeIntervalVariation: number;
  minimumEdgeGroups: number;
  encodedBoundaryEvidence: boolean;
}> {
  const decoded = PNG.sync.read(bytes);
  const sampled = sampleLuminance(decoded.data, decoded.width, decoded.height, 512);
  return collectBarcodeCandidates(sampled).map((candidate) => ({
    bbox: toSourceBox(candidate.box, sampled, decoded.width, decoded.height),
    orientation: candidate.metrics.orientation,
    edgeGroups: candidate.metrics.edgeGroups,
    directionConsistency: round(candidate.metrics.consistency),
    quietZoneScore: round(candidate.metrics.quietZone),
    stripeScore: round(candidate.metrics.score),
    edgeGroupDensity: round(candidate.metrics.edgeGroupDensity),
    edgeIntervalVariation: round(candidate.metrics.edgeIntervalVariation),
    edgeWidthVariation: round(candidate.metrics.edgeWidthVariation),
    gapWidthVariation: round(candidate.metrics.gapWidthVariation),
    primaryAxisEdgeDensity: round(candidate.metrics.primaryAxisEdgeDensity),
    crossAxisEdgeDensity: round(candidate.metrics.crossAxisEdgeDensity),
    minorQuietZoneScore: round(candidate.metrics.minorQuietZone),
    edgePersistence: round(candidate.metrics.edgePersistence),
    minimumEdgeGroupDensity: MIN_BARCODE_EDGE_GROUP_DENSITY,
    minimumSparseMarkEdgeGroupDensity: MIN_SPARSE_MARK_EDGE_GROUP_DENSITY,
    minimumEdgeIntervalVariation: MIN_BARCODE_EDGE_INTERVAL_VARIATION,
    maximumEdgeIntervalVariation: MAX_BARCODE_EDGE_INTERVAL_VARIATION,
    minimumEdgeGroups: MIN_BARCODE_EDGE_GROUPS,
    encodedBoundaryEvidence: hasEncodedStripeBoundary(candidate.metrics)
  }));
}

export function inspectBeautyImageGlyphCandidatesForEval(bytes: Buffer): Array<{
  rank: number;
  bbox: Box;
  acceptedByCurrentThresholds: boolean;
  acceptedAsHighConfidenceDisplayText: boolean;
  metrics: ReturnType<typeof glyphCandidateMetrics>;
}> {
  const decoded = PNG.sync.read(bytes);
  const sampled = sampleLuminance(decoded.data, decoded.width, decoded.height, 512);
  return collectGlyphCandidates(sampled).map((candidate, index) => ({
    rank: index + 1,
    bbox: toSourceBox(candidate.box, sampled, decoded.width, decoded.height),
    acceptedByCurrentThresholds: candidate.accepted,
    acceptedAsHighConfidenceDisplayText: candidate.displayTextAccepted,
    metrics: candidate.metrics
  }));
}

export function inspectBeautyImageTopTextForEval(bytes: Buffer): {
  sampledWidth: number;
  sampledHeight: number;
  strokeBand: ReturnType<typeof detectTopDisplayTextStrokeBand>;
  thresholds: Array<{
    threshold: number;
    topComponentCount: number;
    topComponents: Array<Box & { pixels: number }>;
    glyphCandidates: ReturnType<typeof collectGlyphCandidates>;
  }>;
} {
  const decoded = PNG.sync.read(bytes);
  const sampled = sampleLuminance(decoded.data, decoded.width, decoded.height, 512);
  return {
    sampledWidth: sampled.width,
    sampledHeight: sampled.height,
    strokeBand: detectTopDisplayTextStrokeBand(sampled),
    thresholds: [18, 24, 30, 36, 42].map((threshold) => {
      const topComponents = edgeComponents(sampled, threshold)
        .filter((item) => item.y <= sampled.height * TOP_DISPLAY_TEXT_MAX_Y_RATIO)
        .sort((left, right) => left.y - right.y || left.x - right.x);
      return {
        threshold,
        topComponentCount: topComponents.length,
        topComponents,
        glyphCandidates: collectGlyphCandidates(sampled, threshold)
      };
    })
  };
}

function detectCornerWatermarkEvidence(image: SampledImage, sourceWidth: number, sourceHeight: number): BeautyImageSafetyEvidence[] {
  const regions = [
    { x: Math.floor(image.width * 0.5), y: Math.floor(image.height * 0.8), width: image.width - Math.floor(image.width * 0.5), height: image.height - Math.floor(image.height * 0.8) }
  ];
  for (const region of regions) {
    let sum = 0; let minimum = 255; let maximum = 0; let count = 0;
    for (let y = region.y; y < region.y + region.height; y += 1) for (let x = region.x; x < region.x + region.width; x += 1) { const value = image.gray[y * image.width + x]!; sum += value; count += 1; minimum = Math.min(minimum, value); maximum = Math.max(maximum, value); }
    const average = sum / Math.max(1, count);
    if (maximum - minimum < 42) continue;
    const threshold = Math.min(246, Math.max(205, average + 28));
    const mask = new Uint8Array(image.width * image.height);
    for (let y = region.y; y < region.y + region.height; y += 1) for (let x = region.x; x < region.x + region.width; x += 1) if (image.gray[y * image.width + x]! >= threshold) mask[y * image.width + x] = 1;
    const components = edgeComponentsFromMask(mask, image.width, image.height).filter((item) => item.width >= 2 && item.height >= 3 && item.width <= region.width * 0.28 && item.height <= region.height * 0.72 && item.pixels / Math.max(1, item.width * item.height) >= 0.12);
    const groups: Array<typeof components> = [];
    for (const component of components) {
      let group = groups.find((items) => Math.abs(component.y + component.height - median(items.map((item) => item.y + item.height))) <= Math.max(4, median(items.map((item) => item.height)) * 0.42));
      if (!group) { group = []; groups.push(group); }
      group.push(component);
    }
    let best = groups.filter((items) => items.length >= 3).map((items) => { const box = unionBoxes(items); return { items, box, metrics: cornerSequenceMetrics(items, box), mode: "bright_components" }; }).filter(({ box, metrics }) => box.width >= image.width * 0.1 && box.height <= region.height * 0.45 && box.width / Math.max(1, box.height) >= 2 && box.y + box.height >= image.height * 0.94 && metrics.widthCoverage >= 0.22 && metrics.edgePixelDensity >= MIN_EDGE_SEQUENCE_PIXEL_DENSITY && metrics.gapVariation <= 1.6 && metrics.heightVariation <= 0.55 && metrics.glyphLikeComponents / metrics.glyphComponents >= 0.75 && metrics.meanComponentHeightToUnionHeight >= MIN_CORNER_COMPONENT_HEIGHT_TO_UNION_HEIGHT).sort((left, right) => right.items.length - left.items.length)[0];
    if (!best) {
      const edgeComponents = edgeComponentsFromMask(edgeMask(image, 18), image.width, image.height).filter((item) => item.x >= region.x && item.y >= region.y && item.width >= 2 && item.height >= 3 && item.width <= region.width * 0.25 && item.height <= region.height * 0.5);
      const edgeGroups: Array<typeof edgeComponents> = [];
      for (const component of edgeComponents) {
        let group = edgeGroups.find((items) => Math.abs(component.y + component.height - median(items.map((item) => item.y + item.height))) <= Math.max(3, median(items.map((item) => item.height)) * 0.3));
        if (!group) { group = []; edgeGroups.push(group); }
        group.push(component);
      }
      best = edgeGroups.filter((items) => items.length >= 3).map((items) => { const box = unionBoxes(items); return { items, box, metrics: cornerSequenceMetrics(items, box), mode: "edge_components" }; }).filter(({ box, metrics }) => box.width >= image.width * 0.1 && box.height <= region.height * 0.45 && box.width / Math.max(1, box.height) >= 2 && box.y + box.height >= image.height * 0.94 && metrics.baselineDeviation <= 3 && metrics.widthCoverage >= 0.22 && metrics.edgePixelDensity >= MIN_EDGE_SEQUENCE_PIXEL_DENSITY && metrics.gapVariation <= 1.6 && metrics.heightVariation <= 0.55 && metrics.glyphLikeComponents / metrics.glyphComponents >= 0.75 && metrics.meanComponentHeightToUnionHeight >= MIN_CORNER_COMPONENT_HEIGHT_TO_UNION_HEIGHT).sort((left, right) => right.items.length - left.items.length)[0];
    }
    if (!best) continue;
    const confidence = clamp(0.82 + Math.min(0.12, best.items.length * 0.018) + (best.metrics.baselineDeviation <= 4 ? 0.05 : 0));
    return [evidence("corner_watermark", "interface_or_watermark_like", "rejected", confidence, toSourceBox(best.box, image, sourceWidth, sourceHeight), { ...best.metrics, localThreshold: round(threshold), componentMode: best.mode, corner: "bottom_right", readableSequenceRecovered: false })];
  }
  return [];
}

export function buildBeautyMediaRequestKey(runId: string, batchKey: string, index: number): string {
  const digest = createHash("sha256").update(`${runId}:${batchKey}:${index}`).digest("hex").slice(0, 40);
  return `beauty_xhs_${digest}`;
}

export function validateBeautyVideoEvidence(input: { framesAnalyzed: number; frameSummary?: string; transcript?: string }): { ok: true } | { ok: false; reason: "beauty_video_evidence_missing" } {
  const hasFrames = Number.isInteger(input.framesAnalyzed) && input.framesAnalyzed > 0 && Boolean(input.frameSummary?.trim());
  const hasTranscript = Boolean(input.transcript?.trim());
  return hasFrames || hasTranscript ? { ok: true } : { ok: false, reason: "beauty_video_evidence_missing" };
}

function capturePrompt(section: string, pattern: RegExp): string {
  return (pattern.exec(section)?.[1] ?? "").replace(/^[-*#\s]+/, "").replace(/\s+/g, " ").trim();
}

type SampledImage = { width: number; height: number; gray: Uint8Array; red: Uint8Array; green: Uint8Array; blue: Uint8Array };
type Box = { x: number; y: number; width: number; height: number };

function cornerSequenceMetrics(items: Array<Box & { pixels: number }>, box: Box) {
  const orderedItems = [...items].sort((left, right) => left.x - right.x);
  const componentHeights = orderedItems.map((item) => item.height);
  const componentWidths = orderedItems.map((item) => item.width);
  const gaps = orderedItems.slice(1).map((item, index) => Math.max(0, item.x - (orderedItems[index]!.x + orderedItems[index]!.width)));
  return {
    glyphComponents: orderedItems.length,
    glyphLikeComponents: orderedItems.filter((item) => item.width / Math.max(1, item.height) >= 0.18 && item.width / Math.max(1, item.height) <= 2.4).length,
    baselineDeviation: round(standardDeviation(orderedItems.map((item) => item.y + item.height))),
    heightVariation: round(standardDeviation(componentHeights) / Math.max(1, mean(componentHeights))),
    gapVariation: round(gaps.length ? standardDeviation(gaps) / Math.max(1, mean(gaps)) : 0),
    widthCoverage: round(componentWidths.reduce((sum, width) => sum + width, 0) / Math.max(1, box.width)),
    edgePixelDensity: round(orderedItems.reduce((sum, item) => sum + item.pixels, 0) / Math.max(1, box.width * box.height)),
    meanComponentFill: round(mean(orderedItems.map((item) => item.pixels / Math.max(1, item.width * item.height)))),
    meanComponentWidth: round(mean(componentWidths)),
    meanComponentHeight: round(mean(componentHeights)),
    meanComponentHeightToUnionHeight: round(mean(componentHeights) / Math.max(1, box.height)),
    minimumComponentHeightToUnionHeight: MIN_CORNER_COMPONENT_HEIGHT_TO_UNION_HEIGHT
  };
}

function sampleLuminance(data: Buffer, width: number, height: number, maxSide: number): SampledImage {
  const scale = Math.min(1, maxSide / Math.max(width, height));
  const sampledWidth = Math.max(1, Math.round(width * scale));
  const sampledHeight = Math.max(1, Math.round(height * scale));
  const gray = new Uint8Array(sampledWidth * sampledHeight);
  const red = new Uint8Array(sampledWidth * sampledHeight);
  const green = new Uint8Array(sampledWidth * sampledHeight);
  const blue = new Uint8Array(sampledWidth * sampledHeight);
  for (let y = 0; y < sampledHeight; y += 1) {
    const sourceY = Math.min(height - 1, Math.floor(y / scale));
    for (let x = 0; x < sampledWidth; x += 1) {
      const sourceX = Math.min(width - 1, Math.floor(x / scale));
      const offset = (sourceY * width + sourceX) * 4;
      const sampledOffset = y * sampledWidth + x;
      red[sampledOffset] = data[offset]!;
      green[sampledOffset] = data[offset + 1]!;
      blue[sampledOffset] = data[offset + 2]!;
      gray[sampledOffset] = Math.round(data[offset]! * 0.299 + data[offset + 1]! * 0.587 + data[offset + 2]! * 0.114);
    }
  }
  return { width: sampledWidth, height: sampledHeight, gray, red, green, blue };
}

function detectPersonDeviceEvidence(image: SampledImage, sourceWidth: number, sourceHeight: number): BeautyImageSafetyEvidence[] {
  const skinMask = new Uint8Array(image.width * image.height);
  const brightNeutralMask = new Uint8Array(image.width * image.height);
  for (let index = 0; index < image.gray.length; index += 1) {
    const red = image.red[index]!;
    const green = image.green[index]!;
    const blue = image.blue[index]!;
    const maximum = Math.max(red, green, blue);
    const minimum = Math.min(red, green, blue);
    const sum = Math.max(1, red + green + blue);
    if (red >= 92 && green >= 45 && blue >= 28 && red > green && green > blue * 0.72 && red - blue >= 18 && maximum - minimum >= 18 && red / sum >= 0.36 && red / sum <= 0.5) skinMask[index] = 1;
    if (image.gray[index]! >= 174 && maximum - minimum <= 32) brightNeutralMask[index] = 1;
  }
  const skinComponents = edgeComponentsFromMask(skinMask, image.width, image.height)
    .filter((item) => item.pixels / Math.max(1, image.width * image.height) >= 0.012);
  const screens = edgeComponentsFromMask(brightNeutralMask, image.width, image.height)
    .map((item) => ({
      ...item,
      areaRatio: item.pixels / Math.max(1, image.width * image.height),
      fillRatio: item.pixels / Math.max(1, item.width * item.height),
      portraitAspectRatio: item.height / Math.max(1, item.width)
    }))
    .filter((item) => item.areaRatio >= 0.035 && item.fillRatio >= 0.42 && item.portraitAspectRatio >= 1.12 && item.portraitAspectRatio <= 2.65)
    .filter((item) => item.x >= image.width * 0.025 && item.y >= image.height * 0.025 && item.x + item.width <= image.width * 0.975 && item.y + item.height <= image.height * 0.975)
    .sort((left, right) => right.pixels - left.pixels);
  const edges = edgeMask(image, 32);
  for (const screen of screens) {
    const padding = Math.max(4, Math.round(Math.min(screen.width, screen.height) * 0.12));
    const expanded = expandBox(screen, padding, image.width, image.height);
    let darkPixels = 0;
    let edgePixels = 0;
    let skinPixels = 0;
    let sampledPixels = 0;
    for (let y = expanded.y; y < expanded.y + expanded.height; y += 1) for (let x = expanded.x; x < expanded.x + expanded.width; x += 1) {
      const index = y * image.width + x;
      sampledPixels += 1;
      if (image.gray[index]! <= 82) darkPixels += 1;
      if (edges[index]) edgePixels += 1;
      if (skinMask[index]) skinPixels += 1;
    }
    const darkFrameRatio = darkPixels / Math.max(1, sampledPixels);
    const edgePixelDensity = edgePixels / Math.max(1, sampledPixels);
    const adjacentSkinRatio = skinPixels / Math.max(1, sampledPixels);
    const relatedSkin = skinComponents.filter((component) => boxIntersectionRatio(expandBox(screen, padding * 2, image.width, image.height), component) > 0.05);
    if (darkFrameRatio < 0.025 || edgePixelDensity < 0.018 || adjacentSkinRatio < 0.028 || !relatedSkin.length) continue;
    const box = unionBoxes([screen, ...relatedSkin]);
    const confidence = clamp(0.86 + Math.min(0.05, darkFrameRatio * 0.4) + Math.min(0.05, adjacentSkinRatio * 0.35) + Math.min(0.04, edgePixelDensity * 0.5));
    return [evidence("person_device_geometry", "person_or_device_like", "rejected", confidence, toSourceBox(box, image, sourceWidth, sourceHeight), {
      screenAreaRatio: round(screen.areaRatio),
      screenFillRatio: round(screen.fillRatio),
      portraitAspectRatio: round(screen.portraitAspectRatio),
      darkFrameRatio: round(darkFrameRatio),
      edgePixelDensity: round(edgePixelDensity),
      adjacentSkinRatio: round(adjacentSkinRatio),
      relatedSkinComponents: relatedSkin.length,
      evidenceMode: "bright_neutral_screen_dark_frame_skin_proximity",
      readableSequenceRecovered: false
    })];
  }
  return [];
}

function expandBox(box: Box, padding: number, width: number, height: number): Box {
  const x = Math.max(0, box.x - padding);
  const y = Math.max(0, box.y - padding);
  const right = Math.min(width, box.x + box.width + padding);
  const bottom = Math.min(height, box.y + box.height + padding);
  return { x, y, width: Math.max(1, right - x), height: Math.max(1, bottom - y) };
}

function detectQrEvidence(image: SampledImage, sourceWidth: number, sourceHeight: number): BeautyImageSafetyEvidence[] {
  const centers = qrFinderCenters(image);
  const distinct = nonOverlapping(centers.map((item) => ({ x: item.x - item.module * 3.5, y: item.y - item.module * 3.5, width: item.module * 7, height: item.module * 7, ratioError: item.ratioError, patternAgreement: qrFinderPatternAgreement(image, item.x, item.y, item.module) })))
    .filter((box) => box.x >= 0 && box.y >= 0 && box.x + box.width <= image.width && box.y + box.height <= image.height);
  for (let first = 0; first < distinct.length; first += 1) for (let second = first + 1; second < distinct.length; second += 1) for (let third = second + 1; third < distinct.length; third += 1) {
    const trio = [distinct[first]!, distinct[second]!, distinct[third]!];
    const geometry = qrFinderGeometry(trio);
    if (!geometry.ok) continue;
    const box = unionBoxes(trio);
    const averageError = mean(trio.map((item) => item.ratioError));
    const patternAgreements = trio.map((item) => item.patternAgreement);
    const averagePatternAgreement = mean(patternAgreements);
    if (averagePatternAgreement < MIN_QR_FINDER_PATTERN_AGREEMENT) continue;
    const confidence = clamp(0.83 + (1 - averageError) * 0.12 + geometry.score * 0.05);
    return [evidence("qr_finder_pattern", "qr_or_barcode_like", "rejected", confidence, toSourceBox(box, image, sourceWidth, sourceHeight), { finderPatternCount: 3, runRatio: "1:1:3:1:1", averageRatioError: round(averageError), rightAngleScore: round(geometry.score), minimumPatternAgreement: round(Math.min(...patternAgreements)), averagePatternAgreement: round(averagePatternAgreement), minimumAveragePatternAgreement: MIN_QR_FINDER_PATTERN_AGREEMENT, decoded: false })];
  }
  return [];
}

function qrFinderPatternAgreement(image: SampledImage, centerX: number, centerY: number, module: number): number {
  const radius = module * 3.5;
  const startX = Math.max(0, Math.floor(centerX - radius));
  const startY = Math.max(0, Math.floor(centerY - radius));
  const endX = Math.min(image.width - 1, Math.ceil(centerX + radius));
  const endY = Math.min(image.height - 1, Math.ceil(centerY + radius));
  let minimum = 255; let maximum = 0;
  for (let y = startY; y <= endY; y += 1) for (let x = startX; x <= endX; x += 1) {
    const value = image.gray[y * image.width + x]!;
    minimum = Math.min(minimum, value); maximum = Math.max(maximum, value);
  }
  if (maximum - minimum < 48) return 0;
  const threshold = minimum + (maximum - minimum) * 0.52;
  let matched = 0; let sampled = 0;
  for (let gridY = -3; gridY <= 3; gridY += 1) for (let gridX = -3; gridX <= 3; gridX += 1) {
    const x = Math.round(centerX + gridX * module);
    const y = Math.round(centerY + gridY * module);
    if (x < 0 || y < 0 || x >= image.width || y >= image.height) continue;
    const expectedDark = Math.abs(gridX) === 3 || Math.abs(gridY) === 3 || (Math.abs(gridX) <= 1 && Math.abs(gridY) <= 1);
    const actualDark = image.gray[y * image.width + x]! < threshold;
    if (actualDark === expectedDark) matched += 1;
    sampled += 1;
  }
  return matched / Math.max(1, sampled);
}

function detectBarcodeEvidence(image: SampledImage, sourceWidth: number, sourceHeight: number): BeautyImageSafetyEvidence[] {
  for (const candidate of collectBarcodeCandidates(image)) {
    const best = candidate.metrics;
    if (best.edgeGroups < MIN_BARCODE_EDGE_GROUPS) continue;
    const encodedBoundaryEvidence = hasEncodedStripeBoundary(best);
    if (!encodedBoundaryEvidence) continue;
    const sparseMarkEvidence = best.minorQuietZone >= MIN_ENCODED_STRIPE_MINOR_QUIET_ZONE && best.edgeGroupDensity >= MIN_SPARSE_MARK_EDGE_GROUP_DENSITY;
    if (best.edgeGroupDensity < MIN_BARCODE_EDGE_GROUP_DENSITY && !sparseMarkEvidence) continue;
    if (best.edgeIntervalVariation < MIN_BARCODE_EDGE_INTERVAL_VARIATION || best.edgeIntervalVariation > MAX_BARCODE_EDGE_INTERVAL_VARIATION) continue;
    const confidence = clamp(0.74 + Math.min(0.16, best.edgeGroups / 100) + Math.min(0.08, (best.consistency - 0.6) * 0.2));
    return [evidence("barcode_stripes", "qr_or_barcode_like", confidence >= 0.82 ? "rejected" : "manual_review_required", confidence, toSourceBox(candidate.box, image, sourceWidth, sourceHeight), { orientation: best.orientation, edgeGroups: best.edgeGroups, minimumEdgeGroups: MIN_BARCODE_EDGE_GROUPS, edgeGroupDensity: round(best.edgeGroupDensity), minimumEdgeGroupDensity: MIN_BARCODE_EDGE_GROUP_DENSITY, minimumSparseMarkEdgeGroupDensity: MIN_SPARSE_MARK_EDGE_GROUP_DENSITY, directionConsistency: round(best.consistency), quietZoneScore: round(best.quietZone), edgeIntervalVariation: round(best.edgeIntervalVariation), minimumEdgeIntervalVariation: MIN_BARCODE_EDGE_INTERVAL_VARIATION, maximumEdgeIntervalVariation: MAX_BARCODE_EDGE_INTERVAL_VARIATION, minorQuietZoneScore: round(best.minorQuietZone), minimumEncodedStripeMinorQuietZone: MIN_ENCODED_STRIPE_MINOR_QUIET_ZONE, edgePersistence: round(best.edgePersistence), maximumEncodedStripeEdgePersistence: MAX_ENCODED_STRIPE_EDGE_PERSISTENCE, encodedBoundaryEvidence, sparseMarkEvidence, stripeScore: round(best.score), decoded: false })];
  }
  return [];
}

function hasEncodedStripeBoundary(metrics: ReturnType<typeof stripeMetrics>): boolean {
  return metrics.minorQuietZone >= MIN_ENCODED_STRIPE_MINOR_QUIET_ZONE || metrics.edgePersistence <= MAX_ENCODED_STRIPE_EDGE_PERSISTENCE;
}

function collectBarcodeCandidates(image: SampledImage): Array<{ box: Box; metrics: ReturnType<typeof stripeMetrics> }> {
  const candidates: Array<{ box: Box; metrics: ReturnType<typeof stripeMetrics> }> = [];
  for (const width of [72, 104, 144, 192]) for (const height of [32, 48, 72, 96]) {
    if (width > image.width || height > image.height) continue;
    const stepX = Math.max(12, Math.floor(width / 3)); const stepY = Math.max(10, Math.floor(height / 3));
    for (let y = 0; y + height <= image.height; y += stepY) for (let x = 0; x + width <= image.width; x += stepX) {
      const vertical = stripeMetrics(image, x, y, width, height, "vertical");
      const horizontal = stripeMetrics(image, x, y, width, height, "horizontal");
      const best = vertical.score >= horizontal.score ? vertical : horizontal;
      if (best.edgeGroups < 10 || best.consistency < 0.62 || best.quietZone < 0.6 || best.score < 0.72) continue;
      candidates.push({ box: { x, y, width, height }, metrics: best });
    }
  }
  return candidates.sort((left, right) => right.metrics.score - left.metrics.score || right.metrics.edgeGroupDensity - left.metrics.edgeGroupDensity);
}

function detectMultiPanelContentLayout(image: SampledImage, sourceWidth: number, sourceHeight: number): BeautyImageSafetyEvidence | undefined {
  const qualifyingRows: Array<{ y: number; brightCoverage: number; luminanceSpread: number }> = [];
  for (let y = 1; y < image.height - 1; y += 1) {
    const values: number[] = [];
    let brightPixels = 0;
    for (let x = 0; x < image.width; x += 1) {
      const value = image.gray[y * image.width + x]!;
      values.push(value);
      if (value >= 238) brightPixels += 1;
    }
    const brightCoverage = brightPixels / Math.max(1, image.width);
    const luminanceSpread = standardDeviation(values);
    if (brightCoverage >= 0.97 && luminanceSpread <= 9) qualifyingRows.push({ y, brightCoverage, luminanceSpread });
  }
  const bands: Array<{ start: number; end: number; brightCoverage: number; luminanceSpread: number }> = [];
  for (const row of qualifyingRows) {
    const previous = bands.at(-1);
    if (previous && row.y === previous.end + 1) {
      previous.end = row.y;
      previous.brightCoverage = Math.min(previous.brightCoverage, row.brightCoverage);
      previous.luminanceSpread = Math.max(previous.luminanceSpread, row.luminanceSpread);
    } else {
      bands.push({ start: row.y, end: row.y, brightCoverage: row.brightCoverage, luminanceSpread: row.luminanceSpread });
    }
  }
  const dividers = bands.filter((band) => {
    const center = (band.start + band.end) / 2;
    const height = band.end - band.start + 1;
    return center >= image.height * 0.18 && center <= image.height * 0.82 && height <= Math.max(6, image.height * 0.025);
  });
  if (dividers.length < 2) return undefined;
  for (let firstIndex = 0; firstIndex < dividers.length - 1; firstIndex += 1) {
    for (let secondIndex = firstIndex + 1; secondIndex < dividers.length; secondIndex += 1) {
      const first = dividers[firstIndex]!;
      const second = dividers[secondIndex]!;
      const firstCenter = (first.start + first.end) / 2;
      const secondCenter = (second.start + second.end) / 2;
      const panelRatios = [firstCenter / image.height, (secondCenter - firstCenter) / image.height, (image.height - secondCenter) / image.height];
      if (panelRatios.some((ratio) => ratio < 0.22 || ratio > 0.45)) continue;
      const sourceBox = toSourceBox({ x: 0, y: first.start, width: image.width, height: second.end - first.start + 1 }, image, sourceWidth, sourceHeight);
      return evidence("content_role_layout", "multi_panel_layout", "rejected", 0.99, sourceBox, {
        contractVersion: BEAUTY_IMAGE_CONTENT_ROLE_CONTRACT_VERSION,
        dividerBandCount: 2,
        firstDividerYRatio: round(firstCenter / image.height),
        secondDividerYRatio: round(secondCenter / image.height),
        panelHeightRatios: panelRatios.map(round).join(","),
        minimumBrightCoverage: round(Math.min(first.brightCoverage, second.brightCoverage)),
        maximumLuminanceSpread: round(Math.max(first.luminanceSpread, second.luminanceSpread)),
        packagingCarrierDetection: "unsupported_locally"
      });
    }
  }
  return undefined;
}

function detectGlyphEvidence(image: SampledImage, sourceWidth: number, sourceHeight: number): BeautyImageSafetyEvidence[] {
  const centeredDisplayText = detectCenterDisplayTextStrokeBands(image);
  if (centeredDisplayText) {
    return [evidence("glyph_sequence", "visible_text_or_brand_like", "rejected", 0.96, toSourceBox(centeredDisplayText.box, image, sourceWidth, sourceHeight), {
      candidateSelectionMode: "center_display_text_stroke_band",
      bandCount: centeredDisplayText.bandCount,
      firstBandRows: centeredDisplayText.firstBandRows,
      secondBandRows: centeredDisplayText.secondBandRows,
      firstBandMeanTransitions: round(centeredDisplayText.firstBandMeanTransitions),
      secondBandMeanTransitions: round(centeredDisplayText.secondBandMeanTransitions),
      minimumRowTransitions: centeredDisplayText.minimumRowTransitions,
      bandGapRatio: round(centeredDisplayText.bandGapRatio),
      maximumBandGapRatio: CENTER_DISPLAY_TEXT_MAX_BAND_GAP_RATIO,
      centerDriftRatio: round(centeredDisplayText.centerDriftRatio),
      maximumCenterDriftRatio: CENTER_DISPLAY_TEXT_MAX_CENTER_DRIFT_RATIO,
      minimumYRatio: CENTER_DISPLAY_TEXT_MIN_Y_RATIO,
      maximumYRatio: CENTER_DISPLAY_TEXT_MAX_Y_RATIO,
      readableSequenceRecovered: false
    })];
  }
  const eligible = collectGlyphCandidates(image);
  const firstRanked = eligible[0];
  const displayTextCandidate = firstRanked?.accepted ? undefined : eligible.find((candidate) => candidate.displayTextAccepted);
  const best = firstRanked?.accepted ? firstRanked : displayTextCandidate;
  if (!best) {
    const strokeBand = detectTopDisplayTextStrokeBand(image);
    if (strokeBand) {
      return [evidence("glyph_sequence", "visible_text_or_brand_like", "rejected", 0.9, toSourceBox(strokeBand.box, image, sourceWidth, sourceHeight), {
        candidateSelectionMode: "high_density_top_stroke_band",
        qualifyingRows: strokeBand.qualifyingRows,
        consecutiveRows: strokeBand.consecutiveRows,
        minimumConsecutiveRows: strokeBand.minimumConsecutiveRows,
        peakRowTransitions: strokeBand.peakRowTransitions,
        meanRowTransitions: round(strokeBand.meanRowTransitions),
        minimumRowTransitions: strokeBand.minimumRowTransitions,
        horizontalCoverage: round(strokeBand.horizontalCoverage),
        minimumHorizontalCoverage: TOP_DISPLAY_TEXT_MIN_HORIZONTAL_COVERAGE,
        maximumHorizontalCoverage: TOP_DISPLAY_TEXT_MAX_HORIZONTAL_COVERAGE,
        maximumTopYRatio: TOP_DISPLAY_TEXT_MAX_Y_RATIO,
        minimumLuminanceDelta: TOP_DISPLAY_TEXT_MIN_LUMINANCE_DELTA,
        readableSequenceRecovered: false
      })];
    }
    const connectedTopText = detectTopConnectedDisplayText(image);
    if (!connectedTopText) return [];
    return [evidence("glyph_sequence", "visible_text_or_brand_like", "rejected", 0.92, toSourceBox(connectedTopText.component, image, sourceWidth, sourceHeight), {
      candidateSelectionMode: "connected_top_display_text_block",
      componentPixels: connectedTopText.component.pixels,
      componentFill: round(connectedTopText.fill),
      componentAspectRatio: round(connectedTopText.aspectRatio),
      widthRatio: round(connectedTopText.widthRatio),
      heightRatio: round(connectedTopText.heightRatio),
      maximumTopYRatio: TOP_DISPLAY_TEXT_MAX_Y_RATIO,
      minimumWidthRatio: TOP_CONNECTED_TEXT_MIN_WIDTH_RATIO,
      maximumWidthRatio: TOP_CONNECTED_TEXT_MAX_WIDTH_RATIO,
      minimumHeightRatio: TOP_CONNECTED_TEXT_MIN_HEIGHT_RATIO,
      maximumHeightRatio: TOP_CONNECTED_TEXT_MAX_HEIGHT_RATIO,
      minimumComponentFill: TOP_CONNECTED_TEXT_MIN_FILL,
      minimumAspectRatio: TOP_CONNECTED_TEXT_MIN_ASPECT_RATIO,
      maximumAspectRatio: TOP_CONNECTED_TEXT_MAX_ASPECT_RATIO,
      readableSequenceRecovered: false
    })];
  }
  const selectionMode = displayTextCandidate ? "high_confidence_top_display_text" : "highest_component_count";
  const { baselineDeviation, gapVariation, widthCoverage, edgePixelDensity, meanComponentFill, heightVariation, componentAspectRatios, glyphLikeComponents, glyphLikeRatio } = best.metrics;
  const confidence = clamp(0.68 + Math.min(0.2, best.items.length * 0.032) + (baselineDeviation <= 4 ? 0.08 : 0) + (gapVariation <= 1.4 ? 0.04 : 0));
  const corner = !displayTextCandidate && (best.box.y <= image.height * 0.15 || best.box.y + best.box.height >= image.height * 0.85);
  const detectorType = corner ? "corner_watermark" : "glyph_sequence";
  const reason: BeautyImageSafetyReason = corner ? "interface_or_watermark_like" : "visible_text_or_brand_like";
  return [evidence(detectorType, reason, confidence >= 0.84 ? "rejected" : "manual_review_required", confidence, toSourceBox(best.box, image, sourceWidth, sourceHeight), { glyphCount: best.items.length, glyphLikeComponents, glyphLikeRatio: round(glyphLikeRatio), minimumGlyphLikeRatio: MIN_GLYPH_LIKE_COMPONENT_RATIO, minimumComponentAspectRatio: round(Math.min(...componentAspectRatios)), maximumComponentAspectRatio: round(Math.max(...componentAspectRatios)), meanComponentAspectRatio: round(mean(componentAspectRatios)), baselineDeviation: round(baselineDeviation), gapVariation: round(gapVariation), heightVariation: round(heightVariation), widthCoverage: round(widthCoverage), edgePixelDensity: round(edgePixelDensity), meanComponentFill: round(meanComponentFill), contourMode: "edge_component_sequence", candidateSelectionMode: selectionMode, minimumDisplayTextEdgePixelDensity: MIN_DISPLAY_TEXT_EDGE_PIXEL_DENSITY, maximumDisplayTextBaselineDeviation: MAX_DISPLAY_TEXT_BASELINE_DEVIATION, maximumDisplayTextHeightVariation: MAX_DISPLAY_TEXT_HEIGHT_VARIATION, readableSequenceRecovered: false })];
}

function detectCenterDisplayTextStrokeBands(image: SampledImage): {
  box: Box;
  bandCount: number;
  firstBandRows: number;
  secondBandRows: number;
  firstBandMeanTransitions: number;
  secondBandMeanTransitions: number;
  minimumRowTransitions: number;
  bandGapRatio: number;
  centerDriftRatio: number;
} | undefined {
  const minimumY = Math.max(1, Math.floor(image.height * CENTER_DISPLAY_TEXT_MIN_Y_RATIO));
  const maximumY = Math.min(image.height - 1, Math.ceil(image.height * CENTER_DISPLAY_TEXT_MAX_Y_RATIO));
  const minimumX = Math.max(1, Math.floor(image.width * 0.1));
  const maximumX = Math.min(image.width - 1, Math.ceil(image.width * 0.9));
  const minimumRowTransitions = Math.max(24, Math.ceil(image.width * CENTER_DISPLAY_TEXT_MIN_ROW_TRANSITION_RATIO));
  const minimumConsecutiveRows = Math.max(5, Math.ceil(image.height * CENTER_DISPLAY_TEXT_MIN_CONSECUTIVE_ROWS_RATIO));
  const rows: Array<{ y: number; transitions: number; minimumX: number; maximumX: number }> = [];
  for (let y = minimumY; y < maximumY; y += 1) {
    let transitions = 0;
    let firstX = image.width;
    let lastX = -1;
    for (let x = minimumX; x < maximumX; x += 1) {
      const left = image.gray[y * image.width + x - 1]!;
      const right = image.gray[y * image.width + x + 1]!;
      if (Math.abs(right - left) < 36) continue;
      transitions += 1;
      firstX = Math.min(firstX, x);
      lastX = Math.max(lastX, x);
    }
    if (transitions >= minimumRowTransitions) rows.push({ y, transitions, minimumX: firstX, maximumX: lastX });
  }
  const groups: Array<typeof rows> = [];
  for (const row of rows) {
    const current = groups.at(-1);
    if (current?.length && row.y === current.at(-1)!.y + 1) current.push(row);
    else groups.push([row]);
  }
  const bands = groups.filter((group) => group.length >= minimumConsecutiveRows).map((group) => {
    const firstX = Math.min(...group.map((row) => row.minimumX));
    const lastX = Math.max(...group.map((row) => row.maximumX));
    return {
      group,
      box: { x: firstX, y: group[0]!.y, width: lastX - firstX + 1, height: group.at(-1)!.y - group[0]!.y + 1 },
      centerX: (firstX + lastX) / 2,
      meanTransitions: mean(group.map((row) => row.transitions))
    };
  }).filter((band) => band.box.width / Math.max(1, image.width) >= 0.2 && band.box.width / Math.max(1, image.width) <= 0.75);
  for (let index = 0; index < bands.length - 1; index += 1) {
    const first = bands[index]!;
    const second = bands[index + 1]!;
    const bandGapRatio = (second.box.y - (first.box.y + first.box.height)) / Math.max(1, image.height);
    const centerDriftRatio = Math.abs(first.centerX - second.centerX) / Math.max(1, image.width);
    if (bandGapRatio < 0 || bandGapRatio > CENTER_DISPLAY_TEXT_MAX_BAND_GAP_RATIO || centerDriftRatio > CENTER_DISPLAY_TEXT_MAX_CENTER_DRIFT_RATIO) continue;
    return {
      box: unionBoxes([first.box, second.box]),
      bandCount: 2,
      firstBandRows: first.group.length,
      secondBandRows: second.group.length,
      firstBandMeanTransitions: first.meanTransitions,
      secondBandMeanTransitions: second.meanTransitions,
      minimumRowTransitions,
      bandGapRatio,
      centerDriftRatio
    };
  }
  return undefined;
}

function detectTopConnectedDisplayText(image: SampledImage): {
  component: Box & { pixels: number };
  fill: number;
  aspectRatio: number;
  widthRatio: number;
  heightRatio: number;
} | undefined {
  return edgeComponents(image)
    .filter((component) => component.y <= image.height * TOP_DISPLAY_TEXT_MAX_Y_RATIO)
    .map((component) => {
      const widthRatio = component.width / Math.max(1, image.width);
      const heightRatio = component.height / Math.max(1, image.height);
      const fill = component.pixels / Math.max(1, component.width * component.height);
      const aspectRatio = component.width / Math.max(1, component.height);
      return { component, fill, aspectRatio, widthRatio, heightRatio };
    })
    .filter((candidate) => candidate.widthRatio >= TOP_CONNECTED_TEXT_MIN_WIDTH_RATIO
      && candidate.widthRatio <= TOP_CONNECTED_TEXT_MAX_WIDTH_RATIO
      && candidate.heightRatio >= TOP_CONNECTED_TEXT_MIN_HEIGHT_RATIO
      && candidate.heightRatio <= TOP_CONNECTED_TEXT_MAX_HEIGHT_RATIO
      && candidate.fill >= TOP_CONNECTED_TEXT_MIN_FILL
      && candidate.aspectRatio >= TOP_CONNECTED_TEXT_MIN_ASPECT_RATIO
      && candidate.aspectRatio <= TOP_CONNECTED_TEXT_MAX_ASPECT_RATIO)
    .sort((left, right) => right.fill - left.fill || right.component.pixels - left.component.pixels)[0];
}

function detectTopDisplayTextStrokeBand(image: SampledImage): {
  box: Box;
  qualifyingRows: number;
  consecutiveRows: number;
  minimumConsecutiveRows: number;
  peakRowTransitions: number;
  meanRowTransitions: number;
  minimumRowTransitions: number;
  horizontalCoverage: number;
} | undefined {
  const maximumY = Math.max(1, Math.floor(image.height * TOP_DISPLAY_TEXT_MAX_Y_RATIO));
  const minimumRowTransitions = Math.max(24, Math.ceil(image.width * TOP_DISPLAY_TEXT_MIN_ROW_TRANSITION_RATIO));
  const minimumConsecutiveRows = Math.max(4, Math.ceil(image.height * TOP_DISPLAY_TEXT_MIN_CONSECUTIVE_ROWS_RATIO));
  const rows: Array<{ y: number; transitions: number; minimumX: number; maximumX: number }> = [];
  for (let y = 1; y < maximumY; y += 1) {
    let transitions = 0;
    let minimumX = image.width;
    let maximumX = -1;
    for (let x = 1; x < image.width - 1; x += 1) {
      const left = image.gray[y * image.width + x - 1]!;
      const right = image.gray[y * image.width + x + 1]!;
      if (Math.abs(right - left) < TOP_DISPLAY_TEXT_MIN_LUMINANCE_DELTA) continue;
      transitions += 1;
      minimumX = Math.min(minimumX, x);
      maximumX = Math.max(maximumX, x);
    }
    if (transitions >= minimumRowTransitions) rows.push({ y, transitions, minimumX, maximumX });
  }
  const groups: Array<typeof rows> = [];
  for (const row of rows) {
    const current = groups.at(-1);
    if (current?.length && row.y === current[current.length - 1]!.y + 1) current.push(row);
    else groups.push([row]);
  }
  const accepted = groups.filter((group) => group.length >= minimumConsecutiveRows).map((group) => {
    const minimumX = Math.min(...group.map((row) => row.minimumX));
    const maximumX = Math.max(...group.map((row) => row.maximumX));
    const horizontalCoverage = (maximumX - minimumX + 1) / Math.max(1, image.width);
    return {
      group,
      minimumX,
      maximumX,
      horizontalCoverage,
      peakRowTransitions: Math.max(...group.map((row) => row.transitions)),
      meanRowTransitions: mean(group.map((row) => row.transitions))
    };
  }).filter((candidate) => candidate.horizontalCoverage >= TOP_DISPLAY_TEXT_MIN_HORIZONTAL_COVERAGE && candidate.horizontalCoverage <= TOP_DISPLAY_TEXT_MAX_HORIZONTAL_COVERAGE)
    .sort((left, right) => right.peakRowTransitions - left.peakRowTransitions || right.group.length - left.group.length)[0];
  if (!accepted) return undefined;
  const firstY = accepted.group[0]!.y;
  const lastY = accepted.group[accepted.group.length - 1]!.y;
  return {
    box: { x: accepted.minimumX, y: firstY, width: accepted.maximumX - accepted.minimumX + 1, height: lastY - firstY + 1 },
    qualifyingRows: rows.length,
    consecutiveRows: accepted.group.length,
    minimumConsecutiveRows,
    peakRowTransitions: accepted.peakRowTransitions,
    meanRowTransitions: accepted.meanRowTransitions,
    minimumRowTransitions,
    horizontalCoverage: accepted.horizontalCoverage
  };
}

function collectGlyphCandidates(image: SampledImage, edgeThreshold = 42) {
  const components = edgeComponents(image, edgeThreshold).filter((item) => item.width >= 2 && item.height >= 3 && item.width <= Math.max(30, image.width * 0.12) && item.height <= Math.max(32, image.height * 0.13) && item.pixels >= 5 && item.pixels / (item.width * item.height) >= 0.08);
  const groups: Array<typeof components> = [];
  for (const component of components) {
    let group = groups.find((items) => { const medianHeight = median(items.map((item) => item.height)); const baseline = median(items.map((item) => item.y + item.height)); return Math.abs(component.y + component.height - baseline) <= Math.max(4, medianHeight * 0.38) && component.height / Math.max(1, medianHeight) >= 0.45 && component.height / Math.max(1, medianHeight) <= 2.2; });
    if (!group) { group = []; groups.push(group); }
    group.push(component);
  }
  return groups.map((items) => items.sort((a, b) => a.x - b.x)).filter((items) => items.length >= 3).map((items) => ({ items, box: unionBoxes(items) })).filter(({ box }) => box.width >= image.width * 0.1 && box.height <= image.height * 0.2).map(({ items, box }) => {
    const metrics = glyphCandidateMetrics(items, box);
    const maximumComponentAspectRatio = Math.max(...metrics.componentAspectRatios);
    const displayTextAccepted = box.y <= image.height * 0.2
      && box.width >= image.width * 0.2
      && box.width <= image.width * 0.8
      && metrics.edgePixelDensity >= MIN_DISPLAY_TEXT_EDGE_PIXEL_DENSITY
      && metrics.baselineDeviation <= MAX_DISPLAY_TEXT_BASELINE_DEVIATION
      && metrics.heightVariation <= MAX_DISPLAY_TEXT_HEIGHT_VARIATION
      && metrics.glyphLikeRatio === 1
      && maximumComponentAspectRatio <= 2.4;
    return {
      items,
      box,
      metrics,
      displayTextAccepted,
      accepted: metrics.widthCoverage >= 0.28
        && metrics.edgePixelDensity >= MIN_EDGE_SEQUENCE_PIXEL_DENSITY
        && metrics.gapVariation <= 1.6
        && metrics.glyphLikeRatio >= MIN_GLYPH_LIKE_COMPONENT_RATIO
    };
  }).sort((a, b) => b.items.length - a.items.length);
}

function glyphCandidateMetrics(items: Array<Box & { pixels: number }>, box: Box) {
  const baselines = items.map((item) => item.y + item.height); const baselineDeviation = standardDeviation(baselines);
  const gaps = items.slice(1).map((item, index) => Math.max(0, item.x - (items[index]!.x + items[index]!.width)));
  const gapVariation = gaps.length ? standardDeviation(gaps) / Math.max(1, mean(gaps)) : 0;
  const widthCoverage = items.reduce((sum, item) => sum + item.width, 0) / Math.max(1, box.width);
  const edgePixelDensity = items.reduce((sum, item) => sum + item.pixels, 0) / Math.max(1, box.width * box.height);
  const meanComponentFill = mean(items.map((item) => item.pixels / Math.max(1, item.width * item.height)));
  const heightVariation = standardDeviation(items.map((item) => item.height)) / Math.max(1, mean(items.map((item) => item.height)));
  const componentAspectRatios = items.map((item) => item.width / Math.max(1, item.height));
  const glyphLikeComponents = componentAspectRatios.filter((ratio) => ratio >= 0.18 && ratio <= 2.4).length;
  const glyphLikeRatio = glyphLikeComponents / items.length;
  return { baselineDeviation, gapVariation, widthCoverage, edgePixelDensity, meanComponentFill, heightVariation, componentAspectRatios, glyphLikeComponents, glyphLikeRatio };
}

function detectInterfaceEvidence(image: SampledImage, sourceWidth: number, sourceHeight: number): BeautyImageSafetyEvidence[] {
  const edges = edgeMask(image, 24);
  const horizontal = countLongEdgeRuns(edges, image.width, image.height, "horizontal", 0.2);
  const vertical = countLongEdgeRuns(edges, image.width, image.height, "vertical", 0.2);
  const panels = edgeComponentsFromMask(edges, image.width, image.height)
    .filter((item) => item.width >= image.width * 0.12 && item.height >= image.height * 0.08 && item.width <= image.width * 0.88 && item.height <= image.height * 0.65)
    .filter((item) => { const perimeter = Math.max(1, 2 * (item.width + item.height)); return item.pixels / perimeter >= 0.28 && item.pixels / perimeter <= 3.4; });
  const rowGroups = coordinateGroupCount(panels.map((item) => item.y + item.height / 2), image.height * 0.09);
  const columnGroups = coordinateGroupCount(panels.map((item) => item.x + item.width / 2), image.width * 0.09);
  const components = edgeComponentsFromMask(edges, image.width, image.height);
  const bars = components.filter((item) => item.width >= image.width * 0.14 && item.height <= image.height * 0.1 && item.width / Math.max(1, item.height) >= 4);
  const barRows = coordinateGroupCount(bars.map((item) => item.y + item.height / 2), image.height * 0.09);
  const barColumns = coordinateGroupCount(bars.map((item) => item.x + item.width / 2), image.width * 0.12);
  const bidirectionalLongEdges = horizontal.count >= 1 && vertical.count >= 1;
  const panelGridOccupancy = panels.length / Math.max(1, rowGroups * columnGroups);
  const panelGrid = panels.length >= 5 && rowGroups >= 3 && columnGroups >= 2 && bidirectionalLongEdges && panelGridOccupancy >= MIN_PANEL_GRID_OCCUPANCY;
  const repeatedBars = bars.length >= 4 && barRows >= 2 && barColumns >= 2;
  if (!panelGrid && !repeatedBars) return [];
  const regions = panelGrid ? panels : bars;
  const box = unionBoxes(regions);
  const confidence = clamp(0.78 + Math.min(0.1, regions.length * 0.014) + Math.min(0.06, Math.max(rowGroups, barRows) * 0.012) + Math.min(0.04, Math.max(columnGroups, barColumns) * 0.012));
  return [evidence("ui_layout", "interface_or_watermark_like", confidence >= 0.82 ? "rejected" : "manual_review_required", confidence, toSourceBox(box, image, sourceWidth, sourceHeight), { horizontalLongEdges: horizontal.count, verticalLongEdges: vertical.count, panelLikeRegions: panels.length, rowGroups, columnGroups, panelGridOccupancy: round(panelGridOccupancy), minimumPanelGridOccupancy: MIN_PANEL_GRID_OCCUPANCY, repeatedBarRegions: bars.length, barRows, barColumns, minimumRunRatio: 0.2, bidirectionalLongEdgeEvidence: bidirectionalLongEdges, alignedPanelEvidence: true })];
}

function evidence(detectorType: BeautyImageSafetyEvidence["detectorType"], reason: BeautyImageSafetyReason, decision: BeautyImageSafetyEvidence["decision"], confidence: number, bbox: Box, metrics: BeautyImageSafetyEvidence["metrics"]): BeautyImageSafetyEvidence { return { detectorType, reason, decision, confidence: round(confidence), bbox, metrics }; }
function fixedEvidence(detectorType: "format" | "decode", reason: BeautyImageSafetyReason): BeautyImageSafetyEvidence { return evidence(detectorType, reason, "rejected", 1, { x: 0, y: 0, width: 0, height: 0 }, { deterministicFailure: true }); }

function blockStats(image: SampledImage, startX: number, startY: number, width: number, height: number) {
  let min = 255; let max = 0; let transitions = 0; let comparisons = 0; let dark = 0;
  let sum = 0; const count = width * height;
  for (let y = startY; y < startY + height; y += 1) for (let x = startX; x < startX + width; x += 1) sum += image.gray[y * image.width + x]!;
  const mean = sum / Math.max(1, count);
  for (let y = startY; y < startY + height; y += 1) {
    for (let x = startX; x < startX + width; x += 1) {
      const value = image.gray[y * image.width + x]!; min = Math.min(min, value); max = Math.max(max, value); if (value < mean) dark += 1;
      if (x > startX) { comparisons += 1; if (Math.abs(value - image.gray[y * image.width + x - 1]!) >= 38) transitions += 1; }
      if (y > startY) { comparisons += 1; if (Math.abs(value - image.gray[(y - 1) * image.width + x]!) >= 38) transitions += 1; }
    }
  }
  return { contrast: max - min, transitionDensity: transitions / Math.max(1, comparisons), balancedPixels: dark / Math.max(1, count) };
}

function directionalStats(image: SampledImage, startX: number, startY: number, width: number, height: number) {
  const base = blockStats(image, startX, startY, width, height);
  let horizontalTransitions = 0;
  let verticalTransitions = 0;
  for (let y = startY; y < startY + height; y += 1) {
    for (let x = startX; x < startX + width; x += 1) {
      const value = image.gray[y * image.width + x]!;
      if (x > startX && Math.abs(value - image.gray[y * image.width + x - 1]!) >= 38) horizontalTransitions += 1;
      if (y > startY && Math.abs(value - image.gray[(y - 1) * image.width + x]!) >= 38) verticalTransitions += 1;
    }
  }
  return { ...base, horizontalTransitions, verticalTransitions };
}

function centerDistance(left: Box, right: Box): number {
  const dx = left.x + left.width / 2 - (right.x + right.width / 2);
  const dy = left.y + left.height / 2 - (right.y + right.height / 2);
  return Math.sqrt(dx * dx + dy * dy);
}

function nonOverlapping<T extends Box>(boxes: T[]): T[] {
  const selected: T[] = [];
  for (const box of boxes.sort((left, right) => left.x + left.y - right.x - right.y)) {
    if (selected.some((current) => boxIntersectionRatio(current, box) > 0.36)) continue;
    selected.push(box);
  }
  return selected;
}

function boxIntersectionRatio(left: Box, right: Box): number {
  const width = Math.max(0, Math.min(left.x + left.width, right.x + right.width) - Math.max(left.x, right.x));
  const height = Math.max(0, Math.min(left.y + left.height, right.y + right.height) - Math.max(left.y, right.y));
  const intersection = width * height;
  return intersection / Math.max(1, Math.min(left.width * left.height, right.width * right.height));
}

function unionBoxes(boxes: Box[]): Box {
  if (!boxes.length) return { x: 0, y: 0, width: 0, height: 0 };
  const x = Math.min(...boxes.map((box) => box.x));
  const y = Math.min(...boxes.map((box) => box.y));
  const right = Math.max(...boxes.map((box) => box.x + box.width));
  const bottom = Math.max(...boxes.map((box) => box.y + box.height));
  return { x, y, width: Math.max(1, right - x), height: Math.max(1, bottom - y) };
}

function clamp(value: number): number { return Math.max(0, Math.min(1, value)); }
function round(value: number): number { return Math.round(value * 1000) / 1000; }
function mean(values: number[]): number { return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0; }
function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}
function standardDeviation(values: number[]): number {
  if (values.length < 2) return 0;
  const average = mean(values);
  return Math.sqrt(mean(values.map((value) => (value - average) ** 2)));
}

function toSourceBox(box: Box, image: SampledImage, sourceWidth: number, sourceHeight: number): Box {
  const scaleX = sourceWidth / Math.max(1, image.width);
  const scaleY = sourceHeight / Math.max(1, image.height);
  return {
    x: Math.max(0, Math.round(box.x * scaleX)),
    y: Math.max(0, Math.round(box.y * scaleY)),
    width: Math.max(1, Math.round(box.width * scaleX)),
    height: Math.max(1, Math.round(box.height * scaleY))
  };
}

function qrFinderCenters(image: SampledImage): Array<{ x: number; y: number; module: number; ratioError: number }> {
  const centers: Array<{ x: number; y: number; module: number; ratioError: number }> = [];
  for (let y = 1; y < image.height - 1; y += 1) {
    const threshold = localRowThreshold(image, y);
    const runs: Array<{ dark: boolean; start: number; length: number }> = [];
    let start = 0;
    let dark = image.gray[y * image.width]! < threshold;
    for (let x = 1; x <= image.width; x += 1) {
      const nextDark = x < image.width ? image.gray[y * image.width + x]! < threshold : !dark;
      if (nextDark === dark && x < image.width) continue;
      runs.push({ dark, start, length: x - start });
      start = x;
      dark = nextDark;
    }
    for (let index = 0; index + 4 < runs.length; index += 1) {
      const sequence = runs.slice(index, index + 5);
      if (!sequence[0]!.dark || sequence[1]!.dark || !sequence[2]!.dark || sequence[3]!.dark || !sequence[4]!.dark) continue;
      const ratio = finderRatio(sequence.map((run) => run.length));
      if (!ratio.ok) continue;
      const centerX = sequence[2]!.start + sequence[2]!.length / 2;
      const vertical = verifyVerticalFinder(image, Math.round(centerX), y, ratio.module);
      if (!vertical.ok) continue;
      centers.push({ x: centerX, y: vertical.center, module: (ratio.module + vertical.module) / 2, ratioError: (ratio.error + vertical.error) / 2 });
    }
  }
  return centers;
}

function localRowThreshold(image: SampledImage, y: number): number {
  let minimum = 255; let maximum = 0;
  for (let x = 0; x < image.width; x += 1) { const value = image.gray[y * image.width + x]!; minimum = Math.min(minimum, value); maximum = Math.max(maximum, value); }
  return minimum + (maximum - minimum) * 0.52;
}

function finderRatio(lengths: number[]): { ok: boolean; module: number; error: number } {
  if (lengths.length !== 5 || lengths.some((value) => value < 1)) return { ok: false, module: 0, error: 1 };
  const module = lengths.reduce((sum, value) => sum + value, 0) / 7;
  if (module < 1.2) return { ok: false, module, error: 1 };
  const target = [module, module, module * 3, module, module];
  const error = mean(lengths.map((value, index) => Math.abs(value - target[index]!) / Math.max(1, target[index]!)));
  return { ok: error <= 0.34 && Math.abs(lengths[2]! - module * 3) <= module * 1.15, module, error };
}

function verifyVerticalFinder(image: SampledImage, x: number, centerY: number, expectedModule: number): { ok: boolean; center: number; module: number; error: number } {
  if (x < 0 || x >= image.width) return { ok: false, center: centerY, module: 0, error: 1 };
  const span = Math.max(10, Math.ceil(expectedModule * 6));
  const start = Math.max(0, centerY - span);
  const end = Math.min(image.height - 1, centerY + span);
  let minimum = 255; let maximum = 0;
  for (let y = start; y <= end; y += 1) { const value = image.gray[y * image.width + x]!; minimum = Math.min(minimum, value); maximum = Math.max(maximum, value); }
  if (maximum - minimum < 48) return { ok: false, center: centerY, module: 0, error: 1 };
  const threshold = minimum + (maximum - minimum) * 0.52;
  const runs: Array<{ dark: boolean; start: number; length: number }> = [];
  let runStart = start; let dark = image.gray[start * image.width + x]! < threshold;
  for (let y = start + 1; y <= end + 1; y += 1) {
    const nextDark = y <= end ? image.gray[y * image.width + x]! < threshold : !dark;
    if (nextDark === dark && y <= end) continue;
    runs.push({ dark, start: runStart, length: y - runStart }); runStart = y; dark = nextDark;
  }
  for (let index = 0; index + 4 < runs.length; index += 1) {
    const sequence = runs.slice(index, index + 5);
    if (!sequence[0]!.dark || sequence[1]!.dark || !sequence[2]!.dark || sequence[3]!.dark || !sequence[4]!.dark) continue;
    const candidateCenter = sequence[2]!.start + sequence[2]!.length / 2;
    if (Math.abs(candidateCenter - centerY) > expectedModule * 2.4) continue;
    const ratio = finderRatio(sequence.map((run) => run.length));
    if (ratio.ok && ratio.module / expectedModule >= 0.5 && ratio.module / expectedModule <= 2) return { ok: true, center: candidateCenter, module: ratio.module, error: ratio.error };
  }
  return { ok: false, center: centerY, module: 0, error: 1 };
}

function qrFinderGeometry(boxes: Box[]): { ok: boolean; score: number } {
  const centers = boxes.map((box) => ({ x: box.x + box.width / 2, y: box.y + box.height / 2 }));
  const distances = [
    { pair: [0, 1] as const, value: pointDistance(centers[0]!, centers[1]!) },
    { pair: [0, 2] as const, value: pointDistance(centers[0]!, centers[2]!) },
    { pair: [1, 2] as const, value: pointDistance(centers[1]!, centers[2]!) }
  ].sort((left, right) => right.value - left.value);
  const hypotenuse = distances[0]!;
  const cornerIndex = [0, 1, 2].find((index) => hypotenuse.pair[0] !== index && hypotenuse.pair[1] !== index);
  if (cornerIndex === undefined) return { ok: false, score: 0 };
  const other = [0, 1, 2].filter((index) => index !== cornerIndex);
  const first = { x: centers[other[0]!]!.x - centers[cornerIndex]!.x, y: centers[other[0]!]!.y - centers[cornerIndex]!.y };
  const second = { x: centers[other[1]!]!.x - centers[cornerIndex]!.x, y: centers[other[1]!]!.y - centers[cornerIndex]!.y };
  const firstLength = Math.hypot(first.x, first.y); const secondLength = Math.hypot(second.x, second.y);
  const cosine = Math.abs((first.x * second.x + first.y * second.y) / Math.max(1, firstLength * secondLength));
  const sideRatio = Math.min(firstLength, secondLength) / Math.max(1, Math.max(firstLength, secondLength));
  const sizeRatio = Math.min(...boxes.map((box) => box.width)) / Math.max(1, Math.max(...boxes.map((box) => box.width)));
  const score = clamp((1 - cosine) * 0.5 + sideRatio * 0.28 + sizeRatio * 0.22);
  return { ok: cosine <= 0.32 && sideRatio >= 0.48 && sizeRatio >= 0.48, score };
}

function pointDistance(left: { x: number; y: number }, right: { x: number; y: number }): number { return Math.hypot(left.x - right.x, left.y - right.y); }

function stripeMetrics(image: SampledImage, startX: number, startY: number, width: number, height: number, orientation: "vertical" | "horizontal") {
  const major = orientation === "vertical" ? width - 1 : height - 1;
  const minor = orientation === "vertical" ? height : width;
  const activity: number[] = [];
  for (let position = 0; position < major; position += 1) {
    let hits = 0;
    for (let offset = 0; offset < minor; offset += 1) {
      const x = orientation === "vertical" ? startX + position : startX + offset;
      const y = orientation === "vertical" ? startY + offset : startY + position;
      const nextX = orientation === "vertical" ? x + 1 : x;
      const nextY = orientation === "vertical" ? y : y + 1;
      if (Math.abs(image.gray[y * image.width + x]! - image.gray[nextY * image.width + nextX]!) >= 32) hits += 1;
    }
    activity.push(hits / Math.max(1, minor));
  }
  const active = activity.map((value) => value >= 0.52);
  const groups: Array<{ start: number; end: number }> = [];
  for (let index = 0; index < active.length; index += 1) {
    if (!active[index]) continue;
    const start = index;
    while (index + 1 < active.length && active[index + 1]) index += 1;
    groups.push({ start, end: index });
  }
  const widths = groups.map((group) => group.end - group.start + 1);
  const gaps = groups.slice(1).map((group, index) => Math.max(0, group.start - groups[index]!.end - 1));
  const intervals = groups.slice(1).map((group, index) => group.start - groups[index]!.start);
  const consistency = groups.length >= 2 ? clamp(1 - standardDeviation(widths) / Math.max(1, mean(widths))) : 0;
  const quietSpan = Math.max(3, Math.floor(major * 0.08));
  const quietStart = activity.slice(0, quietSpan).filter((value) => value < 0.12).length / quietSpan;
  const quietEnd = activity.slice(-quietSpan).filter((value) => value < 0.12).length / quietSpan;
  const quietZone = (quietStart + quietEnd) / 2;
  const minorActivity: number[] = [];
  for (let offset = 0; offset < minor; offset += 1) {
    let hits = 0;
    for (let position = 0; position < major; position += 1) {
      const x = orientation === "vertical" ? startX + position : startX + offset;
      const y = orientation === "vertical" ? startY + offset : startY + position;
      const nextX = orientation === "vertical" ? x + 1 : x;
      const nextY = orientation === "vertical" ? y : y + 1;
      if (Math.abs(image.gray[y * image.width + x]! - image.gray[nextY * image.width + nextX]!) >= 32) hits += 1;
    }
    minorActivity.push(hits / Math.max(1, major));
  }
  const minorQuietSpan = Math.max(3, Math.floor(minor * 0.12));
  const minorQuietStart = minorActivity.slice(0, minorQuietSpan).filter((value) => value < 0.04).length / minorQuietSpan;
  const minorQuietEnd = minorActivity.slice(-minorQuietSpan).filter((value) => value < 0.04).length / minorQuietSpan;
  const minorQuietZone = (minorQuietStart + minorQuietEnd) / 2;
  const edgePersistence = minorActivity.filter((value) => value >= Math.max(0.04, groups.length / Math.max(1, major) * 0.55)).length / Math.max(1, minor);
  const edgeIntervalVariation = intervals.length >= 2 ? standardDeviation(intervals) / Math.max(1, mean(intervals)) : 0;
  const edgeWidthVariation = widths.length >= 2 ? standardDeviation(widths) / Math.max(1, mean(widths)) : 0;
  const gapWidthVariation = gaps.length >= 2 ? standardDeviation(gaps) / Math.max(1, mean(gaps)) : 0;
  const primaryAxisEdgeDensity = mean(activity);
  let crossAxisHits = 0;
  const crossAxisComparisons = Math.max(1, major * Math.max(0, minor - 1));
  for (let offset = 0; offset < minor - 1; offset += 1) {
    for (let position = 0; position < major; position += 1) {
      const x = orientation === "vertical" ? startX + position : startX + offset;
      const y = orientation === "vertical" ? startY + offset : startY + position;
      const nextX = orientation === "vertical" ? x : x + 1;
      const nextY = orientation === "vertical" ? y + 1 : y;
      if (Math.abs(image.gray[y * image.width + x]! - image.gray[nextY * image.width + nextX]!) >= 32) crossAxisHits += 1;
    }
  }
  const crossAxisEdgeDensity = crossAxisHits / crossAxisComparisons;
  const occupied = groups.reduce((sum, group) => sum + group.end - group.start + 1, 0) / Math.max(1, major);
  const score = clamp(groups.length / 18 * 0.48 + consistency * 0.27 + quietZone * 0.18 + Math.min(1, occupied / 0.35) * 0.07);
  return { orientation, edgeGroups: groups.length, edgeGroupDensity: groups.length / Math.max(1, major), consistency, quietZone, edgeIntervalVariation, edgeWidthVariation, gapWidthVariation, primaryAxisEdgeDensity, crossAxisEdgeDensity, minorQuietZone, edgePersistence, score };
}

function edgeMask(image: SampledImage, threshold: number): Uint8Array {
  const mask = new Uint8Array(image.width * image.height);
  for (let y = 1; y < image.height - 1; y += 1) {
    for (let x = 1; x < image.width - 1; x += 1) {
      const value = image.gray[y * image.width + x]!;
      const horizontal = Math.max(Math.abs(value - image.gray[y * image.width + x - 1]!), Math.abs(value - image.gray[y * image.width + x + 1]!));
      const vertical = Math.max(Math.abs(value - image.gray[(y - 1) * image.width + x]!), Math.abs(value - image.gray[(y + 1) * image.width + x]!));
      if (Math.max(horizontal, vertical) >= threshold) mask[y * image.width + x] = 1;
    }
  }
  return mask;
}

function edgeComponents(image: SampledImage, threshold = 42): Array<Box & { pixels: number }> {
  return edgeComponentsFromMask(edgeMask(image, threshold), image.width, image.height);
}

function edgeComponentsFromMask(mask: Uint8Array, width: number, height: number): Array<Box & { pixels: number }> {
  const visited = new Uint8Array(mask.length);
  const components: Array<Box & { pixels: number }> = [];
  const queueX = new Int32Array(mask.length);
  const queueY = new Int32Array(mask.length);
  for (let startY = 1; startY < height - 1; startY += 1) {
    for (let startX = 1; startX < width - 1; startX += 1) {
      const startIndex = startY * width + startX;
      if (!mask[startIndex] || visited[startIndex]) continue;
      let head = 0; let tail = 0; let minX = startX; let maxX = startX; let minY = startY; let maxY = startY; let pixels = 0;
      queueX[tail] = startX; queueY[tail] = startY; tail += 1; visited[startIndex] = 1;
      while (head < tail) {
        const x = queueX[head]!; const y = queueY[head]!; head += 1; pixels += 1;
        minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
        for (let dy = -1; dy <= 1; dy += 1) for (let dx = -1; dx <= 1; dx += 1) {
          if (!dx && !dy) continue;
          const nextX = x + dx; const nextY = y + dy;
          if (nextX <= 0 || nextY <= 0 || nextX >= width - 1 || nextY >= height - 1) continue;
          const index = nextY * width + nextX;
          if (!mask[index] || visited[index]) continue;
          visited[index] = 1; queueX[tail] = nextX; queueY[tail] = nextY; tail += 1;
        }
      }
      components.push({ x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1, pixels });
    }
  }
  return components;
}

function coordinateGroupCount(values: number[], tolerance: number): number {
  const groups: number[] = [];
  for (const value of [...values].sort((left, right) => left - right)) {
    const index = groups.findIndex((center) => Math.abs(center - value) <= tolerance);
    if (index < 0) groups.push(value);
    else groups[index] = (groups[index]! + value) / 2;
  }
  return groups.length;
}

function countLongEdgeRuns(mask: Uint8Array, width: number, height: number, orientation: "horizontal" | "vertical", minimumRatio: number) {
  const boxes: Box[] = [];
  if (orientation === "horizontal") {
    const minimum = Math.max(8, Math.floor(width * minimumRatio));
    for (let y = 1; y < height - 1; y += 1) {
      let start = -1;
      for (let x = 1; x < width; x += 1) {
        if (mask[y * width + x]) { if (start < 0) start = x; continue; }
        if (start >= 0 && x - start >= minimum) boxes.push({ x: start, y, width: x - start, height: 1 });
        start = -1;
      }
    }
  } else {
    const minimum = Math.max(8, Math.floor(height * minimumRatio));
    for (let x = 1; x < width - 1; x += 1) {
      let start = -1;
      for (let y = 1; y < height; y += 1) {
        if (mask[y * width + x]) { if (start < 0) start = y; continue; }
        if (start >= 0 && y - start >= minimum) boxes.push({ x, y: start, width: 1, height: y - start });
        start = -1;
      }
    }
  }
  return { count: boxes.length, boxes };
}
