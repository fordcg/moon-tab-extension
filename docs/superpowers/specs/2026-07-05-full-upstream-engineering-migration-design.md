# 全面迁移远程工程化结构设计

## 背景

当前项目 `D:\proj\test` 是一个可直接加载根目录的 Chrome Manifest V3 扩展，产品范围包括 Moon Tab 新标签页、小游戏、Browser AI Assistant 侧栏、悬浮助手、本地 Grok/MCP Bridge 和若干验证脚本。远程项目 `AhYi8/browser-ai-assistant` 是 Vite、React、TypeScript 工程，Browser AI Assistant 侧栏源码、后台工具、共享模型、测试和打包流程更完整。

迁移目标是采用远程项目的工程化结构作为主骨架，同时保留本项目的浏览器扩展能力。`PocketAide/` 不属于浏览器扩展，本次迁移中从当前仓库删除。

## 目标

1. 将当前项目迁移为 Vite + React + TypeScript + Vitest + Playwright 的工程化浏览器扩展。
2. 恢复 AI 侧栏源码级维护方式，避免长期维护 `src/ai-assistant/sidePanel.js` 这类预构建 bundle 和 `sidePanel-layout.js` DOM patch。
3. 保留 Moon Tab 新标签页、小游戏、悬浮助手、Grok/MCP Bridge、Imagefree 工具运行时和当前有价值的质量验证入口。
4. 让构建产物通过可重复命令生成，扩展加载目录从项目根切换到构建输出目录。
5. 分阶段迁移高风险浏览器自动化能力，避免一次性引入远程的全部 debugger、JS、SourceMap、Runtime、Replay 和 Full Access 能力。

## 非目标

1. 不把 `PocketAide/` 迁入新工程，也不把它作为 monorepo 子包保留。
2. 不在第一阶段一次性启用远程全部高风险工具族。
3. 不保留长期手工维护的 AI 侧栏打包产物作为源码事实来源。
4. 不改变用户已经确认的核心产品边界：Moon Tab、新标签页、小游戏、侧栏、悬浮助手和本地 Grok/MCP 能力都必须保留。

## 推荐方案

采用“远程工程为底座，移植本项目能力”的方案。

新的源码结构以远程项目为主体：

```text
public/manifest.json
src/background/
src/content/
src/shared/
src/side-panel/
src/pages/newtab/
src/pages/game/
scripts/
tests/
examples/mcp-bridge/
```

其中 `src/side-panel/`、`src/background/`、`src/shared/` 以远程 Browser AI Assistant 的源码结构为基础；`src/pages/newtab/`、`src/pages/game/`、悬浮助手、Grok/MCP Bridge、Imagefree 集成从当前项目迁入并适配构建输出。

## 架构设计

### 构建与入口

`package.json`、`package-lock.json`、`vite.config.ts`、`tsconfig.json`、`vitest.config.ts`、`playwright.config.ts` 采用远程工程化方式。扩展源码不再直接以根目录加载，构建后输出到 `dist/`，本地可分发目录继续由打包脚本生成。

Vite 需要支持多个扩展页面入口：

1. `index.html`：AI 侧栏入口。
2. `src/pages/newtab/index.html`：Moon Tab 新标签页入口。
3. `src/pages/game/index.html`：小游戏入口。
4. `src/background/index.ts`：MV3 service worker。
5. `src/content/index.ts`：content script，按 IIFE 或兼容 MV3 content script 的方式输出。

### Manifest 合并

以远程 `public/manifest.json` 为基础，合并当前项目的能力：

1. `chrome_url_overrides.newtab` 指向构建后的新标签页。
2. `content_scripts` 保留页面内容提取和悬浮助手注入能力。
3. `web_accessible_resources` 覆盖悬浮助手 iframe、页面资源、游戏和必要静态资产。
4. `permissions` 保留 `sidePanel`、`storage`、`contextMenus`、`activeTab`、`scripting`、`alarms`、`debugger`、`tabs`。
5. `commands` 保留 `open-side-panel`。

DevTools Network 旧链路第一阶段可临时保留，但必须明确为兼容层。后续若切换到远程 CDP Network recorder，应删除 `devtools_page` 和 `chrome.devtools.network` 链路。

### AI 侧栏

AI 侧栏恢复为远程 `src/side-panel/` 的 React 源码结构。当前 `src/ai-assistant/sidePanel.js`、`src/ai-assistant/assets/*`、`open-design-preview.html` 只作为迁移参考，不作为长期源码。

`sidePanel-layout.js` 中必须迁移的能力拆成 React/状态层实现：

1. tab 级会话连续性。
2. 悬浮窗打开入口。
3. 历史抽屉和设置交互中当前项目新增的入口。
4. 工具和 MCP 管理入口中本项目特有的 Grok 预设和审计展示。
5. 当前项目对输入区、长消息、空状态、通知等 UI 的必要增强。

迁移后不再通过 DOM 查询和 patch 修改 React 已渲染结构。

### Moon Tab 新标签页

`src/pages/newtab/` 保留当前功能边界，迁入 Vite 构建：

1. 搜索目标、搜索建议、搜索历史、AI 预览服务继续按当前 helper/service/controller 分层。
2. widget 系统、todo widget、布局状态和编辑模式保留。
3. 现有图片和 Three.js 资产进入构建资源路径，避免运行时引用根目录源码路径。
4. 新标签页与 AI 侧栏共享的协议放入 `src/shared/`。

### 小游戏页面

`src/pages/game/` 保留当前 Matter.js、sprite runtime、worker 逻辑和测试。构建迁移时保持游戏资源路径稳定，测试从 `node --test` 逐步纳入 Vitest 或保留为独立 Node 测试命令。

