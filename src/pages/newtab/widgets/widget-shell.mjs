export const createWidgetShell = ({ documentRef, widget, canHide }) => {
  const article = documentRef.createElement("article");
  article.className = "ui-note-card homepage-widget-card";
  article.dataset.widgetId = widget.id;

  const header = documentRef.createElement("div");
  header.className = "homepage-widget-card-header";

  const title = documentRef.createElement("h2");
  title.className = "homepage-widget-card-title";
  title.textContent = widget.title;

  const actions = documentRef.createElement("div");
  actions.className = "homepage-widget-card-actions";

  if (canHide) {
    const hideButton = documentRef.createElement("button");
    hideButton.type = "button";
    hideButton.className = "ui-btn-icon homepage-widget-action";
    hideButton.dataset.widgetAction = "hide";
    hideButton.setAttribute("aria-label", `隐藏${widget.title}`);
    hideButton.textContent = "×";
    actions.appendChild(hideButton);
  }

  header.append(title, actions);

  const body = documentRef.createElement("div");
  body.className = "homepage-widget-card-body";
  article.append(header, body);

  return { article, body };
};
