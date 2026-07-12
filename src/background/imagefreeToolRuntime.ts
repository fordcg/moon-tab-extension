import {
  getRegisteredModelTools,
  IMAGEFREE_GENERATE_IMAGE_TOOL_ID,
  IMAGEFREE_GENERATE_IMAGE_TOOL_NAME,
} from "../shared/models/toolRegistry";
import type { ModelToolCall, ModelToolResult } from "../shared/models/types";
import { getAppSetting, getChatSessions, saveAppSetting, saveChatSession } from "../shared/storage/repositories";

export const IMAGEFREE_TOOL_ID = IMAGEFREE_GENERATE_IMAGE_TOOL_ID;
export const IMAGEFREE_TOOL_NAME = IMAGEFREE_GENERATE_IMAGE_TOOL_NAME;
export const IMAGEFREE_TOOL_SELECTION_MIGRATION_KEY = "imagefreeToolSelectionMigration.v1";

const IMAGEFREE_BASE_URL = "https://imagefree.net";
const IMAGEFREE_PAGE_URL = `${IMAGEFREE_BASE_URL}/zh`;
const IMAGEFREE_GENERATE_URL = `${IMAGEFREE_BASE_URL}/api/generate`;
const IMAGEFREE_STATUS_URL = `${IMAGEFREE_GENERATE_URL}/status`;
const IMAGEFREE_PROMPT_MAX_LENGTH = 2000;
const IMAGEFREE_POLL_INTERVAL_MS = 3000;
const IMAGEFREE_TIMEOUT_MS = 8 * 60 * 1000;
const IMAGEFREE_ASPECT_RATIOS = new Set(["1:1", "16:9", "9:16", "4:3", "3:4"]);

interface ImagefreeInput {
  prompt: string;
  aspect_ratio: string;
}

interface ImagefreeValidationResult {
  ok: boolean;
  message?: string;
  input?: ImagefreeInput;
}

declare global {
  var __imagefreeGenerateTool: ((toolCall: ModelToolCall, fetcher?: typeof fetch) => Promise<ModelToolResult>) | undefined;
}

globalThis.__imagefreeGenerateTool = executeImagefreeGenerateTool;
void migrateImagefreeToolSelection();

export function registerImagefreeTool(): void {
  hasImagefreeToolRegistered();
}

export async function migrateImagefreeToolSelection(): Promise<void> {
  try {
    if (!hasImagefreeToolRegistered()) {
      return;
    }
    if (await getAppSetting<boolean>(IMAGEFREE_TOOL_SELECTION_MIGRATION_KEY)) {
      return;
    }

    const now = Date.now();
    const chatPreferences = await getAppSetting("chatPreferences");
    const migratedChatPreferences = migrateToolSelectionObject(chatPreferences);
    if (migratedChatPreferences !== chatPreferences) {
      await saveAppSetting({
        key: "chatPreferences",
        value: migratedChatPreferences,
        updatedAt: now,
      });
    }

    const sessions = await getChatSessions();
    await Promise.all(
      sessions.map(async (session) => {
        const overrides = session.chatPreferenceOverrides;
        const migratedOverrides = migrateToolSelectionObject(overrides);
        if (migratedOverrides === overrides) {
          return;
        }
        await saveChatSession({
          ...session,
          chatPreferenceOverrides: migratedOverrides,
        });
      }),
    );

    await saveAppSetting({
      key: IMAGEFREE_TOOL_SELECTION_MIGRATION_KEY,
      value: true,
      updatedAt: now,
    });
  } catch (_error) {
  }
}

export async function executeImagefreeGenerateTool(
  toolCall: ModelToolCall,
  fetcher: typeof fetch = globalThis.fetch,
): Promise<ModelToolResult> {
  const validation = normalizeImagefreeArguments(toolCall.arguments);
  if (!validation.ok || !validation.input) {
    return imagefreeError(toolCall, validation.message ?? "Imagefree 图片生成参数无效。");
  }
  if (typeof fetcher !== "function") {
    return imagefreeError(toolCall, "当前环境缺少 fetch，无法调用 Imagefree。");
  }

  try {
    const result = await generateImagefreeImage(validation.input, fetcher);
    return {
      toolCallId: toolCall.id,
      name: toolCall.name || IMAGEFREE_TOOL_NAME,
      content: JSON.stringify(result, null, 2),
    };
  } catch (error) {
    return imagefreeError(
      toolCall,
      error instanceof Error && error.message ? error.message : "Imagefree 图片生成失败。",
    );
  }
}

