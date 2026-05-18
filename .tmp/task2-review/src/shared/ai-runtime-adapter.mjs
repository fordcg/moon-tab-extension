import {
  looksLikeHtmlDocument,
  parseJsonSafely,
} from "./search-ai-contract.mjs";

export const AI_PROTOCOL_TYPES = {
  RESPONSES: "responses",
  CHAT_COMPLETIONS: "chat_completions",
  UNSUPPORTED: "unsupported",
};

const normalizeText = (value) => (typeof value === "string" ? value.trim() : "");

const normalizePathname = (pathname) => pathname.replace(/\/+$/, "") || "/";

const buildSystemPrompt = () => "你是浏览器 AI 助手。请保持回答简洁、准确，并优先结合当前页面上下文。";

const buildUserPayload = (prompt, context) => JSON.stringify({
  prompt: normalizeText(prompt),
  context: context && typeof context === "object" ? { ...context } : {},
});

const buildRequestHeaders = (apiKey) => ({
  "Content-Type": "application/json",
  Accept: "application/json",
  "X-Title": "Moon Tab",
  Authorization: `Bearer ${normalizeText(apiKey)}`,
});

const requireApiKey = (apiKey, protocolType) => {
  if (normalizeText(apiKey)) {
    return null;
  }

  return createAiRuntimeError("api_key_required", "请先填写 API Key。", { protocolType });
};

const resolveRuntimeEndpoint = (endpoint, protocolType = detectAiProtocolType(endpoint)) => {
  const trimmedEndpoint = normalizeText(endpoint);
  if (!trimmedEndpoint) {
    return "";
  }

  const parsed = new URL(trimmedEndpoint);
  const pathname = normalizePathname(parsed.pathname);

  if (protocolType === AI_PROTOCOL_TYPES.CHAT_COMPLETIONS && (pathname === "/" || pathname === "/v1")) {
    parsed.pathname = "/v1/chat/completions";
    return parsed.toString();
  }

  return parsed.toString();
};

const normalizeContentText = (value) => {
  if (typeof value === "string") {
    return value.trim();
  }

  if (Array.isArray(value)) {
    return value
      .map((item) => {
        if (typeof item === "string") {
          return item.trim();
        }

        if (item && typeof item === "object") {
          if (typeof item.text === "string") {
            return item.text.trim();
          }

          if (typeof item.output_text === "string") {
            return item.output_text.trim();
          }
        }

        return "";
      })
      .filter(Boolean)
      .join("\n")
      .trim();
  }

  return "";
};

const resolveResponsesOutputText = (payload) => {
  if (!payload || typeof payload !== "object") {
    return "";
  }

  if (typeof payload.output_text === "string") {
    return payload.output_text.trim();
  }

  if (!Array.isArray(payload.output)) {
    return "";
  }

  const outputText = payload.output
    .flatMap((item) => {
      if (!item || typeof item !== "object") {
        return [];
      }

      if (Array.isArray(item.content)) {
        return item.content
          .map((contentItem) => {
            if (!contentItem || typeof contentItem !== "object") {
              return "";
            }

            if (typeof contentItem.text === "string") {
              return contentItem.text.trim();
            }

            return "";
          })
          .filter(Boolean);
      }

      return [];
    })
    .join("\n")
    .trim();

  return outputText;
};

const resolveChatCompletionsOutputText = (payload) => {
  if (!payload || typeof payload !== "object" || !Array.isArray(payload.choices)) {
    return "";
  }

  const firstChoice = payload.choices[0];
  if (!firstChoice || typeof firstChoice !== "object") {
    return "";
  }

  const messageContent = firstChoice.message && typeof firstChoice.message === "object"
    ? firstChoice.message.content
    : "";

  return normalizeContentText(messageContent);
};

const extractErrorPreview = (rawText) => {
  const trimmed = normalizeText(rawText);
  const parsed = parseJsonSafely(trimmed);

  if (parsed && typeof parsed === "object") {
    const errorMessage = typeof parsed.error?.message === "string"
      ? parsed.error.message.trim()
      : typeof parsed.message === "string"
        ? parsed.message.trim()
        : "";

    if (errorMessage) {
      return errorMessage;
    }
  }

  return trimmed;
};

export const detectAiProtocolType = (endpoint) => {
  const trimmedEndpoint = normalizeText(endpoint);
  if (!trimmedEndpoint) {
    return "";
  }

  try {
    const parsed = new URL(trimmedEndpoint);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return AI_PROTOCOL_TYPES.UNSUPPORTED;
    }

    const pathname = normalizePathname(parsed.pathname);
    if (/\/v1\/responses$/i.test(pathname)) {
      return AI_PROTOCOL_TYPES.RESPONSES;
    }

    if (pathname === "/" || pathname === "/v1" || /\/v1\/chat\/completions$/i.test(pathname)) {
      return AI_PROTOCOL_TYPES.CHAT_COMPLETIONS;
    }

    return AI_PROTOCOL_TYPES.UNSUPPORTED;
  } catch {
    return AI_PROTOCOL_TYPES.UNSUPPORTED;
  }
};

