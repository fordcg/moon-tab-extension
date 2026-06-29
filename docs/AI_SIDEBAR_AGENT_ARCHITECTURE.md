# AI 侧边栏 Agent 架构与演进方案

## 目标

本侧边栏后续按“开发者级浏览器 Agent”演进，而不是只做普通聊天框。必须同时保证：

1. **丝滑操控浏览器**：保留并增强基于 `chrome.debugger` / CDP 的快照、点击、填写、按键、等待、弹窗处理能力。
2. **分析接口辅助开发**：保留 DevTools Network 桥接能力，支持请求列表、详情、差异分析、curl / fetch / 类型生成等开发辅助。
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

## Network / 接口分析原则

Network 是开发辅助核心能力，但必须默认脱敏：

- 默认脱敏请求/响应头中的 `authorization`、`cookie`、`set-cookie`、`x-api-key` 等敏感字段。
- 默认脱敏 URL query、JSON body、文本 body 中的 token / secret / password / apiKey 等字段。
- 返回结果保留 `redacted: true/false`，让 UI 和模型知道内容是否被处理过。
- 如后续需要“包含敏感头/完整 body”，必须由用户对单次请求显式确认。

当前已新增 `src/shared/network-redaction.mjs`，并让 `src/ai-assistant/devtools.js` 在进入后台前执行脱敏。

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

当前后台已接入 `ToolRegistry` / MCP Bridge 的真实路由：

- `agentTools.getStatus`：读取内置工具、MCP 设置、MCP 连接状态和已发现工具。
- `agentTools.configureMcp`：保存本地 MCP Bridge 设置，并按需刷新工具列表。
- `agentTools.refreshMcp`：主动重新读取 `GET /tools/list`。
- `agentTools.list`：返回内置工具 + MCP 工具摘要。
- `agentTools.call`：直接调用已注册 MCP 工具，便于调试。
- 聊天请求进入后台时会通过 `agentToolsDefinitionsForChat()` 合并内置工具和 MCP 工具。
- MCP 工具会被注册为 `mcp.<rawToolId>`，并转换成模型可调用的安全函数名，例如 `mcp.dev.echo` → `mcp_dev_echo`。
- 模型触发 `mcp_*` 工具后，后台通过 `ToolRegistry.call()` 转发到本地 MCP Bridge，再把结果作为 tool message 回填聊天循环。

为避免误暴露能力，MCP 工具只有在以下条件满足时才进入聊天工具列表：

1. 用户在“工具和 MCP”入口开启 MCP Bridge。
2. 用户开启“工具调用开启时暴露 MCP 工具给模型”，或调用方显式传入 `mcp.*` / `mcp.<id>`。
3. 当前聊天请求本身启用了工具调用。

当前 UI 已在历史抽屉 footer 增加“工具和 MCP”入口，可配置：

- 本地 MCP Bridge 地址。
- 是否启用 MCP Bridge。
- 是否在工具调用开启时暴露 MCP 工具给模型。
- 刷新并查看当前发现的 MCP 工具。

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
