async function sendAgentToolsMessage(payload) {
  const runtime = globalThis.chrome?.runtime;
  if (!runtime?.sendMessage) {
    return { ok: false, message: "当前环境不支持扩展后台通信。" };
  }
  try {
    return await runtime.sendMessage(payload);
  } catch (error) {
    const message =
      error instanceof Error && error.message
        ? error.message
        : "工具管理请求失败。";
    globalThis.showAiSidebarNotification?.({
      type: "error",
      title: "工具管理请求失败",
      message,
    });
    return {
      ok: false,
      message,
    };
  }
}

const GROK_PRESET_SERVER_ID = "grok-search-127-0-0-1-17333";
const GROK_PRESET_ENDPOINT_URL = "http://127.0.0.1:17333/";
const DEFAULT_GROK_API_BASE_URL = "https://api.x.ai/v1";
const DEFAULT_GROK_MODEL = "grok-4.20-multi-agent-xhigh";

const createText = (tagName, className, text) => {
  const node = document.createElement(tagName);
  if (className) node.className = className;
  node.textContent = text;
  return node;
};

const normalizeDialogServers = (status) =>
  Array.isArray(status?.settings?.mcp?.servers) ? status.settings.mcp.servers : [];

const normalizeDialogAuditLog = (status) => (Array.isArray(status?.auditLog) ? status.auditLog : []);

const normalizeDialogTools = (status) => (Array.isArray(status?.tools) ? status.tools : []);

const isGrokPresetServer = (server) =>
  server?.id === GROK_PRESET_SERVER_ID || server?.endpointUrl === GROK_PRESET_ENDPOINT_URL;

const createGrokPresetServer = (source = {}) => ({
  id: source.id || GROK_PRESET_SERVER_ID,
  name: source.name || "Grok 搜索",
  endpointUrl: source.endpointUrl || GROK_PRESET_ENDPOINT_URL,
  enabled: source.enabled !== false,
  tools: Array.isArray(source.tools) ? source.tools : [],
});

const findGrokPresetServer = (servers) => servers.find(isGrokPresetServer);

const upsertGrokPresetServer = (servers, overrides = {}) => {
  let found = false;
  const nextServers = servers.map((server) => {
    if (!isGrokPresetServer(server)) return server;
    found = true;
    return createGrokPresetServer({ ...server, ...overrides, tools: server.tools });
  });
  if (!found) nextServers.push(createGrokPresetServer(overrides));
  return nextServers;
};

const notifyAgentToolsResult = (
  next,
  successTitle = "工具设置已更新",
  successMessage = "工具和 MCP 状态已刷新",
) => {
  globalThis.showAiSidebarNotification?.({
    type: next?.ok === false ? "error" : "success",
    title: next?.ok === false ? "操作失败" : successTitle,
    message: next?.ok === false ? next.message || "工具管理请求失败" : successMessage,
  });
};

const formatAuditArguments = (value) => {
  if (value === undefined) return "";
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
};

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
  subtitle.textContent = "管理内置工具、HTTP MCP Server、Grok 搜索预设和最近工具调用。";

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

  const statusRow = createAgentToolsStatusRow(status);
  const serversSection = createAgentToolsServersSection(dialog, status, close);
  const toolsSection = createAgentToolsToolsSection(status);
  const auditSection = createAgentToolsAuditSection(dialog, status, close);
  const grokConfigSection = createGrokPresetConfigSection(dialog, status, close);

  body.append(statusRow, serversSection, toolsSection, auditSection, grokConfigSection);
  dialog.append(header, body);
  if (!dialog.dataset.agentToolsFocused) {
    dialog.dataset.agentToolsFocused = "true";
    dialog.querySelector(".sidepanel-agent-tools-close")?.focus({ preventScroll: true });
  }
}

