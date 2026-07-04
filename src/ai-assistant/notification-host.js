const HOST_CLASS = "sidepanel-notification-host";
const DEFAULT_DURATION_MS = 5000;

function ensureNotificationHost() {
  let host = document.querySelector(`.${HOST_CLASS}`);
  if (!host) {
    host = document.createElement("div");
    host.className = HOST_CLASS;
    host.setAttribute("aria-live", "polite");
    document.body.append(host);
  }
  return host;
}

export function showAiSidebarNotification({
  type = "info",
  title = "",
  message = "",
  durationMs = DEFAULT_DURATION_MS,
} = {}) {
  const host = ensureNotificationHost();
  const item = document.createElement("section");
  item.className = `sidepanel-notification is-${type}`;
  item.setAttribute("role", type === "error" ? "alert" : "status");

  const content = document.createElement("div");
  content.className = "sidepanel-notification-content";
  const titleNode = document.createElement("strong");
  titleNode.textContent = title || resolveDefaultTitle(type);
  const messageNode = document.createElement("p");
  messageNode.textContent = message;
  content.append(titleNode, messageNode);

  const close = document.createElement("button");
  close.type = "button";
  close.className = "sidepanel-notification-close";
  close.setAttribute("aria-label", `关闭通知：${titleNode.textContent}`);
  close.textContent = "×";
  close.addEventListener("click", () => item.remove());

  item.append(content, close);
  host.append(item);

  if (durationMs > 0) {
    setTimeout(() => item.remove(), durationMs);
  }
  return item;
}

function resolveDefaultTitle(type) {
  return type === "success"
    ? "操作成功"
    : type === "warning"
      ? "需要注意"
      : type === "error"
        ? "操作失败"
        : "提示";
}

globalThis.showAiSidebarNotification = showAiSidebarNotification;
