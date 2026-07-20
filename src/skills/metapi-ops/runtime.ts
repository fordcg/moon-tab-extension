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
  METAPI_LIST_MODEL_MARKETPLACE_SITES_TOOL_ID,
  METAPI_LIST_MODEL_MARKETPLACE_SITES_TOOL_NAME,
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

type CheckinBarrier = ReturnType<typeof detectCheckinBarrier>;
type BrowserCheckinStatus = MetapiBrowserCheckinResult["status"];
type MarketplaceMatchMode = "auto" | "exact" | "fuzzy";
type MarketplaceMatchType = "exact" | "fuzzy";
type RepairCandidate = Record<string, unknown> & {
  siteUrl: string;
  externalCheckinUrl: string | null;
  openUrl: string;
  barrier: CheckinBarrier;
  autoRepairable: boolean;
  officialErrorOnly: boolean;
  mustOpen: boolean;
};

type MarketplaceModelContext = {
  ids: string[];
  names: string[];
  aliases: string[];
};

type MarketplaceSiteContext = {
  siteId?: string | number;
  siteName?: string;
  siteUrl?: string;
  provider?: string;
  platform?: string;
};

type MarketplaceTraversalContext = {
  model: MarketplaceModelContext;
  site: MarketplaceSiteContext;
};

type MarketplaceEntry = MarketplaceTraversalContext & {
  path: string;
  raw: Record<string, unknown>;
};

type MarketplaceMatchedEntry = MarketplaceEntry & {
  matchType: MarketplaceMatchType;
  confidence: number;
  matchedValues: string[];
};

type MarketplaceCache = {
  key: string;
  fetchedAt: number;
  data: unknown;
  status?: number;
};

type MarketplaceResponseContainerSummary = {
  path: string;
  type: "array" | "object";
  length?: number;
  keys?: string[];
};

type MarketplaceResponseSummary = {
  type: string;
  note: string;
  topLevelArrayLength?: number;
  topLevelKeys?: string[];
  containers: MarketplaceResponseContainerSummary[];
  sample: unknown;
};

