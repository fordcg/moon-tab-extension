import { useEffect, useRef, useState } from "react";
import { ChatPreferenceDrawer } from "./ChatPreferenceDrawer";
import { ChatComposer } from "./ChatComposer";
import { MessageList } from "./MessageList";
import { SessionHistoryDialog } from "./SessionHistoryDialog";
import { WorkflowSkillDialog } from "./WorkflowSkillDialog";
import { WorkflowTaskCard } from "./WorkflowTaskCard";
import type { SettingsTab } from "./SettingsPanel";
import { useAppStore } from "../state/appStore";
import { downloadChatSessionMarkdown, downloadChatSessionPdf, downloadChatSessionWord } from "../utils/chatMarkdownExport";

interface ChatPanelProps {
  browserControlEnabled: boolean;
  drawerOpen: boolean;
  drawerOrigin: "header" | "history";
  drawerPage: "history" | "settings";
  historyPanelOpen: boolean;
  settingsInitialTab: SettingsTab;
  onDrawerOpenChange: (open: boolean) => void;
  onRestoreDrawerFocus: () => void;
  onOpenAgentTools: () => void;
  onOpenHistoryDrawer: () => void;
  onOpenSettings: (tab?: SettingsTab) => void;
  onReturnSettingsToHistory: () => void;
  onToggleBrowserControl: () => void;
  onToggleHistoryPanel: () => void;
}