function createAgentToolsStatusRow(status) {
  const mcp = status?.mcp || {};
  const servers = normalizeDialogServers(status);
  const tools = normalizeDialogTools(status);
  const hasServerError = servers.some((server) => server.lastRefreshError);
  const hasEnabledServer = servers.some((server) => server.enabled !== false);

  const statusRow = document.createElement("div");
  statusRow.className = "sidepanel-agent-tools-status-row";

  const statusPill = document.createElement("span");
  statusPill.className = [
    "sidepanel-agent-tools-status",
    status?.ok === false || mcp.state === "error" || hasServerError ? "is-error" : "",
    status?.ok !== false && (mcp.state === "connected" || hasEnabledServer) ? "is-connected" : "",
  ]
    .filter(Boolean)
    .join(" ");
  statusPill.textContent =
    status?.ok === false || mcp.state === "error" || hasServerError
      ? "需处理"
      : mcp.state === "connected" || hasEnabledServer
        ? "已启用"
        : "未配置";

  const statusText = document.createElement("p");
  statusText.textContent =
    status?.ok === false
      ? status.message
      : mcp.message || `已配置 ${servers.length} 个 MCP Server，已发现 ${tools.length} 个工具。`;
  statusRow.append(statusPill, statusText);
  return statusRow;
}

function createAgentToolsServersSection(dialog, status, close) {
  const serversSection = document.createElement("section");
  serversSection.className = "sidepanel-agent-tools-section";
  serversSection.append(createText("h3", "sidepanel-agent-tools-section-title", "MCP Server"));

  const serverList = document.createElement("div");
  serverList.className = "sidepanel-agent-tools-server-list";
  const servers = normalizeDialogServers(status);
  if (servers.length === 0) {
    serverList.append(createText("p", "sidepanel-agent-tools-muted", "暂无 MCP Server"));
  }
  for (const server of servers) {
    const item = document.createElement("article");
    item.className = "sidepanel-agent-tools-server";
    item.append(createText("strong", "", server.name || server.id));
    item.append(createText("p", "sidepanel-agent-tools-muted", server.endpointUrl || ""));
    item.append(
      createText(
        "p",
        "sidepanel-agent-tools-muted",
        `状态：${server.enabled ? "已启用" : "已禁用"} · 已发现工具：${Array.isArray(server.tools) ? server.tools.length : 0}`,
      ),
    );
    if (server.lastRefreshError) {
      item.append(createText("p", "sidepanel-agent-tools-muted", `刷新失败：${server.lastRefreshError}`));
    }
    serverList.append(item);
  }
  serversSection.append(serverList);

  const grokPreset = document.createElement("button");
  grokPreset.type = "button";
  grokPreset.className = "ui-button-secondary";
  grokPreset.textContent = "添加 Grok 搜索预设";
  grokPreset.addEventListener("click", async () => {
    grokPreset.disabled = true;
    const next = await sendAgentToolsMessage({
      type: "agentTools.configureMcp",
      mcp: {
        servers: upsertGrokPresetServer(servers, {
          id: GROK_PRESET_SERVER_ID,
          name: "Grok 搜索",
          endpointUrl: GROK_PRESET_ENDPOINT_URL,
          enabled: true,
          tools: [],
        }),
        baseUrl: GROK_PRESET_ENDPOINT_URL,
      },
    });
    notifyAgentToolsResult(next, "工具设置已更新", "已添加 Grok 搜索预设。");
    renderAgentToolsDialog(dialog, next, close);
  });
  serversSection.append(grokPreset);
  return serversSection;
}

function createAgentToolsToolsSection(status) {
  const toolsSection = document.createElement("section");
  toolsSection.className = "sidepanel-agent-tools-section";
  toolsSection.append(createText("h3", "sidepanel-agent-tools-section-title", "已发现工具"));
  const tools = normalizeDialogTools(status);
  if (tools.length === 0) {
    toolsSection.append(createText("p", "sidepanel-agent-tools-muted", "暂无工具"));
  } else {
    const toolList = document.createElement("div");
    toolList.className = "sidepanel-agent-tools-tool-list";
    for (const tool of tools) {
      const item = document.createElement("div");
      item.className = "sidepanel-agent-tools-tool";
      item.append(createText("strong", "", tool.displayName || tool.name || tool.id));
      item.append(createText("span", "sidepanel-agent-tools-muted", tool.description || tool.permission || ""));
      toolList.append(item);
    }
    toolsSection.append(toolList);
  }
  return toolsSection;
}

