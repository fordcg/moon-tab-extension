import { useEffect, useMemo, useState } from "react";
import {
  MODEL_TOOL_CAPABILITY_VALUES,
  MODEL_TOOL_RISK_VALUES,
  MODEL_TOOL_RUNTIME_VALUES,
  filterModelToolsByClassification,
  getModelToolGroups,
  getRegisteredModelTools,
} from "../../../shared/models/toolRegistry";
import type { ModelToolCapability, ModelToolRisk, ModelToolRuntimeRequirement } from "../../../shared/models/types";
import type { ChatPreferenceValues, SendShortcut } from "../../../shared/types";
import {
  ensureChatRequestLogSink,
  type ChatRequestLogSinkStatus,
} from "../../../background/chatRequestLogFile";
import { useAppStore } from "../../state/appStore";
import { formatModelLabelWithVision } from "../ModelVisionIndicator";
import { useComposedTextInput } from "../useComposedTextInput";
import { GlobalPreferenceNumberInput } from "./GlobalPreferenceNumberInput";
import { SettingsIconButton } from "./SettingsIconButton";
import { SettingsSelect } from "./SettingsSelect";

const sendShortcutOptions: Array<{ value: SendShortcut; label: string }> = [
  { value: "enter", label: "Enter" },
  { value: "shift_enter", label: "Shift+Enter" },
  { value: "ctrl_enter", label: "Ctrl+Enter" },
  { value: "alt_enter", label: "Alt+Enter" },
];

const followUpBehaviorOptions: Array<{ value: ChatPreferenceValues["followUpBehavior"]; label: string }> = [
  { value: "queue", label: "排队" },
  { value: "guide", label: "引导" },
];

const toolRuntimeLabels: Record<ModelToolRuntimeRequirement, string> = {
  local: "本地工具",
  external_web: "公开网页搜索",
  browser_control: "浏览器控制",
  controlled_enhanced: "受控增强",
  full_access: "完全访问",
  mcp_remote: "MCP 远程工具",
};

const toolCapabilityLabels: Record<ModelToolCapability, string> = {
  observe_page: "观察页面",
  operate_page: "操作页面",
  analyze_site: "分析现场",
  confirm_boundary: "请求确认",
  deliver_result: "交付结果",
  search_public_web: "公开搜索",
  system_context: "系统上下文",
  call_remote_tool: "调用远程工具",
};

const toolRiskLabels: Record<ModelToolRisk, string> = {
  low: "低风险",
  medium: "中风险",
  high: "高风险",
  critical: "最高风险",
};

