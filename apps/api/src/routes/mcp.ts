import type { FastifyInstance } from "fastify";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import type { LlmProvider } from "@baolu/agent";
import { env } from "../config/env.js";
import { getRuntimeAgent, invokeSkillThroughMcp } from "../services/agent-runtime.js";
import type { RequestContext } from "../services/request-context.js";

type JsonRpcId = string | number | null;

interface JsonRpcRequest {
  jsonrpc?: string;
  id?: JsonRpcId;
  method?: string;
  params?: Record<string, unknown>;
}

const LOAD_ORIGINAL_SKILL_TOOL = "sitong_original_skill.load";
const LIST_ORIGINAL_SKILLS_TOOL = "sitong_original_skill.list";
const LIST_AGENT_SKILLS_TOOL = "sitong_skill.list";
const INVOKE_AGENT_SKILL_TOOL = "sitong_skill.invoke";
const TEXT_EXTENSIONS = new Set([".md", ".txt", ".json", ".yaml", ".yml"]);
const MAX_SKILL_PACKAGE_CHARS = 220_000;

export async function registerMcpRoutes(app: FastifyInstance, provider: LlmProvider): Promise<void> {
  app.get("/mcp/status", async () => {
    const root = await resolveOriginalSkillRoot().catch(() => undefined);
    return {
      ok: Boolean(root),
      root,
      tools: [LOAD_ORIGINAL_SKILL_TOOL, LIST_ORIGINAL_SKILLS_TOOL, LIST_AGENT_SKILLS_TOOL, INVOKE_AGENT_SKILL_TOOL]
    };
  });

  app.post("/mcp", async (request, reply) => {
    if (env.SKILL_MCP_TOKEN) {
      const authorization = request.headers.authorization ?? "";
      if (authorization !== `Bearer ${env.SKILL_MCP_TOKEN}`) {
        return reply.code(401).send(jsonRpcError(null, -32001, "mcp_unauthorized"));
      }
    }

    const body = request.body as JsonRpcRequest;
    const id = body?.id ?? null;
    if (!body || body.jsonrpc !== "2.0" || typeof body.method !== "string") {
      return reply.code(400).send(jsonRpcError(id, -32600, "invalid_jsonrpc_request"));
    }
    // The internal MCP request has its own HTTP lifecycle.  Propagate an
    // upstream browser cancellation all the way to the model request instead
    // of leaving an orphaned generation running until its server timeout.
    const runController = new AbortController();
    const abortRun = () => {
      if (!runController.signal.aborted) runController.abort(new Error("mcp_client_disconnected"));
    };
    const abortOnReplyClose = () => {
      if (!reply.raw.writableEnded) abortRun();
    };
    request.raw.once("aborted", abortRun);
    reply.raw.once("close", abortOnReplyClose);

    try {
      if (body.method === "initialize") {
        return jsonRpcResult(id, {
          protocolVersion: "2024-11-05",
          serverInfo: {
            name: "sitong-original-skill-mcp",
            version: "1.0.0"
          },
          capabilities: {
            tools: {}
          }
        });
      }

      if (body.method === "tools/list") {
        return jsonRpcResult(id, {
          tools: [
            {
              name: LOAD_ORIGINAL_SKILL_TOOL,
              description: "Load one original Sitong SKILL.md package from the server-side original skill store.",
              inputSchema: {
                type: "object",
                properties: {
                  skillId: {
                    type: "string",
                    description: "Skill id, for example baolu_content_creator"
                  }
                },
                required: ["skillId"]
              }
            },
            {
              name: LIST_ORIGINAL_SKILLS_TOOL,
              description: "List original Sitong skills installed on this server.",
              inputSchema: {
                type: "object",
                properties: {}
              }
            },
            {
              name: LIST_AGENT_SKILLS_TOOL,
              description: "List the version-pinned Skill allowlist for one Sitong Agent product.",
              inputSchema: {
                type: "object",
                properties: { agentId: { type: "string" } },
                required: ["agentId"]
              }
            },
            {
              name: INVOKE_AGENT_SKILL_TOOL,
              description: "Execute one version-pinned Skill through the Sitong MCP runtime.",
              inputSchema: {
                type: "object",
                properties: {
                  requestId: { type: "string" },
                  requestFingerprint: { type: "string" },
                  agentId: { type: "string" },
                  capabilityId: { type: "string" },
                  skillId: { type: "string" },
                  tenantId: { type: "string" },
                  userId: { type: "string" },
                  conversationId: { type: "string" },
                  channel: { type: "string", enum: ["h5", "workbuddy", "wechat"] },
                  deviceScope: { type: "string", enum: ["desktop", "mobile"] },
                  input: { type: "string" },
                  routingInput: { type: "string" },
                  history: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: { role: { type: "string" }, content: { type: "string" } },
                      required: ["role", "content"]
                    }
                  },
                  routingSource: { type: "string" },
                  capabilityLocked: { type: "boolean" },
                  deliveryPolicy: { type: "string", enum: ["clarify", "draft_with_placeholders"] },
                  skipEntitlement: { type: "boolean" },
                  persist: { type: "boolean" },
                  auth: { type: "object" }
                },
                required: ["requestId", "agentId", "tenantId", "userId", "input", "auth"]
              }
            }
          ]
        });
      }

      if (body.method === "tools/call") {
        const toolName = String(body.params?.name ?? "");
        const args = normalizeToolArguments(body.params?.arguments);
        if (toolName === LOAD_ORIGINAL_SKILL_TOOL) {
          const skillId = typeof args.skillId === "string" ? args.skillId : "";
          const payload = await loadOriginalSkillPackage(skillId);
          return jsonRpcResult(id, {
            content: [{ type: "text", text: JSON.stringify(payload) }]
          });
        }
        if (toolName === LIST_ORIGINAL_SKILLS_TOOL) {
          const payload = await listOriginalSkills();
          return jsonRpcResult(id, {
            content: [{ type: "text", text: JSON.stringify(payload) }]
          });
        }
        if (toolName === LIST_AGENT_SKILLS_TOOL) {
          const agent = await getRuntimeAgent(String(args.agentId ?? ""));
          const payload = {
            agentId: agent.id,
            skills: agent.allowedSkills.map((skill) => ({
              skillId: skill.skillId,
              version: skill.version,
              isDefault: skill.isDefault
            }))
          };
          return jsonRpcResult(id, {
            content: [{ type: "text", text: JSON.stringify(payload) }]
          });
        }
        if (toolName === INVOKE_AGENT_SKILL_TOOL) {
          const context = normalizeInvocationContext(args);
          const result = await invokeSkillThroughMcp({
            requestId: requireString(args.requestId, "requestId"),
            requestFingerprint: optionalString(args.requestFingerprint),
            agentId: requireString(args.agentId, "agentId"),
            capabilityId: optionalString(args.capabilityId),
            skillId: optionalString(args.skillId),
            conversationId: optionalString(args.conversationId),
            channel: normalizeChannel(args.channel),
            deviceScope: args.deviceScope === "mobile" ? "mobile" : "desktop",
            input: requireString(args.input, "input"),
            routingInput: optionalString(args.routingInput),
            history: normalizeInvocationHistory(args.history),
            context,
            provider,
            routingSource: normalizeRoutingSource(args.routingSource),
            capabilityLocked: args.capabilityLocked === true,
            deliveryPolicy: args.deliveryPolicy === "draft_with_placeholders" ? "draft_with_placeholders" : "clarify",
            skipEntitlement: args.skipEntitlement === true,
            persist: args.persist !== false,
            signal: runController.signal
          });
          return jsonRpcResult(id, {
            content: [{ type: "text", text: JSON.stringify(result) }]
          });
        }
        return reply.code(404).send(jsonRpcError(id, -32601, `unknown_tool:${toolName}`));
      }

      return reply.code(404).send(jsonRpcError(id, -32601, `unknown_method:${body.method}`));
    } catch (error) {
      request.log.error(error);
      return reply.code(500).send(jsonRpcError(id, -32000, error instanceof Error ? error.message : String(error)));
    } finally {
      request.raw.removeListener("aborted", abortRun);
      reply.raw.removeListener("close", abortOnReplyClose);
    }
  });
}

