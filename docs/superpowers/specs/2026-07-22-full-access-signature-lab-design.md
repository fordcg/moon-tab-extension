# Full Access 签名实验室设计

## 背景

Moon Tab 的 Browser AI Assistant 已具备 debugger-backed 浏览器控制、Network recorder、JS 搜索、Source Map、Runtime 只读、受控增强、Replay 沙箱和 Full Access 工具。现有能力偏“工具清单”和“通用分析”，还没有为接口逆向、参数签名定位和验证形成一条高权限闭环。

用户当前目标是个人本机使用，不优先考虑公开发布时的低权限上手体验。下一阶段应把已有最高权限能力组织成“签名实验室”：用户显式进入完全访问模式后，模型可以自主读取原始请求、读取页面存储、执行页面脚本和发起页面上下文请求，用于定位签名函数、验证签名假设和输出可复查的证据报告。

## 目标

1. 建立一个面向接口逆向和签名参数分析的 Full Access 工作流。
2. 用户进入完全访问模式后，模型可以自主使用 `full_access.*` 工具，不再对每次脚本执行、原文读取或请求发送做二次确认。
3. 把目标请求、敏感来源、候选参数、JS/运行时证据、验证步骤和结论沉淀为结构化调试报告。
4. 保留最低工程护栏：显式入口、持续状态、撤销、导航/切 tab 清理、审计记录、默认脱敏导出。
5. 复用现有 Tool Registry、浏览器控制运行态、工具附件、工作流任务和审计链路，不新增第二套执行引擎。

## 非目标

- 不让普通模式或受控增强模式自动获得完全访问能力。
- 不绕过浏览器、扩展平台、站点风控、验证码、跨域策略或真实登录限制。
- 不承诺自动破解签名算法；第一版目标是定位、假设和验证。
- 不把 Full Access 原文默认写入同步快照、Markdown/Word/PDF 导出或后续追问上下文。
- 不把 Replay 沙箱改造成主要执行路径；Full Access 下请求验证优先使用 `full_access.fetch`。
- 不面向多人协作、远程执行或公开市场发布做权限体验优化。

## 设计选择

### 推荐方案：Full Access-first 签名实验室

当用户手动切到完全访问模式后，签名分析策略直接引导模型使用 `full_access.get_network_details`、`full_access.read_storage`、`full_access.execute_script` 和 `full_access.fetch`。这些工具在当前会话内视为用户已授予最高信任，不再逐次调用 `boundary.request_user_choice`。

优点：

- 最符合个人本机高权限使用场景。
- 能读取真实 Cookie、Storage、Header、Body 和运行时函数，适合定位签名生成链。
- 能直接用页面上下文发请求验证假设，不受 Replay 沙箱的凭据和敏感字段限制。

代价：

- 模型误执行脚本或误发请求的风险显著提高。
- 工具结果可能包含敏感原文，必须严格限制默认导出、同步和后续上下文注入。
- 需要更清晰的 UI 状态和审计摘要，方便事后复盘。

### 保留路径：受控增强 + Replay 沙箱

受控增强模式继续保留 `replay.*` 作为较安全的验证路径：生成脱敏草案、一次性确认、发送无凭据请求并对比摘要。它适合未来公开发布或不想完全放开的网站场景，但不是本设计的第一优先级。

### 不采用：新增全自动复合工具

暂不新增 `network.trace_signature_flow` 这类复合工具。第一版先把策略、提示和报告格式做好，避免把启发式过早固化在单个工具里。等真实使用中沉淀出稳定流程后，再把高频步骤抽成复合工具。

## 核心工作流

### 入口

新增或强化一个内置自动化策略：`full_access_signature_lab`，标题为“签名实验室”。它面向以下用户意图：

- “分析这个接口签名怎么生成”
- “找 sign / timestamp / nonce / x-sign 的生成逻辑”
- “逆向这个请求参数”
- “验证这个接口重放为什么失败”
- “找 JS 里哪里生成了加密 body”

策略选择可以自动发生，但策略不能自动开启完全访问。如果当前不是完全访问模式，模型必须先说明需要用户手动切换到完全访问，或者退化到普通 Network/JS 脱敏分析。

### 执行顺序

1. **锁定目标请求**
   先用 `network.summarize_api_candidates`、`network.wait_for_requests` 或 `network.list_requests` 找到目标接口；必要时让用户重新触发页面动作。

2. **读取原始证据**
   在完全访问模式下调用 `full_access.get_network_details` 读取目标请求的原始 URL、query、headers、body、response。记录哪些字段可能是凭据，哪些字段可能参与签名。

3. **识别签名候选**
   对 query、headers、JSON/form/text body 做候选分类：签名、时间戳、随机数、请求 ID、设备信息、加密载荷、凭据字段、业务参数。多样本时对比稳定字段和变化字段。

4. **搜索 JS 线索**
   用接口路径、参数名、Header 名、响应字段和签名字段搜索 JS 资源。优先定位命中位置、函数名、模块导出和上下文片段。

5. **映射源码**
   如果 Source Map 可用，映射到原始源码位置并读取附近上下文；不可用时保留 bundle 资源、行列号、关键词和片段。

6. **运行时取证**
   通过 `full_access.execute_script` 在页面上下文搜索全局对象、webpack/Vite 模块缓存、函数源码、请求封装器和签名函数。脚本应尽量只读，但完全访问模式不强制限制表达式。

7. **验证假设**
   模型可以构造输入，调用页面内疑似签名函数，或用 `full_access.fetch` 在页面上下文发起验证请求。验证时需要记录改动了哪些字段、是否携带 credentials、响应状态和差异。

