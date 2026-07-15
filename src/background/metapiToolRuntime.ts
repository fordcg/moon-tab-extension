import {
  extractMetapiErrorMessage,
  findExistingSiteByUrl,
  metapiAdminFetch,
  METAPI_ADMIN_SETTINGS_KEY,
  normalizeMetapiAdminSettings,
  normalizeSiteUrl,
  parseRegisterRelaySiteArgs,
  redactMetapiAccount,
  type MetapiAdminSettings,
} from "../shared/metapiAdmin";
import {
  METAPI_CONFIGURE_TOOL_ID,
  METAPI_CONFIGURE_TOOL_NAME,
  METAPI_CREATE_ACCOUNT_TOOL_ID,
  METAPI_CREATE_ACCOUNT_TOOL_NAME,
  METAPI_CREATE_SITE_TOOL_ID,
  METAPI_CREATE_SITE_TOOL_NAME,
  METAPI_DETECT_SITE_TOOL_ID,
  METAPI_DETECT_SITE_TOOL_NAME,
  METAPI_LIST_SITES_TOOL_ID,
  METAPI_LIST_SITES_TOOL_NAME,
  METAPI_PARSE_REGISTER_ARGS_TOOL_ID,
  METAPI_PARSE_REGISTER_ARGS_TOOL_NAME,
  METAPI_VERIFY_ACCOUNT_TOKEN_TOOL_ID,
  METAPI_VERIFY_ACCOUNT_TOKEN_TOOL_NAME,
} from "../shared/models/toolRegistry";
import type { ModelToolCall, ModelToolResult } from "../shared/models/types";
import { getAppSetting, saveAppSetting } from "../shared/storage/repositories";

declare global {
  var __metapiToolExecutor: ((toolCall: ModelToolCall, fetcher?: typeof fetch) => Promise<ModelToolResult>) | undefined;
}

globalThis.__metapiToolExecutor = executeMetapiTool;

export async function executeMetapiTool(
  toolCall: ModelToolCall,
  fetcher: typeof fetch = globalThis.fetch,
): Promise<ModelToolResult> {
  const toolName = toolCall.name || "";
  try {
    if (toolCall.id === METAPI_CONFIGURE_TOOL_ID || toolName === METAPI_CONFIGURE_TOOL_NAME) {
      return configureMetapi(toolCall);
    }
    if (toolCall.id === METAPI_PARSE_REGISTER_ARGS_TOOL_ID || toolName === METAPI_PARSE_REGISTER_ARGS_TOOL_NAME) {
      return parseRegisterArgs(toolCall);
    }
    if (toolCall.id === METAPI_LIST_SITES_TOOL_ID || toolName === METAPI_LIST_SITES_TOOL_NAME) {
      return listSites(toolCall, fetcher);
    }
    if (toolCall.id === METAPI_DETECT_SITE_TOOL_ID || toolName === METAPI_DETECT_SITE_TOOL_NAME) {
      return detectSite(toolCall, fetcher);
    }
    if (toolCall.id === METAPI_CREATE_SITE_TOOL_ID || toolName === METAPI_CREATE_SITE_TOOL_NAME) {
      return createSite(toolCall, fetcher);
    }
    if (toolCall.id === METAPI_VERIFY_ACCOUNT_TOKEN_TOOL_ID || toolName === METAPI_VERIFY_ACCOUNT_TOKEN_TOOL_NAME) {
      return verifyAccountToken(toolCall, fetcher);
    }
    if (toolCall.id === METAPI_CREATE_ACCOUNT_TOOL_ID || toolName === METAPI_CREATE_ACCOUNT_TOOL_NAME) {
      return createAccount(toolCall, fetcher);
    }
    return metapiError(toolCall, `未知 Metapi 工具：${toolCall.id || toolName}`);
  } catch (error) {
    return metapiError(toolCall, error instanceof Error ? error.message : "Metapi 工具执行失败");
  }
}

async function configureMetapi(toolCall: ModelToolCall): Promise<ModelToolResult> {
  const args = asObject(toolCall.arguments);
  const current = normalizeMetapiAdminSettings(await getAppSetting(METAPI_ADMIN_SETTINGS_KEY));
  const next: MetapiAdminSettings = {
    baseUrl: typeof args.baseUrl === "string" && args.baseUrl.trim()
      ? args.baseUrl.trim().replace(/\/+$/, "")
      : current.baseUrl,
    authToken: typeof args.authToken === "string" ? args.authToken.trim() : current.authToken,
  };
  if (!next.authToken) {
    return metapiError(toolCall, "authToken 不能为空");
  }
  await saveAppSetting({
    key: METAPI_ADMIN_SETTINGS_KEY,
    value: next,
    updatedAt: Date.now(),
  });
  return metapiOk(toolCall, {
    configured: true,
    baseUrl: next.baseUrl,
    authTokenConfigured: true,
  });
}

