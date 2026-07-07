import { redactNetworkRequestDetail, redactNetworkRequestMeta } from "../shared/networkContext";
import type { NetworkRequestDetail, NetworkRequestMeta, NetworkHeader } from "../shared/types";
import { truncateText } from "../shared/utils/text";

const MAX_TEXT_LENGTH = 12000;
const RECONNECT_DELAY_MS = 1000;
const inspectedTabId = chrome.devtools.inspectedWindow.tabId;

type DevtoolsHarHeader = Partial<NetworkHeader>;

interface DevtoolsHarEntry {
  _requestId?: string;
  _resourceType?: string | null;
  startedDateTime?: string;
  time?: number;
  request?: {
    method?: string;
    url?: string;
    headers?: DevtoolsHarHeader[];
    postData?: { text?: string };
  };
  response?: {
    status?: number;
    statusText?: string;
    headers?: DevtoolsHarHeader[];
    content?: { mimeType?: string };
  };
}

interface DevtoolsNetworkRequest extends DevtoolsHarEntry {
  getContent?: (callback: (content?: string, encoding?: string) => void) => void;
}

interface RequestStoreRecord {
  meta: NetworkRequestMeta;
  request?: DevtoolsNetworkRequest;
}

type NetworkDevtoolsOutboundMessage =
  | { type: "networkContext.devtoolsConnected"; tabId: number; requests: NetworkRequestMeta[] }
  | { type: "networkContext.snapshotUpdated"; tabId: number; requests: NetworkRequestMeta[] }
  | { type: "networkContext.detailsResponse"; rpcId: string; response: { ok: true; details: NetworkRequestDetail[] } };

type NetworkDevtoolsInboundMessage =
  | { type: "networkContext.clearRequests"; tabId?: number }
  | { type: "networkContext.getDetails"; rpcId: string; requestIds?: string[] };

let port: chrome.runtime.Port | undefined;
let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
let fallbackRequestId = 0;
const requestStore = new Map<string, RequestStoreRecord>();

connectRuntimePort();

function connectRuntimePort(): void {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = undefined;
  }

  const nextPort = chrome.runtime.connect({ name: "network.devtools" });
  port = nextPort;

  nextPort.onMessage.addListener((message: NetworkDevtoolsInboundMessage) => {
    if (message?.type === "networkContext.clearRequests") {
      requestStore.clear();
      postSnapshotUpdated();
      return;
    }

    if (message?.type !== "networkContext.getDetails") {
      return;
    }

    void readRequestDetails(message.requestIds).then((details) => {
      postToRuntime({
        type: "networkContext.detailsResponse",
        rpcId: message.rpcId,
        response: { ok: true, details },
      });
    });
  });

  nextPort.onDisconnect.addListener(() => {
    if (port === nextPort) {
      port = undefined;
      scheduleReconnect();
    }
  });

  refreshHarSnapshot();
}

function scheduleReconnect(): void {
  if (!reconnectTimer) {
    reconnectTimer = setTimeout(connectRuntimePort, RECONNECT_DELAY_MS);
  }
}

chrome.devtools.network.onRequestFinished.addListener((request) => {
  rememberRequest(request, request);
  postSnapshotUpdated();
});

chrome.devtools.network.onNavigated.addListener(() => {
  requestStore.clear();
  refreshHarSnapshot();
});

function refreshHarSnapshot(): void {
  chrome.devtools.network.getHAR((har) => {
    rememberHarEntries(har?.entries ?? []);
  });
}

function rememberHarEntries(entries: DevtoolsHarEntry[]): void {
  for (const entry of entries) {
    rememberRequest(entry);
  }
  postDevtoolsConnected();
}

function rememberRequest(entry: DevtoolsHarEntry, liveRequest?: DevtoolsNetworkRequest): void {
  const id = resolveRequestId(entry);
  requestStore.set(id, {
    meta: buildRequestMeta(id, entry),
    request: liveRequest,
  });
}

function resolveRequestId(entry: DevtoolsHarEntry): string {
  return (
    entry._requestId
    || `req-${fallbackRequestId++}-${entry.startedDateTime ?? Date.now()}-${entry.request?.method ?? "GET"}-${entry.request?.url ?? ""}`
  );
}

function buildRequestMeta(id: string, entry: DevtoolsHarEntry): NetworkRequestMeta {
  const rawMeta: NetworkRequestMeta = {
    id,
    url: entry.request?.url ?? "",
    method: entry.request?.method ?? "GET",
    status: entry.response?.status,
    statusText: entry.response?.statusText,
    mimeType: entry.response?.content?.mimeType,
    resourceType: entry._resourceType ?? undefined,
    startedAt: entry.startedDateTime,
    durationMs: typeof entry.time === "number" ? Math.round(entry.time) : undefined,
    requestHeaders: normalizeHeaders(entry.request?.headers),
    responseHeaders: normalizeHeaders(entry.response?.headers),
    requestBody: normalizeBody(entry.request?.postData?.text),
    failed: entry.response?.status === 0,
  };

  return redactNetworkRequestMeta(rawMeta);
}

async function readRequestDetails(requestIds?: string[]): Promise<NetworkRequestDetail[]> {
  const details: NetworkRequestDetail[] = [];

  for (const requestId of requestIds ?? []) {
    const record = requestStore.get(requestId);
    if (!record) {
      continue;
    }

    const response = await readResponseBody(record.request);
    const rawDetail: NetworkRequestDetail = {
      ...record.meta,
      responseBody: normalizeBody(response?.content),
      responseBodyEncoding: response?.encoding,
      truncated: Boolean(response?.truncated),
      redacted: false,
    };
    details.push(redactNetworkRequestDetail(rawDetail));
  }

  return details;
}

function readResponseBody(request?: DevtoolsNetworkRequest): Promise<{ content: string; encoding?: string; truncated: boolean } | undefined> {
  const getContent = request?.getContent;
  if (!getContent) {
    return Promise.resolve(undefined);
  }

  return new Promise((resolve) => {
    getContent((content, encoding) => {
      const truncated = truncateText(content ?? "", MAX_TEXT_LENGTH);
      resolve({ content: truncated.text, encoding, truncated: truncated.truncated });
    });
  });
}

function normalizeHeaders(headers?: DevtoolsHarHeader[]): NetworkHeader[] | undefined {
  if (!Array.isArray(headers)) {
    return undefined;
  }

  const normalized = headers
    .filter((header): header is NetworkHeader => typeof header?.name === "string" && typeof header.value === "string")
    .map((header) => ({
      name: header.name,
      value: truncateText(header.value, MAX_TEXT_LENGTH).text,
    }));

  return normalized.length ? normalized : undefined;
}

function normalizeBody(body?: string): string | undefined {
  if (typeof body !== "string" || !body) {
    return undefined;
  }
  return truncateText(body, MAX_TEXT_LENGTH).text;
}

function snapshotRequests(): NetworkRequestMeta[] {
  return Array.from(requestStore.values()).map((record) => record.meta);
}

function postDevtoolsConnected(): void {
  postToRuntime({
    type: "networkContext.devtoolsConnected",
    tabId: inspectedTabId,
    requests: snapshotRequests(),
  });
}

function postSnapshotUpdated(): void {
  postToRuntime({
    type: "networkContext.snapshotUpdated",
    tabId: inspectedTabId,
    requests: snapshotRequests(),
  });
}

function postToRuntime(message: NetworkDevtoolsOutboundMessage): void {
  if (!port) {
    scheduleReconnect();
    return;
  }

  try {
    port.postMessage(message);
  } catch {
    port = undefined;
    scheduleReconnect();
  }
}
