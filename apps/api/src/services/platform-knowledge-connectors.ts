import { createHash } from "node:crypto";
import { domesticNetworkOnly, domesticOutboundAllowlist } from "../config/env.js";
import { assertOutboundUrlAllowed } from "./outbound-policy.js";

export interface PlatformKnowledgeDocument {
  externalId: string;
  title: string;
  content: string;
  documentType: "transcript" | "note" | "web_page";
  occurredAt?: Date;
  externalUpdatedAt?: Date;
  contentHash: string;
  metadata: Record<string, unknown>;
}

export interface PlatformKnowledgeSyncResult {
  documents: PlatformKnowledgeDocument[];
  scanned: number;
  skipped: number;
  failed: number;
  importedByType: { transcripts: number; notes: number; webPages: number };
}

export interface FeishuKnowledgeCredentials {
  appId: string;
  appSecret: string;
  resourceUrl?: string;
}

export interface WecomKnowledgeCredentials {
  corpId: string;
  corpSecret: string;
  agentId?: string;
  resourceUrl?: string;
}

const FEISHU_API = "https://open.feishu.cn/open-apis";
const WECOM_API = "https://qyapi.weixin.qq.com/cgi-bin";

function assertPlatformEndpointAllowed(serviceName: string, url: string): void {
  assertOutboundUrlAllowed(serviceName, url, {
    domesticNetworkOnly,
    allowedHosts: domesticOutboundAllowlist
  });
}

/**
 * One-click sync lists only knowledge spaces explicitly granted to the app.
 * An optional document/wiki URL remains supported for a deliberately narrow
 * sync, but we never enumerate an employee's personal drive or chat history.
 */
export async function pullFeishuKnowledge(credentials: FeishuKnowledgeCredentials): Promise<PlatformKnowledgeSyncResult> {
  assertPlatformEndpointAllowed("Feishu", FEISHU_API);
  const token = await getFeishuTenantToken(credentials);
  if (!credentials.resourceUrl) return pullAuthorizedFeishuKnowledgeSpaces(token);
  const resource = parseFeishuResource(credentials.resourceUrl);
  let resolved: { kind: "docx" | "docs"; token: string };
  if (resource.kind === "wiki") resolved = await resolveFeishuWikiNode(token, resource.token);
  else if (resource.kind === "docx" || resource.kind === "docs") resolved = { kind: resource.kind, token: resource.token };
  else throw new Error("feishu_resource_not_supported");
  const content = await getFeishuDocumentContent(token, resolved);
  if (!content.trim()) throw new Error("feishu_document_empty");
  const title = `飞书文档 ${resolved.token}`;
  return {
    documents: [{
      externalId: `feishu:${resolved.kind}:${resolved.token}`,
      title,
      content,
      documentType: "note",
      externalUpdatedAt: new Date(),
      contentHash: createHash("sha256").update(content).digest("hex"),
      metadata: { provider: "feishu", sourceUrl: credentials.resourceUrl, resourceType: resolved.kind, resourceToken: resolved.token }
    }],
    scanned: 1,
    skipped: 0,
    failed: 0,
    importedByType: { transcripts: 0, notes: 1, webPages: 0 }
  };
}

/**
 * Credential issuance alone does not prove that the app can read a knowledge
 * space or document. Validate the actual read path before marking a Feishu
 * connection as active, without persisting any document content.
 */
export async function verifyFeishuKnowledgeAccess(credentials: FeishuKnowledgeCredentials): Promise<{ capabilities: string[] }> {
  assertPlatformEndpointAllowed("Feishu", FEISHU_API);
  const token = await getFeishuTenantToken(credentials);
  if (credentials.resourceUrl) {
    const resource = parseFeishuResource(credentials.resourceUrl);
    const resolved = resource.kind === "wiki"
      ? await resolveFeishuWikiNode(token, resource.token)
      : { kind: resource.kind, token: resource.token };
    if (resolved.kind !== "docx" && resolved.kind !== "docs") throw new Error("feishu_resource_not_supported");
    await getFeishuDocumentContent(token, resolved);
    return { capabilities: ["credential_verified", "document_read_verified", "no_chat_archive"] };
  }
  const payload = await feishuJson(`${FEISHU_API}/wiki/v2/spaces?page_size=1`, token);
  const items = asRecord(payload.data).items;
  if (!Array.isArray(items) || items.length === 0) throw new Error("feishu_no_accessible_spaces");
  return { capabilities: ["credential_verified", "knowledge_space_read_verified", "no_chat_archive"] };
}

