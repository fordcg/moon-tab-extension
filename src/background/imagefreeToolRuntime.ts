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
const IMAGEFREE_TURNSTILE_SITE_KEY = "0x4AAAAAACE-XLGoQUckKKm_";
const IMAGEFREE_TURNSTILE_TOKEN_TIMEOUT_MS = 2 * 60 * 1000;
const IMAGEFREE_TURNSTILE_BACKGROUND_ATTEMPT_MS = 2500;
const IMAGEFREE_TURNSTILE_TOKEN_MAX_LENGTH = 4096;
const IMAGEFREE_PROMPT_MAX_LENGTH = 2000;
const IMAGEFREE_POLL_INTERVAL_MS = 3000;
const IMAGEFREE_TIMEOUT_MS = 8 * 60 * 1000;
const IMAGEFREE_ASPECT_RATIOS = new Set(["1:1", "16:9", "9:16", "4:3", "3:4"]);

interface ImagefreeInput {
  prompt: string;
  aspect_ratio: string;
  turnstile_token: string;
}

interface ImagefreeValidationResult {
  ok: boolean;
  message?: string;
  input?: ImagefreeInput;
}

interface ImagefreeTurnstileTokenProvider {
  resolve: () => Promise<unknown> | unknown;
}

interface ImagefreeGenerateOptions {
  turnstileTokenProvider?: ImagefreeTurnstileTokenProvider;
  resolveTurnstileToken?: () => Promise<unknown> | unknown;
}

interface ChromeTabLike {
  id?: number;
  url?: string;
  status?: string;
  windowId?: number;
}

