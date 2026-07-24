import { useEffect, useMemo, useState } from "react";
import type { ModelToolAvailabilityStatus } from "../../../shared/models/types";
import type { McpServerConfig } from "../../../shared/types";
import { useAppStore } from "../../state/appStore";
import { sendRuntimeMessage } from "../../state/runtimeMessage";
import { AutomationDiagnostics } from "./AutomationDiagnostics";
import { SettingsIconButton } from "./SettingsIconButton";

interface BuiltInToolHealth {
  id: string;
  name: string;
  displayName?: string;
  availability?: ModelToolAvailabilityStatus;
}

interface AgentToolsStatusResponse {
  ok?: boolean;
  auditLog?: unknown[];
  builtInTools?: BuiltInToolHealth[];
  message?: string;
  mcp?: {
    hasGrokApiKey?: boolean;
    message?: string;
    state?: string;
  };
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

export function McpToolSettings() {
  const mcpSettings = useAppStore((state) => state.mcpSettings);
  const loadChannelConfig = useAppStore((state) => state.loadChannelConfig);
  const [builtInTools, setBuiltInTools] = useState<BuiltInToolHealth[]>([]);
  const [status, setStatus] = useState<AgentToolsStatusResponse>({});
  const [statusLoading, setStatusLoading] = useState(true);
  const [grokApiKeyInput, setGrokApiKeyInput] = useState("");
  const [grokBaseUrlInput, setGrokBaseUrlInput] = useState(DEFAULT_GROK_API_BASE_URL);
  const [grokModelInput, setGrokModelInput] = useState(DEFAULT_GROK_MODEL);
  const [grokEnabled, setGrokEnabled] = useState(false);
  const [grokBusy, setGrokBusy] = useState(false);
  const unavailableBuiltInTools = builtInTools.filter((tool) => tool.availability && !tool.availability.available);
  const statusServers = useMemo(() => normalizeArray(status.settings?.mcp?.servers), [status.settings?.mcp?.servers]);
  const auditLog = useMemo(() => normalizeArray(status.auditLog), [status.auditLog]);
  const grokServer = useMemo(
    () => statusServers.find(isGrokPresetServer) ?? mcpSettings.servers.find(isGrokPresetServerConfig),
    [mcpSettings.servers, statusServers],
  );
  const hasGrokApiKey = Boolean(getString(status.settings?.mcp, "grokApiKey") || status.mcp?.hasGrokApiKey);
  const bridgeBaseUrl = getString(grokServer, "endpointUrl") || getString(status.settings?.mcp, "baseUrl") || GROK_PRESET_ENDPOINT_URL;
  const statusTone =
    status.ok === false || status.mcp?.state === "error" || statusServers.some((server) => getString(server, "lastRefreshError"))
      ? "is-error"
      : status.mcp?.state === "connected" ||
          statusServers.some((server) => getBoolean(server, "enabled", true)) ||
          mcpSettings.servers.some((server) => server.enabled)
        ? "is-connected"
        : "";
  const statusLabel =
    status.ok === false || status.mcp?.state === "error" || statusServers.some((server) => getString(server, "lastRefreshError"))
      ? "需处理"
      : status.mcp?.state === "connected" ||
          statusServers.some((server) => getBoolean(server, "enabled", true)) ||
          mcpSettings.servers.some((server) => server.enabled)
        ? "已启用"
        : "未配置";
  const statusMessage =
    status.ok === false
      ? (status.message ?? "工具状态读取失败")
      : (status.mcp?.message ?? `已配置 ${mcpSettings.servers.length} 个 MCP Server。`);

  const reloadChatRuntimeConfig = async () => {
    try {
      await loadChannelConfig();
    } catch {
      // Keep settings usable even if chat preferences/MCP store refresh fails.
    }
  };

  const loadStatus = async () => {
    setStatusLoading(true);
    const response = await sendRuntimeMessage<AgentToolsStatusResponse>({ type: "agentTools.getStatus" });
    setStatus(response ?? { ok: false, message: "工具状态读取失败" });
    if (response?.ok && Array.isArray(response.builtInTools)) {
      setBuiltInTools(response.builtInTools);
    }
    setStatusLoading(false);
  };

  useEffect(() => {
    void loadStatus();
  }, []);

  useEffect(() => {
    if (statusLoading) {
      return;
    }

    setGrokApiKeyInput("");
    setGrokBaseUrlInput(getString(status.settings?.mcp, "grokBaseUrl") || DEFAULT_GROK_API_BASE_URL);
    setGrokModelInput(getString(status.settings?.mcp, "grokModel") || DEFAULT_GROK_MODEL);
    setGrokEnabled(grokServer ? getBoolean(grokServer, "enabled", true) : getBoolean(status.settings?.mcp, "enabled", false));
  }, [grokServer, status.settings?.mcp, statusLoading]);

  const saveGrokConfig = async (clearGrokApiKey = false) => {
    setGrokBusy(true);
    const mcpConfig: Record<string, unknown> = {
      servers: upsertGrokPresetServer(statusServers.length > 0 ? statusServers : mcpSettings.servers, {
        endpointUrl: bridgeBaseUrl,
        enabled: grokEnabled,
      }),
      enabled: grokEnabled,
      exposeToChat: grokEnabled,
      baseUrl: bridgeBaseUrl,
      grokBaseUrl: grokBaseUrlInput.trim(),
      grokModel: grokModelInput.trim(),
      // Local OpenAI-compatible reverse proxies usually only support chat/completions.
      grokApiStyle: /127\.0\.0\.1|localhost/i.test(grokBaseUrlInput.trim()) ? "chat" : "",
    };
    if (clearGrokApiKey) {
      mcpConfig.clearGrokApiKey = true;
    } else if (grokApiKeyInput.trim()) {
      mcpConfig.grokApiKey = grokApiKeyInput.trim();
    }
    const next = await sendRuntimeMessage<AgentToolsStatusResponse>({
      type: "agentTools.configureMcp",
      mcp: mcpConfig,
    });
    setStatus(next ?? { ok: false, message: "工具设置保存失败" });
    await reloadChatRuntimeConfig();
    setGrokBusy(false);
  };
  const refreshGrokTools = async () => {
    setGrokBusy(true);
    const next = await sendRuntimeMessage<AgentToolsStatusResponse>({ type: "agentTools.refreshMcp" });
    setStatus(next ?? { ok: false, message: "工具状态刷新失败" });
    await reloadChatRuntimeConfig();
    setGrokBusy(false);
  };
  return (
    <section className="grid w-full gap-4" aria-label="工具和 MCP">
      <h3 className="text-base font-semibold">工具和 MCP</h3>
      <p className="ui-muted text-xs">查看工具状态、Grok 搜索预设和最近工具调用。模型可调用的工具总开关仍在“聊天偏好”。</p>

      <div className="sidepanel-agent-tools-status-row mcp-tools-status-row">
        <span className={["sidepanel-agent-tools-status", statusTone].filter(Boolean).join(" ")}>{statusLoading ? "读取中" : statusLabel}</span>
        <p>{statusLoading ? "正在读取工具状态..." : statusMessage}</p>
      </div>

      <AutomationDiagnostics />

      {builtInTools.some((tool) => tool.availability) ? (
        <section className="grid gap-2" aria-label="内置工具健康">
          <h4 className="text-sm font-semibold">内置工具健康</h4>
          {unavailableBuiltInTools.length > 0 ? (
            <div className="mcp-server-tool-list">
              {unavailableBuiltInTools.map((tool) => (
                <div key={tool.id} className="mcp-server-tool-item">
                  <span className="mcp-server-tool-item-title">{tool.displayName ?? tool.name}</span>
                  <span className="mcp-server-tool-item-description">{tool.availability?.reason}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="ui-muted text-xs">全部可用</p>
          )}
        </section>
      ) : null}

      <section className="grid gap-3" aria-label="最近工具调用">
        <h4 className="text-sm font-semibold">最近工具调用</h4>
        <div className="sidepanel-agent-tools-audit-list mcp-tools-audit-list">
          {auditLog.length > 0 ? (
            auditLog.slice(0, 8).map((record, index) => (
              <article
                className={getString(record, "status") === "error" ? "sidepanel-agent-tools-audit is-error" : "sidepanel-agent-tools-audit"}
                key={getString(record, "id") || index}
              >
                <strong>{getString(record, "toolName") || getString(record, "name") || "工具调用"}</strong>
                <span className="sidepanel-agent-tools-audit-args">{formatAuditArguments(getValue(record, "arguments"))}</span>
              </article>
            ))
          ) : (
            <p className="ui-muted text-xs">暂无工具调用记录</p>
          )}
        </div>
        <div className="chat-preference-tool-bulk-actions">
          <SettingsIconButton
            icon="eraser"
            label="清空记录"
            disabled={auditLog.length === 0}
            onClick={() => void sendRuntimeMessage({ type: "agentTools.clearAuditLog" }).then(loadStatus)}
          />
        </div>
      </section>

      <section className="grid gap-3" aria-label="Grok 搜索预设配置">
        <h4 className="text-sm font-semibold">Grok 搜索预设配置</h4>
        <label className="chat-preference-switch">
          <input
            className="chat-preference-switch-input"
            type="checkbox"
            checked={grokEnabled}
            onChange={(event) => setGrokEnabled(event.target.checked)}
          />
          <span className="chat-preference-switch-control" aria-hidden="true">
            <span className="chat-preference-switch-thumb" />
          </span>
          <span className="chat-preference-switch-label">启用 Grok 搜索 MCP 工具</span>
        </label>
        <label className="grid gap-1 text-sm">
          Grok API Key
          <input
            className="ui-input"
            type="password"
            aria-label="Grok API Key"
            value={grokApiKeyInput}
            placeholder={hasGrokApiKey ? "已保存，留空不修改" : "xai-... / gsk-..."}
            spellCheck={false}
            autoComplete="off"
            onChange={(event) => setGrokApiKeyInput(event.target.value)}
          />
          <span className="ui-muted text-xs">
            {hasGrokApiKey ? "已保存 Key。只在需要替换时重新输入；留空保存不会清除旧 Key。" : "Key 只保存到本机扩展存储，并同步写入本地 Bridge。"}
          </span>
        </label>
        <label className="grid gap-1 text-sm">
          Grok API Base URL
          <input
            className="ui-input"
            type="url"
            aria-label="Grok API Base URL"
            value={grokBaseUrlInput}
            placeholder={DEFAULT_GROK_API_BASE_URL}
            spellCheck={false}
            onChange={(event) => setGrokBaseUrlInput(event.target.value)}
          />
        </label>
        <label className="grid gap-1 text-sm">
          Grok 模型
          <input
            className="ui-input"
            type="text"
            aria-label="Grok 模型"
            value={grokModelInput}
            placeholder={DEFAULT_GROK_MODEL}
            spellCheck={false}
            onChange={(event) => setGrokModelInput(event.target.value)}
          />
        </label>
        <p className="ui-muted text-xs">
          {grokServer
            ? `本地 Bridge 固定使用 ${bridgeBaseUrl}。留空保存不会改动已保存 Key；只有“清除已保存 Key”会删除。`
            : `保存并刷新会自动接入本地 Bridge（${bridgeBaseUrl}）。请先启动 Bridge，再填写 API Key。`}
        </p>
        <div className="chat-preference-tool-bulk-actions">
          <SettingsIconButton
            icon={grokBusy ? "loader" : "save"}
            label="保存并刷新"
            variant="primary"
            disabled={grokBusy}
            aria-busy={grokBusy ? true : undefined}
            onClick={() => void saveGrokConfig()}
          />
          <SettingsIconButton
            icon={grokBusy ? "loader" : "refresh"}
            label="刷新工具"
            disabled={grokBusy}
            aria-busy={grokBusy ? true : undefined}
            onClick={() => void refreshGrokTools()}
          />
          <SettingsIconButton
            icon="key-x"
            label="清除已保存 Key"
            disabled={grokBusy || !hasGrokApiKey}
            onClick={() => {
              if (window.confirm("确定清除本机保存的 Grok API Key？")) {
                void saveGrokConfig(true);
              }
            }}
          />
        </div>
      </section>
    </section>
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

function isGrokPresetServerConfig(server: McpServerConfig): boolean {
  return server.id === GROK_PRESET_SERVER_ID || server.endpointUrl === GROK_PRESET_ENDPOINT_URL;
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
