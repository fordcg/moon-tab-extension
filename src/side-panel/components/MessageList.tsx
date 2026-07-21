import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type AnchorHTMLAttributes, type ImgHTMLAttributes, type RefObject } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { formatNetworkAttachmentSummary, redactNetworkRequestDetail } from "../../shared/networkContext";
import { formatTavilySearchAttachmentSummary } from "../../shared/webSearch/tavily";
import {
  aggregateToolAttachmentGroupByKind,
  collectMessageToolAttachments,
  collectRawMessageToolAttachments,
  formatAutomationReportTypeLabel,
  isAutomationReportToolAttachment,
  isBrowserScreenshotToolAttachment,
  isJsSourceToolAttachment,
  isNetworkToolAttachment,
  isSourceMapToolAttachment,
  isWebSearchToolAttachment,
  sanitizeGenericToolAttachment,
} from "../../shared/toolArtifacts";
import { createChatMessageMarkdown } from "../utils/chatMarkdownExport";
import { copyOrDownloadMessageImage, copyTextToClipboard } from "../utils/messageClipboard";
import type { ChatImageAttachment, ChatMessage, ChatPromptInvocation, ChatToolAttachment, ChatToolCallRecord, ToolCallDisplayMode } from "../../shared/types";
import { MarkdownCodeBlock, MarkdownCodePre } from "./MarkdownCodeBlock";
import { MarkdownTableBlock } from "./MarkdownTableBlock";
import { CopyMessageIcon, ExportImageIcon } from "./MessageActionIcons";
import { PromptInlineEditor, PromptTokenContent } from "./PromptInlineEditor";
import type { ChatRetryProgress } from "../state/appStore";
import { ConversationContinuityPrompt } from "./ConversationContinuityPrompt";
import { useModalDialogFocus } from "./useModalDialogFocus";

const MESSAGE_LIST_BOTTOM_THRESHOLD = 8;
const MESSAGE_POPOVER_VIEWPORT_PADDING = 12;
const MESSAGE_POPOVER_GAP = 6;
const LONG_USER_MESSAGE_CHAR_THRESHOLD = 420;
const LONG_USER_MESSAGE_LINE_THRESHOLD = 8;
interface MessageListProps {
  messages: ChatMessage[];
  retryProgressByMessageId: Record<string, ChatRetryProgress>;
  toolCallDisplayMode: ToolCallDisplayMode;
  showToolCallProcessInAssistantMode: boolean;
  onRegenerateMessage: (messageId: string) => void;
  onEditAndRegenerateUserMessage: (messageId: string, content: string, promptInvocations?: ChatPromptInvocation[]) => void;
  regenerating: boolean;
}

function positionAnchoredMessagePopover(
  popover: HTMLElement,
  anchor: Element,
  options: { align?: "left" | "right"; maxWidth?: number } = {},
) {
  const anchorRect = anchor.getBoundingClientRect();
  const composerTop = document.querySelector(".chat-composer")?.getBoundingClientRect().top ?? window.innerHeight;
  const bottomLimit = Math.max(MESSAGE_POPOVER_VIEWPORT_PADDING, composerTop - 8);
  const width = Math.max(
    180,
    Math.min(options.maxWidth ?? 448, window.innerWidth - MESSAGE_POPOVER_VIEWPORT_PADDING * 2),
  );

  popover.classList.add("sidepanel-positioned-popover");
  popover.style.width = `${width}px`;

  let left = options.align === "right" ? anchorRect.right - width : anchorRect.left;
  left = Math.min(
    Math.max(MESSAGE_POPOVER_VIEWPORT_PADDING, left),
    window.innerWidth - width - MESSAGE_POPOVER_VIEWPORT_PADDING,
  );

  const popoverHeight = popover.getBoundingClientRect().height;
  const belowTop = anchorRect.bottom + MESSAGE_POPOVER_GAP;
  const aboveTop = anchorRect.top - popoverHeight - MESSAGE_POPOVER_GAP;
  let top = belowTop;

  if (belowTop + popoverHeight > bottomLimit && aboveTop >= MESSAGE_POPOVER_VIEWPORT_PADDING) {
    top = aboveTop;
  } else if (belowTop + popoverHeight > bottomLimit) {
    top = Math.max(MESSAGE_POPOVER_VIEWPORT_PADDING, bottomLimit - popoverHeight);
  }

  popover.style.left = `${Math.round(left)}px`;
  popover.style.top = `${Math.round(top)}px`;
}

function resetAnchoredMessagePopover(popover?: HTMLElement | null) {
  if (!popover) {
    return;
  }

  popover.classList.remove("sidepanel-positioned-popover");
  popover.style.left = "";
  popover.style.top = "";
  popover.style.width = "";
}

function positionOpenMessagePopovers(regeneratePopover?: HTMLElement | null, toolCallPopover?: HTMLElement | null) {
  if (regeneratePopover) {
    const action = regeneratePopover.closest(".message-regenerate-action");
    if (action) {
      positionAnchoredMessagePopover(regeneratePopover, action, {
        align: action.classList.contains("message-regenerate-action-user") ? "right" : "left",
        maxWidth: 224,
      });
    } else {
      resetAnchoredMessagePopover(regeneratePopover);
    }
  }

  if (toolCallPopover) {
    const row = toolCallPopover.closest(".message-tool-call-row");
    const trigger = row?.querySelector(".message-tool-call-trigger");
    if (trigger) {
      positionAnchoredMessagePopover(toolCallPopover, trigger, { align: "left", maxWidth: 448 });
    } else {
      resetAnchoredMessagePopover(toolCallPopover);
    }
  }
}

