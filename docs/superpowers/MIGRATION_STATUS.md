# 远程工程化迁移状态

## 当前阶段

Phase 5：工具与安全边界已完成。工具注册、浏览器控制、Network、MCP、Tavily、Imagefree、工具附件和审计均通过运行态边界、脱敏和兼容层回归验证。

## 持久入口

- 总设计：`docs/superpowers/specs/2026-07-05-full-upstream-engineering-migration-design.md`
- 当前计划：`docs/superpowers/plans/2026-07-07-full-upstream-engineering-migration-phase-5.md`

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
| Phase 4 | `3df5742` | 合并 Phase 4 后台服务逻辑 |
| Phase 5 Task 1 | `34e707e` | 固化工具运行态暴露矩阵 |
| Phase 5 Task 2 | `dd3bf51` | 区分工具偏好和运行态授权 |
| Phase 5 Task 3 | `bf4c305` | 收紧边界确认一次性授权 |
| Phase 5 Task 4 | `2bb6b95` | 加强工具附件脱敏 |
| Phase 5 Task 5 | `41fa877` | 加固 MCP 和外部工具边界 |
| Phase 5 Task 6 | `f0719a0` | 限定 DevTools Network 兼容边界 |
| Phase 5 Final Review Patch | `b209c58` | 封堵 raw generic tool attachment 在 prompt/export/aggregation 前绕过脱敏 |
| Phase 5 Quality Fix | `64f6736` | 收紧混合工具附件脱敏边界 |
| Phase 5 Mixed Summary Fix | `ac11c5a` | 脱敏混合工具附件摘要 |

## 当前工作区 Phase 5 结果

