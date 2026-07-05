# AI 侧边栏 Agent 架构与演进方案

## 目标

本侧边栏后续按“开发者级浏览器 Agent”演进，而不是只做普通聊天框。必须同时保证：

1. **丝滑操控浏览器**：保留并增强基于 `chrome.debugger` / CDP 的快照、点击、填写、按键、等待、弹窗处理能力。
2. **分析接口辅助开发**：保留 DevTools Network 桥接能力，当前支持请求列表、详情、清空缓存、只读差异分析、关键参数候选和 JS 候选片段；curl / fetch / 类型生成作为后续评估方向。
3. **工具与 MCP 可扩展**：所有内置工具、后续本地工具、MCP Bridge 工具都通过统一 Tool Registry 暴露给模型。
4. **高可用**：主聊天永远可用；页面上下文、Network、浏览器控制、MCP 都是增强能力，失败时只降级对应能力。

## 分层架构

```text
Side Panel UI
  ├─ Chat / Settings / History
  ├─ Tool status surfaces
  └─ Explicit user confirmations
        ↓
Background Tool Router
  ├─ ToolRegistry
  ├─ ToolActionQueue
  ├─ Permission / consent gate
  └─ Error isolation
        ↓
Capability Services
  ├─ BrowserControlService  → chrome.debugger / CDP
  ├─ PageContextService     → content script / scripting injection
  ├─ NetworkContextService  → DevTools port bridge
  ├─ ScreenshotService      → tabs.captureVisibleTab
  └─ McpBridgeAdapter       → Native Host / local HTTP / remote gateway
```

## 浏览器控制原则

浏览器控制是核心能力，不应移除。需要做到：

- 所有动作进入串行 `ToolActionQueue`，避免多个工具并发抢焦点或抢 CDP 会话。
- `take_snapshot` 之后的 `click / fill` 使用快照 UID，动作后自动提示刷新快照。
- 支持 `wait_for`、导航等待、弹窗等待、debugger 断开恢复。
- `debugger` 权限需要显式开关，UI 必须显示“已开启 / 已关闭”。
- 浏览器控制失败只影响该工具调用，不影响聊天、设置、历史等基础能力。

当前已把“浏览器控制”入口显式加回历史抽屉 footer，避免只依赖隐藏顶栏按钮。

当前已新增浏览器控制共享层：

- `src/shared/browser-control-contract.mjs`
  - 定义 `take_snapshot / click / fill / press_key / wait_for / scroll_page / wait_for_network_idle / navigate_page / new_page / list_pages / select_page / close_page` 的工具 ID、参数 schema、权限域和参数校验。
  - 可把这些工具转换为 `ToolRegistry` 可注册的工具定义。
- `src/shared/browser-control-queue.mjs`
  - 提供 `BrowserControlActionQueue`。
  - 对合法动作串行执行；非法参数不会进入执行器；单个动作失败或超时不会阻塞后续动作。
  - 目前作为低风险外层封装，不直接改动压缩后的 CDP 执行逻辑。

当前后台工具路由已接入该队列：

- `browser.take_snapshot` 进入 `BrowserControlActionQueue` 后再执行快照。
- 其他 `browser.*` 工具（点击、填写、按键、等待文本、滚动、等待网络空闲、导航、新建/切换/关闭页面等）也进入同一个队列。
- 因此同一轮或连续轮模型触发多个浏览器动作时，会按顺序执行，避免并发抢焦点、并发导航或同时占用 CDP 会话。
- 队列参数校验失败会直接返回工具错误，不会进入 CDP 执行器，也不会阻断后续浏览器动作。

当前已新增两个“丝滑操控”工具：

- `browser.scroll_page` / `scroll_page`：按 `up / down / left / right / top / bottom` 滚动页面，可选返回最新快照。
- `browser.wait_for_network_idle` / `wait_for_network_idle`：等待页面资源数量稳定，适合导航、提交表单或触发接口后再读取页面状态。

## Phase 2：Playbook 与 browser.extract_content

`src/shared/automation-playbooks.mjs` 保存 Phase 2 的内置任务策略、设置归一化、选择触发启发式和选中策略 prompt。当前只启用 `page_reading` 和 `multi_page_synthesis`，不包含表单提交、Network/API、Runtime、Replay 或 Full Access 策略。

