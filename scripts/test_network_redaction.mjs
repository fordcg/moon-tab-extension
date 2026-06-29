import assert from "node:assert/strict";
import {
  REDACTED_VALUE,
  isSensitiveName,
  redactBodyText,
  redactHeaders,
  redactNetworkRecord,
  redactUrl,
} from "../src/shared/network-redaction.mjs";

const serialized = (value) => JSON.stringify(value);
const assertNoSecret = (value, secrets) => {
  const text = serialized(value);
  for (const secret of secrets) {
    assert.equal(text.includes(secret), false, `secret leaked: ${secret}\n${text}`);
  }
};

assert.equal(isSensitiveName("Authorization"), true);
assert.equal(isSensitiveName("x-api-key"), true);
assert.equal(isSensitiveName("password"), true);
assert.equal(isSensitiveName("content-type"), false);

const url = redactUrl("https://api.example.test/user?token=abc123&q=visible&client_secret=def456");
assert.equal(url.redacted, true);
assert.equal(decodeURIComponent(url.text).includes(REDACTED_VALUE), true);
assertNoSecret(url, ["abc123", "def456"]);

const headers = redactHeaders([
  { name: "Authorization", value: "Bearer secret-token" },
  { name: "Cookie", value: "sid=session-secret" },
  { name: "Content-Type", value: "application/json" },
  { name: "X-Trace", value: "Bearer embedded-secret" },
]);
assert.equal(headers.redacted, true);
assert.deepEqual(headers.headers.find((header) => header.name === "Content-Type"), {
  name: "Content-Type",
  value: "application/json",
});
assertNoSecret(headers, ["secret-token", "session-secret", "embedded-secret"]);

const jsonBody = redactBodyText(
  JSON.stringify({
    username: "alice",
    password: "secret-password",
    nested: { access_token: "secret-access-token" },
    list: [{ apiKey: "secret-api-key" }],
  }),
);
assert.equal(jsonBody.redacted, true);
assert.equal(jsonBody.text.includes("alice"), true);
assertNoSecret(jsonBody, ["secret-password", "secret-access-token", "secret-api-key"]);

const textBody = redactBodyText("token=plain-secret&safe=visible Authorization: Bearer header-secret");
assert.equal(textBody.redacted, true);
assert.equal(textBody.text.includes("visible"), true);
assertNoSecret(textBody, ["plain-secret", "header-secret"]);

const record = redactNetworkRecord({
  id: "req-1",
  url: "https://api.example.test/create?api_key=query-secret",
  requestHeaders: [{ name: "authorization", value: "Bearer request-secret" }],
  responseHeaders: [{ name: "set-cookie", value: "sid=response-cookie" }],
  requestBody: JSON.stringify({ password: "body-secret" }),
  responseBody: JSON.stringify({ token: "response-token", ok: true }),
});
assert.equal(record.redacted, true);
assertNoSecret(record, ["query-secret", "request-secret", "response-cookie", "body-secret", "response-token"]);

const long = redactBodyText("a".repeat(40), 8);
assert.equal(long.truncated, true);
assert.equal(long.text.length, 8);

console.log("network redaction tests passed");
