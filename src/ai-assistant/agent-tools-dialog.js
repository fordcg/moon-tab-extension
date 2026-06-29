async function sendAgentToolsMessage(payload) {
  const runtime = globalThis.chrome?.runtime;
  if (!runtime?.sendMessage) {
    return { ok: false, message: "当前环境不支持扩展后台通信。" };
  }
  try {
    return await runtime.sendMessage(payload);
  } catch (error) {
    return {
      ok: false,
      message:
        error instanceof Error && error.message
          ? error.message
          : "工具管理请求失败。",
    };
  }
}

export function openAgentToolsDialog() {
  document.querySelector(".sidepanel-agent-tools-overlay")?.remove();
  document.querySelector(".sidepanel-agent-tools-dialog")?.remove();

  const overlay = document.createElement("div");
  overlay.className = "sidepanel-agent-tools-overlay";
  overlay.setAttribute("aria-hidden", "true");

  const dialog = document.createElement("section");
  dialog.className = "sidepanel-agent-tools-dialog";
  dialog.setAttribute("role", "dialog");
  dialog.setAttribute("aria-modal", "true");
  dialog.setAttribute("aria-labelledby", "sidepanel-agent-tools-title");

  const close = () => {
    overlay.remove();
    dialog.remove();
    document.removeEventListener("keydown", onKeydown);
  };
  const onKeydown = (event) => {
    if (event.key === "Escape") {
      close();
    }
  };

  overlay.addEventListener("click", close);
  document.addEventListener("keydown", onKeydown);
  document.body.append(overlay, dialog);

  renderAgentToolsDialog(dialog, { loading: true }, close);
  sendAgentToolsMessage({ type: "agentTools.getStatus" }).then((status) => {
    if (document.body.contains(dialog)) {
      renderAgentToolsDialog(dialog, status, close);
    }
  });
}