聊天发送前，后台会根据用户最新消息和当前页面上下文判断是否需要 Playbook 预选。预选请求禁用工具调用并设置 `skipAutomationPlaybookSelection`，避免递归选择；成功选择后，选中 Playbook 的约束会追加到浏览器工具系统提示里，不覆盖基础安全规则。

`src/shared/browser-extract-content.mjs` 定义 `browser.extract_content` 的工具 ID、模型函数名、参数 schema、选择器约束和结果格式化。该工具只读，复用现有 `pageContext.extract` 内容脚本路径，不执行模型自定义脚本，不读取 Cookie、Storage 或跨域 iframe。

`src/ai-assistant/background/browser-extract-content-service.js` 是后台执行适配层，负责读取保存的提取规则、调用当前页面提取路径，并返回工具结果对象。`src/ai-assistant/background/index.js` 会把 `browser.extract_content` 暴露给聊天工具列表，并在通用 `browser.*` 分支之前分发到该适配层。

`browser.extract_content` 进入统一工具审计链路。审计记录只保存脱敏参数和结果摘要，优先使用工具返回的 `summary`，不保存页面正文、HTML 原文、Cookie、Storage 或跨域 iframe 内容。

Phase 2 不迁入 Console、Performance、Debugger Network recorder、`network.*`、`js.*`、`sourcemap.*`、`runtime.*`、`replay.*`、`full_access.*`、上游 React/TypeScript/Vite 设置页或高风险表单交互 Playbook。这些能力需要单独设计、权限确认和验证。

## Network / 接口分析原则

Network 是开发辅助核心能力，但必须默认脱敏：

- 默认脱敏请求/响应头中的 `authorization`、`cookie`、`set-cookie`、`x-api-key` 等敏感字段。
- 默认脱敏 URL query、JSON body、文本 body 中的 token / secret / password / apiKey 等字段。
- 返回结果保留 `redacted: true/false`，让 UI 和模型知道内容是否被处理过。
- 如后续需要“包含敏感头/完整 body”，必须由用户对单次请求显式确认。

当前已新增 `src/shared/network-redaction.mjs`，并让 `src/ai-assistant/devtools.js` 在进入后台前执行脱敏。

### Phase 3：network.* 只读工具

Phase 3 只迁入两个只读 Network 工具，使用已有 DevTools Network 桥接，不新增 debugger-backed Network recorder：

- `network.list_requests`：读取 DevTools 已采集的请求摘要，支持 `tabId`、`resourceTypes` 和 `limit`。
- `network.get_request_details`：用 `network.list_requests` 返回的 `requestIds` 读取请求/响应详情。

`src/shared/network-tools.mjs` 负责工具 ID、模型函数名、参数 schema、参数归一化、输出格式化和结果摘要。所有输出会再次经过 Network 脱敏与长度截断，保留 `redacted` / `truncated` 标记。

`src/ai-assistant/background/network-tools-service.js` 是后台执行适配层，负责校验参数、调用读取回调、格式化 tool message，并把 DevTools 未连接、参数非法和通道异常转为隔离的工具错误。

后台 wiring 仍复用既有 runtime 消息：`network.list_requests` 调用 `networkContext.getSnapshot`，`network.get_request_details` 调用 `networkContext.getDetails`。实际数据来源仍是 `src/ai-assistant/devtools.js` 中 `chrome.devtools.network` 采集到的 snapshot / details；目标标签页的 DevTools Network 面板必须保持打开并连接。

Phase 3 当时不迁入上游 Network 的差异分析、curl/fetch 生成、类型生成、HAR 导出、请求重放或独立录制器。Phase 4 已迁入基于已脱敏详情的只读差异分析和关键参数候选，Phase 5 已迁入 requestIds 约束版 JS 候选片段，Phase 6 已迁入只清空缓存的 `network.clear_requests`；`network.wait_for_requests`、curl/fetch 生成、类型生成、HAR 导出、请求重放、Replay、Runtime、Full Access、原始 Cookie / Authorization / Token / Secret 仍不作为默认模型工具暴露。

