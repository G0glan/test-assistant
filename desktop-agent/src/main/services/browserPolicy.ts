export interface BrowserPolicyResult {
  allowed: boolean;
  normalizedUrl?: string;
  domain?: string;
  reason?: string;
  reasonCode?: "blocked_domain" | "invalid_url";
  matchedRule?: string;
}

function parseBlocklist(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

export function getDomainBlocklist(): string[] {
  return parseBlocklist(process.env.AGENT_BROWSER_BLOCKLIST);
}

function normalizeUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }
  if (/^[a-z0-9.-]+\.[a-z]{2,}/i.test(trimmed)) {
    return `https://${trimmed}`;
  }
  return null;
}

function hostMatchesRule(hostname: string, rule: string): boolean {
  if (rule.startsWith("*.")) {
    const suffix = rule.slice(2);
    return hostname === suffix || hostname.endsWith(`.${suffix}`);
  }
  return hostname === rule || hostname.endsWith(`.${rule}`);
}

export function evaluateBrowserTarget(rawUrl: string, blocklist = getDomainBlocklist()): BrowserPolicyResult {
  const normalized = normalizeUrl(rawUrl);
  if (!normalized) {
    return {
      allowed: false,
      reason: "URL is invalid or missing protocol/domain",
      reasonCode: "invalid_url"
    };
  }

  let url: URL;
  try {
    url = new URL(normalized);
  } catch {
    return {
      allowed: false,
      reason: "URL cannot be parsed",
      reasonCode: "invalid_url"
    };
  }

  const hostname = url.hostname.toLowerCase();
  for (const rule of blocklist) {
    if (hostMatchesRule(hostname, rule)) {
      return {
        allowed: false,
        normalizedUrl: url.toString(),
        domain: hostname,
        reason: `Domain blocked by policy: ${rule}`,
        reasonCode: "blocked_domain",
        matchedRule: rule
      };
    }
  }

  return {
    allowed: true,
    normalizedUrl: url.toString(),
    domain: hostname
  };
}
