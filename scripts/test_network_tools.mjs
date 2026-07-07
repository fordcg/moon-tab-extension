import assert from "node:assert/strict";
import { createRequire } from "node:module";
import {
  NETWORK_CLEAR_REQUESTS_TOOL_ID,
  NETWORK_CLEAR_REQUESTS_TOOL_NAME,
  NETWORK_COMPARE_REQUESTS_TOOL_ID,
  NETWORK_COMPARE_REQUESTS_TOOL_NAME,
  NETWORK_EXTRACT_JS_CANDIDATES_TOOL_ID,
  NETWORK_EXTRACT_JS_CANDIDATES_TOOL_NAME,
  NETWORK_FIND_PARAMETER_CANDIDATES_TOOL_ID,
  NETWORK_FIND_PARAMETER_CANDIDATES_TOOL_NAME,
  NETWORK_GET_REQUEST_DETAILS_TOOL_ID,
  NETWORK_GET_REQUEST_DETAILS_TOOL_NAME,
  NETWORK_LIST_REQUESTS_TOOL_ID,
  NETWORK_LIST_REQUESTS_TOOL_NAME,
  NETWORK_TOOL_DEFINITIONS,
  findNetworkJsCandidates,
  findNetworkParameterCandidates,
  formatNetworkCompareRequestsResult,
  formatNetworkClearRequestsResult,
  formatNetworkJsCandidatesResult,
  formatNetworkParameterCandidatesResult,
  formatNetworkRequestDetailsResult,
  formatNetworkRequestsComparisonResult,
  formatNetworkRequestsListResult,
  normalizeNetworkClearRequestsArguments,
  normalizeNetworkCompareRequestsArguments,
  normalizeNetworkExtractJsCandidatesArguments,
  normalizeNetworkFindParameterCandidatesArguments,
  normalizeNetworkGetRequestDetailsArguments,
  normalizeNetworkListRequestsArguments,
  summarizeNetworkToolResult,
} from "../src/shared/network-tools.mjs";

const require = createRequire(import.meta.url);
const { createJiti } = require("jiti");
const jiti = createJiti(import.meta.url, { interopDefault: true });
const { BrowserNetworkToolExecutor } = jiti("../src/background/browserControl/networkToolExecutor.ts");
const { createNetworkDevtoolsBridge } = jiti("../src/background/networkDevtoolsBridge.ts");
const NETWORK_WAIT_FOR_REQUESTS_TOOL_ID = "network.wait_for_requests";
const NETWORK_WAIT_FOR_REQUESTS_TOOL_NAME = "network_wait_for_requests";

