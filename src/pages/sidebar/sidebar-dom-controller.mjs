export const createSidebarDomController = (elements) => {
  const shellStateTitleSelector = ".sidebar-state-title";
  const shellStateDescriptionSelector = ".sidebar-state-description";
  const shellStateFootnoteSelector = ".sidebar-state-footnote";
  const shellStateListSelector = ".sidebar-state-list";

  const hideEmptyState = () => {
    if (!(elements.emptyState instanceof HTMLElement)) {
      return;
    }

    elements.emptyState.hidden = true;
  };

  const showEmptyStateIfNeeded = () => {
    if (!(elements.emptyState instanceof HTMLElement) || !(elements.messages instanceof HTMLElement)) {
      return;
    }

    const hasMessageRow = elements.messages.querySelector(".sidebar-message-row") instanceof HTMLElement;
    const canShowEmptyState = currentShellState === "active";
    elements.emptyState.hidden = hasMessageRow || !canShowEmptyState;
    syncChatStageState();
  };

  const buildMessageRow = ({ role, text, pending = false, kind = "assistant" }) => {
    const row = document.createElement("article");
    row.className = `sidebar-message-row${pending ? " sidebar-message-pending" : ""}`;
    row.dataset.role = role;
    row.dataset.sidebarMessageKind = kind;

    const meta = document.createElement("p");
    meta.className = "sidebar-message-meta";
    meta.textContent = role === "user" ? "你" : kind === "tool_result" ? "已完成操作" : "月标签助手";

    const bubble = document.createElement("div");
    bubble.className = "sidebar-message-bubble";

    if (kind === "tool_result") {
      const receiptHead = document.createElement("div");
      receiptHead.className = "sidebar-tool-receipt-head";

      const receiptGlyph = document.createElement("span");
      receiptGlyph.className = "sidebar-tool-receipt-glyph";
      receiptGlyph.setAttribute("aria-hidden", "true");
      receiptGlyph.textContent = "·";

      const receiptLabel = document.createElement("span");
      receiptLabel.className = "sidebar-tool-receipt-label";
      receiptLabel.textContent = "已完成操作";

      const receiptText = document.createElement("span");
      receiptText.className = "sidebar-tool-receipt-text";
      receiptText.textContent = text;

      receiptHead.append(receiptGlyph, receiptLabel);
      bubble.append(receiptHead, receiptText);
      meta.hidden = true;
    } else {
      bubble.textContent = text;
    }

    row.append(meta, bubble);
    return row;
  };

  const buildTraceRow = ({ type, label, status }) => {
    const row = document.createElement("div");
    row.className = "sidebar-trace-row";
    row.dataset.sidebarTraceEvent = type;
    row.dataset.traceStatus = status;

    const dot = document.createElement("span");
    dot.className = "sidebar-trace-dot";
    dot.setAttribute("aria-hidden", "true");

    const textGroup = document.createElement("span");
    textGroup.className = "sidebar-trace-copy";

    const text = document.createElement("span");
    text.className = "sidebar-trace-text";
    text.textContent = label;

    const meta = document.createElement("span");
    meta.className = "sidebar-trace-meta";
    meta.textContent = status === "failed" ? "未完成" : status === "done" ? "已完成" : "处理中";

    textGroup.append(text, meta);
    row.append(dot, textGroup);
    return row;
  };

  const toSourceLabel = (value) => {
    if (!value) {
      return "";
    }

    try {
      return new URL(value).host;
    } catch {
      return value;
    }
  };

  let pendingRow = null;
  let traceRail = null;
  let currentShellState = "locked";

  const setStateListItems = (container, items = []) => {
    if (!(container instanceof HTMLElement)) {
      return;
    }

    container.innerHTML = "";
    const nextItems = Array.isArray(items) ? items.filter((item) => typeof item === "string" && item.trim()) : [];
    container.hidden = nextItems.length === 0;

    nextItems.forEach((item) => {
      const listItem = document.createElement("li");
      listItem.textContent = item;
      container.append(listItem);
    });
  };

  const setOptionalText = (element, value) => {
    if (!(element instanceof HTMLElement)) {
      return;
    }

    const nextValue = typeof value === "string" ? value.trim() : "";
    element.textContent = nextValue;
    element.hidden = !nextValue;
  };

  const setAiStatusState = (state) => {
    if (!(elements.topbarAiStatus instanceof HTMLElement)) {
      return;
    }

    const pill = elements.topbarAiStatus.closest("[data-sidebar-status-item]");
    if (!(pill instanceof HTMLElement)) {
      return;
    }

    if (state) {
      pill.dataset.statusState = state;
      return;
    }

    delete pill.dataset.statusState;
  };

  const syncChatStageState = () => {
    if (!(elements.chatShell instanceof HTMLElement)) {
      return;
    }

    const hasMessageRow = elements.messages?.querySelector(".sidebar-message-row") instanceof HTMLElement;
    const traceVisible = elements.trace instanceof HTMLElement && !elements.trace.hidden && elements.trace.childElementCount > 0;

    elements.chatShell.dataset.chatHasMessages = hasMessageRow ? "true" : "false";
    elements.chatShell.dataset.chatHasTrace = traceVisible ? "true" : "false";
  };

  const appendMessage = ({ role, text, kind = "assistant" }) => {
    if (!(elements.messages instanceof HTMLElement) || !text) {
      return;
    }

    hideEmptyState();
    clearPendingAssistantMessage();
    const row = buildMessageRow({ role, text, kind });
    elements.messages.append(row);
    elements.messages.scrollTop = elements.messages.scrollHeight;
    syncChatStageState();
  };

  const showPendingAssistantMessage = (text = "我在读这一页，稍等一下。") => {
    if (!(elements.messages instanceof HTMLElement) || pendingRow) {
      return;
    }

    hideEmptyState();
    pendingRow = buildMessageRow({ role: "assistant", text, pending: true, kind: "assistant" });
    elements.messages.append(pendingRow);
    elements.messages.scrollTop = elements.messages.scrollHeight;
    syncChatStageState();
  };

  const clearPendingAssistantMessage = () => {
    pendingRow?.remove();
    pendingRow = null;
    showEmptyStateIfNeeded();
  };

  const clearTrace = () => {
    if (!(elements.trace instanceof HTMLElement)) {
      return;
    }

    traceRail = elements.trace.querySelector(".sidebar-trace-rail");
    elements.trace.innerHTML = "";
    if (traceRail instanceof HTMLElement) {
      elements.trace.append(traceRail);
    }
    elements.trace.hidden = true;
    syncChatStageState();
  };

  const appendTrace = (trace) => {
    if (!(elements.trace instanceof HTMLElement)) {
      return;
    }

    traceRail = elements.trace.querySelector(".sidebar-trace-rail") ?? traceRail;
    if (!(traceRail instanceof HTMLElement)) {
      traceRail = document.createElement("div");
      traceRail.className = "sidebar-trace-rail";
      traceRail.setAttribute("aria-hidden", "true");
      elements.trace.prepend(traceRail);
    } else if (traceRail.parentElement !== elements.trace) {
      elements.trace.prepend(traceRail);
    }

    elements.trace.hidden = false;
    elements.trace.append(buildTraceRow(trace));
    elements.trace.scrollTop = elements.trace.scrollHeight;
    syncChatStageState();
  };

  const setBusy = (busy) => {
    document.body.classList.toggle("sidebar-busy", busy);
    elements.shell?.classList.toggle("is-busy", busy);
    elements.form?.classList.toggle("is-busy", busy);
    setComposerInteractivity({ visible: true, enabled: !busy, busy });
    elements.suggestionButtons?.forEach((button) => {
      if (button instanceof HTMLButtonElement) {
        button.disabled = busy;
        button.setAttribute("aria-disabled", busy ? "true" : "false");
      }
    });
  };

  const setComposerInteractivity = ({ visible, enabled, busy = false }) => {
    if (elements.form instanceof HTMLElement) {
      elements.form.hidden = !visible;
      elements.form.dataset.composerEnabled = enabled ? "true" : "false";
    }

    if (elements.input instanceof HTMLTextAreaElement) {
      elements.input.disabled = !enabled;
      elements.input.setAttribute("aria-disabled", enabled ? "false" : "true");
      elements.input.setAttribute("aria-busy", busy ? "true" : "false");
    }

    if (elements.submitButton instanceof HTMLButtonElement) {
      elements.submitButton.disabled = !enabled;
      elements.submitButton.setAttribute("aria-disabled", enabled ? "false" : "true");
    }

    elements.quickActionButtons?.forEach((button) => {
      if (button instanceof HTMLButtonElement) {
        button.disabled = !enabled;
        button.setAttribute("aria-disabled", enabled ? "false" : "true");
      }
    });
  };

  const renderContext = (contextState) => {
    if (elements.contextStatus instanceof HTMLElement) {
      elements.contextStatus.textContent = contextState.status;
    }

    if (elements.contextTitle instanceof HTMLElement) {
      elements.contextTitle.textContent = contextState.title || "还没有连接到页面";
    }

    if (elements.contextUrl instanceof HTMLElement) {
      elements.contextUrl.textContent = toSourceLabel(contextState.url);
    }
  };

  const renderShellState = (shellState) => {
    currentShellState = shellState.shellState;

    if (elements.shell instanceof HTMLElement) {
      elements.shell.dataset.sidebarShellState = shellState.shellState;
    }

    const lockedTitle = elements.lockedState?.querySelector(shellStateTitleSelector);
    const lockedDescription = elements.lockedState?.querySelector(shellStateDescriptionSelector);
    const lockedFootnote = elements.lockedState?.querySelector(shellStateFootnoteSelector);
    const lockedList = elements.lockedState?.querySelector(shellStateListSelector);

    if (elements.lockedState instanceof HTMLElement) {
      const showLocked = shellState.shellState === "locked";
      elements.lockedState.hidden = !showLocked;
      if (showLocked) {
        elements.lockedState.dataset.sidebarStateVariant = shellState.surfaceVariant || "locked";
      }
      if (lockedTitle instanceof HTMLElement) {
        lockedTitle.textContent = shellState.headline || "尚未连接 AI 接口";
      }
      if (lockedDescription instanceof HTMLElement) {
        lockedDescription.textContent = shellState.description || "先完成 AI 配置后再启用侧边栏。";
      }
      setOptionalText(lockedFootnote, shellState.footnote);
      setStateListItems(lockedList, shellState.detailItems);
    }

    const errorTitle = elements.errorState?.querySelector(shellStateTitleSelector);
    const errorDescription = elements.errorState?.querySelector(shellStateDescriptionSelector);
    const errorFootnote = elements.errorState?.querySelector(shellStateFootnoteSelector);
    const errorList = elements.errorState?.querySelector(shellStateListSelector);

    if (elements.errorState instanceof HTMLElement) {
      const showError = shellState.shellState === "error";
      elements.errorState.hidden = !showError;
      if (showError) {
        elements.errorState.dataset.sidebarStateVariant = shellState.surfaceVariant || "error";
      }
      if (errorTitle instanceof HTMLElement) {
        errorTitle.textContent = shellState.headline || "AI 接口暂时不可用";
      }
      if (errorDescription instanceof HTMLElement) {
        errorDescription.textContent = shellState.description || "AI 接口暂时不可用";
      }
      setOptionalText(errorFootnote, shellState.footnote);
      setStateListItems(errorList, shellState.detailItems);
    }

    if (elements.chatShell instanceof HTMLElement) {
      elements.chatShell.hidden = false;
      elements.chatShell.dataset.chatState = shellState.shellState;
    }

    if (elements.form instanceof HTMLElement) {
      const composerEnabled = shellState.shellState === "active"
        || shellState.surfaceVariant === "degraded";
      setComposerInteractivity({ visible: true, enabled: composerEnabled });
    }

    showEmptyStateIfNeeded();

    if (elements.topbarAiStatus instanceof HTMLElement) {
      elements.topbarAiStatus.textContent = shellState.aiStatusText || "AI 状态未知";
    }
    setAiStatusState(shellState.aiStatusTone || "");

    if (elements.errorMessage instanceof HTMLElement && shellState.shellState === "error") {
      elements.errorMessage.textContent = shellState.description || "AI 接口暂时不可用";
    }

    if (elements.openSettingsButton instanceof HTMLButtonElement) {
      elements.openSettingsButton.textContent = shellState.primaryActionLabel || "去完成配置";
    }

    if (elements.refreshShellButton instanceof HTMLButtonElement) {
      elements.refreshShellButton.textContent = shellState.secondaryActionLabel || "刷新页面状态";
    }

    if (elements.retestButton instanceof HTMLButtonElement) {
      elements.retestButton.textContent = shellState.primaryActionLabel || "去设置里重新连接";
    }

    if (elements.editConfigButton instanceof HTMLButtonElement) {
      elements.editConfigButton.textContent = shellState.secondaryActionLabel || "刷新页面状态";
    }
  };

  const setFeedback = (message, tone = "neutral") => {
    if (!(elements.feedback instanceof HTMLElement)) {
      return;
    }

    elements.feedback.textContent = message;
    elements.feedback.dataset.tone = tone;
  };

  return {
    appendMessage,
    appendTrace,
    clearTrace,
    renderContext,
    renderShellState,
    setFeedback,
    showPendingAssistantMessage,
    clearPendingAssistantMessage,
    setBusy,
  };
};
