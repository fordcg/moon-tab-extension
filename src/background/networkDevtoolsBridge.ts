import { redactNetworkRequestDetail, redactNetworkRequestMeta } from "../shared/networkContext";
import type { NetworkRequestDetail, NetworkRequestMeta } from "../shared/types";
import type { NetworkRequestFilter, NetworkWaitFilter } from "./browserControl/networkRecorder";

interface NetworkRuntimeMessage {
  type: string;
  tabId?: number;
  requestIds?: string[];
}

interface PendingDetailsRpc {
  port: chrome.runtime.Port;
  timer: ReturnType<typeof setTimeout>;
  resolve: (response: NetworkDetailsResponse) => void;
}

interface NetworkDetailsResponse {
  ok: boolean;
  details?: NetworkRequestDetail[];
  message?: string;
}

interface TabNetworkState {
  port: chrome.runtime.Port;
  requests: NetworkRequestMeta[];
}

interface RecorderReadOptions {
  redacted?: boolean;
}

const DEVTOOLS_PORT_NAME = "network.devtools";
const DETAILS_TIMEOUT_MS = 5000;
const DEFAULT_LIST_LIMIT = 200;

export function createNetworkDevtoolsBridge() {
  const statesByTab = new Map<number, TabNetworkState>();
  const pendingDetails = new Map<string, PendingDetailsRpc>();
  let nextRpcId = 0;

  function handlePortConnect(port: chrome.runtime.Port): boolean {
    if (port.name !== DEVTOOLS_PORT_NAME) {
      return false;
    }
    if (!isTrustedDevtoolsPortSender(port.sender)) {
      return false;
    }

    port.onMessage.addListener((message) => {
      handlePortMessage(port, message);
    });
    port.onDisconnect.addListener(() => {
      for (const [tabId, state] of Array.from(statesByTab.entries())) {
        if (state.port === port) {
          statesByTab.delete(tabId);
        }
      }
      rejectPendingForPort(port);
    });

    return true;
  }

  async function handleMessage(message: NetworkRuntimeMessage): Promise<{ ok: boolean; requests?: NetworkRequestMeta[]; details?: NetworkRequestDetail[]; tabId?: number; message?: string }> {
    if (message.type === "networkContext.getSnapshot") {
      const tabId = resolveTabId(message.tabId);
      if (tabId === undefined) {
        return { ok: false, message: "未检测到当前标签页 DevTools Network 连接。" };
      }
      return {
        ok: true,
        tabId,
        requests: listRequests(tabId, {}),
      };
    }

    if (message.type === "networkContext.getDetails") {
      const tabId = resolveTabId(message.tabId);
      if (tabId === undefined) {
        return { ok: false, message: "未检测到当前标签页 DevTools Network 连接。" };
      }
      if (!Array.isArray(message.requestIds) || message.requestIds.length === 0) {
        return { ok: false, message: "requestIds 必须是非空数组。" };
      }
      return requestDetails(tabId, message.requestIds);
    }

    if (message.type === "networkContext.clearRequests") {
      const tabId = resolveTabId(message.tabId);
      if (tabId === undefined) {
        return { ok: false, message: "未检测到当前标签页 DevTools Network 连接。" };
      }
      return clearRequests(tabId);
    }

    return { ok: false, message: "未知的 Network DevTools 消息。" };
  }

  function createRecorderAdapter(tabId?: number) {
    return {
      isEnabled: () => resolveTabId(tabId) !== undefined,
      listRequests: (filter: NetworkRequestFilter = {}, _options: RecorderReadOptions = {}) => {
        const resolvedTabId = resolveTabId(tabId);
        return resolvedTabId === undefined ? [] : listRequests(resolvedTabId, filter);
      },
      getDetails: async (requestIds: string[], _options: RecorderReadOptions = {}) => {
        const resolvedTabId = resolveTabId(tabId);
        if (resolvedTabId === undefined) {
          return [];
        }
        const response = await requestDetails(resolvedTabId, requestIds);
        return response.ok ? response.details ?? [] : [];
      },
      clear: () => {
        const resolvedTabId = resolveTabId(tabId);
        if (resolvedTabId !== undefined) {
          clearRequests(resolvedTabId);
        }
      },
      waitForRequests: async (filter: NetworkWaitFilter = {}, _options: RecorderReadOptions = {}) => {
        const resolvedTabId = resolveTabId(tabId);
        if (resolvedTabId === undefined) {
          return [];
        }
        const existing = listRequests(resolvedTabId, filter);
        if (existing.length > 0) {
          return existing;
        }
        await delay(normalizeTimeout(filter.timeoutMs));
        return listRequests(resolvedTabId, filter);
      },
    };
  }

  function handlePortMessage(port: chrome.runtime.Port, message: unknown): void {
    const record = normalizeRecord(message);
    const type = normalizeString(record?.type);
    if (type === "networkContext.devtoolsConnected" || type === "networkContext.snapshotUpdated") {
      const tabId = normalizeNumber(record?.tabId);
      if (tabId === undefined) {
        return;
      }
      statesByTab.set(tabId, {
        port,
        requests: normalizeRequests(record?.requests),
      });
      return;
    }

    if (type !== "networkContext.detailsResponse") {
      return;
    }

    const rpcId = normalizeString(record?.rpcId);
    const pending = rpcId ? pendingDetails.get(rpcId) : undefined;
    if (!pending) {
      return;
    }

    clearTimeout(pending.timer);
    pendingDetails.delete(rpcId);
    const response = normalizeRecord(record?.response);
    if (response?.ok === true) {
      pending.resolve({ ok: true, details: normalizeDetails(response.details) });
      return;
    }
    pending.resolve({ ok: false, message: normalizeString(response?.message) || "DevTools Network 详情读取失败。" });
  }

  function requestDetails(tabId: number, requestIds: string[]): Promise<NetworkDetailsResponse> {
    const state = statesByTab.get(tabId);
    const port = state?.port;
    if (!port) {
      return Promise.resolve({ ok: false, message: "未检测到当前标签页 DevTools Network 连接。" });
    }

    const rpcId = `network-details-${Date.now()}-${++nextRpcId}`;
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        pendingDetails.delete(rpcId);
        resolve({ ok: false, message: "读取 DevTools Network 详情超时。" });
      }, DETAILS_TIMEOUT_MS);

      pendingDetails.set(rpcId, {
        port,
        timer,
        resolve: (response) => {
          if (!response.ok) {
            resolve(response);
            return;
          }
          resolve({
            ok: true,
            // DevTools bridge is a redacted compatibility layer; raw/full-access flows must use the debugger recorder.
            details: (response.details ?? []).map((detail) => redactNetworkRequestDetail(detail)),
          });
        },
      });

      try {
        port.postMessage({ type: "networkContext.getDetails", tabId, requestIds, rpcId });
      } catch {
        clearTimeout(timer);
        pendingDetails.delete(rpcId);
        resolve({ ok: false, message: "无法向 DevTools Network 端口发送详情请求。" });
      }
    });
  }

  function clearRequests(tabId: number): { ok: boolean; message?: string } {
    const state = statesByTab.get(tabId);
    if (!state) {
      return { ok: false, message: "未检测到当前标签页 DevTools Network 连接，无法清空请求缓存。" };
    }
    try {
      state.port.postMessage({ type: "networkContext.clearRequests", tabId });
    } catch {
      statesByTab.delete(tabId);
      return { ok: false, message: "清空 DevTools Network 请求缓存失败。" };
    }
    state.requests = [];
    return { ok: true };
  }

  function listRequests(tabId: number, filter: NetworkRequestFilter): NetworkRequestMeta[] {
    const requests = statesByTab.get(tabId)?.requests ?? [];
    const visibleRequests = requests
      .filter((request) => matchesFilter(request, filter))
      // DevTools bridge is a redacted compatibility layer; raw/full-access flows must use the debugger recorder.
      .map((request) => redactNetworkRequestMeta(request));
    return visibleRequests.slice(-normalizeLimit(filter.limit));
  }

  function resolveTabId(tabId?: number): number | undefined {
    if (typeof tabId === "number" && Number.isInteger(tabId)) {
      return statesByTab.has(tabId) ? tabId : undefined;
    }
    if (statesByTab.size === 1) {
      return statesByTab.keys().next().value;
    }
    return undefined;
  }

  function rejectPendingForPort(port: chrome.runtime.Port): void {
    for (const [rpcId, pending] of Array.from(pendingDetails.entries())) {
      if (pending.port !== port) {
        continue;
      }
      clearTimeout(pending.timer);
      pendingDetails.delete(rpcId);
      pending.resolve({ ok: false, message: "DevTools Network 端口已断开。" });
    }
  }

  return {
    handlePortConnect,
    handleMessage,
    createRecorderAdapter,
  };
}

