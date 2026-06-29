import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../src/ai-assistant/background/index.js", import.meta.url), "utf8");

assert.match(
  source,
  /ToolRegistry\s+as\s+AgentToolRegistry/,
  "background must import ToolRegistry for dynamic agent tools",
);

assert.match(
  source,
  /createHttpMcpToolAdapter\s+as\s+createMcpAdapter/,
  "background must import the HTTP MCP adapter",
);

assert.match(
  source,
  /agentToolsDefinitionsForChat\(e,n\)/,
  "chat tool definitions must be loaded through the agent tool bridge",
);

assert.match(
  source,
  /r\.id\.startsWith\(`mcp\.`\)\?agentToolsExecuteMcp\(n,r,t\)/,
  "mcp.* tool calls must be dispatched to the agent tool registry",
);

assert.match(
  source,
  /requireHighRiskToolConfirmation===!0&&agentToolsNeedsConfirmation\(r\)&&!agentToolsIsApproved\(e,r,n\)/,
  "high-risk tool calls must support an explicit confirmation gate",
);

assert.match(
  source,
  /e\.type\.startsWith\(`agentTools\.`\)\?\(agentToolsHandleMessage\(e\)\.then\(n\),!0\)/,
  "runtime agentTools.* messages must be routed to the background handler",
);

console.log("background agent tools wiring tests passed");