function migrateToolSelectionObject<T>(value: T): T | (T & { enabledToolIds: string[] }) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return value;
  }
  const source = value as Record<string, unknown>;
  const enabledToolIds = Array.isArray(source.enabledToolIds) ? source.enabledToolIds.filter((id): id is string => typeof id === "string") : [];
  if (!shouldAppendImagefreeTool(enabledToolIds)) {
    return value;
  }
  return {
    ...value,
    enabledToolIds: [...enabledToolIds, IMAGEFREE_TOOL_ID],
  };
}

function shouldAppendImagefreeTool(enabledToolIds: string[]): boolean {
  if (enabledToolIds.includes(IMAGEFREE_TOOL_ID)) {
    return false;
  }
  const builtInIds = new Set(getRegisteredModelTools().map((tool) => tool.id));
  return enabledToolIds.some((id) => builtInIds.has(id) && id !== IMAGEFREE_TOOL_ID && !id.startsWith("browser."));
}

function hasImagefreeToolRegistered(): boolean {
  return getRegisteredModelTools().some((tool) => tool.id === IMAGEFREE_TOOL_ID);
}

function normalizeImagefreeArguments(input: Record<string, unknown>): ImagefreeValidationResult {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, message: "Imagefree 图片生成参数必须是对象。" };
  }

  const extraKeys = Object.keys(input).filter((key) => key !== "prompt" && key !== "aspect_ratio");
  if (extraKeys.length > 0) {
    return { ok: false, message: "Imagefree 图片生成只接受 prompt 和 aspect_ratio 参数。" };
  }

  const prompt = typeof input.prompt === "string" ? input.prompt.trim() : "";
  if (!prompt) {
    return { ok: false, message: "Imagefree 图片描述不能为空。" };
  }
  if (prompt.length > IMAGEFREE_PROMPT_MAX_LENGTH) {
    return { ok: false, message: `Imagefree 图片描述不能超过 ${IMAGEFREE_PROMPT_MAX_LENGTH} 字。` };
  }

  const aspectRatio = typeof input.aspect_ratio === "string" && input.aspect_ratio.trim()
    ? input.aspect_ratio.trim()
    : "1:1";
  if (!IMAGEFREE_ASPECT_RATIOS.has(aspectRatio)) {
    return {
      ok: false,
      message: `Imagefree 图片比例必须是 ${Array.from(IMAGEFREE_ASPECT_RATIOS).join("、")} 之一。`,
    };
  }

  return { ok: true, input: { prompt, aspect_ratio: aspectRatio } };
}

async function generateImagefreeImage(input: ImagefreeInput, fetcher: typeof fetch): Promise<Record<string, unknown>> {
  const task = await requestImagefreeJson(fetcher, IMAGEFREE_GENERATE_URL, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      Referer: IMAGEFREE_PAGE_URL,
    },
    body: JSON.stringify({
      prompt: input.prompt,
      aspect_ratio: input.aspect_ratio,
      turnstile_token: null,
    }),
  });

  const taskId = getStringProperty(task, "taskId").trim();
  if (!taskId) {
    throw new Error(`Imagefree 未返回 taskId：${summarizePayload(task)}`);
  }

  const statusPayload = await pollImagefreeStatus(fetcher, taskId);
  const imageUrl = findImageUrl(statusPayload);
  if (!imageUrl) {
    throw new Error(`Imagefree 任务完成但未找到图片 URL：${summarizePayload(statusPayload)}`);
  }

  return {
    ok: true,
    taskId,
    status: getStringProperty(statusPayload, "status") || "completed",
    progress: getNumberProperty(statusPayload, "progress"),
    image: imageUrl,
    imageUrl,
    prompt: input.prompt,
    aspect_ratio: input.aspect_ratio,
  };
}