assert.equal(NETWORK_LIST_REQUESTS_TOOL_ID, "network.list_requests");
assert.equal(NETWORK_LIST_REQUESTS_TOOL_NAME, "network_list_requests");
assert.equal(NETWORK_GET_REQUEST_DETAILS_TOOL_ID, "network.get_request_details");
assert.equal(NETWORK_GET_REQUEST_DETAILS_TOOL_NAME, "network_get_request_details");
assert.equal(NETWORK_CLEAR_REQUESTS_TOOL_ID, "network.clear_requests");
assert.equal(NETWORK_CLEAR_REQUESTS_TOOL_NAME, "network_clear_requests");
assert.equal(NETWORK_COMPARE_REQUESTS_TOOL_ID, "network.compare_requests");
assert.equal(NETWORK_COMPARE_REQUESTS_TOOL_NAME, "network_compare_requests");
assert.equal(NETWORK_FIND_PARAMETER_CANDIDATES_TOOL_ID, "network.find_parameter_candidates");
assert.equal(NETWORK_FIND_PARAMETER_CANDIDATES_TOOL_NAME, "network_find_parameter_candidates");
assert.equal(NETWORK_EXTRACT_JS_CANDIDATES_TOOL_ID, "network.extract_js_candidates");
assert.equal(NETWORK_EXTRACT_JS_CANDIDATES_TOOL_NAME, "network_extract_js_candidates");
assert.deepEqual(NETWORK_TOOL_DEFINITIONS.map((tool) => tool.id), [
  "network.list_requests",
  "network.get_request_details",
  "network.clear_requests",
  "network.compare_requests",
  "network.find_parameter_candidates",
  "network.extract_js_candidates",
]);
assert.equal(NETWORK_TOOL_DEFINITIONS[0].parameters.additionalProperties, false);
assert.equal(NETWORK_TOOL_DEFINITIONS[0].parameters.properties.tabId.type, "integer");
assert.equal(NETWORK_TOOL_DEFINITIONS[0].parameters.properties.tabId.minimum, 0);
assert.equal(NETWORK_TOOL_DEFINITIONS[1].parameters.properties.tabId.type, "integer");
assert.equal(NETWORK_TOOL_DEFINITIONS[1].parameters.properties.tabId.minimum, 0);
assert.equal(NETWORK_TOOL_DEFINITIONS[2].parameters.properties.tabId.type, "integer");
assert.equal(NETWORK_TOOL_DEFINITIONS[2].parameters.properties.tabId.minimum, 0);
assert.equal(NETWORK_TOOL_DEFINITIONS[2].parameters.additionalProperties, false);
assert.equal(NETWORK_TOOL_DEFINITIONS[3].parameters.properties.tabId.type, "integer");
assert.equal(NETWORK_TOOL_DEFINITIONS[3].parameters.properties.tabId.minimum, 0);
assert.equal(NETWORK_TOOL_DEFINITIONS[3].parameters.properties.requestIds.minItems, 2);
assert.equal(NETWORK_TOOL_DEFINITIONS[3].parameters.properties.requestIds.maxItems, 50);
assert.equal(NETWORK_TOOL_DEFINITIONS[4].parameters.properties.tabId.type, "integer");
assert.equal(NETWORK_TOOL_DEFINITIONS[4].parameters.properties.tabId.minimum, 0);
assert.equal(NETWORK_TOOL_DEFINITIONS[4].parameters.properties.requestIds.minItems, 1);
assert.equal(NETWORK_TOOL_DEFINITIONS[4].parameters.properties.requestIds.maxItems, 50);
assert.equal(NETWORK_TOOL_DEFINITIONS[5].parameters.required.includes("requestIds"), true);
assert.equal(NETWORK_TOOL_DEFINITIONS[5].parameters.properties.requestIds.maxItems, 50);
assert.equal(NETWORK_TOOL_DEFINITIONS[5].parameters.properties.keywords.maxItems, 20);
assert.equal(NETWORK_TOOL_DEFINITIONS[5].parameters.properties.limit.maximum, 40);
assert.equal(NETWORK_TOOL_DEFINITIONS[5].parameters.properties.limit.default, 12);

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
assert.deepEqual(normalizeNetworkClearRequestsArguments({}), {
  ok: true,
  args: {},
});
assert.deepEqual(normalizeNetworkClearRequestsArguments({ tabId: 9 }).args, {
  tabId: 9,
});
assert.match(normalizeNetworkClearRequestsArguments({ tabId: "9" }).message, /tabId 必须是数字/);
assert.match(normalizeNetworkClearRequestsArguments({ extra: true }).message, /不接受参数/);
assert.match(normalizeNetworkCompareRequestsArguments({}).message, /requestIds 必须是包含 2 到 50/);
assert.match(normalizeNetworkCompareRequestsArguments({ requestIds: ["a", "a"] }).message, /requestIds 必须是包含 2 到 50/);
assert.match(normalizeNetworkCompareRequestsArguments({ requestIds: ["a", "b"], tabId: "3" }).message, /tabId 必须是数字/);
assert.match(normalizeNetworkCompareRequestsArguments({ requestIds: ["a", "b"], extra: true }).message, /不接受参数/);
assert.deepEqual(normalizeNetworkCompareRequestsArguments({ requestIds: ["a", "a", " b "], tabId: 3 }).args, {
  requestIds: ["a", "b"],
  tabId: 3,
});
assert.match(normalizeNetworkFindParameterCandidatesArguments({}).message, /requestIds 必须是包含 1 到 50/);
assert.match(
  normalizeNetworkFindParameterCandidatesArguments({ requestIds: Array.from({ length: 51 }, (_, index) => `id-${index}`) }).message,
  /requestIds 必须是包含 1 到 50/,
);
assert.match(normalizeNetworkFindParameterCandidatesArguments({ requestIds: ["a"], tabId: -1 }).message, /tabId 必须是数字/);
assert.match(normalizeNetworkFindParameterCandidatesArguments({ requestIds: ["a"], extra: true }).message, /不接受参数/);
assert.deepEqual(normalizeNetworkFindParameterCandidatesArguments({ requestIds: ["a", "a", " b "], tabId: 4 }).args, {
  requestIds: ["a", "b"],
  tabId: 4,
});
assert.match(normalizeNetworkExtractJsCandidatesArguments({}).message, /requestIds 必须是包含 1 到 50/);
assert.match(
  normalizeNetworkExtractJsCandidatesArguments({ requestIds: ["js-1"], keywords: ["x".repeat(121)] }).message,
  /keywords/,
);
assert.match(
  normalizeNetworkExtractJsCandidatesArguments({ requestIds: ["js-1"], urlIncludes: "x".repeat(241) }).message,
  /urlIncludes/,
);
assert.match(
  normalizeNetworkExtractJsCandidatesArguments({ requestIds: ["js-1"], limit: 41 }).message,
  /limit 必须是 1 到 40/,
);
assert.deepEqual(
  normalizeNetworkExtractJsCandidatesArguments({
    requestIds: ["js-1", " js-1 ", "js-2"],
    tabId: 15,
    keywords: ["sign", "SIGN", " md5 ", "", 1],
    urlIncludes: "/api/search",
    limit: 3,
  }).args,
  {
    requestIds: ["js-1", "js-2"],
    tabId: 15,
    keywords: ["sign", "md5"],
    urlIncludes: "/api/search",
    limit: 3,
  },
);

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
assert.match(formatNetworkClearRequestsResult({ clearedCount: 3 }), /已清空 3 个 Network 请求/);
assert.match(formatNetworkClearRequestsResult({ tabId: 17, clearedCount: 3 }), /tabId=17/);
assert.match(formatNetworkClearRequestsResult({}), /已清空 Network 请求缓存/);
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

