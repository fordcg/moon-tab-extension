# Debugger 完整浏览器自动化设计

## 背景

本项目当前是 Moon Tab Chrome MV3 扩展，包含新标签页、小游戏和 Browser AI Assistant 侧边栏。当前发布 manifest 不声明 `debugger` 权限，浏览器控制源码已经导入，但高风险 debugger-backed 能力不会在发布运行时静默启用。

远端 `AhYi8/browser-ai-assistant` 的 `v3.5.0` / `76fcd13` 默认声明 `debugger` 权限，并以 `chrome.debugger` 和 Chrome DevTools Protocol 作为浏览器自动化、Network 分析、JS/Source Map、Runtime、Replay 和 Full Access 的核心能力。本项目下一阶段目标是先追平远端完整能力，再在本项目已有的新标签页、DevTools 兼容层、Grok/MCP Bridge、AgentTools 审计和发布验收体系上超过远端。

## 目标

1. 在本项目发布 manifest 中启用 `debugger` 权限，并让 debugger-backed browser control 成为正式发布能力。
2. 追平远端 `v3.5.0` 的浏览器自动化能力：页面观察、页面操作、多页面控制、Network recorder、JS 搜索、Source Map、Runtime 只读分析、受控增强、Replay 和 Full Access。
3. 保留本项目现有 DevTools Network 只读兼容层，但将它降级为 fallback，不再作为主要 Network 能力。
4. 超过远端：加入能力诊断面板、权限预检、工具健康检查、MCP/AgentTools 联动、发布验收 gate 和可观测审计。
5. 保持安全边界：所有高风险工具必须经过工具注册表、运行态、参数校验、授权上下文和 background 二次校验。

## 非目标

- 不绕过 Chrome、网页 CSP、站点登录、风控、验证码、浏览器扩展平台限制或用户确认。
- 不把模型返回的任意 JavaScript 当成默认可执行脚本。
- 不在普通模式默认暴露 `full_access.*`。
- 不把原始 Cookie、Authorization、Storage、Network 原文自动写入历史、导出、同步快照或后续上下文。
- 不删除 DevTools Network 兼容层，除非后续单独设计确认迁移完成。

## 设计选择

### 推荐方案：Debugger-first，DevTools fallback

正式声明 `debugger` 权限，恢复并启用已导入的 CDP 能力；Network、JS、Source Map、Runtime、Replay 和 Full Access 优先走 debugger-backed 路径。现有 DevTools Network bridge 保留为只读、脱敏、需要用户打开 DevTools 的 fallback。

优点：

- 能追平远端核心能力。
- 能保留本项目低风险兼容路径。
- 能通过本项目 release gate 控制高风险发布质量。

缺点：

- manifest 权限更敏感。
- 需要更新大量当前“无 debugger”测试和发布验收文档。
- 需要手工和 E2E 覆盖真实扩展 attach、detach、权限提示和冲突场景。

### 备选方案：可选 debugger 权限

把 `debugger` 放入 optional permissions，由用户在设置中按需授权。

优点是安装提示更轻；缺点是远端默认能力无法完全追平，Chrome 对 `debugger` 可选授权和 attach 体验也会让产品路径复杂化。本阶段不采用。

### 备选方案：维持无 debugger，只增强 DevTools

继续使用 DevTools Network bridge 扩展只读能力。

优点是权限低；缺点是无法追平远端的 Runtime、Replay、Full Access 和完整 CDP recorder。本阶段不采用。

## 架构

### 权限与构建

`public/manifest.json` 正式加入 `"debugger"`。`scripts/verify-release-readiness.mjs` 不再拒绝 `debugger`，改为检查 debugger 已声明、关键入口已打包、高风险能力测试存在、发布文档已更新。

构建仍由 `vite.config.ts` 多入口输出：