type ChromeCallbackFunction = (...args: any[]) => void;

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
  options: ImagefreeGenerateOptions = {},
): Promise<ModelToolResult> {
  const validation = normalizeImagefreeArguments(toolCall.arguments);
  if (!validation.ok || !validation.input) {
    return imagefreeError(toolCall, validation.message ?? "Imagefree 图片生成参数无效。");
  }
  if (typeof fetcher !== "function") {
    return imagefreeError(toolCall, "当前环境缺少 fetch，无法调用 Imagefree。");
  }

  try {
    const result = await generateImagefreeImage(validation.input, fetcher, options);
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

  const extraKeys = Object.keys(input).filter(
    (key) => key !== "prompt" && key !== "aspect_ratio" && key !== "turnstile_token",
  );
  if (extraKeys.length > 0) {
    return { ok: false, message: "Imagefree 图片生成只接受 prompt、aspect_ratio 和 turnstile_token 参数。" };
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

  const turnstileToken = normalizeTurnstileToken(input.turnstile_token);
  if (input.turnstile_token !== undefined && !turnstileToken) {
    return { ok: false, message: "Imagefree turnstile_token 必须是非空字符串，且不能包含空白字符。" };
  }

  return { ok: true, input: { prompt, aspect_ratio: aspectRatio, turnstile_token: turnstileToken } };
}

async function generateImagefreeImage(input: ImagefreeInput, fetcher: typeof fetch, options: ImagefreeGenerateOptions): Promise<Record<string, unknown>> {
  const turnstileToken = await resolveImagefreeTurnstileToken(input.turnstile_token, options);

  await requestImagefreeJson(fetcher, IMAGEFREE_PAGE_URL, {
    method: "GET",
    credentials: "include",
    headers: {
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    },
  }, { allowNonJson: true });

  const task = await requestImagefreeJson(fetcher, IMAGEFREE_GENERATE_URL, {
    method: "POST",
    credentials: "include",
    referrer: IMAGEFREE_PAGE_URL,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      prompt: input.prompt,
      aspect_ratio: input.aspect_ratio,
      turnstile_token: turnstileToken,
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

async function resolveImagefreeTurnstileToken(token: unknown, options: ImagefreeGenerateOptions): Promise<string> {
  const normalized = normalizeTurnstileToken(token);
  if (normalized) {
    return normalized;
  }

  const tokenProvider = createImagefreeTurnstileTokenProvider(options);
  const resolved = normalizeTurnstileToken(await tokenProvider.resolve());
  if (resolved) {
    return resolved;
  }

  throw new Error(
    "Imagefree 需要 Cloudflare Turnstile 真人验证。请在自动打开的 Imagefree 页面完成验证后重试。",
  );
}

function createImagefreeTurnstileTokenProvider(options: ImagefreeGenerateOptions): ImagefreeTurnstileTokenProvider {
  const provider = options.turnstileTokenProvider;
  if (provider && typeof provider.resolve === "function") {
    return provider;
  }
  if (typeof options.resolveTurnstileToken === "function") {
    return { resolve: options.resolveTurnstileToken };
  }
  return { resolve: requestImagefreeTurnstileTokenFromTab };
}

async function requestImagefreeTurnstileTokenFromTab(): Promise<string> {
  const chromeApi = globalThis.chrome;
  if (!chromeApi?.tabs?.query || !chromeApi.tabs.create || !chromeApi.tabs.get || !chromeApi.scripting?.executeScript) {
    throw new Error("Imagefree 需要真人验证，但当前环境无法打开 Imagefree 验证页面。");
  }

  const tab = await ensureImagefreeTurnstileTab(chromeApi);
  if (typeof tab?.id !== "number") {
    throw new Error("Imagefree 真人验证页面打开失败。");
  }

  await waitForImagefreeTabReady(chromeApi, tab.id, IMAGEFREE_TURNSTILE_TOKEN_TIMEOUT_MS);

  let focusTimer: ReturnType<typeof setTimeout> | undefined;
  let injections: chrome.scripting.InjectionResult<unknown>[] | undefined;
  try {
    focusTimer = setTimeout(() => {
      focusImagefreeTurnstileTab(chromeApi, tab).catch(() => undefined);
    }, IMAGEFREE_TURNSTILE_BACKGROUND_ATTEMPT_MS);
    injections = await chromeCall(chromeApi.scripting.executeScript, {
      target: { tabId: tab.id },
      world: "MAIN",
      args: [IMAGEFREE_TURNSTILE_SITE_KEY, IMAGEFREE_TURNSTILE_TOKEN_TIMEOUT_MS],
      func: imagefreeTurnstileTokenScript,
    }) as chrome.scripting.InjectionResult<unknown>[];
  } catch (error) {
    throw new Error(`Imagefree 真人验证注入失败：${formatError(error)}`);
  } finally {
    clearTimeout(focusTimer);
  }

  const result = Array.isArray(injections) ? injections[0]?.result : undefined;
  if (isTurnstileScriptResult(result) && result.ok && normalizeTurnstileToken(result.token)) {
    return result.token;
  }
  throw new Error(isTurnstileScriptResult(result) && result.message ? result.message : "Imagefree 真人验证未完成。");
}

async function ensureImagefreeTurnstileTab(chromeApi: typeof chrome): Promise<ChromeTabLike | undefined> {
  const tabs = await chromeCall(chromeApi.tabs.query, { url: `${IMAGEFREE_BASE_URL}/*` }).catch(() => []);
  const existing = Array.isArray(tabs)
    ? tabs.find((tab): tab is ChromeTabLike => typeof tab?.id === "number" && /^https:\/\/imagefree\.net\//i.test(tab.url || ""))
    : undefined;
  if (existing) {
    return existing;
  }
  return chromeCall(chromeApi.tabs.create, { url: IMAGEFREE_PAGE_URL, active: false }) as Promise<ChromeTabLike | undefined>;
}

async function focusImagefreeTurnstileTab(chromeApi: typeof chrome, tab: ChromeTabLike): Promise<void> {
  if (typeof tab.id !== "number" || !chromeApi.tabs.update) {
    return;
  }
  const updated = await chromeCall(chromeApi.tabs.update, tab.id, { active: true }).catch(() => undefined) as ChromeTabLike | undefined;
  const windowId = typeof updated?.windowId === "number" ? updated.windowId : tab.windowId;
  if (typeof windowId === "number" && chromeApi.windows?.update) {
    await chromeCall(chromeApi.windows.update, windowId, { focused: true }).catch(() => undefined);
  }
}

async function waitForImagefreeTabReady(chromeApi: typeof chrome, tabId: number, timeoutMs: number): Promise<void> {
  const tab = await chromeCall(chromeApi.tabs.get, tabId).then(
    (tab) => tab as ChromeTabLike | undefined,
    () => undefined,
  );
  if (tab?.status === "complete") {
    return;
  }

  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      chromeApi.tabs.onUpdated.removeListener(listener);
      error ? reject(error) : resolve();
    };
    const listener = (updatedTabId: number, changeInfo: { status?: string }) => {
      if (updatedTabId === tabId && changeInfo?.status === "complete") {
        finish();
      }
    };
    const timer = setTimeout(
      () => finish(new Error("Imagefree 真人验证页面加载超时。")),
      Math.min(timeoutMs, 30000),
    );
    chromeApi.tabs.onUpdated.addListener(listener);
  });
}

function imagefreeTurnstileTokenScript(siteKey: string, timeoutMs: number): Promise<{ ok: boolean; token?: string; message?: string }> {
  const windowWithTokenPromise = window as typeof window & {
    __moonTabImagefreeTurnstileTokenPromise?: Promise<{ ok: boolean; token?: string; message?: string }>;
    turnstile?: {
      render?: (container: Element, options: Record<string, unknown>) => unknown;
      remove?: (widgetId: unknown) => void;
    };
  };
  const existing = windowWithTokenPromise.__moonTabImagefreeTurnstileTokenPromise;
  if (existing) {
    return existing;
  }

  const promise = new Promise<{ ok: boolean; token?: string; message?: string }>((resolve) => {
    const previous = document.getElementById("moon-tab-imagefree-turnstile");
    previous?.remove();

    const host = document.createElement("div");
    host.id = "moon-tab-imagefree-turnstile";
    host.style.cssText = [
      "position:fixed",
      "inset:0",
      "z-index:2147483647",
      "display:flex",
      "align-items:center",
      "justify-content:center",
      "background:rgba(15,23,42,.58)",
      "font-family:system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif",
    ].join(";");

    const panel = document.createElement("div");
    panel.style.cssText = [
      "width:min(420px,calc(100vw - 32px))",
      "border-radius:12px",
      "background:#fff",
      "color:#111827",
      "box-shadow:0 24px 80px rgba(15,23,42,.28)",
      "padding:20px",
      "display:grid",
      "gap:14px",
      "line-height:1.5",
    ].join(";");

    const title = document.createElement("div");
    title.textContent = "Imagefree 真人验证";
    title.style.cssText = "font-size:18px;font-weight:700";

    const description = document.createElement("div");
    description.textContent = "Moon Tab 正在调用 imagefree_generate_image。请完成下方 Cloudflare 验证，验证通过后会自动继续生成图片。";
    description.style.cssText = "font-size:14px;color:#374151";

    const widget = document.createElement("div");
    widget.style.cssText = "min-height:68px;display:flex;align-items:center;justify-content:center";

    const status = document.createElement("div");
    status.textContent = "正在加载验证组件...";
    status.style.cssText = "font-size:13px;color:#6b7280";

    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.textContent = "取消";
    cancel.style.cssText = [
      "justify-self:end",
      "border:1px solid #d1d5db",
      "background:#fff",
      "color:#111827",
      "border-radius:8px",
      "padding:8px 12px",
      "cursor:pointer",
    ].join(";");

    panel.append(title, description, widget, status, cancel);
    host.append(panel);
    document.documentElement.append(host);

    let widgetId: unknown;
    let intervalId: ReturnType<typeof setInterval> | undefined;
    const cleanup = () => {
      clearInterval(intervalId);
      clearTimeout(timeoutId);
      if (widgetId !== undefined && windowWithTokenPromise.turnstile?.remove) {
        try {
          windowWithTokenPromise.turnstile.remove(widgetId);
        } catch (_error) {
        }
      }
      host.remove();
      delete windowWithTokenPromise.__moonTabImagefreeTurnstileTokenPromise;
    };
    const done = (result: { ok: boolean; token?: string; message?: string }) => {
      cleanup();
      resolve(result);
    };
    const timeoutId = setTimeout(() => {
      done({ ok: false, message: "Imagefree 真人验证超时，请重新调用工具。" });
    }, timeoutMs);

    cancel.addEventListener("click", () => {
      done({ ok: false, message: "已取消 Imagefree 真人验证。" });
    });

    const tryRender = () => {
      if (!windowWithTokenPromise.turnstile?.render) {
        return;
      }
      clearInterval(intervalId);
      status.textContent = "请完成验证...";
      try {
        widgetId = windowWithTokenPromise.turnstile.render(widget, {
          sitekey: siteKey,
          theme: "auto",
          size: "normal",
          callback: (token: string) => {
            done({ ok: true, token });
          },
          "expired-callback": () => {
            status.textContent = "验证已过期，请重新勾选。";
          },
          "error-callback": () => {
            status.textContent = "验证组件返回错误，请刷新页面后重试。";
          },
        });
      } catch (error) {
        const message = error instanceof Error && error.message ? error.message : String(error);
        done({ ok: false, message: `Imagefree 真人验证组件加载失败：${message}` });
      }
    };

    intervalId = setInterval(tryRender, 250);
    tryRender();
  });

  windowWithTokenPromise.__moonTabImagefreeTurnstileTokenPromise = promise;
  return promise;
}

function normalizeTurnstileToken(token: unknown): string {
  if (typeof token !== "string") return "";
  const value = token.trim();
  if (!value || /\s/.test(value) || value.length > IMAGEFREE_TURNSTILE_TOKEN_MAX_LENGTH) return "";
  return value;
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
        credentials: "include",
        referrer: IMAGEFREE_PAGE_URL,
        headers: { Accept: "application/json" },
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
  options: { allowNonJson?: boolean } = {},
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
    const hint = /turnstile|captcha|challenge|真人|验证|token|invalid-input-response|timeout-or-duplicate/i.test(text)
      ? "；Turnstile 验证失败或已过期，请重新调用工具完成真人验证"
      : "";
    throw new Error(
      `Imagefree 请求失败：${response.status} ${response.statusText}${hint}。${summarizePayload(payload ?? text)}`,
    );
  }
  if (payload !== undefined) {
    return payload;
  }
  if (options.allowNonJson) {
    return { ok: true };
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

function chromeCall(fn: ChromeCallbackFunction, ...args: unknown[]): Promise<unknown> {
  const chromeApi = globalThis.chrome;
  return new Promise((resolve, reject) => {
    try {
      fn(...args, (result: unknown) => {
        const lastError = chromeApi?.runtime?.lastError;
        if (lastError) {
          reject(new Error(lastError.message || "Chrome runtime 请求失败"));
          return;
        }
        resolve(result);
      });
    } catch (error) {
      reject(error);
    }
  });
}

function isTurnstileScriptResult(value: unknown): value is { ok: boolean; token: string; message?: string } {
  return Boolean(value) && typeof value === "object" && typeof (value as { ok?: unknown }).ok === "boolean";
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
