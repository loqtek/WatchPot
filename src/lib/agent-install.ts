import { getApiBase } from "@/lib/api";

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/** Turn a host or URL into the API base (…/api). Empty input uses the UI default. */
export function resolveControlPlaneApiUrl(hostInput: string, fallback?: string): string {
  const fallbackUrl = (fallback ?? getApiBase()).replace(/\/$/, "");
  const raw = hostInput.trim();
  if (!raw) return fallbackUrl;

  let url = raw;
  if (!/^https?:\/\//i.test(url)) {
    url = `https://${url}`;
  }
  url = url.replace(/\/+$/, "");
  if (!url.endsWith("/api")) {
    url = `${url}/api`;
  }
  return url;
}

/** Bootstrap install script over HTTP; agent runtime still uses HTTPS WATCHPOT_API_URL. */
export function getAgentInstallScriptUrl(apiUrl?: string): string {
  const base = (apiUrl ?? getApiBase()).replace(/\/$/, "");
  const httpBase = base.replace(/^https:/i, "http:");
  return `${httpBase}/public/agent/install.sh`;
}

/** One-liner to run on the honeypot host (requires Docker). */
export function buildAgentInstallCommand(
  potId: string,
  agentToken: string,
  apiUrl?: string,
): string {
  const resolved = (apiUrl ?? getApiBase()).replace(/\/$/, "");
  const scriptUrl = getAgentInstallScriptUrl(resolved);
  return [
    `curl -fsSL ${shellQuote(scriptUrl)} | \\`,
    `  WATCHPOT_API_URL=${shellQuote(resolved)} \\`,
    `  WATCHPOT_POT_ID=${shellQuote(potId)} \\`,
    `  WATCHPOT_AGENT_TOKEN=${shellQuote(agentToken)} \\`,
    `  bash`,
  ].join("\n");
}

/** Optional follow-up to verify the agent container. */
export function buildAgentLogsCommand(containerName = "watchpot-agent"): string {
  return `docker logs -f ${containerName}`;
}

export function isLocalhostApiUrl(apiUrl: string): boolean {
  return /localhost|127\.0\.0\.1|\[::1\]/i.test(apiUrl);
}
