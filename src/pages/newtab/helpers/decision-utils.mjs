import {
  extractEnglishTerms,
  firstNonEmptyText,
  hasMixedLanguageTerms,
  normalizeMixedLanguageSpacing,
  normalizeTextValue,
  resolveNavigationTarget,
  uniqueTextList,
} from "./query-utils.mjs";

const IMAGE_QUERY_PATTERN = /(图片|照片|壁纸|头像|photo|image|images|pic|pics)/i;
const LEARNING_QUERY_PATTERN = /(教程|怎么|如何|guide|tutorial|learn|入门)/i;
const DOWNLOAD_QUERY_PATTERN = /(下载|download|安装|install)/i;
const IMAGE_SUFFIX_PATTERN = /(高清|超清|壁纸|图片|照片|头像|photo|image|images|pic|pics)/gi;

export const WEBSITE_RESULT_LIMIT = 4;

const extractSuggestionText = (item) => {
  if (typeof item === "string") {
    return item.trim();
  }

  if (!item || typeof item !== "object") {
    return "";
  }

  return firstNonEmptyText(
    item.query,
    item.title,
    item.text,
    item.label,
    item.name,
    item.snippet,
    item.content,
  );
};

const extractSuggestionList = (value) => {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map((item) => extractSuggestionText(item)).filter(Boolean);
};

const extractSummaryFromTextBlocks = (value) => {
  if (!Array.isArray(value)) {
    return "";
  }

  return value
    .map((item) => extractSuggestionText(item))
    .filter(Boolean)
    .slice(0, 2)
    .join(" ");
};

const sanitizeInlineText = (value) => normalizeTextValue(value).replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();

const extractHostLabel = (url) => {
  try {
    return new URL(url).hostname.replace(/^www\./i, "");
  } catch {
    return "";
  }
};

const normalizeWebsiteCandidate = (item) => {
  if (!item || typeof item !== "object") {
    return null;
  }

  const url = resolveNavigationTarget(item.url ?? item.link ?? item.href ?? item.target ?? "");
  if (!url) {
    return null;
  }

  const title = firstNonEmptyText(item.title, item.name, item.label, item.site, item.domain, extractHostLabel(url));
  const description = sanitizeInlineText(firstNonEmptyText(item.description, item.snippet, item.summary, item.abstract, item.reason, item.note));

  return {
    title,
    url,
    description,
    host: extractHostLabel(url),
  };
};

export const uniqueWebsiteCandidates = (items) => {
  const seen = new Set();
  const result = [];

  items.forEach((item) => {
    const normalized = normalizeWebsiteCandidate(item);
    if (!normalized) {
      return;
    }

    if (seen.has(normalized.url)) {
      return;
    }

    seen.add(normalized.url);
    result.push(normalized);
  });

  return result;
};

export const resolveWebsiteCandidates = (candidate) => uniqueWebsiteCandidates([
  ...(Array.isArray(candidate.websites) ? candidate.websites : []),
  ...(Array.isArray(candidate.sites) ? candidate.sites : []),
  ...(Array.isArray(candidate.candidates) ? candidate.candidates : []),
  ...(Array.isArray(candidate.results) ? candidate.results : []),
  ...(Array.isArray(candidate.references) ? candidate.references : []),
]).slice(0, WEBSITE_RESULT_LIMIT);

const inferImageSearchFallback = (query) => {
  const trimmed = query.trim();
  const topic = trimmed.replace(IMAGE_SUFFIX_PATTERN, "").trim() || trimmed;

  return {
    target: `${topic}高清图片`,
    summary: "AI 没有主动细化这次图片搜索，我已把主搜索词补成更适合找图的表达。",
    intent: "图片搜索",
    relatedQueries: uniqueTextList([
      `${topic}壁纸`,
      `可爱${topic}图片`,
      `${topic}照片`,
    ]),
  };
};

const inferLearningSearchFallback = (query) => {
  const trimmed = query.trim();

  return {
    target: trimmed.endsWith("教程") ? trimmed : `${trimmed} 教程`,
    summary: "AI 没有给出更具体的学习方向，我已补成更适合查教程和入门资料的主搜索词。",
    intent: "教程搜索",
    relatedQueries: uniqueTextList([
      `${trimmed} 入门`,
      `${trimmed} 实战`,
      `${trimmed} 示例`,
    ]),
  };
};

const inferDownloadSearchFallback = (query) => {
  const trimmed = query.trim();

  return {
    target: `${trimmed} 官网 下载`,
    summary: "AI 没有补全下载意图，我已把主搜索词改成更偏向官网和安装入口的表达。",
    intent: "下载搜索",
    relatedQueries: uniqueTextList([
      `${trimmed} 官网`,
      `${trimmed} 安装教程`,
      `${trimmed} 最新版`,
    ]),
  };
};

const inferGenericSearchFallback = (query) => {
  const trimmed = query.trim();

  return {
    target: `${trimmed} 详细介绍`,
    summary: "AI 没有给出更具体的增强结果，我已把主搜索词补成更适合信息检索的表达。",
    intent: "信息搜索",
    relatedQueries: uniqueTextList([
      `${trimmed} 是什么`,
      `${trimmed} 推荐`,
      `${trimmed} 使用方法`,
    ]),
  };
};

