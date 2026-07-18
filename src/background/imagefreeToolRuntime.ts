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
/** Matches imagefree.net front-end poll schedule (ms). */
const IMAGEFREE_POLL_SCHEDULE_MS = [6_000, 4_000, 10_000, 15_000, 20_000, ...Array.from({ length: 24 }, () => 30_000)];
const IMAGEFREE_TIMEOUT_MS = 8 * 60 * 1000;
const IMAGEFREE_ASPECT_RATIOS = new Set(["1:1", "16:9", "9:16", "4:3", "3:4"]);
/** Public Turnstile sitekey embedded by imagefree.net front-end. */
export const IMAGEFREE_TURNSTILE_SITE_KEY = "0x4AAAAAACE-XLGoQUckKKm_";
const IMAGEFREE_TURNSTILE_SCRIPT_URL = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
const IMAGEFREE_TAB_LOAD_TIMEOUT_MS = 30_000;
/** Allow interactive checkbox / image challenge when managed mode cannot auto-pass. */
const IMAGEFREE_TURNSTILE_TIMEOUT_MS = 180_000;
const IMAGEFREE_HUMAN_VERIFICATION_HINT =
  "Imagefree 需要 Cloudflare Turnstile 人机验证。工具会激活 imagefree.net 标签页并显示验证框；请在该页完成「请验证您是真人」后等待工具继续。不要只在别的标签页手动过一次就关闭。";

export type ImagefreeTurnstileTokenResolver = () => Promise<string>;
export type ImagefreePageGenerateRunner = (input: ImagefreeInput) => Promise<Record<string, unknown>>;

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

let imagefreeTurnstileTokenResolver: ImagefreeTurnstileTokenResolver | undefined;
let imagefreePageGenerateRunner: ImagefreePageGenerateRunner | undefined;

globalThis.__imagefreeGenerateTool = executeImagefreeGenerateTool;
void migrateImagefreeToolSelection();

export function registerImagefreeTool(): void {
  hasImagefreeToolRegistered();
}

/** Test-only override for Turnstile token acquisition. Pass undefined to restore default. */
export function setImagefreeTurnstileTokenResolverForTests(resolver?: ImagefreeTurnstileTokenResolver): void {
  imagefreeTurnstileTokenResolver = resolver;
}

/** Test-only override for full page-context generate. Pass undefined to restore default. */
export function setImagefreePageGenerateRunnerForTests(runner?: ImagefreePageGenerateRunner): void {
  imagefreePageGenerateRunner = runner;
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
  // Prefer same-origin page context: HAR shows successful generate is
  // POST /api/generate from https://imagefree.net with a real turnstile_token.
  // Service-worker fetch + synthetic headers is a weaker fingerprint.
  if (imagefreePageGenerateRunner) {
    try {
      return await imagefreePageGenerateRunner(input);
    } catch (error) {
      throw rewriteHumanVerificationError(error);
    }
  }
  if (
    !imagefreeTurnstileTokenResolver
    && typeof globalThis.chrome?.tabs?.create === "function"
    && typeof globalThis.chrome?.scripting?.executeScript === "function"
  ) {
    return generateImagefreeImageInBrowserTab(input);
  }

  // Test / fallback path: resolve token then SW fetch.
  const turnstileToken = await resolveImagefreeTurnstileToken();
  let task: unknown;
  try {
    task = await requestImagefreeJson(fetcher, IMAGEFREE_GENERATE_URL, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Origin: IMAGEFREE_BASE_URL,
        Referer: IMAGEFREE_PAGE_URL,
      },
      body: JSON.stringify({
        prompt: input.prompt,
        aspect_ratio: input.aspect_ratio,
        turnstile_token: turnstileToken,
      }),
    });
  } catch (error) {
    throw rewriteHumanVerificationError(error);
  }

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