### Phase 4：network.* 只读分析工具

Phase 4 在 Phase 3 的已脱敏详情基础上继续迁入两个低风险 Network 分析工具：

- `network.compare_requests`：读取 2 到 50 个请求详情，输出稳定字段、变化字段和疑似关键参数。
- `network.find_parameter_candidates`：读取 1 到 50 个请求详情，从 query、请求头、JSON/form/text 请求体中提取签名、时间戳、随机数、请求 ID、凭据类字段和编码载荷候选。

这两个工具仍由 `src/shared/network-tools.mjs` 定义参数和纯分析逻辑，由 `src/ai-assistant/background/network-tools-service.js` 调用 `networkContext.getDetails` 读取 DevTools 缓存。分析前会再次经过 `redactNetworkRecord()`，输出只包含脱敏、截断后的字段摘要。

Phase 4 当时不新增 JS 候选片段、`network.clear_requests`、`network.wait_for_requests`、debugger-backed recorder、同源 JS fetch、SourceMap 读取、Runtime evaluate、请求重放或 Full Access。Phase 5 已覆盖 requestIds 约束版 `network.extract_js_candidates`，Phase 6 已覆盖只清空缓存的 `network.clear_requests`；`network.wait_for_requests`、无 requestIds 的全局 JS 搜索、JS/SourceMap、Runtime、Boundary、Replay 和 Full Access 需要后续独立设计授权边界、审计和 UI 确认。

### Phase 5：network.extract_js_candidates

Phase 5 迁入 requestIds 约束版 `network.extract_js_candidates`。该工具只读取 `network.list_requests` 返回并由模型显式传入的 JS 请求详情，从已脱敏、已截断的 `responseBody` 中按默认关键词、显式关键词或 `urlIncludes` 提取有限候选片段。

该阶段不建立 JS 资源索引，不支持无 requestIds 的全局 JS 搜索，不做同源 fetch / 补位，不解析 Source Map，不执行 Runtime，不发送请求，也不读取原始 Cookie、Authorization、Token、Secret 或 Storage。需要更大源码上下文、Source Map 或运行时模块摘要时，应进入后续 `js.*` / `sourcemap.*` / `runtime.*` 独立阶段。

### Phase 6：network.clear_requests

Phase 6 迁入只清空缓存的 `network.clear_requests`。该工具只通过既有 DevTools port 通知 `src/ai-assistant/devtools.js` 清空内存中的 `requestStore`，并同步清空后台 snapshot；随后 DevTools bridge 会推送空 snapshot，下一次 `network.list_requests` 只显示清空后新采集的请求。

该阶段不迁入 `network.wait_for_requests`，因为等待新增请求需要后台和 DevTools 建立一次性等待 RPC、超时语义和断线恢复策略。`network.clear_requests` 不发送请求、不读取响应体、不补 fetch、不执行 Runtime、不接触 Cookie、Authorization、Token、Secret 或 Storage。

## Tool Registry 约定

新增 `src/shared/agent-tool-registry.mjs`，后续工具统一注册为：

```js
{
  id: "browser.click",
  name: "点击元素",
  description: "根据最新快照 UID 点击页面元素",
  inputSchema: { type: "object", required: ["uid"], properties: { uid: { type: "string" } } },
  permission: "browser-control",
  handler: async (input, context) => ({ ok: true })
}
```

权限域固定为：

- `safe`：纯计算、无副作用。
- `page`：读取当前页面内容。
- `network`：读取 DevTools Network。
- `browser-control`：操作浏览器页面。
- `external`：访问外部网络或远端服务。
- `mcp`：通过 MCP Bridge 调用外部工具。

当前“工具和 MCP”入口是通用工具中心。Grok 搜索只是内置预设，不再是唯一 MCP 形态。

当前后台已接入 source-owned `agent-tools-service.js` 路由：