function matchesFilter(request: NetworkRequestMeta, filter: NetworkRequestFilter): boolean {
  if (filter.urlIncludes && !request.url.includes(filter.urlIncludes)) {
    return false;
  }
  if (filter.method && request.method.toUpperCase() !== filter.method.toUpperCase()) {
    return false;
  }
  if (filter.resourceType && request.resourceType?.toLowerCase() !== filter.resourceType.toLowerCase()) {
    return false;
  }
  if (filter.status !== undefined && request.status !== filter.status) {
    return false;
  }
  return true;
}

function normalizeLimit(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULT_LIST_LIMIT;
  }
  return Math.min(Math.max(Math.floor(value), 1), DEFAULT_LIST_LIMIT);
}

function normalizeTimeout(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return 5000;
  }
  return Math.min(Math.floor(value), 30000);
}

function normalizeRequests(value: unknown): NetworkRequestMeta[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((item) => {
    const record = normalizeRecord(item);
    const id = normalizeString(record?.id);
    const url = normalizeString(record?.url);
    if (!id || !url) {
      return [];
    }
    return [{
      ...record,
      id,
      url,
      method: normalizeString(record?.method) || "GET",
    } as NetworkRequestMeta];
  });
}

function normalizeDetails(value: unknown): NetworkRequestDetail[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((item) => {
    const record = normalizeRecord(item);
    const id = normalizeString(record?.id);
    const url = normalizeString(record?.url);
    if (!id || !url) {
      return [];
    }
    return [{
      ...record,
      id,
      url,
      method: normalizeString(record?.method) || "GET",
      responseBody: normalizeString(record?.responseBody) || undefined,
      responseBodyEncoding: normalizeString(record?.responseBodyEncoding) || undefined,
      truncated: Boolean(record?.truncated),
      redacted: Boolean(record?.redacted),
    } as NetworkRequestDetail];
  });
}

function normalizeRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" ? value as Record<string, unknown> : undefined;
}

function normalizeString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function normalizeNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) ? value : undefined;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isTrustedDevtoolsPortSender(sender?: chrome.runtime.MessageSender): boolean {
  const senderUrl = typeof sender?.url === "string" ? sender.url : undefined;
  const devtoolsUrl = chrome.runtime?.getURL?.("src/ai-assistant/devtools.html");
  if (!senderUrl || !devtoolsUrl) {
    return false;
  }
  try {
    const senderParsed = new URL(senderUrl);
    const devtoolsParsed = new URL(devtoolsUrl);
    return senderParsed.protocol === devtoolsParsed.protocol
      && senderParsed.host === devtoolsParsed.host
      && senderParsed.pathname === devtoolsParsed.pathname;
  } catch {
    return false;
  }
}
