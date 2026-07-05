# AI 侧边栏上游能力迁移 Phase 4 设计

日期：2026-07-05

状态：已实施

## 背景

本项目已完成 Phase 1 到 Phase 3：通用工具/MCP/审计地基、任务策略与 `browser.extract_content`、以及基于 DevTools 桥接的只读 `network.list_requests` / `network.get_request_details`。上游 `AhYi8/browser-ai-assistant` 当前 `master` 为 `76fcd13e35316205311e8285caaa7c07d02c5948`，仍有更完整的浏览器开发者工具链。

Phase 4 的目标不是追平上游所有高权限能力，而是在现有 no-build MV3 架构内继续迁入低风险、可测试、能直接复用 Phase 3 脱敏 Network details 的接口分析能力。

## 上游差异总表

| 类别 | 上游能力 | 本项目状态 | Phase 4 处理 |
| --- | --- | --- | --- |
| 工程形态 | React 19、TypeScript、Vite、Vitest、Playwright、Tailwind/Radix | no-build MV3、纯 JS/ESM、Node assert 测试 | 暂缓，不在 Phase 4 重构工程形态 |
| Manifest/入口 | 独立 `side_panel.default_path` 和构建输出 | Moon Tab 集成式 side panel、新标签页、悬浮窗 | 保持现状 |
| 模型/聊天 | 流式工具循环、工具记录、模型适配、标题生成 | 已部分迁入，保留现有 bundle + adapter | 暂不扩大 |
| MCP | 多 Server 设置、HTTP adapter、工具注册 | 已迁入通用工具中心、MCP Server、Grok 预设和审计 | 继续复用 |
| 任务策略 | Automation Playbooks、预选器、prompt 注入 | Phase 2 已迁入低风险只读策略 | 暂不新增高风险 Playbook |
| 页面读取 | `browser.extract_content` | Phase 2 已迁入 | 保持 |
| Browser control | 快照、点击、填写、按键、等待、导航、多页 | 已有核心能力，且接入队列 | 保持 |
| Network 基础 | list/get/clear/wait/compare/find/extract JS candidates | Phase 3 只迁入 list/get | Phase 4 迁入 compare/find；clear/wait/extract 暂缓 |
| JS/SourceMap | JS 资源索引、搜索、SourceMap 解析 | 未迁入 | 依赖更完整 JS 索引，暂缓 |
| Runtime | 只读 Runtime globals/modules/function summary | 未迁入 | 需要显式 runtime-readonly 授权和 CDP 模板，暂缓 |
| Boundary | 用户边界确认、一次性授权 | 只预留高风险确认地基 | 暂缓 |
| Replay | 生成/发送/对比请求重放草案 | 未迁入 | 会发起请求，暂缓 |
| Full Access | 任意脚本、页面 fetch、原始 Network、Storage | 未迁入 | critical 风险，不作为默认工具迁入 |
| 同步/备份 | WebDAV/S3/Chrome sync | 本项目已有不同的新标签页/侧栏数据结构 | 暂缓 |
| UI 设置 | React 设置页、运行时/权限分组 UI | 本项目用 DOM adapter 和工具浮层 | 暂缓 |

## Phase 4 目标

- 新增 `network.compare_requests` / `network_compare_requests`，用于对两个或多个已脱敏 Network details 做稳定字段、变化字段和疑似关键参数对比。
- 新增 `network.find_parameter_candidates` / `network_find_parameter_candidates`，用于从已脱敏 URL query、request headers、JSON/form/text body 中提取签名、时间戳、随机数、凭据类字段候选。
- 两个工具都只接受 `requestIds` 和可选 `tabId`，只能通过 `network.list_requests` 返回的请求 ID 读取 DevTools 缓存详情。
- 输出继续经过 `redactNetworkRecord()` 二次脱敏和长度截断，不能输出 Cookie、Authorization、Token、Secret、密码、API Key 原文。
- 后台仍复用 `networkContext.getDetails`，不新增 debugger-backed recorder，不发送网络请求，不执行页面脚本。
- 文档明确 Phase 4 仍不迁入 `network.clear_requests`、`network.wait_for_requests`、`network.extract_js_candidates`、`js.*`、`sourcemap.*`、`runtime.*`、`boundary.*`、`replay.*`、`full_access.*`。

## 工具契约

### `network.compare_requests`

模型函数名：`network_compare_requests`

参数：

```js
{
  requestIds: string[],
  tabId?: number
}
```

规则：

- `requestIds` 必填，去重后至少 2 个，最多 50 个。
- 读取详情失败时返回隔离的工具错误。
- 少于 2 个详情时返回“至少需要两个请求才能进行对比”的普通工具结果。
- 对比字段包括 method、path、query、request headers、request body 解析字段。
- JSON body 只在 body 可以解析为 JSON 时展开；表单 body 用 `URLSearchParams` 展开；其他文本作为 `body.body` 整体字段。

### `network.find_parameter_candidates`

模型函数名：`network_find_parameter_candidates`

参数：

```js
{
  requestIds: string[],
  tabId?: number
}
```

规则：

- `requestIds` 必填，去重后 1 到 50 个。
- 候选来源包括 query、request header、body。
- 候选原因包括疑似签名字段、时间戳字段、随机数/请求 ID 字段、凭据字段、加密或编码载荷。
- 返回结果限制在 80 条以内，并对字段值截断到 160 字符。

## 架构

继续沿用 Phase 3 两层结构：

- `src/shared/network-tools.mjs`
  - 增加两个工具常量、schema、定义。
  - 增加 compare/find 参数归一化。
  - 增加字段展开、候选发现和格式化函数。
  - 保持纯 ESM，无 Chrome 依赖。
- `src/ai-assistant/background/network-tools-service.js`
  - 扩展 `executeNetworkTool()` 的工具分发。
  - 对 compare/find 统一读取 details，再调用共享格式化。
  - 保持错误码和 tool result 结构兼容 Phase 3。
- `src/ai-assistant/background/index.js`
  - 无需新增分支，继续通过 `NETWORK_TOOL_DEFINITIONS` 暴露和 `network.*` 分发。
  - 只需要通过测试确认两个新 ID/name 已进入定义和提示边界。

## 测试策略

- 扩展 `scripts/test_network_tools.mjs`：
  - 先断言新工具常量和定义存在。
  - 断言 compare/find 参数归一化。
  - 断言比较输出包含稳定字段、变化字段和候选字段。
  - 断言敏感 query/header/body/response 内容不会泄漏。
  - 断言后台服务能执行 compare/find，非法参数和 DevTools 不可用仍返回错误。
- 扩展 `scripts/test_background_agent_tools_wiring.mjs`：
  - 断言后台源码暴露 `NETWORK_COMPARE_REQUESTS_TOOL_ID` 和 `NETWORK_FIND_PARAMETER_CANDIDATES_TOOL_ID`。
  - 断言提示词包含差异分析、关键参数候选和脱敏边界。
- 回归运行：
  - `node scripts/test_network_tools.mjs`
  - `node scripts/test_background_agent_tools_wiring.mjs`
  - `npm test`

## 风险与控制

- 该阶段不读原始凭据，只分析 Phase 3 已脱敏 details。
- 对比和候选输出可能把 `[已脱敏]` 标记识别为凭据类候选，这是可接受的安全提示，不代表泄漏原文。
- 不新增页面执行、请求发送、同源 JS 补位或 SourceMap 读取。
- 当前工作区已有大量 staged 变更，本阶段只追加 Phase 4 相关文件改动，不回退已有 Phase1-3 成果。
