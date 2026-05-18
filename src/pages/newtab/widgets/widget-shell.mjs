export const createWidgetShell = ({ documentRef, widget, canHide }) => {
  const article = documentRef.createElement("article");
  article.className = "ui-note-card homepage-widget-card";
  article.dataset.widgetId = widget.id;
  article.dataset.widgetSlot = "stack";
  if (canHide) {
    article.dataset.widgetTransformable = "true";
  }

  const header = documentRef.createElement("div");
  header.className = "homepage-widget-card-header";

  const title = documentRef.createElement("h2");
  title.className = "homepage-widget-card-title";
  title.textContent = widget.title;

  const ornament = documentRef.createElement("div");
  ornament.className = "homepage-widget-card-ornament";
  ornament.setAttribute("aria-hidden", "true");

  const actions = documentRef.createElement("div");
  actions.className = "homepage-widget-card-actions";

  if (canHide) {
    const hideButton = documentRef.createElement("button");
    hideButton.type = "button";
    hideButton.className = "ui-btn-icon homepage-widget-action";
    hideButton.dataset.widgetAction = "hide";
    hideButton.setAttribute("aria-label", `隐藏${widget.title}`);
    hideButton.textContent = "×";
    actions.append(hideButton);
  }

  header.append(title, ornament, actions);

  const body = documentRef.createElement("div");
  body.className = "homepage-widget-card-body";
  article.append(header, body);

  if (canHide) {
    const rotateHandle = documentRef.createElement("button");
    rotateHandle.type = "button";
    rotateHandle.className = "widget-transform-control widget-transform-control--rotate";
    rotateHandle.dataset.widgetTransformControl = "rotate";
    rotateHandle.setAttribute("aria-label", `旋转${widget.title}`);
    rotateHandle.title = "旋转";
    rotateHandle.textContent = "↻";

    const resizeHandle = documentRef.createElement("button");
    resizeHandle.type = "button";
    resizeHandle.className = "widget-transform-control widget-transform-control--resize";
    resizeHandle.dataset.widgetTransformControl = "resize";
    resizeHandle.setAttribute("aria-label", `调整${widget.title}大小`);
    resizeHandle.title = "调整大小";
    resizeHandle.textContent = "◢";

    article.append(rotateHandle, resizeHandle);
  }

  return { article, body, ornament };
};
