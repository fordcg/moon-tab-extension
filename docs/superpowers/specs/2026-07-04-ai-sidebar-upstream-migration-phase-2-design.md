# AI 侧边栏上游能力迁移 Phase 2 设计

日期：2026-07-04

状态：待评审

## 背景

Phase 1 已把本项目从 Grok 专用入口推进到通用工具和 MCP 地基：MCP Server 配置、工具审计、Token 用量、通知和模型分组都有了可测试模块。上游 `AhYi8/browser-ai-assistant` 继续领先的主要差异在浏览器自动化策略和更深的现场分析能力。

上游项目是完整 React/TypeScript/Vite 浏览器 AI 工作台，设置页、状态管理、工具注册表和后台工具运行时都围绕 Browser AI Assistant 构建。本项目仍是 Moon Tab MV3 扩展，AI 侧边栏嵌入在现有 no-build 架构里，`src/ai-assistant/background/index.js` 和 `sidePanel.js` 仍保留较多 bundle 化代码。因此 Phase 2 继续选择小步迁入，不做工程形态重写。

## 上游差异归纳

上游和本项目的差异可以分成五类：

1. 任务策略：上游有 `automationPlaybooks`、模型预选器和选中 Playbook 的 prompt 注入。本项目还没有 Playbook 数据模型，也没有基于用户需求自动选择任务策略。
2. 页面内容读取：上游有 `browser.extract_content`，能只读提取当前受控页的文本、HTML 或 CSS/XPath 局部内容。本项目已有发送前 `pageContext.extract`，但它不是模型可调用工具。
3. 诊断工具：上游有 Console、Performance、Network、JS、Source Map、Runtime 等工具。本项目只具备现有 Network 上下文和基础浏览器控制，不具备上游完整 debugger 诊断面。
4. 高风险能力：上游有 replay、controlled enhanced、full access 等边界扩展。本项目 Phase 1 只建立了审计和高风险确认基础，不适合直接迁入这些能力。
5. UI 和工程形态：上游是源码化 React 设置页，本项目当前主要通过 DOM adapter 和少量 source-owned 模块接入，不能直接搬上游组件。

Phase 2 只迁入前两类中低风险能力：Playbook 策略地基和 `browser.extract_content`。

## 目标

- 新增可测试的 Playbook 共享模块，迁入 `page_reading` 和 `multi_page_synthesis` 两个内置策略。
- 在聊天发送前按用户需求判断是否需要策略预选，必要时用当前模型选择一个 Playbook。
- 将选中 Playbook 的 prompt 注入浏览器控制系统提示，使模型知道当前任务的阅读、汇总和证据约束。
- 新增 `browser.extract_content` 模型工具，复用当前页面提取能力，支持文本、HTML、自动规则、全文和 CSS/XPath 局部提取。
- 让 `extract_content` 进入工具审计，记录参数摘要、结果摘要、耗时和错误，但不保存页面全文原文。
- 更新 README 和架构文档，明确 Phase 2 已迁入能力和后续仍未迁入能力。

## 非目标

Phase 2 不迁入以下能力：

- `site_diagnostics`、`network_api_analysis`、`source_runtime_analysis` Playbook。
- Console、Performance、Network recorder、`network.*` 工具组。
- `js.*`、`sourcemap.*`、`runtime.*` 工具组。
- `replay.*` 请求重放沙箱。
- `full_access.*` 完全访问模式。
- 上游 React/TypeScript/Vite 设置页。
- Playbook 可视化设置页和复杂启停 UI。
- 任意模型提供的自定义 JavaScript 执行。
- Cookie、Storage、跨域 iframe 内容读取。

这些能力需要独立阶段设计，尤其是 Network/Runtime/Replay/Full Access，需要更严格的权限边界和用户确认链路。

## 方案比较

### 方案 A：只迁入 `browser.extract_content`

优点是最小，主要补一个工具和测试。缺点是没有 Playbook，模型不知道何时优先使用该工具，页面阅读和多页面汇总体验提升有限。

### 方案 B：迁入 Playbook 和 `extract_content`，不迁高风险诊断能力

这是推荐方案。它把上游最适合当前架构的能力带进来：先让模型理解任务策略，再提供一个只读内容工具作为证据入口。实现仍可保持纯 JS 模块、少量后台接线和 Node 测试，不需要改造整套 UI。

