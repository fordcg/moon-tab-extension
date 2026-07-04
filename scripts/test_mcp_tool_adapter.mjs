import assert from "node:assert/strict";
import {
  MODEL_TOOL_GROUP_MCP_REMOTE_ID,
  createMcpToolId,
  createMcpToolName,
  createMcpToolRegistryEntries,
  isMcpToolId,
  parseMcpToolId,
} from "../src/shared/mcp-tool-adapter.mjs";

const id = createMcpToolId("server.with.dot", "search.web");
assert.equal(id, "mcp.server%2Ewith%2Edot.search.web");
assert.deepEqual(parseMcpToolId(id), { serverId: "server.with.dot", toolName: "search.web" });
assert.deepEqual(parseMcpToolId("mcp.server%2ewith%2edot.search.web"), {
  serverId: "server.with.dot",
  toolName: "search.web",
});
assert.equal(isMcpToolId(id), true);
assert.equal(isMcpToolId("browser.search"), false);

assert.equal(createMcpToolName("Grok Search", "search.web"), "mcp_grok_search_search_web");
assert.match(createMcpToolName("中文", "搜索"), /^mcp_tool_[a-z0-9]+$/);
const usedNames = new Set(["mcp_grok_search_search_web"]);
const collidedName = createMcpToolName("Grok Search", "search.web", usedNames);
assert.match(collidedName, /^mcp_grok_search_search_web_[a-z0-9]+$/);
assert.equal(usedNames.has(collidedName), true);

const entries = createMcpToolRegistryEntries([
  {
    id: "server.one",
    name: "Server One",
    enabled: true,
    endpointUrl: "http://127.0.0.1:17333/",
    tools: [
      { name: "search", description: "Search", inputSchema: { type: "object" } },
      { name: "disabled", disabledReason: "off", inputSchema: { type: "object" } },
    ],
  },
  {
    id: "server.two",
    name: "Server Two",
    enabled: false,
    endpointUrl: "http://127.0.0.1:17334/",
    tools: [{ name: "search", inputSchema: { type: "object" } }],
  },
]);

assert.equal(entries.length, 1);
assert.equal(entries[0].groupId, MODEL_TOOL_GROUP_MCP_REMOTE_ID);
assert.equal(entries[0].toolClassification.runtime, "mcp_remote");
assert.deepEqual(entries[0].toolClassification.capabilities, ["external_tool"]);
assert.equal(entries[0].toolClassification.risk, "external");
assert.equal(entries[0].metadata.serverId, "server.one");
assert.equal(entries[0].metadata.toolName, "search");
assert.deepEqual(entries[0].parameters, { type: "object" });

console.log("mcp tool adapter tests passed");
