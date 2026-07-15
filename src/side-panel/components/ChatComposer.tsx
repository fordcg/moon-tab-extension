import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { ChangeEvent, ClipboardEvent as ReactClipboardEvent, KeyboardEvent as ReactKeyboardEvent } from "react";
import { hasTokenUsage, sumSessionTokenUsage } from "../../shared/chat/tokenUsage";
import { isPngDataUrl, isTabCaptureImageAttachment, TAB_CAPTURE_VISIBLE_MESSAGE_TYPE, type TabCaptureVisibleResponse } from "../../shared/tabCapture";
import {
  getEnabledAutomationPlaybooks,
  type AutomationPlaybook,
} from "../../shared/automationPlaybooks";
import type { ChatImageAttachment, ChatPromptInvocation, ChatTokenUsage, SendShortcut, WorkflowTaskTemplate } from "../../shared/types";
import { useAppStore, type ChatFollowUpItem, type ContextTabCandidate } from "../state/appStore";
import { BoundaryChoiceDialog } from "./BoundaryChoiceDialog";
import { ModelSelector } from "./ModelSelector";
import { PromptInlineEditor } from "./PromptInlineEditor";
import { WorkflowTemplateMenu } from "./WorkflowTemplateMenu";
import { useModalDialogFocus } from "./useModalDialogFocus";

const MAX_IMAGE_ATTACHMENTS = 5;
const MAX_IMAGE_ATTACHMENT_BYTES = 5 * 1024 * 1024;
const ACCEPTED_IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"];
const TOKEN_KILO_THRESHOLD = 1_000;
const TOKEN_MEGA_THRESHOLD = 1_000_000;
const EMPTY_FOLLOW_UPS: ChatFollowUpItem[] = [];
const SWITCH_ICON_PATHS = {
  appendContext: "M7 7h10M12 7v10M6 3h12a3 3 0 0 1 3 3v12a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3V6a3 3 0 0 1 3-3Z",
  stream: "M13 2 5 14h6l-1 8 8-12h-6l1-8Z",
  browserControl: "M5 5h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2ZM3 9h18M12 12v4M10 14h4",
  extractText: "M6 4h12M6 8h12M6 12h8M6 16h12M6 20h8",
  extractAll: "M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3M8 9h8M8 13h8M8 17h5",
} as const;
const TOOLS_TOGGLE_ICON_PATH = "M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M2 14h4M10 8h4M18 16h4";

type SwitchIconName = keyof typeof SWITCH_ICON_PATHS;
type BrowserAutomationMode = "normal_restricted" | "controlled_enhanced" | "full_access";

const BROWSER_AUTOMATION_MODE_OPTIONS: Array<{ mode: BrowserAutomationMode; label: string; description: string; iconPath: string }> = [
  {
    mode: "normal_restricted",
    label: "普通模式",
    description: "默认受限，只读、脱敏、固定模板",
    iconPath: "M12 3 5 6v5c0 4 2.8 7.4 7 10 4.2-2.6 7-6 7-10V6l-7-3Z",
  },
  {
    mode: "controlled_enhanced",
    label: "受控增强",
    description: "允许 AI 请求一次性边界授权",
    iconPath: "M5 12a7 7 0 0 1 14 0M8 12h8M12 8v8",
  },
  {
    mode: "full_access",
    label: "完全访问",
    description: "最高风险，允许原样执行高权限工具",
    iconPath: "M12 3 4 7v5c0 4.4 3.2 7.6 8 9 4.8-1.4 8-4.6 8-9V7l-8-4ZM12 8v5M12 16h.01",
  },
];

interface ChatComposerProps {
  canSend: boolean;
  matchedRuleLabel: string;
}

interface ComposerSwitchProps {
  ariaLabel: string;
  checked: boolean;
  disabled?: boolean;
  icon: SwitchIconName;
  label: string;
  title?: string;
  onToggle: () => void;
}

interface SharedContextTab {
  active: boolean;
  favIconUrl?: string;
  pageContextKey?: string;
  selected: boolean;
  tabId?: number;
  title: string;
  url: string;
}

function ComposerSwitch({ ariaLabel, checked, disabled, icon, label, title, onToggle }: ComposerSwitchProps) {
  return (
    <button
      className="composer-switch"
      type="button"
      role="switch"
      aria-label={ariaLabel}
      aria-checked={checked}
      data-label={label}
      disabled={disabled}
      title={title ?? label}
      onClick={onToggle}
    >
      <svg className="composer-switch-icon" viewBox="0 0 24 24" aria-hidden="true">
        <path d={SWITCH_ICON_PATHS[icon]} />
      </svg>
    </button>
  );
}

