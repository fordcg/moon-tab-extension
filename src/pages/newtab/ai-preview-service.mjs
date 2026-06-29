import { normalizeTextValue, resolveNavigationTarget, uniqueTextList } from "./helpers/query-utils.mjs";
import {
  WEBSITE_RESULT_LIMIT,
  enrichNoOpSearchDecision,
  normalizeSearchDecision,
  preserveMixedLanguageSearchTerms,
  resolveWebsiteCandidates,
  uniqueWebsiteCandidates,
} from "./helpers/decision-utils.mjs";
import {
  AI_REFUSAL_PATTERN,
  buildDecisionUserPrompt,
  isLikelySearchQueryText,
  looksLikeGatewayErrorPage,
  looksLikeHtmlDocument,
  parseJsonSafely,
  unwrapJsonFence,
} from "../../shared/search-ai-contract.mjs";

const DEFAULT_SEARCH_REQUEST_TIMEOUT = 15000;
const DEFAULT_TRANSIENT_RETRY_DELAYS = [450, 1100];
const DEFAULT_BING_SEARCH_ORIGIN_PATTERN = "https://www.bing.com/*";
const DEFAULT_BING_RSS_ENDPOINT = "https://www.bing.com/search?format=rss&mkt=zh-CN&q=";

const createHtmlResponseError = () => new Error("搜索接口返回了 HTML 页面，请确认填写的是 API 接口地址，而不是站点首页或后台页面。");
const createAiRefusalError = () => new Error("AI 没有返回可用的搜索决策，而是返回了说明性文本。请更换模型或稍后重试。");
const createAiDecisionFormatError = () => new Error("AI 没有返回可用的搜索决策，请更换模型或稍后重试。");

const delay = (ms) => new Promise((resolve) => globalThis.setTimeout(resolve, ms));

const parseBingRssResults = (rawText) => {
  const xml = new DOMParser().parseFromString(rawText, "application/xml");
  if (xml.querySelector("parsererror")) {
    throw new Error("网站搜索结果解析失败");
  }

  return uniqueWebsiteCandidates(
    Array.from(xml.querySelectorAll("item")).map((item) => ({
      title: item.querySelector("title")?.textContent ?? "",
      url: item.querySelector("link")?.textContent ?? "",
      description: item.querySelector("description")?.textContent ?? "",
    })),
  ).slice(0, WEBSITE_RESULT_LIMIT + 2);
};

const normalizeResponseError = (status, rawText) => {
  const payload = parseJsonSafely(rawText);
  const errorMessage = payload && typeof payload === "object"
    ? payload.error?.message ?? payload.message ?? ""
    : "";
  const preview = (errorMessage || rawText || "").trim();

  if (status >= 500 && looksLikeHtmlDocument(preview)) {
    return `搜索接口上游暂时不可用（${status}）：${looksLikeGatewayErrorPage(preview) ? "网关返回了错误页面" : "服务端返回了 HTML 错误页"}`;
  }

  if (looksLikeHtmlDocument(preview)) {
    return createHtmlResponseError().message;
  }

  if (status === 403 && /1010/.test(preview)) {
    return "搜索接口被服务端拦截（403 / error code: 1010）";
  }

  if (preview) {
    return `搜索接口请求失败（${status}）：${preview.slice(0, 200)}`;
  }

  return `搜索接口请求失败（${status}）`;
};

const extractChoiceText = (choice) => {
  if (!choice || typeof choice !== "object") {
    return "";
  }

  if (typeof choice.text === "string") {
    return choice.text;
  }

  const message = choice.message && typeof choice.message === "object" ? choice.message : null;
  const delta = choice.delta && typeof choice.delta === "object" ? choice.delta : null;
  const content = message?.content ?? delta?.content ?? "";

  if (typeof content === "string") {
    return content;
  }

  if (Array.isArray(content)) {
    return content
      .map((item) => {
        if (!item || typeof item !== "object") {
          return "";
        }

        if (typeof item.text === "string") {
          return item.text;
        }

        if (item.type === "text" && typeof item.content === "string") {
          return item.content;
        }

        return "";
      })
      .join("");
  }

  return "";
};

const extractAssistantText = (payload) => {
  if (!payload || typeof payload !== "object") {
    return "";
  }

  const firstChoice = Array.isArray(payload.choices) ? payload.choices[0] : null;
  return extractChoiceText(firstChoice).trim();
};