async function resolveImagefreeTurnstileToken(): Promise<string> {
  if (imagefreeTurnstileTokenResolver) {
    const token = (await imagefreeTurnstileTokenResolver()).trim();
    if (!token) {
      throw new Error(`Imagefree Turnstile token 为空。${IMAGEFREE_HUMAN_VERIFICATION_HINT}`);
    }
    return token;
  }
  throw new Error(`无法在无浏览器标签页环境中获取 Imagefree Turnstile token。${IMAGEFREE_HUMAN_VERIFICATION_HINT}`);
}

async function generateImagefreeImageInBrowserTab(
  input: ImagefreeInput,
  chromeApi: typeof chrome | undefined = globalThis.chrome,
): Promise<Record<string, unknown>> {
  if (!chromeApi?.tabs?.create || !chromeApi?.scripting?.executeScript || !chromeApi?.tabs?.remove) {
    throw new Error(`当前环境无法自动完成 Imagefree 人机验证。${IMAGEFREE_HUMAN_VERIFICATION_HINT}`);
  }

  const opened = await openOrReuseImagefreeTab(chromeApi);
  const tabId = opened.tabId;
  let shouldCloseTab = opened.created;

  try {
    await waitForTabComplete(tabId, chromeApi, IMAGEFREE_TAB_LOAD_TIMEOUT_MS);
    // Prefer a visible tab so managed Turnstile / interactive checkbox can complete.
    try {
      await chromeApi.tabs.update(tabId, { active: true });
    } catch {
      // Background-only hosts may reject focus; continue with inactive tab.
    }
    // Let Next.js hydrate and any existing page widget settle.
    await delay(1_500);

    const injection = await chromeApi.scripting.executeScript({
      target: { tabId },
      world: "MAIN",
      func: generateImagefreeInPage,
      args: [
        {
          prompt: input.prompt,
          aspectRatio: input.aspect_ratio,
          siteKey: IMAGEFREE_TURNSTILE_SITE_KEY,
          scriptUrl: IMAGEFREE_TURNSTILE_SCRIPT_URL,
          turnstileTimeoutMs: IMAGEFREE_TURNSTILE_TIMEOUT_MS,
          pollScheduleMs: IMAGEFREE_POLL_SCHEDULE_MS,
          overallTimeoutMs: IMAGEFREE_TIMEOUT_MS,
        },
      ],
    });
    const result = injection?.[0]?.result;
    if (!result || typeof result !== "object") {
      shouldCloseTab = false;
      throw new Error(`Imagefree 页面内生成未返回结果。${IMAGEFREE_HUMAN_VERIFICATION_HINT}`);
    }
    const payload = result as Record<string, unknown>;
    if (payload.ok !== true) {
      // Keep tab for interactive captcha / diagnostics.
      shouldCloseTab = false;
      const message = typeof payload.error === "string" && payload.error.trim()
        ? payload.error.trim()
        : `Imagefree 页面内生成失败。${IMAGEFREE_HUMAN_VERIFICATION_HINT}`;
      throw rewriteHumanVerificationError(new Error(message));
    }
    return {
      ok: true,
      taskId: getStringProperty(payload, "taskId"),
      status: getStringProperty(payload, "status") || "completed",
      progress: getNumberProperty(payload, "progress"),
      image: getStringProperty(payload, "image"),
      imageUrl: getStringProperty(payload, "imageUrl") || getStringProperty(payload, "image"),
      prompt: input.prompt,
      aspect_ratio: input.aspect_ratio,
    };
  } catch (error) {
    shouldCloseTab = false;
    throw rewriteHumanVerificationError(error);
  } finally {
    if (shouldCloseTab) {
      try {
        await chromeApi.tabs.remove(tabId);
      } catch {
        // Tab may already be closed by the user.
      }
    }
  }
}

