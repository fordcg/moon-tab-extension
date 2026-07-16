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
} from "../../shared/metapiAdmin";
import {
  METAPI_CONFIGURE_TOOL_ID,
  METAPI_CONFIGURE_TOOL_NAME,
  METAPI_CREATE_ACCOUNT_TOOL_ID,
  METAPI_CREATE_ACCOUNT_TOOL_NAME,
  METAPI_CREATE_SITE_TOOL_ID,
  METAPI_CREATE_SITE_TOOL_NAME,
  METAPI_DETECT_SITE_TOOL_ID,
  METAPI_DETECT_SITE_TOOL_NAME,
  METAPI_GET_CHECKIN_LOGS_TOOL_ID,
  METAPI_GET_CHECKIN_LOGS_TOOL_NAME,
  METAPI_LIST_SITES_TOOL_ID,
  METAPI_LIST_SITES_TOOL_NAME,
  METAPI_PARSE_REGISTER_ARGS_TOOL_ID,
  METAPI_PARSE_REGISTER_ARGS_TOOL_NAME,
  METAPI_SUMMARIZE_CHECKIN_LOGS_TOOL_ID,
  METAPI_SUMMARIZE_CHECKIN_LOGS_TOOL_NAME,
  METAPI_TRIGGER_CHECKIN_TOOL_ID,
  METAPI_TRIGGER_CHECKIN_TOOL_NAME,
  METAPI_VERIFY_ACCOUNT_TOKEN_TOOL_ID,
  METAPI_VERIFY_ACCOUNT_TOKEN_TOOL_NAME,
} from "./toolIds";
import type { ModelToolCall, ModelToolResult } from "../../shared/models/types";
import { getAppSetting, saveAppSetting } from "../../shared/storage/repositories";

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
    if (toolCall.id === METAPI_TRIGGER_CHECKIN_TOOL_ID || toolName === METAPI_TRIGGER_CHECKIN_TOOL_NAME) {
      return triggerCheckin(toolCall, fetcher);
    }
    if (toolCall.id === METAPI_GET_CHECKIN_LOGS_TOOL_ID || toolName === METAPI_GET_CHECKIN_LOGS_TOOL_NAME) {
      return getCheckinLogs(toolCall, fetcher);
    }
    if (toolCall.id === METAPI_SUMMARIZE_CHECKIN_LOGS_TOOL_ID || toolName === METAPI_SUMMARIZE_CHECKIN_LOGS_TOOL_NAME) {
      return summarizeCheckinLogs(toolCall, fetcher);
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

async function triggerCheckin(toolCall: ModelToolCall, fetcher: typeof fetch): Promise<ModelToolResult> {
  const args = asObject(toolCall.arguments);
  const waitSeconds = clampInt(args.waitSeconds, 0, 180, 0);
  const settings = await loadSettings();
  const result = await metapiAdminFetch({
    settings,
    path: "/api/checkin/trigger",
    method: "POST",
    body: {},
    fetcher,
  });
  if (!result.ok) {
    return metapiError(toolCall, result.message, result);
  }
  if (waitSeconds > 0) {
    await sleep(waitSeconds * 1000);
  }
  return metapiOk(toolCall, {
    ...(typeof result.data === "object" && result.data ? result.data : { data: result.data }),
    waitedSeconds: waitSeconds,
  });
}

async function getCheckinLogs(toolCall: ModelToolCall, fetcher: typeof fetch): Promise<ModelToolResult> {
  const args = asObject(toolCall.arguments);
  const limit = clampInt(args.limit, 1, 500, 100);
  const jobId = typeof args.jobId === "string" ? args.jobId.trim() : "";
  const settings = await loadSettings();
  const result = await metapiAdminFetch({
    settings,
    path: `/api/checkin/logs?limit=${limit}`,
    method: "GET",
    fetcher,
  });
  if (!result.ok) {
    return metapiError(toolCall, result.message, result);
  }
  const logs = extractLogArray(result.data);
  const filtered = jobId
    ? logs.filter((item) => String(item.jobId ?? item.job_id ?? item.runId ?? "") === jobId)
    : logs;
  return metapiOk(toolCall, {
    limit,
    jobId: jobId || null,
    count: filtered.length,
    logs: filtered.map((item) => redactSensitive(item)),
  });
}

async function summarizeCheckinLogs(toolCall: ModelToolCall, fetcher: typeof fetch): Promise<ModelToolResult> {
  const args = asObject(toolCall.arguments);
  const limit = clampInt(args.limit, 1, 500, 100);
  const jobId = typeof args.jobId === "string" ? args.jobId.trim() : "";
  const settings = await loadSettings();
  const result = await metapiAdminFetch({
    settings,
    path: `/api/checkin/logs?limit=${limit}`,
    method: "GET",
    fetcher,
  });
  if (!result.ok) {
    return metapiError(toolCall, result.message, result);
  }
  const logs = extractLogArray(result.data);
  const filtered = jobId
    ? logs.filter((item) => String(item.jobId ?? item.job_id ?? item.runId ?? "") === jobId)
    : logs;
  const summary = classifyCheckinLogs(filtered);
  return metapiOk(toolCall, summary);
}

async function loadSettings(): Promise<MetapiAdminSettings> {
  return normalizeMetapiAdminSettings(await getAppSetting(METAPI_ADMIN_SETTINGS_KEY));
}

function extractLogArray(data: unknown): Array<Record<string, unknown>> {
  const rows: unknown[] = [];
  if (Array.isArray(data)) {
    rows.push(...data);
  } else if (data && typeof data === "object") {
    const source = data as Record<string, unknown>;
    for (const key of ["logs", "data", "items", "results", "records"]) {
      const value = source[key];
      if (Array.isArray(value)) {
        rows.push(...value);
        break;
      }
    }
  }

  return rows
    .map((item) => flattenCheckinLogRow(item))
    .filter((item): item is Record<string, unknown> => Boolean(item));
}

function classifyCheckinLogs(logs: Array<Record<string, unknown>>) {
  const success: Array<Record<string, unknown>> = [];
  const failed: Array<Record<string, unknown>> = [];
  const skipped: Array<Record<string, unknown>> = [];
  const other: Array<Record<string, unknown>> = [];

  for (const raw of logs) {
    const entry = summarizeCheckinEntry(raw);
    const bucket = entry.bucket;
    if (bucket === "success") success.push(entry);
    else if (bucket === "failed") failed.push(entry);
    else if (bucket === "skipped") skipped.push(entry);
    else other.push(entry);
  }

  const repairCandidates = [...failed, ...skipped]
    .filter((item) => typeof item.siteUrl === "string" && item.siteUrl)
    .map((item) => ({
      siteId: item.siteId,
      siteName: item.siteName,
      siteUrl: item.siteUrl,
      username: item.username,
      status: item.status,
      message: item.message,
      bucket: item.bucket,
    }));

  return {
    total: logs.length,
    counts: {
      success: success.length,
      failed: failed.length,
      skipped: skipped.length,
      other: other.length,
      repairCandidates: repairCandidates.length,
    },
    success,
    failed,
    skipped,
    other,
    repairCandidates,
  };
}

function flattenCheckinLogRow(item: unknown): Record<string, unknown> | undefined {
  if (!item || typeof item !== "object" || Array.isArray(item)) {
    return undefined;
  }
  const row = item as Record<string, unknown>;
  // Metapi returns nested rows:
  // { checkin_logs, accounts, sites, failureReason }
  const log = asRecord(row.checkin_logs) ?? asRecord(row.checkinLog) ?? asRecord(row.log);
  const account = asRecord(row.accounts) ?? asRecord(row.account);
  const site = asRecord(row.sites) ?? asRecord(row.site);
  const failureReason = asRecord(row.failureReason) ?? asRecord(row.failure_reason);

  if (!log && !account && !site) {
    // Already flat-ish row
    return row;
  }

  const flat: Record<string, unknown> = {
    ...row,
    ...(log ?? {}),
  };
  if (account) {
    flat.accountId = account.id ?? flat.accountId;
    flat.username = account.username ?? flat.username;
    flat.siteId = account.siteId ?? flat.siteId;
    flat.accountStatus = account.status;
  }
  if (site) {
    flat.siteId = site.id ?? flat.siteId;
    flat.siteName = site.name ?? flat.siteName;
    flat.siteUrl = site.url ?? flat.siteUrl;
    flat.platform = site.platform;
    flat.site = site;
  }
  if (failureReason) {
    flat.failureReason = failureReason;
    flat.message = flat.message
      ?? failureReason.title
      ?? failureReason.detailHint
      ?? failureReason.actionHint
      ?? failureReason.code;
  }
  // Prefer nested checkin log status over site/account status.
  if (log?.status !== undefined) {
    flat.status = log.status;
  }
  if (log?.message !== undefined) {
    flat.message = log.message ?? flat.message;
  }
  return flat;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

function summarizeCheckinEntry(raw: Record<string, unknown>) {
  const status = String(raw.status ?? raw.result ?? raw.state ?? raw.outcome ?? "").toLowerCase();
  const failureReason = asRecord(raw.failureReason);
  const message = firstString(
    raw.message,
    raw.error,
    raw.reason,
    raw.detail,
    failureReason?.title,
    failureReason?.detailHint,
    failureReason?.actionHint,
    failureReason?.code,
  );
  const site = asRecord(raw.site) ?? {};
  const siteUrl = firstString(
    raw.siteUrl,
    raw.url,
    raw.site_url,
    site.url,
    site.siteUrl,
  );
  const siteName = firstString(raw.siteName, raw.name, site.name, raw.site_name);
  const username = firstString(raw.username, raw.userName, raw.accountName);
  const siteId = toPositiveInt(raw.siteId ?? raw.site_id ?? site.id);
  const bucket = classifyStatus(status, message);

  return {
    bucket,
    status: status || null,
    message: message || null,
    siteId: siteId ?? null,
    siteName: siteName || null,
    siteUrl: siteUrl ? normalizeSiteUrl(String(siteUrl)) : null,
    username: username || null,
    jobId: firstString(raw.jobId, raw.job_id, raw.runId) || null,
    checkedAt: firstString(raw.checkedAt, raw.createdAt, raw.updatedAt, raw.time, raw.timestamp) || null,
    reward: raw.reward ?? null,
  };
}

function classifyStatus(status: string, message: string): "success" | "failed" | "skipped" | "other" {
  const normalizedStatus = status.trim().toLowerCase();
  // Prefer explicit status tokens from Metapi checkin_logs.status.
  if (["success", "ok", "succeeded"].includes(normalizedStatus)) {
    return "success";
  }
  if (["skip", "skipped", "ignored", "ignore"].includes(normalizedStatus)) {
    return "skipped";
  }
  if (["fail", "failed", "error", "timeout", "invalid"].includes(normalizedStatus)) {
    return "failed";
  }
  if (["pending", "running", "queued"].includes(normalizedStatus)) {
    return "other";
  }

  const text = `${normalizedStatus} ${message}`.toLowerCase();
  if (/(已签到|签到成功|成功)/.test(text) && !/(失败|failed|error)/.test(text)) {
    return "success";
  }
  if (/(跳过|无需|already|skipped)/.test(text)) {
    return "skipped";
  }
  if (/(失败|错误|超时|异常|failed|error|timeout)/.test(text)) {
    return "failed";
  }
  return "other";
}

function firstString(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return "";
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const numberValue = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numberValue)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, Math.round(numberValue)));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
