# 远程工程化迁移状态

## 当前阶段

Phase 3：恢复 AI 侧栏 React 源码维护方式，把 `sidePanel-layout.js` 的 DOM patch 行为迁入 React 组件和 store。

## 持久入口

- 总设计：`docs/superpowers/specs/2026-07-05-full-upstream-engineering-migration-design.md`
- 当前计划：`docs/superpowers/plans/2026-07-06-full-upstream-engineering-migration-phase-3.md`

## 已完成提交

| Phase | Commit | 内容 |
|---|---|---|
| Design | `1ba71bd` | 设计全面迁移远程工程化结构 |
| Plan 0-1 | `5ed6ab0` | 制定远程工程化迁移基础计划 |
| Phase 0-1 | `e9f25aa` | 删除 PocketAide 并建立远程工程化迁移基础 |
| Phase 0-1 Review Fix | `29934bb` | 降权构建 manifest 并补齐 Vitest 发现规则回归测试 |
| Phase 0-1 Verification Stabilization | `470476e` | 稳定全量 Vitest 验证和迁移边界文档 |
| Phase 2 | `d7bfdd5` | 迁移 Moon Tab 新标签页和小游戏到 Vite 多入口构建 |

## 当前验证状态

| 命令 | 状态 | 备注 |
|---|---|---|
| `npm run typecheck` | 通过 | Phase 2 多入口构建迁移后执行 |
| `npm run build:extension` | 通过 | 生成侧栏、新标签页、游戏页、background 和 content script |
| `npm test` | 通过 | Vitest 构建合约、打包脚本和现有单元测试，999 tests |
| `npm run test:legacy` | 通过 | 保留小游戏 worker/sprite 的 Node 测试 |
| `npm run check:package` | 通过 | 校验并复制 Phase 2 打包产物 |
| `npm run test:e2e` | 通过 | Vite preview 和真实 Chrome 扩展 smoke，7 tests |
| `npm run check` | 通过 | Phase 2 全量聚合验证 |

## 未解决问题

- Phase 0-1 的 `dist/` 构建默认不声明 `debugger` 权限；debugger-backed browser control、`js.*`、`sourcemap.*`、`runtime.*`、`replay.*` 和 `full_access.*` 只导入源码，可能出现在工具偏好设置中，但当前构建不会在运行时暴露为可用能力。
- Moon Tab 新标签页和小游戏已进入 Vite 多入口构建；页面源码仍为 MJS/HTML/CSS，后续如需 TypeScript 化应单独规划。
- Phase 3 已完成计划编写，尚未执行：需要把 `sidePanel-layout.js` 的必要行为迁入 React 组件、Zustand store 和 typed runtime message。
- 尚未合并 tab scoped side panel、悬浮助手、Imagefree、Grok/MCP 和 DevTools Network bridge 到 TypeScript background。
- 旧 AI 侧栏 bundle、assets、DOM patch 和 open-design preview 仍在仓库中作为迁移参考；Phase 3 不应再把它们作为长期源码，物理删除等待 Phase 6。

## 下一阶段入口

执行 Phase 3 计划：恢复/迁入 AI 侧栏 React 源码维护方式，把当前 `sidePanel-layout.js` 的 DOM patch 行为迁到 React 组件和 store 逻辑里。重点包括 tab 级会话连续性、悬浮窗入口、历史抽屉和设置入口、工具/MCP/Grok 预设与审计展示、输入区/长消息/空状态/通知等 UI 增强。