- `index.html`：AI 侧边栏。
- `background/index.js`：MV3 service worker。
- `content/index.js`：content script。
- `src/devtools/network.html`：DevTools Network fallback 页面。
- `src/pages/newtab/index.html`：Moon Tab 新标签页。
- `src/pages/game/index.html`：小游戏。

### BrowserControlManager

继续作为 debugger-backed 能力总入口，职责包括：

- 管理目标 tab、受控页面列表和当前自动化模式。
- 调用 `BrowserDebuggerConnection.attach/detach/sendCommand`。
- 在开启浏览器控制时启用 `Runtime`、`Page`、`DOM`、`Accessibility`、`Network` 等 CDP domain。
- 管理 `BrowserNetworkRecorder`、`BrowserConsoleRecorder`、JS/SourceMap/Runtime/Replay/Full Access executors。
- 在 tab 关闭、用户取消调试、其他 debugger 抢占或手动关闭浏览器控制时清理状态。

### Network 能力

主要路径切换为 `BrowserNetworkRecorder`：

- `network.list_requests`
- `network.get_request_details`
- `network.clear_requests`
- `network.wait_for_requests`
- `network.compare_requests`
- `network.find_parameter_candidates`
- `network.extract_js_candidates`

DevTools bridge 保留：

- 只在 debugger recorder 不可用、且目标 tab 有 DevTools Network 连接时提供兼容结果。
- 只允许脱敏、截断、只读能力。
- 不提供 `runtime.*`、`replay.*`、`full_access.*`。
- UI 必须标记当前 Network 来源是 `debugger` 还是 `devtools_fallback`。

### JS、Source Map 和 Runtime

`js.*`、`sourcemap.*`、`runtime.*` 继续走现有 executor：

- JS 同源补位必须严格同源，`credentials: "omit"`。
- Source Map 只允许同源或已采集来源，限制大小和片段。
- Runtime 只允许固定模板、只读、脱敏、截断、`returnByValue: true`。
- 模型不得传入任意 Runtime 表达式。

### 自动化模式

保留三模式：

| 模式 | 可用能力 | 安全边界 |
|---|---|---|
| 普通模式 | 观察、基础操作、Network/JS/SourceMap/Runtime 只读分析 | 默认脱敏、截断、禁止敏感原文 |
| 受控增强模式 | 普通模式 + `boundary.request_user_choice` + `replay.*` | 需要一次性授权，授权绑定 tab、origin、目标工具和参数 |
| 完全访问模式 | `full_access.*` | 用户显式切换后开放最高权限，仍受 Chrome/CSP/扩展平台限制 |

### 超过远端的增强

#### 能力诊断面板

在侧边栏设置或工具面板中新增“浏览器自动化诊断”区域，展示：

- manifest 是否声明 `debugger`。
- 当前 tab 是否可 attach。
- 是否已有其他 debugger 占用。
- 当前 Network 来源：`debugger_recorder`、`devtools_fallback`、`unavailable`。
- 当前自动化模式。
- 可用工具数量、置灰工具数量、失败原因。
- 最近 detach 原因。

#### 工具健康检查

新增 `agentTools.getStatus` 返回的内置工具状态增强字段，供 UI 展示：

- `runtimeAvailable`
- `disabledReason`
- `requiresDebugger`
- `requiresAutomationMode`
- `lastCheckAt`

该状态只用于展示，不替代 background 执行器校验。

#### 发布验收增强

`npm run verify:release` 应验证：

- `dist/manifest.json` 和 `artifacts/chrome-extension/manifest.json` 都声明 `debugger`。
- 浏览器自动化核心单测、Network recorder 单测、tool registry 单测、release readiness 单测通过。
- Playwright 真实扩展 smoke 能加载扩展、打开侧栏、展示浏览器控制入口。
- 文档不再声称当前发布“不声明 debugger”。

#### MCP/AgentTools 联动

MCP 和 AgentTools 不直接获得 debugger 权限。它们只能调用注册表中当前真实可用的工具，并且：