export function MessageList({
  messages,
  retryProgressByMessageId,
  toolCallDisplayMode,
  showToolCallProcessInAssistantMode,
  onRegenerateMessage,
  onEditAndRegenerateUserMessage,
  regenerating,
}: MessageListProps) {
  const [previewAttachment, setPreviewAttachment] = useState<ChatImageAttachment | undefined>();
  const [pendingRegenerateMessageId, setPendingRegenerateMessageId] = useState<string | undefined>();
  const [editingMessageId, setEditingMessageId] = useState<string | undefined>();
  const [editingContent, setEditingContent] = useState("");
  const [editingPromptInvocations, setEditingPromptInvocations] = useState<ChatPromptInvocation[]>([]);
  const [expandedLongMessageIds, setExpandedLongMessageIds] = useState<Set<string>>(() => new Set());
  const [messageActionFeedback, setMessageActionFeedback] = useState<{ messageId: string; text: string; tone: "success" | "error" } | undefined>();
  const [activeToolCallId, setActiveToolCallId] = useState<string | undefined>();
  const [showJumpLatest, setShowJumpLatest] = useState(false);
  const messageListRef = useRef<HTMLElement>(null);
  // 初次进入会话时默认贴底；一旦用户主动上滚，滚动事件会把它改为 false，避免后续更新抢回底部。
  const shouldStickToBottomRef = useRef(true);
  // 记录已见过的最新用户消息 id：新提问入列时强制贴底，即使用户之前上滚过历史。
  const lastSeenUserMessageIdRef = useRef<string | undefined>(undefined);
  const regeneratePopoverRef = useRef<HTMLDivElement>(null);
  const toolCallPopoverRef = useRef<HTMLDivElement>(null);
  const regenerateTimerRef = useRef<number | undefined>(undefined);
  const previewDialogRef = useRef<HTMLElement>(null);
  const previewCloseRef = useRef<HTMLButtonElement>(null);
  const closePreview = useCallback(() => setPreviewAttachment(undefined), []);
  const displayAttachmentGroups = useMemo(
    () => createDisplayAttachmentGroups(messages, toolCallDisplayMode),
    [messages, toolCallDisplayMode],
  );
  // Only keep the bottom "正在思考" placeholder while waiting for the first visible
  // assistant output of the current turn. If any assistant bubble/thinking is already
  // on screen after the latest user message, the placeholder is misplaced.
  const showThinkingPlaceholder = useMemo(() => {
    if (!regenerating) {
      return false;
    }

    let lastUserIndex = -1;
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      if (messages[index]?.role === "user") {
        lastUserIndex = index;
        break;
      }
    }

    for (let index = lastUserIndex + 1; index < messages.length; index += 1) {
      const message = messages[index];
      if (message?.role !== "assistant") {
        continue;
      }
      const isToolCallTurn = message.assistantMessageKind === "tool_call_turn";
      const hideToolTurnContent = shouldHideToolTurnContent(message, toolCallDisplayMode);
      const hasVisibleContent = Boolean(message.content.trim()) && !hideToolTurnContent;
      const hasVisibleThinking = Boolean(message.thinking?.trim()) && !isToolCallTurn && !hideToolTurnContent;
      if (hasVisibleContent || hasVisibleThinking) {
        return false;
      }
    }

    return true;
  }, [messages, regenerating, toolCallDisplayMode]);

  useModalDialogFocus({
    dialogRef: previewDialogRef,
    initialFocusRef: previewCloseRef,
    onEscape: closePreview,
    open: Boolean(previewAttachment),
  });

  const handleMessageListScroll = () => {
    const messageList = messageListRef.current;
    if (!messageList) {
      return;
    }

    const atBottom = isMessageListAtBottom(messageList);
    shouldStickToBottomRef.current = atBottom;
    setShowJumpLatest(!atBottom && messages.length > 0);
  };

  useLayoutEffect(() => {
    const messageList = messageListRef.current;
    if (!messageList) {
      return;
    }

    const latestUserMessageId = findLatestUserMessageId(messages);
    if (latestUserMessageId && latestUserMessageId !== lastSeenUserMessageIdRef.current) {
      // 用户发出新提问后应回到底部，与此前是否上滚历史无关。
      lastSeenUserMessageIdRef.current = latestUserMessageId;
      shouldStickToBottomRef.current = true;
    }

    if (!shouldStickToBottomRef.current) {
      return;
    }

    messageList.scrollTop = messageList.scrollHeight;
    setShowJumpLatest(false);
  }, [displayAttachmentGroups, messages, retryProgressByMessageId, showToolCallProcessInAssistantMode, toolCallDisplayMode]);

  useEffect(() => {
    return () => {
      if (regenerateTimerRef.current !== undefined) {
        window.clearTimeout(regenerateTimerRef.current);
      }
      document.body.classList.remove("sidepanel-regenerate-direct-pending");
    };
  }, []);

  useEffect(() => {
    if (!activeToolCallId) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && !toolCallPopoverRef.current?.contains(target)) {
        setActiveToolCallId(undefined);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setActiveToolCallId(undefined);
      }
    };

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [activeToolCallId]);

  useLayoutEffect(() => {
    if (!pendingRegenerateMessageId && !activeToolCallId) {
      return undefined;
    }

    let frameId = window.requestAnimationFrame(() => {
      positionOpenMessagePopovers(regeneratePopoverRef.current, toolCallPopoverRef.current);
    });
    const updatePosition = () => {
      window.cancelAnimationFrame(frameId);
      frameId = window.requestAnimationFrame(() => {
        positionOpenMessagePopovers(regeneratePopoverRef.current, toolCallPopoverRef.current);
      });
    };

    positionOpenMessagePopovers(regeneratePopoverRef.current, toolCallPopoverRef.current);
    window.addEventListener("scroll", updatePosition, true);
    window.addEventListener("resize", updatePosition);
    return () => {
      window.cancelAnimationFrame(frameId);
      window.removeEventListener("scroll", updatePosition, true);
      window.removeEventListener("resize", updatePosition);
      resetAnchoredMessagePopover(regeneratePopoverRef.current);
      resetAnchoredMessagePopover(toolCallPopoverRef.current);
    };
  }, [activeToolCallId, pendingRegenerateMessageId]);

  useEffect(() => {
    if (!messageActionFeedback) {
      return;
    }

    const timeoutId = window.setTimeout(() => setMessageActionFeedback(undefined), 1800);
    return () => window.clearTimeout(timeoutId);
  }, [messageActionFeedback]);

  const handleCopyMessage = async (message: ChatMessage) => {
    try {
      await copyTextToClipboard(createChatMessageMarkdown(message));
      setMessageActionFeedback({ messageId: message.id, text: "已复制", tone: "success" });
    } catch (error) {
      setMessageActionFeedback({ messageId: message.id, text: error instanceof Error ? error.message : "复制失败，请重试", tone: "error" });
    }
  };

  const handleExportMessageImage = async (message: ChatMessage) => {
    try {
      const result = await copyOrDownloadMessageImage(createChatMessageMarkdown(message));
      setMessageActionFeedback({ messageId: message.id, text: result === "copied" ? "图片已复制" : "图片已下载", tone: "success" });
    } catch {
      setMessageActionFeedback({ messageId: message.id, text: "导出图片失败，请重试", tone: "error" });
    }
  };
  const toggleLongMessageExpanded = (messageId: string) => {
    setExpandedLongMessageIds((current) => {
      const next = new Set(current);
      if (next.has(messageId)) {
        next.delete(messageId);
      } else {
        next.add(messageId);
      }
      return next;
    });
  };

  const handleRegenerateMessageClick = (messageId: string) => {
    if (regenerateTimerRef.current !== undefined) {
      window.clearTimeout(regenerateTimerRef.current);
    }

    setPendingRegenerateMessageId(messageId);
    document.body.classList.add("sidepanel-regenerate-direct-pending");
    regenerateTimerRef.current = window.setTimeout(() => {
      regenerateTimerRef.current = undefined;
      setPendingRegenerateMessageId(undefined);
      document.body.classList.remove("sidepanel-regenerate-direct-pending");
      onRegenerateMessage(messageId);
    }, 0);
  };

  const jumpToLatestMessage = () => {
    const messageList = messageListRef.current;
    if (!messageList) {
      return;
    }

    shouldStickToBottomRef.current = true;
    setShowJumpLatest(false);
    const reducedMotion = typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const top = Math.max(0, messageList.scrollHeight - messageList.clientHeight);
    if (typeof messageList.scrollTo === "function") {
      messageList.scrollTo({ top, behavior: reducedMotion ? "auto" : "smooth" });
    } else {
      messageList.scrollTop = top;
    }
    // Keep the jump control in sync even when smooth scrolling is still in progress.
    window.requestAnimationFrame(() => {
      const current = messageListRef.current;
      if (!current) {
        return;
      }
      setShowJumpLatest(!isMessageListAtBottom(current) && messages.length > 0);
    });
  };

  if (messages.length === 0) {
    return (
      <div className="message-list-shell">
        <section aria-label="消息列表" className="message-list" ref={messageListRef} onScroll={handleMessageListScroll}>
          <div className="sidepanel-empty-state" aria-label="快捷提问">
            <ConversationContinuityPrompt />
            <div className="sidepanel-empty-copy">
              <p className="sidepanel-empty-hello">你好</p>
              <p className="sidepanel-empty-title">今天需要我做些什么？</p>
            </div>
            <div className="sidepanel-empty-suggestions" aria-label="建议问题">
              <button className="sidepanel-suggestion" type="button">
                你能做些什么？
              </button>
              <button className="sidepanel-suggestion" type="button">
                我可以问哪些类型的问题？
              </button>
              <button className="sidepanel-suggestion" type="button">
                帮我理清思路，解决问题
              </button>
            </div>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="message-list-shell">
      <section aria-label="消息列表" className={showThinkingPlaceholder ? "message-list message-list-thinking" : "message-list"} ref={messageListRef} onScroll={handleMessageListScroll}>
        {messages.map((message) => {
          const isToolCallTurn = message.role === "assistant" && message.assistantMessageKind === "tool_call_turn";
          const toolCallRecords = message.toolCallRecords ?? [];
          const shouldShowToolCallTimeline = shouldShowToolCallTimelineForMessage(message, toolCallDisplayMode, showToolCallProcessInAssistantMode);
          const hideToolTurnContent = shouldHideToolTurnContent(message, toolCallDisplayMode);
          const hasVisibleThinking = message.role === "assistant" && !isToolCallTurn && Boolean(message.thinking) && !hideToolTurnContent;
          const hasVisibleContent = Boolean(message.content.trim()) && !hideToolTurnContent;
          const hasPromptTokens = message.role === "user" && Boolean(message.promptInvocations?.length);
          const shouldRenderMessageBubble = hasVisibleContent || hasPromptTokens;
          const isLongUserMessage = message.role === "user" && shouldRenderMessageBubble && isLongUserMessageContent(message.content);
          const isLongUserMessageExpanded = expandedLongMessageIds.has(message.id);
          const displayAttachments = displayAttachmentGroups.get(message.id) ?? [];
          const retryProgress = message.role === "assistant" ? retryProgressByMessageId[message.id] : undefined;
          const hasVisibleArticle =
            message.role !== "assistant" ||
            !isToolCallTurn ||
            hasVisibleThinking ||
            hasVisibleContent ||
            Boolean(retryProgress) ||
            Boolean(message.attachments?.length) ||
            Boolean(displayAttachments.length);
          const shouldShowPreArticleToolTimeline =
            message.role === "assistant" && toolCallRecords.length > 0 && message.assistantMessageKind !== "tool_call_turn";

          if (!shouldShowPreArticleToolTimeline && !hasVisibleArticle && !shouldShowToolCallTimeline) {
            return null;
          }

          return (
          <div key={message.id} className="message-entry">
            {shouldShowPreArticleToolTimeline ? (
              <ToolCallTimeline
                records={toolCallRecords}
                attachments={collectRawMessageToolAttachments(message)}
                activeToolCallId={activeToolCallId}
                popoverRef={toolCallPopoverRef}
                panelCentered
                onToggle={(recordId) => setActiveToolCallId((current) => (current === recordId ? undefined : recordId))}
              />
            ) : null}
          {hasVisibleArticle ? (
          <article className={message.role === "user" ? "message-row message-row-user" : "message-row"}>
            <span className="sr-only">{message.role === "user" ? "你：" : "AI："}</span>
            <div className="message-avatar" aria-hidden="true">
              {message.role === "user" ? "我" : "AI"}
            </div>
            <div
              className={[
                "message-bubble-wrap",
                isLongUserMessage ? "message-bubble-wrap-long" : "",
                isLongUserMessage && isLongUserMessageExpanded ? "message-bubble-wrap-expanded" : "",
              ]
                .filter(Boolean)
                .join(" ")}
              data-long-expanded={isLongUserMessage ? String(isLongUserMessageExpanded) : undefined}
            >
              {hasVisibleThinking ? (
                <details className="message-thinking" open={shouldOpenThinking(message) || undefined}>
                  <summary>{message.streaming ? "思考中" : "思考过程"}</summary>
                  <p>{message.thinking}</p>
                </details>
              ) : null}
              {message.attachments?.length ? (
                <div className="message-image-preview-strip" aria-label="已发送图片">
                  {message.attachments.map((attachment) => (
                    <button
                      className="image-preview-thumb"
                      type="button"
                      key={attachment.id}
                      aria-label={`查看已发送图片 ${attachment.name}`}
                      onClick={() => setPreviewAttachment(attachment)}
                    >
                      <img src={attachment.dataUrl} alt="" />
                    </button>
                  ))}
                </div>
              ) : null}
              {retryProgress ? <MessageRetryProgress progress={retryProgress} /> : null}
              {editingMessageId === message.id ? (
                <div className="message-edit-panel">
                  <PromptInlineEditor
                    className="ui-input message-edit-input"
                    ariaLabel="编辑用户消息"
                    resetVersion={editingMessageId ? 1 : 0}
                    seedText={editingContent}
                    seedPromptInvocations={editingPromptInvocations}
                    promptAriaLabelPrefix="编辑消息提示词"
                    onChange={(document) => {
                      setEditingContent(document.text);
                      setEditingPromptInvocations(document.promptInvocations);
                    }}
                  />
                  <div className="message-edit-actions">
                    <button
                      className="message-icon-button message-edit-cancel-button"
                      type="button"
                      aria-label="取消编辑"
                      title="取消编辑"
                      onClick={() => {
                        setEditingMessageId(undefined);
                        setEditingContent("");
                        setEditingPromptInvocations([]);
                      }}
                    >
                      <CancelEditIcon />
                    </button>
                    <button
                      className="message-icon-button message-edit-send-button"
                      type="button"
                      aria-label="发送编辑后的消息"
                      title="发送编辑后的消息"
                      disabled={regenerating || (!editingContent.trim() && editingPromptInvocations.length === 0)}
                      onClick={() => {
                        const trimmedContent = editingContent.trim();
                        if (!trimmedContent && editingPromptInvocations.length === 0) {
                          return;
                        }

                        setEditingMessageId(undefined);
                        setEditingContent("");
                        const nextPromptInvocations = editingPromptInvocations;
                        setEditingPromptInvocations([]);
                        onEditAndRegenerateUserMessage(message.id, trimmedContent, nextPromptInvocations);
                      }}
                    >
                      <SendEditedMessageIcon />
                    </button>
                  </div>
                </div>
              ) : shouldRenderMessageBubble ? (
                <div className={`message-bubble${message.role === "user" && message.promptInvocations?.length ? " message-bubble-with-prompts" : ""}`}>
                  {message.role === "user" && message.promptInvocations?.length ? (
                    <PromptTokenLinks prompts={message.promptInvocations} ariaLabelPrefix="用户消息提示词" />
                  ) : null}
                  {hasVisibleContent ? (
                    <ReactMarkdown
                      remarkPlugins={[remarkGfm]}
                      components={{
                        code: MarkdownCodeBlock,
                        pre: MarkdownCodePre,
                        table: MarkdownTableBlock,
                        a: MarkdownLink,
                        img: MarkdownImage,
                      }}
                    >
                      {enhanceMarkdownImageLinks(message.content)}
                    </ReactMarkdown>
                  ) : null}
                </div>
              ) : null}
              {isLongUserMessage && editingMessageId !== message.id ? (
                <button
                  className="message-long-toggle"
                  type="button"
                  aria-label={isLongUserMessageExpanded ? "收起消息" : "展开完整消息"}
                  onClick={() => toggleLongMessageExpanded(message.id)}
                >
                  {isLongUserMessageExpanded ? "收起" : "展开"}
                </button>
              ) : null}
              {message.role === "assistant" ? <ToolAttachmentList attachments={displayAttachments} onPreviewImage={setPreviewAttachment} /> : null}
              {!isToolCallTurn ? (
                <div className={`message-regenerate-action message-regenerate-action-${message.role}`}>
                {message.role === "user" ? (
                  <button
                    className="message-icon-button message-edit-button"
                    type="button"
                    aria-label="编辑消息"
                    title="编辑消息"
                    disabled={regenerating || message.streaming}
                    onClick={() => {
                      setPendingRegenerateMessageId(undefined);
                      setEditingMessageId(message.id);
                      setEditingContent(message.content);
                      setEditingPromptInvocations(message.promptInvocations ?? []);
                    }}
                  >
                    <EditMessageIcon />
                  </button>
                ) : null}
                <button
                  className="message-icon-button message-regenerate-button"
                  type="button"
                  aria-label="重新生成"
                  title="重新生成"
                  disabled={regenerating || message.streaming}
                  onClick={() => handleRegenerateMessageClick(message.id)}
                >
                  <RegenerateIcon />
                </button>
                <button
                  className="message-icon-button message-copy-button"
                  type="button"
                  aria-label={message.role === "user" ? "复制用户消息" : "复制 AI 消息"}
                  title={message.role === "user" ? "复制用户消息" : "复制 AI 消息"}
                  onClick={() => void handleCopyMessage(message)}
                >
                  <CopyMessageIcon />
                </button>
                {message.role === "assistant" ? (
                  <button
                    className="message-icon-button message-export-image-button"
                    type="button"
                    aria-label="导出 AI 消息图片"
                    title="导出 AI 消息图片"
                    onClick={() => void handleExportMessageImage(message)}
                  >
                    <ExportImageIcon />
                  </button>
                ) : null}
                {pendingRegenerateMessageId === message.id ? (
                  <div className="message-regenerate-popover" role="status" aria-live="polite" aria-label="正在重新生成" ref={regeneratePopoverRef}>
                    <p>正在重新生成...</p>
                  </div>
                ) : null}
                {messageActionFeedback?.messageId === message.id ? (
                  <span
                    className={`message-action-feedback message-action-feedback-${messageActionFeedback.tone}`}
                    role={messageActionFeedback.tone === "error" ? "alert" : "status"}
                  >
                    {messageActionFeedback.text}
                  </span>
                ) : null}
                </div>
              ) : null}
            </div>
          </article>
          ) : null}
          {shouldShowToolCallTimeline ? (
              <ToolCallTimeline
                records={toolCallRecords}
                attachments={collectRawMessageToolAttachments(message)}
                activeToolCallId={activeToolCallId}
                popoverRef={toolCallPopoverRef}
              panelCentered
              onToggle={(recordId) => setActiveToolCallId((current) => (current === recordId ? undefined : recordId))}
            />
          ) : null}
          </div>
        );
        })}
        {showThinkingPlaceholder ? (
          <div className="sidepanel-thinking" role="status" aria-live="polite" aria-atomic="true" aria-label="正在思考">
            <span className="sidepanel-thinking-dots" aria-hidden="true" />
            <span className="sidepanel-thinking-text">正在思考</span>
          </div>
        ) : null}
        {previewAttachment ? (
          <>
            <div className="dialog-overlay" aria-hidden="true" onClick={closePreview} />
            <section
              ref={previewDialogRef}
              className="image-preview-dialog"
              role="dialog"
              aria-modal="true"
              aria-label="图片预览"
              tabIndex={-1}
            >
              <button
                ref={previewCloseRef}
                className="ui-button-secondary image-preview-close"
                type="button"
                aria-label="关闭图片预览"
                onClick={closePreview}
              />
              <img src={previewAttachment.dataUrl} alt={previewAttachment.name} />
            </section>
          </>
        ) : null}
      </section>
      <button className="sidepanel-jump-latest" type="button" hidden={!showJumpLatest} onClick={jumpToLatestMessage}>
        跳到最新
      </button>
    </div>
  );
}

