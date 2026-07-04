import assert from "node:assert/strict";
import { executeNetworkTool } from "../src/ai-assistant/background/network-tools-service.js";
import {
  NETWORK_GET_REQUEST_DETAILS_TOOL_ID,
  NETWORK_GET_REQUEST_DETAILS_TOOL_NAME,
  NETWORK_LIST_REQUESTS_TOOL_ID,
  NETWORK_LIST_REQUESTS_TOOL_NAME,
  NETWORK_TOOL_DEFINITIONS,
  formatNetworkRequestDetailsResult,
  formatNetworkRequestsListResult,
  normalizeNetworkGetRequestDetailsArguments,
  normalizeNetworkListRequestsArguments,
  summarizeNetworkToolResult,
} from "../src/shared/network-tools.mjs";

assert.equal(NETWORK_LIST_REQUESTS_TOOL_ID, "network.list_requests");
assert.equal(NETWORK_LIST_REQUESTS_TOOL_NAME, "network_list_requests");
assert.equal(NETWORK_GET_REQUEST_DETAILS_TOOL_ID, "network.get_request_details");
assert.equal(NETWORK_GET_REQUEST_DETAILS_TOOL_NAME, "network_get_request_details");
assert.deepEqual(NETWORK_TOOL_DEFINITIONS.map((tool) => tool.id), [
  "network.list_requests",
  "network.get_request_details",
]);
assert.equal(NETWORK_TOOL_DEFINITIONS[0].parameters.additionalProperties, false);
assert.equal(NETWORK_TOOL_DEFINITIONS[0].parameters.properties.tabId.type, "integer");
assert.equal(NETWORK_TOOL_DEFINITIONS[0].parameters.properties.tabId.minimum, 0);
assert.equal(NETWORK_TOOL_DEFINITIONS[1].parameters.properties.tabId.type, "integer");
assert.equal(NETWORK_TOOL_DEFINITIONS[1].parameters.properties.tabId.minimum, 0);

assert.deepEqual(normalizeNetworkListRequestsArguments({}), {
  ok: true,
  args: { limit: 50 },
});
assert.match(normalizeNetworkListRequestsArguments({ extra: true }).message, /不接受参数/);
assert.match(normalizeNetworkListRequestsArguments({ tabId: "1" }).message, /tabId 必须是数字/);
assert.match(normalizeNetworkListRequestsArguments({ tabId: 1.5 }).message, /tabId 必须是数字/);
assert.match(normalizeNetworkGetRequestDetailsArguments({ tabId: -1, requestIds: ["a"] }).message, /tabId 必须是数字/);
assert.match(normalizeNetworkListRequestsArguments({ limit: 0 }).message, /limit 必须是 1 到 200/);
assert.match(normalizeNetworkListRequestsArguments({ limit: 201 }).message, /limit 必须是 1 到 200/);
assert.match(normalizeNetworkListRequestsArguments({ resourceTypes: ["x".repeat(65)] }).message, /resourceTypes/);
assert.deepEqual(
  normalizeNetworkListRequestsArguments({
    tabId: 7,
    resourceTypes: ["XHR", "fetch", "XHR", "", 1],
    limit: 2,
  }).args,
  {
    tabId: 7,
    resourceTypes: ["xhr", "fetch"],
    limit: 2,
  },
);

assert.match(normalizeNetworkGetRequestDetailsArguments({}).message, /requestIds 必须是包含 1 到 50/);
assert.match(normalizeNetworkGetRequestDetailsArguments({ requestIds: [] }).message, /requestIds 必须是包含 1 到 50/);
assert.match(normalizeNetworkGetRequestDetailsArguments({ requestIds: [""] }).message, /requestIds 必须是包含 1 到 50/);
assert.match(
  normalizeNetworkGetRequestDetailsArguments({ requestIds: Array.from({ length: 51 }, () => "same") }).message,
  /requestIds 必须是包含 1 到 50/,
);
assert.match(
  normalizeNetworkGetRequestDetailsArguments({ requestIds: ["x".repeat(257)] }).message,
  /requestIds 必须是包含 1 到 50/,
);
assert.deepEqual(normalizeNetworkGetRequestDetailsArguments({ requestIds: ["a", "a", " b "], tabId: 3 }).args, {
  requestIds: ["a", "b"],
  tabId: 3,
});