export function ChatPreferenceSettings() {
  const [runtimeFilter, setRuntimeFilter] = useState<ModelToolRuntimeRequirement | "">("");
  const [capabilityFilter, setCapabilityFilter] = useState<ModelToolCapability | "">("");
  const [riskFilter, setRiskFilter] = useState<ModelToolRisk | "">("");
  const [logSinkStatus, setLogSinkStatus] = useState<ChatRequestLogSinkStatus>("unknown");
  const chatPreferences = useAppStore((state) => state.chatPreferences);
  const mcpSettings = useAppStore((state) => state.mcpSettings);
  const providers = useAppStore((state) => state.providers);
  const models = useAppStore((state) => state.models);
  const defaultChatModelId = useAppStore((state) => state.defaultChatModelId);
  const setDefaultChatModel = useAppStore((state) => state.setDefaultChatModel);
  const setTitleModel = useAppStore((state) => state.setTitleModel);
  const updateChatPreferences = useAppStore((state) => state.updateChatPreferences);
  const addNotification = useAppStore((state) => state.addNotification);
  const selectedTitleModelId = models.find((model) => model.isTitleModel)?.id ?? "";
  const titleModelOptions = useMemo(
    () =>
      models
        .map((model) => {
          const provider = providers.find((item) => item.id === model.providerId);
          if (!provider?.enabled || !model.enabled) {
            return undefined;
          }
          return {
            id: model.id,
            label: formatModelLabelWithVision(`${provider.name} / ${model.displayName}`, model.supportsVision),
          };
        })
        .filter((item): item is { id: string; label: string } => Boolean(item)),
    [models, providers],
  );

  useEffect(() => {
    if (!chatPreferences.workspaceRequestLoggingEnabled) {
      setLogSinkStatus("unknown");
      return;
    }
    let cancelled = false;
    setLogSinkStatus("starting");
    void ensureChatRequestLogSink()
      .then((status) => {
        if (!cancelled) {
          setLogSinkStatus(status);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setLogSinkStatus("unavailable");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [chatPreferences.workspaceRequestLoggingEnabled]);

  const registeredTools = getRegisteredModelTools(mcpSettings);
  const filteredTools = filterModelToolsByClassification(registeredTools, {
    ...(runtimeFilter ? { runtime: runtimeFilter } : {}),
    ...(capabilityFilter ? { capability: capabilityFilter } : {}),
    ...(riskFilter ? { risk: riskFilter } : {}),
  });
  const registeredToolGroups = getModelToolGroups(filteredTools);
  const systemPromptInput = useComposedTextInput(chatPreferences.systemPrompt, (systemPrompt) => {
    void updateChatPreferences({ systemPrompt });
  });
  const contextCompressionPromptInput = useComposedTextInput(chatPreferences.contextCompressionPrompt, (contextCompressionPrompt) => {
    void updateChatPreferences({ contextCompressionPrompt });
  });
  const handleToolToggle = (toolId: string, checked: boolean) => {
    const nextToolIds = checked ? [...chatPreferences.enabledToolIds, toolId] : chatPreferences.enabledToolIds.filter((id) => id !== toolId);
    void updateChatPreferences({ enabledToolIds: Array.from(new Set(nextToolIds)) });
  };
  const filteredToolIds = filteredTools.map((tool) => tool.id);
  const handleEnableFilteredTools = () => {
    void updateChatPreferences({
      enabledToolIds: Array.from(new Set([...chatPreferences.enabledToolIds, ...filteredToolIds])),
    });
  };
  const handleDisableFilteredTools = () => {
    const filteredIds = new Set(filteredTools.map((tool) => tool.id));
    void updateChatPreferences({ enabledToolIds: chatPreferences.enabledToolIds.filter((toolId) => !filteredIds.has(toolId)) });
  };
  const handleWorkspaceLoggingToggle = async (checked: boolean) => {
    await updateChatPreferences({ workspaceRequestLoggingEnabled: checked });
    if (!checked) {
      setLogSinkStatus("unknown");
      return;
    }
    setLogSinkStatus("starting");
    const status = await ensureChatRequestLogSink();
    setLogSinkStatus(status);
    if (status === "running") {
      addNotification({
        type: "success",
        title: "请求日志服务已就绪",
        message: "本机 127.0.0.1:17334 可写 .tmp/chat-request-logs/",
      });
      return;
    }
    addNotification({
      type: "warning",
      title: "请求日志服务未运行",
      message: "请先执行 npm run model-diagnostics:install-autostart，或手动运行 npm run model-diagnostics:ensure",
    });
  };

  return (
    <section className="grid w-full gap-3" aria-label="聊天偏好">
      <h3 className="text-base font-semibold">聊天偏好</h3>
      <section className="grid gap-3 border-b border-[var(--color-hairline)] pb-3" aria-label="全局模型">
        <div className="grid gap-1 text-sm">
          <span>默认对话模型</span>
          <SettingsSelect
            ariaLabel="默认对话模型"
            triggerAriaLabel="默认对话模型菜单"
            value={defaultChatModelId}
            options={[
              { value: "", label: "使用第一个可用模型" },
              ...titleModelOptions.map((model) => ({ value: model.id, label: model.label })),
            ]}
            onChange={(value) => void setDefaultChatModel(value)}
          />
        </div>
        <div className="grid gap-1 text-sm">
          <span>AI 标题生成模型</span>
          <SettingsSelect
            ariaLabel="AI 标题生成模型"
            triggerAriaLabel="AI 标题生成模型菜单"
            value={selectedTitleModelId}
            options={[
              { value: "", label: "不开启自动标题生成" },
              ...titleModelOptions.map((model) => ({ value: model.id, label: model.label })),
            ]}
            onChange={(value) => setTitleModel(value)}
          />
        </div>
        <p className="text-xs text-[var(--color-muted)]">选择后仅在首轮对话完成后额外发起一次非流式标题请求。</p>
      </section>
      <label className="grid gap-1 text-sm">
        系统提示词
        <textarea
          className="ui-input min-h-32"
          aria-label="全局系统提示词"
          {...systemPromptInput}
        />
      </label>
      <label className="grid gap-1 text-sm">
        上下文压缩 Prompt
        <textarea
          className="ui-input min-h-32"
          aria-label="全局上下文压缩 Prompt"
          {...contextCompressionPromptInput}
        />
      </label>
      <div className="chat-preference-grid">
        <GlobalPreferenceNumberInput
          label="AI 请求失败重试次数"
          value={chatPreferences.aiRequestRetryCount}
          min={0}
          max={20}
          step={1}
          onChange={(value) => void updateChatPreferences({ aiRequestRetryCount: value })}
        />
        <GlobalPreferenceNumberInput
          label="普通模式最大工具轮次"
          value={chatPreferences.browserAutomationMaxToolIterations}
          min={1}
          step={1}
          onChange={(value) => void updateChatPreferences({ browserAutomationMaxToolIterations: value })}
        />
        <GlobalPreferenceNumberInput
          label="受控增强最大工具轮次"
          value={chatPreferences.browserAutomationMaxToolIterationsControlledEnhanced}
          min={1}
          step={1}
          onChange={(value) => void updateChatPreferences({ browserAutomationMaxToolIterationsControlledEnhanced: value })}
        />
        <GlobalPreferenceNumberInput
          label="完全访问最大工具轮次（0=不限制）"
          value={chatPreferences.browserAutomationMaxToolIterationsFullAccess}
          min={0}
          step={1}
          onChange={(value) => void updateChatPreferences({ browserAutomationMaxToolIterationsFullAccess: value })}
        />
        <GlobalPreferenceNumberInput
          label="temperature"
          value={chatPreferences.temperature}
          min={0}
          max={2}
          step={0.1}
          onChange={(value) => void updateChatPreferences({ temperature: value })}
        />
        <GlobalPreferenceNumberInput
          label="模型输出上限 max_tokens"
          value={chatPreferences.maxTokens}
          min={1}
          step={1}
          onChange={(value) => void updateChatPreferences({ maxTokens: value })}
        />
        <GlobalPreferenceNumberInput
          label="最大聊天上下文预算（token，会与模型窗口取更小值）"
          value={chatPreferences.maxContextTokens}
          min={1}
          step={1}
          onChange={(value) => void updateChatPreferences({ maxContextTokens: value })}
        />
        <GlobalPreferenceNumberInput
          label="硬压缩阈值（%，先 soft 裁剪再摘要）"
          value={chatPreferences.contextCompressionThresholdPercent}
          min={1}
          max={100}
          step={1}
          onChange={(value) => void updateChatPreferences({ contextCompressionThresholdPercent: value })}
        />
        <GlobalPreferenceNumberInput
          label="工具附件详情池保留上限"
          value={chatPreferences.toolDetailPoolKeepLimit}
          min={0}
          step={1}
          onChange={(value) => void updateChatPreferences({ toolDetailPoolKeepLimit: value })}
        />
        <GlobalPreferenceNumberInput
          label="top_k"
          value={chatPreferences.topK}
          min={1}
          step={1}
          onChange={(value) => void updateChatPreferences({ topK: value })}
        />
      </div>
      <p className="ui-muted text-xs">
        工具轮次按浏览器自动化模式生效：普通 / 受控增强有上限；完全访问默认 0 表示不限制（仍可手动停止）。
      </p>
      <fieldset className="chat-preference-network-types">
        <legend className="text-sm">工具调用</legend>
        <label className="chat-preference-switch">
          <input
            className="chat-preference-switch-input"
            type="checkbox"
            checked={chatPreferences.toolCallingEnabled}
            onChange={(event) => void updateChatPreferences({ toolCallingEnabled: event.target.checked })}
          />
          <span className="chat-preference-switch-control" aria-hidden="true">
            <span className="chat-preference-switch-thumb" />
          </span>
          <span className="chat-preference-switch-label">启用工具调用</span>
        </label>
        <p className="ui-muted text-xs">这里设置新对话默认启用的工具；实际发送时仍会根据当前会话选择、浏览器控制状态和自动化模式过滤。</p>
        <div className="chat-preference-tool-filter-grid">
          <label className="chat-preference-field">
            能力
            <SettingsSelect
              ariaLabel="工具能力筛选"
              value={capabilityFilter}
              options={[
                { value: "", label: "全部能力" },
                ...MODEL_TOOL_CAPABILITY_VALUES.map((capability) => ({ value: capability, label: toolCapabilityLabels[capability] })),
              ]}
              onChange={(value) => setCapabilityFilter(value as ModelToolCapability | "")}
            />
          </label>
          <label className="chat-preference-field">
            运行要求
            <SettingsSelect
              ariaLabel="工具运行要求筛选"
              value={runtimeFilter}
              options={[
                { value: "", label: "全部运行要求" },
                ...MODEL_TOOL_RUNTIME_VALUES.map((runtime) => ({ value: runtime, label: toolRuntimeLabels[runtime] })),
              ]}
              onChange={(value) => setRuntimeFilter(value as ModelToolRuntimeRequirement | "")}
            />
          </label>
          <label className="chat-preference-field">
            风险
            <SettingsSelect
              ariaLabel="工具风险筛选"
              value={riskFilter}
              options={[
                { value: "", label: "全部风险" },
                ...MODEL_TOOL_RISK_VALUES.map((risk) => ({ value: risk, label: toolRiskLabels[risk] })),
              ]}
              onChange={(value) => setRiskFilter(value as ModelToolRisk | "")}
            />
          </label>
        </div>
        <div className="chat-preference-tool-bulk-actions">
          <SettingsIconButton icon="check-circle" label="启用筛选结果" onClick={handleEnableFilteredTools} />
          <SettingsIconButton icon="x-circle" label="禁用筛选结果" onClick={handleDisableFilteredTools} />
        </div>
        {registeredTools.length > 0 ? (
          <div className="chat-preference-tool-group-list">
            {registeredToolGroups.map((group) => (
              <div key={group.id} className="chat-preference-tool-group">
                <div className="chat-preference-tool-group-title">{group.label}</div>
                {group.tools.map((tool) => {
                  const toolDisplayName = tool.displayName ?? tool.name;
                  return (
                    <label key={tool.id} className="chat-preference-network-type-chip">
                      <input
                        type="checkbox"
                        aria-label={`启用工具 ${toolDisplayName}`}
                        checked={chatPreferences.enabledToolIds.includes(tool.id)}
                        onChange={(event) => handleToolToggle(tool.id, event.target.checked)}
                      />
                      <span>{toolDisplayName}</span>
                    </label>
                  );
                })}
              </div>
            ))}
          </div>
        ) : (
          <p className="ui-muted text-xs">暂无可用工具</p>
        )}
      </fieldset>
      <label className="chat-preference-field">
        工具调用展示方式
        <SettingsSelect
          ariaLabel="工具调用展示方式"
          value={chatPreferences.toolCallDisplayMode}
          options={[
            { value: "assistant_grouped", label: "AI 回复与工具分组" },
            { value: "compact", label: "紧凑工具过程" },
          ]}
          onChange={(value) => void updateChatPreferences({ toolCallDisplayMode: value as ChatPreferenceValues["toolCallDisplayMode"] })}
        />
      </label>
      <label className="chat-preference-switch">
        <input
          className="chat-preference-switch-input"
          type="checkbox"
          checked={chatPreferences.showToolCallProcessInAssistantMode}
          onChange={(event) => void updateChatPreferences({ showToolCallProcessInAssistantMode: event.target.checked })}
        />
        <span className="chat-preference-switch-control" aria-hidden="true">
          <span className="chat-preference-switch-thumb" />
        </span>
        <span className="chat-preference-switch-label">非紧凑模式显示工具调用过程</span>
      </label>
      <label className="chat-preference-switch">
        <input
          className="chat-preference-switch-input"
          type="checkbox"
          checked={chatPreferences.workspaceRequestLoggingEnabled}
          onChange={(event) => {
            void handleWorkspaceLoggingToggle(event.target.checked);
          }}
        />
        <span className="chat-preference-switch-control" aria-hidden="true">
          <span className="chat-preference-switch-thumb" />
        </span>
        <span className="chat-preference-switch-label">工作区请求日志</span>
      </label>
      <p className="ui-muted text-xs">
        开启后，完整请求过程写入本机日志服务（`127.0.0.1:17334` → `.tmp/chat-request-logs/`）。
        打开开关会自动检测服务；若未运行，会尝试通过本机协议自启。
      </p>
      {chatPreferences.workspaceRequestLoggingEnabled ? (
        <div className="rounded-lg border border-[var(--color-hairline)] bg-[var(--color-surface-soft)] p-2 text-xs text-[var(--color-body)]">
          <div>
            服务状态：
            {logSinkStatus === "running"
              ? "已运行"
              : logSinkStatus === "starting"
                ? "正在启动…"
                : logSinkStatus === "unavailable"
                  ? "未运行"
                  : "检测中…"}
          </div>
          {logSinkStatus === "unavailable" ? (
            <div className="mt-1 grid gap-1">
              <span>一次性安装自动启动：</span>
              <code className="break-all">npm run model-diagnostics:install-autostart</code>
              <span>或手动启动：</span>
              <code className="break-all">npm run model-diagnostics:ensure</code>
              <SettingsIconButton
                className="mt-1"
                icon="refresh"
                label="重新检测/尝试启动"
                onClick={() => {
                  void (async () => {
                    setLogSinkStatus("starting");
                    const status = await ensureChatRequestLogSink();
                    setLogSinkStatus(status);
                  })();
                }}
              />
            </div>
          ) : null}
        </div>
      ) : null}
      <label className="chat-preference-field">
        发送快捷键
        <SettingsSelect
          ariaLabel="发送快捷键"
          value={chatPreferences.sendShortcut}
          options={sendShortcutOptions}
          onChange={(value) => void updateChatPreferences({ sendShortcut: value as SendShortcut })}
        />
      </label>
      <label className="chat-preference-field">
        跟进行为
        <SettingsSelect
          ariaLabel="跟进行为"
          value={chatPreferences.followUpBehavior}
          options={followUpBehaviorOptions}
          onChange={(value) => void updateChatPreferences({ followUpBehavior: value as ChatPreferenceValues["followUpBehavior"] })}
        />
        <span className="ui-muted text-xs">运行中发送草稿时使用；Ctrl+Shift+Enter 会执行相反操作。</span>
      </label>
      <label className="chat-preference-switch">
        <input
          className="chat-preference-switch-input"
          type="checkbox"
          checked={chatPreferences.injectPageContextByDefault}
          onChange={(event) => void updateChatPreferences({ injectPageContextByDefault: event.target.checked })}
        />
        <span className="chat-preference-switch-control" aria-hidden="true">
          <span className="chat-preference-switch-thumb" />
        </span>
        <span className="chat-preference-switch-label">新对话默认注入当前页面上下文</span>
      </label>
      <label className="chat-preference-switch">
        <input
          className="chat-preference-switch-input"
          type="checkbox"
          checked={chatPreferences.extractHtmlByDefault}
          onChange={(event) => void updateChatPreferences({ extractHtmlByDefault: event.target.checked })}
        />
        <span className="chat-preference-switch-control" aria-hidden="true">
          <span className="chat-preference-switch-thumb" />
        </span>
        <span className="chat-preference-switch-label">新对话默认提取 HTML 源码</span>
      </label>
    </section>
  );
}
