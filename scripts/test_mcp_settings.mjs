import assert from "node:assert/strict";
import {
  DEFAULT_MCP_SETTINGS,
  MCP_BEARER_TOKEN_SETTING_PREFIX,
  createMcpBearerTokenSettingKey,
  createMcpServerId,
  migrateLegacyGrokMcpSettings,
  normalizeMcpSettings,
} from "../src/shared/mcp-settings.mjs";

assert.deepEqual(normalizeMcpSettings(undefined), DEFAULT_MCP_SETTINGS);

const normalized = normalizeMcpSettings({
  servers: [
    {
      id: " Main.Server ",
      name: " Main MCP ",
      endpointUrl: " http://127.0.0.1:17333/mcp ",
      enabled: true,
      tools: [
        {
          name: " search.web ",
          description: " Search ",
          inputSchema: { type: "object", properties: { query: { type: "string" } } },
        },
        { name: "", description: "invalid" },
      ],
      lastRefreshAt: 123,
      lastRefreshError: " old ",
    },
  ],
});

assert.equal(normalized.servers.length, 1);
assert.equal(normalized.servers[0].id, "Main.Server");
assert.equal(normalized.servers[0].name, "Main MCP");
assert.equal(normalized.servers[0].endpointUrl, "http://127.0.0.1:17333/mcp");
assert.equal(normalized.servers[0].enabled, true);
assert.equal(normalized.servers[0].tools.length, 1);
assert.equal(normalized.servers[0].tools[0].name, "search.web");
assert.equal(normalized.servers[0].lastRefreshAt, 123);
assert.equal(normalized.servers[0].lastRefreshError, "old");

assert.equal(createMcpBearerTokenSettingKey("Main.Server"), `${MCP_BEARER_TOKEN_SETTING_PREFIX}Main.Server`);
assert.equal(createMcpServerId("Grok Search", "http://127.0.0.1:17333/"), "grok-search-127-0-0-1-17333");
assert.equal(createMcpServerId("", "http://localhost:3000/mcp"), "mcp-localhost-3000");

const migrated = migrateLegacyGrokMcpSettings({
  enabled: true,
  baseUrl: "http://127.0.0.1:17333/",
  exposeToChat: true,
  grokApiKey: "xai-secret",
  grokBaseUrl: "https://api.x.ai/v1",
  grokModel: "grok-4.20-multi-agent-xhigh",
});

assert.equal(migrated.settings.servers.length, 1);
assert.equal(migrated.settings.servers[0].name, "Grok 搜索");
assert.equal(migrated.settings.servers[0].enabled, true);
assert.equal(migrated.settings.servers[0].endpointUrl, "http://127.0.0.1:17333/");
assert.equal(migrated.legacyGrok.grokApiKey, "xai-secret");
assert.equal(migrated.legacyGrok.grokBaseUrl, "https://api.x.ai/v1");
assert.equal(migrated.legacyGrok.grokModel, "grok-4.20-multi-agent-xhigh");

console.log("mcp settings tests passed");