export const enrichNoOpSearchDecision = (decision, originalQuery) => {
  if (!decision || decision.mode !== "search") {
    return decision;
  }

  const normalizedOriginalQuery = originalQuery.trim().toLowerCase();
  const normalizedTarget = normalizeTextValue(decision.target).toLowerCase();
  const hasRicherFields = Boolean(normalizeTextValue(decision.summary) || normalizeTextValue(decision.intent) || (decision.relatedQueries ?? []).length);

  if (normalizedTarget !== normalizedOriginalQuery || hasRicherFields) {
    return decision;
  }

  const fallback = IMAGE_QUERY_PATTERN.test(originalQuery)
    ? inferImageSearchFallback(originalQuery)
    : LEARNING_QUERY_PATTERN.test(originalQuery)
      ? inferLearningSearchFallback(originalQuery)
      : DOWNLOAD_QUERY_PATTERN.test(originalQuery)
        ? inferDownloadSearchFallback(originalQuery)
        : inferGenericSearchFallback(originalQuery);

  return {
    ...decision,
    target: fallback.target,
    summary: fallback.summary,
    intent: fallback.intent,
    relatedQueries: fallback.relatedQueries,
  };
};

export const preserveMixedLanguageSearchTerms = (decision, originalQuery) => {
  if (!decision || decision.mode !== "search" || !hasMixedLanguageTerms(originalQuery)) {
    return decision;
  }

  const originalTerms = extractEnglishTerms(originalQuery);
  const refinedTerms = extractEnglishTerms(decision.target);
  const missingTerms = originalTerms.filter((term) => !refinedTerms.includes(term));

  if (!missingTerms.length) {
    return decision;
  }

  const tokenPreservingTarget = normalizeMixedLanguageSpacing(originalQuery);

  return {
    ...decision,
    target: tokenPreservingTarget || originalQuery.trim(),
    summary: `AI 的改写丢失了英文关键词 ${missingTerms.join(" / ")}，已回退为保留原始英文词面的搜索。`,
    intent: "术语保留搜索",
    relatedQueries: [],
    websites: [],
  };
};

const resolveDecisionSummary = (candidate) => firstNonEmptyText(
  candidate.summary,
  candidate.snippet,
  candidate.reasoning,
  candidate.explanation,
  candidate.answer,
  candidate.expanded_answer,
  extractSummaryFromTextBlocks(candidate.text_blocks),
);

const resolveDecisionIntent = (candidate) => firstNonEmptyText(
  candidate.intent,
  candidate.intent_label,
  candidate.search_intent,
  candidate.category,
  candidate.topic,
);

const resolveDecisionSuggestions = (candidate) => uniqueTextList([
  ...extractSuggestionList(candidate.related_queries),
  ...extractSuggestionList(candidate.relatedQueries),
  ...extractSuggestionList(candidate.suggestions),
  ...extractSuggestionList(candidate.follow_up_queries),
  ...extractSuggestionList(candidate.followUpQueries),
  ...extractSuggestionList(candidate.quick_results),
  ...extractSuggestionList(candidate.search_suggestions),
  ...extractSuggestionList(candidate.organic_word_ngrams),
]);

export const normalizeSearchDecision = (payload) => {
  const candidate = payload && typeof payload === "object" && payload.result && typeof payload.result === "object" ? payload.result : payload;

  if (!candidate || typeof candidate !== "object") {
    throw new Error("搜索接口返回格式不正确");
  }

  const mode = typeof candidate.mode === "string" ? candidate.mode.trim().toLowerCase() : "";
  const summary = resolveDecisionSummary(candidate);
  const intent = resolveDecisionIntent(candidate);
  const relatedQueries = resolveDecisionSuggestions(candidate);
  const websites = resolveWebsiteCandidates(candidate);
  const openTarget = resolveNavigationTarget(candidate.url ?? candidate.link ?? candidate.target ?? "");
  if (["open", "url", "navigate"].includes(mode) && openTarget) {
    return {
      mode: "open",
      target: openTarget,
      summary,
      intent,
      relatedQueries,
      websites,
    };
  }

  const searchTargetValue = candidate.query ?? candidate.rewritten_query ?? candidate.rewrittenQuery ?? candidate.target;
  const searchQuery = typeof searchTargetValue === "string" ? searchTargetValue.trim() : "";
  if (["search", "query"].includes(mode) && searchQuery) {
    return {
      mode: "search",
      target: searchQuery,
      summary,
      intent,
      relatedQueries,
      websites,
    };
  }

  if (openTarget) {
    return {
      mode: "open",
      target: openTarget,
      summary,
      intent,
      relatedQueries,
      websites,
    };
  }

  if (searchQuery) {
    return {
      mode: "search",
      target: searchQuery,
      summary,
      intent,
      relatedQueries,
      websites,
    };
  }

  throw new Error("搜索接口没有返回可用的 mode/url/query");
};
