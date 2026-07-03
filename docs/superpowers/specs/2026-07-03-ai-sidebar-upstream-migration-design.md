# AI 侧边栏上游能力迁移设计

日期：2026-07-03

## 背景

本项目是 Moon Tab Chrome MV3 扩展，包含新标签页、小游戏、悬浮窗和 AI 侧边栏。上游 `AhYi8/browser-ai-assistant` 已演进为专门的浏览器 AI 工作台，包含通用 MCP、Token 用量、任务策略、Debugger Network、JS/Source Map/Runtime 分析、请求重放和完全访问等能力。

本次迁移选择方案 1：保留 Moon Tab，逐步把上游 AI 侧边栏能力迁入本项目。第一阶段只落地“工具与体验地基”，不做全量 React/TypeScript/Vite 重构，也不直接覆盖现有 `sidePanel.js` bundle。

## 目标

- 将当前“Grok 搜索 MCP”专用入口恢复为通用“工具和 MCP”中心。
- 支持多个 HTTP/Streamable HTTP MCP Server 的新增、编辑、删除、启用、禁用和工具刷新。
- 保留 Grok 本地 Bridge 作为预设模板，而不是硬编码为唯一工具形态。
- 暴露后台工具审计日志，支持查看最近调用、状态、耗时、风险、脱敏参数、结果摘要和清空。
- 增加会话级 Token 用量统计，展示输入、输出、缓存写入、缓存读取。
- 增加统一通知反馈，覆盖保存、刷新、失败、清空等操作。
- 当前模型下拉按渠道分组，保持渠道顺序和渠道内模型顺序。
- 为后续 Playbook、Debugger Network、JS/Source Map、Runtime、Replay、Full Access 迁移建立可测试的工具地基。

## 非目标

第一阶段不迁移以下能力：

- Playbook 任务策略。
- `browser.extract_content` 工具。
- Debugger Network recorder。
- `js.*`、`sourcemap.*`、`runtime.*` 工具组。
- `replay.*` 请求重放沙箱。
- `full_access.*` 完全访问工具。
- 上游 React/TypeScript/Vite 工程全量重构。
- Moon Tab 新标签页、小游戏、悬浮窗入口重写。

这些能力作为后续阶段单独设计、计划和验证。

## 架构

### 共享纯逻辑层

在 `src/shared/` 新增或扩展纯 JS 模块，承载可测试逻辑：

- MCP server 配置归一化。
- MCP Bearer Token 的敏感存储 key 规则。
- MCP tool id 和模型函数名稳定映射。
- Token usage 字段归一化。
- 工具审计参数和结果摘要脱敏。
- 工具摘要、风险级别和展示元数据。

这些模块不依赖 DOM，优先通过 Node 单测覆盖。

### 后台能力层

保留现有 `src/ai-assistant/background/index.js` 入口，但把新增工具能力尽量拆到独立模块，例如：

- `src/ai-assistant/background/agent-tools-service.js`
- `src/ai-assistant/background/mcp-service.js`
- `src/ai-assistant/background/token-usage-service.js`

第一阶段 runtime message 协议保持集中且向后兼容：

- `agentTools.getStatus`
- `agentTools.configureMcp`
- `agentTools.refreshMcp`
- `agentTools.list`
- `agentTools.call`
- `agentTools.getAuditLog`
- `agentTools.clearAuditLog`

旧的 Grok 配置消息继续兼容一段时间，避免现有 README、脚本和测试立即失效。

### 侧边栏 UI 适配层

第一阶段继续使用 `src/ai-assistant/agent-tools-dialog.js` 的原生 DOM dialog，不直接改压缩后的 `sidePanel.js`。该 dialog 从 Grok 专用表单升级为通用“工具和 MCP”中心，包含：

- MCP Server 管理区。
- 已发现工具列表区。
- 工具审计日志区。
- Grok 搜索预设入口。
- 操作通知出口。

UI 文件只负责渲染和交互编排，MCP、审计、Token 等业务规则放在共享或后台模块。

## MCP 数据模型

MCP 设置保存为 server 列表：

```js
{
  servers: [
    {
      id: "stable-server-id",
      name: "Grok Search",
      endpointUrl: "http://127.0.0.1:17333/",
      enabled: true,
      tools: [
        {
          name: "search",
          description: "Search with Grok",
          inputSchema: { type: "object", properties: {} },
          disabledReason: ""
        }
      ],
      lastRefreshAt: 0,
      lastRefreshError: ""
    }
  ]
}
```

Bearer Token 单独保存，key 格式为 `mcpBearerToken:<serverId>`。Token 不进入普通同步快照，不写入审计日志原文，不在 UI 回显原文。

工具 ID 使用稳定映射：

- 内部工具 ID：`mcp.<encodedServerId>.<encodedToolName>`
- 模型函数名：基于 server id 和 tool name 生成，遇到非法字符或冲突时追加稳定 hash。
- 展示名：`<Server 名称>.<tool_name>`

## MCP 数据流

1. 用户在“工具和 MCP”中心新增或编辑 Server。
2. 后台保存非敏感配置，并单独保存 Bearer Token。
3. 用户点击刷新工具，后台执行 MCP `initialize` 和 `tools/list`。
4. 后台写入该 Server 的工具发现缓存。
5. 聊天发送前，根据工具调用开关、当前会话启用工具、Server 启用状态和工具禁用状态生成模型可见工具列表。
6. 模型调用 MCP 工具时，后台再次校验 Server、工具名、启用状态和发现缓存。
7. 工具结果进入聊天 tool message，同时写入审计日志。

