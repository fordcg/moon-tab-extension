# 上游来源

本目录的游戏核心移植自 [A Dark Room](https://github.com/doublespeakgames/adarkroom)，
上游版本为提交 `1fada4620b6c66bd07bf15a3f1eb8223df8bc1d7`。

原作由 Michael Townsend 与 A Dark Room 贡献者开发，依照 Mozilla Public
License 2.0 发布。许可证全文保存在同目录的 `LICENSE.md`。本项目为适配浏览器扩展，
移除了远程统计、交叉推广与 Dropbox 集成，并对本地存档隔离、内容安全策略和无障碍语义
进行了修改。

`expansion/` 下的“荒原势力”是 Moon Tab 新增的独立内容层，不属于上述上游提交。
它通过公开的游戏状态、事件、地图和周目接口接入，使用独立 schema 版本与一次性命令回执，
以便后续更新上游核心时可以单独审查或移除。