### 方案 C：一次性迁入 Playbook、诊断工具和设置页

迁移完成度最高，但会同时触碰 React 设置页、debugger 事件采集、Network/Runtime 权限和当前 bundle 脚本，风险过大，不适合在 Phase 2 做。

Phase 2 采用方案 B。

## Playbook 设计

新增 `src/shared/automation-playbooks.mjs`，只包含纯逻辑：

- `AUTOMATION_PLAYBOOK_SETTINGS_KEY`
- `getRegisteredAutomationPlaybooks()`
- `getEnabledAutomationPlaybooks(settings)`
- `normalizeAutomationPlaybookSettings(value)`
- `shouldRunAutomationPlaybookSelection(userContent)`
- `normalizeAutomationPlaybookSelection(value, playbooks)`
- `createSelectedAutomationPlaybookPrompt(selection)`

Phase 2 注册两个默认启用 Playbook：

- `page_reading`：阅读当前页面、总结重点、提取用户指定信息。提示模型优先观察当前受控页面，正文不足时使用 `browser.extract_content`，证据不足时说明缺口。
- `multi_page_synthesis`：汇总多个已打开页面或按需新开页面。提示模型先 `list_pages`，跨页面保留标题、URL 和核心证据，需要正文时在对应受控页调用 `browser.extract_content`。

暂不注册 `form_interaction`。当前项目已有点击、填写、按键工具，但表单策略会把任务带到更高风险的提交、付款、发布、删除等边界；这应在高风险确认 UX 更完整后单独迁入。

Playbook 设置模型保留 `disabledPlaybookIds`，但 Phase 2 不做完整设置 UI。这样实现计划可以先保证默认策略可用，后续需要 UI 时不用迁移数据结构。

## Playbook 选择流程

聊天发送前增加轻量预选：

1. 只有在工具调用启用、浏览器控制工具可见、非结构化输出、用户消息命中浏览器场景和自动化意图时才进入预选。
2. 先用 `shouldRunAutomationPlaybookSelection(userContent)` 做本地启发式过滤，避免普通聊天多一次模型请求。
3. 通过 `createAutomationPlaybookSelectionPrompt()` 构造只返回 JSON 的选择请求。
4. 选择请求复用当前聊天模型、当前 fetcher、当前重试配置，但强制非流式，不允许工具调用。
5. 模型返回无效 JSON、未选择、未知策略或请求失败时静默跳过，主聊天照常执行。
6. 成功选择后，把 Playbook title、source、confidence、reason 和 prompt 注入浏览器工具系统提示。

预选失败不能阻断聊天。用户最终回答也不能声称“已使用策略”，除非确实有 selection。

## `browser.extract_content` 工具设计

新增 `src/shared/browser-extract-content.mjs`，提供工具常量、参数校验和结果格式化：

- 工具 ID：`browser.extract_content`
- 模型函数名：`extract_content`
- 权限域：`browser-control`
- 风险：`medium`
- 默认 `mode`：`text`
- 默认 `source`：`auto_rule`
- 默认 `maxLength`：`30000`
- `maxLength` 范围：`500` 到 `200000`
- `selector` 最大长度：`2000`

参数：

```js
{
  mode: "text" | "html",
  source: "auto_rule" | "document" | "selector",
  selectorType?: "css" | "xpath",
  selector?: string,
  maxLength?: number
}
```

约束：

- `source=selector` 时必须提供 `selectorType` 和非空 `selector`。
- `source` 不是 `selector` 时不能携带 `selectorType` 或 `selector`。
- CSS/XPath 只作为选择器，不接受 JavaScript 表达式。
- 工具只读，不执行模型提供的脚本，不读取 Cookie、Storage 或跨域 iframe。
- 返回内容按 `maxLength` 截断，并显式标记 `truncated`、`usedFallback`、`matchedRuleId`。

## 执行路径

优先复用当前已有 `pageContext.extract` 能力：

- `source=auto_rule`：使用当前提取规则，行为等价于发送前页面上下文提取。
- `source=document`：忽略提取规则，读取当前文档正文或 HTML。
- `source=selector`：构造一次性临时规则，只对本次工具调用生效。
- `mode=text`：返回可见文本。
- `mode=html`：返回 HTML 模式结果。