const analysisDetails = [
  {
    id: "cmp-1",
    method: "POST",
    status: 200,
    resourceType: "XHR",
    url: "https://example.test/api/orders?sessionId=raw-session-secret&timestamp=1710000000&nonce=abc123&signature=sig-one&productId=sku-1",
    requestHeaders: [
      { name: "content-type", value: "application/json" },
      { name: "authorization", value: "Bearer raw-auth-secret" },
      { name: "x-request-id", value: "req-001" },
    ],
    requestBody: JSON.stringify({
      amount: 10,
      token: "raw-json-token",
      payload: "eyJwYXlsb2FkIjp0cnVlfQ==",
      clientNonce: "body-nonce-1",
    }),
  },
  {
    id: "cmp-2",
    method: "POST",
    status: 200,
    resourceType: "XHR",
    url: "https://example.test/api/orders?sessionId=raw-session-secret-2&timestamp=1710000001&nonce=def456&signature=sig-two&productId=sku-1",
    requestHeaders: [
      { name: "content-type", value: "application/x-www-form-urlencoded" },
      { name: "cookie", value: "sid=raw-cookie-secret" },
      { name: "x-request-id", value: "req-002" },
    ],
    requestBody: "amount=10&password=raw-form-password&ciphertext=abcdef1234567890&request_id=form-req-2",
  },
];

const compareText = formatNetworkCompareRequestsResult(analysisDetails);
assert.match(compareText, /Network 请求对比结果/);
assert.match(compareText, /稳定字段/);
assert.match(compareText, /变化字段/);
assert.match(compareText, /疑似关键参数/);
assert.match(compareText, /method/);
assert.match(compareText, /path/);
assert.match(compareText, /query\.timestamp/);
assert.match(compareText, /requestHeaders\.x-request-id/);
assert.match(compareText, /body\.amount/);
assert.match(compareText, /body\.clientNonce/);
assert.match(compareText, /body\.request_id/);
assert.match(compareText, /签名/);
assert.match(compareText, /时间戳/);
assert.match(compareText, /随机数\/请求 ID/);
assert.match(compareText, /凭据/);
assert.match(compareText, /加密或编码载荷/);
assert.match(compareText, /\[已脱敏\]/);
assert.doesNotMatch(compareText, /raw-session-secret/);
assert.doesNotMatch(compareText, /raw-auth-secret/);
assert.doesNotMatch(compareText, /raw-cookie-secret/);
assert.doesNotMatch(compareText, /raw-json-token/);
assert.doesNotMatch(compareText, /raw-form-password/);
assert.match(formatNetworkCompareRequestsResult([]), /未找到请求详情/);
assert.equal(formatNetworkRequestsComparisonResult(analysisDetails), compareText);
assert.match(formatNetworkRequestsComparisonResult([analysisDetails[0]]), /至少需要两个请求/);

const candidates = findNetworkParameterCandidates(analysisDetails);
assert.ok(candidates.some((candidate) => candidate.name === "signature" && candidate.reasons.includes("签名")));
assert.ok(candidates.some((candidate) => candidate.name === "timestamp" && candidate.reasons.includes("时间戳")));
assert.ok(candidates.some((candidate) => candidate.name === "nonce" && candidate.reasons.includes("随机数/请求 ID")));
assert.doesNotMatch(JSON.stringify(candidates), /raw-session-secret|raw-auth-secret|raw-cookie-secret|raw-json-token|raw-form-password/);

const candidatesText = formatNetworkParameterCandidatesResult(analysisDetails);
assert.match(candidatesText, /疑似关键参数/);
assert.match(candidatesText, /query\.signature/);
assert.match(candidatesText, /query\.timestamp/);
assert.match(candidatesText, /query\.nonce/);
assert.match(candidatesText, /requestHeaders\.x-request-id/);
assert.match(candidatesText, /body\.payload/);
assert.match(candidatesText, /body\.ciphertext/);
assert.match(candidatesText, /body\.request_id/);
assert.match(candidatesText, /签名/);
assert.match(candidatesText, /时间戳/);
assert.match(candidatesText, /随机数\/请求 ID/);
assert.match(candidatesText, /凭据/);
assert.match(candidatesText, /加密或编码载荷/);
assert.doesNotMatch(candidatesText, /raw-session-secret/);
assert.doesNotMatch(candidatesText, /raw-auth-secret/);
assert.doesNotMatch(candidatesText, /raw-cookie-secret/);
assert.doesNotMatch(candidatesText, /raw-json-token/);
assert.doesNotMatch(candidatesText, /raw-form-password/);
assert.match(formatNetworkParameterCandidatesResult([]), /未找到请求详情/);
assert.match(formatNetworkParameterCandidatesResult(candidates), /疑似签名字段/);
assert.match(formatNetworkParameterCandidatesResult(candidates), /疑似时间戳字段/);

const jsCandidateDetails = [
  {
    id: "js-1",
    method: "GET",
    status: 200,
    resourceType: "Script",
    mimeType: "application/javascript",
    url: "https://example.test/assets/app.js?token=raw-query-secret&sid=raw-sid-secret",
    responseBody: [
      "function makeSign(input) {",
      "  const token = \"raw-js-token\";",
      "  return md5(input + token + Date.now());",
      "}",
      "fetch('/api/search?keyword=' + encodeURIComponent(input));",
    ].join("\n"),
  },
  {
    id: "js-2",
    method: "GET",
    status: 200,
    resourceType: "XHR",
    mimeType: "application/json",
    url: "https://example.test/api/data",
    responseBody: "{\"signature\":\"json-body-match\"}",
  },
  {
    id: "js-3",
    method: "GET",
    status: 200,
    resourceType: "Other",
    mimeType: "text/plain",
    url: "https://example.test/static/chunk.mjs",
    responseBody: "const signature = sha256(payload);",
  },
  {
    id: "js-hash-fragment",
    method: "GET",
    status: 200,
    resourceType: "Script",
    mimeType: "application/javascript",
    url: "https://example.test/assets/app.js?safe=ok#/callback?token=raw-hash-token&sid=raw-hash-sid",
    responseBody: "function makeSignFromHash(input) { return input; }",
  },
  {
    id: "js-direct-fragment",
    method: "GET",
    status: 200,
    resourceType: "Script",
    mimeType: "application/javascript",
    url: "https://example.test/assets/app.js#access_token=raw-fragment-access&id_token=raw-fragment-id&safe=value",
    responseBody: "function makeSignFromDirectFragment(input) { return input; }",
  },
];

