import type {
  AutomationPlaybookRisk,
  AutomationPlaybookSelection,
  AutomationPlaybookSettings,
  AutomationPlaybookSource,
  ImportedAutomationPlaybook,
} from "./types";

export interface AutomationPlaybook {
  id: string;
  title: string;
  description: string;
  tags: string[];
  source: AutomationPlaybookSource;
  defaultEnabled: boolean;
  risk: AutomationPlaybookRisk;
  recommendedCapabilities: string[];
  selectionHints: string[];
  prompt: string;
}

export type SkillPlaybookImportDraft = Omit<ImportedAutomationPlaybook, "importedAt" | "updatedAt">;

export const AUTOMATION_PLAYBOOK_SETTINGS_KEY = "automationPlaybookSettings";
export const AUTOMATION_SKILL_PLAYBOOKS_KEY = "automationSkillPlaybooks";
const PLAYBOOK_SELECTION_REASON_LIMIT = 200;
const PLAYBOOK_ID_PATTERN = /^[a-z][a-z0-9_]{1,63}$/;
const VALID_RISKS = new Set<AutomationPlaybookRisk>(["low", "medium", "high", "critical"]);

const BUILTIN_AUTOMATION_PLAYBOOKS: AutomationPlaybook[] = [
  {
    id: "page_reading",
    title: "页面阅读",
    description: "阅读当前页面、提炼重点、抽取用户指定信息，并在证据不足时说明缺口。",
    tags: ["页面", "阅读", "总结", "信息提取"],
    source: "builtin",
    defaultEnabled: true,
    risk: "low",
    recommendedCapabilities: ["observe_page", "deliver_result"],
    selectionHints: ["当前页面是什么", "总结页面", "提取页面信息", "阅读网页内容"],
    prompt: [
      "任务策略：页面阅读",
      "优先使用当前受控页面作为事实来源，先观察页面标题、URL、正文结构和关键可见文本；需要完整正文、全文 HTML 或按 CSS/XPath 抽取局部内容时，优先使用 browser.extract_content。",
      "需要结构化提取时，先确认页面内容范围，再按用户要求输出字段；不要把未观察到的信息当作事实。",
      "如果页面内容不足、被截断或需要登录态以外的信息，明确标注未验证假设和需要补充的证据。",
    ].join("\n"),
  },
  {
    id: "multi_page_synthesis",
    title: "多页面汇总",
    description: "在多个已打开页面或按需新开页面之间收集信息，汇总差异、共性和证据来源。",
    tags: ["多页面", "汇总", "对比", "资料整合"],
    source: "builtin",
    defaultEnabled: true,
    risk: "medium",
    recommendedCapabilities: ["observe_page", "operate_page", "deliver_result"],
    selectionHints: ["比较多个标签页", "汇总这些页面", "打开页面后综合分析", "多来源整理"],
    prompt: [
      "任务策略：多页面汇总",
      "先使用可用标签页列表确认已有页面，不要跳过用户已经打开的页面直接新开页面。",
      "跨页面收集信息时为每个页面保留标题、URL 和核心证据摘要；需要正文或 HTML 证据时可在对应受控页面使用 browser.extract_content，结论必须能追溯到对应页面。",
      "需要新开页面时只打开普通 http/https 页面；切换页面后旧 UID 失效，继续操作前必须重新观察。",
    ].join("\n"),
  },
  {
    id: "form_interaction",
    title: "表单/交互",
    description: "填写表单、点击页面控件、检查提交前状态，并处理可见交互阻塞原因。",
    tags: ["表单", "填写", "点击", "交互"],
    source: "builtin",
    defaultEnabled: true,
    risk: "high",
    recommendedCapabilities: ["observe_page", "operate_page", "confirm_boundary"],
    selectionHints: ["帮我填写", "点击按钮", "提交前检查", "页面交互", "表单无法提交"],
    prompt: [
      "任务策略：表单/交互",
      "先观察页面结构并定位候选元素，操作前确认目标元素、字段含义和用户给出的输入值。",
      "提交、发布、删除、付款、发送消息、上传下载或跨站授权前必须遵守现有边界确认要求，不能把策略当作用户授权。",
      "交互失败时先诊断禁用、遮挡、必填项、校验文案和焦点状态，再决定是否继续尝试或请求用户确认。",
    ].join("\n"),
  },
  {
    id: "site_diagnostics",
    title: "现场诊断",
    description: "诊断页面错误、Console、资源加载、性能慢点和 Network 错误/慢请求现场。",
    tags: ["诊断", "Console", "性能", "错误", "Network"],
    source: "builtin",
    defaultEnabled: true,
    risk: "medium",
    recommendedCapabilities: ["observe_page", "analyze_site", "deliver_result"],
    selectionHints: ["页面报错", "为什么打不开", "加载很慢", "控制台错误", "现场排查"],
    prompt: [
      "任务策略：现场诊断",
      "按页面状态、Console、性能摘要、Network 错误/慢请求的顺序收集现场证据，避免只凭单一信号下结论。",
      "区分事实证据、模型推断和未验证假设；对错误堆栈、状态码、资源类型和可复现步骤分别记录。",
      "诊断工具只读时不得声称已经修复页面；如果需要操作或更高权限，必须遵守现有工具边界和用户确认。",
    ].join("\n"),
  },
  {
    id: "network_api_analysis",
    title: "Network/API 分析",
    description: "观察 Network 请求，分析接口参数、请求/响应结构，并在受控边界内做重放沙箱分析。",
    tags: ["Network", "API", "接口", "参数", "重放"],
    source: "builtin",
    defaultEnabled: true,
    risk: "high",
    recommendedCapabilities: ["observe_page", "analyze_site", "confirm_boundary"],
    selectionHints: ["分析接口", "请求参数", "接口返回", "Network 请求", "重放请求"],
    prompt: [
      "任务策略：Network/API 分析",
      "先列出相关请求并按 URL、方法、状态码、资源类型和时间线筛选候选接口，再读取必要的脱敏详情。",
      "请求体、Header、Cookie、Token 和响应体都按现有脱敏与权限边界处理；策略不能要求工具暴露未授权原文。",
      "请求重放、同源读取或完全访问能力必须经过现有运行态过滤和边界确认，不得由 Playbook 自动开启。",
    ].join("\n"),
  },
  {
    id: "source_runtime_analysis",
    title: "源码/运行时分析",
    description: "结合 JS 资源、Source Map 和运行时只读摘要定位源码线索、函数来源和页面运行态信息。",
    tags: ["源码", "运行时", "Source Map", "JS", "定位"],
    source: "builtin",
    defaultEnabled: true,
    risk: "medium",
    recommendedCapabilities: ["observe_page", "analyze_site"],
    selectionHints: ["定位源码", "找函数", "Source Map", "运行时变量", "JS 里在哪里"],
    prompt: [
      "任务策略：源码/运行时分析",
      "先从 Network/JS 资源和页面运行态只读摘要中定位候选线索，再按证据链说明来源与不确定性。",
      "Source Map 可用时优先映射到原始源码位置；不可用时保留生成代码资源、关键词和上下文片段。",
      "运行时读取只用于分析线索，不得执行任意脚本或绕过现有完全访问授权边界。",
    ].join("\n"),
  },
];