const MARKETPLACE_CACHE_TTL_MS = 60_000;
let marketplaceCache: MarketplaceCache | undefined;

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
    if (toolCall.id === METAPI_LIST_MODEL_MARKETPLACE_SITES_TOOL_ID || toolName === METAPI_LIST_MODEL_MARKETPLACE_SITES_TOOL_NAME) {
      return listModelMarketplaceSites(toolCall, fetcher);
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

async function listModelMarketplaceSites(toolCall: ModelToolCall, fetcher: typeof fetch): Promise<ModelToolResult> {
  const args = asObject(toolCall.arguments);
  const model = typeof args.model === "string" ? args.model.trim() : "";
  if (!model) {
    return metapiError(toolCall, "model 不能为空");
  }

  const matchMode = parseMarketplaceMatchMode(args.matchMode);
  const limit = clampInt(args.limit, 1, 100, 20);
  const includeRawMatches = args.includeRawMatches === true;
  const refresh = args.refresh === true;
  const settings = await loadSettings();
  const fetched = await fetchModelMarketplace(settings, fetcher, refresh);
  if (!fetched.ok) {
    return metapiError(toolCall, fetched.message, fetched.detail);
  }

  const entries = extractMarketplaceEntries(fetched.data);
  const exactMatches = matchMarketplaceEntries(entries, model, "exact");
  const fuzzyMatches = matchMarketplaceEntries(entries, model, "fuzzy");
  const selectedMatches = matchMode === "auto"
    ? (exactMatches.length > 0 ? exactMatches : fuzzyMatches)
    : matchMode === "exact"
      ? exactMatches
      : fuzzyMatches;
  const selectedMatchMode: MarketplaceMatchType | "none" = exactMatches.length > 0 && matchMode !== "fuzzy"
    ? "exact"
    : selectedMatches.length > 0
      ? selectedMatches.some((item) => item.matchType === "exact")
        ? "exact"
        : "fuzzy"
      : "none";
  const groupedSites = groupMarketplaceMatchesBySite(selectedMatches, limit);
  const matchStatus = selectedMatchMode === "exact"
    ? "exact"
    : selectedMatchMode === "fuzzy"
      ? "fuzzy_candidates"
      : "not_found";

  return metapiOk(toolCall, {
    query: model,
    endpoint: "GET /api/models/marketplace",
    requestedMatchMode: matchMode,
    matchStatus,
    count: groupedSites.length,
    totalMarketplaceEntries: entries.length,
    exactMatchCount: exactMatches.length,
    fuzzyCandidateCount: fuzzyMatches.length,
    sites: groupedSites,
    rawMatches: includeRawMatches
      ? selectedMatches.slice(0, Math.min(limit, 20)).map((item) => ({
          path: item.path,
          matchType: item.matchType,
          confidence: item.confidence,
          matchedValues: item.matchedValues,
          raw: sanitizeMarketplaceRaw(item.raw),
        }))
      : undefined,
    marketplaceResponseSummary: entries.length === 0
      ? summarizeMarketplaceResponse(fetched.data)
      : undefined,
    fetch: {
      fromCache: fetched.fromCache,
      status: fetched.status ?? null,
      cacheAgeSeconds: fetched.cacheAgeSeconds,
      cacheTtlSeconds: MARKETPLACE_CACHE_TTL_MS / 1000,
    },
    precision: {
      backendExactQueryApiAvailable: false,
      method: "full_marketplace_local_filter",
      note:
        "当前 Metapi 只提供 marketplace 全量接口；本工具先拉取全量列表，再在本地做大小写/空白归一化匹配。精确未命中时只返回模糊候选，不把候选伪装成后端精确查询结果。",
    },
    solutionForNoExactApi: [
      "短期：使用 GET /api/models/marketplace 拉全量数据，本地归一化过滤；默认 auto 模式先 exact，未命中再 fuzzy，并在输出里标记 matchStatus。",
      "性能：工具内置 60 秒内存缓存；需要最新数据时传 refresh=true 强制刷新。",
      "长期：建议 Metapi 后端新增精确查询接口，例如 GET /api/models/marketplace?model=<modelId> 或 GET /api/models/:modelId/sites，由后端基于规范模型 ID 查询并返回权威结果。",
    ],
    guidance: buildMarketplaceGuidance(matchStatus),
  });
}

function parseMarketplaceMatchMode(value: unknown): MarketplaceMatchMode {
  return value === "exact" || value === "fuzzy" || value === "auto" ? value : "auto";
}

async function fetchModelMarketplace(
  settings: MetapiAdminSettings,
  fetcher: typeof fetch,
  refresh: boolean,
): Promise<
  | { ok: true; data: unknown; fromCache: boolean; cacheAgeSeconds: number; status?: number }
  | { ok: false; message: string; detail?: unknown }
> {
  const cacheKey = `${settings.baseUrl}\0${settings.authToken}`;
  const now = Date.now();
  if (!refresh && marketplaceCache?.key === cacheKey && now - marketplaceCache.fetchedAt <= MARKETPLACE_CACHE_TTL_MS) {
    return {
      ok: true,
      data: marketplaceCache.data,
      fromCache: true,
      status: marketplaceCache.status,
      cacheAgeSeconds: Math.max(0, Math.round((now - marketplaceCache.fetchedAt) / 1000)),
    };
  }

  const result = await metapiAdminFetch({
    settings,
    path: "/api/models/marketplace",
    method: "GET",
    fetcher,
  });
  if (!result.ok) {
    return { ok: false, message: result.message, detail: result };
  }
  marketplaceCache = {
    key: cacheKey,
    fetchedAt: now,
    data: result.data,
    status: typeof result.status === "number" ? result.status : undefined,
  };
  return {
    ok: true,
    data: result.data,
    fromCache: false,
    status: typeof result.status === "number" ? result.status : undefined,
    cacheAgeSeconds: 0,
  };
}

function extractMarketplaceEntries(data: unknown): MarketplaceEntry[] {
  const entries: MarketplaceEntry[] = [];
  visitMarketplaceValue(data, [], createMarketplaceContext(), entries);
  return dedupeMarketplaceEntries(entries);
}

function summarizeMarketplaceResponse(data: unknown): MarketplaceResponseSummary {
  const summary: MarketplaceResponseSummary = {
    type: describeMarketplaceValueType(data),
    note: "marketplace 请求 HTTP 成功，但本地解析器未识别到同时包含模型和站点上下文的条目。",
    containers: collectMarketplaceContainerSummaries(data),
    sample: summarizeMarketplaceSample(data),
  };
  if (Array.isArray(data)) {
    summary.topLevelArrayLength = data.length;
  } else if (data && typeof data === "object") {
    summary.topLevelKeys = Object.keys(data as Record<string, unknown>).slice(0, 30);
  }
  return summary;
}

function describeMarketplaceValueType(value: unknown): string {
  if (Array.isArray(value)) {
    return "array";
  }
  if (value === null) {
    return "null";
  }
  return typeof value;
}

function collectMarketplaceContainerSummaries(data: unknown): MarketplaceResponseContainerSummary[] {
  const summaries: MarketplaceResponseContainerSummary[] = [];
  visitMarketplaceSummaryContainer(data, "$", 0, summaries);
  return summaries;
}

function visitMarketplaceSummaryContainer(
  value: unknown,
  path: string,
  depth: number,
  summaries: MarketplaceResponseContainerSummary[],
): void {
  if (depth > 3 || summaries.length >= 12) {
    return;
  }
  if (Array.isArray(value)) {
    summaries.push({ path, type: "array", length: value.length });
    for (const [index, item] of value.slice(0, 3).entries()) {
      visitMarketplaceSummaryContainer(item, `${path}.${index}`, depth + 1, summaries);
      if (summaries.length >= 12) {
        return;
      }
    }
    return;
  }
  if (!value || typeof value !== "object") {
    return;
  }

  const row = value as Record<string, unknown>;
  if (path !== "$") {
    summaries.push({ path, type: "object", keys: Object.keys(row).slice(0, 20) });
  }
  for (const [key, child] of Object.entries(row).slice(0, 20)) {
    if (!child || (typeof child !== "object" && !Array.isArray(child))) {
      continue;
    }
    visitMarketplaceSummaryContainer(child, `${path}.${key}`, depth + 1, summaries);
    if (summaries.length >= 12) {
      return;
    }
  }
}

function summarizeMarketplaceSample(value: unknown, depth = 0): unknown {
  if (depth > 3) {
    return "[truncated]";
  }
  if (Array.isArray(value)) {
    return {
      type: "array",
      length: value.length,
      sample: value.slice(0, 2).map((item) => summarizeMarketplaceSample(item, depth + 1)),
    };
  }
  if (!value || typeof value !== "object") {
    if (typeof value === "string" && value.length > 300) {
      return `${value.slice(0, 300)}...`;
    }
    return value;
  }

  const output: Record<string, unknown> = {};
  const entries = Object.entries(value as Record<string, unknown>);
  for (const [key, child] of entries.slice(0, 12)) {
    output[key] = isSensitiveMetapiKey(key) ? "[redacted]" : summarizeMarketplaceSample(child, depth + 1);
  }
  if (entries.length > 12) {
    output.__truncatedKeys = entries.length - 12;
  }
  return output;
}

function visitMarketplaceValue(
  value: unknown,
  path: string[],
  inheritedContext: MarketplaceTraversalContext,
  entries: MarketplaceEntry[],
): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => visitMarketplaceValue(item, [...path, String(index)], inheritedContext, entries));
    return;
  }
  if (!value || typeof value !== "object") {
    return;
  }

  const row = value as Record<string, unknown>;
  const context = mergeMarketplaceContexts(inheritedContext, extractMarketplaceContextFromObject(row, path));
  if (hasMarketplaceModelContext(context.model) && hasMarketplaceSiteContext(context.site)) {
    entries.push({
      path: path.length ? path.join(".") : "$",
      model: cloneMarketplaceModelContext(context.model),
      site: { ...context.site },
      raw: row,
    });
  }

  for (const [key, child] of Object.entries(row)) {
    if (!child || (typeof child !== "object" && !Array.isArray(child))) {
      continue;
    }
    if (isMarketplaceMetadataChildKey(key)) {
      continue;
    }
    const childPath = [...path, key];
    const childContext = applyMarketplaceMapKeyContext(context, key, child, path);
    visitMarketplaceValue(child, childPath, childContext, entries);
  }
}