export function ChatPanel({
  browserControlEnabled,
  drawerOpen,
  drawerOrigin,
  drawerPage,
  historyPanelOpen,
  settingsInitialTab,
  onDrawerOpenChange,
  onRestoreDrawerFocus,
  onOpenAgentTools,
  onOpenHistoryDrawer,
  onOpenSettings,
  onReturnSettingsToHistory,
  onToggleBrowserControl,
  onToggleHistoryPanel,
}: ChatPanelProps) {
  const [chatPreferencesOpen, setChatPreferencesOpen] = useState(false);
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const [selectedWorkflowSkillId, setSelectedWorkflowSkillId] = useState<string | null>(null);
  const exportMenuRef = useRef<HTMLDivElement>(null);
  const providers = useAppStore((state) => state.providers);
  const models = useAppStore((state) => state.models);
  const selectedModelId = useAppStore((state) => state.selectedModelId);
  const addNotification = useAppStore((state) => state.addNotification);
  const chatRetryProgressByMessageId = useAppStore((state) => state.chatRetryProgressByMessageId);
  const regenerateMessage = useAppStore((state) => state.regenerateMessage);
  const editAndRegenerateUserMessage = useAppStore((state) => state.editAndRegenerateUserMessage);
  const sending = useAppStore((state) => state.sending);
  const pageContext = useAppStore((state) => state.pageContext);
  const toolCallDisplayMode = useAppStore((state) => state.chatPreferences.toolCallDisplayMode);
  const showToolCallProcessInAssistantMode = useAppStore((state) => state.chatPreferences.showToolCallProcessInAssistantMode);
  const contextMode = useAppStore((state) => state.contextMode);
  const extractionRules = useAppStore((state) => state.extractionRules);
  const storedActiveSession = useAppStore((state) => state.chatSessions.find((session) => session.id === state.activeSessionId));
  const privateModeActive = useAppStore((state) => state.privateModeActive);
  const privateChatSession = useAppStore((state) => state.privateChatSession);
  const enterPrivateMode = useAppStore((state) => state.enterPrivateMode);
  const savePrivateChatSession = useAppStore((state) => state.savePrivateChatSession);
  const workflowSkills = useAppStore((state) => state.workflowSkills);
  const loadWorkflowSkills = useAppStore((state) => state.loadWorkflowSkills);
  const activeSession = privateModeActive ? privateChatSession : storedActiveSession;
  const selectedWorkflowSkill = workflowSkills.find((skill) => skill.id === selectedWorkflowSkillId);
  const selectedModel = models.find((model) => model.id === selectedModelId);
  const selectedProvider = providers.find((provider) => provider.id === selectedModel?.providerId);
  const matchedRule = extractionRules.find((rule) => rule.id === pageContext.matchedRuleId);
  const canSend = Boolean(selectedModel?.enabled && selectedProvider?.enabled);
  const matchedRuleLabel = pageContext.usedFallback && pageContext.matchedRuleId
    ? "规则命中但无内容，已回退"
    : matchedRule
      ? `已匹配规则：${matchedRule.alias || matchedRule.urlPattern}`
      : contextMode === "all"
        ? "全局 HTML"
        : "全局文本";
  const canExport = Boolean(activeSession && activeSession.messages.length > 0);
  const canShowPrivateButton = privateModeActive || !storedActiveSession || storedActiveSession.messages.length === 0;

  useEffect(() => {
    if (!exportMenuOpen) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && !exportMenuRef.current?.contains(target)) {
        setExportMenuOpen(false);
      }
    };

    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [exportMenuOpen]);

  useEffect(() => {
    void loadWorkflowSkills();
  }, [loadWorkflowSkills]);

  const handleExport = async (format: "markdown" | "word" | "pdf") => {
    if (!activeSession || activeSession.messages.length === 0) {
      return;
    }

    setExportMenuOpen(false);
    try {
      if (format === "word") {
        await downloadChatSessionWord(activeSession);
        addNotification({ type: "success", title: "导出完成", message: "Word 文件已开始下载" });
        return;
      }

      if (format === "pdf") {
        await downloadChatSessionPdf(activeSession);
        addNotification({ type: "success", title: "导出完成", message: "PDF 打印窗口已打开" });
        return;
      }

      downloadChatSessionMarkdown(activeSession);
      addNotification({ type: "success", title: "导出完成", message: "Markdown 文件已开始下载" });
    } catch (error: unknown) {
      addNotification({ type: "error", title: "导出失败", message: error instanceof Error ? error.message : "导出失败，请重试" });
    }
  };

  return (
    <section className="chat-panel">
      <div className="chat-model-row">
        <button
          className="ui-button-secondary chat-history-panel-toggle"
          type="button"
          aria-label={historyPanelOpen ? "折叠历史对话" : "展开历史对话"}
          aria-expanded={historyPanelOpen}
          data-history-panel-open={historyPanelOpen}
          onClick={onToggleHistoryPanel}
        />
        <div className="chat-header-actions">
          <button className="ui-button-secondary chat-history-trigger" type="button" aria-label="历史" title="历史" onClick={onOpenHistoryDrawer}>
            <svg className="chat-history-icon" viewBox="0 0 24 24" aria-hidden="true">
              <circle cx="12" cy="4.5" r="1.85" />
              <circle cx="12" cy="12" r="1.85" />
              <circle cx="12" cy="19.5" r="1.85" />
            </svg>
          </button>
          <button className="ui-button-secondary chat-drawer-trigger" type="button" aria-label="打开当前聊天设置" onClick={() => setChatPreferencesOpen(true)}>
            ⚙
          </button>
          <div className="chat-export-menu-wrap" ref={exportMenuRef}>
            <button
              className="ui-button-secondary chat-export-trigger"
              type="button"
              aria-label="导出当前聊天"
              aria-haspopup="menu"
              aria-expanded={exportMenuOpen}
              disabled={!canExport}
              onClick={() => setExportMenuOpen((value) => !value)}
            >
              导出
            </button>
            {exportMenuOpen ? (
              <div className="chat-export-menu" role="menu">
                <button className="chat-export-menu-item" type="button" role="menuitem" onClick={() => void handleExport("markdown")}>
                  Markdown
                </button>
                <button className="chat-export-menu-item" type="button" role="menuitem" onClick={() => void handleExport("word")}>
                  Word
                </button>
                <button className="chat-export-menu-item" type="button" role="menuitem" onClick={() => void handleExport("pdf")}>
                  PDF
                </button>
              </div>
            ) : null}
          </div>
          {canShowPrivateButton ? (
            <button
              className={privateModeActive ? "ui-button-secondary chat-private-trigger chat-private-trigger-active" : "ui-button-secondary chat-private-trigger"}
              type="button"
              aria-label={privateModeActive ? "保存隐私对话" : "进入隐私模式"}
              onClick={() => void (privateModeActive ? savePrivateChatSession() : enterPrivateMode())}
            >
              {privateModeActive ? "保存" : "隐私"}
            </button>
          ) : null}
        </div>
      </div>
      <MessageList
        messages={activeSession?.messages ?? []}
        retryProgressByMessageId={chatRetryProgressByMessageId}
        toolCallDisplayMode={toolCallDisplayMode}
        showToolCallProcessInAssistantMode={showToolCallProcessInAssistantMode}
        onRegenerateMessage={(messageId) => void regenerateMessage(messageId)}
        onEditAndRegenerateUserMessage={(messageId, content) => void editAndRegenerateUserMessage(messageId, content)}
        regenerating={sending}
      />
      {activeSession && ((activeSession.workflowTasks?.length ?? 0) > 0 || workflowSkills.length > 0) ? (
        <section className="workflow-task-strip" aria-label="任务工作区">
          {workflowSkills.length ? (
            <section className="workflow-skill-shelf" aria-label="本地任务技能">
              <div className="workflow-skill-shelf-header">
                <h2 className="workflow-skill-shelf-title">技能</h2>
              </div>
              <div className="workflow-skill-list">
                {workflowSkills.map((skill) => (
                  <button
                    className="workflow-skill-chip"
                    type="button"
                    key={skill.id}
                    aria-label={`启动技能：${skill.title}`}
                    onClick={() => setSelectedWorkflowSkillId(skill.id)}
                  >
                    <span className="workflow-skill-chip-title">{skill.title}</span>
                    <span className="workflow-skill-chip-meta">{formatWorkflowTemplateLabel(skill.template)}</span>
                  </button>
                ))}
              </div>
            </section>
          ) : null}
          {(activeSession.workflowTasks ?? []).map((task) => (
            <WorkflowTaskCard key={task.id} task={task} />
          ))}
        </section>
      ) : null}
      {providers.length === 0 || models.length === 0 ? <p className="chat-warning">请先配置 API Key 后再开始对话</p> : null}
      <ChatComposer canSend={canSend} matchedRuleLabel={matchedRuleLabel} />
      <SessionHistoryDialog
        open={drawerOpen}
        page={drawerPage}
        origin={drawerOrigin}
        settingsInitialTab={settingsInitialTab}
        browserControlEnabled={browserControlEnabled}
        onOpenChange={onDrawerOpenChange}
        onRestoreFocus={onRestoreDrawerFocus}
        onOpenAgentTools={onOpenAgentTools}
        onOpenSettings={onOpenSettings}
        onReturnToHistory={onReturnSettingsToHistory}
        onToggleBrowserControl={onToggleBrowserControl}
      />
      <ChatPreferenceDrawer open={chatPreferencesOpen} onOpenChange={setChatPreferencesOpen} />
      {selectedWorkflowSkill ? (
        <WorkflowSkillDialog
          mode="start"
          open={Boolean(selectedWorkflowSkill)}
          skill={selectedWorkflowSkill}
          onOpenChange={(open) => {
            if (!open) {
              setSelectedWorkflowSkillId(null);
            }
          }}
        />
      ) : null}
    </section>
  );
}

function formatWorkflowTemplateLabel(template: "debug" | "research" | "automation"): string {
  switch (template) {
    case "debug":
      return "开发调试";
    case "automation":
      return "网页自动化";
    case "research":
    default:
      return "网页研究";
  }
}
