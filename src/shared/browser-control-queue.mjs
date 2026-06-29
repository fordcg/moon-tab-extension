import {
  DEFAULT_BROWSER_CONTROL_ACTION_TIMEOUT_MS,
  createBrowserControlToolError,
  validateBrowserControlRequest,
} from "./browser-control-contract.mjs";

export class BrowserControlActionQueue {
  #tail = Promise.resolve();
  #running = null;
  #pending = [];
  #history = [];
  #options;

  constructor(options = {}) {
    this.#options = {
      timeoutMs: options.timeoutMs || DEFAULT_BROWSER_CONTROL_ACTION_TIMEOUT_MS,
      maxHistory: Number.isInteger(options.maxHistory) ? Math.max(0, options.maxHistory) : 50,
      now: typeof options.now === "function" ? options.now : () => Date.now(),
      onEvent: typeof options.onEvent === "function" ? options.onEvent : undefined,
    };
  }

  get running() {
    return this.#running ? { ...this.#running } : null;
  }

  get pendingCount() {
    return this.#pending.length;
  }

  get history() {
    return this.#history.map((item) => ({ ...item }));
  }

  snapshot() {
    return {
      running: this.running,
      pendingCount: this.pendingCount,
      history: this.history,
    };
  }

  enqueue(toolCall, executor, context = {}) {
    const validation = validateBrowserControlRequest(toolCall);
    if (!validation.ok) {
      this.#emit("rejected", { request: validation.request, message: validation.message });
      return Promise.resolve(createBrowserControlToolError(validation.request, validation.message, "invalid_arguments"));
    }
    if (typeof executor !== "function") {
      const message = "浏览器控制队列缺少执行器。";
      this.#emit("rejected", { request: validation.request, message });
      return Promise.resolve(createBrowserControlToolError(validation.request, message, "missing_executor"));
    }

    const request = validation.request;
    const queuedAt = this.#options.now();
    const job = {
      id: request.id,
      name: request.name,
      toolId: request.toolId,
      status: "queued",
      queuedAt,
    };
    this.#pending.push(job);
    this.#emit("queued", { request, job: { ...job } });

    const run = () => this.#runJob(request, executor, context, job);
    const promise = this.#tail.then(run, run);
    this.#tail = promise.catch(() => undefined);
    return promise;
  }

  async #runJob(request, executor, context, job) {
    this.#pending = this.#pending.filter((item) => item !== job);
    const startedAt = this.#options.now();
    this.#running = {
      ...job,
      status: "running",
      startedAt,
    };
    this.#emit("started", { request, job: { ...this.#running } });

    const timeoutMs = request.timeoutMs || this.#options.timeoutMs;
    let timeoutId;
    let timedOut = false;
    const actionPromise = Promise.resolve()
      .then(() => executor(request, context))
      .catch((error) => {
        if (timedOut) {
          return undefined;
        }
        throw error;
      });
    const timeoutPromise = new Promise((resolve) => {
      timeoutId = globalThis.setTimeout(() => {
        timedOut = true;
        resolve(createBrowserControlToolError(
          request,
          `浏览器操作 ${request.name} 执行超时，请重新获取页面状态后再试。`,
          "timeout",
        ));
      }, timeoutMs);
    });

    let result;
    let status = "success";
    try {
      result = await Promise.race([actionPromise, timeoutPromise]);
      if (result?.isError || result?.ok === false) {
        status = timedOut ? "timeout" : "error";
      }
    } catch (error) {
      status = "error";
      result = createBrowserControlToolError(
        request,
        error instanceof Error && error.message ? error.message : "浏览器操作失败，请稍后重试。",
        "execution_error",
      );
    } finally {
      globalThis.clearTimeout(timeoutId);
      if (timedOut) {
        actionPromise.catch(() => undefined);
      }
    }

    const completedAt = this.#options.now();
    const record = {
      id: request.id,
      name: request.name,
      toolId: request.toolId,
      status,
      queuedAt: job.queuedAt,
      startedAt,
      completedAt,
      durationMs: Math.max(0, completedAt - startedAt),
    };
    this.#running = null;
    this.#remember(record);
    this.#emit("completed", { request, job: { ...record }, result });
    return result;
  }

  #remember(record) {
    if (this.#options.maxHistory <= 0) {
      return;
    }
    this.#history.push(record);
    if (this.#history.length > this.#options.maxHistory) {
      this.#history.splice(0, this.#history.length - this.#options.maxHistory);
    }
  }

  #emit(type, payload) {
    try {
      this.#options.onEvent?.({ type, ...payload });
    } catch {
      // 事件监听不应影响浏览器控制主流程。
    }
  }
}

export function createBrowserControlActionQueue(options) {
  return new BrowserControlActionQueue(options);
}
