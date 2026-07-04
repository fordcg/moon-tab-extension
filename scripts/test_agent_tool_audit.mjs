import assert from "node:assert/strict";
import {
  AGENT_TOOL_AUDIT_MAX,
  createAgentToolAuditRecord,
  redactAgentToolValue,
  sliceAgentToolAuditLog,
} from "../src/shared/agent-tool-audit.mjs";

assert.equal(redactAgentToolValue("secret", 0, "apiKey"), "[已脱敏]");
assert.deepEqual(redactAgentToolValue({ token: "abc", nested: { ok: "yes" } }), {
  token: "[已脱敏]",
  nested: { ok: "yes" },
});

const record = createAgentToolAuditRecord({
  toolCall: { id: "call-1", name: "mcp_search", arguments: { query: "moon", authorization: "Bearer abc" } },
  tool: { id: "mcp.server.search", name: "mcp_search", displayName: "Server.search", permission: "mcp", risk: "external" },
  result: { content: "ok" },
  startedAt: 100,
  completedAt: 160,
});

assert.equal(record.toolCallId, "call-1");
assert.equal(record.durationMs, 60);
assert.equal(record.status, "success");
assert.equal(record.arguments.authorization, "[已脱敏]");
assert.equal(record.resultSummary, "ok");

const failed = createAgentToolAuditRecord({
  toolCall: { id: "call-2", name: "mcp_search", arguments: {} },
  tool: { id: "mcp.server.search", name: "mcp_search" },
  result: { isError: true, content: "bad" },
  startedAt: 100,
  completedAt: 101,
});
assert.equal(failed.status, "error");
assert.equal(failed.errorMessage, "bad");

const redactedResultText = createAgentToolAuditRecord({
  toolCall: { id: "call-3", name: "mcp_search", arguments: {} },
  tool: { id: "mcp.server.search", name: "mcp_search" },
  result: { content: "token=abc" },
  startedAt: 100,
  completedAt: 120,
});
assert.match(redactedResultText.resultSummary, /\[已脱敏\]/);
assert.doesNotMatch(redactedResultText.resultSummary, /abc/);

const redactedResultObject = createAgentToolAuditRecord({
  toolCall: { id: "call-4", name: "mcp_search", arguments: {} },
  tool: { id: "mcp.server.search", name: "mcp_search" },
  result: { content: { token: "abc", nested: { ok: "yes" } } },
  startedAt: 100,
  completedAt: 120,
});
assert.match(redactedResultObject.resultSummary, /\[已脱敏\]/);
assert.doesNotMatch(redactedResultObject.resultSummary, /abc/);

const longLog = Array.from({ length: AGENT_TOOL_AUDIT_MAX + 5 }, (_, index) => ({ id: String(index) }));
assert.equal(sliceAgentToolAuditLog(longLog).length, AGENT_TOOL_AUDIT_MAX);
assert.equal(sliceAgentToolAuditLog(longLog)[0].id, "5");

console.log("agent tool audit tests passed");
