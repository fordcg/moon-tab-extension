export const METAPI_ADMIN_SETTINGS_KEY = "metapiAdminSettings";

export interface MetapiAdminSettings {
  baseUrl: string;
  authToken: string;
}

export interface RegisterRelaySiteArgs {
  name?: string;
  useSystemProxy: boolean;
  rawText: string;
}

const DEFAULT_BASE_URL = "http://127.0.0.1:4000";

export function createDefaultMetapiAdminSettings(): MetapiAdminSettings {
  return {
    baseUrl: DEFAULT_BASE_URL,
    authToken: "",
  };
}

export function normalizeMetapiAdminSettings(value: unknown): MetapiAdminSettings {
  const defaults = createDefaultMetapiAdminSettings();
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return defaults;
  }
  const source = value as Partial<MetapiAdminSettings>;
  const baseUrl = typeof source.baseUrl === "string" && source.baseUrl.trim()
    ? source.baseUrl.trim().replace(/\/+$/, "")
    : defaults.baseUrl;
  const authToken = typeof source.authToken === "string" ? source.authToken.trim() : "";
  return { baseUrl, authToken };
}

/**
 * Parse "/收录中转站 gpt(name) 开启系统代理" style args after the command title.
 * Examples:
 * - "gpt(name) 开启系统代理"
 * - "我的站 开启系统代理"
 * - "开启系统代理"
 * - "gpt"
 */
export function parseRegisterRelaySiteArgs(text: string): RegisterRelaySiteArgs {
  const rawText = text.trim();
  const useSystemProxy = /开启系统代理|启用系统代理|useSystemProxy\s*[:=]\s*true/i.test(rawText);

  let working = rawText
    .replace(/开启系统代理|启用系统代理/g, " ")
    .replace(/useSystemProxy\s*[:=]\s*true/gi, " ")
    .replace(/\s+/g, " ")
    .trim();

  // Prefer explicit name(...) form.
  const explicit = working.match(/(?:name\s*[:=]\s*|"name"\s*:\s*)["']?([^"'\n]+?)["']?\s*$/i)
    ?? working.match(/^(.+?)\s*\(\s*name\s*\)$/i)
    ?? working.match(/^(.+?)\(name\)$/i);

  let name: string | undefined;
  if (explicit?.[1]) {
    name = explicit[1].trim();
  } else if (working) {
    // Drop leading command aliases if still present.
    name = working
      .replace(/^\/?收录中转站\s*/u, "")
      .replace(/^register[_-]?relay[_-]?site\s*/i, "")
      .trim() || undefined;
  }

  if (name) {
    name = name.replace(/[，,。.]+$/g, "").trim() || undefined;
  }

  return {
    name,
    useSystemProxy,
    rawText,
  };
}

/**
 * Normalize a relay site URL for Metapi create/list matching.
 * Always keep only the site origin (scheme + host + port), never page paths
 * like /profile, /console, /v1, query, or hash.
 * Example: https://example.com/profile → https://example.com
 */
export function normalizeSiteUrl(url: string): string {
  const trimmed = url.trim();
  if (!trimmed) {
    return "";
  }
  try {
    const parsed = new URL(trimmed);
    // Origin already excludes path/query/hash. Lowercase host for stable matching
    // while keeping the scheme as provided by URL.
    return parsed.origin.replace(/\/+$/, "");
  } catch {
    // Best-effort fallback: strip path/query/hash without a full URL parser.
    return trimmed
      .replace(/[?#].*$/, "")
      .replace(/\/+$/, "")
      .replace(/^(https?:\/\/[^/]+).*/i, "$1");
  }
}

export function findExistingSiteByUrl(
  sites: Array<{ id?: number; url?: string; name?: string; platform?: string }>,
  targetUrl: string,
): { id: number; url: string; name?: string; platform?: string } | undefined {
  const target = normalizeSiteUrl(targetUrl).toLowerCase();
  if (!target) {
    return undefined;
  }
  for (const site of sites) {
    if (typeof site.id !== "number" || typeof site.url !== "string") {
      continue;
    }
    if (normalizeSiteUrl(site.url).toLowerCase() === target) {
      return {
        id: site.id,
        url: site.url,
        name: typeof site.name === "string" ? site.name : undefined,
        platform: typeof site.platform === "string" ? site.platform : undefined,
      };
    }
  }
  return undefined;
}

export async function metapiAdminFetch<T = unknown>(input: {
  settings: MetapiAdminSettings;
  path: string;
  method?: string;
  body?: unknown;
  fetcher?: typeof fetch;
}): Promise<{ ok: true; status: number; data: T } | { ok: false; status?: number; message: string; data?: unknown }> {
  const settings = normalizeMetapiAdminSettings(input.settings);
  if (!settings.authToken) {
    return {
      ok: false,
      message: "未配置 Metapi 管理令牌。请先调用 metapi_configure 设置 authToken（METAPI_AUTH_TOKEN）。",
    };
  }

  const fetcher = input.fetcher ?? globalThis.fetch;
  if (typeof fetcher !== "function") {
    return { ok: false, message: "当前环境缺少 fetch，无法调用 Metapi 管理 API。" };
  }

  const path = input.path.startsWith("/") ? input.path : `/${input.path}`;
  const url = `${settings.baseUrl}${path}`;
  try {
    const response = await fetcher(url, {
      method: input.method ?? (input.body === undefined ? "GET" : "POST"),
      headers: {
        Authorization: `Bearer ${settings.authToken}`,
        Accept: "application/json",
        ...(input.body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: input.body === undefined ? undefined : JSON.stringify(input.body),
    });
    const text = await response.text();
    let data: unknown = text;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = text;
      }
    } else {
      data = null;
    }

    if (!response.ok) {
      const message = extractMetapiErrorMessage(data) || `Metapi 请求失败（HTTP ${response.status}）`;
      return { ok: false, status: response.status, message, data };
    }

    // Some endpoints may return 200 + success:false
    if (data && typeof data === "object" && !Array.isArray(data) && "success" in data && (data as { success?: unknown }).success === false) {
      return {
        ok: false,
        status: response.status,
        message: extractMetapiErrorMessage(data) || "Metapi 业务失败",
        data,
      };
    }

    return { ok: true, status: response.status, data: data as T };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error && error.message ? error.message : "Metapi 请求异常",
    };
  }
}

export function extractMetapiErrorMessage(data: unknown): string {
  if (!data) {
    return "";
  }
  if (typeof data === "string") {
    return data.trim();
  }
  if (typeof data === "object") {
    const source = data as Record<string, unknown>;
    for (const key of ["message", "error", "detail", "title"]) {
      const value = source[key];
      if (typeof value === "string" && value.trim()) {
        return value.trim();
      }
    }
  }
  return "";
}

export function redactMetapiAccount<T extends Record<string, unknown>>(account: T): T {
  const next: Record<string, unknown> = { ...account };
  for (const key of ["accessToken", "apiToken", "token", "password", "cookie"]) {
    if (typeof next[key] === "string" && next[key]) {
      next[key] = "[redacted]";
    }
  }
  if (next.site && typeof next.site === "object" && next.site) {
    const site = { ...(next.site as Record<string, unknown>) };
    if (typeof site.apiKey === "string" && site.apiKey) {
      site.apiKey = "[redacted]";
    }
    next.site = site;
  }
  return next as T;
}
