# 工作区 AI 侧栏请求日志设计

日期：2026-07-13  
状态：已评审待实现  
范围：AI 侧栏模型请求的完整过程日志，写入当前仓库工作区，默认关闭

## 背景

当前模型请求调试信息有两条半成品路径：

1. `src/background/modelRequestHandler.ts` 的 `logPreparedModelRequest` 通过 `console.debug` 输出元数据。
2. `src/background/chatRequestLogFile.ts` 通过 `chrome.downloads` 写入浏览器下载目录：
   - `moon-tab/request-logs/chat-send-latest.json`
   - `moon-tab/request-logs/history/<requestId>-...json`

问题：

- 日志不在仓库工作区，协作与排查不便。
- 内容只有元数据，没有请求正文、模型回答、工具/MCP 过程、侧栏状态。
- 无法直接回答“当前是普通模式还是完全访问、实际暴露了哪些工具、完整提示词上下文是什么”。

仓库内已有可复用底座：

- `scripts/model_diagnostics_sink.mjs`：本机 HTTP 接收器，默认写 `.tmp/`。
- agent tools 审计中的敏感字段脱敏逻辑。

## 目标

在设置开关开启时，把一次侧栏请求的完整过程写入当前工作区，使开发者或本机 agent 可直接读取：

1. 侧栏/扩展状态：模式、工具清单、MCP、系统提示词、相关偏好。
2. 完整提示词上下文：发给模型的 messages、tools、toolChoice。
3. 模型回答过程：content / thinking / reasoning / tool_calls / token usage / error。
4. 本地工具与 MCP 调用过程：参数、结果摘要、耗时、错误。

非目标：

- 不把完整日志继续写到 `%USERPROFILE%\Downloads\moon-tab\...`。
- 不记录 API Key、Authorization、MCP bearer、cookie 等密钥。
- 不把日志失败提升为聊天失败。
- 不默认开启完整日志。

## 方案选择

采用方案 A：本地 HTTP 日志接收器 + 扩展事件发送。

| 方案 | 说明 | 结论 |
|------|------|------|
| A. 本地 HTTP sink | 扩展 POST 到 `127.0.0.1`，Node 服务写工作区 | 采用 |
| B. Downloads + HTTP 双写 | 保留下载元数据，全文走 HTTP | 放弃，双路径维护成本高 |
| C. 仅 chrome.downloads | 全文仍落在下载目录 | 放弃，不满足工作区要求 |

## 架构

### 组件

1. **偏好开关**
   - 字段：`ChatPreferenceValues.workspaceRequestLoggingEnabled: boolean`
   - 默认：`false`
   - 归一化：`normalizeChatPreferences`
   - UI：设置 → 聊天偏好

2. **扩展事件发送器**
   - 改造 `src/background/chatRequestLogFile.ts` 为工作区日志客户端
   - 仅当开关开启时发送
   - 目标：`http://127.0.0.1:17334/chat-request-logs`（可用环境约定/常量覆盖）
   - 失败：`console.warn`，不抛、不阻断聊天

3. **本地 sink**
   - 扩展 `scripts/model_diagnostics_sink.mjs`，增加 chat-request-logs 路由与合并逻辑
   - 监听 `127.0.0.1`
   - 写入 `.tmp/chat-request-logs/`

4. **埋点位置**
   - `handleChatSendMessage`：`session_start` / `session_end`
   - `requestModelOnce`：`model_request` / `model_response`
   - `runModelToolLoop` 与工具回调：`tool_call_start` / `tool_call_complete`
   - MCP 执行路径：`mcp_call` / `mcp_result`
   - 侧栏发送路径：把开关与状态快照所需字段传入 `chat.send`

### 数据流

```text
侧栏发消息
  → 组装 chat.send（messages、enabledToolIds、mcp、preferences、debugContext、workspaceRequestLoggingEnabled）
  → background 解析暴露工具 / MCP / playbook / 附加 prompt
  → 若开关开：POST session_start（含侧栏状态与完整状态快照）
  → 每轮模型：POST model_request（完整 messages/tools）与 model_response
  → 每个工具/MCP：POST tool_* / mcp_*
  → POST session_end
  → sink 按 requestId 合并并写 latest / history / markdown
```

## 事件 Schema

所有事件共享：

```ts
interface ChatRequestLogEventBase {
  schemaVersion: 1;
  requestId: string;
  sessionId?: string;
  source: "side_panel_chat" | "title_generation";
  at: number;
  atIso: string;
  type:
    | "session_start"
    | "model_request"
    | "model_response"
    | "tool_call_start"
    | "tool_call_complete"
    | "mcp_call"
    | "mcp_result"
    | "session_end";
}
```

### `session_start`

必须包含侧栏/扩展状态，而不是只记“已开启日志”：

- `mode` / `defaultBrowserAutomationMode`：`normal_restricted` | `controlled_enhanced` | `full_access`
- `privateMode`
- `toolCallingEnabled`
- `enabledToolIds`：用户勾选
- `exposedToolIds`：实际暴露给模型（过滤后）
- `toolDefinitions`：暴露工具 name / description / parameters 摘要
- `mcp`：已启用服务器、已发现工具、可用性；token 脱敏
- `toolCallDisplayMode`
- `showToolCallProcessInAssistantMode`
- `browserAutomationMaxToolIterations`
- `followUpBehavior`
- `pageContext`：是否注入、extract 模式
- `selectedTabId`
- `model`：id / modelId / displayName / channelName / endpointType；不含 apiKey
- `systemPrompt`：生效系统提示词（含会话覆盖后结果）
- `preferencesSnapshot`：其它相关偏好摘要
- `debugContext`：现有请求定位字段