const normalizeAssistantDecisionText = (value) => {
  const normalizedText = unwrapJsonFence(value);
  if (looksLikeHtmlDocument(normalizedText)) {
    throw createHtmlResponseError();
  }

  if (AI_REFUSAL_PATTERN.test(normalizedText)) {
    throw createAiRefusalError();
  }

  const directPayload = parseJsonSafely(normalizedText);
  if (directPayload) {
    return normalizeSearchDecision(directPayload);
  }

  const firstBraceIndex = normalizedText.indexOf("{");
  const lastBraceIndex = normalizedText.lastIndexOf("}");
  if (firstBraceIndex !== -1 && lastBraceIndex > firstBraceIndex) {
    const embeddedPayload = parseJsonSafely(normalizedText.slice(firstBraceIndex, lastBraceIndex + 1));
    if (embeddedPayload) {
      return normalizeSearchDecision(embeddedPayload);
    }
  }

  const openTarget = resolveNavigationTarget(normalizedText);
  if (openTarget) {
    return { mode: "open", target: openTarget };
  }

  if (isLikelySearchQueryText(normalizedText)) {
    return { mode: "search", target: normalizedText };
  }

  throw createAiDecisionFormatError();
};

const normalizeChatCompletionsDecision = (payload) => {
  const assistantText = extractAssistantText(payload);
  if (!assistantText) {
    throw new Error("chat/completions 没有返回可用内容");
  }

  return normalizeAssistantDecisionText(assistantText);
};

const normalizeChatCompletionsStream = (rawText) => {
  const streamText = rawText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trim())
    .filter((line) => line && line !== "[DONE]")
    .map((line) => parseJsonSafely(line))
    .filter(Boolean)
    .map((payload) => {
      const firstChoice = Array.isArray(payload.choices) ? payload.choices[0] : null;
      return extractChoiceText(firstChoice);
    })
    .join("")
    .trim();

  if (!streamText) {
    throw new Error("chat/completions 流式返回中没有可用内容");
  }

  return normalizeAssistantDecisionText(streamText);
};

const shouldRetryTransientFailure = (status, rawText) => {
  if ([429, 500, 502, 503, 504].includes(status)) {
    return true;
  }

  const preview = rawText.toLowerCase();
  return preview.includes("upstream_error")
    || /\b429\b/.test(preview)
    || preview.includes("temporarily unavailable")
    || preview.includes("try again later");
};

const buildWebsiteSelectionPrompt = (originalQuery, refinedQuery, candidates) => [
  "你是浏览器搜索结果整理器。",
  "你会收到用户主搜索词、AI 细化搜索词，以及网页搜索返回的候选网站。",
  "只输出一个 JSON 对象，不要输出解释、markdown 或多余文本。",
  '输出格式: {"websites":[{"title":"网站标题","url":"原始候选 URL","description":"一句话说明这个网站为什么值得打开"}]}.',
  "必须只从提供的候选网站里挑选 3 到 4 个，不要编造新网址，不要修改 URL。",
  "description 必须是中文，一句话说清用户打开这个网站能得到什么。",
  `用户主搜索词: ${originalQuery}`,
  `AI 细化搜索词: ${refinedQuery}`,
  `候选网站: ${JSON.stringify(candidates)}`,
].join("\n");

