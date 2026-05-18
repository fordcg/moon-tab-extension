import {
  createSidebarAnswerResult,
  createSidebarMixedResult,
  createSidebarToolResult,
  SIDEBAR_ACTION_TYPES,
  SIDEBAR_RESULT_KINDS,
  truncateSidebarText,
} from "../../shared/sidebar-contract.mjs";
import {
  buildAiConversationRequest,
  normalizeAiRuntimeError,
  parseAiRuntimeResponse,
} from "../../shared/ai-runtime-adapter.mjs";
import {
  ensureOriginPermission,
  fetchWithTimeout,
  markAiRuntimeDegraded,
  resolveOriginPatternSafely,
} from "../../shared/search-settings.mjs";
import { parseJsonSafely, unwrapJsonFence } from "../../shared/search-ai-contract.mjs";

const SIDEBAR_AI_REQUEST_TIMEOUT = 10000;

const buildSidebarPrompt = (userPrompt, context, intent) => ({
  pageTitle: context?.title || "",
  pageUrl: context?.url || "",
  selectionText: truncateSidebarText(context?.selectionText || "", 1200),
  mainText: truncateSidebarText(context?.mainText || "", 6000),
  userPrompt,
  intent,
});

const buildCopyPayload = (context) => `${context?.title || ""}\n${context?.url || ""}`;

const buildFallbackAnswer = (context) => {
  const summarySource = context?.selectionText || context?.mainText || "";
  const excerpt = summarySource.slice(0, 180);
  if (!excerpt) {
    return "当前页面没有可用正文内容，我只能基于标题和链接提供帮助。";
  }

  return `当前页面《${context?.title || "未命名页面"}》主要内容可概括为：${excerpt}`;
};

const buildFallbackAnswerWithReason = (reason, context) => `${reason}\n\n${buildFallbackAnswer(context)}`;

const normalizeSidebarAiError = (status, rawText) => {
  const preview = typeof rawText === "string" ? rawText.trim() : "";
  if (preview) {
    return `侧边栏 AI 请求失败（${status}）：${preview.slice(0, 160)}`;
  }

  return `侧边栏 AI 请求失败（${status}）`;
};

const createSummaryText = (context) => {
  const summarySource = context?.selectionText || context?.mainText || "";
  const excerpt = summarySource.slice(0, 120);
  return excerpt ? `这页的要点是：${excerpt}` : buildFallbackAnswer(context);
};

const normalizeRemoteSidebarResult = (rawText, context, intentKind) => {
  const trimmed = typeof rawText === "string" ? rawText.trim() : "";
  const payload = parseJsonSafely(unwrapJsonFence(trimmed));
  if (!payload || typeof payload !== "object") {
    return createSidebarAnswerResult(trimmed || buildFallbackAnswer(context));
  }

  const kind = typeof payload.kind === "string" ? payload.kind.trim().toLowerCase() : "";
  const text = typeof payload.text === "string" && payload.text.trim() ? payload.text.trim() : trimmed;
  const action = payload.action && typeof payload.action === "object" ? payload.action : null;
  const actionType = typeof action?.type === "string" ? action.type.trim() : "";

  if (kind === SIDEBAR_RESULT_KINDS.TOOL && actionType) {
    return createSidebarToolResult(text || "我来帮你执行这个动作。", action);
  }

  if (kind === SIDEBAR_RESULT_KINDS.MIXED && actionType) {
    return createSidebarMixedResult(text || `已为你处理这个请求。\n\n${createSummaryText(context)}`, action);
  }

  if (intentKind === SIDEBAR_RESULT_KINDS.MIXED && actionType) {
    return createSidebarMixedResult(text || `已为你处理这个请求。\n\n${createSummaryText(context)}`, action);
  }

  return createSidebarAnswerResult(text || buildFallbackAnswer(context));
};