function isMarketplaceMetadataChildKey(key: string): boolean {
  return [
    "tags",
    "tokens",
    "pricingSources",
    "pricing_sources",
    "supportedEndpointTypes",
    "supported_endpoint_types",
  ].includes(key);
}

function createMarketplaceContext(): MarketplaceTraversalContext {
  return {
    model: { ids: [], names: [], aliases: [] },
    site: {},
  };
}

function extractMarketplaceContextFromObject(row: Record<string, unknown>, path: string[]): MarketplaceTraversalContext {
  const context = createMarketplaceContext();
  const directModelIds = collectStringsFromKeys(row, [
    "modelId",
    "model_id",
    "modelKey",
    "model_key",
    "modelSlug",
    "model_slug",
    "modelCode",
    "model_code",
  ]);
  const directModelNames = collectStringsFromKeys(row, [
    "model",
    "modelName",
    "model_name",
    "modelDisplayName",
    "model_display_name",
    "displayModelName",
    "display_model_name",
  ]);
  const directModelAliases = collectStringsFromKeys(row, [
    "alias",
    "aliases",
    "modelAlias",
    "model_alias",
    "modelAliases",
    "model_aliases",
  ]);

  appendUniqueStrings(context.model.ids, directModelIds);
  appendUniqueStrings(context.model.names, directModelNames);
  appendUniqueStrings(context.model.aliases, directModelAliases);

  const nestedModel = firstRecordValue(row, ["model", "models_model", "modelInfo", "model_info", "metadata"]);
  if (nestedModel) {
    const nested = extractNamedModelContext(nestedModel);
    appendUniqueStrings(context.model.ids, nested.ids);
    appendUniqueStrings(context.model.names, nested.names);
    appendUniqueStrings(context.model.aliases, nested.aliases);
  }

  if (isMarketplaceModelLikeObject(row, path)) {
    appendUniqueStrings(context.model.ids, collectStringsFromKeys(row, ["id", "key", "slug", "code"]));
    appendUniqueStrings(context.model.names, collectStringsFromKeys(row, ["name", "displayName", "display_name", "title"]));
  }

  context.site = {
    ...context.site,
    ...extractDirectMarketplaceSiteContext(row, path),
  };
  const nestedSite = firstRecordValue(row, [
    "site",
    "sites_site",
    "siteInfo",
    "site_info",
    "provider",
    "providerInfo",
    "provider_info",
    "channel",
    "channelInfo",
    "channel_info",
  ]);
  if (nestedSite) {
    context.site = mergeMarketplaceSiteContext(context.site, extractNamedMarketplaceSiteContext(nestedSite));
  }

  return context;
}

