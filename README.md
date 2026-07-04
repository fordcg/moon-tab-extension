# Moon Tab Extension

Moon Tab 是一个原生 Chrome Manifest V3 扩展，包含新标签页、小游戏页面，以及 Browser AI Assistant 侧边栏。

## 运行方式

1. 在 Chrome/Edge 打开扩展管理页。
2. 启用开发者模式。
3. 选择“加载已解压的扩展”，目录指向项目根目录。

扩展入口由 `manifest.json` 定义，不需要构建步骤。

## 常用命令

```powershell
npm test
```

`npm test` 会顺序运行 `scripts/` 下的 Node 单测，以及 `src/pages/game` 的 `node:test` 用例。

启动本地 Grok Search MCP Bridge：

```powershell
cd D:\proj\test
npm run mcp:grok-search
```

Chrome 扩展不能直接启动任意本地 Node 进程。推荐安装一次 Windows 登录自启任务，让 Bridge 常驻后台：

```powershell
cd D:\proj\test
npm run mcp:grok-search:install-service
```

需要手动后台启动时使用：

```powershell
npm run mcp:grok-search:start-bg
```

卸载登录自启任务：

```powershell
npm run mcp:grok-search:uninstall-service
```

Bridge 默认桥接 `D:\novel\2\.claude-grok-search-mcp\server.mjs`，并在 `http://127.0.0.1:17333/` 暴露侧边栏需要的 `GET /tools/list` 与 `POST /tools/call`。Grok API Key、Base URL 和模型会持久化到 `%LOCALAPPDATA%\MoonTab\grok-search-mcp-bridge.config.json`，Codex/Claude Code 也可以通过 `scripts/grok_search_http_mcp_proxy.mjs` 共用这个常驻 Bridge。

启动后在 AI 侧边栏“工具和 MCP”中可以：

- 新增 HTTP / Streamable HTTP MCP Server。
- 使用“添加 Grok 搜索预设”快速接入本地 Grok Search MCP Bridge。
- 启用或禁用 MCP Server。
- 刷新并查看 MCP Server 已发现工具。
- 查看最近工具调用审计日志和清空审计日志。

Grok 预设仍默认使用 `http://127.0.0.1:17333/`。保存 Grok API Key 时，Key 只保存在本机扩展存储，并同步写入本地 Bridge 的 `/config`；留空不会清除旧 Key，只有显式清除才删除。

## AI 侧边栏迁移进度

### Phase 2：任务策略和页面内容提取

AI 侧边栏已迁入上游的低风险浏览器任务策略地基和只读页面内容提取工具：

- 页面阅读：优先使用当前受控页面作为事实来源，必要时调用 `browser.extract_content` 读取正文、HTML 或选择器内容。
- 多页面汇总：先列出已打开页面，再逐页收集标题、URL 和证据摘要，必要时在对应页面调用 `browser.extract_content`。

`browser.extract_content` 是只读工具，不执行模型提供的脚本，不读取 Cookie、Storage 或跨域 iframe。工具结果会按长度限制截断，审计日志只记录摘要。

Phase 2 仍不迁入 Console、Performance、Debugger Network recorder、`network.*`、`js.*`、`sourcemap.*`、`runtime.*`、`replay.*`、`full_access.*`、上游 React/TypeScript/Vite 设置页或高风险表单交互 Playbook。

### Phase 3：DevTools Network 只读工具

AI 侧边栏已迁入两个只读 Network 工具，复用现有 DevTools Network 面板桥接，不启用 debugger-backed Network recorder：

- `network.list_requests`：列出 DevTools 已采集并脱敏、截断的请求摘要，可按资源类型过滤。
- `network.get_request_details`：根据 `network.list_requests` 返回的 `requestIds` 读取请求/响应详情，详情同样先脱敏、截断再进入模型和审计。

使用前必须保持目标标签页的 DevTools Network 面板打开并连接；否则工具只返回不可用错误，不另建采集通道。

Phase 3 的边界：URL query、headers、body 和响应体中的 Cookie、Authorization、Token、Secret、密码、API Key 等敏感信息默认脱敏，长文本在工具边界截断。当前仍不迁入 Replay、Runtime、Full Access、Debugger Network recorder，也不向模型暴露原始凭据。

## 目录结构

- `manifest.json`: MV3 权限、入口和资源暴露清单。
- `content/`: 注入普通网页的 content script，目前负责打开可拖动的 AI 悬浮窗。
- `src/background/`: Service Worker 入口和扩展级事件注册。
- `src/shared/`: 跨页面共享的纯逻辑、协议和状态工具。
- `src/pages/newtab/`: 新标签页功能。UI 控制器放在根层，纯逻辑放在 `helpers/` 或独立 service 模块。
- `src/pages/game/`: 游戏页面、物理/工人逻辑、素材和单测。
- `src/ai-assistant/`: AI 侧边栏页面。`sidePanel.js`、`assets/`、`open-design-preview.html` 是打包/预览产物，手写适配层主要是 `sidePanel-layout.js`、`sidePanel-layout.css` 和 `agent-tools-dialog.js`。
- `scripts/`: 不依赖构建工具的测试和验证脚本。
- `docs/`: 架构说明和较长的设计文档。

## 维护约定

- 新标签页里，DOM 交互留在 controller，接口请求、解析、决策归一化放到 service/helper。
- 共享协议优先放在 `src/shared/`，避免页面之间互相 import 私有模块。
- 临时截图、浏览器 profile、调试输出放到 `.tmp/` 或 `tmp/`，不要放在根目录。
- 修改 AI 搜索决策逻辑后至少运行 `npm test`。