- `agentTools.getStatus`：读取内置工具、MCP Server 设置、已发现工具和最近审计日志。
- `agentTools.configureMcp`：保存 MCP Server 列表，并按需把 Grok 预设配置同步写入本地 Bridge `/config`。
- `agentTools.refreshMcp`：主动刷新全部或指定 Server 的 `tools/list`。
- `agentTools.getAuditLog` / `agentTools.clearAuditLog`：读取或清空最近工具调用审计日志。
- `agentTools.call`：直接调用已注册且启用的 MCP 工具，便于调试。

MCP 配置以 Server 列表保存，Bearer Token 使用 `mcpBearerToken:<serverId>` 独立保存。聊天发送前会根据工具开关、会话启用工具、Server 启用状态和工具禁用状态生成模型可见工具列表。工具执行前后台再次校验 Server 和工具缓存。

MCP 工具会被注册为稳定的 `mcp.<serverId>.<toolName>` 工具 ID，并转换成模型可调用的安全函数名，例如 `mcp.grok-search-127-0-0-1-17333.search` → `mcp_grok_search_127_0_0_1_17333_search`。模型触发 `mcp_*` 工具后，后台通过统一工具分发转发到对应 Server，再把结果作为 tool message 回填聊天循环。

当前 UI 已在历史抽屉 footer 增加“工具和 MCP”入口，可配置：

- 新增 HTTP / Streamable HTTP MCP Server。
- 使用“添加 Grok 搜索预设”快速接入本地 Grok Search MCP Bridge。
- 启用或禁用 MCP Server。
- 刷新并查看 MCP Server 已发现工具。
- 查看最近工具调用审计日志和清空审计日志。

为降低 `sidePanel-layout.js` 的长期维护成本，“工具和 MCP”浮层已拆到独立模块：

- `src/ai-assistant/agent-tools-dialog.js`
  - 负责读取工具状态、配置 MCP Bridge、展示 MCP 工具、展示/清空审计日志。
  - `sidePanel-layout.js` 只保留历史抽屉入口编排。

工具摘要现在会返回风险信息：

- `risk: low | medium | high | external`
- `requiresConfirmation: boolean`

后台已预留强制确认机制：当聊天请求显式传入 `requireHighRiskToolConfirmation: true` 时，`close_page`、外部 MCP / 搜索等高风险或外部工具必须通过 `allowHighRiskToolCalls` 或批准列表显式放行，否则只返回 `confirmation_required` 工具错误，不会执行副作用。默认不强制开启，避免牺牲浏览器操控的可用性；后续可在 UI 上接“本次允许 / 总是允许”。

## 工具调用审计日志

为保证强能力“可用、可控、可追踪”，后台已为统一工具分发增加工具调用审计日志：

- 最近保留 80 条工具调用记录，并持久化到 `chrome.storage.local` 的 `aiSidebar.agentTools.audit.v1`。
- 审计覆盖统一工具分发下的浏览器控制、MCP、搜索、系统时间等工具。
- 每条记录包含工具 ID、函数名、展示名、权限域、开始/结束时间、耗时、状态、脱敏后的参数、结果摘要或错误信息。
- 参数默认通过统一脱敏逻辑处理，`apiKey`、`token`、`secret`、`password`、`authorization`、`cookie` 等字段不会以原文写入聊天工具记录或审计日志。
- 用户可在“工具和 MCP”浮层查看最近工具调用，也可以一键清空审计日志。

审计日志保留最近 80 条工具调用，参数和结果摘要默认脱敏。审计日志用于复盘工具调用，不保存 Bearer Token、API Key、Cookie 或响应体原文。

该能力用于排查工具失败、确认模型实际调用了哪些强能力，并避免 MCP / 浏览器控制等外部副作用变成不可见黑盒。审计日志只记录摘要和脱敏参数，不替代后续远程 MCP Gateway 所需的认证、授权和服务端审计。

## MCP 接入路径

浏览器扩展通常不能直接运行 stdio MCP server，因此推荐三种路径：

1. **Native Messaging Host**：最适合本地开发者工具，权限清晰，能力强。
2. **Local HTTP/WebSocket MCP Bridge**：开发最快，适合原型和个人工作流。
3. **Remote MCP Gateway**：适合团队共享工具，但必须有认证和审计。

`createHttpMcpToolAdapter()` 先按本地 HTTP Bridge 预留：

