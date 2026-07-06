# 远程工程化迁移状态

## 当前阶段

Phase 4：合并 TypeScript background/service worker 逻辑，把 tab scoped side panel、悬浮助手、Grok/MCP Bridge、Imagefree 和 DevTools Network 兼容层收拢到 `src/background/index.ts`、`src/background/**` 和 `src/shared/**`。

当前工作区 Phase 4 已实现并通过 2026-07-07 final review-fix fresh verification，尚未形成 git 提交。

## 持久入口

- 总设计：`docs/superpowers/specs/2026-07-05-full-upstream-engineering-migration-design.md`
- 当前计划：`docs/superpowers/plans/2026-07-06-full-upstream-engineering-migration-phase-4.md`

## 已完成提交

| Phase | Commit | 内容 |
|---|---|---|
| Design | `1ba71bd` | 设计全面迁移远程工程化结构 |
| Plan 0-1 | `5ed6ab0` | 制定远程工程化迁移基础计划 |
| Phase 0-1 | `e9f25aa` | 删除 PocketAide 并建立远程工程化迁移基础 |
| Phase 0-1 Review Fix | `29934bb` | 降权构建 manifest 并补齐 Vitest 发现规则回归测试 |
| Phase 0-1 Verification Stabilization | `470476e` | 稳定全量 Vitest 验证和迁移边界文档 |
| Phase 2 | `d7bfdd5` | 迁移 Moon Tab 新标签页和小游戏到 Vite 多入口构建 |
| Phase 3 Plan | `92fb769` | 制定 AI 侧栏 React 源码迁移计划 |

## 当前工作区 Phase 4 结果

- `src/background/index.ts` 已初始化 side panel controller、AgentTools handler、DevTools Network bridge，并继续保留模型、MCP、页面上下文、同步、浏览器控制和聊天流路由。
- `src/background/sidePanelController.ts` 和 `src/shared/sidePanelRuntime.ts` 承接 tab scoped side panel、同窗口新标签继承、切换关闭、悬浮助手打开/关闭和旧消息名兼容。
- `src/content/index.ts` 处理 `sidePanel.floating.attach`、旧 `sidepanelFloating.open` 和 `sidePanel.floating.close`，并继续保留页面内容提取。
- `src/side-panel/App.tsx` 在普通侧栏模式提供 `打开悬浮助手`，在 `floating=1` iframe 模式提供 `关闭悬浮助手`，沿用共享 `sidePanel.*` 消息常量并对非法 `tabId` 给出失败通知。
- `src/side-panel/state/appStore.ts` 会把当前选中的上下文 tabId 写入非流式和流式聊天请求，使 extension-page 侧栏能按所选标签页暴露 DevTools Network 兼容工具。
- `src/content/index.ts` 只信任当前扩展来源的 `index.html?floating=1` 悬浮 iframe URL，拒绝其他扩展来源、其他页面或缺少 `floating=1` 的地址。
- `src/background/agentToolsMessageHandler.ts` 承接 `agentTools.*` 兼容消息，使用当前 MCP settings、工具列表刷新、工具调用和本地审计存储，并对 token/API key 类字段脱敏。
- Grok Bridge 配置和 API key POST 只允许发送到本地 `http:`/`https:` bridge 地址（`localhost`、`127.0.0.1` 或 IPv6 loopback）；远程、非法、非 http(s)、suffix-domain 和 userinfo 绕过形态会跳过推送。
- `src/background/sidePanelController.ts` 的快捷键 fallback 会直接打开 tab-scoped side panel，不再只启用/记录 panel 状态。
- `src/background/networkDevtoolsBridge.ts` 恢复 `network.devtools` 端口和 `networkContext.*` runtime 消息，DevTools 兼容层只返回脱敏的 Network 数据；`network.devtools` 端口只接受当前扩展的精确 DevTools page sender；direct runtime 入口在进入 bridge 前要求 sender tab 或显式整数 `tabId`，拒绝 sender/tab 不一致、无 tab 隐式 fallback 和其他扩展 host 的同路径 DevTools page，保留当前扩展 DevTools page 显式 `tabId` 兼容。
- `src/shared/models/toolRegistry.ts` 和 `src/background/backgroundToolRuntime.ts` 注册并分发 `imagefree_generate_image`，缺少运行时 hook 时返回明确不可用错误。
- `public/manifest.json`、`vite.config.ts` 和构建合约测试恢复 DevTools 页面入口，并把悬浮助手 iframe 使用的 `index.html` 纳入 `web_accessible_resources`；高风险 browser-control/full-access 工具仍按现有开关和授权边界控制。

## 当前验证状态

