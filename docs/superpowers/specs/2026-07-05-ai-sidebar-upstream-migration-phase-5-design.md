# AI 侧边栏上游能力迁移 Phase 5 设计

日期：2026-07-05

状态：已实施

## 背景

已刷新上游 `AhYi8/browser-ai-assistant` 的 `master`，当前 HEAD 仍为 `76fcd13e35316205311e8285caaa7c07d02c5948`。本项目 Phase 1 到 Phase 4 已迁入通用工具/MCP/审计地基、Playbook 与 `browser.extract_content`、DevTools Network 列表/详情、以及基于已脱敏详情的 `network.compare_requests` / `network.find_parameter_candidates`。

上游仍领先在完整 Web 逆向链路：debugger-backed Network recorder、JS 资源索引、Source Map、Runtime 只读摘要、Boundary/Replay/Full Access、React/TypeScript 设置页和更完整的附件体系。本项目当前仍是 Moon Tab no-build MV3 架构，Network 数据来源是 `src/ai-assistant/devtools.js` 的 DevTools port；它已经能通过 `request.getContent()` 读取详情里的 `responseBody`，但没有后台 CDP Network recorder。

Phase 5 继续选择低风险、只读、可测试、与现有数据源相容的增量：迁入受 `requestIds` 约束的 `network.extract_js_candidates`，只从用户/模型显式选中的已脱敏 JS 请求详情里搜索有限源码片段。

## 上游差异总表

| 类别 | 上游 `browser-ai-assistant` | 本项目当前状态 | Phase 5 处理 |
| --- | --- | --- | --- |
| 工程栈 | React 19、TypeScript、Vite、Vitest、Playwright、Tailwind/Radix | no-build MV3、纯 JS/ESM、Node assert 测试、手写适配层 | 不重构工程形态 |
| Manifest/入口 | `public/manifest.json` 构建到 `dist`，独立 `side_panel.default_path` | 根目录 `manifest.json` 直接加载，Moon Tab 新标签页 + AI 侧栏 + DevTools page | 保持现状 |
| 侧栏 UI | React 状态、组件、设置页、会话/同步/工具 UI 完整源码化 | `sidePanel.js`/assets 为产物，局部用 `sidePanel-layout.js` 和 source-owned dialog 接入 | 不迁 UI 架构 |
| 模型/聊天 | 流式工具循环、后台任务、工具附件、标题生成、渠道管理 | 已有模型适配、工具循环、MCP、审计和部分工具记录 | 继续复用 |
| Playbook | 页面阅读、多页汇总、站点诊断、Network/API、Source/Runtime 策略 | Phase 2 只迁入页面阅读和多页汇总 | 不新增高风险策略 |
| 页面读取 | `browser.extract_content` + 提取规则 | Phase 2 已迁入，只读复用页面提取链路 | 保持 |
| Browser control | debugger/CDP 快照、点击、填写、按键、等待、导航、多页面 | 本项目已有核心浏览器控制并接入队列 | 保持 |
| Network 采集 | 后台 `chrome.debugger` recorder，支持 clear/wait/list/details | DevTools port + HAR snapshot + `getDetails`，需要 DevTools 打开 | 不迁 recorder |
| Network 已迁入工具 | list/details/clear/wait/compare/find/extract JS candidates | Phase 3/4 已有 list/details/compare/find | Phase 5 只迁 `extract_js_candidates` 的 requestIds 版本 |
| Network 未迁入工具 | `network.clear_requests`、`network.wait_for_requests` | Phase 5 开始时未迁入；现有 DevTools bridge 没有等待新增请求的后台事件窗口 | Phase 5 暂缓，Phase 6 已迁入只清空缓存的 `network.clear_requests` |
| JS 资源索引 | `JsSourceIndex`、`js.list_resources`、`js.search_sources`、`js.extract_context` | 未迁入；没有持久 JS resource index | 暂缓独立 `js.*` |
| 同源 JS 补位 | 严格同源 fetch 补位静态 JS | 未迁入 | 暂缓，需授权边界 |
| Source Map | `sourcemap.*` 三件套，支持候选、映射、原始片段 | 未迁入 | 暂缓，依赖 JS 索引 |
| Runtime | `runtime.inspect_globals`、`runtime.search_modules`、`runtime.describe_function` | 未迁入模型工具；内部浏览器控制可用受限 CDP Runtime | 暂缓，需固定模板和授权 |
| Boundary | `boundary.request_user_choice` 与一次性 grant | 仅有高风险确认预留，不是上游三模式授权 | 暂缓 |
| Replay | 无凭据请求重放沙箱 | 未迁入；本项目不发送网络重放请求 | 暂缓 |
| Full Access | 任意脚本、页面 fetch、原始 Network、Storage 原文 | 未迁入 | 不作为默认迁移目标 |
| Tool artifacts | Network/JS/SourceMap/Replay 附件和导出归一化 | 本项目已有工具审计与部分附件/记录，Network 工具当前主要返回 tool message | Phase 5 不新增附件类型 |
| 同步/备份 | Chrome Sync、WebDAV、S3、加密快照 | 本项目有不同的新标签页/侧栏数据结构和 Grok/MCP 配置 | 不迁 |
| 搜索/MCP | Tavily、MCP HTTP adapter、工具注册表 | 已有 Grok 预设、本地 HTTP MCP、通用工具中心 | 保持 |
| 测试 | Vitest + Playwright + typecheck/build | Node assert、Python/Playwright smoke、PowerShell quality script | Phase 5 用现有 Node/source assertion 测试 |