const jsCandidates = findNetworkJsCandidates(jsCandidateDetails, {
  keywords: ["makeSign", "md5", "signature"],
  urlIncludes: "/api/search",
  limit: 10,
});
assert.ok(jsCandidates.some((candidate) => candidate.requestId === "js-1" && candidate.term === "makeSign"));
assert.ok(jsCandidates.some((candidate) => candidate.requestId === "js-1" && candidate.term === "/api/search"));
assert.ok(jsCandidates.some((candidate) => candidate.requestId === "js-3" && candidate.term === "signature"));
assert.ok(jsCandidates.some((candidate) => candidate.requestId === "js-hash-fragment" && candidate.term === "makeSign"));
assert.ok(jsCandidates.some((candidate) => candidate.requestId === "js-direct-fragment" && candidate.term === "makeSign"));
assert.equal(jsCandidates.some((candidate) => candidate.requestId === "js-2"), false);
assert.doesNotMatch(
  JSON.stringify(jsCandidates),
  /raw-js-token|raw-query-secret|raw-sid-secret|raw-hash-token|raw-hash-sid|raw-fragment-access|raw-fragment-id/,
);

const jsSnippetUrlLiteralDetails = [
  {
    id: "js-snippet-url-literal",
    method: "GET",
    status: 200,
    resourceType: "Script",
    mimeType: "application/javascript",
    url: "https://example.test/assets/snippet-url.js",
    responseBody: 'function makeSignWithSnippetUrl(input) { return fetch("/cb?safe=1#/callback?token=raw-snippet-hash-secret"); }',
  },
];
const jsSnippetUrlLiteralOptions = {
  keywords: ["makeSignWithSnippetUrl", "/cb?safe=1"],
  limit: 5,
};
const jsSnippetUrlLiteralCandidates = findNetworkJsCandidates(jsSnippetUrlLiteralDetails, jsSnippetUrlLiteralOptions);
assert.ok(jsSnippetUrlLiteralCandidates.length > 0);
assert.ok(jsSnippetUrlLiteralCandidates.some((candidate) => candidate.requestId === "js-snippet-url-literal"));

const jsSensitiveSnippetDetails = [
  {
    id: "js-sensitive-snippet",
    method: "GET",
    status: 200,
    resourceType: "Script",
    mimeType: "application/javascript",
    url: "https://example.test/assets/sensitive.js",
    responseBody: [
      "const cfg = {\"token\":\"raw-object-token\", 'api_key':'raw-object-api-key', [\"token\"]: \"raw-computed-token\", safe: \"safe-value\"};",
      "cfg[\"token\"] = \"raw-bracket-token\";",
      "const token = \"prefix\\\"tail-secret\";",
      "token += \"raw-compound-token\";",
      "cfg[\"token\"] += \"raw-bracket-compound-token\";",
      "makeSign(cfg);",
    ].join(" "),
  },
];
const jsSensitiveSnippetOptions = {
  keywords: ["makeSign", "token", "api_key"],
  limit: 10,
};
const jsSensitiveSnippetCandidates = findNetworkJsCandidates(jsSensitiveSnippetDetails, jsSensitiveSnippetOptions);
assert.ok(jsSensitiveSnippetCandidates.length > 0);
assert.ok(jsSensitiveSnippetCandidates.some((candidate) => candidate.requestId === "js-sensitive-snippet"));
assert.match(JSON.stringify(jsSensitiveSnippetCandidates), /\[已脱敏\]/);
assert.match(JSON.stringify(jsSensitiveSnippetCandidates), /safe-value/);
assert.doesNotMatch(
  JSON.stringify(jsSensitiveSnippetCandidates),
  /raw-object-token|raw-object-api-key|raw-computed-token|tail-secret|raw-compound-token|raw-bracket-compound-token|raw-bracket-token/,
);

const jsSensitiveFallbackSnippetDetails = [
  {
    id: "js-sensitive-fallback-snippet",
    method: "GET",
    status: 200,
    resourceType: "Script",
    mimeType: "application/javascript",
    url: "https://example.test/assets/sensitive-fallback.js",
    responseBody: [
      "const cfg = { safe: \"safe-fallback-value\" };",
      "const token = config.token || \"raw-fallback-secret\";",
      "token ||= \"raw-logical-secret\";",
      "token ??= \"raw-nullish-secret\";",
      "cfg[\"token\"] ||= \"raw-bracket-logical-secret\";",
      "makeSign(token);",
    ].join(" "),
  },
];
const jsSensitiveFallbackSnippetOptions = {
  keywords: ["makeSign", "token"],
  limit: 10,
};
const jsSensitiveFallbackSnippetCandidates = findNetworkJsCandidates(
  jsSensitiveFallbackSnippetDetails,
  jsSensitiveFallbackSnippetOptions,
);
assert.ok(jsSensitiveFallbackSnippetCandidates.length > 0);
assert.ok(jsSensitiveFallbackSnippetCandidates.some((candidate) => candidate.requestId === "js-sensitive-fallback-snippet"));
assert.match(JSON.stringify(jsSensitiveFallbackSnippetCandidates), /safe-fallback-value/);