function extractNamedModelContext(row: Record<string, unknown>): MarketplaceModelContext {
  return {
    ids: collectStringsFromKeys(row, ["id", "modelId", "model_id", "key", "slug", "code"]),
    names: collectStringsFromKeys(row, ["name", "model", "modelName", "model_name", "displayName", "display_name", "title"]),
    aliases: collectStringsFromKeys(row, ["alias", "aliases", "modelAlias", "model_alias", "modelAliases", "model_aliases"]),
  };
}

function extractDirectMarketplaceSiteContext(row: Record<string, unknown>, path: string[]): MarketplaceSiteContext {
  const siteId = firstString(...collectStringsFromKeys(row, ["siteId", "site_id", "providerId", "provider_id", "channelId", "channel_id"]));
  const siteName = firstString(...collectStringsFromKeys(row, ["siteName", "site_name", "site", "providerName", "provider_name", "channelName", "channel_name"]));
  const siteUrl = firstString(...collectStringsFromKeys(row, ["siteUrl", "site_url", "siteOrigin", "site_origin", "origin", "domain", "host"]));
  const provider = firstString(...collectStringsFromKeys(row, ["provider", "providerCode", "provider_code", "source", "vendor"]));
  const platform = firstString(...collectStringsFromKeys(row, ["platform", "sitePlatform", "site_platform"]));

  const context: MarketplaceSiteContext = {};
  if (siteId) context.siteId = siteId;
  if (siteName) context.siteName = siteName;
  if (siteUrl) context.siteUrl = normalizeMarketplaceSiteUrl(siteUrl);
  if (provider) context.provider = provider;
  if (platform) context.platform = platform;

  if (isMarketplaceSiteLikeObject(row, path)) {
    const id = firstString(...collectStringsFromKeys(row, ["id", "key"]));
    const name = firstString(...collectStringsFromKeys(row, ["name", "displayName", "display_name", "title"]));
    const url = firstString(...collectStringsFromKeys(row, ["url", "baseUrl", "base_url", "endpoint", "apiBaseUrl", "api_base_url"]));
    if (!context.siteId && id) context.siteId = id;
    if (!context.siteName && name) context.siteName = name;
    if (!context.siteUrl && url) context.siteUrl = normalizeMarketplaceSiteUrl(url);
  }

  return context;
}

