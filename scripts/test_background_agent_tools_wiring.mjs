import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";

const backgroundSource = await readFile(new URL("../src/ai-assistant/background/index.js", import.meta.url), "utf8");
const browserExtractContentServiceSource = await readFile(
  new URL("../src/ai-assistant/background/browser-extract-content-service.js", import.meta.url),
  "utf8",
);
const networkToolsServiceSource = await readFile(
  new URL("../src/ai-assistant/background/network-tools-service.js", import.meta.url),
  "utf8",
);
const networkToolsSource = await readFile(new URL("../src/shared/network-tools.mjs", import.meta.url), "utf8");
const devtoolsSource = await readFile(new URL("../src/ai-assistant/devtools.js", import.meta.url), "utf8");
const serviceWorkerSource = await readFile(new URL("../src/background/service-worker.js", import.meta.url), "utf8");
const sidePanelHtml = await readFile(new URL("../src/ai-assistant/index.html", import.meta.url), "utf8");
const sidePanelSource = await readFile(new URL("../src/ai-assistant/sidePanel.js", import.meta.url), "utf8");
const sidePanelPreviewSource = await readFile(
  new URL("../src/ai-assistant/open-design-preview.html", import.meta.url),
  "utf8",
);
const sidePanelLayoutSource = await readFile(
  new URL("../src/ai-assistant/sidePanel-layout.js", import.meta.url),
  "utf8",
);
const agentToolsDialogSource = await readFile(
  new URL("../src/ai-assistant/agent-tools-dialog.js", import.meta.url),
  "utf8",
);
const imagefreeRuntimeSource = await readFile(
  new URL("../src/ai-assistant/assets/imagefree-tool-runtime.js", import.meta.url),
  "utf8",
);

function assertValidEsm(source, label) {
  const result = spawnSync(process.execPath, ["--input-type=module", "--check"], {
    input: source,
    encoding: "utf8",
    timeout: 10000,
  });
  assert.equal(
    result.status,
    0,
    `${label} must parse as ESM before MV3 service worker import:\n${result.stderr}`,
  );
}

assertValidEsm(backgroundSource, "assistant background");
assertValidEsm(browserExtractContentServiceSource, "browser extract content service");
assertValidEsm(networkToolsServiceSource, "network tools service");
assertValidEsm(serviceWorkerSource, "service worker");

assert.match(
  backgroundSource,
  /ToolRegistry\s+as\s+AgentToolRegistry/,
  "background must import ToolRegistry for dynamic agent tools",
);

assert.match(
  backgroundSource,
  /createHttpMcpToolAdapter\s+as\s+createMcpAdapter/,
  "background must import the HTTP MCP adapter",
);

assert.match(
  backgroundSource,
  /agentToolsDefinitionsForChat\(e,n\)/,
  "chat tool definitions must be loaded through the agent tool bridge",
);

assert.match(
  backgroundSource,
  /browser-extract-content-service\.js/,
  "background must import the source-owned extract_content service",
);

assert.match(
  backgroundSource,
  /executeBrowserExtractContentTool/,
  "background must execute browser.extract_content through the source-owned service",
);

assert.match(
  backgroundSource,
  /network-tools-service\.js/,
  "background must import the source-owned Network tools service",
);

assert.match(
  backgroundSource,
  /network-tools\.mjs/,
  "background must import shared Network tool definitions",
);

assert.match(
  backgroundSource,
  /NETWORK_LIST_REQUESTS_TOOL_ID/,
  "background must expose network.list_requests",
);

assert.match(
  backgroundSource,
  /NETWORK_GET_REQUEST_DETAILS_TOOL_ID/,
  "background must expose network.get_request_details",
);

assert.match(
  backgroundSource,
  /NETWORK_TOOL_DEFINITIONS/,
  "background must append shared Network tool definitions",
);