async function pullAuthorizedFeishuKnowledgeSpaces(token: string): Promise<PlatformKnowledgeSyncResult> {
  const spacesPayload = await feishuJson(`${FEISHU_API}/wiki/v2/spaces?page_size=50`, token);
  const spaces = Array.isArray(asRecord(spacesPayload.data).items) ? asRecord(spacesPayload.data).items as Array<Record<string, unknown>> : [];
  const documents: PlatformKnowledgeDocument[] = [];
  let scanned = 0;
  let skipped = 0;
  let failed = 0;
  for (const space of spaces.slice(0, 20)) {
    const spaceId = typeof space.space_id === "string" ? space.space_id : "";
    if (!spaceId) { skipped += 1; continue; }
    const nodesPayload = await feishuJson(`${FEISHU_API}/wiki/v2/spaces/${encodeURIComponent(spaceId)}/nodes?page_size=100`, token);
    const nodes = Array.isArray(asRecord(nodesPayload.data).items) ? asRecord(nodesPayload.data).items as Array<Record<string, unknown>> : [];
    for (const node of nodes.slice(0, 200 - documents.length)) {
      scanned += 1;
      const kind = node.obj_type === "docx" ? "docx" : node.obj_type === "doc" ? "docs" : "";
      const documentToken = typeof node.obj_token === "string" ? node.obj_token : "";
      if (!kind || !documentToken) { skipped += 1; continue; }
      try {
        const content = await getFeishuDocumentContent(token, { kind, token: documentToken });
        if (!content) { skipped += 1; continue; }
        const title = typeof node.title === "string" && node.title.trim() ? node.title.trim() : `飞书知识库文档 ${documentToken}`;
        documents.push({
          externalId: `feishu:space:${spaceId}:${kind}:${documentToken}`,
          title,
          content,
          documentType: "note",
          externalUpdatedAt: new Date(),
          contentHash: createHash("sha256").update(content).digest("hex"),
          metadata: { provider: "feishu", sourceType: "authorised_wiki_space", spaceId, resourceType: kind, resourceToken: documentToken }
        });
      } catch { failed += 1; }
    }
  }
  return { documents, scanned, skipped, failed, importedByType: { transcripts: 0, notes: documents.length, webPages: 0 } };
}

/**
 * A standard WeCom self-built app can read the organisational directory for
 * departments it is authorised to access. It cannot read historical chats or
 * arbitrary WeDoc/Microdrive files with only Corp ID and app Secret, so those
 * sources are deliberately not claimed as synchronised here.
 */
export async function pullWecomKnowledge(credentials: WecomKnowledgeCredentials): Promise<PlatformKnowledgeSyncResult> {
  assertPlatformEndpointAllowed("WeCom", WECOM_API);
  const token = await getWecomAccessToken(credentials);
  const departments = await wecomJson(`${WECOM_API}/department/list?access_token=${encodeURIComponent(token)}`);
  const departmentList = Array.isArray(departments.department) ? departments.department as Array<Record<string, unknown>> : [];
  const docs: PlatformKnowledgeDocument[] = [];
  let scanned = 0;
  let skipped = 0;
  for (const department of departmentList.slice(0, 200)) {
    const id = String(department.id ?? "").trim();
    const name = String(department.name ?? "未命名部门").trim();
    if (!id) { skipped += 1; continue; }
    const users = await wecomJson(`${WECOM_API}/user/simplelist?access_token=${encodeURIComponent(token)}&department_id=${encodeURIComponent(id)}&fetch_child=0`);
    const members = Array.isArray(users.userlist) ? users.userlist as Array<Record<string, unknown>> : [];
    scanned += 1;
    const lines = members.slice(0, 1_000).map((member) => {
      const userId = String(member.userid ?? "").trim();
      const userName = String(member.name ?? "未命名成员").trim();
      return userId ? `- ${userName}（成员 ID：${userId}）` : `- ${userName}`;
    });
    const content = [`部门：${name}`, `部门 ID：${id}`, "已授权成员：", ...(lines.length ? lines : ["- 暂无可读取成员"]), "", "说明：此资料仅来自企业微信应用已授权的通讯录范围，不包含聊天记录。"].join("\n");
    docs.push({
      externalId: `wecom:department:${id}`,
      title: `企业微信通讯录｜${name}`,
      content,
      documentType: "note",
      externalUpdatedAt: new Date(),
      contentHash: createHash("sha256").update(content).digest("hex"),
      metadata: { provider: "wecom", sourceType: "directory", departmentId: id, memberCount: members.length, agentId: credentials.agentId }
    });
  }
  return { documents: docs, scanned, skipped, failed: 0, importedByType: { transcripts: 0, notes: docs.length, webPages: 0 } };
}

