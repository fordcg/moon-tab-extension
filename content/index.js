(function () {
  const FLOATING_HOST_ID = "browser-ai-assistant-floating-host";
  const FLOATING_FOCUS_EVENT = "browser-ai-assistant-floating-focus";
  const FLOATING_PLACEMENT_KEY = "browserAiAssistant.floatingPlacement.v2";
  const FLOATING_IFRAME_PATH = "src/ai-assistant/index.html?floating=1";
  const floatingCleanups = new WeakMap();

  function normalizeWhitespace(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  function truncateText(value, maxLength) {
    if (!Number.isFinite(maxLength) || maxLength < 0 || value.length <= maxLength) {
      return { text: value, truncated: false };
    }
    return { text: value.slice(0, maxLength), truncated: true };
  }

  function splitSelectors(value) {
    return String(value || "")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
  }

  function extractPageContext(request) {
    const extractMode = request.extractMode || "text";
    const rules = [...request.rules].sort(
      (left, right) => (left.sortOrder || 0) - (right.sortOrder || 0),
    );
    const matchedRule = rules.find((rule) => matchesUrlPattern(rule.urlPattern, request.url));
    const ruleOutput = matchedRule
      ? extractBySelectors(matchedRule.selectorsText, extractMode)
      : "";
    const usedFallback = ruleOutput.trim().length === 0;
    const rawOutput = usedFallback ? extractFallback(extractMode) : ruleOutput;
    const text = extractMode === "text" ? normalizeWhitespace(rawOutput) : rawOutput;

    return {
      ...truncateText(text, request.maxLength ?? Infinity),
      usedFallback,
      matchedRuleId: matchedRule?.id,
    };
  }

  function matchesUrlPattern(pattern, url) {
    try {
      return new RegExp(pattern).test(url);
    } catch (_error) {
      return false;
    }
  }

  function extractBySelectors(selectorsText, extractMode) {
    const selectors = splitSelectors(selectorsText);
    const output = [];
    for (const selector of selectors) {
      const value = extractByCss(selector, extractMode) || extractByXPath(selector, extractMode);
      if (value) {
        output.push(value);
      }
    }
    return extractMode === "text" ? normalizeWhitespace(output.join(" ")) : output.join("\n");
  }

  function extractByCss(selector, extractMode) {
    try {
      return collectNodeOutput(Array.from(document.querySelectorAll(selector)), extractMode);
    } catch (_error) {
      return "";
    }
  }

  function extractByXPath(selector, extractMode) {
    try {
      const result = document.evaluate(
        selector,
        document,
        null,
        XPathResult.ORDERED_NODE_SNAPSHOT_TYPE,
        null,
      );
      const nodes = [];
      for (let index = 0; index < result.snapshotLength; index += 1) {
        const node = result.snapshotItem(index);
        if (node) {
          nodes.push(node);
        }
      }
      return collectNodeOutput(nodes, extractMode);
    } catch (_error) {
      return "";
    }
  }

  function collectNodeOutput(nodes, extractMode) {
    if (extractMode === "text") {
      return normalizeWhitespace(nodes.map((node) => collectVisibleText(node)).join(" "));
    }
    return nodes
      .map((node) => serializeNode(node))
      .filter((value) => value !== "")
      .join("\n");
  }

  function extractFallback(extractMode) {
    if (extractMode === "all") {
      return document.documentElement?.outerHTML || "";
    }
    return collectVisibleText(document.body);
  }

  function serializeNode(node) {
    if (node.nodeType === Node.ELEMENT_NODE) {
      return node.outerHTML.trim();
    }
    return node.textContent || "";
  }

  function collectVisibleText(root) {
    if (!root || isHiddenNode(root)) {
      return "";
    }
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const parts = [];
    let current = walker.nextNode();
    while (current) {
      if (!isHiddenNode(current)) {
        const text = normalizeWhitespace(current.textContent || "");
        if (text) {
          parts.push(text);
        }
      }
      current = walker.nextNode();
    }
    return normalizeWhitespace(parts.join(" "));
  }

  function isHiddenNode(node) {
    const element = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
    if (!element || !document.body?.contains(element)) {
      return true;
    }
    if (element.closest("script, style, template, noscript, [hidden], [aria-hidden='true']")) {
      return true;
    }
    return isElementVisuallyHidden(element);
  }

  function isElementVisuallyHidden(element) {
    const style = window.getComputedStyle(element);
    return style.display === "none" || style.visibility === "hidden" || style.opacity === "0";
  }

  function isPageContextExtractMessage(message) {
    return Boolean(
      message &&
        typeof message === "object" &&
        message.type === "pageContext.extract" &&
        Array.isArray(message.rules),
    );
  }

  function isFloatingOpenMessage(message) {
    return Boolean(
      message &&
        typeof message === "object" &&
        message.type === "sidepanelFloating.open",
    );
  }

  function openFloatingAssistant(message) {
    const existing = document.getElementById(FLOATING_HOST_ID);
    if (existing) {
      existing.dispatchEvent(new CustomEvent(FLOATING_FOCUS_EVENT));
      return { ok: true, message: "悬浮窗已在当前页面显示。" };
    }

    const host = document.createElement("div");
    host.id = FLOATING_HOST_ID;
    const shadow = host.attachShadow({ mode: "open" });

    const style = document.createElement("style");
    style.textContent = getFloatingStyles();

    const panel = document.createElement("section");
    panel.className = "assistant-floating-panel";
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-label", "AI 助手悬浮窗");
    panel.tabIndex = -1;

    const toolbar = document.createElement("div");
    toolbar.className = "assistant-floating-toolbar";
    toolbar.setAttribute("aria-label", "拖动移动 AI 助手悬浮窗");

    const title = document.createElement("div");
    title.className = "assistant-floating-title";
    title.innerHTML = '<span class="assistant-floating-dot" aria-hidden="true"></span><span>AI 助手</span><small>拖动顶部栏移动</small>';

    const actions = document.createElement("div");
    actions.className = "assistant-floating-actions";

    const closeButton = document.createElement("button");
    closeButton.type = "button";
    closeButton.className = "assistant-floating-icon-button";
    closeButton.setAttribute("aria-label", "关闭 AI 悬浮窗");
    closeButton.title = "关闭悬浮窗";
    closeButton.textContent = "×";
    closeButton.addEventListener("click", closeFloatingAssistant);

    actions.append(closeButton);
    toolbar.append(title, actions);

    const iframe = document.createElement("iframe");
    iframe.className = "assistant-floating-frame";
    iframe.title = "AI 助手";
    iframe.allow = "clipboard-read; clipboard-write; fullscreen";
    iframe.src = ensureFloatingUrl(
      typeof message.url === "string" && message.url
        ? message.url
        : chrome.runtime.getURL(FLOATING_IFRAME_PATH),
    );
    iframe.addEventListener("load", () => panel.classList.add("is-loaded"), { once: true });

    panel.append(toolbar, iframe);
    shadow.append(style, panel);
    document.documentElement.append(host);

    applyInitialPlacement(panel);
    const cleanupDrag = bindFloatingDrag(panel, toolbar, iframe);
    const cleanupFocus = bindFloatingFocus(host, panel);
    const cleanupFrameMessages = bindFloatingFrameMessages(iframe);
    const cleanupResize = bindFloatingResize(panel);

    floatingCleanups.set(host, () => {
      cleanupDrag();
      cleanupFocus();
      cleanupFrameMessages();
      cleanupResize();
    });

    requestAnimationFrame(() => {
      panel.classList.add("is-mounted");
      panel.focus({ preventScroll: true });
    });

    return { ok: true, message: "已在当前页面打开悬浮窗，可拖动顶部栏移动。" };
  }

  function closeFloatingAssistant() {
    const host = document.getElementById(FLOATING_HOST_ID);
    if (!host) {
      return { ok: true, message: "悬浮窗已关闭。" };
    }
    floatingCleanups.get(host)?.();
    floatingCleanups.delete(host);
    host.remove();
    return { ok: true, message: "悬浮窗已关闭。" };
  }

  function bindFloatingDrag(panel, handle, iframe) {
    let dragging = false;
    let startX = 0;
    let startY = 0;
    let startLeft = 0;
    let startTop = 0;

    const onPointerDown = (event) => {
      if (event.button !== 0 || event.target?.closest?.("button")) {
        return;
      }
      event.preventDefault();
      const rect = panel.getBoundingClientRect();
      dragging = true;
      startX = event.clientX;
      startY = event.clientY;
      startLeft = rect.left;
      startTop = rect.top;
      panel.classList.add("is-dragging");
      iframe.style.pointerEvents = "none";
      handle.setPointerCapture?.(event.pointerId);
    };

    const onPointerMove = (event) => {
      if (!dragging) {
        return;
      }
      const rect = panel.getBoundingClientRect();
      const nextLeft = startLeft + event.clientX - startX;
      const nextTop = startTop + event.clientY - startY;
      setPanelPosition(panel, nextLeft, nextTop, rect.width, rect.height);
    };

    const stopDragging = (event) => {
      if (!dragging) {
        return;
      }
      dragging = false;
      panel.classList.remove("is-dragging");
      iframe.style.pointerEvents = "";
      handle.releasePointerCapture?.(event.pointerId);
      savePlacement(panel);
    };

    handle.addEventListener("pointerdown", onPointerDown);
    handle.addEventListener("pointermove", onPointerMove);
    handle.addEventListener("pointerup", stopDragging);
    handle.addEventListener("pointercancel", stopDragging);

    return () => {
      handle.removeEventListener("pointerdown", onPointerDown);
      handle.removeEventListener("pointermove", onPointerMove);
      handle.removeEventListener("pointerup", stopDragging);
      handle.removeEventListener("pointercancel", stopDragging);
    };
  }

  function bindFloatingFocus(host, panel) {
    let focusTimer = 0;
    const onFocus = () => {
      panel.classList.remove("is-focusing");
      void panel.offsetWidth;
      panel.classList.add("is-focusing");
      panel.focus({ preventScroll: true });
      clearTimeout(focusTimer);
      focusTimer = window.setTimeout(() => panel.classList.remove("is-focusing"), 700);
    };
    host.addEventListener(FLOATING_FOCUS_EVENT, onFocus);
    return () => {
      clearTimeout(focusTimer);
      host.removeEventListener(FLOATING_FOCUS_EVENT, onFocus);
    };
  }

  function bindFloatingFrameMessages(iframe) {
    const onMessage = (event) => {
      if (event.source !== iframe.contentWindow) {
        return;
      }
      if (event.data && typeof event.data === "object" && event.data.type === "sidepanelFloating.close") {
        closeFloatingAssistant();
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }

  function bindFloatingResize(panel) {
    const onWindowResize = () => {
      clampPanelToViewport(panel);
      savePlacement(panel);
    };
    window.addEventListener("resize", onWindowResize);

    let saveTimer = 0;
    const observer = typeof ResizeObserver === "function"
      ? new ResizeObserver(() => {
          clampPanelToViewport(panel);
          clearTimeout(saveTimer);
          saveTimer = window.setTimeout(() => savePlacement(panel), 120);
        })
      : null;
    observer?.observe(panel);

    return () => {
      clearTimeout(saveTimer);
      window.removeEventListener("resize", onWindowResize);
      observer?.disconnect();
    };
  }

  function applyInitialPlacement(panel) {
    const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 1280;
    const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 800;
    const defaultWidth = Math.min(360, Math.max(300, viewportWidth - 16));
    const defaultHeight = Math.min(520, Math.max(400, viewportHeight - 16));
    const stored = readPlacement();
    const width = stored?.width || defaultWidth;
    const height = stored?.height || defaultHeight;
    const left = stored?.left ?? viewportWidth - width - 24;
    const top = stored?.top ?? 24;

    panel.style.width = `${Math.round(width)}px`;
    panel.style.height = `${Math.round(height)}px`;
    setPanelPosition(panel, left, top, width, height);
  }

  function setPanelPosition(panel, left, top, width, height) {
    const margin = 8;
    const maxLeft = Math.max(margin, window.innerWidth - width - margin);
    const maxTop = Math.max(margin, window.innerHeight - height - margin);
    const safeLeft = Math.min(Math.max(margin, left), maxLeft);
    const safeTop = Math.min(Math.max(margin, top), maxTop);
    panel.style.left = `${Math.round(safeLeft)}px`;
    panel.style.top = `${Math.round(safeTop)}px`;
    panel.style.right = "auto";
    panel.style.bottom = "auto";
  }

  function clampPanelToViewport(panel) {
    const rect = panel.getBoundingClientRect();
    const margin = 8;
    const maxWidth = Math.max(280, window.innerWidth - margin * 2);
    const maxHeight = Math.max(360, window.innerHeight - margin * 2);
    const width = Math.min(rect.width, maxWidth);
    const height = Math.min(rect.height, maxHeight);
    if (width !== rect.width) {
      panel.style.width = `${Math.round(width)}px`;
    }
    if (height !== rect.height) {
      panel.style.height = `${Math.round(height)}px`;
    }
    setPanelPosition(panel, rect.left, rect.top, width, height);
  }

  function readPlacement() {
    try {
      const raw = window.sessionStorage?.getItem(FLOATING_PLACEMENT_KEY);
      const parsed = raw ? JSON.parse(raw) : null;
      if (
        parsed &&
        [parsed.left, parsed.top, parsed.width, parsed.height].every((value) => Number.isFinite(value))
      ) {
        return parsed;
      }
    } catch (_error) {
      // 页面禁用存储时忽略，使用默认位置。
    }
    return null;
  }

  function savePlacement(panel) {
    try {
      const rect = panel.getBoundingClientRect();
      window.sessionStorage?.setItem(
        FLOATING_PLACEMENT_KEY,
        JSON.stringify({
          left: Math.round(rect.left),
          top: Math.round(rect.top),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        }),
      );
    } catch (_error) {
      // 页面禁用存储时仅本次会话可拖动。
    }
  }

  function ensureFloatingUrl(rawUrl) {
    try {
      const url = new URL(rawUrl);
      url.searchParams.set("floating", "1");
      return url.toString();
    } catch (_error) {
      return rawUrl;
    }
  }

  function getFloatingStyles() {
    return `
      :host {
        all: initial;
        inset: 0;
        pointer-events: none;
        position: fixed;
        z-index: 2147483647;
      }

      .assistant-floating-panel {
        background: #ffffff;
        border: 1px solid rgba(20, 95, 215, 0.18);
        border-radius: 18px;
        box-shadow:
          0 26px 70px rgba(17, 24, 39, 0.24),
          0 6px 18px rgba(17, 24, 39, 0.14);
        box-sizing: border-box;
        color: #20242a;
        display: grid;
        font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        grid-template-rows: 2.375rem minmax(0, 1fr);
        max-height: calc(100vh - 16px);
        max-width: calc(100vw - 16px);
        min-height: min(20rem, calc(100vh - 16px));
        min-width: min(18.5rem, calc(100vw - 16px));
        opacity: 0;
        overflow: hidden;
        pointer-events: auto;
        position: fixed;
        resize: both;
        transform: translateY(8px) scale(0.985);
        transition: opacity 160ms ease-out, transform 180ms ease-out, box-shadow 180ms ease-out;
      }

      .assistant-floating-panel.is-mounted {
        opacity: 1;
        transform: translateY(0) scale(1);
      }

      .assistant-floating-panel.is-dragging {
        box-shadow:
          0 30px 82px rgba(17, 24, 39, 0.3),
          0 8px 24px rgba(20, 95, 215, 0.16);
      }

      .assistant-floating-panel.is-focusing {
        animation: assistantFloatingPulse 680ms ease-out;
      }

      .assistant-floating-toolbar {
        align-items: center;
        background:
          radial-gradient(circle at 18% 0%, rgba(20, 95, 215, 0.12), transparent 32%),
          linear-gradient(180deg, rgba(255, 255, 255, 0.96), rgba(246, 249, 255, 0.94));
        border-bottom: 1px solid rgba(216, 221, 232, 0.86);
        box-sizing: border-box;
        cursor: grab;
        display: flex;
        gap: 0.5rem;
        justify-content: space-between;
        min-width: 0;
        padding: 0 0.5rem 0 0.75rem;
        touch-action: none;
        user-select: none;
      }

      .assistant-floating-panel.is-dragging .assistant-floating-toolbar {
        cursor: grabbing;
      }

      .assistant-floating-title {
        align-items: center;
        display: flex;
        gap: 0.45rem;
        min-width: 0;
      }

      .assistant-floating-title span:not(.assistant-floating-dot) {
        color: #20242a;
        font-size: 0.8125rem;
        font-weight: 700;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .assistant-floating-title small {
        color: #68707d;
        font-size: 0.6875rem;
        font-weight: 600;
        letter-spacing: 0.01em;
        white-space: nowrap;
      }

      .assistant-floating-dot {
        background: #145fd7;
        border-radius: 999px;
        box-shadow: 0 0 0 4px rgba(20, 95, 215, 0.12);
        height: 0.5rem;
        width: 0.5rem;
      }

      .assistant-floating-actions {
        align-items: center;
        display: flex;
        flex: 0 0 auto;
        gap: 0.25rem;
      }

      .assistant-floating-icon-button {
        align-items: center;
        background: transparent;
        border: 0;
        border-radius: 0.5rem;
        color: #68707d;
        cursor: pointer;
        display: inline-flex;
        font: inherit;
        font-size: 1.25rem;
        height: 1.75rem;
        justify-content: center;
        line-height: 1;
        padding: 0;
        transition: background-color 140ms ease-out, color 140ms ease-out;
        width: 1.75rem;
      }

      .assistant-floating-icon-button:hover,
      .assistant-floating-icon-button:focus-visible {
        background: #eaf0f9;
        color: #20242a;
        outline: 0;
      }

      .assistant-floating-frame {
        background: #ffffff;
        border: 0;
        height: 100%;
        width: 100%;
      }

      @keyframes assistantFloatingPulse {
        0% { box-shadow: 0 0 0 0 rgba(20, 95, 215, 0.28), 0 26px 70px rgba(17, 24, 39, 0.24); }
        100% { box-shadow: 0 0 0 14px rgba(20, 95, 215, 0), 0 26px 70px rgba(17, 24, 39, 0.24); }
      }

      @media (max-width: 520px) {
        .assistant-floating-panel {
          border-radius: 16px;
          min-width: calc(100vw - 16px);
        }

        .assistant-floating-title small {
          display: none;
        }
      }
    `;
  }

  if (!globalThis.chrome?.runtime?.onMessage) {
    return;
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (isPageContextExtractMessage(message)) {
      try {
        const result = extractPageContext({
          url: window.location.href,
          rules: message.rules,
          maxLength: message.maxLength,
          extractMode: message.extractMode || "text",
        });
        sendResponse({ ok: true, url: window.location.href, title: document.title, ...result });
      } catch (error) {
        const details = error instanceof Error ? error.message : "未知错误";
        sendResponse({ ok: false, message: `提取当前页面失败：${details}` });
      }
      return false;
    }

    if (isFloatingOpenMessage(message)) {
      try {
        sendResponse(openFloatingAssistant(message));
      } catch (error) {
        const details = error instanceof Error ? error.message : "未知错误";
        sendResponse({ ok: false, message: `打开悬浮窗失败：${details}` });
      }
      return false;
    }

    if (message && typeof message === "object" && message.type === "sidepanelFloating.close") {
      sendResponse(closeFloatingAssistant());
      return false;
    }

    return false;
  });
})();