assert.doesNotMatch(
  backgroundSource,
  /NETWORK_LIST_REQUESTS_TOOL_ID\)\|\|!n\.has\(NETWORK_GET_REQUEST_DETAILS_TOOL_ID\)\)\{let \w=NETWORK_TOOL_DEFINITIONS\.filter/,
  "background must append any missing shared Network tool definitions, not only when Phase 3 tools are absent",
);

assert.match(
  networkToolsSource,
  /NETWORK_CLEAR_REQUESTS_TOOL_ID/,
  "shared Network tools must define network.clear_requests",
);

assert.match(
  networkToolsSource,
  /NETWORK_COMPARE_REQUESTS_TOOL_ID/,
  "shared Network tools must define network.compare_requests",
);

assert.match(
  networkToolsSource,
  /NETWORK_FIND_PARAMETER_CANDIDATES_TOOL_ID/,
  "shared Network tools must define network.find_parameter_candidates",
);

assert.match(
  networkToolsSource,
  /NETWORK_EXTRACT_JS_CANDIDATES_TOOL_ID/,
  "shared Network tools must define network.extract_js_candidates",
);

assert.match(
  networkToolsServiceSource,
  /NETWORK_CLEAR_REQUESTS_TOOL_ID|NETWORK_CLEAR_REQUESTS_TOOL_NAME/,
  "Network tools service must dispatch network.clear_requests",
);

assert.match(
  networkToolsServiceSource,
  /NETWORK_COMPARE_REQUESTS_TOOL_ID|NETWORK_COMPARE_REQUESTS_TOOL_NAME/,
  "Network tools service must dispatch network.compare_requests",
);

assert.match(
  networkToolsServiceSource,
  /NETWORK_FIND_PARAMETER_CANDIDATES_TOOL_ID|NETWORK_FIND_PARAMETER_CANDIDATES_TOOL_NAME/,
  "Network tools service must dispatch network.find_parameter_candidates",
);

assert.match(
  networkToolsServiceSource,
  /clearNetworkRequests/,
  "Network tools service must call a clearNetworkRequests adapter for network.clear_requests",
);

assert.match(
  backgroundSource,
  /clearNetworkRequests:\(\{tabId:\w\}=\{\}\)=>dn\(\{type:`networkContext\.clearRequests`,tabId:\w\}\)/,
  "background must wire network.clear_requests to networkContext.clearRequests",
);

assert.match(
  backgroundSource,
  /networkContext\.getSnapshot`\|\|e\.type===`networkContext\.getDetails`\|\|e\.type===`networkContext\.clearRequests`/,
  "runtime message handler must accept networkContext.clearRequests",
);

assert.match(
  backgroundSource,
  /networkContext\.clearRequests`\}\)\}catch\{return\{ok:!1,message:rn\}\}t\.requests=\[\];return\{ok:!0,tabId:t\.tabId,clearedCount:n\}/,
  "background must clear its cached Network snapshot only after DevTools clear postMessage succeeds",
);

assert.match(
  devtoolsSource,
  /networkContext\.clearRequests/,
  "DevTools bridge must listen for networkContext.clearRequests",
);

assert.match(
  devtoolsSource,
  /requestStore\.clear\(\);[\s\S]*postSnapshotUpdated\(\)/,
  "DevTools bridge must clear the request store and publish an empty snapshot",
);