export const createAiRuntimeError = (code, message, details = {}) => ({
  ok: false,
  code,
  message,
  ...details,
});

export const buildAiTestRequest = (settings) => {
  const normalizedSettings = settings && typeof settings === "object" ? { ...settings } : {};
  const endpoint = normalizeText(normalizedSettings.endpoint);
  const model = normalizeText(normalizedSettings.model);
  const protocolType = detectAiProtocolType(endpoint);

  if (protocolType === AI_PROTOCOL_TYPES.UNSUPPORTED) {
    return createAiRuntimeError("unsupported_protocol", "当前版本仅支持 responses / chat.completions 接口。", { protocolType });
  }

  const apiKeyError = requireApiKey(normalizedSettings.apiKey, protocolType);
  if (apiKeyError) {
    return apiKeyError;
  }

  if (!model) {
    return createAiRuntimeError("model_required", "请先填写模型名称。", { protocolType });
  }

  const headers = buildRequestHeaders(normalizedSettings.apiKey);
  const resolvedEndpoint = resolveRuntimeEndpoint(endpoint, protocolType);
  const body = protocolType === AI_PROTOCOL_TYPES.RESPONSES
    ? {
        model,
        input: [
          {
            role: "user",
            content: [{ type: "input_text", text: "validation check" }],
          },
        ],
      }
    : {
        model,
        messages: [{ role: "user", content: "validation check" }],
        temperature: 0,
        stream: false,
      };

  return {
    ok: true,
    protocolType,
    endpoint: resolvedEndpoint,
    headers,
    body,
  };
};

export const buildAiConversationRequest = (settings, prompt, context = {}) => {
  const normalizedSettings = settings && typeof settings === "object" ? { ...settings } : {};
  const endpoint = normalizeText(normalizedSettings.endpoint);
  const model = normalizeText(normalizedSettings.model);
  const protocolType = detectAiProtocolType(endpoint);

  if (protocolType === AI_PROTOCOL_TYPES.UNSUPPORTED) {
    return createAiRuntimeError("unsupported_protocol", "当前版本仅支持 responses / chat.completions 接口。", { protocolType });
  }

  const apiKeyError = requireApiKey(normalizedSettings.apiKey, protocolType);
  if (apiKeyError) {
    return apiKeyError;
  }

  if (!model) {
    return createAiRuntimeError("model_required", "请先填写模型名称。", { protocolType });
  }

  const resolvedEndpoint = resolveRuntimeEndpoint(endpoint, protocolType);
  const headers = buildRequestHeaders(normalizedSettings.apiKey);
  const systemPrompt = buildSystemPrompt();
  const userPayload = buildUserPayload(prompt, context);
  const body = protocolType === AI_PROTOCOL_TYPES.RESPONSES
    ? {
        model,
        input: [
          {
            role: "system",
            content: [{ type: "input_text", text: systemPrompt }],
          },
          {
            role: "user",
            content: [{ type: "input_text", text: userPayload }],
          },
        ],
      }
    : {
        model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPayload },
        ],
        temperature: 0,
        stream: false,
      };

  return {
    ok: true,
    protocolType,
    endpoint: resolvedEndpoint,
    headers,
    body,
  };
};

export const parseAiRuntimeResponse = (protocolType, rawText) => {
  const trimmed = normalizeText(rawText);
  if (!trimmed) {
    return createAiRuntimeError("empty_response", "AI 接口返回为空。", { protocolType });
  }

  if (looksLikeHtmlDocument(trimmed)) {
    return createAiRuntimeError("html_response", "AI 接口返回了 HTML 页面，请确认填写的是兼容的 API 地址。", { protocolType });
  }

  const payload = parseJsonSafely(trimmed);
  if (!payload || typeof payload !== "object") {
    return createAiRuntimeError("invalid_json", "AI 接口返回不是有效 JSON。", { protocolType });
  }

  const text = protocolType === AI_PROTOCOL_TYPES.RESPONSES
    ? resolveResponsesOutputText(payload)
    : protocolType === AI_PROTOCOL_TYPES.CHAT_COMPLETIONS
      ? resolveChatCompletionsOutputText(payload)
      : "";

  if (!text) {
    return createAiRuntimeError("incompatible_response", "AI 接口返回结构不兼容当前协议。", {
      protocolType,
      payload,
    });
  }

  return {
    ok: true,
    protocolType,
    payload,
    text,
  };
};

export const normalizeAiRuntimeError = (status, rawText) => {
  const preview = extractErrorPreview(rawText);

  if (looksLikeHtmlDocument(preview)) {
    return createAiRuntimeError("html_error", `AI 接口请求失败（${status}）：服务端返回了 HTML 页面。`, { status });
  }

  if (preview) {
    return createAiRuntimeError(`http_${status}`, `AI 接口请求失败（${status}）：${preview.slice(0, 200)}`, { status });
  }

  return createAiRuntimeError(`http_${status}`, `AI 接口请求失败（${status}）。`, { status });
};
