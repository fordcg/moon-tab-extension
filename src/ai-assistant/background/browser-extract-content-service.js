import {
  createBrowserExtractContentRules,
  formatBrowserExtractContentResult,
  normalizeBrowserExtractContentArguments,
  summarizeBrowserExtractContentResult,
} from "../../shared/browser-extract-content.mjs";

export async function executeBrowserExtractContentTool(toolCall, options = {}) {
  const validation = normalizeBrowserExtractContentArguments(getRawToolArguments(toolCall));
  if (!validation.ok) {
    return createToolError(toolCall, validation.message, "invalid_arguments");
  }

  const args = validation.args;
  const extractionRulesProvider = typeof options.extractionRulesProvider === "function"
    ? options.extractionRulesProvider
    : async () => [];
  const extractPageContext = options.extractPageContext;
  if (typeof extractPageContext !== "function") {
    return createToolError(toolCall, "浏览器内容提取服务未初始化。", "extract_content_unavailable");
  }

  try {
    const savedRules = args.source === "auto_rule" ? await extractionRulesProvider() : [];
    const response = await extractPageContext({
      type: "pageContext.extract",
      tabId: options.tabId,
      rules: createBrowserExtractContentRules(args, savedRules),
      maxLength: args.maxLength,
      extractMode: args.mode === "html" ? "all" : "text",
    });
    if (!response?.ok) {
      return createToolError(toolCall, response?.message || "浏览器内容提取失败。", "extract_content_failed");
    }
    if (args.source === "selector" && response.usedFallback === true) {
      return createToolError(toolCall, "指定选择器未匹配到内容，已阻止回退为全文提取。", "selector_not_matched");
    }
    return {
      toolCallId: toolCall.id,
      name: toolCall.name,
      content: formatBrowserExtractContentResult(response, args),
      summary: summarizeBrowserExtractContentResult(response, args),
    };
  } catch (error) {
    return createToolError(
      toolCall,
      error instanceof Error && error.message ? error.message : "浏览器内容提取失败。",
      "extract_content_failed",
    );
  }
}

function createToolError(toolCall, message, code) {
  return {
    toolCallId: toolCall?.id || "",
    name: toolCall?.name || "extract_content",
    content: message,
    isError: true,
    code,
  };
}

function getRawToolArguments(toolCall) {
  if (toolCall && Object.prototype.hasOwnProperty.call(toolCall, "arguments")) {
    return toolCall.arguments;
  }
  return undefined;
}