const requests = [
  {
    id: "1",
    method: "GET",
    status: 200,
    resourceType: "Script",
    url: "https://example.test/app.js",
    durationMs: 12,
    redacted: false,
  },
  {
    id: "2",
    method: "POST",
    status: 201,
    resourceType: "XHR",
    url: "https://example.test/api",
    durationMs: 34,
    redacted: true,
    truncated: true,
  },
];
const listText = formatNetworkRequestsListResult(requests, { limit: 10 });
assert.match(listText, /Network 请求列表/);
assert.match(listText, /id=1/);
assert.match(listText, /GET/);
assert.match(listText, /已脱敏/);
assert.match(formatNetworkRequestsListResult([], { limit: 10 }), /未找到匹配的 Network 请求/);
const unsafeListText = formatNetworkRequestsListResult(
  [{ id: "secret-url", method: "GET", status: 200, resourceType: "XHR", url: "https://example.test/api?token=raw-secret" }],
  { limit: 10 },
);
assert.match(unsafeListText, /已脱敏/);
assert.doesNotMatch(unsafeListText, /raw-secret/);

const detailsText = formatNetworkRequestDetailsResult([
  {
    ...requests[1],
    requestHeaders: [{ name: "authorization", value: "[已脱敏]" }],
    responseHeaders: [{ name: "content-type", value: "application/json" }],
    requestBody: "{\"token\":\"[已脱敏]\"}",
    responseBody: "{\"ok\":true}",
    responseBodyEncoding: "utf8",
  },
]);
assert.match(detailsText, /Network 请求详情/);
assert.match(detailsText, /authorization/);
assert.match(detailsText, /\[已脱敏\]/);
assert.match(detailsText, /responseBody/);
assert.match(formatNetworkRequestDetailsResult([]), /未找到请求详情/);
const unsafeDetailsText = formatNetworkRequestDetailsResult([
  {
    id: "secret-details",
    method: "POST",
    status: 200,
    resourceType: "XHR",
    url: "https://example.test/api?api_key=raw-query-secret",
    requestHeaders: [{ name: "authorization", value: "Bearer raw-header-secret" }],
    responseHeaders: [{ name: "set-cookie", value: "sid=raw-cookie-secret" }],
    requestBody: "{\"token\":\"raw-body-secret\"}",
    responseBody: "{\"password\":\"raw-response-secret\"}",
  },
]);
assert.match(unsafeDetailsText, /\[已脱敏\]/);
assert.doesNotMatch(unsafeDetailsText, /raw-query-secret/);
assert.doesNotMatch(unsafeDetailsText, /raw-header-secret/);
assert.doesNotMatch(unsafeDetailsText, /raw-cookie-secret/);
assert.doesNotMatch(unsafeDetailsText, /raw-body-secret/);
assert.doesNotMatch(unsafeDetailsText, /raw-response-secret/);
assert.match(summarizeNetworkToolResult(requests), /2 个 Network 请求/);

let snapshotArgs;
const listToolResult = await executeNetworkTool(
  {
    id: "call-list",
    name: NETWORK_LIST_REQUESTS_TOOL_NAME,
    arguments: { tabId: 11, resourceTypes: ["xhr"], limit: 1 },
  },
  {
    getNetworkSnapshot: async (args) => {
      snapshotArgs = args;
      return {
        ok: true,
        tabId: args.tabId,
        requests: [
          { id: "list-1", method: "GET", status: 200, resourceType: "Script", url: "https://example.test/app.js" },
          { id: "list-2", method: "POST", status: 201, resourceType: "XHR", url: "https://example.test/api" },
          { id: "list-3", method: "POST", status: 202, resourceType: "XHR", url: "https://example.test/api/next" },
        ],
      };
    },
  },
);
assert.deepEqual(snapshotArgs, { tabId: 11 });
assert.equal(listToolResult.toolCallId, "call-list");
assert.equal(listToolResult.name, NETWORK_LIST_REQUESTS_TOOL_NAME);
assert.equal(listToolResult.isError, undefined);
assert.match(listToolResult.content, /Network 请求列表（1\/2 个，limit=1）/);
assert.match(listToolResult.content, /id=list-2/);
assert.doesNotMatch(listToolResult.content, /id=list-1/);
assert.doesNotMatch(listToolResult.content, /id=list-3/);
assert.match(listToolResult.content, /还有 1 个请求未显示/);
assert.match(listToolResult.summary, /2 个 Network 请求/);