MCP 请求必须有默认超时。远端异常只影响对应工具调用，不阻断主聊天、设置或历史。

## Grok 兼容策略

- 现有 `http://127.0.0.1:17333/` 本地 Bridge 保留。
- UI 提供“添加 Grok 搜索预设”，自动填入本地地址和说明。
- 如果旧配置已有 Grok API Key、Base URL 或模型，迁移为默认 Server 的附加配置，或继续通过兼容消息写入 Bridge `/config`。
- 旧 `agentTools.configureMcp` 的 Grok 字段继续接受，内部转换为新的 Server 配置。
- README 中的 Grok 启动脚本继续可用。

## 工具审计

审计日志保留最近 80 条，记录：

- 工具调用 ID。
- 工具 ID、函数名、展示名。
- 权限域和风险级别。
- 开始/结束时间、耗时。
- 成功或失败状态。
- 脱敏后的参数摘要。
- 脱敏后的结果摘要或错误信息。

审计参数和结果默认对 `apiKey`、`token`、`secret`、`password`、`authorization`、`cookie`、`session` 等字段脱敏。审计只记录摘要，不保存大响应体或敏感原文。

## Token 用量

Token usage 归一化字段：

- `inputTokens`
- `outputTokens`
- `cacheWriteTokens`
- `cacheReadTokens`

覆盖来源：

- 标题生成。
- 普通聊天请求。
- 工具决策请求。
- 工具最终回答请求。
- 流式响应最终完成事件。

失败、取消或中断的请求不入账。流式中间 usage 只用于预览，只有最终成功后持久化。

侧边栏展示当前会话总量。没有 usage 时显示“Token 暂无”，发送中显示“Token 统计中”。

## 通知

第一阶段增加轻量通知 host，支持：

- success
- warning
- error
- info

通知用于保存、刷新、删除、清空、连接失败、Token 解析异常等操作反馈。通知 5 秒自动关闭，允许手动关闭。关键表单字段错误仍可保留 inline 文案，但主反馈走通知。

## 模型分组

当前模型下拉按渠道配置顺序分组。同一渠道内保留模型原顺序。无渠道或历史异常模型归入“其他”组。分组只改变展示，不改变已保存模型 ID、发送请求协议或模型配置结构。

## 阶段拆分

### 第一小步：工具中心恢复

- 将 `agent-tools-dialog.js` 从 Grok 专用 UI 改为通用“工具和 MCP”中心。
- 恢复内置工具和 MCP 工具列表展示。
- 展示审计日志并支持清空。
- 修复现有 smoke 对“工具和 MCP/审计日志”的断言冲突。

### 第二小步：通用 MCP Server

- 增加多 Server 配置、Bearer Token、启用/禁用和工具刷新。
- 引入稳定 MCP ID/name 映射。
- 保留 Grok 本地 Bridge 兼容。
- 增加 MCP Server 删除确认。

### 第三小步：Token、通知、模型分组

- 增加 usage 归一化和会话展示。
- 增加统一通知 host。
- 当前模型下拉按渠道分组。

### 第四小步：源码化收束

- 将第一阶段新增业务逻辑收束到 `src/shared/` 和独立后台模块。
- 减少 `agent-tools-dialog.js` 中的业务规则。
- 更新 README 和架构文档，明确后续阶段迁移路线。

## 测试策略

必须补充或更新以下验证：

- `scripts/test_tool_registry.mjs`：覆盖 MCP 工具注册、稳定 ID/name、参数校验、超时和工具调用。
- `scripts/test_background_agent_tools_wiring.mjs`：覆盖多 Server、启用/禁用、审计日志、Grok 兼容消息。
- Token usage 单测：覆盖 OpenAI-compatible、DeepSeek、Anthropic usage 字段归一化。
- UI smoke：覆盖“工具和 MCP”打开、Server 列表、工具列表、审计日志展示和清空。
- 模型分组测试：覆盖渠道顺序、渠道内顺序和异常模型兜底。
- 回归验证：`npm test`。

如果 smoke 使用真实浏览器扩展环境，需要避免依赖外部 MCP 服务，使用本地假 MCP bridge。

## 风险与控制

- 不覆盖 `sidePanel.js` bundle，避免破坏现有 AI 侧边栏主体。
- 不删除 Moon Tab、新标签页、小游戏或悬浮窗。
- 不在第一阶段引入 Network、Replay 或 Full Access 高风险能力。
- 不把 Bearer Token 写入同步快照、聊天正文、导出内容或审计原文。
- MCP 远端失败必须局部降级，不能拖垮主聊天。
- 所有新增工具执行路径必须在后台二次校验，不能信任 UI 传入的完整 Server 对象。
- 现有 dirty worktree 中的无关改动不回退、不覆盖。

## 后续阶段

第一阶段完成并验证后，再分别设计：

1. Playbook 和 `browser.extract_content`。
2. Debugger Network recorder。
3. JS/Source Map/Runtime 分析。
4. Replay 请求重放沙箱。
5. Full Access 完全访问模式。
6. AI 侧边栏源码化重构。

每个阶段都单独写设计、计划、实现和验证，不和第一阶段混做。
