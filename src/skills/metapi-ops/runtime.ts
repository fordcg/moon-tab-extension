import {
  extractMetapiErrorMessage,
  findExistingSiteByUrl,
  isSameUtcDay,
  metapiAdminFetch,
  METAPI_ADMIN_SETTINGS_KEY,
  METAPI_BROWSER_CHECKIN_RESULTS_KEY,
  normalizeBrowserCheckinResults,
  normalizeMetapiAdminSettings,
  normalizeSiteUrl,
  parseRegisterRelaySiteArgs,
  redactMetapiAccount,
  upsertBrowserCheckinResult,
  type MetapiAdminSettings,
  type MetapiBrowserCheckinResult,
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
  METAPI_LIST_BROWSER_CHECKIN_RESULTS_TOOL_ID,
  METAPI_LIST_BROWSER_CHECKIN_RESULTS_TOOL_NAME,
  METAPI_LIST_SITES_TOOL_ID,
  METAPI_LIST_SITES_TOOL_NAME,
  METAPI_PARSE_REGISTER_ARGS_TOOL_ID,
  METAPI_PARSE_REGISTER_ARGS_TOOL_NAME,
  METAPI_RECORD_BROWSER_CHECKIN_TOOL_ID,
  METAPI_RECORD_BROWSER_CHECKIN_TOOL_NAME,
  METAPI_SET_SITE_CHECKIN_ENABLED_TOOL_ID,
  METAPI_SET_SITE_CHECKIN_ENABLED_TOOL_NAME,
  METAPI_SUMMARIZE_CHECKIN_LOGS_TOOL_ID,
  METAPI_SUMMARIZE_CHECKIN_LOGS_TOOL_NAME,
  METAPI_TRIGGER_CHECKIN_TOOL_ID,
  METAPI_TRIGGER_CHECKIN_TOOL_NAME,
  METAPI_VERIFY_ACCOUNT_TOKEN_TOOL_ID,
  METAPI_VERIFY_ACCOUNT_TOKEN_TOOL_NAME,
  METAPI_DELETE_SITE_TOOL_ID,
  METAPI_DELETE_SITE_TOOL_NAME,
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
    if (toolCall.id === METAPI_RECORD_BROWSER_CHECKIN_TOOL_ID || toolName === METAPI_RECORD_BROWSER_CHECKIN_TOOL_NAME) {
      return recordBrowserCheckin(toolCall);
    }
    if (toolCall.id === METAPI_LIST_BROWSER_CHECKIN_RESULTS_TOOL_ID || toolName === METAPI_LIST_BROWSER_CHECKIN_RESULTS_TOOL_NAME) {
      return listBrowserCheckinResults(toolCall);
    }
    if (toolCall.id === METAPI_DELETE_SITE_TOOL_ID || toolName === METAPI_DELETE_SITE_TOOL_NAME) {
      return deleteSite(toolCall, fetcher);
    }
    if (toolCall.id === METAPI_SET_SITE_CHECKIN_ENABLED_TOOL_ID || toolName === METAPI_SET_SITE_CHECKIN_ENABLED_TOOL_NAME) {
      return setSiteCheckinEnabled(toolCall, fetcher);
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
  // Default wait 45s so "开始签到" behaves like a job runner instead of fire-and-forget.
  const waitSeconds = clampInt(args.waitSeconds, 0, 180, 45);
  const pollIntervalSeconds = clampInt(args.pollIntervalSeconds, 2, 30, 5);
  const settings = await loadSettings();

  // Snapshot current log ids so we can detect newly produced check-in results while waiting.
  const baseline = await fetchCheckinLogSnapshot(settings, fetcher, 200);
  const baselineIds = new Set(baseline.logs.map((item) => checkinLogIdentity(item)).filter(Boolean));

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

  const triggerPayload =
    typeof result.data === "object" && result.data && !Array.isArray(result.data)
      ? (result.data as Record<string, unknown>)
      : { data: result.data };
  const jobId = firstString(triggerPayload.jobId, triggerPayload.job_id, triggerPayload.id);

  let waitedSeconds = 0;
  let pollCount = 0;
  let latestLogs: Array<Record<string, unknown>> = [];
  let newLogs: Array<Record<string, unknown>> = [];
  let jobStatus = firstString(triggerPayload.status, triggerPayload.state, "pending") || "pending";

  if (waitSeconds > 0) {
    const deadline = Date.now() + waitSeconds * 1000;
    while (Date.now() < deadline) {
      const remainingMs = deadline - Date.now();
      if (remainingMs <= 0) {
        break;
      }
      const sleepMs = Math.min(pollIntervalSeconds * 1000, remainingMs);
      await sleep(sleepMs);
      waitedSeconds += sleepMs / 1000;
      pollCount += 1;

      const snapshot = await fetchCheckinLogSnapshot(settings, fetcher, 200);
      latestLogs = snapshot.logs;
      newLogs = latestLogs.filter((item) => {
        const id = checkinLogIdentity(item);
        return id ? !baselineIds.has(id) : true;
      });

      // Prefer job-scoped logs when Metapi includes jobId fields; otherwise fall back to any new logs.
      const jobScoped = jobId
        ? newLogs.filter((item) => {
            const entryJobId = firstString(item.jobId, item.job_id, item.runId, item.run_id);
            return !entryJobId || entryJobId === jobId;
          })
        : newLogs;

      if (jobScoped.length > 0) {
        jobStatus = "completed_or_progressing";
        // Once we observe new check-in logs, return immediately instead of waiting out the full timeout.
        newLogs = jobScoped;
        break;
      }

      // Optional job status endpoint variants — ignore failures and keep polling logs.
      if (jobId) {
        const status = await tryFetchCheckinJobStatus(settings, fetcher, jobId);
        if (status) {
          jobStatus = status;
          if (isTerminalCheckinJobStatus(status)) {
            break;
          }
        }
      }
    }
  }

  const summary = summarizeCheckinLogRows(newLogs.length ? newLogs : latestLogs);
  const stillRunning = newLogs.length === 0 && !isTerminalCheckinJobStatus(jobStatus);

  return metapiOk(toolCall, {
    ...triggerPayload,
    jobId: jobId || triggerPayload.jobId || null,
    jobStatus,
    waitedSeconds: Math.round(waitedSeconds * 10) / 10,
    pollCount,
    pollIntervalSeconds,
    newLogCount: newLogs.length,
    summary,
    guidance:
      newLogs.length > 0
        ? "签到已产生新日志。可直接用下方 summary 汇报；若需补签，再调用 metapi_summarize_checkin_logs。"
        : stillRunning
          ? "任务仍在执行。不要立刻反复轮询；可再调用一次 metapi_trigger_checkin(waitSeconds=60) 继续等待，或稍后 metapi_summarize_checkin_logs。"
          : "已触发签到。若 summary 为空，稍后再查日志。",
  });
}

async function fetchCheckinLogSnapshot(
  settings: Awaited<ReturnType<typeof loadSettings>>,
  fetcher: typeof fetch,
  limit: number,
): Promise<{ ok: boolean; logs: Array<Record<string, unknown>>; message?: string }> {
  const result = await metapiAdminFetch({
    settings,
    path: `/api/checkin/logs?limit=${limit}`,
    method: "GET",
    fetcher,
  });
  if (!result.ok) {
    return { ok: false, logs: [], message: result.message };
  }
  return { ok: true, logs: extractLogArray(result.data) };
}

function checkinLogIdentity(item: Record<string, unknown>): string {
  const nested = item.checkin_logs && typeof item.checkin_logs === "object" && !Array.isArray(item.checkin_logs)
    ? (item.checkin_logs as Record<string, unknown>)
    : item;
  const direct = firstString(
    nested.id,
    nested.logId,
    nested.log_id,
    item.id,
  );
  if (direct) {
    return direct;
  }
  // Numeric ids from Metapi are common.
  for (const value of [nested.id, nested.logId, nested.log_id, item.id]) {
    if (typeof value === "number" && Number.isFinite(value)) {
      return String(value);
    }
  }
  return [
    firstString(nested.accountId, nested.account_id, item.accountId),
    firstString(nested.createdAt, nested.created_at, nested.time, item.createdAt),
    firstString(nested.status, item.status),
    firstString(nested.message, item.message),
  ].join("|");
}

async function tryFetchCheckinJobStatus(
  settings: Awaited<ReturnType<typeof loadSettings>>,
  fetcher: typeof fetch,
  jobId: string,
): Promise<string | undefined> {
  const candidates = [
    `/api/checkin/jobs/${encodeURIComponent(jobId)}`,
    `/api/checkin/status?jobId=${encodeURIComponent(jobId)}`,
    `/api/jobs/${encodeURIComponent(jobId)}`,
  ];
  for (const path of candidates) {
    const result = await metapiAdminFetch({
      settings,
      path,
      method: "GET",
      fetcher,
    });
    if (!result.ok || !result.data || typeof result.data !== "object" || Array.isArray(result.data)) {
      continue;
    }
    const data = result.data as Record<string, unknown>;
    const status = firstString(data.status, data.state, data.jobStatus, data.job_status);
    if (status) {
      return status;
    }
  }
  return undefined;
}

function isTerminalCheckinJobStatus(status: string): boolean {
  const normalized = status.trim().toLowerCase();
  return (
    normalized === "completed" ||
    normalized === "complete" ||
    normalized === "success" ||
    normalized === "failed" ||
    normalized === "error" ||
    normalized === "done" ||
    normalized === "finished" ||
    normalized === "cancelled" ||
    normalized === "canceled"
  );
}

function summarizeCheckinLogRows(logs: Array<Record<string, unknown>>): {
  total: number;
  counts: { success: number; failed: number; skipped: number; other: number };
  sample: Array<Record<string, unknown>>;
} {
  const counts = { success: 0, failed: 0, skipped: 0, other: 0 };
  const sample: Array<Record<string, unknown>> = [];
  for (const raw of logs) {
    const entry = summarizeCheckinEntry(raw);
    counts[entry.bucket] += 1;
    if (sample.length < 12) {
      sample.push({
        status: entry.status,
        bucket: entry.bucket,
        siteUrl: entry.siteUrl,
        siteName: entry.siteName,
        message: entry.message,
      });
    }
  }
  return {
    total: logs.length,
    counts,
    sample: sample.map((item) => redactSensitive(item) as Record<string, unknown>),
  };
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
  const browserResults = normalizeBrowserCheckinResults(await getAppSetting(METAPI_BROWSER_CHECKIN_RESULTS_KEY));
  const todayBrowser = browserResults.filter((item) => isSameUtcDay(item.repairedAt));
  const todayBrowserSuccess = new Set(
    todayBrowser
      .filter((item) => item.status === "success" || item.status === "skipped")
      .map((item) => normalizeSiteUrl(item.siteUrl).toLowerCase()),
  );
  const todayBrowserNeedsHuman = new Set(
    todayBrowser
      .filter((item) => item.status === "needs_human")
      .map((item) => normalizeSiteUrl(item.siteUrl).toLowerCase()),
  );
  const summary = classifyCheckinLogs(filtered);
  const enrichedCandidates = (summary.repairCandidates as Array<Record<string, unknown>>).map((item) => {
    const message = typeof item.message === "string" ? item.message : "";
    // Official Metapi auto-checkin errors (404/fetch failed/未启用) are NOT browser barriers.
    // They only mean Metapi's own API path failed; browser UI may still have check-in.
    const barrier = isOfficialAutoCheckinErrorOnly(message) ? "none" : detectCheckinBarrier(message);
    return {
      ...item,
      barrier,
      // Always try opening in browser unless already handled locally today.
      autoRepairable: true,
      officialErrorOnly: isOfficialAutoCheckinErrorOnly(message),
      mustOpen: true,
    };
  });
  const repairCandidates = enrichedCandidates.filter((item) => {
    const url = typeof item.siteUrl === "string" ? normalizeSiteUrl(item.siteUrl).toLowerCase() : "";
    if (!url) {
      return false;
    }
    if (todayBrowserSuccess.has(url) || todayBrowserNeedsHuman.has(url)) {
      return false;
    }
    return true;
  });
  // Prefer failed first, then skipped; keep stable unique siteUrl order.
  const ordered = prioritizeRepairCandidates(repairCandidates);
  const mustOpenThisRound = ordered.slice(0, 5);
  const pendingNextBatch = ordered.slice(5);
  const autoCandidates = ordered.filter((item) => item.barrier === "none");
  const blockedCandidates = ordered.filter((item) => item.barrier !== "none");
  return metapiOk(toolCall, {
    ...summary,
    counts: {
      ...summary.counts,
      repairCandidates: ordered.length,
      mustOpenThisRound: mustOpenThisRound.length,
      pendingNextBatch: pendingNextBatch.length,
      autoCandidates: autoCandidates.length,
      blockedCandidates: blockedCandidates.length,
      browserRepairedToday: todayBrowserSuccess.size,
      browserNeedsHumanToday: todayBrowserNeedsHuman.size,
    },
    repairCandidates: ordered,
    mustOpenThisRound,
    pendingNextBatch,
    autoCandidates,
    blockedCandidates,
    browserRepairedToday: todayBrowser.filter((item) => item.status === "success" || item.status === "skipped"),
    browserNeedsHumanToday: todayBrowser.filter((item) => item.status === "needs_human"),
    instructions: [
      "必须对本轮 mustOpenThisRound 中的每一个站点执行 browser.new_page 并实际寻找签到入口。",
      "打开 URL 优先用 openUrl（有 externalCheckinUrl 就用外部签到站，否则用 siteUrl）。",
      "签到入口搜索顺序：外部签到页 → 控制台/个人资料 → 控制台钱包/充值页内签到入口 → 主页/仪表盘 → 顶栏/侧栏/标签栏；都没有才判无签到。",
      "未登录时优先点 LinuxDO 登录，其次 GitHub 登录；授权页点「允许/Authorize」。",
      "Cloudflare Turnstile checkbox/managed：take_snapshot 找 turnstile iframe → click iframe UID（CDP 真实鼠标）→ 等 2~8s 再确认；图片点选/超时才 needs_human，保留标签页不 close_page。",
      "hCaptcha 图片题 / 点选挑战：立即 needs_human，保留标签页不 close_page，继续下一站；不要反复截图空转。",
      "禁止因为官方日志写着 HTTP 404 / fetch failed / 签到功能未启用 / Cloudflare 403 就跳过不打开。",
      "未打开的站点只能放进 pendingNextBatch，不能记 failed/skipped。",
      "成功/失败/无入口：close_page + metapi_record_browser_checkin(status必填)。needs_human：不要 close_page。",
      "删除站点：metapi_delete_site；关闭/开启站点签到：metapi_set_site_checkin_enabled。",
    ],
    note: "浏览器补签不会自动改写 Metapi 官方签到日志。本地 browserRepairedToday/browserNeedsHumanToday 会从候选排除。",
  });
}

async function recordBrowserCheckin(toolCall: ModelToolCall): Promise<ModelToolResult> {
  const args = asObject(toolCall.arguments);
  const siteUrl = typeof args.siteUrl === "string" ? normalizeSiteUrl(args.siteUrl) : "";
  let status = args.status;
  let message = typeof args.message === "string" ? args.message.trim() : undefined;
  if (!siteUrl) {
    return metapiError(toolCall, "siteUrl 不能为空");
  }

  // Infer status when model forgets required status field.
  status = inferBrowserCheckinStatus(status, message);

  const barrier = detectCheckinBarrier(`${status ?? ""} ${message ?? ""}`);
  if ((status === "failed" || !status) && barrier !== "none" && barrier !== "login") {
    // Captcha / Turnstile / SHIELD failures are human-needed, not generic failed.
    status = "needs_human";
    if (!message) {
      message =
        barrier === "cloudflare"
          ? "Cloudflare Turnstile/人机验证跨域 iframe，需人工完成，页面已保留"
          : barrier === "captcha"
            ? "hCaptcha/图形验证码需人工完成，页面已保留，继续其他站"
            : barrier === "shield"
              ? "SHIELD/我不是机器人需人工或可点击复选框，页面已保留"
              : "需人工处理，页面已保留";
    }
  }

  if (status !== "success" && status !== "failed" && status !== "skipped" && status !== "needs_human") {
    // Last-resort default: message-only calls with no clear status still get recorded as failed.
    if (message) {
      status = "failed";
    } else {
      return metapiError(
        toolCall,
        "status 必填且必须是 success/failed/skipped/needs_human。例如：status=failed message=整站404无法签到",
      );
    }
  }

  const existing = normalizeBrowserCheckinResults(await getAppSetting(METAPI_BROWSER_CHECKIN_RESULTS_KEY));
  const next: MetapiBrowserCheckinResult = {
    siteUrl,
    siteId: toPositiveInt(args.siteId),
    siteName: typeof args.siteName === "string" ? args.siteName.trim() : undefined,
    username: typeof args.username === "string" ? args.username.trim() : undefined,
    status,
    message,
    repairedAt: Date.now(),
    source: "browser_repair",
  };
  const saved = upsertBrowserCheckinResult(existing, next);
  await saveAppSetting({
    key: METAPI_BROWSER_CHECKIN_RESULTS_KEY,
    value: saved,
    updatedAt: Date.now(),
  });
  return metapiOk(toolCall, {
    recorded: true,
    result: next,
    barrier,
    inferredStatus: args.status !== status,
    note: "已写入本地补签记录。若未传 status，已根据 message 自动推断。Metapi 官方日志不会自动更新。",
  });
}

function inferBrowserCheckinStatus(status: unknown, message?: string): unknown {
  if (status === "success" || status === "failed" || status === "skipped" || status === "needs_human") {
    return status;
  }
  const text = (message || "").trim();
  if (!text) {
    return status;
  }
  // Success first (including "SHIELD 通过后签到成功")
  if (/(签到成功|补签成功|今日已签到|已签到|success)/i.test(text) && !/(无法签到|签到失败|未成功)/i.test(text)) {
    return "success";
  }
  if (/(跳过|无需签到|already|skipped)/i.test(text)) {
    return "skipped";
  }
  if (/(shield|我不是机器人|人机验证|turnstile|cf-challenge|security check|hcaptcha|recaptcha|图片题|请验证您是真人)/i.test(text)
    && !/(通过后|已通过|验证码通过后签到成功|shield 通过后)/i.test(text)) {
    return "needs_human";
  }
  if (/(404|403|页面不存在|无法签到|失败|failed|error|timeout|打不开|无法访问|未启用)/i.test(text)) {
    return "failed";
  }
  // Any other free-form message without status: treat as failed so recording still succeeds.
  return "failed";
}

async function listBrowserCheckinResults(toolCall: ModelToolCall): Promise<ModelToolResult> {
  const args = asObject(toolCall.arguments);
  const todayOnly = args.todayOnly !== false;
  const existing = normalizeBrowserCheckinResults(await getAppSetting(METAPI_BROWSER_CHECKIN_RESULTS_KEY));
  const results = todayOnly ? existing.filter((item) => isSameUtcDay(item.repairedAt)) : existing;
  return metapiOk(toolCall, {
    todayOnly,
    count: results.length,
    results,
  });
}

async function resolveSiteId(
  settings: MetapiAdminSettings,
  fetcher: typeof fetch,
  args: Record<string, unknown>,
): Promise<{ ok: true; siteId: number; site?: Record<string, unknown> } | { ok: false; message: string }> {
  const directId = toPositiveInt(args.siteId);
  if (directId) {
    return { ok: true, siteId: directId };
  }
  const url = typeof args.url === "string" ? normalizeSiteUrl(args.url) : "";
  if (!url) {
    return { ok: false, message: "请提供 siteId 或 url" };
  }
  const listed = await metapiAdminFetch<unknown[]>({ settings, path: "/api/sites", fetcher });
  if (!listed.ok) {
    return { ok: false, message: listed.message };
  }
  const sites = Array.isArray(listed.data) ? listed.data : [];
  const existing = findExistingSiteByUrl(
    sites as Array<{ id?: number; url?: string; name?: string; platform?: string }>,
    url,
  );
  const siteId = toPositiveInt(existing?.id);
  if (!siteId) {
    return { ok: false, message: `未找到 URL 对应站点：${url}` };
  }
  return { ok: true, siteId, site: existing as Record<string, unknown> | undefined };
}

async function deleteSite(toolCall: ModelToolCall, fetcher: typeof fetch): Promise<ModelToolResult> {
  const args = asObject(toolCall.arguments);
  if (args.confirm !== true) {
    return metapiError(toolCall, "删除站点需要 confirm=true，防止误删");
  }
  const settings = await loadSettings();
  const resolved = await resolveSiteId(settings, fetcher, args);
  if (!resolved.ok) {
    return metapiError(toolCall, resolved.message);
  }
  const result = await metapiAdminFetch({
    settings,
    path: `/api/sites/${resolved.siteId}`,
    method: "DELETE",
    fetcher,
  });
  if (!result.ok) {
    return metapiError(toolCall, result.message, result);
  }
  return metapiOk(toolCall, {
    deleted: true,
    siteId: resolved.siteId,
    data: result.data ?? null,
  });
}

async function setSiteCheckinEnabled(toolCall: ModelToolCall, fetcher: typeof fetch): Promise<ModelToolResult> {
  const args = asObject(toolCall.arguments);
  if (typeof args.enabled !== "boolean") {
    return metapiError(toolCall, "enabled 必须是 boolean");
  }
  const settings = await loadSettings();
  const resolved = await resolveSiteId(settings, fetcher, args);
  if (!resolved.ok) {
    return metapiError(toolCall, resolved.message);
  }

  // Prefer PATCH; fall back to PUT if server rejects PATCH.
  const bodies = [
    { checkinEnabled: args.enabled },
    { checkin_enabled: args.enabled },
    { checkinEnabled: args.enabled, checkin_enabled: args.enabled },
  ];
  let lastError: string | undefined;
  for (const method of ["PATCH", "PUT"] as const) {
    for (const body of bodies) {
      const result = await metapiAdminFetch({
        settings,
        path: `/api/sites/${resolved.siteId}`,
        method,
        body,
        fetcher,
      });
      if (result.ok) {
        return metapiOk(toolCall, {
          siteId: resolved.siteId,
          enabled: args.enabled,
          method,
          body,
          data: result.data ?? null,
        });
      }
      lastError = result.message;
      // 404/405 means method/body shape wrong; try next. 401/403 should stop.
      if (result.status === 401 || result.status === 403) {
        return metapiError(toolCall, result.message, result);
      }
    }
  }
  return metapiError(toolCall, lastError || "更新站点签到开关失败");
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
    .map((item) => {
      const message = typeof item.message === "string" ? item.message : "";
      const barrier = isOfficialAutoCheckinErrorOnly(message) ? "none" : detectCheckinBarrier(message);
      const siteUrl = typeof item.siteUrl === "string" ? item.siteUrl : "";
      const externalCheckinUrl = typeof item.externalCheckinUrl === "string" ? item.externalCheckinUrl : "";
      const openUrl = externalCheckinUrl || siteUrl;
      return {
        siteId: item.siteId,
        siteName: item.siteName,
        siteUrl,
        externalCheckinUrl: externalCheckinUrl || null,
        openUrl,
        username: item.username,
        status: item.status,
        message: item.message,
        bucket: item.bucket,
        barrier,
        autoRepairable: true,
        officialErrorOnly: isOfficialAutoCheckinErrorOnly(message),
        mustOpen: true,
      };
    });

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
    flat.externalCheckinUrl = site.externalCheckinUrl ?? site.external_checkin_url ?? flat.externalCheckinUrl;
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
  const externalCheckinUrl = firstString(raw.externalCheckinUrl, raw.external_checkin_url, site.externalCheckinUrl, site.external_checkin_url);
  const openUrl = externalCheckinUrl || siteUrl || "";
  const bucket = classifyStatus(status, message);

  return {
    bucket,
    status: status || null,
    message: message || null,
    siteId: siteId ?? null,
    siteName: siteName || null,
    siteUrl: siteUrl ? normalizeSiteUrl(String(siteUrl)) : null,
    externalCheckinUrl: externalCheckinUrl ? String(externalCheckinUrl).trim() : null,
    openUrl: openUrl ? String(openUrl).trim() : null,
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

function detectCheckinBarrier(message: string): "none" | "shield" | "captcha" | "cloudflare" | "login" {
  const text = message.toLowerCase();
  if (!text.trim()) {
    return "none";
  }
  // Cloudflare Turnstile / CF challenge first (often reported as captcha too).
  if (
    /(turnstile|cf-challenge|just a moment|attention required|cloudflare|cf-ray|请验证您是真人|验证您是真人)/i.test(message)
    || /turnstile|cloudflare/.test(text)
  ) {
    return "cloudflare";
  }
  // SHIELD checkbox (same-origin, sometimes clickable)
  if (/(shield|我不是机器人|人机验证|security check)/i.test(message) || /\bshield\b/.test(text)) {
    return "shield";
  }
  // hCaptcha / reCAPTCHA image challenges — always human; do not keep retrying screenshots.
  if (
    /(hcaptcha|recaptcha|图片题|点选|拖动|篮球|验证码|captcha|\/checkin\/captcha|图形验证)/i.test(message)
    || /captcha|hcaptcha|recaptcha/.test(text)
  ) {
    return "captcha";
  }
  if (/(登录|login|sign in|未登录|auth|expired)/i.test(message) && !/oauth|authorization bearer/i.test(message)) {
    return "login";
  }
  return "none";
}

/** Metapi auto-checkin backend errors — still require browser open to find UI check-in. */
function isOfficialAutoCheckinErrorOnly(message: string): boolean {
  const text = message || "";
  return /(http\s*404|http\s*403|fetch failed|签到功能未启用|timeout|econnreset|econnrefused|network error|networkerror|enotfound|socket|tls|certificate|5\d\d)/i.test(text);
}

function prioritizeRepairCandidates(candidates: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  const failed = candidates.filter((item) => item.bucket === "failed" || item.status === "failed");
  const skipped = candidates.filter((item) => item.bucket === "skipped" || item.status === "skipped");
  const rest = candidates.filter((item) => !failed.includes(item) && !skipped.includes(item));
  const merged = [...failed, ...skipped, ...rest];
  const seen = new Set<string>();
  const unique: Array<Record<string, unknown>> = [];
  for (const item of merged) {
    const url = typeof item.siteUrl === "string" ? normalizeSiteUrl(item.siteUrl).toLowerCase() : "";
    if (!url || seen.has(url)) {
      continue;
    }
    seen.add(url);
    unique.push(item);
  }
  return unique;
}

function firstString(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
    if (typeof value === "number" && Number.isFinite(value)) {
      return String(value);
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