const repeatedJsCandidates = findNetworkJsCandidates(
  [
    {
      id: "js-repeat",
      method: "GET",
      status: 200,
      resourceType: "Script",
      mimeType: "application/javascript",
      url: "https://example.test/assets/repeat.js",
      responseBody: "SIGN sign Sign sign",
    },
  ],
  {
    keywords: ["sign"],
    limit: 3,
  },
);
assert.equal(repeatedJsCandidates.length, 3);
assert.deepEqual(
  repeatedJsCandidates.map((candidate) => candidate.term),
  ["sign", "sign", "sign"],
);
assert.deepEqual(
  repeatedJsCandidates.map((candidate) => candidate.position),
  [0, 5, 10],
);

const longJsKeyword = "s".repeat(120);
const longJsCandidates = findNetworkJsCandidates(
  [
    {
      id: "js-long",
      method: "GET",
      status: 200,
      resourceType: "Script",
      mimeType: "application/javascript",
      url: "https://example.test/assets/long.js",
      responseBody: `${"a".repeat(130)}${longJsKeyword}${"b".repeat(130)}`,
    },
  ],
  {
    keywords: [longJsKeyword],
    limit: 2,
  },
);
assert.equal(longJsCandidates.length, 1);
assert.equal(longJsCandidates[0].snippet.startsWith("..."), true);
assert.equal(longJsCandidates[0].snippet.endsWith("..."), true);
assert.ok(longJsCandidates.every((candidate) => candidate.snippet.length <= 360));

const jsCandidatesText = formatNetworkJsCandidatesResult(jsCandidateDetails, {
  keywords: ["makeSign", "md5"],
  urlIncludes: "/api/search",
  limit: 5,
});
assert.match(jsCandidatesText, /Network JS 候选片段/);
assert.match(jsCandidatesText, /id=js-1/);
assert.match(jsCandidatesText, /makeSign/);
assert.match(jsCandidatesText, /md5/);
assert.match(jsCandidatesText, /\/api\/search/);
assert.match(jsCandidatesText, /id=js-hash-fragment/);
assert.match(jsCandidatesText, /id=js-direct-fragment/);
assert.match(jsCandidatesText, /\[已脱敏\]/);
assert.doesNotMatch(
  jsCandidatesText,
  /raw-js-token|raw-query-secret|raw-sid-secret|raw-hash-token|raw-hash-sid|raw-fragment-access|raw-fragment-id/,
);
const jsSnippetUrlLiteralText = formatNetworkJsCandidatesResult(jsSnippetUrlLiteralDetails, jsSnippetUrlLiteralOptions);
assert.match(jsSnippetUrlLiteralText, /Network JS 候选片段/);
assert.match(jsSnippetUrlLiteralText, /id=js-snippet-url-literal/);
const jsSensitiveSnippetText = formatNetworkJsCandidatesResult(jsSensitiveSnippetDetails, jsSensitiveSnippetOptions);
assert.match(jsSensitiveSnippetText, /Network JS 候选片段/);
assert.match(jsSensitiveSnippetText, /id=js-sensitive-snippet/);
assert.match(jsSensitiveSnippetText, /\[已脱敏\]/);
assert.match(jsSensitiveSnippetText, /safe-value/);
assert.doesNotMatch(
  jsSensitiveSnippetText,
  /raw-object-token|raw-object-api-key|raw-computed-token|tail-secret|raw-compound-token|raw-bracket-compound-token|raw-bracket-token/,
);
const jsSensitiveFallbackSnippetText = formatNetworkJsCandidatesResult(
  jsSensitiveFallbackSnippetDetails,
  jsSensitiveFallbackSnippetOptions,
);
assert.match(jsSensitiveFallbackSnippetText, /Network JS 候选片段/);
assert.match(jsSensitiveFallbackSnippetText, /id=js-sensitive-fallback-snippet/);
assert.match(jsSensitiveFallbackSnippetText, /safe-fallback-value/);

const newJsSnippetRedactionSecrets = [
  "raw-snippet-hash-secret",
  "raw-fallback-secret",
  "raw-logical-secret",
  "raw-nullish-secret",
  "raw-bracket-logical-secret",
];
const newJsSnippetRedactionOutputs = [
  ["candidate JSON", JSON.stringify([...jsSnippetUrlLiteralCandidates, ...jsSensitiveFallbackSnippetCandidates])],
  ["formatted output", `${jsSnippetUrlLiteralText}\n${jsSensitiveFallbackSnippetText}`],
];
const newJsSnippetRedactionLeaks = [];
for (const [label, output] of newJsSnippetRedactionOutputs) {
  for (const secret of newJsSnippetRedactionSecrets) {
    if (output.includes(secret)) {
      newJsSnippetRedactionLeaks.push(`${label}: ${secret}`);
    }
  }
}
assert.deepEqual(newJsSnippetRedactionLeaks, []);
const emptyJsCandidatesText = formatNetworkJsCandidatesResult([], { keywords: ["sign"] });
assert.match(emptyJsCandidatesText, /未找到匹配的 JS 候选资源/);
assert.match(emptyJsCandidatesText, /network\.list_requests|Script/);
assert.match(emptyJsCandidatesText, /keywords.*urlIncludes|urlIncludes.*keywords/);

