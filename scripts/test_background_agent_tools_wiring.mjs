import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const backgroundSource = await readFile(new URL("../src/background/index.ts", import.meta.url), "utf8");
const backgroundRuntimeSource = await readFile(new URL("../src/background/backgroundToolRuntime.ts", import.meta.url), "utf8");
const agentToolsSource = await readFile(new URL("../src/background/agentToolsMessageHandler.ts", import.meta.url), "utf8");
const networkBridgeSource = await readFile(new URL("../src/background/networkDevtoolsBridge.ts", import.meta.url), "utf8");
const devtoolsSource = await readFile(new URL("../src/devtools/network.ts", import.meta.url), "utf8");
const imagefreeRuntimeSource = await readFile(new URL("../src/background/imagefreeToolRuntime.ts", import.meta.url), "utf8");
const sidePanelEntrySource = await readFile(new URL("../src/side-panel/main.tsx", import.meta.url), "utf8");
const sidePanelAppSource = await readFile(new URL("../src/side-panel/App.tsx", import.meta.url), "utf8");
const sidePanelSettingsSource = await readFile(new URL("../src/side-panel/components/SettingsPanel.tsx", import.meta.url), "utf8");

function assertContains(source, pattern, message) {
  assert.match(source, pattern, message);
}

function assertNotContains(source, pattern, message) {
  assert.doesNotMatch(source, pattern, message);
}

assertContains(backgroundSource, /import "\.\/imagefreeToolRuntime";/, "background imports source-owned Imagefree runtime");
assertContains(backgroundSource, /src\/devtools\/network\.html/, "background trusts source-owned DevTools Network page");
assertContains(networkBridgeSource, /src\/devtools\/network\.html/, "Network bridge trusts source-owned DevTools Network page");
assertContains(devtoolsSource, /chrome\.devtools\.network\.onRequestFinished/, "source DevTools collector watches Network requests");
assertContains(devtoolsSource, /networkContext\.detailsResponse/, "source DevTools collector returns request details");
assertContains(imagefreeRuntimeSource, /globalThis\.__imagefreeGenerateTool = executeImagefreeGenerateTool/, "Imagefree source runtime registers global hook");
assertContains(sidePanelEntrySource, /createRoot/, "React side panel entry renders app");
assertContains(sidePanelAppSource, /SettingsPanel/, "React side panel app mounts settings UI");
assertContains(sidePanelSettingsSource, /McpToolSettings|ChatPreferenceSettings/, "React side panel owns tool UI entry points");

assertContains(backgroundRuntimeSource, /createBackgroundToolExecutor/, "background runtime creates model tool executor");
assertContains(backgroundRuntimeSource, /BROWSER_EXTRACT_CONTENT_TOOL_ID/, "background runtime dispatches browser.extract_content");
assertContains(backgroundRuntimeSource, /browserControlManager\.extractContent/, "background runtime executes extract_content through browser control manager");
assertContains(backgroundRuntimeSource, /tool\.id\.startsWith\("network\."\)/, "background runtime dispatches network tools by source registry id");
assertContains(backgroundRuntimeSource, /networkCompatibilityExecutor/, "background runtime supports DevTools Network compatibility executor");
assertContains(backgroundRuntimeSource, /IMAGEFREE_GENERATE_IMAGE_TOOL_ID/, "background runtime dispatches Imagefree by source registry id");
assertContains(backgroundRuntimeSource, /executeImagefreeGenerateTool\(toolCall, withAbortSignal\(fetcher, context\?\.signal\)\)/, "background runtime passes the chat cancellation signal to Imagefree");
assertContains(backgroundRuntimeSource, /executeTavilySearchTool\(toolCall, message\.tavily, withAbortSignal\(fetcher, context\?\.signal\)\)/, "background runtime passes the chat cancellation signal to Tavily");
assertContains(backgroundRuntimeSource, /fetcher\(input, \{ \.\.\.init, signal \}\)/, "background runtime injects the cancellation signal into tool fetch calls");
assertContains(backgroundRuntimeSource, /parseMcpToolId\(tool\.id\)/, "background runtime routes MCP registry tools by parsed source id");

assertContains(backgroundRuntimeSource, /需要读取当前页面正文、全文 HTML[\s\S]*不执行自定义脚本，不读取 Cookie、Storage 或跨域 iframe/, "browser prompt includes extract_content read-only safety boundaries");
assertContains(backgroundRuntimeSource, /需要排查页面报错、JS 异常、资源加载失败或控制台日志/, "browser prompt covers console diagnostics");
assertContains(backgroundRuntimeSource, /需要一次性汇总页面状态、Console、性能和 Network/, "browser prompt covers combined diagnostics");
assertContains(backgroundRuntimeSource, /涉及表单提交、删除、付款、发布或发送消息/, "browser prompt keeps high-risk user confirmation boundaries");

assertContains(backgroundSource, /createNetworkDevtoolsBridge\(\)/, "background creates the source Network DevTools bridge");
assertContains(backgroundSource, /networkDevtoolsBridge\.handlePortConnect\(port\)/, "background routes DevTools ports through source bridge");
assertContains(backgroundSource, /message\.type\.startsWith\("networkContext\."\)/, "background detects Network runtime messages by source prefix");
assertContains(backgroundSource, /networkDevtoolsBridge\.handleMessage\(scopedMessage\)/, "background routes Network runtime messages through source bridge");
assertContains(backgroundSource, /BrowserNetworkToolExecutor/, "background uses the source BrowserNetworkToolExecutor for DevTools compatibility");
assertContains(backgroundSource, /DEVTOOLS_LEGACY_NETWORK_TOOL_IDS/, "background constrains DevTools compatibility to legacy Network ids");

