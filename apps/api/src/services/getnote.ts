import { domesticNetworkOnly, domesticOutboundAllowlist } from "../config/env.js";
import { validateOutboundUrl } from "./outbound-policy.js";

const GETNOTE_BASE = "https://openapi.biji.com/open/api/v1";

export interface GetnoteNote {
  title: string;
  summary: string;
  tags: string[];
}

function isAllowed(url: string): boolean {
  if (!domesticNetworkOnly) return true;
  const issues = validateOutboundUrl("getnote", url, {
    domesticNetworkOnly: true,
    allowedHosts: domesticOutboundAllowlist
  });
  return issues.length === 0;
}

export async function fetchGetnoteNotes(apiKey: string, clientId: string, limit = 12): Promise<GetnoteNote[]> {
  if (!apiKey || !clientId) return [];
  const url = `${GETNOTE_BASE}/resource/note/list?since_id=0`;
  if (!isAllowed(url)) return [];
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        Authorization: apiKey,
        "X-Client-ID": clientId,
        Accept: "application/json"
      }
    });
    clearTimeout(timer);
    if (!res.ok) return [];
    const data = (await res.json()) as {
      data?: { notes?: Array<{ title?: string; summary?: string; tags?: unknown[] }> };
      notes?: Array<{ title?: string; summary?: string; tags?: unknown[] }>;
    };
    const notes = data?.data?.notes ?? data?.notes ?? [];
    return (Array.isArray(notes) ? notes : []).slice(0, limit).map((n) => ({
      title: n.title ?? "",
      summary: n.summary ?? "",
      tags: Array.isArray(n.tags) ? n.tags.map(String) : []
    }));
  } catch {
    return [];
  }
}