后台需要增加一个 source-owned 适配层，例如 `src/ai-assistant/background/browser-extract-content-service.js`，负责：

- 读取当前受控 tab id。
- 调用现有页面提取逻辑或同等消息路径。
- 格式化工具返回文本。
- 把错误转成 tool result。

由于当前 `background/index.js` 仍有 bundle 化浏览器控制类，实施计划应优先做小范围接线：扩展工具定义、工具可见性判断和工具执行分支，避免重写整个 browser-control manager。

## 工具注册和提示注入

`src/shared/browser-control-contract.mjs` 增加 `EXTRACT_CONTENT` action 和 tool definition。`BROWSER_CONTROL_TOOL_DEFINITIONS` 要包含该工具，且 `validateBrowserControlRequest()` 复用 `browser-extract-content.mjs` 的参数校验。

浏览器控制系统提示新增两类内容：

- 通用工具规则：需要当前页面正文、全文 HTML、提取规则、CSS 或 XPath 局部内容时调用 `extract_content`。
- 安全边界：该工具只读，不执行自定义脚本，不读取 Cookie、Storage 或跨域 iframe。

Playbook prompt 追加在浏览器控制工具规则之后，避免覆盖基础安全约束。

## 审计和结果摘要

`extract_content` 调用必须进入现有工具调用记录和 Phase 1 工具审计：

- 参数摘要记录 `mode`、`source`、`selectorType`、截断后的 `selector`、`maxLength`。
- 结果摘要只记录标题、URL、来源、字符数、是否截断和前几百字符摘要。
- 不在审计日志保存完整页面文本、HTML、Cookie、Storage 或原始大响应。
- 工具失败记录错误消息和耗时。

## 测试策略

新增或更新以下测试：

- `scripts/test_automation_playbooks.mjs`：覆盖 Playbook 注册、设置归一化、启发式触发、模型选择结果归一化、选中 prompt 生成。
- `scripts/test_browser_extract_content.mjs`：覆盖参数默认值、非法 mode/source、selector 约束、maxLength 范围、结果格式化和截断。
- `scripts/test_browser_control_queue.mjs`：覆盖 `browser.extract_content` action 解析、schema 暴露和参数校验。
- `scripts/test_background_agent_tools_wiring.mjs`：覆盖背景脚本包含 `browser.extract_content`、`extract_content` 提示、Playbook 选择提示和安全边界文案。
- `scripts/run_unit_tests.mjs`：加入新增测试。
- `python scripts\verify_ai_sidebar_core.py`：如可行，增加工具菜单或工具调用路径 smoke；如果浏览器控制真实环境不可用，记录环境错误。

完整验证命令：

```powershell
npm test
python scripts\verify_ai_sidebar_core.py
```

## 风险与控制

- 预选模型请求增加延迟：只在启发式命中且浏览器工具可用时触发，失败静默跳过。
- `extract_content` 可能返回大文本：强制 `maxLength`、结果摘要截断、审计不保存全文。
- HTML 可能包含敏感页面内容：工具仅在用户开启浏览器控制和工具调用时暴露，审计只保存摘要。
- 当前背景脚本 bundle 化：实施时只做最小接线，并用 source assertion 测试锁住关键字符串和路由。
- 多页面汇总可能误用页面 index：Playbook prompt 明确必须先 `list_pages`，只能使用返回的 index。
- 高风险表单策略暂不迁入，避免扩大操作边界。

## 交付边界

Phase 2 完成后，应具备：

- 模型在页面阅读和多页面汇总任务中能自动获得 Playbook 策略。
- 模型可调用 `browser.extract_content` 读取当前受控页正文、HTML 或选择器内容。
- 所有新增纯逻辑有 Node 单测。
- 背景接线有 source assertion 测试。
- README 和架构文档说明 Phase 2 能力和未迁入能力。

Phase 2 不要求：

- 新设置页。
- 完整上游 Playbook UI。
- 上游所有浏览器自动化工具。
- Network/Runtime/Replay/Full Access 能力。

## 后续阶段

Phase 2 验证通过后，建议继续单独设计：

1. Debugger Console 和 Performance 只读诊断。
2. Debugger Network recorder 与请求详情脱敏。
3. JS/Source Map/Runtime 只读分析。
4. Replay 请求重放沙箱。
5. Full Access 完全访问模式。
6. AI 侧边栏源码化重构。