assertContains(networkBridgeSource, /createNetworkDevtoolsBridge/, "Network bridge exports source bridge factory");
assertContains(networkBridgeSource, /isTrustedDevtoolsPortSender/, "Network bridge validates DevTools port sender");
assertContains(networkBridgeSource, /networkContext\.getSnapshot/, "Network bridge handles snapshot reads");
assertContains(networkBridgeSource, /networkContext\.getDetails/, "Network bridge handles details reads");
assertContains(networkBridgeSource, /networkContext\.clearRequests/, "Network bridge handles cache clearing");
assertContains(networkBridgeSource, /redactNetworkRequestDetail/, "Network bridge redacts request details");
assertContains(networkBridgeSource, /redactNetworkRequestMeta/, "Network bridge redacts request summaries");

assertContains(devtoolsSource, /requestStore\.clear\(\);[\s\S]*postSnapshotUpdated\(\)/, "DevTools bridge clears request store and publishes an empty snapshot");
assertContains(devtoolsSource, /chrome\.devtools\.network\.getHAR/, "source DevTools collector refreshes HAR snapshot");
assertContains(devtoolsSource, /redactNetworkRequestDetail/, "source DevTools collector redacts details before returning them");
assertContains(devtoolsSource, /redactNetworkRequestMeta/, "source DevTools collector redacts request summaries");

assertContains(agentToolsSource, /DEFAULT_GROK_API_BASE_URL = "https:\/\/api\.x\.ai\/v1"/, "agent tools keep xAI Grok API default");
assertContains(agentToolsSource, /DEFAULT_GROK_MODEL = "grok-4\.20-multi-agent-xhigh"/, "agent tools keep Grok model default");
assertContains(agentToolsSource, /clearGrokApiKey/, "agent tools support explicit Grok API key clearing");
assertContains(agentToolsSource, /agentTools\.clearAuditLog/, "agent tools support clearing the audit log");
assertContains(agentToolsSource, /redactAgentToolValue/, "agent tools redact audit values");
assertContains(agentToolsSource, /pushGrokBridgeConfig/, "agent tools push Grok bridge config from source handler");

assertContains(imagefreeRuntimeSource, /IMAGEFREE_TOOL_ID = IMAGEFREE_GENERATE_IMAGE_TOOL_ID/, "Imagefree runtime uses source registry tool id");
assertContains(imagefreeRuntimeSource, /IMAGEFREE_TOOL_NAME = IMAGEFREE_GENERATE_IMAGE_TOOL_NAME/, "Imagefree runtime uses source registry tool name");
assertContains(imagefreeRuntimeSource, /IMAGEFREE_BASE_URL = "https:\/\/imagefree\.net"/, "Imagefree runtime targets imagefree.net");
assertContains(imagefreeRuntimeSource, /IMAGEFREE_GENERATE_URL = `\$\{IMAGEFREE_BASE_URL\}\/api\/generate`/, "Imagefree runtime calls the generate endpoint");
assertContains(imagefreeRuntimeSource, /IMAGEFREE_STATUS_URL = `\$\{IMAGEFREE_GENERATE_URL\}\/status`/, "Imagefree runtime polls the status endpoint");
assertContains(imagefreeRuntimeSource, /key !== "prompt" && key !== "aspect_ratio"/, "Imagefree runtime rejects caller-provided authentication fields");
assertContains(imagefreeRuntimeSource, /IMAGEFREE_TURNSTILE_SITE_KEY = "0x4AAAAAACE-XLGoQUckKKm_"/, "Imagefree runtime owns the public Turnstile site key used by imagefree.net");
assertContains(imagefreeRuntimeSource, /const turnstileToken = await resolveImagefreeTurnstileToken\(\)/, "Imagefree runtime resolves a fresh Turnstile token before fallback fetch");
assertContains(imagefreeRuntimeSource, /turnstile_token:\s*turnstileToken/, "Imagefree runtime sends the resolved Turnstile token to the public endpoint");
assertNotContains(imagefreeRuntimeSource, /turnstile_token:\s*null/, "Imagefree runtime must not send the obsolete null Turnstile token");
assertNotContains(imagefreeRuntimeSource, /IMAGEFREE_TURNSTILE_BACKGROUND_ATTEMPT_MS/, "Imagefree runtime no longer uses the retired background Turnstile attempt window");
assertContains(imagefreeRuntimeSource, /void migrateImagefreeToolSelection\(\)/, "Imagefree runtime starts selection migration without blocking side panel startup");

assertNotContains(backgroundSource, /src\/ai-assistant/, "background wiring test must not depend on legacy bundle paths");
assertNotContains(backgroundRuntimeSource, /src\/ai-assistant/, "background runtime checks must not depend on legacy bundle paths");
assertNotContains(networkBridgeSource, /src\/ai-assistant/, "Network bridge checks must not depend on legacy bundle paths");

console.log("background agent tools wiring tests passed");