function parseRegisterArgs(toolCall: ModelToolCall): ModelToolResult {
  const args = asObject(toolCall.arguments);
  const text = typeof args.text === "string" ? args.text : "";
  return metapiOk(toolCall, parseRegisterRelaySiteArgs(text));
}

async function listSites(toolCall: ModelToolCall, fetcher: typeof fetch): Promise<ModelToolResult> {
  const settings = await loadSettings();
  const result = await metapiAdminFetch<unknown[]>({ settings, path: "/api/sites", fetcher });
  if (!result.ok) {
    return metapiError(toolCall, result.message, result);
  }
  const sites = Array.isArray(result.data) ? result.data : [];
  const args = asObject(toolCall.arguments);
  const matchUrl = typeof args.url === "string" ? args.url : "";
  const existing = matchUrl ? findExistingSiteByUrl(sites as Array<{ id?: number; url?: string; name?: string; platform?: string }>, matchUrl) : undefined;
  return metapiOk(toolCall, {
    count: sites.length,
    existingSite: existing ?? null,
    sites: sites.map((site) => sanitizeSite(site)),
  });
}

async function detectSite(toolCall: ModelToolCall, fetcher: typeof fetch): Promise<ModelToolResult> {
  const args = asObject(toolCall.arguments);
  const url = typeof args.url === "string" ? args.url.trim() : "";
  if (!url) {
    return metapiError(toolCall, "url 不能为空");
  }
  const settings = await loadSettings();
  const result = await metapiAdminFetch({
    settings,
    path: "/api/sites/detect",
    method: "POST",
    body: { url },
    fetcher,
  });
  if (!result.ok) {
    return metapiError(toolCall, result.message, result);
  }
  return metapiOk(toolCall, result.data);
}

async function createSite(toolCall: ModelToolCall, fetcher: typeof fetch): Promise<ModelToolResult> {
  const args = asObject(toolCall.arguments);
  const name = typeof args.name === "string" ? args.name.trim() : "";
  const url = typeof args.url === "string" ? normalizeSiteUrl(args.url) : "";
  const platform = typeof args.platform === "string" ? args.platform.trim() : "";
  if (!name) {
    return metapiError(toolCall, "name 不能为空");
  }
  if (!url) {
    return metapiError(toolCall, "url 不能为空");
  }

  const settings = await loadSettings();
  // Existence check first for clearer UX.
  const listed = await metapiAdminFetch<unknown[]>({ settings, path: "/api/sites", fetcher });
  if (listed.ok && Array.isArray(listed.data)) {
    const existing = findExistingSiteByUrl(
      listed.data as Array<{ id?: number; url?: string; name?: string; platform?: string }>,
      url,
    );
    if (existing) {
      return metapiOk(toolCall, {
        alreadyExists: true,
        code: "SITE_EXISTS",
        message: "站点已存在，无需重复收录",
        site: existing,
      });
    }
  }

  const body: Record<string, unknown> = {
    name,
    url,
  };
  if (platform) {
    body.platform = platform;
  }
  if (typeof args.useSystemProxy === "boolean") {
    body.useSystemProxy = args.useSystemProxy;
  }
  if (typeof args.proxyUrl === "string" && args.proxyUrl.trim()) {
    body.proxyUrl = args.proxyUrl.trim();
  }
  if (typeof args.externalCheckinUrl === "string" && args.externalCheckinUrl.trim()) {
    body.externalCheckinUrl = args.externalCheckinUrl.trim();
  }
  if (typeof args.initializationPresetId === "string" && args.initializationPresetId.trim()) {
    body.initializationPresetId = args.initializationPresetId.trim();
  }

  const result = await metapiAdminFetch({
    settings,
    path: "/api/sites",
    method: "POST",
    body,
    fetcher,
  });
  if (!result.ok) {
    if (result.status === 409 || /already exists/i.test(result.message)) {
      return metapiOk(toolCall, {
        alreadyExists: true,
        code: "SITE_EXISTS",
        message: result.message || "站点已存在，无需重复收录",
        error: result.data,
      });
    }
    return metapiError(toolCall, result.message, result);
  }
  return metapiOk(toolCall, {
    alreadyExists: false,
    site: sanitizeSite(result.data),
  });
}