function renderAgentToolsDialog(dialog, status, close) {
  dialog.replaceChildren();

  const header = document.createElement("header");
  header.className = "sidepanel-agent-tools-header";

  const titleWrap = document.createElement("div");
  titleWrap.className = "sidepanel-agent-tools-title-wrap";

  const title = document.createElement("h2");
  title.id = "sidepanel-agent-tools-title";
  title.textContent = "工具和 MCP";

  const subtitle = document.createElement("p");
  subtitle.textContent = "强能力按需启用；失败只降级工具，不影响主聊天。";

  titleWrap.append(title, subtitle);

  const closeButton = document.createElement("button");
  closeButton.type = "button";
  closeButton.className = "sidepanel-agent-tools-close";
  closeButton.setAttribute("aria-label", "关闭工具和 MCP");
  closeButton.textContent = "关闭";
  closeButton.addEventListener("click", close);

  header.append(titleWrap, closeButton);

  const body = document.createElement("div");
  body.className = "sidepanel-agent-tools-body";

  if (status?.loading) {
    const loading = document.createElement("p");
    loading.className = "sidepanel-agent-tools-muted";
    loading.textContent = "正在读取工具状态…";
    body.append(loading);
    dialog.append(header, body);
    return;
  }

  const settings = status?.settings?.mcp || {};
  const mcp = status?.mcp || {};
  const enabled = settings.enabled === true;
  const exposeToChat = settings.exposeToChat === true;

  const statusRow = document.createElement("div");
  statusRow.className = "sidepanel-agent-tools-status-row";

  const statusPill = document.createElement("span");
  statusPill.className = [
    "sidepanel-agent-tools-status",
    mcp.state === "connected" ? "is-connected" : "",
    mcp.state === "error" ? "is-error" : "",
  ]
    .filter(Boolean)
    .join(" ");
  statusPill.textContent =
    mcp.state === "connected"
      ? "已连接"
      : mcp.state === "error"
        ? "连接失败"
        : "未开启";

  const statusText = document.createElement("p");
  statusText.textContent = status?.ok === false ? status.message : mcp.message || "MCP Bridge 未开启。";
  statusRow.append(statusPill, statusText);

  const urlLabel = document.createElement("label");
  urlLabel.className = "sidepanel-agent-tools-field";
  const urlText = document.createElement("span");
  urlText.textContent = "本地 MCP Bridge 地址";
  const urlInput = document.createElement("input");
  urlInput.type = "url";
  urlInput.value = settings.baseUrl || "http://127.0.0.1:17333/";
  urlInput.placeholder = "http://127.0.0.1:17333/";
  urlInput.spellcheck = false;
  urlLabel.append(urlText, urlInput);

  const enabledSwitch = makeAgentToolsSwitch("启用 MCP Bridge", enabled);
  const exposeSwitch = makeAgentToolsSwitch(
    "工具调用开启时暴露 MCP 工具给模型",
    exposeToChat,
  );

  const hint = document.createElement("p");
  hint.className = "sidepanel-agent-tools-muted";
  hint.textContent =
    "当前仅允许 localhost / 127.0.0.1。Bridge 需提供 GET /tools/list 和 POST /tools/call。";

  const actions = document.createElement("div");
  actions.className = "sidepanel-agent-tools-actions";

  const save = document.createElement("button");
  save.type = "button";
  save.className = "ui-button-primary";
  save.textContent = "保存并刷新";

  const refresh = document.createElement("button");
  refresh.type = "button";
  refresh.className = "ui-button-secondary";
  refresh.textContent = "刷新工具";

  const setBusy = (busy) => {
    save.disabled = busy;
    refresh.disabled = busy;
  };

  save.addEventListener("click", async () => {
    setBusy(true);
    const next = await sendAgentToolsMessage({
      type: "agentTools.configureMcp",
      mcp: {
        enabled: enabledSwitch.input.checked,
        exposeToChat: exposeSwitch.input.checked,
        baseUrl: urlInput.value.trim(),
      },
    });
    setBusy(false);
    renderAgentToolsDialog(dialog, next, close);
  });

  refresh.addEventListener("click", async () => {
    setBusy(true);
    const next = await sendAgentToolsMessage({ type: "agentTools.refreshMcp" });
    setBusy(false);
    renderAgentToolsDialog(dialog, next, close);
  });

  actions.append(save, refresh);

  const toolsTitle = document.createElement("h3");
  toolsTitle.className = "sidepanel-agent-tools-section-title";
  toolsTitle.textContent = `MCP 工具${mcp.tools?.length ? `（${mcp.tools.length}）` : ""}`;

  const list = document.createElement("div");
  list.className = "sidepanel-agent-tools-list";
  const tools = Array.isArray(mcp.tools) ? mcp.tools : [];
  if (tools.length === 0) {
    const empty = document.createElement("p");
    empty.className = "sidepanel-agent-tools-empty";
    empty.textContent = enabled
      ? "暂未发现 MCP 工具。请确认本地 Bridge 已启动后刷新。"
      : "启用 MCP Bridge 后，这里会显示可被模型调用的工具。";
    list.append(empty);
  } else {
    for (const tool of tools) {
      const item = document.createElement("article");
      item.className = "sidepanel-agent-tool-item";
      const name = document.createElement("strong");
      name.textContent = tool.displayName || tool.name || tool.id;
      const meta = document.createElement("code");
      meta.textContent = [
        tool.name || tool.id,
        tool.risk && tool.risk !== "low" ? `风险：${formatAgentToolsRisk(tool.risk)}` : "",
        tool.requiresConfirmation ? "需确认" : "",
      ]
        .filter(Boolean)
        .join(" · ");
      const desc = document.createElement("p");
      desc.textContent = tool.description || "无描述";
      item.append(name, meta, desc);
      list.append(item);
    }
  }

  const auditHeader = document.createElement("div");
  auditHeader.className = "sidepanel-agent-tools-audit-header";

  const auditTitle = document.createElement("h3");
  auditTitle.className = "sidepanel-agent-tools-section-title";
  const auditLog = Array.isArray(status?.auditLog) ? status.auditLog : [];
  auditTitle.textContent = `最近工具调用${auditLog.length ? `（${auditLog.length}）` : ""}`;

  const clearAudit = document.createElement("button");
  clearAudit.type = "button";
  clearAudit.className = "sidepanel-agent-tools-link-button";
  clearAudit.textContent = "清空";
  clearAudit.disabled = auditLog.length === 0;
  clearAudit.addEventListener("click", async () => {
    clearAudit.disabled = true;
    await sendAgentToolsMessage({ type: "agentTools.clearAuditLog" });
    const next = await sendAgentToolsMessage({ type: "agentTools.getStatus" });
    renderAgentToolsDialog(dialog, next, close);
  });

  auditHeader.append(auditTitle, clearAudit);

  const auditList = document.createElement("div");
  auditList.className = "sidepanel-agent-tools-audit-list";
  if (auditLog.length === 0) {
    const empty = document.createElement("p");
    empty.className = "sidepanel-agent-tools-empty";
    empty.textContent = "暂无工具调用记录。后续 MCP、浏览器控制、搜索等工具调用会在这里显示。";
    auditList.append(empty);
  } else {
    for (const entry of auditLog.slice(0, 20)) {
      auditList.append(makeAgentToolsAuditItem(entry));
    }
  }

  body.append(
    statusRow,
    urlLabel,
    enabledSwitch.label,
    exposeSwitch.label,
    hint,
    actions,
    toolsTitle,
    list,
    auditHeader,
    auditList,
  );
  dialog.append(header, body);
  urlInput.focus({ preventScroll: true });
}