function extractNamedMarketplaceSiteContext(row: Record<string, unknown>): MarketplaceSiteContext {
  const direct = extractDirectMarketplaceSiteContext(row, ["site"]);
  const id = firstString(...collectStringsFromKeys(row, ["id", "siteId", "site_id", "providerId", "provider_id", "channelId", "channel_id"]));
  const name = firstString(...collectStringsFromKeys(row, ["name", "siteName", "site_name", "providerName", "provider_name", "channelName", "channel_name", "displayName", "display_name", "title"]));
  const url = firstString(...collectStringsFromKeys(row, ["url", "siteUrl", "site_url", "baseUrl", "base_url", "origin", "domain", "host"]));
  return {
    siteId: direct.siteId ?? (id || undefined),
    siteName: direct.siteName ?? (name || undefined),
    siteUrl: direct.siteUrl ?? (url ? normalizeMarketplaceSiteUrl(url) : undefined),
    provider: direct.provider,
    platform: direct.platform,
  };
}

function isMarketplaceModelLikeObject(row: Record<string, unknown>, path: string[]): boolean {
  if (hasAnyKey(row, ["modelId", "model_id", "modelName", "model_name", "model", "modelKey", "model_key"])) {
    return true;
  }
  const pathHint = lastNamedPathSegment(path);
  if (pathHint === "model" || pathHint === "models") {
    return true;
  }
  return Boolean(row.sites || row.siteList || row.site_list || row.providers || row.channels) && !hasAnyKey(row, ["siteUrl", "site_url", "siteName", "site_name", "url"]);
}

function isMarketplaceSiteLikeObject(row: Record<string, unknown>, path: string[]): boolean {
  if (hasAnyKey(row, ["siteId", "site_id", "siteName", "site_name", "siteUrl", "site_url", "providerName", "provider_name", "channelName", "channel_name"])) {
    return true;
  }
  const pathHint = lastNamedPathSegment(path);
  if (["site", "sites", "account", "accounts", "provider", "providers", "channel", "channels"].includes(pathHint)) {
    return true;
  }
  return Boolean(row.models || row.modelList || row.model_list) && hasAnyKey(row, ["url", "baseUrl", "base_url", "origin", "domain", "host", "name"]);
}

function applyMarketplaceMapKeyContext(
  context: MarketplaceTraversalContext,
  childKey: string,
  child: unknown,
  parentPath: string[],
): MarketplaceTraversalContext {
  const next = mergeMarketplaceContexts(createMarketplaceContext(), context);
  if (/^\d+$/.test(parentPath[parentPath.length - 1] ?? "")) {
    return next;
  }
  const parentKey = lastNamedPathSegment(parentPath);
  if (!isMeaningfulMarketplaceMapKey(childKey, parentKey)) {
    return next;
  }
  if (["model", "models", "modelMap", "model_map", "modelMarketplace", "model_marketplace"].includes(parentKey)) {
    appendUniqueString(next.model.ids, childKey);
    appendUniqueString(next.model.names, childKey);
  } else if (["site", "sites", "provider", "providers", "channel", "channels"].includes(parentKey)) {
    if (/^\d+$/.test(childKey)) {
      next.site.siteId = next.site.siteId ?? childKey;
    } else {
      next.site.siteName = next.site.siteName ?? childKey;
    }
  } else if (Array.isArray(child)) {
    // Common shape: { "gpt-4o": [{ site... }] } or { "站点A": [{ model... }] }.
    if (looksLikeModelIdentifier(childKey)) {
      appendUniqueString(next.model.ids, childKey);
      appendUniqueString(next.model.names, childKey);
    }
  }
  return next;
}

