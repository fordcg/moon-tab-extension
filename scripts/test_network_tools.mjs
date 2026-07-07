import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
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

const networkToolExecutorSource = await readFile(
  new URL("../src/background/browserControl/networkToolExecutor.ts", import.meta.url),
  "utf8",
);
const networkDevtoolsBridgeSource = await readFile(
  new URL("../src/background/networkDevtoolsBridge.ts", import.meta.url),
  "utf8",
);

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

assert.match(networkToolExecutorSource, /export class BrowserNetworkToolExecutor/, "source Network tool executor must expose BrowserNetworkToolExecutor");
assert.match(networkToolExecutorSource, /NETWORK_LIST_REQUESTS_TOOL_ID[\s\S]*NETWORK_LIST_REQUESTS_TOOL_NAME/, "source Network executor must accept network.list_requests id and name");
assert.match(networkToolExecutorSource, /NETWORK_GET_REQUEST_DETAILS_TOOL_ID[\s\S]*NETWORK_GET_REQUEST_DETAILS_TOOL_NAME/, "source Network executor must accept network.get_request_details id and name");
assert.match(networkToolExecutorSource, /NETWORK_CLEAR_REQUESTS_TOOL_ID[\s\S]*NETWORK_CLEAR_REQUESTS_TOOL_NAME/, "source Network executor must accept network.clear_requests id and name");
assert.match(networkToolExecutorSource, /NETWORK_WAIT_FOR_REQUESTS_TOOL_ID[\s\S]*NETWORK_WAIT_FOR_REQUESTS_TOOL_NAME/, "source Network executor must accept network.wait_for_requests id and name");
assert.match(networkToolExecutorSource, /NETWORK_COMPARE_REQUESTS_TOOL_ID[\s\S]*NETWORK_COMPARE_REQUESTS_TOOL_NAME/, "source Network executor must accept network.compare_requests id and name");
assert.match(networkToolExecutorSource, /NETWORK_FIND_PARAMETER_CANDIDATES_TOOL_ID[\s\S]*NETWORK_FIND_PARAMETER_CANDIDATES_TOOL_NAME/, "source Network executor must accept network.find_parameter_candidates id and name");
assert.match(networkToolExecutorSource, /NETWORK_EXTRACT_JS_CANDIDATES_TOOL_ID[\s\S]*NETWORK_EXTRACT_JS_CANDIDATES_TOOL_NAME/, "source Network executor must accept network.extract_js_candidates id and name");
assert.match(networkToolExecutorSource, /this\.recorder\.listRequests\(normalizeRequestFilter\(toolCall\.arguments\), \{ redacted: !fullAccess \}\)/, "source Network executor must list requests through the recorder with redaction by default");
assert.match(networkToolExecutorSource, /this\.recorder\.getDetails\(requestIds\.requestIds, \{ redacted: !revealCurrentResult \}\)/, "source Network executor must read request details through the recorder with boundary-aware redaction");
assert.match(networkToolExecutorSource, /this\.recorder\.clear\(\);[\s\S]*this\.getJsSourceExecutor\(\)\.clear\(\);[\s\S]*this\.onClear\?\.\(\)/, "source Network executor must clear recorder, JS source index, and clear callback together");
assert.match(networkToolExecutorSource, /this\.recorder\.waitForRequests\(normalizeWaitFilter\(toolCall\.arguments\), \{ redacted: !fullAccess \}\)/, "source Network executor must support waiting for matching requests");
assert.match(networkToolExecutorSource, /findParameterCandidates\(details\)/, "source Network executor must support parameter candidate discovery");
assert.match(networkToolExecutorSource, /extractJsCandidates\(details, toolCall\.arguments\)/, "source Network executor must support JS candidate extraction from request details");
assert.match(networkToolExecutorSource, /createNetworkAttachment\(toolCall\.id, details, options\)/, "source Network executor must return Network tool attachments");
assert.match(networkToolExecutorSource, /redactNetworkRequestDetail/, "source Network executor must redact request details before attachments when needed");
assert.match(networkToolExecutorSource, /include_sensitive_field_in_current_tool_result/, "source Network executor must gate raw detail reveal on boundary grant");
assert.match(networkToolExecutorSource, /write_sensitive_result_to_chat_once/, "source Network executor must require chat write grant before revealing current raw result");

assert.match(networkDevtoolsBridgeSource, /createRecorderAdapter\(tabId\?: number\)/, "source Network DevTools bridge must expose a recorder adapter");
assert.match(networkDevtoolsBridgeSource, /listRequests: \(filter: NetworkRequestFilter = \{\}/, "source Network DevTools bridge adapter must list requests");
assert.match(networkDevtoolsBridgeSource, /getDetails: async \(requestIds: string\[\]/, "source Network DevTools bridge adapter must read details");
assert.match(networkDevtoolsBridgeSource, /clear: \(\) => \{[\s\S]*clearRequests\(resolvedTabId\)/, "source Network DevTools bridge adapter must clear requests");
assert.match(networkDevtoolsBridgeSource, /waitForRequests: async \(filter: NetworkWaitFilter = \{\}/, "source Network DevTools bridge adapter must wait for requests");
assert.match(networkDevtoolsBridgeSource, /networkContext\.detailsResponse/, "source Network DevTools bridge must receive details responses from DevTools");
assert.match(networkDevtoolsBridgeSource, /redactNetworkRequestDetail/, "source Network DevTools bridge must redact request details");
assert.match(networkDevtoolsBridgeSource, /redactNetworkRequestMeta/, "source Network DevTools bridge must redact request summaries");

console.log("network tools tests passed");
