import "./assets/modulepreload-polyfill-BnkOoLKg.js";
import { t as truncateText } from "./assets/text-ByXoIHTe.js";
import { redactNetworkRecord } from "../shared/network-redaction.mjs";

const MAX_TEXT_LENGTH = 12000;
const RECONNECT_DELAY_MS = 1000;
const inspectedTabId = chrome.devtools.inspectedWindow.tabId;

let port;
let reconnectTimer;
let fallbackRequestId = 0;
const requestStore = new Map();

connectRuntimePort();

function connectRuntimePort() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = undefined;
  }

  const nextPort = chrome.runtime.connect({ name: "network.devtools" });
  port = nextPort;

  nextPort.onMessage.addListener((message) => {
    if (message?.type !== "networkContext.getDetails") {
      return;
    }

    readRequestDetails(message.requestIds).then((details) => {
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

function scheduleReconnect() {
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

function refreshHarSnapshot() {
  chrome.devtools.network.getHAR((har) => {
    rememberHarEntries(har?.entries ?? []);
  });
}

function rememberHarEntries(entries) {
  for (const entry of entries) {
    rememberRequest(entry);
  }
  postDevtoolsConnected();
}

function rememberRequest(entry, liveRequest = undefined) {
  const id = resolveRequestId(entry);
  requestStore.set(id, {
    meta: buildRequestMeta(id, entry),
    request: liveRequest,
  });
}

function resolveRequestId(entry) {
  return (
    entry?._requestId ||
    `req-${fallbackRequestId++}-${entry?.startedDateTime ?? Date.now()}-${entry?.request?.method ?? "GET"}-${entry?.request?.url ?? ""}`
  );
}

function buildRequestMeta(id, entry) {
  const rawMeta = {
    id,
    url: entry?.request?.url ?? "",
    method: entry?.request?.method ?? "GET",
    status: entry?.response?.status,
    statusText: entry?.response?.statusText,
    mimeType: entry?.response?.content?.mimeType,
    resourceType: entry?._resourceType,
    startedAt: entry?.startedDateTime,
    durationMs: typeof entry?.time === "number" ? Math.round(entry.time) : undefined,
    requestHeaders: normalizeHeaders(entry?.request?.headers),
    responseHeaders: normalizeHeaders(entry?.response?.headers),
    requestBody: normalizeBody(entry?.request?.postData?.text),
    failed: entry?.response?.status === 0,
    truncated: false,
    redacted: false,
  };

  return redactNetworkRecord(rawMeta, MAX_TEXT_LENGTH);
}

async function readRequestDetails(requestIds) {
  const details = [];

  for (const requestId of requestIds ?? []) {
    const record = requestStore.get(requestId);
    if (!record) {
      continue;
    }

    const response = await readResponseBody(record.request);
    const detail = redactNetworkRecord(
      {
        ...record.meta,
        responseBody: normalizeBody(response?.content),
        responseBodyEncoding: response?.encoding,
        truncated: Boolean(record.meta.truncated || response?.truncated),
      },
      MAX_TEXT_LENGTH,
    );
    details.push(detail);
  }

  return details;
}

function readResponseBody(request) {
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

function normalizeHeaders(headers) {
  if (!Array.isArray(headers)) {
    return undefined;
  }

  const normalized = headers
    .filter((header) => typeof header?.name === "string" && typeof header?.value === "string")
    .map((header) => ({
      name: header.name,
      value: truncateText(header.value, MAX_TEXT_LENGTH).text,
    }));

  return normalized.length ? normalized : undefined;
}

function normalizeBody(body) {
  if (typeof body !== "string" || !body) {
    return undefined;
  }
  return truncateText(body, MAX_TEXT_LENGTH).text;
}

function snapshotRequests() {
  return Array.from(requestStore.values()).map((record) => record.meta);
}

function postDevtoolsConnected() {
  postToRuntime({
    type: "networkContext.devtoolsConnected",
    tabId: inspectedTabId,
    requests: snapshotRequests(),
  });
}

function postSnapshotUpdated() {
  postToRuntime({
    type: "networkContext.snapshotUpdated",
    tabId: inspectedTabId,
    requests: snapshotRequests(),
  });
}

function postToRuntime(message) {
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
