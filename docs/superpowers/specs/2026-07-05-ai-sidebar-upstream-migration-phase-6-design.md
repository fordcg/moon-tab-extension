# AI 侧边栏上游能力迁移 Phase 6 设计

日期：2026-07-05

状态：已实施

## 背景

上游 `AhYi8/browser-ai-assistant` 在 Network 能力上同时提供 list、details、clear、wait、compare、find 和 JS 候选片段等工具。本项目 Phase 3 到 Phase 5 已基于现有 DevTools port 迁入 list/details、compare/find 以及 requestIds 约束版 `network.extract_js_candidates`，但仍没有后台 debugger-backed Network recorder。

Phase 6 选择迁入最小副作用的 `network.clear_requests`。它只清空当前 DevTools bridge 和后台 snapshot 的内存请求缓存，不发送请求、不读取新详情、不等待新增请求，也不改变工程栈或 UI 架构。

## 上游/本地差异定位

| 类别 | 上游能力 | 本项目状态 | Phase 6 处理 |
| --- | --- | --- | --- |
| Network recorder | 后台 debugger-backed recorder，可独立采集 | DevTools page 通过 `chrome.devtools.network` 采集，要求 DevTools 打开 | 不迁 recorder |
| `network.clear_requests` | 清空 recorder 内请求缓存 | DevTools bridge 和后台已有内存 snapshot | 迁入缓存清空 |
| `network.wait_for_requests` | 等待新增请求并返回匹配结果 | 没有一次性等待者、超时和断线恢复语义 | 暂缓 |
| 请求详情 | 可读取 recorder 缓存详情 | 已通过 `networkContext.getDetails` 读取脱敏详情 | 保持 |
| 权限边界 | 上游有更完整 Network/JS/Runtime 链路 | 本项目默认不暴露原始凭据和执行能力 | 保持低风险边界 |

## 目标

- 新增 `network.clear_requests` / `network_clear_requests` 工具契约。
- 参数只允许可选 `tabId`，拒绝多余字段。
- 后台工具服务通过注入的 `clearNetworkRequests()` 适配器分发。
- 后台 runtime 接受 `networkContext.clearRequests`，并转发到已连接 DevTools port。
- DevTools bridge 收到清空消息后清空 `requestStore` 并推送空 snapshot。
- 输出只包含清空结果、tabId 和清空数量，不返回任何请求详情。

## 非目标

- 不迁入 `network.wait_for_requests`。
- 不新增 debugger-backed Network recorder。
- 不发送网络请求、不重放请求、不补 fetch。
- 不读取响应体、Cookie、Authorization、Token、Secret、Storage 或原始凭据。
- 不新增 `js.*`、`sourcemap.*`、`runtime.*`、`replay.*` 或 `full_access.*`。
- 不迁入上游 React/TypeScript/Vite 结构。

## 架构

### `src/shared/network-tools.mjs`

- 增加 clear 工具 ID、函数名和参数 schema。
- 在 Network 工具定义中把 clear 放在 details 之后、分析工具之前。
- 增加 `normalizeNetworkClearRequestsArguments()`，复用 tabId 归一化并拒绝额外字段。
- 增加 `formatNetworkClearRequestsResult()`，输出可读的清空结果。

### `src/ai-assistant/background/network-tools-service.js`

- `resolveNetworkToolKind()` 识别 clear 的 ID 和函数名。
- `executeNetworkTool()` 分发到 clear executor。
- clear executor 校验参数后调用注入的 `clearNetworkRequests({ tabId })`。
- DevTools 未连接或适配器缺失时返回隔离的工具错误。

### `src/ai-assistant/background/index.js`

- `executeNetworkToolFromBackground()` 注入 `clearNetworkRequests`，映射到 `networkContext.clearRequests`。
- `dn()` 对 clear 做本地 snapshot 清空，并向已连接 DevTools port 发送清空消息。
- runtime message handler 接受 `networkContext.clearRequests`。

### `src/ai-assistant/devtools.js`

- 监听 `networkContext.clearRequests`。
- 清空 `requestStore`。
- 调用 `postSnapshotUpdated()` 推送空 snapshot。

## 测试策略

- `scripts/test_network_tools.mjs`
  - 断言 clear 常量、schema、工具顺序和参数归一化。
  - 覆盖格式化输出、服务分发成功、非法参数和缺少清空适配器。
- `scripts/test_background_agent_tools_wiring.mjs`
  - 断言共享工具、后台服务、后台适配器、runtime handler 和 DevTools bridge 均接入 clear。
- 回归运行：
  - `node scripts\test_network_tools.mjs`
  - `node scripts\test_background_agent_tools_wiring.mjs`
  - `npm test`

## 风险与控制

- 清空缓存会影响模型后续可见的 Network 请求列表；这是工具的显式语义，输出会说明已清空数量。
- 若 DevTools 未连接，工具返回不可用错误，不尝试创建新的采集通道。
- 若清空后用户需要新请求，必须由用户或页面自然触发；Phase 6 不等待、不刷新、不重放。
- 该工具没有原始凭据读取路径，返回内容不包含请求头、body 或响应体。