| 命令 | 状态 | 备注 |
|---|---|---|
| `npx vitest run tests/unit/background/index.test.ts tests/unit/content/index.test.ts --testNamePattern "tab scoped\|floating\|页面\|活动标签页\|current\|侧边栏\|悬浮\|快捷键\|右键菜单"` | 通过 | Phase 4 side panel/content wiring focused，2 files / 16 tests |
| `npx vitest run tests/unit/background/index.test.ts tests/unit/background/agentToolsMessageHandler.test.ts --testNamePattern "agentTools\|AgentTools\|MCP"` | 通过 | Phase 4 AgentTools/MCP focused，2 files / 6 tests |
| `npx vitest run tests/unit/background/networkDevtoolsBridge.test.ts tests/unit/background/extensionBuildContract.test.ts` | 通过 | Phase 4 DevTools Network 兼容和构建合约，2 files / 10 tests |
| `npx vitest run tests/unit/background/index.test.ts --testNamePattern "networkContext\|DevTools Network\|AgentTools\|chat.send\|流式\|tab"` | 通过 | Phase 4 background entry / Network 授权边界回归，1 file / 26 tests |
| `npx vitest run tests/unit/background/index.test.ts --testNamePattern "显式 tabId\|DevTools 页面 sender\|extension page"` | 通过 | Final review-fix direct/chat explicit tabId 和 extension host 边界，1 file / 7 tests |
| `npx vitest run tests/unit/side-panel/App.test.tsx --testNamePattern "聊天请求携带当前选中标签页 ID"` | 通过 | Final review-fix side-panel selected tabId chat wiring，1 file / 2 tests |
| `npx vitest run tests/unit/background/networkDevtoolsBridge.test.ts tests/unit/background/index.test.ts --testNamePattern "networkContext\|DevTools Network\|AgentTools\|chat.send\|流式\|tab\|显式 tabId\|extension page\|快捷键\|其他扩展 host"` | 通过 | Final review-fix Network 授权、快捷键 fallback、DevTools sender trust 边界，2 files / 41 tests |
| `npx vitest run tests/unit/background/networkDevtoolsBridge.test.ts tests/unit/background/index.test.ts` | 通过 | DevTools bridge 与 background entry 集成回归，2 files / 58 tests |
| `npx vitest run tests/unit/background/backgroundToolRuntime.test.ts --testNamePattern "Imagefree\|imagefree"` | 通过 | Phase 4 Imagefree runtime focused，1 file / 2 tests |
| `npx vitest run tests/unit/background/backgroundToolRuntime.test.ts tests/unit/background/browserControlMessageHandler.test.ts tests/unit/background/manifestBrowserControl.test.ts` | 通过 | Phase 4 工具暴露和授权边界，3 files / 110 tests |
| `npx vitest run tests/unit/side-panel/App.test.tsx --testNamePattern "悬浮\|floating"` | 通过 | Checkpoint 7 React side-panel floating open/close focused，1 file / 3 tests |
| `npx vitest run tests/unit/background/agentToolsMessageHandler.test.ts --testNamePattern "远程\|非法\|scheme\|baseUrl\|Grok\|配置 MCP"` | 通过 | Checkpoint 7 Grok Bridge local-only config/API key focused，1 file / 7 tests |
| `npx vitest run tests/unit/content/index.test.ts --testNamePattern "floating\|悬浮\|地址"` | 通过 | Checkpoint 7 content floating iframe URL trust focused，1 file / 3 tests |
| `npx vitest run tests/unit/side-panel/App.test.tsx tests/unit/content/index.test.ts tests/unit/background/agentToolsMessageHandler.test.ts tests/unit/background/index.test.ts` | 通过 | 2026-07-07 review-fix 后 integrated focused，4 files / 231 tests |
| `npx vitest run tests/unit/side-panel/App.test.tsx tests/unit/background/index.test.ts tests/unit/background/networkDevtoolsBridge.test.ts` | 通过 | Final review-fix side-panel/background/network bridge integrated，3 files / 232 tests |
| `npx vitest run tests/unit/background/index.test.ts tests/unit/content/index.test.ts tests/unit/background/agentToolsMessageHandler.test.ts tests/unit/background/networkDevtoolsBridge.test.ts tests/unit/background/mcpMessageHandler.test.ts tests/unit/background/networkToolExecutor.test.ts tests/unit/background/backgroundToolRuntime.test.ts tests/unit/background/extensionBuildContract.test.ts` | 通过 | Phase 4 targeted，8 files / 105 tests |
| `npm run typecheck` | 通过 | 2026-07-07 review-fix 后 fresh run |
| `npm run check` | 通过 | 2026-07-07 final review-fix fresh run；执行 typecheck、build:extension、npm test、test:legacy、check:package；Vitest 83 files / 1062 tests，打包产物生成到 `artifacts\chrome-extension` |
| `npm run test:e2e` | 通过 | 2026-07-07 review-fix 后 fresh run；Vite preview 和真实 Chrome 扩展 smoke，7 tests；仍有既有 Vite chunk/vendor/inlineDynamicImports 警告 |

## 未解决问题

- Phase 0-1 的 `dist/` 构建默认不声明 `debugger` 权限；debugger-backed browser control、`js.*`、`sourcemap.*`、`runtime.*`、`replay.*` 和 `full_access.*` 只导入源码，可能出现在工具偏好设置中，但当前构建不会在运行时暴露为可用能力。
- Moon Tab 新标签页和小游戏已进入 Vite 多入口构建；页面源码仍为 MJS/HTML/CSS，后续如需 TypeScript 化应单独规划。
- Phase 3 的 AI 侧栏 React 源码迁移仍需按独立计划继续推进；旧 AI 侧栏 bundle、assets、DOM patch 和 open-design preview 仍在仓库中作为迁移参考，物理删除等待 Phase 6。
- DevTools Network bridge 当前按 Phase 4 设计保留为脱敏只读兼容层；是否切换到远程 CDP Network recorder 留到后续工具/安全边界阶段评估。
- 高风险 `runtime.*`、`boundary.*`、`replay.*`、`full_access.*` 等工具继续受开关/授权控制，不在普通模式默认暴露。

## 下一阶段入口

Phase 4 工作区提交后，继续推进 Phase 3/Phase 5 的剩余迁移面：AI 侧栏 React 源码迁移、工具与安全边界增强、以及后续 Phase 6 旧 bundle/DOM patch 物理清理。
