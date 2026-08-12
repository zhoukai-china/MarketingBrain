const BLOCKED_HOST_PATTERNS = [
  "openai.com",
  "api.openai.com",
  "chatgpt.com",
  "anthropic.com",
  "api.anthropic.com",
  "googleapis.com",
  "generativelanguage.googleapis.com",
  "gemini.google.com",
  "cohere.ai",
  "mistral.ai",
  "techcrunch.com",
  "theverge.com",
  "venturebeat.com",
  "artificialintelligence-news.com",
  "huggingface.co",
  "arxiv.org",
  "technologyreview.com",
  "careerengine.us"
];

export interface OutboundPolicyOptions {
  domesticNetworkOnly: boolean;
  allowedHosts: string[];
}

export function parseAllowedHosts(raw: string): string[] {
  return raw
    .split(",")
    .map((host) => host.trim().toLowerCase())
    .filter(Boolean);
}

export function validateOutboundUrl(
  serviceName: string,
  rawUrl: string,
  options: OutboundPolicyOptions
): string[] {
  const issues: string[] = [];
  let url: URL;

  try {
    url = new URL(rawUrl);
  } catch {
    return [`${serviceName} endpoint is not a valid URL`];
  }

  const hostname = url.hostname.toLowerCase();
  if (isBlockedHost(hostname)) {
    issues.push(`${serviceName} endpoint host ${hostname} is blocked by domestic data policy`);
  }

  if (options.domesticNetworkOnly && !isAllowedHost(hostname, options.allowedHosts)) {
    issues.push(
      `${serviceName} endpoint host ${hostname} is not in DOMESTIC_OUTBOUND_ALLOWLIST`
    );
  }

  return issues;
}

export function validateAllowedHosts(listName: string, hosts: string[]): string[] {
  return hosts
    .filter((host) => isBlockedHost(host))
    .map((host) => `${listName} contains blocked overseas host: ${host}`);
}

export function assertOutboundUrlAllowed(
  serviceName: string,
  rawUrl: string,
  options: OutboundPolicyOptions
): void {
  const issues = validateOutboundUrl(serviceName, rawUrl, options);
  if (issues.length > 0) {
    throw new Error(issues.join("; "));
  }
}

function isBlockedHost(hostname: string): boolean {
  return BLOCKED_HOST_PATTERNS.some(
    (blockedHost) => hostname === blockedHost || hostname.endsWith(`.${blockedHost}`)
  );
}

function isAllowedHost(hostname: string, allowedHosts: string[]): boolean {
  return allowedHosts.some(
    (allowedHost) => hostname === allowedHost || hostname.endsWith(`.${allowedHost}`)
  );
}