## 方案比较

### 方案 A：迁入 `network.clear_requests` / `network.wait_for_requests`

优点是补齐上游 Network 操作窗口，模型能清空后等待新增接口。缺点是本项目当前 Network 数据来自 DevTools page，而不是后台 debugger recorder；`wait_for_requests` 需要跨 DevTools port 维护等待者、超时和导航清理，`clear_requests` 也会影响用户正在观察的 DevTools 缓存语义。Phase 5 未采用该方案；Phase 6 仅迁入只清空缓存的 `network.clear_requests`，仍暂缓等待语义。

### 方案 B：迁入 requestIds 约束版 `network.extract_js_candidates`

这是推荐方案。它复用 Phase 3/4 已存在的 `networkContext.getDetails` 和脱敏详情，只对 `network.list_requests` 返回、再由模型显式传入的 JS 请求 IDs 做关键词搜索。它不执行页面脚本、不 fetch 新资源、不解析 Source Map、不建立长期 JS 索引，适合当前架构小步迁入。

### 方案 C：直接迁入独立 `js.*` / Source Map / Runtime

能力最完整，但会引入 JS resource index、同源 fetch、Source Map 解码、Runtime 固定模板和更复杂授权边界。当前本项目还没有三模式授权与 JS/SourceMap 附件体系，直接迁入会扩大权限面和维护面。

Phase 5 采用方案 B。

## Phase 5 目标

- 新增 `network.extract_js_candidates` / `network_extract_js_candidates`。
- 工具参数必须包含 `requestIds`，不支持无 requestIds 的全局 JS index 搜索。
- 读取详情仍走 `networkContext.getDetails`，只分析已缓存、已脱敏、已截断的 `responseBody`。
- 只处理 JS-like 请求：`resourceType=Script`、URL 以 `.js`/`.mjs` 结尾、或 MIME 包含 JavaScript/ECMAScript。
- 支持 `keywords` 和 `urlIncludes` 两类搜索输入；未传时使用安全默认关键词：`sign`、`signature`、`encrypt`、`crypto`、`md5`、`sha`、`aes`、`nonce`、`timestamp`、`token`。
- 每个命中只返回有限片段、命中词、requestId、URL、位置、行列近似值、`redacted` / `truncated` 标记。
- 片段输出必须再次脱敏敏感赋值，不能泄漏 Cookie、Authorization、Token、Secret、Password、API Key 等原文。
- 不新增 `js.*`、`sourcemap.*`、同源 fetch、Runtime、Replay、Full Access、原始凭据读取或请求发送。

## 工具契约

### `network.extract_js_candidates`

模型函数名：`network_extract_js_candidates`

参数：

```js
{
  requestIds: string[],
  tabId?: number,
  keywords?: string[],
  urlIncludes?: string,
  limit?: number
}
```

规则：

- `requestIds` 必填，去重后 1 到 50 个，每项最长 256 字符。
- `tabId` 可选，规则与 Phase 3/4 Network details 一致。
- `keywords` 可选，最多 20 个，每项 1 到 120 字符，去重后大小写不敏感搜索。
- `urlIncludes` 可选，最长 240 字符；用于搜索接口路径、URL 片段或参数名。
- `limit` 可选，范围 1 到 40，默认 12，限制总命中数。
- 工具只从这些请求详情里的 JS `responseBody` 查找，不扫描全部请求，不补 fetch。
- 若所选请求不是 JS-like 或无 `responseBody`，返回“未找到匹配的 JS 候选资源”。

## 架构

### `src/shared/network-tools.mjs`

继续作为纯逻辑层：

- 增加 `NETWORK_EXTRACT_JS_CANDIDATES_TOOL_ID` / `NETWORK_EXTRACT_JS_CANDIDATES_TOOL_NAME`。
- 在 `NETWORK_TOOL_DEFINITIONS` 末尾追加工具定义。
- 增加 `NETWORK_EXTRACT_JS_CANDIDATES_PARAMETERS`。
- 增加 `normalizeNetworkExtractJsCandidatesArguments()`。
- 增加 `findNetworkJsCandidates(details, options)`。
- 增加 `formatNetworkJsCandidatesResult(details, options)`。
- 增加 JS-like 判断、行列计算、片段脱敏、关键词归一化和命中格式化。