const BUILTIN_PLAYBOOK_IDS = new Set(BUILTIN_AUTOMATION_PLAYBOOKS.map((playbook) => playbook.id));

function clonePlaybook<T extends AutomationPlaybook>(playbook: T): T {
  return {
    ...playbook,
    tags: [...playbook.tags],
    recommendedCapabilities: [...playbook.recommendedCapabilities],
    selectionHints: [...playbook.selectionHints],
  };
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function readTrimmedStringField(
  source: Record<string, unknown>,
  field: string,
): { ok: true; value: string } | { ok: false; message: string } {
  const raw = source[field];
  if (!isNonEmptyString(raw)) {
    return { ok: false, message: `策略字段无效：${field}` };
  }
  return { ok: true, value: raw.trim() };
}

function readStringArrayField(
  source: Record<string, unknown>,
  field: string,
): { ok: true; value: string[] } | { ok: false; message: string } {
  const raw = source[field];
  if (raw === undefined) {
    return { ok: true, value: [] };
  }
  if (!isStringArray(raw)) {
    return { ok: false, message: `策略字段无效：${field}` };
  }
  return { ok: true, value: [...raw] };
}

function validateImportDraft(
  value: unknown,
): { ok: true; playbook: SkillPlaybookImportDraft } | { ok: false; message: string } {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, message: "策略字段无效：id" };
  }
  const source = value as Record<string, unknown>;

  const idResult = readTrimmedStringField(source, "id");
  if (!idResult.ok) {
    return idResult;
  }
  if (!PLAYBOOK_ID_PATTERN.test(idResult.value)) {
    return { ok: false, message: `策略 ID 非法：${idResult.value}` };
  }

  const titleResult = readTrimmedStringField(source, "title");
  if (!titleResult.ok) {
    return titleResult;
  }
  const descriptionResult = readTrimmedStringField(source, "description");
  if (!descriptionResult.ok) {
    return descriptionResult;
  }
  const promptResult = readTrimmedStringField(source, "prompt");
  if (!promptResult.ok) {
    return promptResult;
  }

  const tagsResult = readStringArrayField(source, "tags");
  if (!tagsResult.ok) {
    return tagsResult;
  }
  const capabilitiesResult = readStringArrayField(source, "recommendedCapabilities");
  if (!capabilitiesResult.ok) {
    return capabilitiesResult;
  }
  const hintsResult = readStringArrayField(source, "selectionHints");
  if (!hintsResult.ok) {
    return hintsResult;
  }

  const risk = source.risk;
  if (typeof risk !== "string" || !VALID_RISKS.has(risk as AutomationPlaybookRisk)) {
    return { ok: false, message: `风险等级非法：${String(risk ?? "")}` };
  }

  return {
    ok: true,
    playbook: {
      id: idResult.value,
      title: titleResult.value,
      description: descriptionResult.value,
      tags: tagsResult.value,
      source: "skill",
      defaultEnabled: true,
      risk: risk as AutomationPlaybookRisk,
      recommendedCapabilities: capabilitiesResult.value,
      selectionHints: hintsResult.value,
      prompt: promptResult.value,
    },
  };
}