assert.match(
  networkToolsServiceSource,
  /function resolveNetworkToolKind\(name\) \{[\s\S]*?if \(name === NETWORK_EXTRACT_JS_CANDIDATES_TOOL_ID \|\| name === NETWORK_EXTRACT_JS_CANDIDATES_TOOL_NAME\) \{\s*return "extract-js-candidates";\s*\}/,
  "Network tools service must resolve network.extract_js_candidates to the extract-js-candidates dispatch kind",
);

assert.match(
  networkToolsServiceSource,
  /export async function executeNetworkTool\(toolCall, options = \{\}\) \{[\s\S]*?const toolKind = resolveNetworkToolKind\(toolCall\?\.name\);[\s\S]*?if \(toolKind === "extract-js-candidates"\) return executeNetworkExtractJsCandidatesTool\(toolCall, options\);/,
  "Network tools service must dispatch the extract-js-candidates kind to executeNetworkExtractJsCandidatesTool",
);

assert.match(
  backgroundSource,
  /JS 候选片段|network_extract_js_candidates/,
  "background prompt must mention Phase 5 Network JS candidate extraction",
);

assert.match(
  backgroundSource,
  /automation-playbooks\.mjs/,
  "background must import the Phase 2 Playbook helpers",
);

assert.match(
  backgroundSource,
  /shouldRunAutomationPlaybookSelection/,
  "background must gate Playbook selection with the local heuristic",
);

assert.match(
  backgroundSource,
  /createAutomationPlaybookSelectionPrompt/,
  "background must build a model-facing Playbook selection prompt",
);

assert.match(
  backgroundSource,
  /createSelectedAutomationPlaybookPrompt/,
  "background must inject selected Playbook prompt text",
);

assert.match(
  backgroundSource,
  /browser\.extract_content|extract_content/,
  "background must expose and dispatch browser.extract_content",
);

assert.match(
  backgroundSource,
  /不执行自定义脚本，不读取 Cookie、Storage 或跨域 iframe/,
  "browser prompt must include extract_content read-only safety boundaries",
);

assert.match(
  backgroundSource,
  /r\.id===`browser\.extract_content`&&r\.name===`extract_content`\?BCQ\.enqueue\(n,\(\)=>executeBrowserExtractContentFromBackground\(n\)\):r\.id\.startsWith\(`browser\.`\)/,
  "extract_content must be dispatched before the generic browser.* branch",
);

assert.match(
  backgroundSource,
  /r\.id\.startsWith\(`network\.`\)\?executeNetworkToolFromBackground\(n\):r\.id\.startsWith\(`mcp\.`\)\?agentToolsExecuteMcp\(n,r,t\)/,
  "network.* tool calls must be dispatched before the mcp.* branch",
);

assert.match(
  backgroundSource,
  /需要分析页面请求时[\s\S]*DevTools 已采集的请求摘要[\s\S]*DevTools 面板必须保持打开并连接/,
  "background prompt must explain that Network tools use DevTools-collected request summaries",
);

assert.match(
  backgroundSource,
  /需要读取请求\/响应详情时[\s\S]*已脱敏、截断[\s\S]*不要要求或猜测 Cookie、Authorization、Token、Secret 原文/,
  "background prompt must include Network redaction, truncation, and sensitive-field boundaries",
);

assert.match(
  backgroundSource,
  /接口差异分析|差异分析/,
  "background prompt must mention Phase 4 Network request comparison",
);

assert.match(
  backgroundSource,
  /关键参数候选|关键参数/,
  "background prompt must mention Phase 4 Network parameter candidate discovery",
);

assert.match(
  backgroundSource,
  /network_compare_requests[\s\S]*network_find_parameter_candidates/,
  "background prompt must route Phase 4 Network analysis through the read-only redacted tools",
);

assert.match(
  browserExtractContentServiceSource,
  /createBrowserExtractContentRules/,
  "extract content service must build temporary selector rules",
);

assert.match(
  browserExtractContentServiceSource,
  /formatBrowserExtractContentResult/,
  "extract content service must format tool output through the shared formatter",
);

assert.match(
  backgroundSource,
  /r\.id\.startsWith\(`mcp\.`\)\?agentToolsExecuteMcp\(n,r,t\)/,
  "mcp.* tool calls must be dispatched to the agent tool registry",
);

assert.match(
  backgroundSource,
  /requireHighRiskToolConfirmation===!0&&agentToolsNeedsConfirmation\(r\)&&!agentToolsIsApproved\(e,r,n\)/,
  "high-risk tool calls must support an explicit confirmation gate",
);

assert.match(
  backgroundSource,
  /handleAgentToolsMessage/,
  "background must route agentTools messages through the source-owned service",
);

assert.match(
  backgroundSource,
  /agent-tools-service\.js/,
  "background must import the source-owned agent tools service",
);

assert.match(
  backgroundSource,
  /e\.type\.startsWith\(`agentTools\.`\)\?\(handleAgentToolsMessage\(e,fetch\)\.then\(n\),!0\)/,
  "runtime agentTools.* messages must be routed to the source-owned background service",
);

const finalToolRecordsReturnMatches =
  backgroundSource.match(
    /\.\.\.i\.length\?\{toolCallRecords:i\}:\{\},\.\.\.a\.length\?\{toolAttachments:a\}:\{\},\.\.\.o\.length\?\{toolTurnMessages:o\}:\{\}/g,
  ) ?? [];
assert.equal(
  finalToolRecordsReturnMatches.length,
  2,
  "background tool loop must return final tool records and attachments in both success exits",
);

assert.match(
  sidePanelSource,
  /\{reasoningContent:t\.reasoningContent,toolCallRecords:t\.toolCallRecords,toolAttachments:Ka\(e\.toolAttachments,t\.toolAttachments\)\}/,
  "streamed assistant completion must persist final tool records for grouped rendering",
);

assert.match(
  sidePanelSource,
  /m=Ga\(m,t\.record\);let n=await u\(\);r&&await Wa\(e\.sessionId,r,t\.record,\[\],e\.set,e\.privateMode\),n&&await Wa\(e\.sessionId,n\.id,t\.record,\[\],e\.set,e\.privateMode\)/,
  "streamed tool start must update the final assistant placeholder as well as the tool-turn message",
);

assert.match(
  sidePanelSource,
  /m=Ga\(m,t\.record\);let n=await u\(\);r&&await Wa\(e\.sessionId,r,t\.record,t\.attachments\?\?\[\],e\.set,e\.privateMode\),n&&await Wa\(e\.sessionId,n\.id,t\.record,t\.attachments\?\?\[\],e\.set,e\.privateMode\)/,
  "streamed tool completion must update the final assistant placeholder as well as the tool-turn message",
);

assert.match(
  sidePanelSource,
  /markRunningToolCallsInterrupted\(e\.toolCallRecords,n\)/,
  "interrupted streams must not leave final assistant tool records stuck in running state",
);

assert.match(
  sidePanelSource,
  /r&&m\.some\(e=>e\.status===`running`\)&&await Va\(e\.sessionId,r,n,e\.set,e\.privateMode\),t&&await Va\(e\.sessionId,t\.id,n,e\.set,e\.privateMode\)/,
  "streamed error responses must also close the temporary tool-turn message instead of leaving it running",
);

assert.match(
  sidePanelSource,
  /r&&m\.some\(e=>e\.status===`running`\)&&await Va\(e\.sessionId,r,Fa,e\.set,e\.privateMode\),t&&await Va\(e\.sessionId,t\.id,Fa,e\.set,e\.privateMode\)/,
  "stream disconnects must also close the temporary tool-turn message instead of leaving it running",
);

assert.match(
  sidePanelSource,
  /D=e\.role!==`assistant`\?!0:o\?E\|\|ee\|\|!!e\.attachments\?\.length\|\|!!x\(e\)\.length:E\|\|ee\|\|!!e\.attachments\?\.length\|\|!!x\(e\)\.length\|\|!e\.toolCallRecords\?\.length/,
  "tool-only final assistant placeholders must not render an empty assistant bubble",
);

assert.match(
  sidePanelPreviewSource,
  /m3 = Ga2\(m3, t5\.record\);[\s\S]*n5 && await Wa2\(e4\.sessionId, n5\.id, t5\.record/,
  "design preview must mirror live final assistant tool-call updates",
);

assert.match(
  sidePanelPreviewSource,
  /r3 && m3\.some\(\(e5\) => e5\.status === `running`\)[\s\S]*await Va2\(e4\.sessionId, r3, Fa2/,
  "design preview must mirror temporary tool-turn interruption cleanup",
);

assert.match(
  sidePanelSource,
  /let n=za\(t\);o=!0,e\.set\(\{failure:\{message:n\}\}\)/,
  "streamed error responses must mark the stream handled before disconnecting",
);

assert.match(
  sidePanelSource,
  /networkContextAttachment:a\.attachment,toolCallRecords:m\.toolCallRecords,toolAttachments:Ka\(p,m\.toolAttachments\)/,
  "non-stream assistant completion must persist final tool records for grouped rendering",
);

assert.match(
  imagefreeRuntimeSource,
  /IMAGEFREE_TOOL_ID\s*=\s*"imagefree\.generate_image"/,
  "Imagefree runtime must define a stable tool id",
);

assert.match(
  imagefreeRuntimeSource,
  /IMAGEFREE_TOOL_NAME\s*=\s*"imagefree_generate_image"/,
  "Imagefree runtime must define an AI-callable tool name",
);

assert.match(
  imagefreeRuntimeSource,
  /https:\/\/imagefree\.net`?;?/,
  "Imagefree runtime must target imagefree.net",
);

assert.match(
  imagefreeRuntimeSource,
  /\/api\/generate/,
  "Imagefree runtime must call the generate endpoint",
);

assert.match(
  imagefreeRuntimeSource,
  /\/status/,
  "Imagefree runtime must poll the status endpoint",
);

assert.match(
  imagefreeRuntimeSource,
  /IMAGEFREE_TURNSTILE_SITE_KEY\s*=\s*"0x4AAAAAACE-XLGoQUckKKm_"/,
  "Imagefree runtime must use the current Turnstile site key",
);

assert.match(
  imagefreeRuntimeSource,
  /IMAGEFREE_TURNSTILE_BACKGROUND_ATTEMPT_MS\s*=\s*2500/,
  "Imagefree runtime must try background Turnstile resolution before focusing the tab",
);

assert.match(
  imagefreeRuntimeSource,
  /turnstile_token:\s*\{[\s\S]*type:\s*"string"/,
  "Imagefree tool schema must accept a Turnstile token when one is supplied by the runtime",
);

assert.match(
  imagefreeRuntimeSource,
  /resolveImagefreeTurnstileToken\(input\.turnstile_token,\s*options\)/,
  "Imagefree runtime must resolve a real Turnstile token before generate requests",
);

assert.match(
  imagefreeRuntimeSource,
  /createImagefreeTurnstileTokenProvider\(options\)/,
  "Imagefree runtime must keep token provider selection isolated from generate request wiring",
);

assert.match(
  imagefreeRuntimeSource,
  /options\.turnstileTokenProvider[\s\S]*typeof provider\.resolve === "function"/,
  "Imagefree runtime must expose an internal provider hook for authorized future token sources",
);

assert.match(
  imagefreeRuntimeSource,
  /return\s*\{\s*resolve:\s*requestImagefreeTurnstileTokenFromTab\s*\}/,
  "Imagefree runtime must default token resolution to the built-in tab verification flow",
);

assert.match(
  imagefreeRuntimeSource,
  /turnstile_token:\s*turnstileToken/,
  "Imagefree runtime must send the resolved Turnstile token to the generate endpoint",
);

assert.doesNotMatch(
  imagefreeRuntimeSource,
  /turnstile_token:\s*null/,
  "Imagefree runtime must not send a null Turnstile token",
);

assert.match(
  imagefreeRuntimeSource,
  /chromeApi\.scripting\.executeScript[\s\S]*world:\s*"MAIN"[\s\S]*func:\s*imagefreeTurnstileTokenScript/,
  "Imagefree runtime must inject the Turnstile helper into the page main world",
);

assert.match(
  imagefreeRuntimeSource,
  /tabs\.create,\s*\{\s*url:\s*IMAGEFREE_PAGE_URL,\s*active:\s*false\s*\}/,
  "Imagefree runtime must open the Turnstile page in the background first",
);

assert.match(
  imagefreeRuntimeSource,
  /setTimeout\(\(\)\s*=>\s*\{[\s\S]*focusImagefreeTurnstileTab\(chromeApi,\s*tab\)/,
  "Imagefree runtime must focus the Turnstile tab only after background resolution does not finish quickly",
);

assert.match(
  imagefreeRuntimeSource,
  /globalThis\.__imagefreeGenerateTool\s*=\s*executeImagefreeGenerateTool/,
  "Imagefree runtime must expose a background executor",
);

assert.match(
  imagefreeRuntimeSource,
  /IMAGEFREE_TOOL_SELECTION_MIGRATION_KEY\s*=\s*"imagefreeToolSelectionMigration\.v1"/,
  "Imagefree runtime must define a one-time selection migration key",
);

assert.match(
  imagefreeRuntimeSource,
  /lt\s+as\s+readAppSetting/,
  "Imagefree runtime must be able to read saved chat preferences for migration",
);

assert.match(
  imagefreeRuntimeSource,
  /yt\s+as\s+writeAppSetting/,
  "Imagefree runtime must be able to write migrated chat preferences",
);

assert.match(
  imagefreeRuntimeSource,
  /dt\s+as\s+listChatSessions/,
  "Imagefree runtime must inspect saved sessions for per-session tool overrides",
);

assert.match(
  imagefreeRuntimeSource,
  /xt\s+as\s+writeChatSession/,
  "Imagefree runtime must persist migrated per-session tool overrides",
);

assert.doesNotMatch(
  imagefreeRuntimeSource,
  /await\s+migrateImagefreeToolSelection\(\)/,
  "Imagefree runtime must not block MV3 service worker startup on the selection migration",
);

assert.match(
  imagefreeRuntimeSource,
  /void\s+migrateImagefreeToolSelection\(\)/,
  "Imagefree runtime must start the selection migration without blocking side panel startup",
);

assert.match(
  imagefreeRuntimeSource,
  /readAppSetting\("chatPreferences"\)/,
  "Imagefree migration must read global chat preferences",
);

assert.match(
  imagefreeRuntimeSource,
  /key:\s*"chatPreferences"[\s\S]*value:\s*migratedChatPreferences/,
  "Imagefree migration must write global chat preferences when stale enabledToolIds are found",
);

assert.match(
  imagefreeRuntimeSource,
  /listChatSessions\(\)[\s\S]*chatPreferenceOverrides[\s\S]*writeChatSession/,
  "Imagefree migration must cover session-level chatPreferenceOverrides",
);

assert.match(
  imagefreeRuntimeSource,
  /enabledToolIds:\s*\[\.\.\.enabledToolIds,\s*IMAGEFREE_TOOL_ID\]/,
  "Imagefree migration must append the Imagefree tool id to stale enabled tool selections",
);

assert.match(
  serviceWorkerSource,
  /import "\.\.\/ai-assistant\/assets\/imagefree-tool-runtime\.js";/,
  "service worker must load the Imagefree runtime before the assistant background",
);

assert.match(
  sidePanelHtml,
  /src="\.\/assets\/imagefree-tool-runtime\.js"/,
  "side panel must load the Imagefree runtime before rendering tools",
);

assert.match(
  backgroundSource,
  /__imagefreeGenerateTool\(e,fetch\)/,
  "background fallback must dispatch Imagefree tool calls to the runtime executor",
);

assert.match(
  backgroundSource,
  /agentToolsPushMcpGrokConfig/,
  "background must push saved Grok MCP config into the local bridge",
);

assert.match(
  backgroundSource,
  /new URL\(`\/config`,t\.baseUrl\)[\s\S]*method:`POST`/,
  "background must POST Grok MCP config to the bridge /config endpoint",
);

assert.match(
  backgroundSource,
  /grok-4\.20-multi-agent-xhigh/,
  "background must default Grok MCP model to grok-4.20-multi-agent-xhigh",
);

assert.match(
  backgroundSource,
  /https:\/\/api\.x\.ai\/v1/,
  "background must default Grok MCP API base URL to xAI",
);

assert.match(
  backgroundSource,
  /hasGrokApiKey/,
  "background status must expose whether a Grok API key is configured without leaking it in mcp status",
);

assert.match(
  backgroundSource,
  /agentToolsPublicSettings/,
  "background status must return public settings without echoing the saved Grok API key",
);

assert.match(
  backgroundSource,
  /clearGrokApiKey/,
  "background must support explicit Grok API key clearing instead of treating empty input as clear",
);

assert.match(
  backgroundSource,
  /t\.mcp\.grokApiKey/,
  "background must preserve the previous Grok API key when configureMcp receives an empty key",
);

assert.match(
  backgroundSource,
  /forceEmptyApiKey/,
  "background must be able to intentionally push an empty API key to the local bridge only on explicit clear",
);

assert.match(
  agentToolsDialogSource,
  /留空不修改/,
  "agent tools dialog must communicate that an empty Grok API key field preserves the saved key",
);

assert.match(
  agentToolsDialogSource,
  /工具和 MCP/,
  "agent tools dialog must be the generic Tools and MCP center",
);

assert.match(
  agentToolsDialogSource,
  /MCP Server|添加 Grok 搜索预设|审计日志|最近工具调用/,
  "agent tools dialog must expose server management, Grok preset, and audit log",
);

assert.match(
  agentToolsDialogSource,
  /MCP Server/,
  "dialog must include MCP Server management copy",
);

assert.match(
  agentToolsDialogSource,
  /添加 Grok 搜索预设/,
  "dialog must include Grok preset action",
);

assert.match(
  agentToolsDialogSource,
  /最近工具调用|审计日志/,
  "dialog must include audit log copy",
);

assert.match(
  agentToolsDialogSource,
  /agentTools\.clearAuditLog|getAuditLog|clearAuditLog/,
  "agent tools dialog must support clearing the audit log",
);

assert.match(
  agentToolsDialogSource,
  /agentTools\.clearAuditLog|clearAuditLog/,
  "dialog must clear audit log",
);

assert.doesNotMatch(
  agentToolsDialogSource,
  /title\.textContent = "Grok 搜索 MCP"/,
  "dialog title must not be Grok-only",
);

assert.match(
  agentToolsDialogSource,
  /clearGrokApiKey:\s*true/,
  "agent tools dialog must use an explicit clear action for the saved Grok API key",
);

assert.doesNotMatch(
  agentToolsDialogSource,
  /apiKeyInput\.value\s*=\s*settings\.grokApiKey/,
  "agent tools dialog must not echo the full saved Grok API key into the password field",
);

assert.match(
  sidePanelHtml,
  /notification-host\.js/,
  "side panel must load the notification host before adapter dialogs use it",
);

assert.match(
  agentToolsDialogSource,
  /showAiSidebarNotification/,
  "agent tools dialog must use the shared notification host",
);

assert.match(
  `${sidePanelPreviewSource}\n${sidePanelLayoutSource}`,
  /token-usage-meter|Token 暂无|Token 统计中/,
  "side panel preview must include token usage meter copy or adapter hooks",
);

assert.match(
  `${sidePanelPreviewSource}\n${sidePanelLayoutSource}`,
  /model-select-group|按渠道|channel/,
  "side panel preview must include grouped model selector hooks",
);

assert.match(
  sidePanelLayoutSource,
  /renderTokenUsageMeter|token-usage-meter/,
  "layout adapter must render the token usage meter",
);

assert.match(
  sidePanelLayoutSource,
  /groupModelOptionsByChannel|model-select-group/,
  "layout adapter must group model options by channel",
);

console.log("background agent tools wiring tests passed");