const detectLocalAction = (prompt, context, intentKind) => {
  if (/滚动.*底部|到底部/.test(prompt)) {
    return createSidebarToolResult("我来帮你滚动到页面底部。", {
      type: SIDEBAR_ACTION_TYPES.SCROLL,
      payload: { target: "bottom" },
    });
  }

  if (/滚动.*顶部|到顶部/.test(prompt)) {
    return createSidebarToolResult("我来帮你滚动到页面顶部。", {
      type: SIDEBAR_ACTION_TYPES.SCROLL,
      payload: { target: "top" },
    });
  }

  if (/复制.*标题.*链接/.test(prompt)) {
    const toolResult = createSidebarToolResult("我来帮你复制当前页面标题和链接。", {
      type: SIDEBAR_ACTION_TYPES.COPY,
      value: buildCopyPayload(context),
      reason: "已复制当前页面标题和链接。",
    });

    if (
      intentKind === SIDEBAR_RESULT_KINDS.MIXED
      || /先.*总结|先.*概括|再帮我|然后/.test(prompt)
    ) {
      return createSidebarMixedResult(`已为你总结当前页面，并复制标题和链接。\n\n${createSummaryText(context)}`, toolResult.action);
    }

    return toolResult;
  }

  if (/聚焦.*输入框|搜索框/.test(prompt)) {
    return createSidebarToolResult("我来帮你聚焦当前页输入框。", {
      type: SIDEBAR_ACTION_TYPES.FOCUS_INPUT,
    });
  }

  if (/刷新.*页面|重新加载页面/.test(prompt)) {
    return createSidebarToolResult("我来帮你刷新当前页面。", {
      type: SIDEBAR_ACTION_TYPES.REFRESH_PAGE,
    });
  }

  if (/返回上一页|后退/.test(prompt)) {
    return createSidebarToolResult("我来帮你返回上一页。", {
      type: SIDEBAR_ACTION_TYPES.GO_BACK,
    });
  }

  const pageSearchMatch = prompt.match(/(?:搜索页内|查找)(?:\s*|：|:)?(.+)/);
  if (pageSearchMatch?.[1]) {
    return createSidebarToolResult(`我来帮你在当前页查找“${pageSearchMatch[1].trim()}”。`, {
      type: SIDEBAR_ACTION_TYPES.RUN_SEARCH,
      query: pageSearchMatch[1].trim(),
    });
  }

  if (/先.*总结.*再.*复制.*标题.*链接|先.*概括.*再.*复制.*标题.*链接/.test(prompt)) {
    return createSidebarMixedResult(`已为你总结当前页面，并复制标题和链接。\n\n${createSummaryText(context)}`, {
      type: SIDEBAR_ACTION_TYPES.COPY,
      value: buildCopyPayload(context),
      reason: "已复制当前页面标题和链接。",
    });
  }

  if (/新标签页/.test(prompt)) {
    return createSidebarToolResult("我来帮你打开一个新的标签页。", {
      type: SIDEBAR_ACTION_TYPES.NEW_TAB,
      url: "about:blank",
    });
  }

  const openLink = context?.links?.find((item) => item?.url);
  if (/打开.*链接|打开.*网页/.test(prompt) && openLink?.url) {
    return createSidebarToolResult(`我来帮你打开 ${openLink.title || openLink.url}。`, {
      type: SIDEBAR_ACTION_TYPES.OPEN_LINK,
      url: openLink.url,
    });
  }

  return null;
};

const requestRemoteAnswer = async (settings, body, intentKind) => {
  const conversationRequest = buildAiConversationRequest(settings, body.userPrompt, {
    pageTitle: body.pageTitle,
    pageUrl: body.pageUrl,
    selectionText: body.selectionText,
    mainText: body.mainText,
    intentKind,
  });

  if (!conversationRequest.ok) {
    throw new Error(conversationRequest.message);
  }

  const originPattern = resolveOriginPatternSafely(conversationRequest.endpoint, "侧边栏 AI 接口地址无效，请重新在设置里填写。");
  await ensureOriginPermission(originPattern, "未授予该 AI 接口域名权限，无法调用侧边栏 AI。");

  const response = await fetchWithTimeout(conversationRequest.endpoint, {
    method: "POST",
    headers: conversationRequest.headers,
    body: JSON.stringify(conversationRequest.body),
  }, "侧边栏 AI 请求超时，请稍后重试。", SIDEBAR_AI_REQUEST_TIMEOUT);

  const rawText = await response.text();
  if (!response.ok) {
    const runtimeError = normalizeAiRuntimeError(response.status, rawText);
    throw new Error(runtimeError.message);
  }

  const parsedResponse = parseAiRuntimeResponse(conversationRequest.protocolType, rawText);
  if (!parsedResponse.ok) {
    throw new Error(parsedResponse.message);
  }

  return parsedResponse.text;
};

export const createSidebarAiController = ({ intentController, settingsReader, invalidateSettingsCache }) => ({
  resolvePrompt: async (prompt, context) => {
    const intentKind = intentController.classifyPrompt(prompt);
    const localAction = detectLocalAction(prompt, context, intentKind);
    if (localAction) {
      return localAction;
    }

    const settings = await settingsReader();
    const endpoint = typeof settings.endpoint === "string" ? settings.endpoint.trim() : "";
    const hasRemoteConfig = Boolean(endpoint && settings.model);

    if (hasRemoteConfig) {
      try {
        const remoteAnswer = await requestRemoteAnswer(settings, buildSidebarPrompt(prompt, context, intentKind), intentKind);
        return normalizeRemoteSidebarResult(remoteAnswer, context, intentKind);
      } catch (error) {
        const failureMessage = error instanceof Error ? error.message : "侧边栏远程 AI 暂时不可用。";
        await markAiRuntimeDegraded(failureMessage);
        invalidateSettingsCache?.();
        const reason = `远程 AI 暂时不可用，我先基于当前页面内容回答：${failureMessage}`;
        return createSidebarAnswerResult(buildFallbackAnswerWithReason(reason, context));
      }
    }

    if (endpoint && !settings.model) {
      return createSidebarAnswerResult(buildFallbackAnswerWithReason("当前还没有为侧边栏 AI 配置模型，我先基于当前页面内容回答。", context));
    }

    return createSidebarAnswerResult(intentKind === SIDEBAR_RESULT_KINDS.MIXED ? `已为你总结当前页面。\n\n${createSummaryText(context)}` : buildFallbackAnswer(context));
  },
});