function normalizeInvocationContext(args: Record<string, unknown>): RequestContext {
  const auth = normalizeToolArguments(args.auth);
  const profile = normalizeToolArguments(auth.profile);
  const planCode = String(auth.planCode ?? "local_standard") as RequestContext["planCode"];
  const role = String(auth.role ?? "owner") as RequestContext["role"];
  return {
    tenantId: requireString(args.tenantId, "tenantId"),
    userId: requireString(args.userId, "userId"),
    planCode,
    role,
    source: auth.source === "database" ? "database" : "demo",
    subscriptionId: optionalString(auth.subscriptionId),
    creditBalance: typeof auth.creditBalance === "number" ? auth.creditBalance : undefined,
    profile: {
      tenantId: requireString(args.tenantId, "tenantId"),
      tenantName: String(profile.tenantName ?? "企业用户"),
      tenantType: String(profile.tenantType ?? "local_business") as RequestContext["profile"]["tenantType"],
      industry: optionalString(profile.industry),
      city: optionalString(profile.city),
      data: normalizeToolArguments(profile.data)
    }
  };
}

function requireString(value: unknown, field: string): string {
  const normalized = optionalString(value);
  if (!normalized) throw new Error(`mcp_argument_required:${field}`);
  return normalized;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function normalizeRoutingSource(value: unknown): "capability" | "agent_router" | "legacy" | undefined {
  return value === "capability" || value === "agent_router" || value === "legacy" ? value : undefined;
}

function normalizeChannel(value: unknown): "h5" | "workbuddy" | "wechat" {
  return value === "workbuddy" || value === "wechat" ? value : "h5";
}

function normalizeInvocationHistory(value: unknown): Array<{ role: "user" | "assistant"; content: string }> | undefined {
  if (!Array.isArray(value)) return undefined;
  return value
    .flatMap((item) => {
      if (!item || typeof item !== "object") return [];
      const record = item as Record<string, unknown>;
      const role = record.role;
      const content = optionalString(record.content);
      return (role === "user" || role === "assistant") && content
        ? [{ role: role as "user" | "assistant", content: content.slice(0, 8_000) }]
        : [];
    })
    .slice(-4);
}

function jsonRpcResult(id: JsonRpcId, result: unknown): { jsonrpc: "2.0"; id: JsonRpcId; result: unknown } {
  return { jsonrpc: "2.0", id, result };
}

function jsonRpcError(id: JsonRpcId, code: number, message: string): {
  jsonrpc: "2.0";
  id: JsonRpcId;
  error: { code: number; message: string };
} {
  return {
    jsonrpc: "2.0",
    id,
    error: { code, message }
  };
}

function normalizeToolArguments(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

async function resolveOriginalSkillRoot(): Promise<string> {
  const candidates = [
    env.ORIGINAL_SKILL_ROOT,
    path.resolve(process.cwd(), "mcp-skills", "skills"),
    path.resolve(process.cwd(), "..", "..", "mcp-skills", "skills")
  ].filter(Boolean);

  for (const candidate of candidates) {
    const resolved = path.resolve(candidate);
    try {
      const info = await stat(resolved);
      if (info.isDirectory()) return resolved;
    } catch {
      // Try the next candidate.
    }
  }
  throw new Error(`original_skill_root_not_found:${candidates.join(",")}`);
}

async function listOriginalSkills(): Promise<{ skills: Array<{ skillId: string; hasSkillMd: boolean }> }> {
  const root = await resolveOriginalSkillRoot();
  const entries = await readdir(root, { withFileTypes: true });
  const skills = await Promise.all(
    entries
      .filter((entry) => entry.isDirectory())
      .map(async (entry) => {
        const skillPath = path.join(root, entry.name, "SKILL.md");
        const hasSkillMd = await stat(skillPath).then((info) => info.isFile()).catch(() => false);
        return { skillId: entry.name, hasSkillMd };
      })
  );
  return {
    skills: skills.filter((item) => item.hasSkillMd).sort((a, b) => a.skillId.localeCompare(b.skillId))
  };
}

async function loadOriginalSkillPackage(skillId: string): Promise<{
  skillId: string;
  source: "original-skill-mcp";
  root: string;
  files: Array<{ path: string; chars: number }>;
  textFiles: Array<{ path: string; text: string }>;
  prompt: string;
}> {
  if (!/^[a-z0-9_-]+$/i.test(skillId)) {
    throw new Error("invalid_skill_id");
  }

  const root = await resolveOriginalSkillRoot();
  const skillRoot = path.resolve(root, skillId);
  const relative = path.relative(root, skillRoot);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("skill_path_outside_root");
  }

  const skillStat = await stat(skillRoot).catch(() => undefined);
  if (!skillStat?.isDirectory()) {
    throw new Error(`original_skill_not_found:${skillId}`);
  }

  const files = await collectTextFiles(skillRoot);
  if (!files.some((file) => file.relativePath === "SKILL.md")) {
    throw new Error(`original_skill_missing_SKILL_md:${skillId}`);
  }

  let usedChars = 0;
  const sections: string[] = [
    `# Original Sitong Skill Package: ${skillId}`,
    "",
    "以下内容来自服务器原始 Skill MCP，不是思潼AI业务代码里的改写 prompt。",
    "调用方必须优先服从这些原始 SKILL.md 指令、工作流和输出规范。",
    ""
  ];
  const loadedFiles: Array<{ path: string; chars: number }> = [];
  const textFiles: Array<{ path: string; text: string }> = [];

  for (const file of files) {
    const text = await readFile(file.absolutePath, "utf8");
    if (usedChars + text.length > MAX_SKILL_PACKAGE_CHARS) break;
    usedChars += text.length;
    loadedFiles.push({ path: file.relativePath, chars: text.length });
    textFiles.push({ path: file.relativePath, text });
    sections.push(`\n\n## File: ${file.relativePath}\n\n${text.trim()}`);
  }

  return {
    skillId,
    source: "original-skill-mcp",
    root,
    files: loadedFiles,
    textFiles,
    prompt: sections.join("\n").trim()
  };
}

async function collectTextFiles(root: string): Promise<Array<{ absolutePath: string; relativePath: string }>> {
  const collected: Array<{ absolutePath: string; relativePath: string }> = [];

  async function walk(current: string): Promise<void> {
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const absolutePath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(absolutePath);
        continue;
      }
      if (!entry.isFile() || !TEXT_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) continue;
      collected.push({
        absolutePath,
        relativePath: path.relative(root, absolutePath).replace(/\\/g, "/")
      });
    }
  }

  await walk(root);
  return collected.sort((a, b) => {
    if (a.relativePath === "SKILL.md") return -1;
    if (b.relativePath === "SKILL.md") return 1;
    return a.relativePath.localeCompare(b.relativePath);
  });
}
