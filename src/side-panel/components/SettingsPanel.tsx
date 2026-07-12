import { useEffect, useState, type KeyboardEvent, type RefObject } from "react";
import { ChannelManagement } from "./settings/ChannelManagement";
import { ChatPreferenceSettings } from "./settings/ChatPreferenceSettings";
import { ExtractionRules } from "./settings/ExtractionRules";
import { AutomationPlaybookSettings } from "./settings/AutomationPlaybookSettings";
import { AutomationDiagnostics } from "./settings/AutomationDiagnostics";
import { PromptTemplateSettings } from "./settings/PromptTemplateSettings";
import { SyncSettings } from "./settings/SyncSettings";
import { McpToolSettings } from "./settings/McpToolSettings";

export type SettingsTab = "channels" | "rules" | "chat" | "mcp" | "playbooks" | "prompts" | "sync";

const settingsTabs: Array<{ id: SettingsTab; label: string }> = [
  { id: "channels", label: "渠道管理" },
  { id: "rules", label: "提取规则" },
  { id: "chat", label: "聊天偏好" },
  { id: "mcp", label: "MCP 工具" },
  { id: "playbooks", label: "任务策略" },
  { id: "prompts", label: "提示词" },
  { id: "sync", label: "同步设置" },
];

interface SettingsPanelProps {
  embedded?: boolean;
  initialTab?: SettingsTab;
  showBackButton?: boolean;
  backButtonRef?: RefObject<HTMLButtonElement | null>;
  closeButtonRef?: RefObject<HTMLButtonElement | null>;
  onBackToHistory?: () => void;
  onClose?: () => void;
}

export function SettingsPanel({
  embedded = false,
  initialTab = "channels",
  onBackToHistory,
  onClose,
  showBackButton = Boolean(onBackToHistory),
  backButtonRef,
  closeButtonRef,
}: SettingsPanelProps) {
  const [activeTab, setActiveTab] = useState<SettingsTab>(initialTab);

  useEffect(() => {
    setActiveTab(initialTab);
  }, [initialTab]);

  const selectTabFromKeyboard = (event: KeyboardEvent<HTMLButtonElement>, tab: SettingsTab) => {
    const currentIndex = settingsTabs.findIndex((candidate) => candidate.id === tab);
    const nextIndex = event.key === "ArrowRight" || event.key === "ArrowDown"
      ? (currentIndex + 1) % settingsTabs.length
      : event.key === "ArrowLeft" || event.key === "ArrowUp"
        ? (currentIndex - 1 + settingsTabs.length) % settingsTabs.length
        : event.key === "Home"
          ? 0
          : event.key === "End"
            ? settingsTabs.length - 1
            : -1;
    if (nextIndex < 0) {
      return;
    }
    event.preventDefault();
    const nextTab = settingsTabs[nextIndex];
    setActiveTab(nextTab.id);
    document.getElementById(`settings-tab-${nextTab.id}`)?.focus({ preventScroll: true });
  };

  return (
    <section
      className={embedded ? "settings-drawer-page" : "ui-panel shadow-sm settings-dialog"}
      {...(!embedded ? { role: "dialog", "aria-modal": true, "aria-labelledby": "settings-dialog-title" } : {})}
    >
      <div className="settings-dialog-header">
        {showBackButton ? (
          <button ref={backButtonRef} className="settings-dialog-nav ui-button-secondary" type="button" aria-label="返回近期对话" title="返回近期对话" onClick={onBackToHistory} />
        ) : (
          <span className="settings-dialog-nav-spacer" aria-hidden="true" />
        )}
        <span className="settings-dialog-title" id="settings-dialog-title">
          设置
        </span>
        <button ref={closeButtonRef} className="settings-dialog-back ui-button-secondary" type="button" aria-label="关闭设置" title="关闭设置" onClick={onClose} />
      </div>
      <div className="settings-dialog-content mx-auto grid w-[80%] gap-4">
        <div className="min-w-0 space-y-3">
          <h2 className="text-base font-semibold">设置</h2>
          <div className="settings-tabs-scroll flex gap-2 overflow-x-auto" role="tablist" aria-label="设置分类">
            {settingsTabs.map((tab) => (
              <button
                key={tab.id}
                className={[
                  "settings-tab-button shrink-0 rounded px-3 py-2 text-left text-sm transition",
                  activeTab === tab.id ? "settings-tab-button-active" : "ui-button-secondary",
                ].join(" ")}
                type="button"
                role="tab"
                aria-selected={activeTab === tab.id}
                aria-controls={`settings-tabpanel-${tab.id}`}
                id={`settings-tab-${tab.id}`}
                tabIndex={activeTab === tab.id ? 0 : -1}
                onClick={() => setActiveTab(tab.id)}
                onKeyDown={(event) => selectTabFromKeyboard(event, tab.id)}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>
        <div className="grid min-w-0 gap-4" role="tabpanel" id={`settings-tabpanel-${activeTab}`} aria-labelledby={`settings-tab-${activeTab}`} tabIndex={0}>
          <AutomationDiagnostics />
          {activeTab === "channels" ? <ChannelManagement /> : null}
          {activeTab === "rules" ? <ExtractionRules /> : null}
          {activeTab === "chat" ? <ChatPreferenceSettings /> : null}
          {activeTab === "mcp" ? <McpToolSettings /> : null}
          {activeTab === "playbooks" ? <AutomationPlaybookSettings /> : null}
          {activeTab === "prompts" ? <PromptTemplateSettings /> : null}
          {activeTab === "sync" ? <SyncSettings /> : null}
        </div>
      </div>
    </section>
  );
}