function matchMarketplaceEntries(
  entries: MarketplaceEntry[],
  query: string,
  matchType: MarketplaceMatchType,
): MarketplaceMatchedEntry[] {
  const normalizedQuery = normalizeMarketplaceModelText(query);
  const compactQuery = compactMarketplaceModelText(query);
  if (!normalizedQuery && !compactQuery) {
    return [];
  }
  const matches: MarketplaceMatchedEntry[] = [];
  for (const entry of entries) {
    const values = marketplaceModelCandidateValues(entry);
    const matchedValues: string[] = [];
    let confidence = 0;
    for (const value of values) {
      const normalizedValue = normalizeMarketplaceModelText(value);
      const compactValue = compactMarketplaceModelText(value);
      const exact = Boolean(normalizedValue && normalizedValue === normalizedQuery) || Boolean(compactValue && compactValue === compactQuery);
      if (matchType === "exact") {
        if (exact) {
          matchedValues.push(value);
          confidence = Math.max(confidence, 1);
        }
        continue;
      }
      if (exact) {
        if (matchType === "fuzzy") {
          continue;
        }
        matchedValues.push(value);
        confidence = Math.max(confidence, 1);
      } else if (normalizedValue.includes(normalizedQuery) || normalizedQuery.includes(normalizedValue)) {
        matchedValues.push(value);
        confidence = Math.max(confidence, 0.82);
      } else if (compactValue.includes(compactQuery) || compactQuery.includes(compactValue)) {
        matchedValues.push(value);
        confidence = Math.max(confidence, 0.78);
      } else if (allMarketplaceQueryTokensMatch(normalizedQuery, normalizedValue)) {
        matchedValues.push(value);
        confidence = Math.max(confidence, 0.7);
      }
    }
    if (matchedValues.length > 0) {
      const effectiveType: MarketplaceMatchType = confidence >= 1 ? "exact" : "fuzzy";
      if (matchType === "fuzzy" || effectiveType === "exact") {
        matches.push({
          ...entry,
          matchType: effectiveType,
          confidence,
          matchedValues: uniqueStrings(matchedValues),
        });
      }
    }
  }
  return matches.sort((left, right) => right.confidence - left.confidence || left.path.localeCompare(right.path));
}

function groupMarketplaceMatchesBySite(matches: MarketplaceMatchedEntry[], limit: number): Array<Record<string, unknown>> {
  const groups = new Map<string, MarketplaceMatchedEntry[]>();
  for (const match of matches) {
    const key = marketplaceSiteGroupKey(match.site, match.path);
    const existing = groups.get(key) ?? [];
    existing.push(match);
    groups.set(key, existing);
  }

  return Array.from(groups.values())
    .map((items) => {
      const best = items.reduce((current, item) => (item.confidence > current.confidence ? item : current), items[0]);
      const matchType: MarketplaceMatchType = items.some((item) => item.matchType === "exact") ? "exact" : "fuzzy";
      return {
        siteId: best.site.siteId ?? null,
        siteName: best.site.siteName ?? best.site.provider ?? null,
        siteUrl: best.site.siteUrl ?? null,
        provider: best.site.provider ?? null,
        platform: best.site.platform ?? null,
        matchType,
        confidence: Math.round(Math.max(...items.map((item) => item.confidence)) * 100) / 100,
        matchedValues: uniqueStrings(items.flatMap((item) => item.matchedValues)).slice(0, 12),
        models: uniqueStrings(items.flatMap((item) => marketplaceModelCandidateValues(item))).slice(0, 12),
        matchCount: items.length,
        samplePaths: items.map((item) => item.path).slice(0, 5),
      };
    })
    .sort((left, right) => {
      const leftExact = left.matchType === "exact" ? 1 : 0;
      const rightExact = right.matchType === "exact" ? 1 : 0;
      if (leftExact !== rightExact) return rightExact - leftExact;
      const confidenceDelta = Number(right.confidence) - Number(left.confidence);
      if (confidenceDelta !== 0) return confidenceDelta;
      return String(left.siteName ?? left.siteUrl ?? "").localeCompare(String(right.siteName ?? right.siteUrl ?? ""));
    })
    .slice(0, limit);
}

