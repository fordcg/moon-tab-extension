# Phase 7 发布验收矩阵

本矩阵用于 Browser AI Assistant 上游工程化迁移的发布候选验收。当前发布候选加载目录是 `dist/` 或 `artifacts/chrome-extension/`，不是仓库根目录。

## 发布验收命令

| 命令 | 作用 | 通过标准 |
|---|---|---|
| `npm run typecheck` | TypeScript 类型检查 | `tsc --noEmit` 退出码为 0 |
| `npm run build:extension` | 生成 MV3 扩展构建产物 | `dist/manifest.json` 和声明入口产出 |
| `npm test` | Vitest 单元测试 | 全部测试通过 |
| `npm run test:legacy` | 迁移保留的 Node 脚本回归 | legacy 脚本退出码为 0 |
| `npm run check:package` | 打包脚本测试并生成本地发布包 | `artifacts/chrome-extension/` 生成且无测试文件 |
| `npm run check` | 类型、构建、单测、legacy、打包综合门禁 | 命令链退出码为 0 |
| `npm run test:e2e` | Playwright preview 与真实扩展 smoke | web-preview 和 chrome-extension 项目通过 |
| `npm run verify:release` | 完整发布候选验收入口 | `check`、E2E、发布产物检查全部通过 |

## 最近验证记录

| 命令 | 状态 | 说明 |
|---|---|---|
| `npm run verify:release` | 通过 | 2026-07-09 Full debugger browser automation release gate；check、E2E 和发布产物 debugger 权限校验全部通过 |

## 功能验收矩阵

| 验收面 | 覆盖命令或文件 | 发布标准 |
|---|---|---|
| AI 侧栏 | `tests/e2e/extension-runtime.spec.ts`、`tests/unit/side-panel/App.test.tsx` | 真实扩展可打开 `index.html`，显示聊天、设置和工具入口 |
| Moon Tab 新标签页 | `tests/e2e/extension-runtime.spec.ts`、`tests/e2e/extension-smoke.spec.ts` | 构建后 `src/pages/newtab/index.html` 渲染搜索、AI 增强和页面管理入口 |
| 小游戏 | `tests/e2e/extension-runtime.spec.ts`、`npm run test:legacy` | 构建后 `src/pages/game/index.html` 渲染游戏入口，worker/sprite 回归通过 |
| 悬浮助手 | `tests/unit/content/index.test.ts`、`tests/unit/side-panel/App.test.tsx`、真实扩展侧栏 smoke | 侧栏暴露打开悬浮助手入口，content script 保持 iframe URL 和关闭边界 |
| Grok/MCP Bridge | `tests/unit/background/agentToolsMessageHandler.test.ts`、`tests/unit/side-panel/App.test.tsx` | Grok 预设、MCP Server 配置、工具刷新、调用审计和本地密钥边界保持可用 |
| Debugger 浏览器自动化 | `tests/unit/background/browserControlMessageHandler.test.ts`、`tests/unit/background/backgroundToolRuntime.test.ts`、真实扩展侧栏 smoke | manifest 声明 `debugger`，浏览器控制默认关闭，用户显式开启后普通网页可 attach，关闭或外部 detach 后状态清理 |
| Debugger Network 主路径 | `tests/unit/background/networkRecorder.test.ts`、`tests/unit/background/networkToolExecutor.test.ts`、`tests/unit/background/backgroundToolRuntime.test.ts` | `network.*` 优先走 debugger-backed recorder，支持列表、详情、清空、等待、对比、参数候选和 JS 候选 |
| DevTools Network fallback | `tests/unit/background/networkDevtoolsBridge.test.ts`、`tests/unit/background/index.test.ts` | DevTools bridge 仅在 debugger recorder 不可用且 DevTools Network 已连接时作为脱敏只读 fallback |
| 浏览器控制基础工具 | `tests/unit/background/browserControlMessageHandler.test.ts`、`tests/unit/background/backgroundToolRuntime.test.ts` | 低风险观察和基础操作工具只在浏览器控制运行态可用，受控增强和完全访问不被普通模式默认暴露 |
| Imagefree 与 Tavily | `tests/unit/background/backgroundToolRuntime.test.ts`、`tests/unit/background/agentToolsMessageHandler.test.ts` | Imagefree source-owned runtime hook 可用，Tavily 只接受受限 query 参数并输出 web-search 附件 |
| 打包产物 | `scripts/package-extension.test.ts`、`scripts/verify-release-readiness.mjs` | 发布包包含 manifest 声明页面、background、content、游戏 vendor 和 build-info，排除测试与旧产物 |
| 高风险权限边界 | `tests/unit/background/boundaryChoiceToolExecutor.test.ts`、`tests/unit/background/replayToolExecutor.test.ts`、`tests/unit/background/fullAccessToolExecutor.test.ts` | `replay.*` 只在受控增强模式暴露，`full_access.*` 只在完全访问模式暴露，一次性授权绑定 tab、origin、目标工具和参数 |

## 手工加载验收

1. 运行 `npm run verify:release`。
2. 在 Chrome/Edge 扩展管理页启用开发者模式。
3. 选择“加载已解压的扩展”，目录指向 `dist/` 或 `artifacts/chrome-extension/`。
4. 打开侧栏，确认 AI 侧栏、设置、MCP 工具、聊天偏好、同步设置和悬浮助手入口可见。
5. 打开新标签页确认 Moon Tab 渲染；从页面导航到小游戏确认 `GAME DECK` 可见。
6. 如需验收 Network fallback，保持目标页 DevTools Network 面板打开后再从侧栏调用只读 Network 工具。

## 发布边界

- 当前发布候选声明 `debugger` 权限；浏览器控制默认关闭，只有用户显式开启后才会 attach 当前普通网页。
- DevTools Network 兼容层继续保留为只读 fallback；主要 Network 能力走 debugger-backed recorder。
- Bearer Token、Grok API Key 和外部工具凭据仍保存在本地扩展存储，不进入同步快照。
- `PocketAide/`、旧 `src/ai-assistant` bundle、DOM patch、root no-build manifest/content/service-worker 不属于当前发布产物。
