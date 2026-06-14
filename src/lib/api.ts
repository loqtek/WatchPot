const TOKEN_KEY = "watchpot_token";

/** Browser + Docker default: HTTPS via nginx same-origin (/api). Plain HTTP :6040 is local dev only. */
export function resolveApiBase(
  configured: string | undefined,
  location?: Pick<Location, "origin" | "protocol">,
): string {
  const trimmed = configured?.replace(/\/$/, "");
  if (location) {
    const sameOrigin = `${location.origin}/api`;
    if (!trimmed) return sameOrigin;
    if (location.protocol === "https:" && trimmed.startsWith("http://")) return sameOrigin;
  }
  if (trimmed) return trimmed;
  return location ? `${location.origin}/api` : "https://localhost/api";
}

export function getApiBase(): string {
  const configured = process.env.NEXT_PUBLIC_API_URL;
  if (typeof window === "undefined") {
    return resolveApiBase(configured);
  }
  return resolveApiBase(configured, window.location);
}

/** Origin without `/api` — for `/docs`, `/health`, etc. */
export function getApiOrigin(): string {
  const base = getApiBase().replace(/\/$/, "");
  return base.endsWith("/api") ? base.slice(0, -4) : base;
}

export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string | null): void {
  if (typeof window === "undefined") return;
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

export function parseApiErrorBody(text: string, statusText: string): string {
  const msg = text.trim() || statusText;
  if (!text.trim()) return msg;
  try {
    const j = JSON.parse(text) as { detail?: unknown; message?: unknown; error?: unknown };
    if (typeof j.detail === "string") {
      return j.detail;
    }
    if (Array.isArray(j.detail)) {
      return j.detail
        .map((d: unknown) =>
          typeof d === "object" && d && "msg" in d ? String((d as { msg: string }).msg) : String(d),
        )
        .join("; ");
    }
    if (typeof j.message === "string") return j.message;
    if (typeof j.error === "string") return j.error;
  } catch {
    /* plain text body */
  }
  return msg;
}

export function errorMessage(error: unknown, fallback = "Request failed"): string {
  if (error instanceof Error && error.message.trim()) return error.message.trim();
  if (typeof error === "string" && error.trim()) return error.trim();
  return fallback;
}

export async function apiFetch<T>(
  path: string,
  init: RequestInit & { json?: unknown } = {},
): Promise<T> {
  const url = `${getApiBase().replace(/\/$/, "")}${path.startsWith("/") ? path : `/${path}`}`;
  const headers = new Headers(init.headers);
  const token = getToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  if (init.json !== undefined) {
    headers.set("Content-Type", "application/json");
  }
  const res = await fetch(url, {
    ...init,
    headers,
    body: init.json !== undefined ? JSON.stringify(init.json) : init.body,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(parseApiErrorBody(text, res.statusText));
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}