- 远程 MCP 工具不能伪造本地 `browser.*` / `network.*` / `full_access.*`。
- AgentTools 审计日志记录工具可用性变化和 MCP 调用结果，但不记录敏感原文。
- Grok Search MCP Bridge 继续只作为外部搜索/工具桥，不获得页面原始凭据。

## 数据与安全

### 默认脱敏

普通模式和受控增强模式下，以下字段或相似字段必须脱敏：

- `Authorization`
- `Cookie`
- `Set-Cookie`
- `token`
- `api_key`
- `password`
- `secret`
- `session`
- `csrf`
- `jwt`
- `credential`

脱敏覆盖 URL query、headers、JSON body、form body、工具附件、导出、后续追问上下文和审计摘要。

### 一次性授权

`boundary.request_user_choice` 生成的 grant 必须绑定：

- tabId
- origin
- targetToolName
- targetToolArguments
- grant scope
- 过期时间或消费时机

`replay.send_request` 成功或失败后必须消费授权。导航、刷新、切换 tab、关闭浏览器控制和 detach 必须清理一次性授权。

### 完全访问

完全访问模式只在用户当前会话显式选择后生效。该模式下 `full_access.*` 可以返回原文，但 UI 必须持续展示高风险状态，并提供撤销入口。`full_access.revoke` 必须立即切回普通模式并清理授权上下文。

## UI 要求

1. 浏览器控制默认关闭。
2. 开启时展示 `debugger` 风险说明和当前 tab 信息。
3. 自动化模式选择只在浏览器控制开启后可用。
4. Network 来源必须可见，避免用户误以为 DevTools fallback 等同完整 recorder。
5. 完全访问模式必须有明显风险提示和撤销入口。
6. 工具设置中不可用工具应置灰，并显示具体原因。
7. 不允许通过工具偏好、导入配置或批量启用绕过运行态要求。

## 测试策略

### 单元测试

更新或新增：

- `tests/unit/background/manifestBrowserControl.test.ts`
- `tests/unit/background/extensionBuildContract.test.ts`
- `tests/unit/background/releaseReadinessContract.test.ts`
- `tests/unit/background/browserControlMessageHandler.test.ts`
- `tests/unit/background/backgroundToolRuntime.test.ts`
- `tests/unit/background/networkRecorder.test.ts`
- `tests/unit/background/networkToolExecutor.test.ts`
- `tests/unit/background/jsSourceToolExecutor.test.ts`
- `tests/unit/background/sourceMapToolExecutor.test.ts`
- `tests/unit/background/runtimeReadToolExecutor.test.ts`
- `tests/unit/background/replayToolExecutor.test.ts`
- `tests/unit/background/fullAccessToolExecutor.test.ts`
- `tests/unit/background/agentToolsMessageHandler.test.ts`
- `tests/unit/side-panel/browserControlPreferences.test.ts`
- `tests/unit/side-panel/App.test.tsx`

关键断言：

- manifest 必须声明 `debugger`。
- 浏览器控制默认关闭，不自动 attach。
- 开启后普通网页 attach 并启用 CDP domain。
- 受限 URL fail closed。
- detach、tab close、用户取消和 attach 冲突会清理状态。
- `network.*` 优先走 debugger recorder。
- DevTools fallback 只在 debugger recorder 不可用时参与。
- Runtime 只读模板拒绝任意表达式。
- Replay 和 Full Access 受模式限制。
- 前端和 background 双重过滤不可用工具。
- AgentTools/MCP 不能绕过内置工具授权。

### E2E 与手工验收

`tests/e2e/extension-runtime.spec.ts` 增加真实扩展 smoke：

- 加载扩展后 manifest 包含 `debugger`。
- 打开普通网页和侧栏。
- 开启浏览器控制。
- 验证 UI 显示已连接或明确错误。
- 关闭浏览器控制后状态清理。
- 不要求 E2E 自动读取敏感页面原文。