function createAgentToolsAuditSection(dialog, status, close) {
  const auditSection = document.createElement("section");
  auditSection.className = "sidepanel-agent-tools-section";
  auditSection.append(createText("h3", "sidepanel-agent-tools-section-title", "最近工具调用"));
  const auditLog = normalizeDialogAuditLog(status);
  if (auditLog.length === 0) {
    auditSection.append(createText("p", "sidepanel-agent-tools-muted", "暂无工具调用记录（暂无审计日志）"));
  } else {
    const auditList = document.createElement("div");
    auditList.className = "sidepanel-agent-tools-audit-list";
    for (const record of auditLog.slice(0, 20)) {
      const row = document.createElement("article");
      row.className = `sidepanel-agent-tools-audit is-${record.status || "unknown"}`;
      row.append(createText("strong", "", record.displayName || record.name || record.toolId || "工具调用"));
      row.append(createText("span", "sidepanel-agent-tools-muted", `${record.status || "unknown"} · ${record.durationMs ?? 0}ms`));
      const argumentsSummary = formatAuditArguments(record.arguments);
      if (argumentsSummary) {
        row.append(createText("code", "sidepanel-agent-tools-audit-args", `参数 ${argumentsSummary}`));
      }
      row.append(createText("p", "sidepanel-agent-tools-muted", record.resultSummary || record.errorMessage || ""));
      auditList.append(row);
    }
    auditSection.append(auditList);
  }
  const clearAudit = document.createElement("button");
  clearAudit.type = "button";
  clearAudit.className = "ui-button-secondary";
  clearAudit.textContent = "清空";
  clearAudit.setAttribute("aria-label", "清空审计日志");
  clearAudit.disabled = auditLog.length === 0;
  clearAudit.addEventListener("click", async () => {
    clearAudit.disabled = true;
    const next = await sendAgentToolsMessage({ type: "agentTools.clearAuditLog" });
    notifyAgentToolsResult(next, "审计日志已清空", "最近工具调用记录已清空。");
    renderAgentToolsDialog(
      dialog,
      next?.ok === false ? { ...status, ok: false, message: next.message } : { ...status, auditLog: next.auditLog || [] },
      close,
    );
  });
  auditSection.append(clearAudit);
  return auditSection;
}

