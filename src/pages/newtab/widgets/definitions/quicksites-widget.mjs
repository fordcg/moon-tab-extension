export const quicksitesWidgetDefinition = {
  id: "quicksites",
  title: "快捷站点",
  core: false,
  canHide: true,
  defaultVisible: true,
  render: ({ documentRef }) => {
    const section = documentRef.createElement("section");
    section.className = "widget-note widget-note--quicksites widget-quicksites";

    const sticker = documentRef.createElement("img");
    sticker.className = "widget-note__sticker";
    sticker.src = "./assets/widgets/quicksites-sticker.png";
    sticker.alt = "";

    const list = documentRef.createElement("div");
    list.className = "widget-note__list widget-chip-list";

    const quicksites = [
      { label: "GitHub", href: "https://github.com/" },
      { label: "B站", href: "https://www.bilibili.com/" },
      { label: "少数派", href: "https://sspai.com/" },
      { label: "Figma", href: "https://www.figma.com/" },
    ];

    for (const site of quicksites) {
      const link = documentRef.createElement("a");
      link.className = "widget-chip";
      link.href = site.href;
      link.target = "_blank";
      link.rel = "noreferrer";
      link.textContent = site.label;
      list.appendChild(link);
    }

    section.append(sticker, list);
    return section;
  },
};
