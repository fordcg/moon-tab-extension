export const AUTOMATION_PLAYBOOK_SETTINGS_KEY = "automationPlaybookSettings";

const PLAYBOOK_SELECTION_REASON_LIMIT = 200;

const BUILTIN_AUTOMATION_PLAYBOOKS = Object.freeze([
  Object.freeze({
    id: "page_reading",
    title: "页面阅读",
    description: "阅读当前页面、提炼重点、抽取用户指定信息，并在证据不足时说明缺口。",
    tags: Object.freeze(["页面", "阅读", "总结", "信息提取"]),
    source: "builtin",
    defaultEnabled: true,
    risk: "low",
    recommendedCapabilities: Object.freeze(["observe_page", "deliver_result"]),
    selectionHints: Object.freeze(["当前页面是什么", "总结页面", "提取页面信息", "阅读网页内容"]),
    prompt: [
      "任务策略：页面阅读",
      "优先使用当前受控页面作为事实来源，先观察页面标题、URL、正文结构和关键可见文本；需要完整正文、全文 HTML 或按 CSS/XPath 抽取局部内容时，优先使用 browser.extract_content。",
      "需要结构化提取时，先确认页面内容范围，再按用户要求输出字段；不要把未观察到的信息当作事实。",
      "如果页面内容不足、被截断或需要登录态以外的信息，明确标注未验证假设和需要补充的证据。",
    ].join("\n"),
  }),
  Object.freeze({
    id: "multi_page_synthesis",
    title: "多页面汇总",
    description: "在多个已打开页面或按需新开页面之间收集信息，汇总差异、共性和证据来源。",
    tags: Object.freeze(["多页面", "汇总", "对比", "资料整合"]),
    source: "builtin",
    defaultEnabled: true,
    risk: "medium",
    recommendedCapabilities: Object.freeze(["observe_page", "operate_page", "deliver_result"]),
    selectionHints: Object.freeze(["比较多个标签页", "汇总这些页面", "打开页面后综合分析", "多来源整理"]),
    prompt: [
      "任务策略：多页面汇总",
      "先使用可用标签页列表确认已有页面，不要跳过用户已经打开的页面直接新开页面。",
      "跨页面收集信息时为每个页面保留标题、URL 和核心证据摘要；需要正文或 HTML 证据时可在对应受控页面使用 browser.extract_content，结论必须能追溯到对应页面。",
      "需要新开页面时只打开普通 http/https 页面；切换页面后旧 UID 失效，继续操作前必须重新观察。",
    ].join("\n"),
  }),
]);

const PLAYBOOK_IDS = new Set(BUILTIN_AUTOMATION_PLAYBOOKS.map((playbook) => playbook.id));

const clonePlaybook = (playbook) => ({
  ...playbook,
  tags: [...playbook.tags],
  recommendedCapabilities: [...playbook.recommendedCapabilities],
  selectionHints: [...playbook.selectionHints],
});

export function getRegisteredAutomationPlaybooks() {
  return BUILTIN_AUTOMATION_PLAYBOOKS.map(clonePlaybook);
}

export function getAutomationPlaybookById(playbookId) {
  const id = typeof playbookId === "string" ? playbookId.trim() : "";
  const playbook = BUILTIN_AUTOMATION_PLAYBOOKS.find((item) => item.id === id);
  return playbook ? clonePlaybook(playbook) : undefined;
}

export function normalizeAutomationPlaybookSettings(value) {
  const rawIds = value && typeof value === "object" && Array.isArray(value.disabledPlaybookIds)
    ? value.disabledPlaybookIds
    : [];
  return {
    disabledPlaybookIds: Array.from(new Set(rawIds.filter((id) => typeof id === "string" && PLAYBOOK_IDS.has(id)))),
  };
}

export function getEnabledAutomationPlaybooks(settings) {
  const normalized = normalizeAutomationPlaybookSettings(settings);
  const disabledIds = new Set(normalized.disabledPlaybookIds);
  return getRegisteredAutomationPlaybooks().filter((playbook) => playbook.defaultEnabled && !disabledIds.has(playbook.id));
}

