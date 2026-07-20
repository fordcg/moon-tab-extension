export const EXTENSION_CONTEXT_INVALIDATED_MESSAGE = "扩展已更新，请重新打开侧边栏后重试";

export function isExtensionContextInvalidatedError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return /extension context invalidated/i.test(message);
}

export function resolveRuntimeErrorMessage(error: unknown, fallback = "插件后台请求失败"): string {
  if (isExtensionContextInvalidatedError(error)) {
    return EXTENSION_CONTEXT_INVALIDATED_MESSAGE;
  }
  return error instanceof Error && error.message ? error.message : fallback;
}

export async function sendRuntimeMessage<T>(message: unknown): Promise<T> {
  let runtime: typeof chrome.runtime | undefined;
  try {
    runtime = globalThis.chrome?.runtime;
  } catch (error) {
    return createFailureResponse<T>(resolveRuntimeErrorMessage(error));
  }

  if (!runtime?.sendMessage) {
    return createFailureResponse<T>("当前环境不支持插件后台请求");
  }

  return new Promise<T>((resolve) => {
    let settled = false;
    const finish = (response: T) => {
      if (settled) {
        return;
      }

      settled = true;
      resolve(response);
    };

    try {
      // 兼容 Chrome 回调形态与测试环境中的 Promise 形态，避免不同运行时丢失 lastError。
      const maybePromise = runtime.sendMessage(message, (response: T) => {
        const runtimeError = readRuntimeLastErrorMessage(runtime);
        if (runtimeError) {
          finish(createFailureResponse<T>(runtimeError));
          return;
        }

        finish(response);
      }) as Promise<T> | undefined;

      if (maybePromise && typeof maybePromise.then === "function") {
        void maybePromise.then(finish).catch((error) => {
          finish(createFailureResponse<T>(resolveRuntimeErrorMessage(error)));
        });
      }
    } catch (error) {
      finish(createFailureResponse<T>(resolveRuntimeErrorMessage(error)));
    }
  });
}

function readRuntimeLastErrorMessage(runtime: typeof chrome.runtime): string | undefined {
  try {
    const message = runtime.lastError?.message;
    return message ? resolveRuntimeErrorMessage(new Error(message)) : undefined;
  } catch (error) {
    return resolveRuntimeErrorMessage(error);
  }
}

function createFailureResponse<T>(message: string): T {
  return {
    ok: false,
    message,
  } as T;
}