手工验收：

1. `npm run verify:release` 通过。
2. 加载 `dist/` 或 `artifacts/chrome-extension/`。
3. 打开普通 HTTPS 页面。
4. 开启浏览器控制，确认 Chrome debugger 提示和 UI 风险提示。
5. 调用 `browser.take_snapshot`、`network.list_requests`、`network.clear_requests`。
6. 切换受控增强模式，验证边界确认。
7. 切换完全访问模式，验证风险提示和撤销。
8. 打开 DevTools Network，验证 fallback 标识不会覆盖 debugger recorder 标识。

## 迁移阶段

### Phase A：权限和 release boundary 翻转

- manifest 加入 `debugger`。
- 更新 release readiness、README、release matrix。
- 更新当前“不声明 debugger”的测试为“必须声明 debugger”。
- 验证构建产物和发布包权限一致。

### Phase B：启用 debugger-backed 工具暴露

- 恢复浏览器控制工具作为正式运行态。
- 确保 `shouldExposeTool`、Side Panel 工具列表、AgentTools 状态和 background 执行器使用同一运行态判断。
- 保持默认关闭，用户显式开启后才 attach。

### Phase C：Network 主路径迁移

- `network.*` 优先使用 `BrowserNetworkRecorder`。
- DevTools bridge 降级 fallback。
- 增加 UI 和审计中的 Network 来源字段。

### Phase D：Runtime、Replay、Full Access 验收

- 补齐 Runtime 固定模板测试。
- 补齐 Replay 一次性授权消费测试。
- 补齐 Full Access revoke 和模式隔离测试。

### Phase E：超过远端增强

- 增加能力诊断面板。
- 增强 AgentTools 内置工具状态。
- 增强 release gate 和 E2E smoke。
- 更新用户文档，说明三模式、fallback、风险和排障方式。

## 验收标准

本设计完成后，必须满足：

1. `public/manifest.json`、`dist/manifest.json`、`artifacts/chrome-extension/manifest.json` 都声明 `debugger`。
2. 浏览器控制默认关闭，未开启时不会 attach。
3. 用户开启后，普通网页可 attach，受限页面明确拒绝。
4. `browser.*`、`network.*`、`js.*`、`sourcemap.*`、`runtime.*` 能按模式和连接态正确暴露。
5. `replay.*` 只在受控增强模式暴露。
6. `full_access.*` 只在完全访问模式暴露。
7. DevTools Network fallback 保留但不会误报为完整 debugger recorder。
8. MCP/AgentTools 不能绕过本地工具注册表和 background 执行器。
9. README、release readiness、测试命名和文档不再保留“当前发布不声明 debugger”的过期口径。
10. `npm run verify:release` 是最终发布门禁。

## 风险与缓解

| 风险 | 缓解 |
|---|---|
| 用户对 `debugger` 权限敏感 | README、UI 和首次开启提示明确说明用途、默认关闭和撤销方式 |
| 其他 debugger 占用导致 attach 失败 | 诊断面板显示冲突原因，工具返回中文错误 |
| 高风险工具误暴露 | Side Panel、模型请求构造和 background 三层过滤 |
| 敏感信息进入历史或导出 | 复用并扩展 `toolArtifacts` 脱敏测试 |
| DevTools fallback 与 debugger recorder 混淆 | 所有 Network 结果标记来源 |
| 与远端后续更新冲突 | 保留上游核心文件边界，超过远端的诊断和 release gate 独立封装 |

## 自检结论

- 覆盖追平远端：manifest `debugger`、browser control、Network recorder、JS、Source Map、Runtime、Replay、Full Access。
- 覆盖超过远端：诊断面板、工具健康检查、MCP/AgentTools 联动、release gate、Network 来源标识。
- 没有把实现步骤细化为代码任务；后续应基于本 spec 再写 implementation plan。
- 当前文档只改变设计规格，不改变发布行为。