### Background 与工具系统

远程 `src/background/index.ts` 作为主入口，吸收当前项目的包装能力：

1. tab scoped side panel 开关和新标签页继承逻辑。
2. 悬浮助手 runtime message。
3. Imagefree 工具运行时注册。
4. Grok/MCP Bridge 配置、刷新、调用和审计。
5. 当前 DevTools Network bridge 的兼容路由。

工具注册表以远程 `src/shared/models/toolRegistry.ts` 为主，当前 JS 版 `agent-tool-registry.mjs`、`network-tools.mjs`、`browser-control-contract.mjs` 的低风险工具先迁成 TypeScript 模块。高风险工具保持远程授权模型，不在未配 UI、审计和测试时默认暴露。

### Network 迁移策略

第一阶段保留当前 DevTools bridge 的只读 Network 工具，保证 `network.list_requests`、`network.get_request_details`、`network.clear_requests`、`network.compare_requests`、`network.find_parameter_candidates`、`network.extract_js_candidates` 可继续工作。

第二阶段再评估切换到远程 CDP Network recorder。切换条件：

1. 浏览器控制开关和授权 UI 已稳定。
2. Network 脱敏、截断、审计和工具附件测试已覆盖。
3. `network.wait_for_requests` 的等待者、超时、断线恢复语义已通过单元测试和扩展 smoke 测试。

### MCP 与 Grok

远程 `src/shared/mcp/*` 和 `McpToolSettings.tsx` 作为源码底座。本项目保留：

1. Grok 搜索预设。
2. 本地 Bridge 启动、安装、卸载脚本。
3. `examples/mcp-bridge/` 示例。
4. 工具调用审计日志。

Bearer Token 和 Grok API Key 必须继续保存在本地扩展存储，不进入同步快照。外部或高风险 MCP 工具默认需要运行时开关和审计记录。

### PocketAide 删除

`PocketAide/` 在实施阶段从当前仓库删除。删除前不迁移其代码、配置、依赖和测试；删除后确认 `git status` 中不再出现该目录。根项目 README 不再描述 PocketAide。

## 分阶段计划

### Phase 0：隔离与清理

建立隔离工作区，确认当前基线。删除 `PocketAide/`，并记录这是浏览器扩展工程边界收敛，不影响 Moon Tab 和 AI 侧栏目标。

### Phase 1：工程化骨架

引入远程工程基础文件和构建脚本，使空迁移骨架可以安装依赖、类型检查、构建和运行基础测试。

### Phase 2：扩展页面迁移

迁入 newtab 和 game 页面到 Vite 多入口构建。确保构建后的 manifest 能正确指向新标签页、游戏页面和 content script。

### Phase 3：AI 侧栏源码恢复

迁入远程 `src/side-panel/` React 源码，并把当前 `sidePanel-layout.js` 的必要行为转为组件和 store 逻辑。

### Phase 4：Background 合并

合并 service worker 逻辑，保留 tab scoped side panel、悬浮助手、Grok/MCP、Imagefree、DevTools Network bridge 兼容层。

### Phase 5：工具与安全边界

合并工具注册、浏览器控制、Network、MCP、Tavily、工具附件和审计。低风险能力先启用，高风险能力按远程授权模式逐步开放。

### Phase 6：旧产物清理

删除长期不可维护的 `src/ai-assistant/sidePanel.js`、旧 assets bundle 和 DOM patch 适配层。保留的运行时代码必须有源码来源和测试覆盖。

### Phase 7：验收与发布准备

执行类型检查、构建、单元测试、E2E、扩展加载 smoke。覆盖 AI 侧栏、新标签页、小游戏、悬浮助手、Grok/MCP、Network 工具和浏览器控制基础工具。

## 风险与缓解

| 风险 | 缓解 |
|---|---|
| 一次性迁移过大导致扩展不可用 | 每个 Phase 都产出可运行构建，并保留回归命令 |
| `sidePanel-layout.js` 行为迁漏 | 先列行为清单，再逐项迁成 React 组件或 store action |
| DevTools Network 与远程 CDP Network 冲突 | 第一阶段保留 DevTools 兼容层，不同时默认暴露两套 recorder |
| Manifest 路径在构建后失效 | 为 manifest 和 HTML 资源引用增加打包测试 |
| MCP/Grok 敏感信息进入同步或日志 | Token/API Key 只进本地存储，审计日志脱敏 |
| 高风险工具过早暴露 | 普通模式只暴露低风险工具，增强/完全访问需要 UI 和测试后再启用 |
| 许可证边界不清 | 迁入远程 GPL-3.0-only 源码后，根项目必须明确许可证策略 |

## 验收标准

1. `npm install`、`npm run typecheck`、`npm run build:extension`、`npm run test` 成功。
2. 构建产物可作为 Chrome/Edge MV3 扩展加载。
3. 新标签页打开 Moon Tab，搜索、widget、设置和 AI 预览基础路径可用。
4. 小游戏页面可打开，worker/sprite 基础测试通过。
5. AI 侧栏可打开，可配置模型，可发送消息，可显示历史和设置。
6. 悬浮助手可从侧栏或快捷入口打开，并能关闭。
7. Grok/MCP Bridge 设置、刷新、工具列表、工具调用和审计日志可用。
8. Network 只读工具在 DevTools bridge 模式下保持现有能力。
9. `PocketAide/` 不再存在于当前仓库。
10. 旧 AI 侧栏 bundle 不再作为长期源码依赖。

## 自检

本设计没有未定项；迁移范围、保留能力、删除范围、阶段边界和验收标准均已明确。设计把远程工程结构作为目标，同时避免第一阶段一次性启用高风险工具族，符合分阶段可验证迁移原则。
