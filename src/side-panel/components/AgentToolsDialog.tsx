import { useEffect, useMemo, useRef, useState } from "react";
import { sendRuntimeMessage } from "../state/runtimeMessage";

interface AgentToolsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface AgentToolsStatus {
  auditLog?: unknown[];
  loading?: boolean;
  mcp?: {
    hasGrokApiKey?: boolean;
    message?: string;
    state?: string;
  };
  message?: string;
  ok?: boolean;
  settings?: {
    mcp?: {
      baseUrl?: string;
      enabled?: boolean;
      exposeToChat?: boolean;
      grokApiKey?: string;
      grokBaseUrl?: string;
      grokModel?: string;
      servers?: unknown[];
    };
  };
  tools?: unknown[];
}

const GROK_PRESET_SERVER_ID = "grok-search-127-0-0-1-17333";
const GROK_PRESET_ENDPOINT_URL = "http://127.0.0.1:17333/";
const DEFAULT_GROK_API_BASE_URL = "https://api.x.ai/v1";
const DEFAULT_GROK_MODEL = "grok-4.20-multi-agent-xhigh";

export function AgentToolsDialog({ open, onOpenChange }: AgentToolsDialogProps) {
  const [status, setStatus] = useState<AgentToolsStatus>({ loading: true });
  const [grokApiKeyInput, setGrokApiKeyInput] = useState("");
  const [grokBaseUrlInput, setGrokBaseUrlInput] = useState(DEFAULT_GROK_API_BASE_URL);
  const [grokModelInput, setGrokModelInput] = useState(DEFAULT_GROK_MODEL);
  const [grokEnabled, setGrokEnabled] = useState(false);
  const [grokBusy, setGrokBusy] = useState(false);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const servers = useMemo(() => normalizeArray(status.settings?.mcp?.servers), [status.settings?.mcp?.servers]);
  const tools = useMemo(() => normalizeArray(status.tools), [status.tools]);
  const auditLog = useMemo(() => normalizeArray(status.auditLog), [status.auditLog]);
  const grokServer = useMemo(() => servers.find(isGrokPresetServer), [servers]);

  const loadStatus = async () => {
    setStatus({ loading: true });
    const response = await sendRuntimeMessage<AgentToolsStatus>({ type: "agentTools.getStatus" });
    setStatus(response ?? { ok: false, message: "工具状态读取失败" });
  };

  useEffect(() => {
    if (!open) {
      return;
    }

    void loadStatus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onOpenChange(false);
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, onOpenChange]);

  useEffect(() => {
    if (open && !status.loading) {
      closeButtonRef.current?.focus({ preventScroll: true });
    }
  }, [open, status.loading]);

  useEffect(() => {
    if (!open || status.loading) {
      return;
    }

    setGrokApiKeyInput("");
    setGrokBaseUrlInput(getString(status.settings?.mcp, "grokBaseUrl") || DEFAULT_GROK_API_BASE_URL);
    setGrokModelInput(getString(status.settings?.mcp, "grokModel") || DEFAULT_GROK_MODEL);
    setGrokEnabled(grokServer ? getBoolean(grokServer, "enabled", true) : getBoolean(status.settings?.mcp, "enabled", false));
  }, [grokServer, open, status.loading, status.settings?.mcp]);

  if (!open) {
    return null;
  }

  const hasServerError = servers.some((server) => getString(server, "lastRefreshError"));
  const hasEnabledServer = servers.some((server) => getBoolean(server, "enabled", true));
  const statusTone = status.ok === false || status.mcp?.state === "error" || hasServerError
    ? "is-error"
    : status.mcp?.state === "connected" || hasEnabledServer
      ? "is-connected"
      : "";
  const statusLabel = status.ok === false || status.mcp?.state === "error" || hasServerError
    ? "需处理"
    : status.mcp?.state === "connected" || hasEnabledServer
      ? "已启用"
      : "未配置";
  const statusMessage = status.ok === false
    ? status.message ?? "工具状态读取失败"
    : status.mcp?.message ?? `已配置 ${servers.length} 个 MCP Server，已发现 ${tools.length} 个工具。`;
  const hasGrokApiKey = Boolean(getString(status.settings?.mcp, "grokApiKey") || status.mcp?.hasGrokApiKey);
  const bridgeBaseUrl = getString(grokServer, "endpointUrl") || getString(status.settings?.mcp, "baseUrl") || GROK_PRESET_ENDPOINT_URL;
  const saveGrokConfig = async (clearGrokApiKey = false) => {
    setGrokBusy(true);
    const mcpConfig: Record<string, unknown> = {
      servers: upsertGrokPresetServer(servers, { endpointUrl: bridgeBaseUrl, enabled: grokEnabled }),
      enabled: grokEnabled,
      exposeToChat: grokEnabled,
      baseUrl: bridgeBaseUrl,
      grokBaseUrl: grokBaseUrlInput.trim(),
      grokModel: grokModelInput.trim(),
    };
    if (clearGrokApiKey) {
      mcpConfig.clearGrokApiKey = true;
    } else if (grokApiKeyInput.trim()) {
      mcpConfig.grokApiKey = grokApiKeyInput.trim();
    }
    const next = await sendRuntimeMessage<AgentToolsStatus>({
      type: "agentTools.configureMcp",
      mcp: mcpConfig,
    });
    setStatus(next ?? { ok: false, message: "工具设置保存失败" });
    setGrokBusy(false);
  };
  const refreshGrokTools = async () => {
    setGrokBusy(true);
    const next = await sendRuntimeMessage<AgentToolsStatus>({ type: "agentTools.refreshMcp" });
    setStatus(next ?? { ok: false, message: "工具状态刷新失败" });
    setGrokBusy(false);
  };

  return (
    <>
      <div className="sidepanel-agent-tools-overlay" aria-hidden="true" onClick={() => onOpenChange(false)} />
      <section className="sidepanel-agent-tools-dialog" role="dialog" aria-modal="true" aria-labelledby="sidepanel-agent-tools-title">
        <header className="sidepanel-agent-tools-header">
          <div className="sidepanel-agent-tools-title-wrap">
            <h2 id="sidepanel-agent-tools-title">工具和 MCP</h2>
            <p>管理内置工具、HTTP MCP Server、Grok 搜索预设和最近工具调用。</p>
          </div>
          <button ref={closeButtonRef} className="sidepanel-agent-tools-close" type="button" aria-label="关闭工具和 MCP" onClick={() => onOpenChange(false)}>
            关闭
          </button>
        </header>
        <div className="sidepanel-agent-tools-body">
          {status.loading ? (
            <p className="sidepanel-agent-tools-muted">正在读取工具状态...</p>
          ) : (
            <>
              <div className="sidepanel-agent-tools-status-row">
                <span className={["sidepanel-agent-tools-status", statusTone].filter(Boolean).join(" ")}>{statusLabel}</span>
                <p>{statusMessage}</p>
              </div>
              <section className="sidepanel-agent-tools-section">
                <h3 className="sidepanel-agent-tools-section-title">MCP Server</h3>
                <div className="sidepanel-agent-tools-server-list">
                  {servers.length > 0 ? (
                    servers.map((server, index) => (
                      <article className="sidepanel-agent-tools-server" key={getString(server, "id") || index}>
                        <strong>{getString(server, "name") || getString(server, "id") || "未命名 Server"}</strong>
                        <p className="sidepanel-agent-tools-muted">{getString(server, "endpointUrl")}</p>
                        <p className="sidepanel-agent-tools-muted">
                          {`状态：${getBoolean(server, "enabled", true) ? "已启用" : "已禁用"} · 已发现工具：${normalizeArray(getValue(server, "tools")).length}`}
                        </p>
                        {getString(server, "lastRefreshError") ? <p className="sidepanel-agent-tools-muted">{`刷新失败：${getString(server, "lastRefreshError")}`}</p> : null}
                      </article>
                    ))
                  ) : (
                    <p className="sidepanel-agent-tools-muted">暂无 MCP Server</p>
                  )}
                </div>
                <div className="sidepanel-agent-tools-actions">
                  <button
                    className="ui-button-secondary"
                    type="button"
                    onClick={() => void configureGrokPreset(servers).then(loadStatus)}
                  >
                    添加 Grok 搜索预设
                  </button>
                  <button
                    className="sidepanel-agent-tools-link-button"
                    type="button"
                    onClick={() => void refreshGrokTools()}
                  >
                    刷新工具列表
                  </button>
                </div>
              </section>
              <section className="sidepanel-agent-tools-section">
                <h3 className="sidepanel-agent-tools-section-title">已发现工具</h3>
                <div className="sidepanel-agent-tools-tool-list">
                  {tools.length > 0 ? (
                    tools.map((tool, index) => (
                      <article className="sidepanel-agent-tools-tool" key={getString(tool, "id") || index}>
                        <strong>{getString(tool, "displayName") || getString(tool, "name") || getString(tool, "id") || "未命名工具"}</strong>
                        {getString(tool, "description") ? <p className="sidepanel-agent-tools-muted">{getString(tool, "description")}</p> : null}
                      </article>
                    ))
                  ) : (
                    <p className="sidepanel-agent-tools-muted">暂无工具</p>
                  )}
                </div>
              </section>
              <section className="sidepanel-agent-tools-section">
                <h3 className="sidepanel-agent-tools-section-title">最近工具调用</h3>
                <div className="sidepanel-agent-tools-audit-list">
                  {auditLog.length > 0 ? (
                    auditLog.slice(0, 8).map((record, index) => (
                      <article className={getString(record, "status") === "error" ? "sidepanel-agent-tools-audit is-error" : "sidepanel-agent-tools-audit"} key={getString(record, "id") || index}>
                        <strong>{getString(record, "toolName") || getString(record, "name") || "工具调用"}</strong>
                        <span className="sidepanel-agent-tools-audit-args">{formatAuditArguments(getValue(record, "arguments"))}</span>
                      </article>
                    ))
                  ) : (
                    <p className="sidepanel-agent-tools-muted">暂无工具调用记录</p>
                  )}
                </div>
                <div className="sidepanel-agent-tools-actions">
                  <button
                    className="sidepanel-agent-tools-link-button"
                    type="button"
                    disabled={auditLog.length === 0}
                    onClick={() => void sendRuntimeMessage({ type: "agentTools.clearAuditLog" }).then(loadStatus)}
                  >
                    清空记录
                  </button>
                </div>
              </section>
              <section className="sidepanel-agent-tools-section">
                <h3 className="sidepanel-agent-tools-section-title">Grok 搜索预设配置</h3>
                <label className="sidepanel-agent-tools-switch">
                  <input
                    type="checkbox"
                    checked={grokEnabled}
                    onChange={(event) => setGrokEnabled(event.target.checked)}
                  />
                  <span className="sidepanel-agent-tools-switch-control" aria-hidden="true" />
                  <span>启用 Grok 搜索 MCP 工具</span>
                </label>
                <label className="sidepanel-agent-tools-field">
                  <span>Grok API Key</span>
                  <input
                    type="password"
                    aria-label="Grok API Key"
                    value={grokApiKeyInput}
                    placeholder={hasGrokApiKey ? "已保存，留空不修改" : "xai-... / gsk-..."}
                    spellCheck={false}
                    autoComplete="off"
                    onChange={(event) => setGrokApiKeyInput(event.target.value)}
                  />
                  <p className="sidepanel-agent-tools-field-hint">
                    {hasGrokApiKey ? "已保存 Key。只在需要替换时重新输入；留空保存不会清除旧 Key。" : "Key 只保存到本机扩展存储，并同步写入本地 Bridge。"}
                  </p>
                </label>
                <label className="sidepanel-agent-tools-field">
                  <span>Grok API Base URL</span>
                  <input
                    type="url"
                    aria-label="Grok API Base URL"
                    value={grokBaseUrlInput}
                    placeholder={DEFAULT_GROK_API_BASE_URL}
                    spellCheck={false}
                    onChange={(event) => setGrokBaseUrlInput(event.target.value)}
                  />
                </label>
                <label className="sidepanel-agent-tools-field">
                  <span>Grok 模型</span>
                  <input
                    type="text"
                    aria-label="Grok 模型"
                    value={grokModelInput}
                    placeholder={DEFAULT_GROK_MODEL}
                    spellCheck={false}
                    onChange={(event) => setGrokModelInput(event.target.value)}
                  />
                </label>
                <p className="sidepanel-agent-tools-muted">{`本地 Bridge 固定使用 ${bridgeBaseUrl}。留空保存不会改动已保存 Key；只有“清除已保存 Key”会删除。`}</p>
                <div className="sidepanel-agent-tools-actions">
                  <button className="ui-button-primary" type="button" disabled={grokBusy} onClick={() => void saveGrokConfig()}>
                    保存并刷新
                  </button>
                  <button className="ui-button-secondary" type="button" disabled={grokBusy} onClick={() => void refreshGrokTools()}>
                    刷新工具
                  </button>
                  <button
                    className="sidepanel-agent-tools-link-button"
                    type="button"
                    disabled={grokBusy || !hasGrokApiKey}
                    onClick={() => {
                      if (window.confirm("确定清除本机保存的 Grok API Key？")) {
                        void saveGrokConfig(true);
                      }
                    }}
                  >
                    清除已保存 Key
                  </button>
                </div>
              </section>
            </>
          )}
        </div>
      </section>
    </>
  );
}

function normalizeArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function getValue(value: unknown, key: string): unknown {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>)[key] : undefined;
}

function getString(value: unknown, key: string): string {
  const result = getValue(value, key);
  return typeof result === "string" ? result : "";
}

function getBoolean(value: unknown, key: string, fallback: boolean): boolean {
  const result = getValue(value, key);
  return typeof result === "boolean" ? result : fallback;
}

function isGrokPresetServer(server: unknown): boolean {
  return getString(server, "id") === GROK_PRESET_SERVER_ID || getString(server, "endpointUrl") === GROK_PRESET_ENDPOINT_URL;
}

function formatAuditArguments(value: unknown): string {
  if (value === undefined) {
    return "";
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

async function configureGrokPreset(servers: unknown[]) {
  const nextServers = upsertGrokPresetServer(servers, {
    endpointUrl: GROK_PRESET_ENDPOINT_URL,
    enabled: true,
  });
  await sendRuntimeMessage({
    type: "agentTools.configureMcp",
    mcp: {
      servers: nextServers,
      baseUrl: GROK_PRESET_ENDPOINT_URL,
    },
  });
}

function upsertGrokPresetServer(servers: unknown[], overrides: Record<string, unknown> = {}): unknown[] {
  let found = false;
  const nextServers = servers.map((server) => {
    if (!isGrokPresetServer(server)) {
      return server;
    }
    found = true;
    return {
      ...(typeof server === "object" && server !== null ? server : {}),
      ...overrides,
      id: GROK_PRESET_SERVER_ID,
      name: getString(server, "name") || "Grok 搜索",
      endpointUrl: typeof overrides.endpointUrl === "string" ? overrides.endpointUrl : GROK_PRESET_ENDPOINT_URL,
      enabled: typeof overrides.enabled === "boolean" ? overrides.enabled : true,
      tools: normalizeArray(getValue(server, "tools")),
    };
  });
  if (!found) {
    nextServers.push({
      id: GROK_PRESET_SERVER_ID,
      name: "Grok 搜索",
      ...overrides,
      endpointUrl: typeof overrides.endpointUrl === "string" ? overrides.endpointUrl : GROK_PRESET_ENDPOINT_URL,
      enabled: typeof overrides.enabled === "boolean" ? overrides.enabled : true,
      tools: [],
    });
  }
  return nextServers;
}
