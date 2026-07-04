# AI 侧边栏上游能力迁移 Phase 3 设计

日期：2026-07-05

## 背景

Phase 1 已完成工具中心、MCP、审计、Token 和通知地基。Phase 2 已完成浏览器任务策略和只读 `browser.extract_content`。上游 `AhYi8/browser-ai-assistant` 在 `master` `76fcd13` 中包含完整 Network 工具组、Debugger recorder、JS/Source Map、Runtime、Replay 和 Full Access。

本项目当前已经有 DevTools 面板侧的 Network HAR 采集和后台 `networkContext.getSnapshot` / `networkContext.getDetails` 消息通道。Phase 3 只复用这条既有低风险通道，迁入模型可调用的只读 Network 工具。

## 目标

- 暴露 `network.list_requests` 给模型，用于列出当前 DevTools 已采集的请求摘要。
- 暴露 `network.get_request_details` 给模型，用于读取指定请求的已脱敏详情和响应体摘要。
- 复用现有 `src/ai-assistant/devtools.js` 中的 HAR/Network 采集、脱敏和截断逻辑。
- 复用现有后台 `networkContext.getSnapshot` / `networkContext.getDetails`，不引入新的 Chrome debugger recorder。
- 将 Network 工具参数校验、schema、结果格式化放入 `src/shared/network-tools.mjs`，保持 Node 单测覆盖。
- 将后台执行适配放入 `src/ai-assistant/background/network-tools-service.js`，让 `background/index.js` 只负责注册、提示词和分发。
- 更新工具提示，要求 DevTools Network 面板连接后才使用，并明确结果已脱敏、截断，不能要求原始 Cookie/Token。
- 更新 README 和架构文档，说明 Phase 3 的能力和非目标。

## 非目标

Phase 3 不迁入以下上游能力：

- Debugger Network recorder。
- `network.clear_requests`、`network.wait_for_requests`、`network.compare_requests`、`network.find_parameter_candidates`、`network.extract_js_candidates`。
- `js.*`、`sourcemap.*`、`runtime.*`。
- `boundary.*`、`replay.*`。
- `full_access.*`。
- 未脱敏 Network 原文读取。
- 请求重放、凭据复用或跨站请求发送。
- 上游 React/TypeScript/Vite 架构重构。

## 工具契约

### `network.list_requests`

模型函数名：`network_list_requests`

参数：

```js
{
  tabId?: number,
  resourceTypes?: string[],
  limit?: number
}
```

规则：

- `tabId` 可选。不传时读取当前后台缓存中的 Network snapshot。
- `resourceTypes` 可选，最多 20 项，按请求 `resourceType` 大小写不敏感过滤。
- `limit` 可选，范围 1 到 200，默认 50。
- 只返回已脱敏、截断的请求摘要。

### `network.get_request_details`

模型函数名：`network_get_request_details`

参数：

```js
{
  requestIds: string[],
  tabId?: number
}
```

规则：

- `requestIds` 必填，1 到 50 个非空字符串，每个最长 256 字符，去重后查询。
- `tabId` 可选。
- 只返回 DevTools 已缓存并已脱敏、截断的详情。
- 如果 DevTools 未连接或请求不存在，返回可解释的错误或空结果，不抛出未处理异常。

## 架构

### 共享纯逻辑层

新增 `src/shared/network-tools.mjs`：

- 定义工具 ID、模型函数名、JSON schema 和 `NETWORK_TOOL_DEFINITIONS`。
- 归一化 `network.list_requests` 参数。
- 归一化 `network.get_request_details` 参数。
- 格式化请求列表和请求详情。
- 生成审计摘要。

该模块不依赖 Chrome、DOM 或后台全局变量。

### 后台执行层

新增 `src/ai-assistant/background/network-tools-service.js`：

- 接收模型 tool call。
- 通过注入函数调用后台现有 Network context：
  - `getNetworkSnapshot({ tabId })`
  - `getNetworkDetails({ tabId, requestIds })`
- 调用共享模块进行参数校验和结果格式化。
- 返回与现有工具审计兼容的 `{ toolCallId, name, content, summary, isError? }`。

### 后台入口补丁

修改 `src/ai-assistant/background/index.js`：

- 导入 `NETWORK_TOOL_DEFINITIONS` 和 `executeNetworkTool`。
- `getAssistantBuiltinToolDefinitions()` 追加 Network 两个工具。
- `_t()` 在 `mcp.*` 之前分发 `network.*`。
- `vt()` 在浏览器工具提示中追加 Network 只读规则。
- 复用现有 `dn()` 调用 `networkContext.getSnapshot` / `networkContext.getDetails`。

## 用户体验

- 用户需要打开扩展 DevTools 面板，Network 工具才有可用数据。
- 模型可以先调用 `network.list_requests` 找到 request id，再调用 `network.get_request_details` 读取详情。
- 工具结果会直接说明请求数量、截断和脱敏状态。
- 模型不得要求或猜测原始 Cookie、Authorization、Token、Secret 等敏感字段。

## 测试策略

- 新增 `scripts/test_network_tools.mjs`，覆盖工具常量、schema、参数校验、过滤、limit、列表格式化、详情格式化和摘要。
- 更新 `scripts/run_unit_tests.mjs` 纳入新测试。
- 新增 `network-tools-service.js` 解析检查和行为测试，覆盖成功、参数错误、DevTools 未连接和详情查询。
- 更新 `scripts/test_background_agent_tools_wiring.mjs`，断言后台导入、注册、分发和提示词边界。
- 回归运行：
  - `node scripts/test_network_tools.mjs`
  - `node --check .\src\ai-assistant\background\network-tools-service.js`
  - `node --check .\src\ai-assistant\background\index.js`
  - `node scripts/test_background_agent_tools_wiring.mjs`
  - `npm test`

## 风险与控制

- `src/ai-assistant/background/index.js` 是单行 bundle，补丁必须精确、最小化，不重排无关代码。
- Network 工具依赖 DevTools 连接，未连接时必须给出明确错误。
- 当前结果复用已有脱敏逻辑，不新增原文读取通道。
- 不迁移清空、等待、对比、JS 候选和请求重放，避免扩大权限边界。
- 现有工作区有未提交改动，本阶段只触碰 Phase 3 文件和必要文档，不回退无关修改。