- 工具注册表继续作为内置、浏览器控制、受控增强、完全访问、外部搜索和 MCP 远程工具的单一元数据来源。
- `chat.send`、AgentTools 状态和 DevTools Network 兼容层在发送前按当前 tab、browser-control 连接态、自动化模式和 legacy allow-list 过滤工具。
- `boundary_request_user_choice` 生成的一次性授权绑定目标工具参数、tab 和 origin；请求重放授权发送后立即消费。
- 工具附件聚合、导出和后续追问上下文默认脱敏；完全访问结果用显式字段标记。
- MCP Bearer Token 和 Grok API Key 保持本地存储边界，审计日志写入前脱敏。
- Tavily、Imagefree 和 DevTools legacy Network 工具保留低风险或兼容路径，高风险 debugger-backed 工具不由 DevTools 兼容层静默启用。

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
| `npx vitest run tests/unit/shared/toolRegistry.test.ts tests/unit/background/backgroundToolRuntime.test.ts tests/unit/background/boundaryChoiceToolExecutor.test.ts tests/unit/background/browserControlMessageHandler.test.ts tests/unit/shared/toolArtifacts.test.ts tests/unit/side-panel/browserControlPreferences.test.ts tests/unit/background/agentToolsMessageHandler.test.ts tests/unit/background/index.test.ts tests/unit/background/networkDevtoolsBridge.test.ts` | 通过 | 2026-07-07 Phase 5 focused verification，9 files / 263 tests |
| `npm run typecheck` | 通过 | 2026-07-07 Phase 5 ledger verification；tsc --noEmit |
| `npm run check` | 通过 | 2026-07-07 Phase 5 ledger verification；执行 typecheck、build:extension、npm test、test:legacy、check:package；Vitest 83 files / 1075 tests，package test 1 file / 12 tests；既有 Vite chunk/vendor/inlineDynamicImports 警告 |
| `npm run test:e2e` | 通过 | 2026-07-07 Phase 5 ledger verification；Playwright smoke 7 tests |
| `npx vitest run tests/unit/shared/toolArtifacts.test.ts -t "live collection"` | RED 后通过 | 2026-07-07 Phase 5 final review patch；补丁前失败于 raw generic attachment `redacted: false`，补丁后 1 test passed / 19 skipped |
| `npx vitest run tests/unit/shared/toolArtifacts.test.ts` | 通过 | 2026-07-07 Phase 5 final review patch；1 file / 20 tests |
| `npx vitest run tests/unit/shared/toolArtifacts.test.ts -t "混合工具附件聚合"` | RED 后通过 | 2026-07-07 Phase 5 quality fix；补丁前失败于 mixed aggregate 泄露 Network JSON body `password` / `access_token` / `secret`，补丁后 1 test passed / 20 skipped |
| `npx vitest run tests/unit/shared/toolArtifacts.test.ts` | 通过 | 2026-07-07 Phase 5 quality fix；1 file / 21 tests |
| `npm run typecheck` | 通过 | 2026-07-07 Phase 5 quality fix；tsc --noEmit |
| `npx vitest run tests/unit/shared/toolArtifacts.test.ts -t "混合工具附件聚合"` | RED 后通过 | 2026-07-07 Phase 5 mixed summary fix；补丁前失败于 mixed aggregate summary 泄露 raw Network summary `query-secret` / `mixed-token`，补丁后 1 test passed / 20 skipped |
| `npx vitest run tests/unit/shared/toolArtifacts.test.ts` | 通过 | 2026-07-07 Phase 5 mixed summary fix；1 file / 21 tests |
| `npm run typecheck` | 通过 | 2026-07-07 Phase 5 mixed summary fix；tsc --noEmit |
| `npx vitest run tests/unit/shared/toolArtifacts.test.ts -t "JSON 形态"` | RED 后通过 | 2026-07-07 Phase 5 generic JSON redaction fix；补丁前失败于 raw generic JSON summary 泄露 `xai-secret`，补丁后 1 test passed / 21 skipped |
| `npx vitest run tests/unit/side-panel/messageListAttachments.test.tsx -t "JSON 形态"` | RED 后通过 | 2026-07-07 Phase 5 generic display redaction fix；补丁前失败于 raw generic display attachment `redacted: false`，补丁后 2 tests passed / 9 skipped |
| `npx vitest run tests/unit/shared/toolArtifacts.test.ts` | 通过 | 2026-07-07 Phase 5 generic JSON redaction fix；1 file / 22 tests |
| `npx vitest run tests/unit/side-panel/messageListAttachments.test.tsx` | 通过 | 2026-07-07 Phase 5 generic display redaction fix；1 file / 11 tests |
| `npm run typecheck` | 通过 | 2026-07-07 Phase 5 generic redaction fix；tsc --noEmit |

## 未解决问题

- Phase 0-1 的 `dist/` 构建默认不声明 `debugger` 权限；debugger-backed browser control、`js.*`、`sourcemap.*`、`runtime.*`、`replay.*` 和 `full_access.*` 只导入源码，可能出现在工具偏好设置中，但当前构建不会在运行时暴露为可用能力。
- Moon Tab 新标签页和小游戏已进入 Vite 多入口构建；页面源码仍为 MJS/HTML/CSS，后续如需 TypeScript 化应单独规划。
- Phase 3 的 AI 侧栏 React 源码迁移仍需按独立计划继续推进；旧 AI 侧栏 bundle、assets、DOM patch 和 open-design preview 仍在仓库中作为迁移参考，物理删除等待 Phase 6。
- DevTools Network bridge 当前按 Phase 5 设计保留为脱敏只读兼容层；是否切换到远程 CDP Network recorder 留到后续阶段评估。
- 高风险 `runtime.*`、`boundary.*`、`replay.*`、`full_access.*` 等工具继续受开关/授权控制，不在普通模式默认暴露。

## 下一阶段入口

Phase 5 提交后，继续推进 Phase 3/Phase 6 的剩余迁移面：AI 侧栏 React 源码迁移、旧 bundle/DOM patch 物理清理和后续发布前收敛验证。