function createGrokPresetConfigSection(dialog, status, close) {
  const settings = status?.settings?.mcp || {};
  const mcp = status?.mcp || {};
  const servers = normalizeDialogServers(status);
  const grokServer = findGrokPresetServer(servers);
  const enabled = grokServer ? grokServer.enabled !== false : settings.enabled === true;
  const hasGrokApiKey = Boolean(settings.grokApiKey || mcp.hasGrokApiKey);
  const bridgeBaseUrl = grokServer?.endpointUrl || settings.baseUrl || GROK_PRESET_ENDPOINT_URL;

  const section = document.createElement("section");
  section.className = "sidepanel-agent-tools-section";
  section.append(createText("h3", "sidepanel-agent-tools-section-title", "Grok 搜索预设配置"));

  const apiKeyLabel = document.createElement("label");
  apiKeyLabel.className = "sidepanel-agent-tools-field";
  const apiKeyText = document.createElement("span");
  apiKeyText.textContent = "Grok API Key";
  const apiKeyInput = document.createElement("input");
  apiKeyInput.type = "password";
  apiKeyInput.value = "";
  apiKeyInput.placeholder = hasGrokApiKey ? "已保存，留空不修改" : "xai-... / gsk-...";
  apiKeyInput.spellcheck = false;
  apiKeyInput.autocomplete = "off";
  const apiKeyHint = document.createElement("p");
  apiKeyHint.className = "sidepanel-agent-tools-field-hint";
  apiKeyHint.textContent = hasGrokApiKey
    ? "已保存 Key。只在需要替换时重新输入；留空保存不会清除旧 Key。"
    : "Key 只保存到本机扩展存储，并同步写入本地 Bridge。";
  apiKeyLabel.append(apiKeyText, apiKeyInput, apiKeyHint);

  const apiBaseLabel = document.createElement("label");
  apiBaseLabel.className = "sidepanel-agent-tools-field";
  const apiBaseText = document.createElement("span");
  apiBaseText.textContent = "Grok API Base URL";
  const apiBaseInput = document.createElement("input");
  apiBaseInput.type = "url";
  apiBaseInput.value = settings.grokBaseUrl || DEFAULT_GROK_API_BASE_URL;
  apiBaseInput.placeholder = DEFAULT_GROK_API_BASE_URL;
  apiBaseInput.spellcheck = false;
  apiBaseLabel.append(apiBaseText, apiBaseInput);

  const modelLabel = document.createElement("label");
  modelLabel.className = "sidepanel-agent-tools-field";
  const modelText = document.createElement("span");
  modelText.textContent = "Grok 模型";
  const modelInput = document.createElement("input");
  modelInput.type = "text";
  modelInput.value = settings.grokModel || DEFAULT_GROK_MODEL;
  modelInput.placeholder = DEFAULT_GROK_MODEL;
  modelInput.spellcheck = false;
  modelLabel.append(modelText, modelInput);

  const enabledSwitch = makeAgentToolsSwitch("启用 Grok 搜索 MCP 工具", enabled);

  const hint = createText(
    "p",
    "sidepanel-agent-tools-muted",
    `本地 Bridge 固定使用 ${bridgeBaseUrl}。留空保存不会改动已保存 Key；只有“清除已保存 Key”会删除。`,
  );

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

  const clearKey = document.createElement("button");
  clearKey.type = "button";
  clearKey.className = "sidepanel-agent-tools-link-button";
  clearKey.textContent = "清除已保存 Key";
  clearKey.disabled = !hasGrokApiKey;

  const setBusy = (busy) => {
    save.disabled = busy;
    refresh.disabled = busy;
    clearKey.disabled = busy || !hasGrokApiKey;
  };

  save.addEventListener("click", async () => {
    setBusy(true);
    const apiKey = apiKeyInput.value.trim();
    const mcpConfig = {
      servers: upsertGrokPresetServer(servers, { endpointUrl: bridgeBaseUrl, enabled: enabledSwitch.input.checked }),
      enabled: enabledSwitch.input.checked,
      exposeToChat: enabledSwitch.input.checked,
      baseUrl: bridgeBaseUrl,
      grokBaseUrl: apiBaseInput.value.trim(),
      grokModel: modelInput.value.trim(),
    };
    if (apiKey) {
      mcpConfig.grokApiKey = apiKey;
    }
    const next = await sendAgentToolsMessage({
      type: "agentTools.configureMcp",
      mcp: mcpConfig,
    });
    setBusy(false);
    notifyAgentToolsResult(next);
    renderAgentToolsDialog(dialog, next, close);
  });

  refresh.addEventListener("click", async () => {
    setBusy(true);
    const next = await sendAgentToolsMessage({ type: "agentTools.refreshMcp" });
    setBusy(false);
    notifyAgentToolsResult(next, "工具状态已刷新", "工具和 MCP 状态已刷新。");
    renderAgentToolsDialog(dialog, next, close);
  });

  clearKey.addEventListener("click", async () => {
    if (!globalThis.confirm?.("确定清除本机保存的 Grok API Key？")) {
      return;
    }
    setBusy(true);
    const next = await sendAgentToolsMessage({
      type: "agentTools.configureMcp",
      mcp: {
        servers: upsertGrokPresetServer(servers, { endpointUrl: bridgeBaseUrl, enabled: enabledSwitch.input.checked }),
        enabled: enabledSwitch.input.checked,
        exposeToChat: enabledSwitch.input.checked,
        baseUrl: bridgeBaseUrl,
        grokBaseUrl: apiBaseInput.value.trim(),
        grokModel: modelInput.value.trim(),
        clearGrokApiKey: true,
      },
    });
    setBusy(false);
    notifyAgentToolsResult(next, "工具设置已更新", "已清除本机保存的 Grok API Key。");
    renderAgentToolsDialog(dialog, next, close);
  });

  actions.append(save, refresh, clearKey);
  section.append(enabledSwitch.label, apiKeyLabel, apiBaseLabel, modelLabel, hint, actions);
  return section;
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
