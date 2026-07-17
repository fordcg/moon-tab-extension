# 荒原势力扩展

该目录是 Moon Tab 在 A Dark Room 上增加的独立内容层，不修改原作地图、事件与存档版本号。

- `wasteland-core.js`：无 DOM 依赖的状态归一化、声望、路线、任务、结局与周目结算规则。
- `wasteland-data.js`：中文内容、资源成本、三个势力与三个区域首领的数据。
- `wasteland-factions.js`：连接 StateManager、Events、World、Outside 与 Prestige 的薄运行时。
- `wasteland.css`：沿用原作黑白文字界面的少量样式。

当前周目状态保存在 `game.wasteland`，跨周目遗产保存在 `previous.wasteland`。扩展 schema 当前为 v2：旧存档已有路线时自动迁移为一阶路线，击败对应首领且真实声望达到 55 后可以扩建二阶设施。

每个势力每周目允许一次高成本“灰旗和解”。它只解除任务和一阶路线的声望阻挡，不增加真实声望，因此不会降低结局和二阶设施的门槛。三名首领分别具有半血蓄势、周期夺粮和吸能护罩机制。

所有一次性选择均带命令回执；首领胜利只写入远征中的 `World.state`，安全返村后才提交，死亡会随远征状态一起回滚。