该模块继续不依赖 Chrome、DOM 或后台全局变量。

### `src/ai-assistant/background/network-tools-service.js`

扩展 Network 工具分发：

- 导入 Phase 5 常量、normalizer 和 formatter。
- `resolveNetworkToolKind()` 支持 `extract-js-candidates`。
- 新增执行分支，校验参数后调用 `getNetworkDetails({ tabId, requestIds })`。
- 复用 `executeNetworkDetailsAnalysisTool()` 或新增同等 helper，把 details 传给 formatter。
- DevTools 不可用、参数非法和通道异常继续返回隔离的工具错误。

### `src/ai-assistant/background/index.js`

保持最小改动：

- `NETWORK_TOOL_DEFINITIONS` 已以“补缺”方式追加共享 Network 工具，Phase 5 工具会自动进入内置工具列表。
- 只需补充提示词，告诉模型“定位 JS 候选片段时只能基于 `network_extract_js_candidates` 的已脱敏片段，不要要求完整 bundle 或敏感原文”。

## 用户体验

典型流程：

1. 用户要求分析接口、签名或加密参数。
2. 模型先调用 `network.list_requests`，必要时以 `resourceTypes: ["script"]` 查找 JS 请求，或先从 API 详情中拿到接口路径/参数名。
3. 模型调用 `network.extract_js_candidates`，传入明确的 JS requestIds 和关键词。
4. 工具返回有限候选片段；模型基于片段说明“疑似位置”和“下一步需要更多上下文”的原因。

如果需要跨资源搜索、展开更大上下文、解析 Source Map 或读取运行时模块，模型只能说明这是后续 `js.*`/`sourcemap.*`/`runtime.*` 阶段能力，不能伪造结果。

## 测试策略

- 扩展 `scripts/test_network_tools.mjs`：
  - 断言 Phase 5 常量、schema 和工具定义顺序。
  - 覆盖 `normalizeNetworkExtractJsCandidatesArguments()` 的 requestIds、keywords、urlIncludes、limit 和非法参数。
  - 覆盖 JS-like 判断：`resourceType=Script`、`.js` URL、JavaScript MIME。
  - 覆盖默认关键词、显式关键词、`urlIncludes` 命中、总 limit、无命中。
  - 覆盖敏感赋值脱敏，确保片段不泄漏 token/secret/password/cookie 原文。
  - 覆盖后台 `executeNetworkTool()` 分发成功、参数错误和 DevTools 不可用。
- 扩展 `scripts/test_background_agent_tools_wiring.mjs`：
  - 断言共享工具包含 `NETWORK_EXTRACT_JS_CANDIDATES_TOOL_ID`。
  - 断言后台服务 dispatch Phase 5 工具。
  - 断言提示词包含 JS 候选片段和脱敏边界。
- 回归运行：
  - `node scripts/test_network_tools.mjs`
  - `node scripts/test_background_agent_tools_wiring.mjs`
  - `npm test`

## 风险与控制

- JS bundle 可能很大：输入来自已截断的 `responseBody`，输出再限制 `limit`、片段半径和总片段长度。
- JS 片段可能包含内嵌凭据：搜索前后都执行敏感赋值脱敏，敏感字段名只显示 `[已脱敏]`。
- 搜索结果可能误导模型：工具输出明确是“候选片段”，不声明已找到完整算法。
- DevTools 可能没有缓存 JS body：返回无命中或 DevTools 不可用，不降级为页面 fetch。
- 不迁入无 requestIds 的上游兼容路径，避免模型搜索整个页面或触发同源补位。
- 当前工作区已有未提交改动，实施时只触碰 Phase 5 列出的文件，不回滚 Phase 1-4 变更。

## 后续阶段

Phase 5 之后的合理顺序：

1. `network.clear_requests` 可作为独立低风险阶段迁入，只清空现有 DevTools bridge 缓存；`network.wait_for_requests` 仍需等待者、超时和断线语义。
2. 独立 `js.list_resources` / `js.search_sources` / `js.extract_context`，再考虑严格同源补位。
3. `sourcemap.*`，依赖 JS resource index 和 source map fetch guard。
4. `runtime.*` 只读摘要，要求固定模板、危险路径拒绝和授权状态。
5. `boundary.*` / `replay.*`，必须先完成一次性 grant UI 和审计。
6. `full_access.*` 只作为显式、临时、最高风险模式，不进入默认迁移路径。