export const buildAiSearchPreview = (decision, originalQuery) => {
  const normalizedOriginalQuery = originalQuery.trim().toLowerCase();
  const normalizedTarget = normalizeTextValue(decision.target).toLowerCase();
  const isQueryChanged = normalizedOriginalQuery !== normalizedTarget;
  const websites = uniqueWebsiteCandidates(decision.websites ?? []).slice(0, WEBSITE_RESULT_LIMIT);
  const relatedQueries = uniqueTextList(decision.relatedQueries ?? []).filter((query) => {
    const normalizedQuery = query.trim().toLowerCase();
    return normalizedQuery && normalizedQuery !== normalizedTarget && normalizedQuery !== normalizedOriginalQuery;
  }).slice(0, 3);

  if (decision.mode === "open") {
    return {
      originalQuery,
      intent: decision.intent,
      target: decision.target,
      refinedQuery: decision.target,
      websites,
      summary: decision.summary || "识别为可直接打开的目标。",
      targetLabel: "目标地址",
      primaryAction: {
        type: "open",
        target: decision.target,
        label: "直接打开",
      },
      secondaryAction: normalizedOriginalQuery && normalizedOriginalQuery !== normalizedTarget
        ? {
            type: "search",
            target: originalQuery,
            label: "改为搜索原词",
          }
        : null,
      relatedQueries,
      readyMessage: websites.length
        ? "方案已就绪，可直接打开或改为搜索。"
        : relatedQueries.length
          ? "方案已就绪，可直接打开或切换方向。"
          : "方案已就绪，按回车继续。",
    };
  }

  const summary = decision.summary || (websites.length
    ? "已生成细化搜索词，并附带候选网站。"
    : isQueryChanged
      ? relatedQueries.length
        ? "已将搜索词收敛，并补充了相关方向。"
        : "已将搜索词收敛为更明确的表达。"
      : relatedQueries.length
        ? "主搜索词保持不变，并补充了相关方向。"
        : "搜索词可直接使用。");

  return {
    originalQuery,
    intent: decision.intent,
    target: decision.target,
    refinedQuery: decision.target,
    websites,
    summary,
    targetLabel: isQueryChanged ? "细化搜索词" : "搜索词",
    primaryAction: {
      type: "search",
      target: decision.target,
      label: isQueryChanged ? "搜索细化词" : "搜索该词",
    },
    secondaryAction: isQueryChanged
      ? {
          type: "search",
          target: originalQuery,
          label: "搜索原词",
        }
      : null,
    relatedQueries,
    readyMessage: websites.length
      ? "方案已就绪，可直接搜索或打开候选网站。"
      : relatedQueries.length
        ? "方案已就绪，可继续搜索或切换相关词。"
        : "方案已就绪，按回车继续。",
  };
};