async function verifyAccountToken(toolCall: ModelToolCall, fetcher: typeof fetch): Promise<ModelToolResult> {
  const args = asObject(toolCall.arguments);
  const siteId = toPositiveInt(args.siteId);
  const accessToken = typeof args.accessToken === "string" ? args.accessToken.trim() : "";
  if (!siteId) {
    return metapiError(toolCall, "siteId 必须是正整数");
  }
  if (!accessToken) {
    return metapiError(toolCall, "accessToken 不能为空（系统访问令牌或 session cookie）");
  }
  const body: Record<string, unknown> = {
    siteId,
    accessToken,
  };
  const platformUserId = toPositiveInt(args.platformUserId);
  if (platformUserId) {
    body.platformUserId = platformUserId;
  }
  if (typeof args.credentialMode === "string" && args.credentialMode.trim()) {
    body.credentialMode = args.credentialMode.trim();
  } else {
    body.credentialMode = "session";
  }

  const settings = await loadSettings();
  const result = await metapiAdminFetch({
    settings,
    path: "/api/accounts/verify-token",
    method: "POST",
    body,
    fetcher,
  });
  if (!result.ok) {
    return metapiError(toolCall, result.message, result);
  }
  return metapiOk(toolCall, redactSensitive(result.data));
}

async function createAccount(toolCall: ModelToolCall, fetcher: typeof fetch): Promise<ModelToolResult> {
  const args = asObject(toolCall.arguments);
  const siteId = toPositiveInt(args.siteId);
  const accessToken = typeof args.accessToken === "string" ? args.accessToken.trim() : "";
  if (!siteId) {
    return metapiError(toolCall, "siteId 必须是正整数");
  }
  if (!accessToken) {
    return metapiError(toolCall, "accessToken 不能为空（系统访问令牌或 session cookie）");
  }
  const body: Record<string, unknown> = {
    siteId,
    accessToken,
    credentialMode: typeof args.credentialMode === "string" && args.credentialMode.trim()
      ? args.credentialMode.trim()
      : "session",
    skipModelFetch: args.skipModelFetch === true,
  };
  const platformUserId = toPositiveInt(args.platformUserId);
  if (platformUserId) {
    body.platformUserId = platformUserId;
  }
  if (typeof args.username === "string" && args.username.trim()) {
    body.username = args.username.trim();
  }

  const settings = await loadSettings();
  const result = await metapiAdminFetch({
    settings,
    path: "/api/accounts",
    method: "POST",
    body,
    fetcher,
  });
  if (!result.ok) {
    return metapiError(toolCall, result.message, result);
  }
  const data = result.data;
  if (data && typeof data === "object" && !Array.isArray(data)) {
    return metapiOk(toolCall, redactMetapiAccount(data as Record<string, unknown>));
  }
  return metapiOk(toolCall, redactSensitive(data));
}

async function loadSettings(): Promise<MetapiAdminSettings> {
  return normalizeMetapiAdminSettings(await getAppSetting(METAPI_ADMIN_SETTINGS_KEY));
}

function asObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function toPositiveInt(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) {
    return value;
  }
  if (typeof value === "string" && /^\d+$/.test(value.trim())) {
    const parsed = Number(value.trim());
    if (parsed > 0) {
      return parsed;
    }
  }
  return undefined;
}

function sanitizeSite(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return value;
  }
  const site = { ...(value as Record<string, unknown>) };
  if (typeof site.apiKey === "string" && site.apiKey) {
    site.apiKey = "[redacted]";
  }
  return site;
}

function redactSensitive(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => redactSensitive(item));
  }
  if (!value || typeof value !== "object") {
    return value;
  }
  return redactMetapiAccount(value as Record<string, unknown>);
}

function metapiOk(toolCall: ModelToolCall, data: unknown): ModelToolResult {
  return {
    toolCallId: toolCall.id,
    name: toolCall.name,
    content: JSON.stringify(data, null, 2),
  };
}

function metapiError(toolCall: ModelToolCall, message: string, detail?: unknown): ModelToolResult {
  const payload = {
    ok: false,
    message,
    ...(detail && typeof detail === "object" ? { detail } : {}),
    errorText: extractMetapiErrorMessage(detail) || message,
  };
  return {
    toolCallId: toolCall.id,
    name: toolCall.name,
    content: JSON.stringify(payload, null, 2),
    isError: true,
  };
}