const emptyCandidates = findNetworkParameterCandidates([
  {
    id: "no-candidate",
    method: "GET",
    status: 200,
    resourceType: "XHR",
    url: "https://example.test/api/products?category=book",
  },
]);
assert.equal(emptyCandidates.length, 0);
assert.match(formatNetworkParameterCandidatesResult(emptyCandidates), /未发现候选/);

const sensitiveVariantDetails = [
  {
    id: "sensitive-variant-1",
    method: "POST",
    status: 200,
    resourceType: "XHR",
    url: "/api/orders?password[]=query-secret-one&token%5B%5D=query-secret-two&safe=value",
    requestHeaders: [{ name: "content-type", value: "application/x-www-form-urlencoded" }],
    requestBody: "password[]=body-secret-one&token=body-secret-two&safeBody=value",
  },
  {
    id: "sensitive-variant-2",
    method: "POST",
    status: 200,
    resourceType: "XHR",
    url: "/api/orders?password[]=query-secret-three&token%5B%5D=query-secret-four&safe=value",
    requestHeaders: [{ name: "content-type", value: "application/x-www-form-urlencoded" }],
    requestBody: "password[]=body-secret-three&token=body-secret-four&safeBody=value",
  },
];
const sensitiveVariantsText = formatNetworkCompareRequestsResult(sensitiveVariantDetails);
assert.match(sensitiveVariantsText, /query\.password\[\]/);
assert.match(sensitiveVariantsText, /query\.token\[\]/);
assert.match(sensitiveVariantsText, /body\.password\[\]/);
assert.match(sensitiveVariantsText, /body\.token/);
assert.match(sensitiveVariantsText, /\[已脱敏\]/);
assert.doesNotMatch(
  sensitiveVariantsText,
  /query-secret-one|query-secret-two|query-secret-three|query-secret-four|body-secret-one|body-secret-two|body-secret-three|body-secret-four/,
);

const unsafePublicCandidatesText = formatNetworkParameterCandidatesResult([
  {
    name: "token",
    fieldName: "body.token",
    reasons: ["凭据"],
    presentCount: 1,
    requestCount: 1,
    samples: [{ requestId: "unsafe-public", value: "raw-public-token" }],
  },
]);
assert.match(unsafePublicCandidatesText, /\[已脱敏\]/);
assert.doesNotMatch(unsafePublicCandidatesText, /raw-public-token/);

const manyCandidateDetails = [
  {
    id: "many-candidates",
    method: "GET",
    status: 200,
    resourceType: "XHR",
    url: `https://example.test/api?${Array.from({ length: 90 }, (_, index) => `signature${index}=value${index}`).join("&")}`,
  },
];
const manyCandidatesText = formatNetworkParameterCandidatesResult(manyCandidateDetails);
const visibleCandidateLines = manyCandidatesText.split("\n").filter((line) => line.startsWith("- query.signature"));
assert.equal(visibleCandidateLines.length, 80);
assert.match(manyCandidatesText, /另 10 条候选未显示/);

function createToolCall(id, name, args = {}) {
  return { id, name, arguments: args };
}

function createFakeRecorder(overrides = {}) {
  const calls = [];
  const recorder = {
    calls,
    isEnabled: true,
    listRequests(filter, options) {
      calls.push(["listRequests", filter, options]);
      const url = options?.redacted === false
        ? "https://example.test/api/orders?token=raw-list-secret"
        : "https://example.test/api/orders?token=[已脱敏]";
      return [
        {
          id: "list-1",
          method: "POST",
          status: 200,
          resourceType: "XHR",
          url,
        },
      ];
    },
    async getDetails(requestIds, options) {
      calls.push(["getDetails", requestIds, options]);
      return requestIds.map((id, index) => ({
        id,
        method: "POST",
        status: 200 + index,
        resourceType: index === 0 ? "Script" : "XHR",
        mimeType: index === 0 ? "application/javascript" : "application/json",
        url: options?.redacted === false
          ? `https://example.test/api/orders?signature=sig-${index}&token=raw-detail-secret-${index}`
          : `https://example.test/api/orders?signature=sig-${index}&token=[已脱敏]`,
        requestHeaders: [
          { name: "content-type", value: index === 0 ? "application/javascript" : "application/json" },
          { name: "authorization", value: options?.redacted === false ? `Bearer raw-header-secret-${index}` : "[已脱敏]" },
        ],
        requestBody: JSON.stringify({
          timestamp: 1710000000 + index,
          nonce: `nonce-${index}`,
          token: options?.redacted === false ? `raw-body-secret-${index}` : "[已脱敏]",
        }),
        responseBody: index === 0 ? "function makeSign(input) { return md5(input + token); }" : JSON.stringify({ ok: true }),
      }));
    },
    clear() {
      calls.push(["clear"]);
    },
    async waitForRequests(filter, options) {
      calls.push(["waitForRequests", filter, options]);
      const url = options?.redacted === false
        ? "https://example.test/api/wait?token=raw-wait-secret"
        : "https://example.test/api/wait?token=[已脱敏]";
      return [
        {
          id: "wait-1",
          method: "GET",
          status: 204,
          resourceType: "Fetch",
          url,
        },
      ];
    },
    ...overrides,
  };
  return recorder;
}