function isLongUserMessageContent(content: string): boolean {
  const text = content.trim();
  if (!text) {
    return false;
  }
  return text.length > LONG_USER_MESSAGE_CHAR_THRESHOLD || text.split(/\r\n|\r|\n/).length > LONG_USER_MESSAGE_LINE_THRESHOLD;
}

function isMessageListAtBottom(messageList: HTMLElement): boolean {
  return messageList.scrollHeight - messageList.scrollTop - messageList.clientHeight <= MESSAGE_LIST_BOTTOM_THRESHOLD;
}

function findLatestUserMessageId(messages: ChatMessage[]): string | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role === "user") {
      return message.id;
    }
  }
  return undefined;
}

function MessageRetryProgress({ progress }: { progress: ChatRetryProgress }) {
  return (
    <div className="message-retry-progress" role="status" aria-live="polite">
      <span className="message-retry-progress-dot" aria-hidden="true" />
      <span>{`正在重试 ${progress.currentRetry}/${progress.maxRetries}`}</span>
    </div>
  );
}

function ToolCallTimeline({
  records,
  attachments,
  activeToolCallId,
  popoverRef,
  panelCentered = false,
  onToggle,
}: {
  records: ChatToolCallRecord[];
  attachments: ChatToolAttachment[];
  activeToolCallId?: string;
  popoverRef: RefObject<HTMLDivElement | null>;
  panelCentered?: boolean;
  onToggle: (recordId: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const shouldCollapse = records.length > 5;
  const visibleRecords = shouldCollapse && !expanded ? records.slice(-1) : records;

  return (
    <div className={panelCentered ? "message-tool-call-list message-tool-call-list-panel-centered" : "message-tool-call-list"} aria-label="工具调用记录">
      {shouldCollapse ? (
        <button className="message-tool-call-collapse-toggle" type="button" onClick={() => setExpanded((value) => !value)}>
          {expanded ? "收起工具调用" : `展开全部工具调用（共 ${records.length} 次）`}
        </button>
      ) : null}
      {visibleRecords.map((record) => {
        const completed = record.status !== "running";
        const relatedAttachments = attachments.filter((attachment) => record.attachmentIds?.includes(attachment.id) || attachment.sourceToolCallId === record.id);
        return (
          <div key={record.id} className="message-tool-call-row">
            <button
              className="message-tool-call-trigger"
              type="button"
              disabled={!completed}
              aria-disabled={!completed}
              aria-expanded={activeToolCallId === record.id}
              onClick={() => completed && onToggle(record.id)}
            >
              {formatToolCallLine(record)}
            </button>
            {activeToolCallId === record.id && completed ? (
              <div className="message-tool-call-popover" role="dialog" aria-label={`${record.displayName} 调用详情`} ref={popoverRef}>
                <dl>
                  <div>
                    <dt>工具</dt>
                    <dd>{record.displayName}</dd>
                  </div>
                  <div>
                    <dt>状态</dt>
                    <dd>{record.status === "success" ? "已完成" : "失败"}</dd>
                  </div>
                  <div>
                    <dt>耗时</dt>
                    <dd>{formatToolDuration(record)}</dd>
                  </div>
                  <div>
                    <dt>参数</dt>
                    <dd>
                      <pre>{JSON.stringify(record.arguments, null, 2)}</pre>
                    </dd>
                  </div>
                  <div>
                    <dt>{record.status === "error" ? "错误" : "结果"}</dt>
                    <dd>
                      <ToolResultText text={record.errorMessage || record.resultSummary || "工具没有返回可展示摘要"} />
                    </dd>
                  </div>
                  {relatedAttachments.length ? (
                    <div>
                      <dt>附件</dt>
                      <dd>{relatedAttachments.map((attachment) => attachment.title).join("、")}</dd>
                    </div>
                  ) : null}
                </dl>
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function ToolAttachmentList({ attachments, onPreviewImage }: { attachments: ChatToolAttachment[]; onPreviewImage: (attachment: ChatImageAttachment) => void }) {
  if (attachments.length === 0) {
    return null;
  }

  return (
    <>
      {attachments.map((attachment) => (
        <ToolAttachmentView key={attachment.id} attachment={attachment} onPreviewImage={onPreviewImage} />
      ))}
    </>
  );
}

function createDisplayAttachmentGroups(messages: ChatMessage[], toolCallDisplayMode: ToolCallDisplayMode): Map<string, ChatToolAttachment[]> {
  const groups = new Map<string, ChatToolAttachment[]>();
  let lastAssistantBubbleMessageId: string | undefined;
  for (const message of messages) {
    const isAssistant = message.role === "assistant";
    const isToolCallTurn = isAssistant && message.assistantMessageKind === "tool_call_turn";
    const hideToolTurnContent = shouldHideToolTurnContent(message, toolCallDisplayMode);
    const hasVisibleAssistantBubble = isAssistant && Boolean(message.content.trim()) && !hideToolTurnContent;
    const attachments = isAssistant ? collectRawMessageToolAttachments(message) : [];
    const targetMessageId = isToolCallTurn && !hasVisibleAssistantBubble && attachments.length > 0 && lastAssistantBubbleMessageId ? lastAssistantBubbleMessageId : message.id;

    if (attachments.length > 0) {
      groups.set(targetMessageId, aggregateDisplayAttachmentsByKind([...(groups.get(targetMessageId) ?? []), ...attachments]));
    }
    if (hasVisibleAssistantBubble) {
      lastAssistantBubbleMessageId = message.id;
    }
  }
  return groups;
}

export function aggregateDisplayAttachmentsByKind(attachments: ChatToolAttachment[]): ChatToolAttachment[] {
  const groups = new Map<string, ChatToolAttachment[]>();
  const order: string[] = [];
  for (const attachment of attachments) {
    if (isBrowserScreenshotToolAttachment(attachment)) {
      const key = `${attachment.kind}:${attachment.id}`;
      groups.set(key, [attachment]);
      order.push(key);
      continue;
    }
    if (!groups.has(attachment.kind)) {
      groups.set(attachment.kind, []);
      order.push(attachment.kind);
    }
    groups.get(attachment.kind)?.push(attachment);
  }

  return order.map((kind) => aggregateDisplayAttachmentKindGroup(kind.split(":")[0] ?? kind, groups.get(kind) ?? [])).filter((attachment): attachment is ChatToolAttachment => Boolean(attachment));
}

function aggregateDisplayAttachmentKindGroup(kind: string, attachments: ChatToolAttachment[]): ChatToolAttachment | undefined {
  if (attachments.length === 0) {
    return undefined;
  }

  if (kind === "network") {
    if (attachments.length === 1) {
      return attachments[0];
    }
    const networkAttachments = attachments.filter(isNetworkToolAttachment);
    const allFullAccessRaw = networkAttachments.every((attachment) => attachment.fullAccess === true && attachment.redacted === false);
    const canShowUnredacted = allFullAccessRaw || (networkAttachments.length === 1 && networkAttachments[0]?.redacted === false);
    const requests = uniqueDisplayItems(
      networkAttachments.flatMap((attachment) => canShowUnredacted
        ? attachment.requests
        : attachment.requests.map(redactNetworkRequestDetail)),
      (request) => request.id.trim() || `${request.method}\u0000${request.url}\u0000${request.status ?? ""}`,
    );
    return {
      id: `message-display-network-${attachments.map((attachment) => attachment.id).join("-")}`,
      kind: "network",
      title: "Network 请求详情",
      summary: formatNetworkAttachmentSummary(requests),
      createdAt: getMaxCreatedAt(networkAttachments),
      redacted: !canShowUnredacted,
      fullAccess: allFullAccessRaw || undefined,
      truncated: networkAttachments.some((attachment) => attachment.truncated || attachment.requests.some((request) => request.truncated)),
      requests,
    };
  }

  if (kind === "web-search") {
    if (attachments.length === 1) {
      return attachments[0];
    }
    const webSearchAttachments = attachments.filter(isWebSearchToolAttachment);
    const first = webSearchAttachments[0];
    if (!first) {
      return attachments[0];
    }
    const results = uniqueDisplayItems(
      webSearchAttachments.flatMap((attachment) => attachment.results),
      (result) => result.url.trim() || result.title.trim(),
    );
    const aggregated = {
      ...first,
      id: `message-display-web-search-${attachments.map((attachment) => attachment.id).join("-")}`,
      query: [...new Set(webSearchAttachments.map((attachment) => attachment.query).filter(Boolean))].join("；"),
      answer: webSearchAttachments.map((attachment) => attachment.answer).filter(Boolean).join("\n\n") || undefined,
      results,
      createdAt: getMaxCreatedAt(webSearchAttachments),
      truncated: webSearchAttachments.some((attachment) => attachment.truncated),
    };
    return {
      ...aggregated,
      summary: formatTavilySearchAttachmentSummary(aggregated),
    };
  }

  if (kind === "js-source") {
    if (attachments.length === 1) {
      return attachments[0];
    }
    const aggregated = aggregateToolAttachmentGroupByKind(attachments.filter(isJsSourceToolAttachment));
    if (!aggregated) {
      return attachments[0];
    }
    return {
      ...aggregated,
      id: `message-display-js-source-${attachments.map((attachment) => attachment.id).join("-")}`,
    };
  }

  if (kind === "source-map") {
    if (attachments.length === 1) {
      return attachments[0];
    }
    const aggregated = aggregateToolAttachmentGroupByKind(attachments.filter(isSourceMapToolAttachment));
    if (!aggregated) {
      return attachments[0];
    }
    return {
      ...aggregated,
      id: `message-display-source-map-${attachments.map((attachment) => attachment.id).join("-")}`,
    };
  }

  if (kind === "automation-report") {
    if (attachments.length === 1) {
      return attachments[0];
    }
    const aggregated = aggregateToolAttachmentGroupByKind(attachments.filter(isAutomationReportToolAttachment));
    if (!aggregated) {
      return attachments[0];
    }
    return {
      ...aggregated,
      id: `message-display-automation-report-${attachments.map((attachment) => attachment.id).join("-")}`,
    };
  }

  if (attachments.length === 1) {
    const [attachment] = attachments;
    if (isBrowserScreenshotToolAttachment(attachment) || isAutomationReportToolAttachment(attachment)) {
      return attachment;
    }
  }

  return aggregateGenericDisplayAttachments(kind, attachments);
}

function getMaxCreatedAt(attachments: ChatToolAttachment[]): number {
  const values = attachments.map((attachment) => attachment.createdAt).filter(Number.isFinite);
  return values.length > 0 ? Math.max(...values) : 0;
}

function aggregateGenericDisplayAttachments(kind: string, attachments: ChatToolAttachment[]): ChatToolAttachment {
  const genericAttachments = attachments.map(sanitizeGenericToolAttachment);
  const first = genericAttachments[0];
  if (genericAttachments.length === 1) {
    return first;
  }

  const details = uniqueNonEmptyStrings(
    genericAttachments.map((attachment) => attachment.details),
  ).join("\n\n");

  return {
    id: `message-display-${kind}-${genericAttachments.map((attachment) => attachment.id).join("-")}`,
    kind,
    title: first.title,
    summary: uniqueNonEmptyStrings(genericAttachments.map((attachment) => attachment.summary)).join("\n"),
    createdAt: getMaxCreatedAt(genericAttachments),
    redacted: genericAttachments.every((attachment) => attachment.redacted),
    truncated: genericAttachments.some((attachment) => attachment.truncated),
    details: details || undefined,
  };
}

function uniqueDisplayItems<T>(items: T[], getKey: (item: T) => string): T[] {
  const seen = new Set<string>();
  const result: T[] = [];
  for (const item of items) {
    const key = getKey(item);
    if (key && seen.has(key)) {
      continue;
    }
    if (key) {
      seen.add(key);
    }
    result.push(item);
  }
  return result;
}

function uniqueNonEmptyStrings(values: Array<string | undefined>): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const normalized = value?.trim();
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
}

function ToolAttachmentView({ attachment, onPreviewImage }: { attachment: ChatToolAttachment; onPreviewImage: (attachment: ChatImageAttachment) => void }) {
  if (isNetworkToolAttachment(attachment)) {
    return <NetworkToolAttachmentView attachment={attachment} />;
  }

  if (isWebSearchToolAttachment(attachment)) {
    return <WebSearchToolAttachmentView attachment={attachment} />;
  }

  if (isJsSourceToolAttachment(attachment)) {
    return <JsSourceToolAttachmentView attachment={attachment} />;
  }

  if (isSourceMapToolAttachment(attachment)) {
    return <SourceMapToolAttachmentView attachment={attachment} />;
  }

  if (isBrowserScreenshotToolAttachment(attachment)) {
    return <BrowserScreenshotToolAttachmentView attachment={attachment} onPreviewImage={onPreviewImage} />;
  }

  if (isAutomationReportToolAttachment(attachment)) {
    return <AutomationReportToolAttachmentView attachment={attachment} />;
  }

  return (
    <details className={`message-tool-attachment message-${attachment.kind}-attachment`}>
      <summary>
        <span>{attachment.title}</span>
      </summary>
      <p className="message-tool-attachment-summary">{attachment.summary}</p>
      {attachment.details ? <pre>{attachment.details}</pre> : null}
    </details>
  );
}

function AutomationReportToolAttachmentView({ attachment }: { attachment: ChatToolAttachment }) {
  if (!isAutomationReportToolAttachment(attachment)) {
    return null;
  }

  return (
    <details className="message-tool-attachment message-automation-report-attachment">
      <summary>
        <span>自动化任务报告</span>
        <span className="message-network-count">{attachment.steps.length}</span>
      </summary>
      <p className="message-tool-attachment-summary">{attachment.summary}</p>
      <p className="message-tool-attachment-summary">目标：{attachment.objective}</p>
      <p className="message-tool-attachment-summary">任务类型：{formatAutomationReportTypeLabel(attachment.reportType)}</p>
      <p className="message-tool-attachment-summary">结论：{attachment.conclusion}</p>
      <p className="message-tool-attachment-summary">完全访问原文结果：{attachment.fullAccessIncluded ? "是" : "否"}</p>
      {attachment.timeline.length > 0 ? (
        <>
          <p className="message-tool-attachment-summary">时间线</p>
          <ol className="message-automation-report-timeline-list">
            {attachment.timeline.map((event) => (
              <li key={event.id}>
                <strong>{event.label}</strong> [{event.type}]：{event.detail}
              </li>
            ))}
          </ol>
        </>
      ) : null}
      {attachment.checkpoints?.length ? (
        <>
          <p className="message-tool-attachment-summary">检查点</p>
          <ol className="message-automation-report-timeline-list">
            {attachment.checkpoints.map((checkpoint) => (
              <li key={checkpoint.id}>
                <strong>{checkpoint.label}</strong> [{checkpoint.status}]：{checkpoint.detail}
                {checkpoint.nextSteps.length ? <span>；下一步：{checkpoint.nextSteps.join("；")}</span> : null}
              </li>
            ))}
          </ol>
        </>
      ) : null}
      {attachment.nextSteps?.length ? (
        <p className="message-tool-attachment-summary">建议下一步：{attachment.nextSteps.join("；")}</p>
      ) : null}
      <ol className="message-automation-report-step-list">
        {attachment.steps.map((step) => (
          <li key={step.toolCallId}>
            <strong>{step.displayName}</strong> [{step.status}]：{step.evidence}
          </li>
        ))}
      </ol>
      {attachment.failureSummary ? (
        <p className="message-tool-attachment-summary">
          失败工具：{attachment.failureSummary.failedTools.join("、") || "无"}；可恢复动作：{attachment.failureSummary.recoverableActions.join("；") || "无"}
        </p>
      ) : null}
    </details>
  );
}

function BrowserScreenshotToolAttachmentView({ attachment, onPreviewImage }: { attachment: ChatToolAttachment; onPreviewImage: (attachment: ChatImageAttachment) => void }) {
  if (!isBrowserScreenshotToolAttachment(attachment)) {
    return null;
  }

  return (
    <details className="message-tool-attachment message-browser-screenshot-attachment">
      <summary>
        <span>{attachment.title || "浏览器截图"}</span>
      </summary>
      <p className="message-tool-attachment-summary">{attachment.summary}</p>
      <button
        className="message-browser-screenshot-preview"
        type="button"
        aria-label="全屏预览浏览器截图"
        onClick={() => onPreviewImage({
          id: attachment.id,
          name: attachment.title || "浏览器截图",
          mediaType: attachment.mediaType,
          dataUrl: attachment.dataUrl,
        })}
      >
        <img src={attachment.dataUrl} alt="浏览器截图" />
      </button>
    </details>
  );
}

function NetworkToolAttachmentView({ attachment }: { attachment: ChatToolAttachment }) {
  if (!isNetworkToolAttachment(attachment)) {
    return null;
  }

  const requests = attachment.redacted === false ? attachment.requests : attachment.requests.map(redactNetworkRequestDetail);
  const summary = formatNetworkAttachmentSummary(requests);

  return (
    <details className="message-tool-attachment message-network-attachment">
      <summary>
        <span>Network 请求详情</span>
        <span className="message-network-count">{requests.length}</span>
      </summary>
      <p className="message-network-summary">{summary}</p>
      <ul className="message-network-request-list">
        {requests.map((request) => (
          <li key={request.id} className="message-network-request-item">
            <details>
              <summary>
                <span className="message-network-request-line">
                  {request.method || "UNKNOWN"} {request.status ?? "unknown"} {request.url}
                </span>
                <span className="message-network-flags">
                  {request.redacted ? "已脱敏" : "原文"}
                  {request.truncated ? " · 已截断" : ""}
                </span>
              </summary>
              <pre>{JSON.stringify(request, null, 2)}</pre>
            </details>
          </li>
        ))}
      </ul>
    </details>
  );
}

function WebSearchToolAttachmentView({ attachment }: { attachment: ChatToolAttachment }) {
  if (!isWebSearchToolAttachment(attachment)) {
    return null;
  }

  return (
    <details className="message-tool-attachment message-web-search-attachment">
      <summary>
        <span>网络搜索结果</span>
        <span className="message-web-search-count">{attachment.results.length}</span>
      </summary>
      <p className="message-web-search-summary">{formatTavilySearchAttachmentSummary(attachment)}</p>
      <ul className="message-web-search-result-list">
        {attachment.results.map((result, index) => (
          <li key={`${result.url}-${index}`} className="message-web-search-result-item">
            <details>
              <summary>
                <span className="message-web-search-result-line">{result.title || result.url}</span>
                <span className="message-web-search-flags">{attachment.provider}</span>
              </summary>
              <pre>{JSON.stringify(result, null, 2)}</pre>
            </details>
          </li>
        ))}
      </ul>
    </details>
  );
}

function JsSourceToolAttachmentView({ attachment }: { attachment: ChatToolAttachment }) {
  if (!isJsSourceToolAttachment(attachment)) {
    return null;
  }

  return (
    <details className="message-tool-attachment message-js-source-attachment">
      <summary>
        <span>JS 源码片段</span>
        <span className="message-js-source-count">{getJsSourceAttachmentDisplayCount(attachment)}</span>
      </summary>
      <p className="message-tool-attachment-summary">{attachment.summary}</p>
      {attachment.resources.length ? (
        <ul className="message-js-source-resource-list">
          {attachment.resources.map((resource) => (
            <li key={resource.id}>
              {resource.source} | {resource.id} | {resource.url}
            </li>
          ))}
        </ul>
      ) : null}
      {attachment.jsMatches.map((match, index) => (
        <details key={`${match.resourceId}-${match.position}-${index}`}>
          <summary>
            <span>
              {match.resourceId}:{match.line}:{match.column} 命中 {match.term}
            </span>
          </summary>
          <pre>{match.snippet}</pre>
        </details>
      ))}
      {attachment.contexts.map((context, index) => (
        <details key={`${context.resourceId}-${context.position}-${index}`}>
          <summary>
            <span>
              {context.resourceId}:{context.line}:{context.column} 上下文
            </span>
          </summary>
          <pre>{context.snippet}</pre>
        </details>
      ))}
      {attachment.failedFetches.length ? <pre>{attachment.failedFetches.map((failure) => `${failure.url}: ${failure.message}`).join("\n")}</pre> : null}
    </details>
  );
}

function SourceMapToolAttachmentView({ attachment }: { attachment: ChatToolAttachment }) {
  if (!isSourceMapToolAttachment(attachment)) {
    return null;
  }

  return (
    <details className="message-tool-attachment message-source-map-attachment">
      <summary>
        <span>Source Map 解析结果</span>
        <span className="message-js-source-count">{getSourceMapAttachmentDisplayCount(attachment)}</span>
      </summary>
      <p className="message-tool-attachment-summary">{attachment.summary}</p>
      {attachment.candidates.length ? (
        <ul className="message-js-source-resource-list">
          {attachment.candidates.map((candidate, index) => (
            <li key={`${candidate.resourceId}-${candidate.source}-${candidate.url ?? "inline"}-${index}`}>
              {candidate.resourceId} | {candidate.source} | {candidate.status} | {formatSourceMapCandidateLocation(candidate)}
            </li>
          ))}
        </ul>
      ) : null}
      {attachment.resolvedLocations.map((location, index) => (
        <details key={`${location.resourceId}-${location.generatedLine}-${location.generatedColumn}-${index}`}>
          <summary>
            <span>
              {location.resourceId}:{location.generatedLine}:{location.generatedColumn} -&gt; {location.source ?? "未映射"}:{location.originalLine ?? "-"}:{location.originalColumn ?? "-"}
            </span>
          </summary>
          <pre>{formatSourceMapResolvedLocationForDisplay(location)}</pre>
        </details>
      ))}
      {attachment.originalContexts.map((context, index) => (
        <details key={`${context.resourceId}-${context.generatedLine}-${context.generatedColumn}-${context.source ?? ""}-${index}`}>
          <summary>
            <span>
              {context.source ?? "未映射"}:{context.originalLine ?? "-"}:{context.originalColumn ?? "-"} 原始上下文
            </span>
          </summary>
          <pre>{context.snippet ?? context.message ?? ""}</pre>
        </details>
      ))}
      {attachment.failures.length ? <pre>{attachment.failures.map((failure) => `${failure.resourceId ?? failure.url ?? "unknown"}: ${failure.message}`).join("\n")}</pre> : null}
    </details>
  );
}

function formatSourceMapCandidateLocation(candidate: Extract<ChatToolAttachment, { kind: "source-map" }>["candidates"][number]): string {
  if (candidate.inline) {
    return "inline";
  }
  return candidate.url ? "外部 Source Map" : "无 URL";
}

function formatSourceMapResolvedLocationForDisplay(location: Extract<ChatToolAttachment, { kind: "source-map" }>["resolvedLocations"][number]): string {
  return [
    `resourceId: ${location.resourceId}`,
    `generated: ${location.generatedLine}:${location.generatedColumn}`,
    `source: ${location.source ?? "未映射"}`,
    `original: ${location.originalLine ?? "-"}:${location.originalColumn ?? "-"}`,
    `name: ${location.name ?? "-"}`,
    `ignored: ${location.ignored ? "是" : "否"}`,
    `hasSourceContent: ${location.hasSourceContent ? "是" : "否"}`,
    location.message ? `message: ${location.message}` : undefined,
  ]
    .filter((line): line is string => Boolean(line))
    .join("\n");
}

export function getSourceMapAttachmentDisplayCount(attachment: ChatToolAttachment): number {
  if (!isSourceMapToolAttachment(attachment)) {
    return 0;
  }

  const resultCount = attachment.resolvedLocations.length + attachment.originalContexts.length;
  if (resultCount > 0) {
    return resultCount;
  }

  return attachment.candidates.length || attachment.failures.length;
}

export function getJsSourceAttachmentDisplayCount(attachment: ChatToolAttachment): number {
  if (!isJsSourceToolAttachment(attachment)) {
    return 0;
  }

  const snippetCount = attachment.jsMatches.length + attachment.contexts.length;
  if (snippetCount > 0) {
    return snippetCount;
  }

  return attachment.resources.length || attachment.failedFetches.length;
}

function formatToolCallLine(record: ChatToolCallRecord): string {
  const query = typeof record.arguments.query === "string" && record.arguments.query.trim() ? `：${record.arguments.query.trim()}` : "";
  if (record.toolId === "chat.follow_up_guidance") {
    return `${record.displayName}${query}`;
  }
  if (record.status === "running") {
    return `正在调用 ${record.displayName}${query}`;
  }
  if (record.status === "error") {
    return `${record.displayName} 调用失败${query}`;
  }
  return `已调用 ${record.displayName}${query}`;
}

const IMAGE_URL_PATTERN = /https?:\/\/[^\s<>"'`)\]]+\.(?:png|jpe?g|gif|webp|bmp|svg)(?:\?[^\s<>"'`)\]]*)?/gi;
const MARKDOWN_IMAGE_OR_LINK_PATTERN = /(!?\[[^\]]*]\()https?:\/\/[^)\s]+(\))/g;

function isRenderableImageUrl(value: string | undefined): boolean {
  if (!value) {
    return false;
  }
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return false;
    }
    return /\.(?:png|jpe?g|gif|webp|bmp|svg)(?:$|\?)/i.test(parsed.pathname + parsed.search)
      || /\/images?\//i.test(parsed.pathname)
      || /r2\.dev\/images\//i.test(parsed.hostname + parsed.pathname);
  } catch {
    return false;
  }
}

/** Turn bare image URLs into markdown images so ReactMarkdown can render them. */
export function enhanceMarkdownImageLinks(content: string): string {
  if (!content) {
    return content;
  }

  // Skip URLs already inside markdown image/link destinations.
  const placeholders: string[] = [];
  const protectedContent = content.replace(MARKDOWN_IMAGE_OR_LINK_PATTERN, (match) => {
    const token = `@@MD_LINK_${placeholders.length}@@`;
    placeholders.push(match);
    return token;
  });

  const enhanced = protectedContent.replace(IMAGE_URL_PATTERN, (url) => {
    const cleaned = url.replace(/[),.，。；;]+$/g, "");
    const trailing = url.slice(cleaned.length);
    if (!isRenderableImageUrl(cleaned)) {
      return url;
    }
    return `![生成图片](${cleaned})${trailing}`;
  });

  return enhanced.replace(/@@MD_LINK_(\d+)@@/g, (_match, index) => placeholders[Number(index)] ?? "");
}

function extractImageUrls(text: string): string[] {
  if (!text) {
    return [];
  }
  const matches = text.match(IMAGE_URL_PATTERN) ?? [];
  const urls: string[] = [];
  for (const match of matches) {
    const cleaned = match.replace(/[),.，。；;]+$/g, "");
    if (isRenderableImageUrl(cleaned) && !urls.includes(cleaned)) {
      urls.push(cleaned);
    }
  }
  return urls;
}

function MarkdownImage(props: ImgHTMLAttributes<HTMLImageElement>) {
  const src = typeof props.src === "string" ? props.src : undefined;
  if (!src) {
    return null;
  }
  return (
    <a className="message-generated-image-link" href={src} target="_blank" rel="noreferrer noopener">
      <img className="message-generated-image" src={src} alt={props.alt || "生成图片"} loading="lazy" />
    </a>
  );
}

function MarkdownLink(props: AnchorHTMLAttributes<HTMLAnchorElement>) {
  const href = typeof props.href === "string" ? props.href : undefined;
  if (isRenderableImageUrl(href)) {
    return (
      <a className="message-generated-image-link" href={href} target="_blank" rel="noreferrer noopener">
        <img className="message-generated-image" src={href} alt={typeof props.children === "string" ? props.children : "生成图片"} loading="lazy" />
      </a>
    );
  }
  return (
    <a {...props} target={props.target ?? "_blank"} rel={props.rel ?? "noreferrer noopener"}>
      {props.children}
    </a>
  );
}

function ToolResultText({ text }: { text: string }) {
  const imageUrls = extractImageUrls(text);
  return (
    <div className="message-tool-result-text">
      <pre>{text}</pre>
      {imageUrls.length > 0 ? (
        <div className="message-tool-result-images" aria-label="结果图片">
          {imageUrls.map((url) => (
            <a key={url} className="message-generated-image-link" href={url} target="_blank" rel="noreferrer noopener">
              <img className="message-generated-image" src={url} alt="工具返回图片" loading="lazy" />
            </a>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function formatToolDuration(record: ChatToolCallRecord): string {
  if (!record.completedAt) {
    return "进行中";
  }
  return `${Math.max(0, record.completedAt - record.startedAt)} ms`;
}

function PromptTokenLinks({ prompts, ariaLabelPrefix }: { prompts: ChatPromptInvocation[]; ariaLabelPrefix: string }) {
  return (
    <span className="message-prompt-token-strip">
      {prompts.map((prompt, index) => (
        <span key={`${prompt.promptId}-${index}`} className="prompt-token-link" aria-label={`${ariaLabelPrefix}：${prompt.title}`}>
          <PromptTokenContent title={prompt.title} />
        </span>
      ))}
    </span>
  );
}

function RegenerateIcon() {
  return (
    <svg aria-hidden="true" focusable="false" viewBox="0 0 24 24">
      <path d="M18.5 9.5A6.2 6.2 0 0 0 7.8 6.2L5.5 8.5" />
      <path d="M5.5 5.5v3h3" />
      <path d="M5.5 14.5a6.2 6.2 0 0 0 10.7 3.3l2.3-2.3" />
      <path d="M18.5 18.5v-3h-3" />
    </svg>
  );
}

function EditMessageIcon() {
  return (
    <svg aria-hidden="true" focusable="false" viewBox="0 0 24 24">
      <path d="M5 18.5 6.2 14 15.7 4.5a2.1 2.1 0 0 1 3 3L9.2 17 5 18.5Z" />
      <path d="m14.2 6 3.8 3.8" />
    </svg>
  );
}

function SendEditedMessageIcon() {
  return (
    <svg aria-hidden="true" focusable="false" viewBox="0 0 24 24">
      <path d="M4.5 5.5 19.5 12 4.5 18.5 7.5 12 4.5 5.5Z" />
      <path d="M7.8 12h5.8" />
    </svg>
  );
}

function CancelEditIcon() {
  return (
    <svg aria-hidden="true" focusable="false" viewBox="0 0 24 24">
      <path d="M7 7 17 17" />
      <path d="M17 7 7 17" />
    </svg>
  );
}

function shouldOpenThinking(message: ChatMessage): boolean {
  if (!message.streaming || !message.thinking) {
    return false;
  }

  return message.thinking.split(/\r?\n/).length <= 5;
}

function shouldHideToolTurnContent(message: ChatMessage, displayMode: ToolCallDisplayMode): boolean {
  return displayMode === "compact" && message.assistantMessageKind === "tool_call_turn";
}

function shouldShowToolCallTimelineForMessage(
  message: ChatMessage,
  displayMode: ToolCallDisplayMode,
  showToolCallProcessInAssistantMode: boolean,
): message is ChatMessage & { toolCallRecords: ChatToolCallRecord[] } {
  if (message.role !== "assistant" || !message.toolCallRecords?.length) {
    return false;
  }

  if (message.assistantMessageKind !== "tool_call_turn") {
    return false;
  }

  return displayMode === "compact" || showToolCallProcessInAssistantMode || isGuidanceToolTurnMessage(message);
}

function isGuidanceToolTurnMessage(message: ChatMessage): boolean {
  return Boolean(message.toolCallRecords?.some((record) => record.toolId === "chat.follow_up_guidance"));
}