### `model_request`

记录整个提示词上下文，而不是 messageCount：

- `messages[]`：本轮实际发给模型的完整 messages  
  包含 system / user / assistant / tool，以及页面上下文、浏览器控制附加 prompt、playbook 注入、工具结果回填
- `tools`：本轮 tool definitions
- `toolChoice`
- `stream`
- `tokenUsageSource`：`chat` | `tool_decision` | `tool_final` | `title`
- `retryCount`
- `endpoint`：url host 与 endpointType；不含密钥
- 超长字段截断时标记 `truncated: true`

### `model_response`

- `content`
- `thinking`
- `reasoningContent`
- `toolCalls[]`：name + arguments
- `tokenUsage`
- 失败时：`status` / `errorMessage` / 安全截断的 `errorBody`

### `tool_call_start` / `tool_call_complete`

- toolId、name、arguments
- result / resultSummary
- attachments 摘要
- durationMs
- errorMessage

### `mcp_call` / `mcp_result`

- serverId
- tool name
- arguments
- result / resultSummary
- durationMs
- errorMessage
- 敏感字段脱敏

### `session_end`

- final status：success / error / aborted
- final content 摘要
- toolCallCount / mcpCallCount / modelRequestCount
- totalDurationMs
- errorMessage（如有）

## 输出文件

工作区路径：

```text
.tmp/chat-request-logs/
  latest.json
  latest.md
  events.ndjson
  history/<requestId>.json
  history/<requestId>.md
```

说明：

- `latest.*`：最近一次完整会话，覆盖写
- `history/*`：按 requestId 保留
- `events.ndjson`：原始事件追加流
- markdown：人类可读时间线，优先展示：
  1. 侧栏状态（模式、工具、MCP、systemPrompt）
  2. 模型请求 messages
  3. 工具/MCP 过程
  4. 模型回答

## 设置 UI

位置：设置 → 聊天偏好（`ChatPreferenceSettings`）

文案：

- 标题：`工作区请求日志`
- 说明：开启后，完整请求过程（侧栏状态、提示词上下文、模型回答、工具/MCP）写入本机日志服务；默认关闭；不记录 API Key。
- 辅助：需先启动 `node scripts/model_diagnostics_sink.mjs`
- 辅助：输出目录 `.tmp/chat-request-logs/`，服务地址 `http://127.0.0.1:17334`

## 安全与体积

1. 始终剥离：
   - `model.apiKey`
   - `Authorization` / bearer
   - MCP bearer token
   - cookie / set-cookie
   - 其它敏感 key 模式（复用 agent tools 脱敏）
2. 图片附件只记 mediaType / size / 占位，不写 base64 正文。
3. 超长文本截断，默认单字段上限可配置（建议 100KB 级），并标记 `truncated`。
4. 仅允许发送到 `127.0.0.1` / `localhost`。
5. 日志失败不影响聊天主路径。

## 对现有代码的影响

1. `chatRequestLogFile.ts`
   - 从 downloads writer 改为 HTTP event client
   - 删除/停用 `moon-tab/request-logs/...` 下载路径

2. `modelRequestHandler.ts`
   - `logPreparedModelRequest` 升级为会话事件发射
   - 在模型请求/响应路径补充完整 messages 与 response 日志

3. `toolLoop.ts` / background tool executor / MCP 路径
   - 增加 tool/MCP 事件回调或直接调用日志客户端

4. `ChatPreferenceValues` + 设置 UI + appStore 发送路径
   - 增加开关并传入 background

5. 测试
   - 更新 `chatMessageHandler.test.ts`：downloads 断言改为 HTTP mock
   - 补充 preferences / sink / 事件字段测试

## 测试计划

### 单元测试

1. `workspaceRequestLoggingEnabled` 默认 `false`
2. 开关关闭时不发 HTTP
3. 开关开启时 `session_start` 包含：
   - mode / full_access 等
   - enabledToolIds / exposedToolIds
   - systemPrompt
4. `model_request` 包含完整 messages，且不含 apiKey
5. tool / MCP 事件字段正确
6. sink 合并事件并写 latest/history/markdown

### 回归

- 现有 chat send / tool loop / preferences normalize 测试继续通过

### 手动验收

1. 启动：`node scripts/model_diagnostics_sink.mjs`
2. 扩展设置中打开“工作区请求日志”
3. 侧栏发送一条会触发工具或 MCP 的消息
4. 读取 `.tmp/chat-request-logs/latest.md`，确认可见：
   - 当前模式
   - 拥有/暴露的工具
   - 完整提示词上下文
   - 模型回答
   - 工具/MCP 过程

## 实现顺序

1. 偏好字段、normalize、设置 UI
2. background HTTP 日志客户端替换 downloads writer
3. session / model / tool / MCP 埋点
4. sink 路由与工作区输出
5. 更新测试并跑相关单测

## 验收标准

- 默认关闭时行为与现网一致，不写完整工作区日志
- 开启且 sink 运行时，工作区出现可读的 latest 日志
- 日志包含模式、工具清单、完整提示词、回答、工具/MCP 过程
- 日志不含 API Key / bearer token
- sink 未运行时聊天仍成功