function coerceStoredSkillPlaybook(value: unknown): ImportedAutomationPlaybook | undefined {
  const draft = validateImportDraft(value);
  if (!draft.ok) {
    return undefined;
  }
  const source = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const importedAt = typeof source.importedAt === "number" && Number.isFinite(source.importedAt) ? source.importedAt : 0;
  const updatedAt = typeof source.updatedAt === "number" && Number.isFinite(source.updatedAt) ? source.updatedAt : importedAt;
  return {
    ...draft.playbook,
    importedAt,
    updatedAt,
  };
}

export function getBuiltinAutomationPlaybooks(): AutomationPlaybook[] {
  return BUILTIN_AUTOMATION_PLAYBOOKS.map(clonePlaybook);
}

export function getRegisteredAutomationPlaybooks(
  skillPlaybooks: readonly AutomationPlaybook[] = [],
): AutomationPlaybook[] {
  return [
    ...getBuiltinAutomationPlaybooks(),
    ...skillPlaybooks.map((playbook) => clonePlaybook({ ...playbook, source: "skill" as const })),
  ];
}

export function getAutomationPlaybookById(
  playbookId: string,
  skillPlaybooks: readonly AutomationPlaybook[] = [],
): AutomationPlaybook | undefined {
  return getRegisteredAutomationPlaybooks(skillPlaybooks).find((item) => item.id === playbookId);
}

export function normalizeAutomationPlaybookSettings(
  value: unknown,
  knownIds?: ReadonlySet<string> | readonly string[],
): AutomationPlaybookSettings {
  const allowed = knownIds
    ? new Set(Array.from(knownIds))
    : new Set(BUILTIN_AUTOMATION_PLAYBOOKS.map((item) => item.id));

  if (!value || typeof value !== "object") {
    return { disabledPlaybookIds: [] };
  }
  const rawIds = (value as Partial<AutomationPlaybookSettings>).disabledPlaybookIds;
  if (!Array.isArray(rawIds)) {
    return { disabledPlaybookIds: [] };
  }
  return {
    disabledPlaybookIds: Array.from(
      new Set(rawIds.filter((id): id is string => typeof id === "string" && allowed.has(id))),
    ),
  };
}

export function getEnabledAutomationPlaybooks(
  settings: unknown,
  skillPlaybooks: readonly AutomationPlaybook[] = [],
): AutomationPlaybook[] {
  const registered = getRegisteredAutomationPlaybooks(skillPlaybooks);
  const knownIds = registered.map((item) => item.id);
  const normalized = normalizeAutomationPlaybookSettings(settings, knownIds);
  const disabled = new Set(normalized.disabledPlaybookIds);
  return registered.filter((item) => item.defaultEnabled && !disabled.has(item.id));
}

export function parseSkillPlaybookImportJson(
  text: string,
): { ok: true; playbooks: SkillPlaybookImportDraft[] } | { ok: false; message: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, message: "JSON 格式无效" };
  }

  if (parsed === null || (typeof parsed !== "object")) {
    return { ok: false, message: "导入内容必须是策略对象或策略数组" };
  }

  const items = Array.isArray(parsed) ? parsed : [parsed];
  if (items.length === 0) {
    return { ok: false, message: "未找到可导入的策略" };
  }

  const playbooks: SkillPlaybookImportDraft[] = [];
  const seenIds = new Set<string>();
  for (const item of items) {
    const validated = validateImportDraft(item);
    if (!validated.ok) {
      return validated;
    }
    if (seenIds.has(validated.playbook.id)) {
      return { ok: false, message: `与已导入策略 ID 冲突：${validated.playbook.id}` };
    }
    seenIds.add(validated.playbook.id);
    playbooks.push(validated.playbook);
  }
  return { ok: true, playbooks };
}