let detailsArgs;
const detailsToolResult = await executeNetworkTool(
  {
    id: "call-details",
    name: NETWORK_GET_REQUEST_DETAILS_TOOL_ID,
    arguments: { tabId: 12, requestIds: ["list-2"] },
  },
  {
    getNetworkDetails: async (args) => {
      detailsArgs = args;
      return {
        ok: true,
        tabId: args.tabId,
        requestIds: args.requestIds,
        details: [
          {
            id: "list-2",
            method: "POST",
            status: 201,
            resourceType: "XHR",
            url: "https://example.test/api",
            responseBody: "{\"ok\":true}",
          },
        ],
      };
    },
  },
);
assert.deepEqual(detailsArgs, { tabId: 12, requestIds: ["list-2"] });
assert.equal(detailsToolResult.toolCallId, "call-details");
assert.equal(detailsToolResult.name, NETWORK_GET_REQUEST_DETAILS_TOOL_ID);
assert.equal(detailsToolResult.isError, undefined);
assert.match(detailsToolResult.content, /Network 请求详情/);
assert.match(detailsToolResult.content, /id=list-2/);
assert.match(detailsToolResult.summary, /1 个 Network 请求/);

const invalidToolResult = await executeNetworkTool({
  id: "call-invalid",
  name: NETWORK_LIST_REQUESTS_TOOL_ID,
  arguments: { limit: 0 },
});
assert.equal(invalidToolResult.toolCallId, "call-invalid");
assert.equal(invalidToolResult.isError, true);
assert.equal(invalidToolResult.code, "INVALID_ARGUMENTS");
assert.match(invalidToolResult.content, /limit 必须是 1 到 200/);

const unavailableToolResult = await executeNetworkTool(
  {
    id: "call-unavailable",
    name: NETWORK_LIST_REQUESTS_TOOL_ID,
    arguments: {},
  },
  {
    getNetworkSnapshot: async () => ({ ok: false, message: "DevTools 面板未连接。" }),
  },
);
assert.equal(unavailableToolResult.toolCallId, "call-unavailable");
assert.equal(unavailableToolResult.isError, true);
assert.equal(unavailableToolResult.code, "DEVTOOLS_UNAVAILABLE");
assert.match(unavailableToolResult.content, /DevTools 面板未连接/);

const missingReaderToolResult = await executeNetworkTool({
  id: "call-missing-reader",
  name: NETWORK_LIST_REQUESTS_TOOL_ID,
  arguments: {},
});
assert.equal(missingReaderToolResult.toolCallId, "call-missing-reader");
assert.equal(missingReaderToolResult.isError, true);
assert.equal(missingReaderToolResult.code, "DEVTOOLS_UNAVAILABLE");
assert.match(missingReaderToolResult.content, /DevTools Network 不可用/);

const snapshotThrowResult = await executeNetworkTool(
  {
    id: "call-snapshot-throw",
    name: NETWORK_LIST_REQUESTS_TOOL_ID,
    arguments: {},
  },
  {
    getNetworkSnapshot: async () => {
      throw new Error("snapshot channel closed");
    },
  },
);
assert.equal(snapshotThrowResult.toolCallId, "call-snapshot-throw");
assert.equal(snapshotThrowResult.isError, true);
assert.equal(snapshotThrowResult.code, "NETWORK_TOOL_ERROR");
assert.match(snapshotThrowResult.content, /snapshot channel closed/);

const detailsThrowResult = await executeNetworkTool(
  {
    id: "call-details-throw",
    name: NETWORK_GET_REQUEST_DETAILS_TOOL_ID,
    arguments: { requestIds: ["list-2"] },
  },
  {
    getNetworkDetails: async () => {
      throw new Error("details channel closed");
    },
  },
);
assert.equal(detailsThrowResult.toolCallId, "call-details-throw");
assert.equal(detailsThrowResult.isError, true);
assert.equal(detailsThrowResult.code, "NETWORK_TOOL_ERROR");
assert.match(detailsThrowResult.content, /details channel closed/);

console.log("network tools tests passed");