export function platformSyncErrorMessage(provider: "feishu" | "wecom", reason: string): string {
  if (/AbortError|fetch failed|ECONNRESET|ETIMEDOUT/i.test(reason)) return "平台服务暂时不可用或网络超时，请稍后重试。";
  if (provider === "feishu") {
    if (reason === "feishu_resource_url_required") return "请先填写待同步的飞书文档或知识库链接。";
    if (reason === "feishu_resource_not_supported") return "当前仅支持飞书新版文档或知识库中的新版文档，请更换链接。";
    if (reason === "feishu_no_accessible_spaces") return "应用凭证有效，但尚未获授权读取任何飞书知识空间。请将应用加入目标知识空间，或填写一份已授权的飞书文档/知识库链接后重新校验。";
    if (/401|403|permission|access/i.test(reason)) return "飞书应用尚未获得该资料的读取权限，请在飞书中将文档或知识库授权给该应用后重试。";
    if (/http_400|invalid|param/i.test(reason)) return "飞书拒绝了资料读取请求。请确认链接是飞书新版文档或知识库链接，并在开放平台发布“知识库/云文档读取”权限后重新校验。";
    return "飞书资料同步失败。请先重新校验资料读取权限；若仍失败，请更换为一份已授权的飞书文档或知识库链接。";
  }
  if (/48002|60011|permission|access/i.test(reason)) return "企业微信应用缺少通讯录读取权限，请由管理员调整应用可见范围后重试。";
  return "企业微信当前可同步应用已授权的通讯录；微盘、会话存档等资料需要分别开通对应权限。";
}

async function getFeishuTenantToken(credentials: FeishuKnowledgeCredentials): Promise<string> {
  const payload = await json(`${FEISHU_API}/auth/v3/tenant_access_token/internal`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ app_id: credentials.appId, app_secret: credentials.appSecret })
  });
  if (payload.code !== 0 || typeof payload.tenant_access_token !== "string") throw new Error(`feishu_${payload.code ?? "token_failed"}`);
  return payload.tenant_access_token;
}

async function getWecomAccessToken(credentials: WecomKnowledgeCredentials): Promise<string> {
  const query = new URLSearchParams({ corpid: credentials.corpId, corpsecret: credentials.corpSecret });
  const payload = await json(`${WECOM_API}/gettoken?${query}`);
  if (payload.errcode !== 0 || typeof payload.access_token !== "string") throw new Error(`wecom_${payload.errcode ?? "token_failed"}`);
  return payload.access_token;
}

function parseFeishuResource(value: string): { kind: "docx" | "docs" | "wiki"; token: string } {
  const url = new URL(value);
  const parts = url.pathname.split("/").filter(Boolean);
  const index = parts.findIndex((part) => part === "docx" || part === "docs" || part === "wiki");
  const kind = index >= 0 ? parts[index] : "";
  const token = index >= 0 ? parts[index + 1] : "";
  if ((kind !== "docx" && kind !== "docs" && kind !== "wiki") || !token) throw new Error("feishu_resource_not_supported");
  return { kind, token };
}

async function resolveFeishuWikiNode(token: string, nodeToken: string): Promise<{ kind: "docx" | "docs"; token: string }> {
  const payload = await feishuJson(`${FEISHU_API}/wiki/v2/spaces/get_node?token=${encodeURIComponent(nodeToken)}`, token);
  const node = asRecord(asRecord(payload.data).node);
  const kind = node.obj_type === "docx" ? "docx" : node.obj_type === "doc" ? "docs" : "";
  const objectToken = typeof node.obj_token === "string" ? node.obj_token : "";
  if (!kind || !objectToken) throw new Error("feishu_resource_not_supported");
  return { kind, token: objectToken };
}

async function getFeishuDocumentContent(token: string, resource: { kind: "docx" | "docs"; token: string }): Promise<string> {
  const url = resource.kind === "docx"
    ? `${FEISHU_API}/docx/v1/documents/${encodeURIComponent(resource.token)}/raw_content`
    : `${FEISHU_API}/docs/v1/content?doc_token=${encodeURIComponent(resource.token)}`;
  const payload = await feishuJson(url, token);
  const data = asRecord(payload.data);
  const content = typeof data.content === "string" ? data.content : typeof payload.content === "string" ? payload.content : "";
  return content.trim();
}

async function feishuJson(url: string, token: string): Promise<Record<string, any>> {
  const payload = await json(url, { headers: { Authorization: `Bearer ${token}` } });
  if (payload.code !== 0) throw new Error(`feishu_${payload.code ?? "request_failed"}_${payload.msg ?? ""}`);
  return payload;
}

async function wecomJson(url: string): Promise<Record<string, any>> {
  const payload = await json(url);
  if (payload.errcode !== 0) throw new Error(`wecom_${payload.errcode ?? "request_failed"}_${payload.errmsg ?? ""}`);
  return payload;
}

async function json(url: string, init?: RequestInit): Promise<Record<string, any>> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const data = asRecord(payload);
      const code = data.code ?? data.errcode;
      const message = typeof data.msg === "string" ? data.msg : typeof data.errmsg === "string" ? data.errmsg : "";
      throw new Error(`http_${response.status}${code !== undefined ? `_${String(code)}` : ""}${message ? `_${message.slice(0, 160)}` : ""}`);
    }
    return asRecord(payload);
  } finally { clearTimeout(timeout); }
}

function asRecord(value: unknown): Record<string, any> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : {};
}