function buildMarketplaceGuidance(matchStatus: "exact" | "fuzzy_candidates" | "not_found"): string {
  if (matchStatus === "exact") {
    return "已按本地归一化精确匹配模型，sites 即为 marketplace 全量数据中命中的站点/渠道。";
  }
  if (matchStatus === "fuzzy_candidates") {
    return "未获得后端精确查询结果；当前只返回本地模糊候选。需要人工确认模型 ID 是否同义或版本别名一致。";
  }
  return "marketplace 全量数据中未找到该模型。建议检查模型 ID 拼写，或传 refresh=true 刷新后重试；长期应补后端精确查询 API。";
}

function hasMarketplaceModelContext(model: MarketplaceModelContext): boolean {
  return model.ids.length > 0 || model.names.length > 0 || model.aliases.length > 0;
}

function hasMarketplaceSiteContext(site: MarketplaceSiteContext): boolean {
  return Boolean(site.siteUrl || site.siteName || site.siteId || site.provider || site.platform);
}

function mergeMarketplaceContexts(
  left: MarketplaceTraversalContext,
  right: MarketplaceTraversalContext,
): MarketplaceTraversalContext {
  return {
    model: {
      ids: uniqueStrings([...left.model.ids, ...right.model.ids]),
      names: uniqueStrings([...left.model.names, ...right.model.names]),
      aliases: uniqueStrings([...left.model.aliases, ...right.model.aliases]),
    },
    site: mergeMarketplaceSiteContext(left.site, right.site),
  };
}

function mergeMarketplaceSiteContext(left: MarketplaceSiteContext, right: MarketplaceSiteContext): MarketplaceSiteContext {
  return {
    siteId: right.siteId ?? left.siteId,
    siteName: right.siteName ?? left.siteName,
    siteUrl: right.siteUrl ?? left.siteUrl,
    provider: right.provider ?? left.provider,
    platform: right.platform ?? left.platform,
  };
}

function cloneMarketplaceModelContext(model: MarketplaceModelContext): MarketplaceModelContext {
  return {
    ids: [...model.ids],
    names: [...model.names],
    aliases: [...model.aliases],
  };
}

function dedupeMarketplaceEntries(entries: MarketplaceEntry[]): MarketplaceEntry[] {
  const seen = new Set<string>();
  const unique: MarketplaceEntry[] = [];
  for (const entry of entries) {
    const key = [
      marketplaceSiteGroupKey(entry.site, entry.path),
      uniqueStrings(marketplaceModelCandidateValues(entry)).map((item) => normalizeMarketplaceModelText(item)).sort().join("|"),
      entry.path,
    ].join("::");
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    unique.push(entry);
  }
  return unique;
}

function marketplaceModelCandidateValues(entry: MarketplaceEntry): string[] {
  return uniqueStrings([...entry.model.ids, ...entry.model.names, ...entry.model.aliases]).filter(Boolean);
}

function marketplaceSiteGroupKey(site: MarketplaceSiteContext, fallback: string): string {
  if (site.siteUrl) return `url:${site.siteUrl.toLowerCase()}`;
  if (site.siteId !== undefined && site.siteId !== null) return `id:${String(site.siteId).toLowerCase()}`;
  if (site.siteName) return `name:${site.siteName.toLowerCase()}`;
  if (site.provider) return `provider:${site.provider.toLowerCase()}`;
  if (site.platform) return `platform:${site.platform.toLowerCase()}`;
  return `path:${fallback}`;
}

function normalizeMarketplaceModelText(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function compactMarketplaceModelText(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, "");
}

function allMarketplaceQueryTokensMatch(query: string, candidate: string): boolean {
  const tokens = query.split(/[\s,;/|]+/).map((item) => item.trim()).filter((item) => item.length >= 2);
  if (tokens.length < 2 || !candidate) {
    return false;
  }
  return tokens.every((token) => candidate.includes(token));
}

