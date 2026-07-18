export const MODEL_PROVIDER_HEADER_RULE_ID = 1733401;

/** Spoof extension model-provider traffic as Claude CLI client. */
export const MODEL_PROVIDER_USER_AGENT = "claude-cli/2.1.161 (external, cli)";

/**
 * Chrome 扩展发出的跨域 fetch 会自动带上 Origin: chrome-extension://...
 * 部分 OpenAI 兼容网关 / Cloudflare WAF 会直接 403。
 * 用 DNR 在请求发出前去掉 Origin/Referer，并伪装 User-Agent 为 CLI 客户端。
 */
export function createModelProviderHeaderRules(): chrome.declarativeNetRequest.Rule[] {
  return [
    {
      id: MODEL_PROVIDER_HEADER_RULE_ID,
      priority: 1,
      action: {
        type: "modifyHeaders",
        requestHeaders: [
          { header: "Origin", operation: "remove" },
          { header: "Referer", operation: "remove" },
          { header: "User-Agent", operation: "set", value: MODEL_PROVIDER_USER_AGENT },
        ],
      },
      condition: {
        // 覆盖 OpenAI chat/completions、Anthropic messages、以及模型列表探测。
        regexFilter: ".*/(v1/)?(chat/completions|messages|models)(\\?.*)?$",
        resourceTypes: ["xmlhttprequest"],
      },
    },
  ];
}

export async function installModelProviderHeaderRules(
  declarativeNetRequest: typeof chrome.declarativeNetRequest | undefined = globalThis.chrome?.declarativeNetRequest,
): Promise<void> {
  if (!declarativeNetRequest?.updateSessionRules) {
    return;
  }

  const rules = createModelProviderHeaderRules();
  try {
    await declarativeNetRequest.updateSessionRules({
      removeRuleIds: rules.map((rule) => rule.id),
      addRules: rules,
    });
  } catch (error) {
    console.warn("[model-request] 安装模型请求头清洗规则失败", {
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

export function formatModelHttpErrorMessage(status: number, statusText: string, errorBody?: string): string {
  const statusLabel = `${status}${statusText ? ` ${statusText}` : ""}`.trim();
  const bodySummary = summarizeErrorBody(errorBody);
  const base = `模型请求失败：${statusLabel}`;

  if (status === 403) {
    const hint =
      "上游拒绝了扩展发出的请求（常见于网关/WAF 拦截 chrome-extension Origin，或 API Key 权限不足）。本扩展已去掉 Origin/Referer 并将 User-Agent 伪装为 claude-cli；若 Key 在官网可用，请确认 Endpoint、模型权限与 console.x.ai 凭据。";
    return bodySummary ? `${base} — ${bodySummary}\n${hint}` : `${base}\n${hint}`;
  }

  return bodySummary ? `${base} — ${bodySummary}` : base;
}

function summarizeErrorBody(errorBody: string | undefined): string {
  if (!errorBody) {
    return "";
  }
  const compact = errorBody.replace(/\s+/g, " ").trim();
  if (!compact) {
    return "";
  }
  return compact.length > 240 ? `${compact.slice(0, 240)}…` : compact;
}
