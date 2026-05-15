export const calendarWidgetDefinition = {
  id: "calendar",
  title: "日历",
  core: false,
  canHide: true,
  defaultVisible: true,
  render: ({ documentRef }) => {
    const section = documentRef.createElement("section");
    section.className = "widget-note widget-note--calendar";

    const sticker = documentRef.createElement("img");
    sticker.className = "widget-note__sticker";
    sticker.src = "./assets/widgets/calendar-sticker.png";
    sticker.alt = "";

    const list = documentRef.createElement("div");
    list.className = "widget-note__list widget-note-list";

    const entries = [
      { label: "今天", value: "15:30 设计评审" },
      { label: "明天", value: "整理侧栏文案" },
      { label: "周末", value: "把灵感站点收进收藏夹" },
    ];

    for (const entry of entries) {
      const item = documentRef.createElement("div");
      item.className = "widget-note-item";

      const label = documentRef.createElement("p");
      label.className = "widget-note-label";
      label.textContent = entry.label;

      const value = documentRef.createElement("p");
      value.className = "widget-note-value";
      value.textContent = entry.value;

      item.append(label, value);
      list.appendChild(item);
    }

    section.append(sticker, list);
    return section;
  },
};