async function pollImagefreeStatus(fetcher: typeof fetch, taskId: string): Promise<unknown> {
  const deadline = Date.now() + IMAGEFREE_TIMEOUT_MS;
  let latest: unknown;

  while (Date.now() < deadline) {
    latest = await requestImagefreeJson(
      fetcher,
      `${IMAGEFREE_STATUS_URL}?taskId=${encodeURIComponent(taskId)}`,
      {
        method: "GET",
        headers: {
          Accept: "application/json",
          Referer: IMAGEFREE_PAGE_URL,
        },
      },
    );

    const status = getStringProperty(latest, "status").toLowerCase();
    if (findImageUrl(latest) || (status && status !== "pending")) {
      if (status === "failed" || status === "error") {
        throw new Error(`Imagefree 任务失败：${summarizePayload(latest)}`);
      }
      return latest;
    }

    await delay(IMAGEFREE_POLL_INTERVAL_MS);
  }

  throw new Error(`Imagefree 任务超时：${summarizePayload(latest)}`);
}

async function requestImagefreeJson(
  fetcher: typeof fetch,
  url: string,
  init: RequestInit,
): Promise<unknown> {
  let response: Response;
  try {
    response = await fetcher(url, init);
  } catch (error) {
    throw new Error(`Imagefree 请求失败：${formatError(error)}`);
  }

  const text = await response.text().catch(() => "");
  const payload = parseJson(text);
  if (!response.ok) {
    throw new Error(
      `Imagefree 请求失败：${response.status} ${response.statusText}。${summarizePayload(payload ?? text)}`,
    );
  }
  if (payload !== undefined) {
    return payload;
  }
  throw new Error(`Imagefree 响应不是 JSON：${text.slice(0, 500)}`);
}

function findImageUrl(value: unknown, depth = 0): string {
  if (depth > 6 || value == null) {
    return "";
  }
  if (typeof value === "string") {
    return isImageUrl(value) ? value : "";
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findImageUrl(item, depth + 1);
      if (found) return found;
    }
    return "";
  }
  if (typeof value !== "object") {
    return "";
  }

  const source = value as Record<string, unknown>;
  for (const key of ["image", "imageUrl", "image_url", "url", "output", "result", "data"]) {
    if (Object.prototype.hasOwnProperty.call(source, key)) {
      const found = findImageUrl(source[key], depth + 1);
      if (found) return found;
    }
  }
  for (const item of Object.values(source)) {
    const found = findImageUrl(item, depth + 1);
    if (found) return found;
  }
  return "";
}

function getStringProperty(value: unknown, key: string): string {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return "";
  }
  const property = (value as Record<string, unknown>)[key];
  return typeof property === "string" ? property : "";
}

function getNumberProperty(value: unknown, key: string): number | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const property = (value as Record<string, unknown>)[key];
  return typeof property === "number" ? property : undefined;
}

function isImageUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return /^https?:$/.test(url.protocol) && (
      /\.(png|jpe?g|webp)(?:$|[?#])/i.test(url.pathname) ||
      /\.r2\.dev$/i.test(url.hostname)
    );
  } catch (_error) {
    return false;
  }
}

function parseJson(text: string): unknown {
  if (!text) return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch (_error) {
    return undefined;
  }
}

function summarizePayload(payload: unknown): string {
  if (payload === undefined) return "";
  const text = typeof payload === "string" ? payload : JSON.stringify(payload);
  return text.length <= 700 ? text : `${text.slice(0, 700)}...[已截断]`;
}

function imagefreeError(toolCall: ModelToolCall, message: string): ModelToolResult {
  return {
    toolCallId: toolCall.id,
    name: toolCall.name || IMAGEFREE_TOOL_NAME,
    content: message,
    isError: true,
  };
}

function formatError(error: unknown): string {
  return error instanceof Error && error.message ? error.message : String(error);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
