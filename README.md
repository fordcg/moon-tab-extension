# Moon Tab Extension

Moon Tab 是一个原生 Chrome Manifest V3 扩展，包含新标签页、小游戏页面，以及 Browser AI Assistant 侧边栏。

## 运行方式

本项目正在迁移为 Vite / React / TypeScript 工程化扩展。源码不再直接以项目根目录作为最终加载目录；开发和验收时先生成构建产物。

安装依赖：

```powershell
npm install
```

构建扩展：

```powershell
npm run build:extension
```

在 Chrome/Edge 打开扩展管理页，启用开发者模式，选择“加载已解压的扩展”，目录指向 `dist/`。后续本地可分发目录由 `npm run package:extension` 生成。

Phase 2 起，`dist/` 同时包含 Moon Tab 新标签页和小游戏页面。新标签页由构建后的 `src/pages/newtab/index.html` 提供，游戏页面由 `src/pages/game/index.html` 提供；页面间导航继续使用这两个扩展内路径。

Phase 0-1 的 `dist/` 是降权工程化基线：默认不声明 `debugger` 权限。上游 debugger-backed browser control、`js.*`、`sourcemap.*`、`runtime.*`、`replay.*` 和 `full_access.*` 源码已导入，可能出现在工具偏好设置中，但当前构建不会在运行时暴露为可用能力；后续按独立 Phase 启用。

## 常用命令

```powershell
npm run typecheck
npm run build:extension
npm test
npm run test:legacy
npm run test:e2e
npm run check:package
npm run verify:release
```

`npm test` 运行工程化后的 Vitest 测试；`npm run test:legacy` 保留迁移期间仍有价值的 Node 脚本回归；`npm run test:e2e` 验证构建后的侧栏、新标签页、游戏页面和真实扩展加载 smoke；`npm run verify:release` 依次执行 `check`、E2E 和发布产物检查，是 Phase 7 发布候选验收入口。

## 发布验收

发布候选验收使用：

```powershell
npm run verify:release
```

该命令会生成 `dist/` 和 `artifacts/chrome-extension/`，并确认 manifest 声明入口、打包产物、测试排除、旧产物缺失和当前无 `debugger` 权限边界。验收矩阵维护在 `docs/superpowers/release-readiness.md`。

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

### Phase 4：DevTools Network 只读分析

AI 侧边栏继续基于 Phase 3 的已脱敏 Network 详情增加两个只读分析工具：

- `network.compare_requests`：对多个请求做稳定字段、变化字段和疑似关键参数对比。
- `network.find_parameter_candidates`：从 query、请求头和请求体中提取签名、时间戳、随机数、请求 ID、凭据类字段候选。

这两个工具只读取 `network.list_requests` 返回的 `requestIds` 对应详情，不新增 debugger-backed recorder，不发送请求，不执行页面脚本。输出会再次脱敏和截断；Phase 4 当时不迁入 JS 候选片段、`network.clear_requests`、`network.wait_for_requests`、`js.*`、`sourcemap.*`、`runtime.*`、`replay.*`、`full_access.*` 或原始凭据读取。

### Phase 5：DevTools Network JS 候选片段

AI 侧边栏在 Phase 4 的只读 Network 分析基础上继续增加 `network.extract_js_candidates`：

- 只分析 `network.list_requests` 返回、再由模型显式传入的 JS 请求 `requestIds`。
- 从已脱敏、已截断的 JS `responseBody` 中按关键词、接口路径或参数名提取有限候选片段。
- 不执行页面脚本，不补 fetch，不解析 Source Map，不读取 Cookie、Storage 或原始凭据。

### Phase 6：DevTools Network 清空请求缓存

AI 侧边栏继续迁入低风险的 `network.clear_requests`：

- 只清空当前 DevTools bridge 和后台 snapshot 中的已采集请求缓存。
- 清空后 DevTools bridge 会推送空 snapshot，后续 `network.list_requests` 从新请求重新开始。
- 不发送网络请求，不读取额外详情，不执行页面脚本，不关闭 DevTools。

当前仍不迁入 `network.wait_for_requests`、无 requestIds 的全局 JS 搜索、`js.*`、`sourcemap.*`、`runtime.*`、`replay.*` 或 `full_access.*`。

## 目录结构

- `public/manifest.json`: Vite/package 流程使用的 MV3 源清单；扩展加载使用构建输出 `dist/` 或打包产物，不直接加载仓库根目录。
- `src/content/`: 注入普通网页的 content script 源码，目前负责页面上下文提取和可拖动 AI 悬浮窗激活；构建后输出为 `content/index.js`。
- `src/background/`: Service Worker 入口和扩展级事件注册。
- `src/shared/`: 跨页面共享的纯逻辑、协议和状态工具。
- `src/pages/newtab/`: 新标签页功能。UI 控制器放在根层，纯逻辑放在 `helpers/` 或独立 service 模块。
- `src/pages/game/`: 游戏页面、物理/工人逻辑、素材和单测。
- `src/side-panel/`: Browser AI Assistant React 侧栏源码，包含聊天、工具设置、MCP、历史和运行态 UI。
- `src/devtools/`: DevTools Network 兼容页源码，通过 `chrome.devtools.network` 采集脱敏请求并发给后台 bridge。
- `src/background/imagefreeToolRuntime.ts`: Imagefree 图片生成工具的 source-owned 后台 runtime hook。
- `scripts/`: 不依赖构建工具的测试和验证脚本。
- `docs/`: 架构说明和较长的设计文档。

## 维护约定

- 新标签页里，DOM 交互留在 controller，接口请求、解析、决策归一化放到 service/helper。
- 共享协议优先放在 `src/shared/`，避免页面之间互相 import 私有模块。
- 临时截图、浏览器 profile、调试输出放到 `.tmp/` 或 `tmp/`，不要放在根目录。
- 修改 AI 搜索决策逻辑后至少运行 `npm test`。