function makeAgentToolsAuditItem(entry) {
  const item = document.createElement("article");
  item.className = [
    "sidepanel-agent-tools-audit-item",
    entry?.status === "error" ? "is-error" : "",
  ]
    .filter(Boolean)
    .join(" ");

  const head = document.createElement("div");
  head.className = "sidepanel-agent-tools-audit-item-head";

  const name = document.createElement("strong");
  name.textContent = entry?.displayName || entry?.name || entry?.toolId || "未知工具";

  const status = document.createElement("span");
  status.textContent = entry?.status === "error" ? "失败" : "成功";

  head.append(name, status);

  const meta = document.createElement("p");
  meta.className = "sidepanel-agent-tools-audit-meta";
  meta.textContent = [
    formatAgentToolsTime(entry?.completedAt || entry?.startedAt),
    entry?.durationMs !== undefined ? `${entry.durationMs}ms` : "",
    entry?.risk && entry.risk !== "low" ? `风险：${formatAgentToolsRisk(entry.risk)}` : "",
    entry?.toolId || "",
  ]
    .filter(Boolean)
    .join(" · ");

  const args = document.createElement("pre");
  args.textContent = `参数 ${formatAgentToolsJson(entry?.arguments ?? {})}`;

  const result = document.createElement("p");
  result.className = "sidepanel-agent-tools-audit-result";
  result.textContent =
    entry?.errorMessage ||
    entry?.resultSummary ||
    (entry?.status === "error" ? "工具调用失败。" : "工具调用完成。");

  item.append(head, meta, args, result);
  return item;
}

function formatAgentToolsTime(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "";
  }
  try {
    return new Date(value).toLocaleTimeString("zh-CN", {
      hour12: false,
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return "";
  }
}

function formatAgentToolsJson(value) {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function formatAgentToolsRisk(value) {
  return (
    {
      low: "低",
      medium: "中",
      high: "高",
      external: "外部",
    }[value] || String(value || "")
  );
}

function makeAgentToolsSwitch(text, checked) {
  const label = document.createElement("label");
  label.className = "sidepanel-agent-tools-switch";

  const input = document.createElement("input");
  input.type = "checkbox";
  input.checked = checked;

  const control = document.createElement("span");
  control.className = "sidepanel-agent-tools-switch-control";
  control.setAttribute("aria-hidden", "true");

  const copy = document.createElement("span");
  copy.textContent = text;

  label.append(input, control, copy);
  return { label, input };
}