export function ChatComposer({ canSend, matchedRuleLabel }: ChatComposerProps) {
  const [input, setInput] = useState("");
  const [promptInvocations, setPromptInvocations] = useState<ChatPromptInvocation[]>([]);
  const [slashMenuOpen, setSlashMenuOpen] = useState(false);
  const [slashQuery, setSlashQuery] = useState("");
  const [slashStartIndex, setSlashStartIndex] = useState<number | undefined>();
  const [slashActiveIndex, setSlashActiveIndex] = useState(0);
  const [attachments, setAttachments] = useState<ChatImageAttachment[]>([]);
  const [attachmentError, setAttachmentError] = useState("");
  const [previewAttachment, setPreviewAttachment] = useState<ChatImageAttachment | undefined>();
  const [contextDialogOpen, setContextDialogOpen] = useState(false);
  const [sharedBannerOpen, setSharedBannerOpen] = useState(false);
  const [dismissedPageContextKey, setDismissedPageContextKey] = useState<string | undefined>();
  const [stopStatusText, setStopStatusText] = useState("");
  const [toolShelfOpen, setToolShelfOpen] = useState(false);
  const [modeMenuOpen, setModeMenuOpen] = useState(false);
  const [followUpQueueOpen, setFollowUpQueueOpen] = useState(false);
  const [modeMenuPosition, setModeMenuPosition] = useState<{ left: number; top: number } | undefined>();
  const [composing, setComposing] = useState(false);
  const [workflowMenuOpen, setWorkflowMenuOpen] = useState(false);
  const imageInputId = useId();
  const contextDialogRef = useRef<HTMLElement | null>(null);
  const contextCloseButtonRef = useRef<HTMLButtonElement>(null);
  const imagePreviewDialogRef = useRef<HTMLElement>(null);
  const imagePreviewCloseRef = useRef<HTMLButtonElement>(null);
  const modeMenuButtonRef = useRef<HTMLButtonElement | null>(null);
  const modeMenuRef = useRef<HTMLDivElement | null>(null);
  const workflowMenuRef = useRef<HTMLDivElement | null>(null);
  const workflowMenuButtonRef = useRef<HTMLButtonElement | null>(null);
  const currentModelSupportsVision = useAppStore((state) => Boolean(state.models.find((model) => model.id === state.selectedModelId)?.supportsVision));
  const sendShortcut = useAppStore((state) => state.chatPreferences.sendShortcut);
  const followUpBehavior = useAppStore((state) => state.chatPreferences.followUpBehavior);
  const automationPlaybookSettings = useAppStore((state) => state.automationPlaybookSettings);
  const importedSkillPlaybooks = useAppStore((state) => state.importedSkillPlaybooks);
  const streamMode = useAppStore((state) => state.streamMode);
  const browserControlEnabled = useAppStore((state) => state.browserControlEnabled);
  const browserAutomationMode = useAppStore((state) => state.browserAutomationMode);
  const pendingBoundaryChoice = useAppStore((state) => state.pendingBoundaryChoice);
  const contextMode = useAppStore((state) => state.contextMode);
  const appendPageContextToSystemPrompt = useAppStore((state) => state.appendPageContextToSystemPrompt);
  const sending = useAppStore((state) => state.sending);
  const syncRestoreBarrierActive = useAppStore((state) => state.syncRestoreBarrierActive);
  const pageContext = useAppStore((state) => state.pageContext);
  const activeSession = useAppStore((state) =>
    state.privateModeActive
      ? state.privateChatSession
      : state.chatSessions.find((session) => session.id === state.activeSessionId),
  );
  const activeFollowUps = useAppStore((state) => {
    const sessionId = state.privateModeActive ? state.privateChatSession?.id : state.activeSessionId;
    return sessionId ? state.followUpsBySessionId[sessionId] ?? EMPTY_FOLLOW_UPS : EMPTY_FOLLOW_UPS;
  });
  const contextTabs = useAppStore((state) => state.contextTabs);
  const contextTabsLoading = useAppStore((state) => state.contextTabsLoading);
  const contextTabsError = useAppStore((state) => state.contextTabsError);
  const setStreamMode = useAppStore((state) => state.setStreamMode);
  const setBrowserControlEnabled = useAppStore((state) => state.setBrowserControlEnabled);
  const setBrowserAutomationMode = useAppStore((state) => state.setBrowserAutomationMode);
  const setContextMode = useAppStore((state) => state.setContextMode);
  const setComposerHasDraft = useAppStore((state) => state.setComposerHasDraft);
  const setAppendPageContextToSystemPrompt = useAppStore((state) => state.setAppendPageContextToSystemPrompt);
  const refreshPageContext = useAppStore((state) => state.refreshPageContext);
  const loadContextTabs = useAppStore((state) => state.loadContextTabs);
  const toggleContextTabSelection = useAppStore((state) => state.toggleContextTabSelection);
  const sendChatMessage = useAppStore((state) => state.sendChatMessage);
  const createWorkflowTask = useAppStore((state) => state.createWorkflowTask);
  const sendWorkflowTaskMessage = useAppStore((state) => state.sendWorkflowTaskMessage);
  const submitChatFollowUp = useAppStore((state) => state.submitChatFollowUp);
  const removeChatFollowUp = useAppStore((state) => state.removeChatFollowUp);
  const guideChatFollowUp = useAppStore((state) => state.guideChatFollowUp);
  const abortActiveChatTask = useAppStore((state) => state.abortActiveChatTask);
  const respondBoundaryChoice = useAppStore((state) => state.respondBoundaryChoice);
  const addNotification = useAppStore((state) => state.addNotification);
  const effectiveBrowserAutomationMode: BrowserAutomationMode = browserControlEnabled ? browserAutomationMode : "normal_restricted";
  const pageContextKey = `${pageContext.url ?? ""}\u0001${pageContext.title ?? ""}\u0001${pageContext.text}`;
  const sharedContextTabs = useMemo(
    () => buildSharedContextTabs(contextTabs, pageContext, pageContextKey, dismissedPageContextKey),
    [contextTabs, dismissedPageContextKey, pageContext, pageContextKey],
  );

  useModalDialogFocus({
    dialogRef: imagePreviewDialogRef,
    initialFocusRef: imagePreviewCloseRef,
    onEscape: () => setPreviewAttachment(undefined),
    open: Boolean(previewAttachment),
  });
  useModalDialogFocus({
    dialogRef: contextDialogRef,
    initialFocusRef: contextCloseButtonRef,
    onEscape: () => setContextDialogOpen(false),
    open: contextDialogOpen,
  });

  useEffect(() => {
    if (sharedContextTabs.length < 2 && sharedBannerOpen) {
      setSharedBannerOpen(false);
    }
  }, [sharedBannerOpen, sharedContextTabs.length]);

  useEffect(() => {
    setComposerHasDraft(input.trim().length > 0 || attachments.length > 0 || promptInvocations.length > 0);
  }, [attachments.length, input, promptInvocations.length, setComposerHasDraft]);

  useEffect(() => {
    setSlashActiveIndex(0);
  }, [slashQuery, slashMenuOpen]);

  useEffect(() => {
    if (!contextDialogOpen) {
      return undefined;
    }

    const closeOnPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) {
        setContextDialogOpen(false);
        return;
      }
      if (contextDialogRef.current?.contains(target)) {
        return;
      }
      if (target instanceof Element && target.closest(".sidepanel-add-tab-button, .context-view-button")) {
        return;
      }

      setContextDialogOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setContextDialogOpen(false);
      }
    };

    document.addEventListener("pointerdown", closeOnPointerDown);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnPointerDown);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [contextDialogOpen]);

  useEffect(() => {
    if (sending) {
      return undefined;
    }

    document.body.classList.remove("sidepanel-stop-requested");
    if (!stopStatusText) {
      return undefined;
    }

    const timeoutId = window.setTimeout(() => setStopStatusText(""), 1200);
    return () => window.clearTimeout(timeoutId);
  }, [sending, stopStatusText]);

  useEffect(() => {
    return () => {
      document.body.classList.remove("sidepanel-stop-requested");
    };
  }, []);

  useEffect(() => {
    if (!modeMenuOpen) {
      return undefined;
    }

    const closeOnPointerDown = (event: PointerEvent) => {
      if (
        modeMenuRef.current?.contains(event.target as Node) ||
        modeMenuButtonRef.current?.contains(event.target as Node)
      ) {
        return;
      }

      setModeMenuOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setModeMenuOpen(false);
      }
    };

    updateModeMenuPosition();
    document.addEventListener("pointerdown", closeOnPointerDown);
    document.addEventListener("keydown", closeOnEscape);
    window.addEventListener("resize", updateModeMenuPosition);
    window.addEventListener("scroll", updateModeMenuPosition, true);
    return () => {
      document.removeEventListener("pointerdown", closeOnPointerDown);
      document.removeEventListener("keydown", closeOnEscape);
      window.removeEventListener("resize", updateModeMenuPosition);
      window.removeEventListener("scroll", updateModeMenuPosition, true);
    };
  }, [modeMenuOpen]);

  useEffect(() => {
    if (!toolShelfOpen) {
      return undefined;
    }

    const closeOnPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) {
        setToolShelfOpen(false);
        setModeMenuOpen(false);
        return;
      }
      if (target instanceof Element && target.closest(".composer-switches, .sidepanel-tools-toggle, .composer-mode-menu")) {
        return;
      }

      setToolShelfOpen(false);
      setModeMenuOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setToolShelfOpen(false);
        setModeMenuOpen(false);
      }
    };

    document.addEventListener("pointerdown", closeOnPointerDown);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnPointerDown);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [toolShelfOpen]);

  useEffect(() => {
    if (!workflowMenuOpen) {
      return undefined;
    }

    const closeOnPointerDown = (event: PointerEvent) => {
      if (
        workflowMenuRef.current?.contains(event.target as Node) ||
        workflowMenuButtonRef.current?.contains(event.target as Node)
      ) {
        return;
      }

      setWorkflowMenuOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setWorkflowMenuOpen(false);
      }
    };

    document.addEventListener("pointerdown", closeOnPointerDown);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnPointerDown);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [workflowMenuOpen]);

  const submit = async () => {
    const content = input.trim();
    if (!content && attachments.length === 0 && promptInvocations.length === 0) {
      return;
    }

    setInput("");
    setPromptInvocations([]);
    setSlashMenuOpen(false);
    const sendingAttachments = attachments;
    const sendingPromptInvocations = promptInvocations;
    const forcedPlaybookId = sendingPromptInvocations.length > 0
      ? sendingPromptInvocations[sendingPromptInvocations.length - 1]?.promptId
      : undefined;
    setAttachments([]);
    setAttachmentError("");
    await sendChatMessage(content, sendingAttachments, sendingPromptInvocations, forcedPlaybookId);
  };
  const createWorkflow = async (template: WorkflowTaskTemplate) => {
    const objective = input.trim();
    if (!objective || sending || !canSend) {
      return;
    }

    setWorkflowMenuOpen(false);
    setInput("");
    setPromptInvocations([]);
    setSlashMenuOpen(false);
    setSlashQuery("");
    setSlashStartIndex(undefined);
    try {
      const task = await createWorkflowTask(template, objective);
      await sendWorkflowTaskMessage(task.id, objective);
    } catch (error: unknown) {
      setInput(objective);
      addNotification({ type: "error", title: "任务创建失败", message: error instanceof Error ? error.message : "任务创建失败" });
    }
  };

  const submitFollowUp = async (behavior = followUpBehavior) => {
    if (syncRestoreBarrierActive) {
      return;
    }
    const content = input.trim();
    if (!content && attachments.length === 0 && promptInvocations.length === 0) {
      return;
    }

    setInput("");
    setPromptInvocations([]);
    setSlashMenuOpen(false);
    const sendingAttachments = attachments;
    const sendingPromptInvocations = promptInvocations;
    setAttachments([]);
    setAttachmentError("");
    await submitChatFollowUp(content, sendingAttachments, sendingPromptInvocations, { behavior });
  };

  const handleInputKeyDown = (event: ReactKeyboardEvent<HTMLElement>) => {
    const isComposingInput = composing || event.nativeEvent.isComposing;
    if (slashMenuOpen) {
      if (event.key === "Escape") {
        event.preventDefault();
        setSlashMenuOpen(false);
        return;
      }
      if (!isComposingInput && (event.key === "ArrowDown" || event.key === "ArrowUp") && filteredSkillPlaybooks.length > 0) {
        event.preventDefault();
        setSlashActiveIndex((current) =>
          event.key === "ArrowDown"
            ? (current + 1) % filteredSkillPlaybooks.length
            : (current - 1 + filteredSkillPlaybooks.length) % filteredSkillPlaybooks.length,
        );
        return;
      }
      if (!isComposingInput && (event.key === "Enter" || event.key === "Tab") && filteredSkillPlaybooks[slashActiveIndex]) {
        event.preventDefault();
        handleSelectSkillPlaybook(filteredSkillPlaybooks[slashActiveIndex]);
        return;
      }
      if (isComposingInput && event.key === "Enter") {
        event.preventDefault();
        return;
      }
    }

    const isOppositeFollowUpShortcut = sending && isCtrlShiftEnter(event);
    if (isComposingInput || (!isOppositeFollowUpShortcut && !isSendShortcut(event, sendShortcut))) {
      return;
    }

    event.preventDefault();
    const hasDraft = input.trim().length > 0 || attachments.length > 0 || promptInvocations.length > 0;
    if (!hasDraft || syncRestoreBarrierActive || (!sending && !canSend)) {
      return;
    }

    if (sending) {
      void submitFollowUp(isOppositeFollowUpShortcut ? getOppositeFollowUpBehavior(followUpBehavior) : followUpBehavior);
      return;
    }

    void submit();
  };

  const handleImageInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    void addImageFiles(Array.from(event.target.files ?? [])).catch(() => {
      setAttachmentError("图片读取失败，请重新选择图片");
    });
    event.target.value = "";
  };

  const handlePaste = (event: ReactClipboardEvent<HTMLElement>) => {
    const files = getPastedImageFiles(event.clipboardData);
    if (files.length === 0) {
      return;
    }

    event.preventDefault();
    void addImageFiles(files).catch(() => {
      setAttachmentError("图片读取失败，请重新选择图片");
    });
  };

  const handleInputChange = (value: string, options: { forceSlashDetection?: boolean } = {}) => {
    setInput(value);
    if (composing && !options.forceSlashDetection) {
      return;
    }

    const slashInfo = findSlashCommand(value);
    if (!slashInfo) {
      setSlashMenuOpen(false);
      setSlashQuery("");
      setSlashStartIndex(undefined);
      return;
    }

    setSlashMenuOpen(true);
    setSlashQuery(slashInfo.query);
    setSlashStartIndex(slashInfo.startIndex);
  };

  const handleSelectSkillPlaybook = (playbook: AutomationPlaybook) => {
    // Keep the last selected strategy as the forced playbook for this send.
    setPromptInvocations((current) => [
      ...current.filter((item) => item.promptId !== playbook.id),
      {
        promptId: playbook.id,
        title: playbook.title,
        contentSnapshot: playbook.description || playbook.title,
      },
    ]);
    setInput((current) => {
      return removeSlashCommandSegment(current, slashStartIndex);
    });
    setSlashMenuOpen(false);
    setSlashQuery("");
    setSlashStartIndex(undefined);
    setSlashActiveIndex(0);
  };

  const handleCaptureVisibleTab = async () => {
    if (!currentModelSupportsVision) {
      return;
    }
    if (attachments.length >= MAX_IMAGE_ATTACHMENTS) {
      setAttachmentError("最多只能添加 5 张图片");
      return;
    }

    try {
      const response = await sendRuntimeMessage<TabCaptureVisibleResponse>({ type: TAB_CAPTURE_VISIBLE_MESSAGE_TYPE });
      if (!response?.ok) {
        setAttachmentError(response?.message || "当前页面截图失败，请稍后重试");
        return;
      }
      if (!isTabCaptureImageAttachment(response.attachment)) {
        setAttachmentError("当前页面截图结果无效，请重试");
        return;
      }
      if (estimateDataUrlBytes(response.attachment.dataUrl) > MAX_IMAGE_ATTACHMENT_BYTES) {
        setAttachmentError("单张图片不能超过 5MB");
        return;
      }
      if (!isPngDataUrl(response.attachment.dataUrl)) {
        setAttachmentError("当前页面截图结果无效，请重试");
        return;
      }

      setAttachments((current) => [...current, response.attachment]);
      setAttachmentError("");
    } catch {
      setAttachmentError("当前页面截图失败，请稍后重试");
    }
  };

  const addImageFiles = async (files: File[]) => {
    if (files.length === 0) {
      return;
    }
    if (!currentModelSupportsVision) {
      setAttachmentError("当前模型不支持视觉理解，无法添加图片");
      return;
    }

    const nextAttachments = [...attachments];
    for (const file of files) {
      if (nextAttachments.length >= MAX_IMAGE_ATTACHMENTS) {
        setAttachmentError("最多只能添加 5 张图片");
        break;
      }
      if (!file.type.startsWith("image/") || !ACCEPTED_IMAGE_TYPES.includes(file.type)) {
        setAttachmentError("仅支持 PNG、JPEG、WebP 或 GIF 图片");
        continue;
      }
      if (file.size > MAX_IMAGE_ATTACHMENT_BYTES) {
        setAttachmentError("单张图片不能超过 5MB");
        continue;
      }

      try {
        nextAttachments.push({
          id: `image-${Date.now()}-${nextAttachments.length}`,
          name: file.name || "图片",
          mediaType: file.type,
          dataUrl: await readFileAsDataUrl(file),
        });
      } catch {
        setAttachmentError("图片读取失败，请重新选择图片");
        continue;
      }
      setAttachmentError("");
    }

    setAttachments(nextAttachments);
  };

  const updateModeMenuPosition = () => {
    const rect = modeMenuButtonRef.current?.getBoundingClientRect();
    if (!rect) {
      return;
    }

    const menuWidth = Math.min(window.innerWidth - 24, 272);
    const menuHeight = Math.min(window.innerHeight - 24, 256);
    const preferredLeft = rect.left;
    const preferredTop = rect.top - 12;
    setModeMenuPosition({
      left: Math.max(12, Math.min(preferredLeft, window.innerWidth - menuWidth - 12)),
      top: Math.max(12, Math.min(preferredTop, window.innerHeight - menuHeight - 12)),
    });
  };

  const toggleModeMenu = () => {
    if (!modeMenuOpen) {
      setWorkflowMenuOpen(false);
      updateModeMenuPosition();
    }
    setModeMenuOpen((value) => !value);
  };

  const toggleToolShelf = () => {
    setModeMenuOpen(false);
    setWorkflowMenuOpen(false);
    setContextDialogOpen(false);
    setToolShelfOpen((open) => !open);
  };

  const toggleWorkflowMenu = () => {
    setToolShelfOpen(false);
    setModeMenuOpen(false);
    setContextDialogOpen(false);
    setWorkflowMenuOpen((value) => !value);
  };

  const toggleContextDialog = () => {
    setToolShelfOpen(false);
    setModeMenuOpen(false);
    setWorkflowMenuOpen(false);
    if (contextDialogOpen) {
      setContextDialogOpen(false);
      return;
    }

    setContextDialogOpen(true);
    void loadContextTabs();
  };

  const contextModeLabel = contextMode === "all" ? "提取所有" : "提取文本";
  const browserControlTitle = browserControlEnabled
    ? "浏览器控制已开启。关闭会立即断开调试会话。"
    : "浏览器控制已关闭。开启后扩展会通过 Chrome 调试协议连接当前普通网页，浏览器会显示正在调试提示。";
  const browserAutomationModeOption = BROWSER_AUTOMATION_MODE_OPTIONS.find((option) => option.mode === effectiveBrowserAutomationMode) ?? BROWSER_AUTOMATION_MODE_OPTIONS[0];
  const browserAutomationModeLabel = browserAutomationModeOption.label;
  const enabledSkillPlaybooks = getEnabledAutomationPlaybooks(
    automationPlaybookSettings,
    importedSkillPlaybooks,
  );
  const filteredSkillPlaybooks = filterSkillPlaybooks(enabledSkillPlaybooks, slashQuery);
  const hasDraft = input.trim().length > 0 || attachments.length > 0 || promptInvocations.length > 0;
  const contextStripClassName = sharedContextTabs.length > 0 ? "context-strip has-page-banner" : "context-strip is-page-banner-empty";
  // Syncing used to toggle `is-syncing-selection`, which hid non-current rows via
  // visibility:hidden and made dialog text flicker on open/select. Keep the list
  // stable; only surface empty-state loading when there is nothing to show yet.
  const contextDialogBusy = contextTabsLoading || contextTabs.some((tab) => tab.loading);
  const canSubmit = canSend && hasDraft;
  const sessionTokenUsage = sumSessionTokenUsage(activeSession);
  const submitButtonLabel = sending && !hasDraft ? "终止" : "发送";
  const visibleQueuedFollowUps = activeFollowUps.filter((item) => item.behavior === "queue");
  const nextFollowUp = visibleQueuedFollowUps[0];
  const removeSharedContextTab = (tab: SharedContextTab) => {
    if (sharedContextTabs.length <= 2) {
      setSharedBannerOpen(false);
    }
    if (typeof tab.tabId === "number") {
      toggleContextTabSelection(tab.tabId);
      return;
    }
    if (tab.pageContextKey) {
      setDismissedPageContextKey(tab.pageContextKey);
    }
  };
  const stopGeneration = () => {
    document.body.classList.add("sidepanel-stop-requested");
    setStopStatusText("正在停止生成");
    void abortActiveChatTask();
  };

  return (
    <section className={toolShelfOpen ? "chat-composer is-tools-open" : "chat-composer"} aria-label="聊天输入区">
      {activeSession && visibleQueuedFollowUps.length > 0 ? (
        <div className={followUpQueueOpen ? "follow-up-queue follow-up-queue-expanded" : "follow-up-queue follow-up-queue-collapsed"} aria-label="排队对话">
          {followUpQueueOpen ? (
            <>
              <div className="follow-up-queue-header">
                <button
                  className="follow-up-queue-icon-button follow-up-queue-toggle"
                  type="button"
                  aria-label="折叠排队对话"
                  aria-expanded={followUpQueueOpen}
                  title="折叠排队对话"
                  onClick={() => setFollowUpQueueOpen(false)}
                >
                  <CollapseQueueIcon />
                </button>
              </div>
              <div className="follow-up-queue-list">
              {visibleQueuedFollowUps.map((item, index) => (
                <div className="follow-up-queue-item" key={item.id}>
                  <span className="follow-up-queue-content">{item.content || "图片消息"}</span>
                  {item.attachments?.length ? <span className="follow-up-queue-meta">{item.attachments.length} 张图片</span> : null}
                  <button
                    className="follow-up-queue-icon-button follow-up-remove-button"
                    type="button"
                    aria-label={`删除第 ${index + 1} 条排队对话：${formatFollowUpActionLabel(item)}`}
                    title={`删除第 ${index + 1} 条排队对话`}
                    onClick={() => removeChatFollowUp(activeSession.id, item.id)}
                  >
                    <DeleteFollowUpIcon />
                    </button>
                  <button
                    className="follow-up-queue-icon-button follow-up-guide-button"
                    type="button"
                    aria-label={`引导第 ${index + 1} 条排队对话：${formatFollowUpActionLabel(item)}`}
                    title={`引导第 ${index + 1} 条排队对话`}
                    onClick={() => guideChatFollowUp(activeSession.id, item.id)}
                  >
                    <GuideFollowUpIcon />
                    </button>
                  </div>
                ))}
              </div>
            </>
          ) : nextFollowUp ? (
            <div className="follow-up-queue-preview" aria-label="下一条排队对话">
              <span className="follow-up-queue-content">{nextFollowUp.content || "图片消息"}</span>
              {nextFollowUp.attachments?.length ? <span className="follow-up-queue-meta">{nextFollowUp.attachments.length} 张图片</span> : null}
              <button
                className="follow-up-queue-icon-button follow-up-remove-button"
                type="button"
                aria-label={`删除下一条排队对话：${formatFollowUpActionLabel(nextFollowUp)}`}
                title="删除下一条排队对话"
                onClick={() => removeChatFollowUp(activeSession.id, nextFollowUp.id)}
              >
                <DeleteFollowUpIcon />
              </button>
              <button
                className="follow-up-queue-icon-button follow-up-guide-button"
                type="button"
                aria-label={`引导下一条排队对话：${formatFollowUpActionLabel(nextFollowUp)}`}
                title="引导下一条排队对话"
                onClick={() => guideChatFollowUp(activeSession.id, nextFollowUp.id)}
              >
                <GuideFollowUpIcon />
              </button>
              <button
                className="follow-up-queue-icon-button follow-up-queue-toggle"
                type="button"
                aria-label="展开排队对话"
                aria-expanded={followUpQueueOpen}
                title="展开排队对话"
                onClick={() => setFollowUpQueueOpen(true)}
              >
                <ExpandQueueIcon />
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
      {attachments.length > 0 ? (
        <div className="image-preview-strip" aria-label="已添加图片">
          {attachments.map((attachment) => (
            <div className="image-preview-thumb-wrap" key={attachment.id}>
              <button className="image-preview-thumb" type="button" aria-label={`查看图片 ${attachment.name}`} onClick={() => setPreviewAttachment(attachment)}>
                <img src={attachment.dataUrl} alt="" />
              </button>
              <button
                className="image-preview-remove"
                type="button"
                aria-label={`删除图片 ${attachment.name}`}
                title="删除图片"
                onClick={() => setAttachments((current) => current.filter((item) => item.id !== attachment.id))}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      ) : null}
      <div className={contextStripClassName}>
        {sharedContextTabs.length > 0 ? (
          <SharedContextBanner
            expanded={sharedBannerOpen}
            tabs={sharedContextTabs}
            onExpandedChange={setSharedBannerOpen}
            onRemove={removeSharedContextTab}
          />
        ) : null}
        <TokenUsageMeter usage={sessionTokenUsage} sending={sending} />
        <button
          className="ui-button-secondary context-view-button"
          type="button"
          onClick={toggleContextDialog}
        >
          选择标签页
        </button>
        <span className="context-chip">{matchedRuleLabel}</span>
        <button className="ui-button-secondary" type="button" onClick={() => void refreshPageContext()}>
          刷新
        </button>
        {currentModelSupportsVision ? (
          <button className="ui-button-secondary" type="button" aria-label="截图当前标签页" title="截取当前标签页可见区域" onClick={() => void handleCaptureVisibleTab()}>
            截图
          </button>
        ) : null}
      </div>
      {pageContext.truncated ? <p className="text-sm text-[var(--color-warning)]">内容已截断，请细化 CSS/XPath</p> : null}
      {pageContext.error ? <p className="text-sm text-[var(--color-error)]">{pageContext.error}</p> : null}
      {attachmentError ? <p className="text-sm text-[var(--color-error)]">{attachmentError}</p> : null}
      <div className="chat-input-shell">
        <input
          id={imageInputId}
          className="sr-only"
          type="file"
          accept={ACCEPTED_IMAGE_TYPES.join(",")}
          multiple
          aria-label="上传图片"
          disabled={!currentModelSupportsVision}
          onChange={handleImageInputChange}
        />
        <PromptInlineEditor
          className="ui-input chat-input"
          ariaLabel="对话输入"
          value={input}
          promptInvocations={promptInvocations}
          promptAriaLabelPrefix="已选用任务策略"
          onChange={handleInputChange}
          onRemovePrompt={(index) => setPromptInvocations((current) => current.filter((_, itemIndex) => itemIndex !== index))}
          onPaste={handlePaste}
          onKeyDown={handleInputKeyDown}
          onCompositionStart={() => setComposing(true)}
          onCompositionEnd={(value) => {
            setComposing(false);
            handleInputChange(value, { forceSlashDetection: true });
          }}
        />
        {slashMenuOpen ? (
          <div className="slash-command-menu" role="listbox" aria-label="任务策略命令">
            {filteredSkillPlaybooks.length > 0 ? (
              filteredSkillPlaybooks.map((playbook, index) => (
                <button
                  key={playbook.id}
                  className={index === slashActiveIndex ? "slash-command-option slash-command-option-active" : "slash-command-option"}
                  type="button"
                  role="option"
                  aria-selected={index === slashActiveIndex}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => handleSelectSkillPlaybook(playbook)}
                >
                  <span className="slash-command-title">{playbook.title}</span>
                  <span className="slash-command-content">{playbook.description}</span>
                </button>
              ))
            ) : (
              <p className="slash-command-empty">未找到已启用的任务策略</p>
            )}
          </div>
        ) : null}
        <div className="composer-actions">
          <button
            className="composer-switch sidepanel-add-tab-button"
            type="button"
            aria-label="添加标签页"
            title="添加标签页"
            onClick={toggleContextDialog}
          >
            <svg className="composer-switch-icon" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M12 5v14M5 12h14" />
            </svg>
          </button>
          <button
            className="composer-switch sidepanel-tools-toggle"
            type="button"
            aria-label="工具"
            aria-expanded={toolShelfOpen}
            aria-controls="composer-switches"
            title="工具"
            onClick={toggleToolShelf}
          >
            <svg className="composer-switch-icon" viewBox="0 0 24 24" aria-hidden="true">
              <path d={TOOLS_TOGGLE_ICON_PATH} />
            </svg>
          </button>
          <div className="workflow-create-wrap" ref={workflowMenuRef}>
            <button
              ref={workflowMenuButtonRef}
              className="composer-switch workflow-create-button"
              type="button"
              aria-label="新建任务"
              aria-haspopup="menu"
              aria-expanded={workflowMenuOpen}
              title={syncRestoreBarrierActive ? "正在恢复备份，完成后可新建任务" : !canSend ? "配置可用模型后可新建任务" : sending ? "当前响应结束后可新建任务" : !input.trim() ? "输入任务目标后可新建任务" : "新建任务"}
              disabled={!canSend || sending || !input.trim()}
              onClick={toggleWorkflowMenu}
            >
              <svg className="composer-switch-icon" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M9 6h11M9 12h11M9 18h11" />
                <path d="m4 6 1.2 1.2L7.5 5" />
                <path d="m4 12 1.2 1.2L7.5 11" />
                <path d="m4 18 1.2 1.2L7.5 17" />
              </svg>
            </button>
            {workflowMenuOpen ? <WorkflowTemplateMenu onSelect={(template) => void createWorkflow(template)} /> : null}
          </div>
          <div className="composer-switches" id="composer-switches" data-open={toolShelfOpen}>
            <label
              className={`image-upload-button${currentModelSupportsVision ? "" : " image-upload-button-disabled"}`}
              htmlFor={imageInputId}
              data-label="上传图片"
              title={currentModelSupportsVision ? "上传图片" : "当前模型不支持视觉理解"}
            >
              <span aria-hidden="true">▣</span>
            </label>
            <ComposerSwitch
              ariaLabel={browserControlTitle}
              checked={browserControlEnabled}
              icon="browserControl"
              label="浏览器控制"
              title={browserControlTitle}
              onToggle={() => void setBrowserControlEnabled(!browserControlEnabled)}
            />
            <div className="composer-mode-menu-wrap">
              <button
                ref={modeMenuButtonRef}
                className={`composer-mode-trigger composer-mode-trigger-${effectiveBrowserAutomationMode}`}
                type="button"
                aria-label="浏览器自动化模式"
                aria-haspopup="listbox"
                aria-expanded={modeMenuOpen}
                disabled={!browserControlEnabled}
                title="浏览器自动化模式"
                onClick={toggleModeMenu}
              >
                <svg className="composer-switch-icon composer-mode-trigger-icon" viewBox="0 0 24 24" aria-hidden="true">
                  <path d={browserAutomationModeOption.iconPath} />
                </svg>
                <span className="composer-mode-trigger-label">{browserAutomationModeLabel}</span>
                <span className="composer-mode-chevron" aria-hidden="true" />
              </button>
              {modeMenuOpen && browserControlEnabled ? (
                <div
                  ref={modeMenuRef}
                  className="composer-mode-menu"
                  role="listbox"
                  aria-label="浏览器自动化模式"
                  style={modeMenuPosition ? { left: modeMenuPosition.left, top: modeMenuPosition.top } : undefined}
                >
                  <div className="composer-mode-menu-header">
                    <span>选择浏览器自动化模式</span>
                    <span>本轮生效</span>
                  </div>
                  {BROWSER_AUTOMATION_MODE_OPTIONS.map((option) => (
                    <button
                      key={option.mode}
                      className={`composer-mode-option composer-mode-option-${option.mode}`}
                      type="button"
                      role="option"
                      aria-selected={option.mode === effectiveBrowserAutomationMode}
                      onClick={() => {
                        setModeMenuOpen(false);
                        void setBrowserAutomationMode(option.mode);
                      }}
                    >
                      <svg className="composer-mode-option-icon" viewBox="0 0 24 24" aria-hidden="true">
                        <path d={option.iconPath} />
                      </svg>
                      <span className="composer-mode-option-copy">
                        <span className="composer-mode-option-title">{option.label}</span>
                        <span className="composer-mode-option-description">{option.description}</span>
                      </span>
                      <span className="composer-mode-option-check" aria-hidden="true">
                        {option.mode === effectiveBrowserAutomationMode ? "✓" : ""}
                      </span>
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
            <ComposerSwitch ariaLabel="流式响应" checked={streamMode} icon="stream" label="流式响应" onToggle={() => setStreamMode(!streamMode)} />
            <ComposerSwitch
              ariaLabel="拼接上下文"
              checked={appendPageContextToSystemPrompt}
              icon="appendContext"
              label="拼接上下文"
              onToggle={() => setAppendPageContextToSystemPrompt(!appendPageContextToSystemPrompt)}
            />
            <ComposerSwitch
              ariaLabel="提取模式"
              checked={contextMode === "all"}
              icon={contextMode === "all" ? "extractAll" : "extractText"}
              label={contextModeLabel}
              title={contextModeLabel}
              onToggle={() => setContextMode(contextMode === "all" ? "text" : "all")}
            />
          </div>
          <span className="sidepanel-footer-spacer" aria-hidden="true" />
          <ModelSelector />
          <button
            className={sending && !hasDraft ? "ui-button-primary composer-abort-button" : "ui-button-primary"}
            type="button"
            data-sending={sending && !hasDraft ? "true" : "false"}
            data-stop-generation={sending && !hasDraft ? "true" : "false"}
            disabled={syncRestoreBarrierActive || (sending ? false : !canSubmit)}
            title={syncRestoreBarrierActive ? "正在恢复备份，完成后可发送" : undefined}
            onClick={() => {
              if (sending && !hasDraft) {
                stopGeneration();
                return;
              }
              void (sending ? submitFollowUp() : submit());
            }}
          >
            {submitButtonLabel}
          </button>
          {stopStatusText ? (
            <span className="sr-only" role="status" aria-live="polite">
              {stopStatusText}
            </span>
          ) : null}
        </div>
      </div>
      {previewAttachment ? (
        <>
          <div className="dialog-overlay" aria-hidden="true" />
          <section ref={imagePreviewDialogRef} className="image-preview-dialog" role="dialog" aria-modal="true" aria-label="图片预览" tabIndex={-1}>
            <button ref={imagePreviewCloseRef} className="ui-button-secondary image-preview-close" type="button" aria-label="关闭图片预览" onClick={() => setPreviewAttachment(undefined)} />
            <img src={previewAttachment.dataUrl} alt={previewAttachment.name} />
          </section>
        </>
      ) : null}
      {contextDialogOpen ? (
        <>
          <div className="dialog-overlay" aria-hidden="true" onClick={() => setContextDialogOpen(false)} />
          <section
            ref={contextDialogRef}
            className="context-dialog"
            role="dialog"
            aria-modal="true"
            aria-busy={contextDialogBusy || undefined}
            aria-labelledby="context-dialog-title"
          >
            <div className="context-dialog-header">
              <h2 className="context-dialog-title" id="context-dialog-title">
                选择注入标签页
              </h2>
              <button ref={contextCloseButtonRef} className="ui-button-secondary context-dialog-close" type="button" aria-label="关闭标签页选择" onClick={() => setContextDialogOpen(false)}>
                关闭
              </button>
            </div>
            <p className="sidepanel-preview-notice">选择要分享给 AI 的标签页</p>
            <div className="context-tab-list" aria-label="可注入标签页">
              {contextTabsLoading && contextTabs.length === 0 ? <p className="context-tab-empty">正在读取标签页...</p> : null}
              {contextTabsError ? <p className="context-tab-error">{contextTabsError}</p> : null}
              {!contextTabsLoading && contextTabs.length === 0 ? <p className="context-tab-empty">暂无可注入的普通网页标签页</p> : null}
              {contextTabs.map((tab) => (
                <button
                  key={tab.tabId}
                  className={[
                    "context-tab-item",
                    tab.active ? "sidepanel-current-tab-row" : "",
                    tab.selected ? "context-tab-item-active" : "",
                    tab.loading ? "is-loading" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  type="button"
                  aria-pressed={tab.selected}
                  aria-busy={tab.loading || undefined}
                  aria-label={`注入 ${tab.title}`}
                  onClick={() => toggleContextTabSelection(tab.tabId)}
                >
                  <BannerFavicon src={tab.favIconUrl} className="sidepanel-tab-favicon" />
                  <span className="context-tab-title-row">
                    <span className="context-tab-title">{tab.title}</span>
                    {tab.active ? <span className="context-tab-active-badge">当前</span> : null}
                  </span>
                  {tab.selected ? <span className="context-tab-selected-badge">注入</span> : null}
                  <span className="context-tab-url">{tab.url}</span>
                  {tab.error ? <span className="context-tab-error">{tab.error}</span> : null}
                </button>
              ))}
            </div>
            <div className="context-tab-list-scrollbar" aria-hidden="true">
              <div className="context-tab-list-scrollbar-thumb" />
            </div>
            <p className="context-preview">{pageContext.text || "暂无上下文"}</p>
          </section>
        </>
      ) : null}
      {pendingBoundaryChoice ? (
        <BoundaryChoiceDialog
          request={pendingBoundaryChoice}
          onSubmit={(selectedChoiceIds, otherText) => void respondBoundaryChoice(pendingBoundaryChoice.requestId, selectedChoiceIds, otherText)}
        />
      ) : null}
    </section>
  );
}

function SharedContextBanner({
  expanded,
  tabs,
  onExpandedChange,
  onRemove,
}: {
  expanded: boolean;
  tabs: SharedContextTab[];
  onExpandedChange: (expanded: boolean) => void;
  onRemove: (tab: SharedContextTab) => void;
}) {
  const isMulti = tabs.length > 1;
  if (!isMulti) {
    const only = tabs[0];
    return (
      <div className="sidepanel-page-banner">
        <BannerFavicon src={only.favIconUrl} className="sidepanel-page-banner-favicon" />
        <span className="sidepanel-page-banner-text">{`正在分享“${only.title}”标签页`}</span>
        <button className="sidepanel-page-banner-close" type="button" aria-label="移除该标签页" onClick={() => onRemove(only)}>
          ×
        </button>
      </div>
    );
  }

  return (
    <div className={expanded ? "sidepanel-page-banner is-multi is-open" : "sidepanel-page-banner is-multi"} aria-expanded={expanded}>
      <button
        className="sidepanel-page-banner-header"
        type="button"
        aria-expanded={expanded}
        onClick={() => onExpandedChange(!expanded)}
      >
        <span className="sidepanel-page-banner-stack" aria-hidden="true">
          {tabs.slice(0, 2).map((tab) => (
            <BannerFavicon key={`${tab.tabId ?? tab.url}-${tab.title}`} src={tab.favIconUrl} className="sidepanel-page-banner-favicon" />
          ))}
        </span>
        <span className="sidepanel-page-banner-text">{`正在分享 ${tabs.length} 个标签页`}</span>
        <svg className="sidepanel-page-banner-chevron" viewBox="0 0 24 24" aria-hidden="true">
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>
      <div className="sidepanel-shared-drawer">
        <div className="sidepanel-shared-drawer-inner">
          {tabs.map((tab) => (
            <div key={`${tab.tabId ?? tab.url}-${tab.title}`} className={tab.active ? "sidepanel-shared-row is-current" : "sidepanel-shared-row"}>
              <span className="sidepanel-shared-row-leading" aria-hidden="true">
                <BannerFavicon src={tab.favIconUrl} className="sidepanel-shared-row-favicon" />
              </span>
              <span className="sidepanel-shared-row-text">
                <span className="sidepanel-shared-row-title">{tab.title}</span>
                {formatSharedTabSubtitle(tab.url, tab.title) ? (
                  <span className="sidepanel-shared-row-subtitle">{formatSharedTabSubtitle(tab.url, tab.title)}</span>
                ) : null}
              </span>
              <button
                className="sidepanel-shared-row-remove"
                type="button"
                aria-label={`移除 ${tab.title}`}
                onClick={(event) => {
                  event.stopPropagation();
                  onRemove(tab);
                }}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function BannerFavicon({ className, src }: { className: string; src?: string }) {
  return <img className={className} src={src || undefined} alt="" hidden={!src} />;
}

function buildSharedContextTabs(
  contextTabs: ContextTabCandidate[],
  pageContext: { loading: boolean; title?: string; url?: string; text: string },
  pageContextKey: string,
  dismissedPageContextKey?: string,
): SharedContextTab[] {
  const selectedTabs = contextTabs
    .filter((tab) => tab.selected)
    .map((tab) => ({
      active: tab.active,
      favIconUrl: tab.favIconUrl,
      selected: tab.selected,
      tabId: tab.tabId,
      title: tab.title || formatPageContextTitle(tab.url),
      url: tab.url,
    }));

  if (selectedTabs.length > 0) {
    return selectedTabs;
  }

  const hasPageContext = pageContext.loading || Boolean(pageContext.text.trim() || pageContext.title?.trim() || pageContext.url?.trim());
  if (!hasPageContext || dismissedPageContextKey === pageContextKey) {
    return [];
  }

  return [
    {
      active: true,
      pageContextKey,
      selected: true,
      title: pageContext.title?.trim() || formatPageContextTitle(pageContext.url),
      url: pageContext.url ?? "",
    },
  ];
}

function formatPageContextTitle(url?: string): string {
  if (!url) {
    return "当前页面";
  }
  try {
    return new URL(url).hostname || "当前页面";
  } catch {
    return "当前页面";
  }
}

function formatSharedTabSubtitle(url: string, title: string): string {
  if (!url) {
    return "";
  }
  try {
    const parsed = new URL(url);
    const path = `${parsed.pathname || ""}${parsed.search || ""}${parsed.hash || ""}`;
    const subtitle = `${parsed.host}${path && path !== "/" ? path : ""}`.slice(0, 96);
    return subtitle && subtitle !== title ? subtitle : "";
  } catch {
    const subtitle = url.slice(0, 96);
    return subtitle !== title ? subtitle : "";
  }
}

function TokenUsageMeter({ usage, sending }: { usage: ChatTokenUsage; sending: boolean }) {
  const hasUsage = hasTokenUsage(usage);
  return (
    <div className={`token-usage-meter${hasUsage ? "" : " token-usage-meter-empty"}`} aria-label="当前会话 Token 用量" title="当前会话 Token 用量">
      {hasUsage ? (
        <>
          <span>输入 {formatTokenCount(usage.inputTokens)}</span>
          <span>输出 {formatTokenCount(usage.outputTokens)}</span>
          <span>写入 {formatTokenCount(usage.cacheWriteTokens)}</span>
          <span>读取 {formatTokenCount(usage.cacheReadTokens)}</span>
        </>
      ) : (
        <span>{sending ? "Token 统计中" : "Token 暂无"}</span>
      )}
    </div>
  );
}

function formatTokenCount(value: number): string {
  if (value >= TOKEN_MEGA_THRESHOLD) {
    return `${trimTokenNumber(value / TOKEN_MEGA_THRESHOLD)}M`;
  }
  if (value >= TOKEN_KILO_THRESHOLD) {
    return `${trimTokenNumber(value / TOKEN_KILO_THRESHOLD)}k`;
  }
  return String(Math.max(0, Math.floor(value)));
}

function trimTokenNumber(value: number): string {
  return value >= 10 ? value.toFixed(0) : value.toFixed(1).replace(/\.0$/, "");
}

function getPastedImageFiles(clipboardData: DataTransfer): File[] {
  const itemFiles = Array.from(clipboardData.items ?? [])
    .filter((item) => item.kind === "file" && item.type.startsWith("image/"))
    .map((item) => item.getAsFile())
    .filter((file): file is File => Boolean(file));
  if (itemFiles.length > 0) {
    return itemFiles;
  }

  return Array.from(clipboardData.files ?? []).filter((file) => file.type.startsWith("image/"));
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : "");
    reader.onerror = () => reject(reader.error ?? new Error("图片读取失败"));
    reader.readAsDataURL(file);
  });
}

function estimateDataUrlBytes(dataUrl: string): number {
  const base64 = dataUrl.split(",", 2)[1] ?? "";
  const paddingBytes = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor((base64.length * 3) / 4) - paddingBytes);
}

function findSlashCommand(value: string): { startIndex: number; query: string } | undefined {
  const startIndex = value.lastIndexOf("/");
  if (startIndex < 0) {
    return undefined;
  }

  const query = value.slice(startIndex + 1);
  if (/\s/.test(query)) {
    return undefined;
  }

  return { startIndex, query };
}

export function removeSlashCommandSegment(value: string, fallbackStartIndex?: number): string {
  const slashInfo = findSlashCommand(value);
  const startIndex = slashInfo?.startIndex ?? fallbackStartIndex;
  if (startIndex === undefined || startIndex < 0) {
    return value;
  }

  const afterSlashText = value.slice(startIndex + 1);
  const nextWhitespaceIndex = afterSlashText.search(/\s/);
  const endIndex = nextWhitespaceIndex < 0 ? value.length : startIndex + 1 + nextWhitespaceIndex;
  const before = value.slice(0, startIndex);
  const after = value.slice(endIndex);
  if (!before) {
    return after.replace(/^\s+/, "");
  }
  if (!after) {
    return before.replace(/\s+$/, "");
  }
  if (/\s$/.test(before) && /^\s/.test(after)) {
    return `${before}${after.replace(/^\s+/, "")}`;
  }

  return `${before}${after}`;
}

function filterSkillPlaybooks(playbooks: AutomationPlaybook[], query: string): AutomationPlaybook[] {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) {
    return playbooks;
  }

  return playbooks.filter((playbook) => {
    const searchableText = [
      playbook.id,
      playbook.title,
      playbook.description,
      playbook.tags.join(" "),
      playbook.selectionHints.join(" "),
    ].join("\n").toLowerCase();
    return searchableText.includes(normalizedQuery);
  });
}

function sendRuntimeMessage<T>(message: { type: string }): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    const runtime = globalThis.chrome?.runtime;
    if (!runtime?.sendMessage) {
      reject(new Error("Chrome runtime 不可用"));
      return;
    }

    let settled = false;
    const finish = (response: T | undefined) => {
      if (settled) {
        return;
      }

      settled = true;
      resolve(response);
    };
    const fail = (error: unknown) => {
      if (settled) {
        return;
      }

      settled = true;
      reject(error);
    };

    try {
      // 真实 Chrome 扩展环境可能走 callback 形态；保留 Promise 兼容是为了适配测试环境和不同浏览器实现。
      const maybePromise = runtime.sendMessage(message, (response: T) => {
        const lastError = runtime.lastError;
        if (lastError) {
          fail(new Error(lastError.message));
          return;
        }

        finish(response);
      }) as Promise<T> | undefined;

      if (maybePromise && typeof maybePromise.then === "function") {
        void maybePromise.then(finish).catch(fail);
      }
    } catch (error) {
      fail(error);
    }
  });
}

function isSendShortcut(event: ReactKeyboardEvent<HTMLElement>, shortcut: SendShortcut): boolean {
  if (event.key !== "Enter" || event.nativeEvent.isComposing) {
    return false;
  }

  const modifiers = {
    shiftKey: event.shiftKey,
    ctrlKey: event.ctrlKey,
    altKey: event.altKey,
    metaKey: event.metaKey,
  };

  switch (shortcut) {
    case "enter":
      return !modifiers.shiftKey && !modifiers.ctrlKey && !modifiers.altKey && !modifiers.metaKey;
    case "shift_enter":
      return modifiers.shiftKey && !modifiers.ctrlKey && !modifiers.altKey && !modifiers.metaKey;
    case "ctrl_enter":
      return modifiers.ctrlKey && !modifiers.shiftKey && !modifiers.altKey && !modifiers.metaKey;
    case "alt_enter":
      return modifiers.altKey && !modifiers.shiftKey && !modifiers.ctrlKey && !modifiers.metaKey;
    default:
      return false;
  }
}

function isCtrlShiftEnter(event: ReactKeyboardEvent<HTMLElement>): boolean {
  return event.key === "Enter" && event.ctrlKey && event.shiftKey && !event.altKey && !event.metaKey && !event.nativeEvent.isComposing;
}

function getOppositeFollowUpBehavior(behavior: "queue" | "guide"): "queue" | "guide" {
  return behavior === "queue" ? "guide" : "queue";
}

function formatFollowUpActionLabel(item: ChatFollowUpItem): string {
  const content = item.content.trim() || "图片消息";
  return content.length > 24 ? `${content.slice(0, 24)}...` : content;
}

function ExpandQueueIcon() {
  return (
    <svg aria-hidden="true" focusable="false" viewBox="0 0 24 24">
      <path d="M9 4H4v5" />
      <path d="M15 20h5v-5" />
    </svg>
  );
}

function CollapseQueueIcon() {
  return (
    <svg aria-hidden="true" focusable="false" viewBox="0 0 24 24">
      <path d="M9 9H4V4" />
      <path d="M15 15h5v5" />
    </svg>
  );
}

function DeleteFollowUpIcon() {
  return (
    <svg aria-hidden="true" focusable="false" viewBox="0 0 24 24">
      <path d="M7 7l10 10" />
      <path d="M17 7 7 17" />
    </svg>
  );
}

function GuideFollowUpIcon() {
  return (
    <svg aria-hidden="true" focusable="false" viewBox="0 0 24 24">
      <path d="M5 12h12" />
      <path d="m13 8 4 4-4 4" />
      <path d="M5 6h5" />
      <path d="M5 18h5" />
    </svg>
  );
}
