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