function looksLikeModelIdentifier(value: string): boolean {
  return /[a-z]+[-_/]?[0-9]|gpt|claude|gemini|deepseek|qwen|llama|mistral|kimi|yi-|glm|o\d/i.test(value);
}

function isMeaningfulMarketplaceMapKey(key: string, parentKey: string): boolean {
  if (/^\d+$/.test(key)) {
    return ["site", "sites", "provider", "providers", "channel", "channels"].includes(parentKey);
  }
  return !["data", "items", "results", "records", "list", "rows"].includes(key);
}

function lastNamedPathSegment(path: string[]): string {
  for (let index = path.length - 1; index >= 0; index -= 1) {
    const item = path[index];
    if (!/^\d+$/.test(item)) {
      return item;
    }
  }
  return "";
}

function firstRecordValue(row: Record<string, unknown>, keys: string[]): Record<string, unknown> | undefined {
  for (const key of keys) {
    const value = row[key];
    if (value && typeof value === "object" && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }
  }
  return undefined;
}

function collectStringsFromKeys(row: Record<string, unknown>, keys: string[]): string[] {
  const values: string[] = [];
  for (const key of keys) {
    appendUniqueStrings(values, collectStringValues(row[key]));
  }
  return values;
}

function collectStringValues(value: unknown): string[] {
  if (typeof value === "string" && value.trim()) {
    return [value.trim()];
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return [String(value)];
  }
  if (Array.isArray(value)) {
    return value.flatMap((item) => collectStringValues(item));
  }
  return [];
}

function hasAnyKey(row: Record<string, unknown>, keys: string[]): boolean {
  return keys.some((key) => row[key] !== undefined);
}

function appendUniqueStrings(target: string[], values: string[]): void {
  for (const value of values) {
    appendUniqueString(target, value);
  }
}

function appendUniqueString(target: string[], value: string): void {
  const normalized = value.trim();
  if (!normalized) {
    return;
  }
  if (!target.some((item) => item.toLowerCase() === normalized.toLowerCase())) {
    target.push(normalized);
  }
}

function uniqueStrings(values: string[]): string[] {
  const output: string[] = [];
  appendUniqueStrings(output, values);
  return output;
}

function normalizeMarketplaceSiteUrl(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }
  if (/^https?:\/\//i.test(trimmed)) {
    return normalizeSiteUrl(trimmed);
  }
  if (/^[a-z0-9.-]+(?::\d+)?$/i.test(trimmed)) {
    return trimmed.toLowerCase();
  }
  return trimmed;
}

function sanitizeMarketplaceRaw(value: unknown, depth = 0): unknown {
  if (depth > 4) {
    return "[truncated]";
  }
  if (Array.isArray(value)) {
    return value.slice(0, 20).map((item) => sanitizeMarketplaceRaw(item, depth + 1));
  }
  if (!value || typeof value !== "object") {
    return value;
  }
  const output: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (isSensitiveMetapiKey(key)) {
      output[key] = "[redacted]";
    } else {
      output[key] = sanitizeMarketplaceRaw(child, depth + 1);
    }
  }
  return output;
}

function isSensitiveMetapiKey(key: string): boolean {
  return /(token|secret|password|cookie|authorization|apikey|api_key|accesskey|access_key)/i.test(key);
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
  const enrichedCandidates: RepairCandidate[] = summary.repairCandidates.map((item) => {
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
  let status = parseBrowserCheckinStatus(args.status);
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

function parseBrowserCheckinStatus(status: unknown): BrowserCheckinStatus | undefined {
  return status === "success" || status === "failed" || status === "skipped" || status === "needs_human" ? status : undefined;
}

function inferBrowserCheckinStatus(status: BrowserCheckinStatus | undefined, message?: string): BrowserCheckinStatus | undefined {
  if (status) {
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

function prioritizeRepairCandidates<T extends RepairCandidate>(candidates: T[]): T[] {
  const failed = candidates.filter((item) => item.bucket === "failed" || item.status === "failed");
  const skipped = candidates.filter((item) => item.bucket === "skipped" || item.status === "skipped");
  const rest = candidates.filter((item) => !failed.includes(item) && !skipped.includes(item));
  const merged = [...failed, ...skipped, ...rest];
  const seen = new Set<string>();
  const unique: T[] = [];
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
