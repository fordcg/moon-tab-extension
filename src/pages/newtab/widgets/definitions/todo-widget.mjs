export const todoWidgetDefinition = {
  id: "todo",
  title: "待办",
  core: false,
  canHide: true,
  defaultVisible: true,
  render: ({ documentRef }) => {
    const section = documentRef.createElement("section");
    section.className = "widget-note-block";

    const list = documentRef.createElement("div");
    list.className = "widget-note-list";

    const entries = [
      "确认今天要搜索的主题",
      "补齐一个 AI 搜索提示词模板",
      "把常用站点再精简到 4 个以内",
    ];

    for (const text of entries) {
      const item = documentRef.createElement("div");
      item.className = "widget-note-item";

      const bullet = documentRef.createElement("span");
      bullet.className = "widget-note-bullet";
      bullet.setAttribute("aria-hidden", "true");
      bullet.textContent = "•";

      const value = documentRef.createElement("p");
      value.className = "widget-note-value";
      value.textContent = text;

      item.append(bullet, value);
      list.appendChild(item);
    }

    section.appendChild(list);
    return section;
  },
};