export const createAiPreviewService = ({ deps, config = {} }) => {
  const {
    ensureOriginPermission,
    isChatCompletionsEndpoint,
    resolveChatCompletionsEndpoint,
    resolveOriginPatternSafely,
  } = deps;
  const searchRequestTimeout = config.searchRequestTimeout ?? DEFAULT_SEARCH_REQUEST_TIMEOUT;
  const transientRetryDelays = config.transientRetryDelays ?? DEFAULT_TRANSIENT_RETRY_DELAYS;
  const bingSearchOriginPattern = config.bingSearchOriginPattern ?? DEFAULT_BING_SEARCH_ORIGIN_PATTERN;
  const bingRssEndpoint = config.bingRssEndpoint ?? DEFAULT_BING_RSS_ENDPOINT;

  const buildChatCompletionBodies = (query, settings) => [{
    model: settings.model,
    messages: [
      { role: "user", content: buildDecisionUserPrompt(query) },
    ],
    temperature: 0,
    stream: false,
  }];

  const normalizeApiDecision = (rawText, settings) => {
    const trimmed = rawText.trim();
    if (!trimmed) {
      throw new Error("搜索接口返回为空");
    }

    if (looksLikeHtmlDocument(trimmed)) {
      throw createHtmlResponseError();
    }

    const directPayload = parseJsonSafely(trimmed);
    if (directPayload) {
      if (isChatCompletionsEndpoint(settings.endpoint) && Array.isArray(directPayload.choices)) {
        return normalizeChatCompletionsDecision(directPayload);
      }

      return normalizeSearchDecision(directPayload);
    }

    if (isChatCompletionsEndpoint(settings.endpoint) && /^data:/m.test(trimmed)) {
      return normalizeChatCompletionsStream(trimmed);
    }

    return normalizeAssistantDecisionText(trimmed);
  };

  const fetchWebsiteCandidatesFromBing = async (query) => {
    await ensureOriginPermission(bingSearchOriginPattern, "未授予 Bing 搜索权限，无法获取候选网站。");

    const response = await fetch(`${bingRssEndpoint}${encodeURIComponent(query)}`, {
      headers: {
        Accept: "application/rss+xml, application/xml, text/xml;q=0.9,*/*;q=0.8",
        "X-Title": "Moon Tab",
      },
    });

    const rawText = await response.text();
    if (!response.ok) {
      throw new Error(normalizeResponseError(response.status, rawText));
    }

    return parseBingRssResults(rawText);
  };

  const requestAiWebsiteCandidates = async (originalQuery, refinedQuery, candidates, settings) => {
    if (!isChatCompletionsEndpoint(settings.endpoint) || !settings.model || !candidates.length) {
      return [];
    }

    const controller = new AbortController();
    const timeoutId = globalThis.setTimeout(() => controller.abort(), searchRequestTimeout);

    try {
      const headers = {
        "Content-Type": "application/json",
        Accept: "*/*",
        "X-Title": "Moon Tab",
      };

      if (settings.apiKey) {
        headers.Authorization = `Bearer ${settings.apiKey}`;
      }

      const response = await fetch(resolveChatCompletionsEndpoint(settings.endpoint), {
        method: "POST",
        headers,
        body: JSON.stringify({
          model: settings.model,
          messages: [{ role: "user", content: buildWebsiteSelectionPrompt(originalQuery, refinedQuery, candidates) }],
          temperature: 0,
          stream: false,
        }),
        signal: controller.signal,
      });

      const rawText = await response.text();
      if (!response.ok) {
        throw new Error(normalizeResponseError(response.status, rawText));
      }

      const assistantText = extractAssistantText(parseJsonSafely(rawText) ?? {});
      const normalizedText = unwrapJsonFence(assistantText || rawText);
      const payload = parseJsonSafely(normalizedText);
      if (!payload || typeof payload !== "object") {
        return [];
      }

      return resolveWebsiteCandidates(payload).slice(0, WEBSITE_RESULT_LIMIT);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        return [];
      }

      return [];
    } finally {
      globalThis.clearTimeout(timeoutId);
    }
  };

  const resolveDecisionWebsites = async (originalQuery, decision, settings) => {
    if (!decision || decision.mode !== "search") {
      return uniqueWebsiteCandidates(decision?.websites ?? []).slice(0, WEBSITE_RESULT_LIMIT);
    }

    const embeddedWebsites = uniqueWebsiteCandidates(decision.websites ?? []).slice(0, WEBSITE_RESULT_LIMIT);
    if (embeddedWebsites.length) {
      return embeddedWebsites;
    }

    const bingCandidates = await fetchWebsiteCandidatesFromBing(decision.target);
    const aiCandidates = await requestAiWebsiteCandidates(originalQuery, decision.target, bingCandidates, settings);
    return (aiCandidates.length ? aiCandidates : bingCandidates).slice(0, WEBSITE_RESULT_LIMIT);
  };

  const requestAiSearchDecision = async (query, settings) => {
    const controller = new AbortController();
    const timeoutId = globalThis.setTimeout(() => controller.abort(), searchRequestTimeout);

    try {
      const originPattern = resolveOriginPatternSafely(settings.endpoint, "搜索接口地址无效，请重新在设置里填写。");
      await ensureOriginPermission(originPattern, "未授予该搜索接口域名权限，无法调用 AI 搜索。");

      const headers = {
        "Content-Type": "application/json",
        Accept: "*/*",
        "X-Title": "Moon Tab",
      };

      if (settings.apiKey) {
        headers.Authorization = `Bearer ${settings.apiKey}`;
      }

      const effectiveEndpoint = isChatCompletionsEndpoint(settings.endpoint)
        ? resolveChatCompletionsEndpoint(settings.endpoint)
        : settings.endpoint;

      const requestBodies = isChatCompletionsEndpoint(settings.endpoint)
        ? buildChatCompletionBodies(query, settings)
        : [{ query }];

      let lastError = null;
      for (let index = 0; index < requestBodies.length; index += 1) {
        const requestBody = requestBodies[index];
        const transientAttempts = transientRetryDelays.length + 1;

        for (let attempt = 0; attempt < transientAttempts; attempt += 1) {
          const response = await fetch(effectiveEndpoint, {
            method: "POST",
            headers,
            body: JSON.stringify(requestBody),
            signal: controller.signal,
          });

          const rawText = await response.text();
          if (response.ok) {
            return preserveMixedLanguageSearchTerms(
              enrichNoOpSearchDecision(normalizeApiDecision(rawText, { ...settings, endpoint: effectiveEndpoint }), query),
              query,
            );
          }

          lastError = new Error(normalizeResponseError(response.status, rawText));

          const canRetryTransiently = attempt < transientRetryDelays.length && shouldRetryTransientFailure(response.status, rawText);
          if (canRetryTransiently) {
            await delay(transientRetryDelays[attempt]);
            continue;
          }

          throw lastError;
        }
      }

      if (lastError) {
        throw lastError;
      }

      throw new Error("搜索接口请求失败");
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        throw new Error("搜索接口请求超时");
      }

      throw error;
    } finally {
      globalThis.clearTimeout(timeoutId);
    }
  };

  return {
    requestAiSearchDecision,
    resolveDecisionWebsites,
  };
};