8. **输出报告**
   最终产物必须按固定结构输出，区分事实证据、推断和未验证假设。

## 工具语义

### Full Access 工具

- `full_access.get_network_details`：读取已采集请求和响应原文。结果允许含敏感字段，但只在当前会话可见。
- `full_access.read_storage`：读取当前页面可访问的 Cookie、localStorage、sessionStorage 和页面状态原文。
- `full_access.execute_script`：执行任意 JavaScript 表达式或脚本，允许访问页面运行时、模块缓存、函数源码和全局对象。
- `full_access.fetch`：在页面上下文发起请求，默认 `credentials=include`，用于验证签名假设或复现接口调用。
- `full_access.revoke`：撤销完全访问并清理授权上下文。

### 普通和受控增强工具

普通模式继续默认脱敏。受控增强模式继续通过 `boundary.request_user_choice` 和 `replay.*` 处理一次性确认，不继承 Full Access 的完全放开语义。

### 系统提示要求

完全访问模式下的工具提示应明确：

- 当前模式已获得用户最高权限，可以直接使用 `full_access.*` 完成取证和验证。
- 不需要为了 `full_access.*` 调用再请求 `boundary.request_user_choice`。
- 需要主动记录敏感读取和请求发送的目的、证据来源和结论依据。
- 结论必须标注“已验证”“高置信推断”“低置信猜测”。
- 不要把敏感原文复制进最终回答，除非用户明确要求展示某个具体字段。

## 报告格式

签名实验室的默认产物为调试报告，建议结构固定为：

```markdown
## 目标接口

- 方法：
- URL：
- 触发动作：
- 样本请求：

## 参数与敏感来源

| 位置 | 字段 | 类型 | 是否变化 | 作用判断 | 证据 |
|---|---|---|---|---|---|

## 签名候选

- 字段：
- 样本规律：
- 参与输入猜测：
- 排除项：

## JS / 运行时证据

- 资源或模块：
- 函数路径：
- 关键源码片段：
- Source Map 映射：

## 验证过程

- 探测脚本：
- 构造输入：
- 请求验证：
- 响应差异：

## 结论

- 最可能生成逻辑：
- 置信度：
- 未验证假设：
- 下一步：
```

报告中的凭据、Cookie、Token、密码、会话 ID 和完整敏感 body 默认只做摘要引用，不直接输出原文。

## UI 与状态

第一版不需要大改界面，但必须满足：

1. 完全访问模式只能由用户手动切换。
2. 完全访问开启后，顶栏或输入区持续显示“完全访问”状态和撤销入口。
3. 导航、刷新、切换 tab、关闭浏览器控制、debugger detach 或用户撤销时清理完全访问授权。
4. 工具审计继续记录每次 `full_access.*` 调用的工具名、参数摘要、耗时、状态和结果摘要。
5. 任务工作流中的调试报告只保存脱敏后的摘要和引用，不保存原始凭据。

## 数据边界

Full Access 工具结果可以在当前会话内包含原文，但以下路径默认仍要脱敏：

- 工具审计日志。
- 工作流 ContextItem 摘要。
- 工作流 Artifact 内容。
- Markdown、Word、PDF 导出。
- 复制消息。
- 后续追问自动注入的历史工具上下文。
- 同步备份快照。

如果未来需要原文导出，应单独设计“本机原文导出”开关，并要求用户显式操作。

## 错误与降级

- 未开启浏览器控制：提示先开启浏览器控制。
- 未开启完全访问：解释当前只能做脱敏分析，并给出切换完全访问的下一步。
- 目标请求不存在：引导用户清空请求后重新触发动作，再用 `network.wait_for_requests` 捕获。
- Source Map 不可用：保留 bundle 命中位置和上下文。
- 页面运行时不可读：退回 JS/Network 证据，不编造函数路径。
- `full_access.fetch` 请求失败：报告失败状态、重定向、CORS/网络错误或响应差异，不重复无意义请求。

## 测试策略

### 单元测试

新增或更新：

- `tests/unit/shared/automationPlaybooks.test.ts`：签名实验室 Playbook 存在、风险为 `critical`、提示不会自动开启完全访问。
- `tests/unit/background/backgroundToolRuntime.test.ts`：完全访问模式系统提示允许直接使用 `full_access.*`，且不要求边界确认。
- `tests/unit/background/fullAccessToolExecutor.test.ts`：脚本执行、fetch、Storage 和 Network 原文读取仍绑定当前 tab/origin 和撤销状态。
- `tests/unit/shared/toolArtifacts.test.ts`：Full Access 原文不会默认进入导出和后续追问上下文。
- `tests/unit/side-panel/appStoreWorkflowTasks.test.ts`：签名实验报告作为 `debug-report` 保存时默认脱敏。

### 集成验证

保留现有 `npm run typecheck`、`npm test`、`npm run build:extension`。若改动真实扩展运行态，需要补充或运行 Playwright smoke，验证：

- 开启完全访问后工具可见。
- 撤销后 `full_access.*` 不再暴露。
- 签名实验室请求会走任务工作流并生成调试报告。

## 实施顺序

1. 新增 `full_access_signature_lab` 内置 Playbook，并补选择提示和单元测试。
2. 强化完全访问模式系统提示，让模型在该模式下直接使用 `full_access.*` 做取证和验证。
3. 调整工作流调试报告识别和导出边界，确保签名实验报告默认脱敏。
4. 补 Full Access 工具链的聚焦回归测试。
5. 手工用一个本地测试页面验证“目标请求 -> 原始证据 -> 脚本取证 -> fetch 验证 -> 报告”的闭环。
