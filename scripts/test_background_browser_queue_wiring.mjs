import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../src/ai-assistant/background/index.js", import.meta.url), "utf8");

assert.match(
  source,
  /BrowserControlActionQueue\s+as\s+BCQueue/,
  "background must import BrowserControlActionQueue as BCQueue",
);

assert.match(
  source,
  /BCQ\s*=\s*new\s+BCQueue/,
  "background must instantiate a shared browser control queue",
);

assert.match(
  source,
  /browser\.take_snapshot[\s\S]{0,120}?BCQ\.enqueue\([\s\S]{0,120}?D\.takeSnapshot/,
  "browser.take_snapshot must be routed through BrowserControlActionQueue",
);

assert.match(
  source,
  /r\.id\.startsWith\(`browser\.`\)[\s\S]{0,120}?BCQ\.enqueue\([\s\S]{0,120}?D\.executeBrowserTool/,
  "browser.* tools must be routed through BrowserControlActionQueue",
);

console.log("background browser queue wiring tests passed");