export function normalizeImportedSkillPlaybooks(value: unknown): ImportedAutomationPlaybook[] {
  let rows: unknown[] = [];
  if (Array.isArray(value)) {
    rows = value;
  } else if (value && typeof value === "object") {
    const playbooks = (value as { playbooks?: unknown }).playbooks;
    if (Array.isArray(playbooks)) {
      rows = playbooks;
    }
  }

  const normalized: ImportedAutomationPlaybook[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const playbook = coerceStoredSkillPlaybook(row);
    if (!playbook || seen.has(playbook.id) || BUILTIN_PLAYBOOK_IDS.has(playbook.id)) {
      continue;
    }
    seen.add(playbook.id);
    normalized.push(playbook);
  }
  return normalized;
}

export function mergeImportedSkillPlaybooks(
  existing: ImportedAutomationPlaybook[],
  incoming: SkillPlaybookImportDraft[],
  now: number = Date.now(),
): { ok: true; playbooks: ImportedAutomationPlaybook[] } | { ok: false; message: string } {
  const existingIds = new Set(existing.map((item) => item.id));
  const batchIds = new Set<string>();

  for (const item of incoming) {
    const id = item.id;
    if (BUILTIN_PLAYBOOK_IDS.has(id)) {
      return { ok: false, message: `与内置策略 ID 冲突：${id}` };
    }
    if (existingIds.has(id)) {
      return { ok: false, message: `与已导入策略 ID 冲突：${id}` };
    }
    if (batchIds.has(id)) {
      return { ok: false, message: `与已导入策略 ID 冲突：${id}` };
    }
    batchIds.add(id);
  }

  const appended = incoming.map((item) => ({
    ...item,
    source: "skill" as const,
    defaultEnabled: true as const,
    tags: [...item.tags],
    recommendedCapabilities: [...item.recommendedCapabilities],
    selectionHints: [...item.selectionHints],
    importedAt: now,
    updatedAt: now,
  }));

  return {
    ok: true,
    playbooks: [
      ...existing.map((item) => ({
        ...item,
        tags: [...item.tags],
        recommendedCapabilities: [...item.recommendedCapabilities],
        selectionHints: [...item.selectionHints],
      })),
      ...appended,
    ],
  };
}

export function shouldRunAutomationPlaybookSelection(userContent: string): boolean {
  const text = userContent.trim().toLowerCase();
  if (!text) {
    return false;
  }

  const hasBrowserScene = /当前页面|这个页面|此页面|页面|网页|标签页|浏览器|站点|网站|控制台|console|network|dom|html|css|xpath/.test(text);
  const hasAutomationIntent = /点击|填写|按钮|表单|提交|报错|错误|加载|总结|提取|阅读|查看|看看|排查|诊断|分析|比较|汇总|打开|切换|定位|等待|截图/.test(text);
  if (hasBrowserScene && hasAutomationIntent) {
    return true;
  }

  return /(?:分析|排查|查看|定位|提取|重放|抓包|观察|找).*(?:接口|api|请求|响应|参数|network|源码|source\s*map|runtime|运行时|javascript|js)|(?:接口|api|请求|响应|参数|network|源码|source\s*map|runtime|运行时|javascript|js).*(?:分析|排查|查看|定位|提取|重放|抓包|观察|找)/.test(text);
}

export function normalizeAutomationPlaybookSelection(
  value: unknown,
  playbooks: AutomationPlaybook[],
): AutomationPlaybookSelection | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const source = value as Partial<AutomationPlaybookSelection>;
  const playbookId = typeof source.playbookId === "string" ? source.playbookId.trim() : "";
  const playbook = playbooks.find((item) => item.id === playbookId);
  if (!playbook) {
    return undefined;
  }
  const confidence = source.confidence === "high" || source.confidence === "medium" || source.confidence === "low" ? source.confidence : "low";
  const reason = typeof source.reason === "string" && source.reason.trim() ? source.reason.trim().slice(0, PLAYBOOK_SELECTION_REASON_LIMIT) : "模型未提供选择理由";
  return {
    playbookId: playbook.id,
    title: playbook.title,
    source: playbook.source,
    confidence,
    reason,
  };
}
