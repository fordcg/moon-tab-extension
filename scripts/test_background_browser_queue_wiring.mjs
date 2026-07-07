import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../src/background/browserControlMessageHandler.ts", import.meta.url), "utf8");
const backgroundSource = await readFile(new URL("../src/background/index.ts", import.meta.url), "utf8");

assert.match(
  source,
  /import \{\s*BrowserControlActionExecutor,[\s\S]*?\} from "\.\/browserControl\/actions"/,
  "browser control handler must import the source-owned browser action executor",
);

assert.match(
  source,
  /private readonly snapshotManager: BrowserControlSnapshotManager;/,
  "browser control manager must own the source snapshot manager",
);

assert.match(
  source,
  /this\.snapshotManager = new BrowserControlSnapshotManager\(this\.connection, \(\) => this\.getTargetTabInfo\(\)\)/,
  "browser control manager must instantiate a shared source snapshot manager",
);

assert.match(
  source,
  /this\.actionExecutor = new BrowserControlActionExecutor\(this\.connection, this\.snapshotManager,[\s\S]{0,180}?waitForNetworkIdle: \(options\) => this\.networkRecorder\.waitForIdle\(\{ timeoutMs: options\.timeoutMs \}\)/,
  "browser action tools must be routed through the shared source action executor",
);

assert.match(
  source,
  /async takeSnapshot\(toolCall: ModelToolCall\): Promise<ModelToolResult> \{[\s\S]{0,420}?content: await this\.snapshotManager\.takeSnapshot\(\)/,
  "browser.take_snapshot must be routed through the shared source snapshot manager",
);

assert.match(
  source,
  /async executeBrowserTool\(toolCall: ModelToolCall\): Promise<ModelToolResult> \{[\s\S]*?const result = await this\.actionExecutor\.execute\(toolCall\)/,
  "browser.* tools must be routed through the shared source action executor",
);

assert.match(
  source,
  /this\.networkToolExecutor = new BrowserNetworkToolExecutor\(this\.networkRecorder,[\s\S]{0,360}?\(\) => this\.canExposeFullAccessTool\(\)\)/,
  "network tools must be routed through the shared source network executor",
);

assert.match(
  source,
  /async executeNetworkTool\(toolCall: ModelToolCall\): Promise<ModelToolResult> \{[\s\S]{0,700}?this\.networkToolExecutor\.execute\(toolCall\)/,
  "browser control network tools must execute through BrowserNetworkToolExecutor",
);

assert.match(
  backgroundSource,
  /createBackgroundToolExecutor\(chatMessage, fetch,[\s\S]*createNetworkCompatibilityExecutor\(tabId\)/,
  "background stream wiring must pass the source Network compatibility executor into the tool runtime",
);

console.log("background browser queue wiring tests passed");
