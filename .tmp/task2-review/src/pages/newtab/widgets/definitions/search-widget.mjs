export const searchWidgetDefinition = {
  id: "search",
  title: "搜索",
  core: true,
  canHide: false,
  defaultVisible: true,
  render: ({ documentRef }) => documentRef.getElementById("widget-search-template"),
};