export function shouldRunAutomationPlaybookSelection(userContent) {
  const text = typeof userContent === "string" ? userContent.trim().toLowerCase() : "";
  if (!text) return false;

  const hasBrowserScene = /当前页面|这个页面|此页面|页面|网页|标签页|浏览器|站点|网站|dom|html|css|xpath/.test(text);
  const hasAutomationIntent = /总结|提取|阅读|查看|看看|分析|比较|汇总|打开|切换|整理|归纳|找/.test(text);
  return hasBrowserScene && hasAutomationIntent;
}

export function createAutomationPlaybookSelectionPrompt(input) {
  const candidates = input.playbooks.map((playbook) => ({
    id: playbook.id,
    title: playbook.title,
    description: playbook.description,
    tags: playbook.tags,
    risk: playbook.risk,
    recommendedCapabilities: playbook.recommendedCapabilities,
  }));

  return [
    {
      role: "system",
      content: [
        "你是浏览器自动化任务策略预选器。只返回 JSON，不要输出 Markdown、解释或额外文本。",
        "你只能从候选 Playbook 中选择一个最适合本次用户需求的策略；如果不需要浏览器自动化策略，playbookId 返回 null。",
        '返回格式必须是：{"playbookId": string | null, "confidence": "low" | "medium" | "high", "reason": string}。',
        "不要请求工具，不要生成最终回答，不要把候选策略全文复制到 reason。",
      ].join("\n"),
    },
    {
      role: "user",
      content: [
        `用户需求：${String(input.userContent ?? "")}`,
        input.pageContextSummary?.trim() ? `页面摘要：\n${input.pageContextSummary.trim()}` : "页面摘要：无",
        `候选 Playbook：\n${JSON.stringify(candidates, null, 2)}`,
      ].join("\n\n"),
    },
  ];
}

export function parseAutomationPlaybookSelectionJson(content) {
  const text = typeof content === "string" ? content.trim() : "";
  if (!text) return undefined;
  const jsonText = extractJsonObjectText(text);
  if (!jsonText) return undefined;
  try {
    const parsed = JSON.parse(jsonText);
    if (!parsed || typeof parsed !== "object" || !Object.prototype.hasOwnProperty.call(parsed, "playbookId")) {
      return undefined;
    }
    if (parsed.playbookId !== null && typeof parsed.playbookId !== "string") {
      return undefined;
    }
    return {
      playbookId: parsed.playbookId,
      confidence: parsed.confidence,
      reason: parsed.reason,
    };
  } catch {
    return undefined;
  }
}

export function normalizeAutomationPlaybookSelection(value, playbooks) {
  if (!value || typeof value !== "object") return undefined;
  const playbookId = typeof value.playbookId === "string" ? value.playbookId.trim() : "";
  const playbook = playbooks.find((item) => item.id === playbookId);
  if (!playbook) return undefined;

  const confidence = value.confidence === "high" || value.confidence === "medium" || value.confidence === "low"
    ? value.confidence
    : "low";
  const reason = typeof value.reason === "string" && value.reason.trim()
    ? value.reason.trim().slice(0, PLAYBOOK_SELECTION_REASON_LIMIT)
    : "模型未提供选择理由";

  return {
    playbookId: playbook.id,
    title: playbook.title,
    source: playbook.source,
    confidence,
    reason,
  };
}

export function createSelectedAutomationPlaybookPrompt(selection) {
  if (!selection) return "";
  const playbook = getAutomationPlaybookById(selection.playbookId);
  if (!playbook) return "";
  return [
    `当前选中的浏览器自动化任务策略：${playbook.title}`,
    `策略来源：${selection.source}`,
    `选择置信度：${selection.confidence}`,
    `选择理由：${selection.reason}`,
    "",
    playbook.prompt,
  ].join("\n");
}

function extractJsonObjectText(text) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.trim();
  const source = fenced || text;
  const start = source.indexOf("{");
  const end = source.lastIndexOf("}");
  if (start < 0 || end <= start) return "";
  return source.slice(start, end + 1);
}