async function openOrReuseImagefreeTab(
  chromeApi: typeof chrome,
): Promise<{ tabId: number; created: boolean }> {
  try {
    const existing = await chromeApi.tabs.query({ url: ["https://imagefree.net/*", "http://imagefree.net/*"] });
    const reusable = existing.find((tab) => typeof tab.id === "number" && Boolean(tab.url && /imagefree\.net/i.test(tab.url)));
    if (reusable && typeof reusable.id === "number") {
      // Prefer Chinese page if the tab is on another locale root.
      if (reusable.url && !/\/zh(?:$|[/?#])/i.test(reusable.url) && /imagefree\.net\/?$/i.test(reusable.url.replace(/https?:\/\//, ""))) {
        await chromeApi.tabs.update(reusable.id, { url: IMAGEFREE_PAGE_URL, active: true });
      }
      return { tabId: reusable.id, created: false };
    }
  } catch {
    // Fall through to create.
  }

  const tab = await chromeApi.tabs.create({
    url: IMAGEFREE_PAGE_URL,
    active: true,
  });
  if (typeof tab.id !== "number") {
    throw new Error(`无法创建 Imagefree 验证标签页。${IMAGEFREE_HUMAN_VERIFICATION_HINT}`);
  }
  return { tabId: tab.id, created: true };
}

/**
 * Runs inside the Imagefree page MAIN world.
 * Completes Turnstile then same-origin fetch("/api/generate") + status poll.
 * Must stay self-contained: Chrome serializes this function for injection.
 */
function generateImagefreeInPage(options: {
  prompt: string;
  aspectRatio: string;
  siteKey: string;
  scriptUrl: string;
  turnstileTimeoutMs: number;
  pollScheduleMs: number[];
  overallTimeoutMs: number;
}): Promise<Record<string, unknown>> {
  const deadline = Date.now() + Math.max(30_000, options.overallTimeoutMs || 480_000);
  const turnstileDeadline = Date.now() + Math.max(5_000, options.turnstileTimeoutMs || 60_000);

  const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  const ensureScript = (): Promise<void> =>
    new Promise((scriptResolve, scriptReject) => {
      const existing = (window as unknown as { turnstile?: unknown }).turnstile;
      if (existing) {
        scriptResolve();
        return;
      }
      const prior = document.querySelector<HTMLScriptElement>('script[src*="challenges.cloudflare.com/turnstile"]');
      if (prior) {
        prior.addEventListener("load", () => scriptResolve(), { once: true });
        prior.addEventListener("error", () => scriptReject(new Error("Turnstile script load failed")), { once: true });
        // Script may already be loaded.
        if ((window as unknown as { turnstile?: unknown }).turnstile) {
          scriptResolve();
        }
        return;
      }
      const script = document.createElement("script");
      script.src = options.scriptUrl;
      script.async = true;
      script.dataset.imagefreeTurnstile = "1";
      script.onload = () => scriptResolve();
      script.onerror = () => scriptReject(new Error("Turnstile script load failed"));
      (document.head || document.documentElement).appendChild(script);
    });

  const waitForTurnstileApi = async (): Promise<{
    render: (container: HTMLElement, opts: Record<string, unknown>) => string | number;
    remove?: (id: string | number) => void;
  }> => {
    while (Date.now() < turnstileDeadline) {
      const api = (window as unknown as {
        turnstile?: {
          render: (container: HTMLElement, opts: Record<string, unknown>) => string | number;
          remove?: (id: string | number) => void;
        };
      }).turnstile;
      if (api?.render) {
        return api;
      }
      await wait(100);
    }
    throw new Error("Turnstile API unavailable");
  };

  const acquireToken = async (): Promise<string> => {
    // 1) Reuse token already present on the official page widget (user may have just verified).
    const existing = readExistingTurnstileToken();
    if (existing) {
      return existing;
    }

    await ensureScript();
    const turnstile = await waitForTurnstileApi();

    // 2) Visible widget so interactive checkbox / challenge is possible.
    const host = document.createElement("div");
    host.setAttribute("data-imagefree-turnstile-host", "1");
    host.style.cssText =
      "position:fixed;right:16px;bottom:16px;width:320px;min-height:70px;padding:10px;border-radius:12px;" +
      "background:rgba(15,23,42,0.92);color:#fff;z-index:2147483647;box-shadow:0 8px 30px rgba(0,0,0,.35);" +
      "font:12px/1.4 system-ui,sans-serif;";
    host.innerHTML =
      '<div style="margin-bottom:8px;font-weight:600;">Imagefree 人机验证</div>' +
      '<div style="margin-bottom:8px;opacity:.85;">请完成下方验证；通过后会自动继续生成。</div>';
    const mount = document.createElement("div");
    host.appendChild(mount);
    document.documentElement.appendChild(host);

    return new Promise((resolve, reject) => {
      let settled = false;
      let widgetId: string | number | null = null;
      const finish = (error?: Error, token?: string) => {
        if (settled) {
          return;
        }
        settled = true;
        try {
          if (widgetId != null && turnstile.remove) {
            turnstile.remove(widgetId);
          }
        } catch {
          // ignore
        }
        host.remove();
        if (error) {
          reject(error);
          return;
        }
        if (!token) {
          reject(new Error("Turnstile token empty"));
          return;
        }
        resolve(token);
      };

      try {
        widgetId = turnstile.render(mount, {
          sitekey: options.siteKey,
          theme: "auto",
          size: "normal",
          callback: (token: string) => finish(undefined, token),
          "error-callback": () => finish(new Error("Turnstile error-callback")),
          "expired-callback": () => finish(new Error("Turnstile expired")),
          "timeout-callback": () => finish(new Error("Turnstile timeout-callback")),
        });
      } catch (error) {
        finish(error instanceof Error ? error : new Error(String(error)));
        return;
      }

      void (async () => {
        while (!settled && Date.now() < turnstileDeadline) {
          // Keep polling official page inputs in case user verifies the site widget instead.
          const reused = readExistingTurnstileToken();
          if (reused) {
            finish(undefined, reused);
            return;
          }
          try {
            const api = turnstile as {
              getResponse?: (id?: string | number) => string | undefined;
            };
            const response = api.getResponse?.(widgetId ?? undefined);
            if (typeof response === "string" && response.trim().length > 20) {
              finish(undefined, response.trim());
              return;
            }
          } catch {
            // ignore
          }
          await wait(400);
        }
        if (!settled) {
          finish(
            new Error(
              "Turnstile token wait timed out. 请在当前 imagefree.net 标签页完成验证后重试。",
            ),
          );
        }
      })();
    });
  };

  const readExistingTurnstileToken = (): string => {
    const selectors = [
      'textarea[name="cf-turnstile-response"]',
      'input[name="cf-turnstile-response"]',
      '[name="cf-turnstile-response"]',
      "textarea[id^=\"cf-chl-widget\"]",
    ];
    for (const selector of selectors) {
      const nodes = Array.from(document.querySelectorAll(selector));
      for (const node of nodes) {
        const value =
          (node as HTMLInputElement | HTMLTextAreaElement).value ||
          node.getAttribute("value") ||
          node.textContent ||
          "";
        const token = String(value).trim();
        if (token.length > 20) {
          return token;
        }
      }
    }
    return "";
  };

  const pollStatus = async (taskId: string): Promise<Record<string, unknown>> => {
    const schedule = Array.isArray(options.pollScheduleMs) && options.pollScheduleMs.length
      ? options.pollScheduleMs
      : [6_000, 4_000, 10_000, 15_000, 20_000, 30_000];
    let attempt = 0;
    while (Date.now() < deadline) {
      const response = await fetch(`/api/generate/status?taskId=${encodeURIComponent(taskId)}`, {
        method: "GET",
        credentials: "include",
        headers: { Accept: "application/json" },
      });
      const payload = (await response.json().catch(() => null)) as Record<string, unknown> | null;
      if (!response.ok) {
        throw new Error(`status ${response.status}: ${JSON.stringify(payload ?? {})}`);
      }
      if (!payload) {
        throw new Error("status response is not JSON");
      }
      if (typeof payload.error === "string" && payload.error) {
        throw new Error(payload.error);
      }
      const status = String(payload.status || "").toLowerCase();
      const image = typeof payload.image === "string" ? payload.image : "";
      if (image || status === "completed") {
        return payload;
      }
      if (status === "failed" || status === "error") {
        throw new Error(`task failed: ${JSON.stringify(payload)}`);
      }
      const waitMs = schedule[Math.min(attempt, schedule.length - 1)] ?? 30_000;
      attempt += 1;
      await wait(waitMs);
    }
    throw new Error("Imagefree poll timed out");
  };

  return (async () => {
    try {
      const token = await acquireToken();
      const generateResponse = await fetch("/api/generate", {
        method: "POST",
        credentials: "include",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          prompt: options.prompt,
          aspect_ratio: options.aspectRatio,
          turnstile_token: token,
        }),
      });
      const generatePayload = (await generateResponse.json().catch(() => null)) as Record<string, unknown> | null;
      if (!generateResponse.ok) {
        const message =
          (generatePayload && typeof generatePayload.error === "string" && generatePayload.error) ||
          `generate failed: ${generateResponse.status}`;
        return { ok: false, error: message };
      }
      if (!generatePayload) {
        return { ok: false, error: "generate response is not JSON" };
      }
      if (typeof generatePayload.error === "string" && generatePayload.error) {
        return { ok: false, error: generatePayload.error };
      }
      const taskId = typeof generatePayload.taskId === "string" ? generatePayload.taskId : "";
      if (!taskId) {
        return { ok: false, error: `missing taskId: ${JSON.stringify(generatePayload)}` };
      }
      const statusPayload = await pollStatus(taskId);
      const image = typeof statusPayload.image === "string" ? statusPayload.image : "";
      if (!image) {
        return { ok: false, error: `completed without image: ${JSON.stringify(statusPayload)}` };
      }
      return {
        ok: true,
        taskId,
        status: statusPayload.status || "completed",
        progress: statusPayload.progress,
        image,
        imageUrl: image,
      };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error && error.message ? error.message : String(error),
      };
    }
  })();
}