- `GET /tools/list`
- `POST /tools/call`，body: `{ toolId, input }`

当前版本已经支持在后台按需把 MCP 工具转换为 Tool Registry 定义。出于安全考虑，设置入口当前只允许 `localhost / 127.0.0.1` 本地地址；Remote MCP Gateway 后续再单独加认证、审计和用户确认。

当前已新增零依赖示例 Bridge：

- `examples/mcp-bridge/server.mjs`
- `examples/mcp-bridge/README.md`

启动后默认提供 `http://127.0.0.1:17333/`，内置 `dev.echo`、`dev.current_time`、`dev.summarize_request` 三个示例工具，便于后续快速添加本地开发工具。

## 高可用重构顺序

1. 给当前侧边栏补 smoke test：打开、设置模型、发消息、上下文、Network、浏览器控制开关。
2. 先封装 Tool Registry / Network redaction / Browser action queue，不直接大拆 UI bundle。
3. 把 `sidePanel-layout.js` 中的 DOM patch 逐步迁回组件源码。
4. 给强能力加显式状态、错误隔离、重连和降级。
5. 最后再收紧 manifest 权限；每收紧一个权限必须有对应降级路径。

## 当前验证命令

当前已补上第一层高可用验证脚本：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\verify_ai_sidebar_quality.ps1
```

它会依次执行：

- `node --check`：检查侧边栏增强脚本、DevTools 脚本和共享模块语法。
- `node scripts\test_network_redaction.mjs`：验证 Network URL、headers、JSON/body 脱敏。
- `node scripts\test_tool_registry.mjs`：验证工具注册、参数校验、串行队列、MCP HTTP adapter。
- `node scripts\test_browser_control_queue.mjs`：验证浏览器控制契约、队列顺序、非法参数拦截、失败后续跑、超时。
- `node scripts\test_background_browser_queue_wiring.mjs`：验证后台 `browser.*` 工具路由已接入 `BrowserControlActionQueue`。
- `node scripts\test_background_agent_tools_wiring.mjs`：验证后台 Tool Registry / MCP 路由已接入聊天工具分发和 runtime 消息。
- `python scripts\verify_ai_sidebar_core.py`：加载扩展并验证侧边栏不白屏、历史抽屉、浏览器控制入口、工具菜单、添加标签页弹窗。
- 该 smoke test 还会种入一条已脱敏工具审计记录，验证“工具和 MCP”浮层能展示并清空审计日志。
- `python scripts\verify_browser_control_attach.py`：启动本地普通 HTTP 页面，验证 `browserControl.setEnabled` 可以 attach / detach，不依赖真实模型调用。
- `python scripts\verify_browser_control_tool_loop.py`：启动本地普通 HTTP 页面和本地假 OpenAI 接口，验证 `chat.send → wait_for_network_idle → scroll_page → take_snapshot → click → 最终回复` 的真实工具闭环。
- `python scripts\verify_mcp_bridge_tool_loop.py`：启动本地假 MCP Bridge 和假 OpenAI 接口，验证 `chat.send → mcp_dev_echo → POST /tools/call → 最终回复` 的真实 MCP 工具闭环。

Phase 3/4/5/6 的 `network.list_requests`、`network.get_request_details`、`network.clear_requests`、`network.compare_requests`、`network.find_parameter_candidates`、`network.extract_js_candidates` 纯 Node 回归由 `npm test` 中的 `node scripts\test_network_tools.mjs` 覆盖；修改 Network 工具契约或后台适配时，也应单独运行 `node scripts\test_network_tools.mjs` 和 `node scripts\test_background_agent_tools_wiring.mjs`。

CI 已预置：

- `.github/workflows/ai-sidebar-quality.yml`
  - Windows runner。
  - 安装 Node.js、Python Playwright 和 Chromium。
  - 执行同一条 `scripts\verify_ai_sidebar_quality.ps1` 质量门。

## 不做的事

- 不为了“最小权限”牺牲浏览器操控和接口分析这两个核心能力。
- 不把 Network 原始敏感信息默认发给模型。
- 不让 MCP / 浏览器控制失败拖垮主聊天。
- 不继续把新增能力写死在聊天逻辑里。