function assertModelToolResult(result, toolCall, { isError = false, attachments = false } = {}) {
  assert.equal(result.toolCallId, toolCall.id);
  assert.equal(result.name, toolCall.name);
  assert.equal(typeof result.content, "string");
  assert.equal(result.isError === true, isError);
  if (attachments) {
    assert.equal(result.toolAttachments?.length, 1);
    assert.equal(result.toolAttachments[0].kind, "network");
    assert.equal(result.toolAttachments[0].sourceToolCallId, toolCall.id);
  } else {
    assert.equal(result.toolAttachments, undefined);
  }
}

const clearEvents = [];
let fullAccess = false;
let boundaryGrant;
const executableRecorder = createFakeRecorder();
const executableExecutor = new BrowserNetworkToolExecutor(
  executableRecorder,
  () => clearEvents.push("cleared"),
  () => boundaryGrant,
  () => fullAccess,
);

const listCall = createToolCall("exec-list", NETWORK_LIST_REQUESTS_TOOL_ID, {
  urlIncludes: " /api/orders ",
  method: " post ",
  resourceType: " xhr ",
  status: 200,
  limit: 9.8,
});
const listResult = await executableExecutor.execute(listCall);
assertModelToolResult(listResult, listCall, { attachments: true });
assert.match(listResult.content, /id=list-1/);
assert.deepEqual(executableRecorder.calls.at(-1), [
  "listRequests",
  { urlIncludes: "/api/orders", method: "post", resourceType: "xhr", status: 200, limit: 9 },
  { redacted: true },
]);
assert.equal(listResult.toolAttachments[0].redacted, true);
assert.doesNotMatch(JSON.stringify(listResult), /raw-list-secret/);

fullAccess = true;
const waitCall = createToolCall("exec-wait", NETWORK_WAIT_FOR_REQUESTS_TOOL_ID, { timeoutMs: 12, limit: 1 });
const waitResult = await executableExecutor.execute(waitCall);
assertModelToolResult(waitResult, waitCall, { attachments: true });
assert.match(waitResult.content, /已捕获 1 个匹配的 Network 请求/);
assert.deepEqual(executableRecorder.calls.at(-1), [
  "waitForRequests",
  { urlIncludes: undefined, method: undefined, resourceType: undefined, status: undefined, limit: 1, timeoutMs: 12 },
  { redacted: false },
]);
assert.equal(waitResult.toolAttachments[0].redacted, false);

fullAccess = false;
const detailsCall = createToolCall("exec-details", NETWORK_GET_REQUEST_DETAILS_TOOL_NAME, { requestIds: [" req-1 ", "req-1", "req-2"] });
const detailsResult = await executableExecutor.execute(detailsCall);
assertModelToolResult(detailsResult, detailsCall, { attachments: true });
assert.match(detailsResult.content, /Network 工具读取请求详情/);
assert.deepEqual(executableRecorder.calls.at(-1), ["getDetails", ["req-1", "req-2"], { redacted: true }]);
assert.equal(detailsResult.toolAttachments[0].redacted, true);
assert.doesNotMatch(JSON.stringify(detailsResult), /raw-detail-secret|raw-header-secret|raw-body-secret/);

boundaryGrant = {
  grants: ["include_sensitive_field_in_current_tool_result", "write_sensitive_result_to_chat_once"],
};
const compareCall = createToolCall("exec-compare", NETWORK_COMPARE_REQUESTS_TOOL_NAME, { requestIds: ["cmp-1", "cmp-2"] });
const compareResult = await executableExecutor.execute(compareCall);
assertModelToolResult(compareResult, compareCall, { attachments: true });
assert.match(compareResult.content, /Network 请求对比结果/);
assert.match(compareResult.content, /疑似关键参数/);
assert.deepEqual(executableRecorder.calls.at(-1), ["getDetails", ["cmp-1", "cmp-2"], { redacted: false }]);
assert.equal(compareResult.toolAttachments[0].redacted, false);
assert.match(JSON.stringify(compareResult.toolAttachments[0].requests), /raw-detail-secret/);

const candidateCall = createToolCall("exec-candidates", NETWORK_FIND_PARAMETER_CANDIDATES_TOOL_ID, { requestIds: ["cand-1", "cand-2"] });
const candidateResult = await executableExecutor.execute(candidateCall);
assertModelToolResult(candidateResult, candidateCall, { attachments: true });
assert.match(candidateResult.content, /疑似签名字段|疑似时间戳字段|疑似随机数或请求标识字段|疑似凭据字段/);

const jsCandidateCall = createToolCall("exec-js-candidates", NETWORK_EXTRACT_JS_CANDIDATES_TOOL_NAME, {
  requestIds: ["js-current", "xhr-current"],
  keywords: ["makeSign"],
  urlIncludes: "/api/orders",
});
const jsCandidateResult = await executableExecutor.execute(jsCandidateCall);
assertModelToolResult(jsCandidateResult, jsCandidateCall, { attachments: true });
assert.match(jsCandidateResult.content, /JS 候选资源/);
assert.match(jsCandidateResult.content, /makeSign/);