function waitForTabComplete(
  tabId: number,
  chromeApi: typeof chrome,
  timeoutMs: number,
): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      chromeApi.tabs.onUpdated.removeListener(onUpdated);
      if (error) {
        reject(error);
        return;
      }
      resolve();
    };

    const onUpdated = (updatedTabId: number, changeInfo: { status?: string }) => {
      if (updatedTabId === tabId && changeInfo.status === "complete") {
        finish();
      }
    };

    const timer = setTimeout(() => {
      finish(new Error("Imagefree 页面加载超时"));
    }, timeoutMs);

    chromeApi.tabs.onUpdated.addListener(onUpdated);
    void chromeApi.tabs
      .get(tabId)
      .then((tab) => {
        if (tab.status === "complete") {
          finish();
        }
      })
      .catch((error) => {
        finish(error instanceof Error ? error : new Error(String(error)));
      });
  });
}

function rewriteHumanVerificationError(error: unknown): Error {
  const message = formatError(error);
  if (/Human verification failed|turnstile|人机验证/i.test(message)) {
    return new Error(`${message} ${IMAGEFREE_HUMAN_VERIFICATION_HINT}`);
  }
  return error instanceof Error ? error : new Error(message);
}

async function pollImagefreeStatus(fetcher: typeof fetch, taskId: string): Promise<unknown> {
  const deadline = Date.now() + IMAGEFREE_TIMEOUT_MS;
  let latest: unknown;
  let attempt = 0;

  while (Date.now() < deadline) {
    latest = await requestImagefreeJson(
      fetcher,
      `${IMAGEFREE_STATUS_URL}?taskId=${encodeURIComponent(taskId)}`,
      {
        method: "GET",
        headers: {
          Accept: "application/json",
          Origin: IMAGEFREE_BASE_URL,
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

    const waitMs = IMAGEFREE_POLL_SCHEDULE_MS[Math.min(attempt, IMAGEFREE_POLL_SCHEDULE_MS.length - 1)] ?? 30_000;
    attempt += 1;
    await delay(waitMs);
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