const clearCall = createToolCall("exec-clear", NETWORK_CLEAR_REQUESTS_TOOL_NAME);
const clearResult = await executableExecutor.execute(clearCall);
assertModelToolResult(clearResult, clearCall);
assert.match(clearResult.content, /已清空当前受控页面的 Network 请求缓存/);
assert.deepEqual(executableRecorder.calls.at(-1), ["clear"]);
assert.deepEqual(clearEvents, ["cleared"]);

const disabledCall = createToolCall("exec-disabled", NETWORK_LIST_REQUESTS_TOOL_NAME);
const disabledResult = await new BrowserNetworkToolExecutor(createFakeRecorder({ isEnabled: () => false })).execute(disabledCall);
assertModelToolResult(disabledResult, disabledCall, { isError: true });
assert.match(disabledResult.content, /Network 采集尚未启用/);

const unknownCall = createToolCall("exec-unknown", "network_unknown_tool");
const unknownResult = await executableExecutor.execute(unknownCall);
assertModelToolResult(unknownResult, unknownCall, { isError: true });
assert.match(unknownResult.content, /未知的 Network 工具/);

const invalidDetailsCall = createToolCall("exec-invalid-details", NETWORK_GET_REQUEST_DETAILS_TOOL_ID, { requestIds: [] });
const invalidDetailsResult = await executableExecutor.execute(invalidDetailsCall);
assertModelToolResult(invalidDetailsResult, invalidDetailsCall, { isError: true });
assert.match(invalidDetailsResult.content, /requestIds 必须是包含 1 到 100/);

const throwingCall = createToolCall("exec-throw", NETWORK_LIST_REQUESTS_TOOL_ID);
const throwingResult = await new BrowserNetworkToolExecutor(createFakeRecorder({ listRequests: () => { throw new Error("boom"); } })).execute(throwingCall);
assertModelToolResult(throwingResult, throwingCall, { isError: true });
assert.match(throwingResult.content, /Network 工具执行失败，请稍后重试/);

const previousChrome = globalThis.chrome;
const bridgePostedMessages = [];
globalThis.chrome = {
  runtime: {
    getURL: (path) => `chrome-extension://test-extension/${path}`,
  },
};
try {
  const bridge = createNetworkDevtoolsBridge();
  const listeners = [];
  const disconnectListeners = [];
  const fakePort = {
    name: "network.devtools",
    sender: { url: "chrome-extension://test-extension/src/devtools/network.html" },
    onMessage: { addListener: (listener) => listeners.push(listener) },
    onDisconnect: { addListener: (listener) => disconnectListeners.push(listener) },
    postMessage: (message) => bridgePostedMessages.push(message),
  };
  assert.equal(bridge.handlePortConnect(fakePort), true);
  assert.equal(disconnectListeners.length, 1);
  listeners[0]({
    type: "networkContext.snapshotUpdated",
    tabId: 42,
    requests: [
      { id: "bridge-1", url: "https://example.test/api/orders?token=raw-bridge-list", method: "POST", status: 201, resourceType: "XHR" },
      { id: "bridge-2", url: "https://example.test/assets/app.js", method: "GET", status: 200, resourceType: "Script" },
    ],
  });
  const bridgeAdapter = bridge.createRecorderAdapter(42);
  assert.equal(bridgeAdapter.isEnabled(), true);
  const bridgeList = bridgeAdapter.listRequests({ urlIncludes: "/api/orders", method: "post", limit: 1 }, { redacted: false });
  assert.equal(bridgeList.length, 1);
  assert.equal(bridgeList[0].id, "bridge-1");
  assert.doesNotMatch(JSON.stringify(bridgeList), /raw-bridge-list/);

  const bridgeDetailsPromise = bridgeAdapter.getDetails(["bridge-1"], { redacted: false });
  const detailsRequestMessage = bridgePostedMessages.at(-1);
  assert.equal(detailsRequestMessage.type, "networkContext.getDetails");
  assert.equal(detailsRequestMessage.tabId, 42);
  assert.deepEqual(detailsRequestMessage.requestIds, ["bridge-1"]);
  listeners[0]({
    type: "networkContext.detailsResponse",
    rpcId: detailsRequestMessage.rpcId,
    response: {
      ok: true,
      details: [
        {
          id: "bridge-1",
          url: "https://example.test/api/orders?token=raw-bridge-detail",
          method: "POST",
          requestHeaders: [{ name: "authorization", value: "Bearer raw-bridge-header" }],
          responseBody: "{\"token\":\"raw-bridge-body\"}",
        },
      ],
    },
  });
  const bridgeDetails = await bridgeDetailsPromise;
  assert.equal(bridgeDetails.length, 1);
  assert.equal(bridgeDetails[0].id, "bridge-1");
  assert.doesNotMatch(JSON.stringify(bridgeDetails), /raw-bridge-detail|raw-bridge-header|raw-bridge-body/);

  const bridgeWait = await bridgeAdapter.waitForRequests({ resourceType: "script", timeoutMs: 1 }, { redacted: true });
  assert.equal(bridgeWait.length, 1);
  assert.equal(bridgeWait[0].id, "bridge-2");
  bridgeAdapter.clear();
  assert.deepEqual(bridgePostedMessages.at(-1), { type: "networkContext.clearRequests", tabId: 42 });
  assert.deepEqual(bridgeAdapter.listRequests({}, { redacted: true }), []);
} finally {
  if (previousChrome === undefined) {
    delete globalThis.chrome;
  } else {
    globalThis.chrome = previousChrome;
  }
}

console.log("network tools tests passed");
