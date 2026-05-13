(() => {
  const normalizeText = (value) => (typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "");

  const truncateText = (value, maxLength = 12000) => {
    const normalized = normalizeText(value);
    return normalized.length > maxLength ? `${normalized.slice(0, maxLength)}…` : normalized;
  };

  const pickMainText = () => {
    const candidate = document.querySelector("main, article, [role='main']");
    const root = candidate instanceof HTMLElement ? candidate : document.body;
    return truncateText(root?.innerText ?? "");
  };

  const pickSelectionText = () => normalizeText(globalThis.getSelection?.()?.toString() ?? "");

  const pickLinkCandidates = () =>
    Array.from(document.querySelectorAll("a[href]"))
      .slice(0, 40)
      .map((anchor) => ({
        title: normalizeText(anchor.textContent ?? ""),
        url: anchor.href,
      }))
      .filter((item) => item.title && item.url);

  const pickInputCandidates = () =>
    Array.from(document.querySelectorAll("input, textarea, [contenteditable='true']"))
      .slice(0, 20)
      .map((element, index) => ({
        id: element.id || `input-${index}`,
        tagName: element.tagName.toLowerCase(),
        type: element instanceof HTMLInputElement ? element.type : "text",
        placeholder: normalizeText(element.getAttribute("placeholder") ?? ""),
      }));

  const readPageContext = () => ({
    title: normalizeText(document.title),
    url: globalThis.location.href,
    selectionText: pickSelectionText(),
    mainText: pickMainText(),
    links: pickLinkCandidates(),
    inputs: pickInputCandidates(),
    extractedAt: new Date().toISOString(),
  });

  const focusBestInput = () => {
    const candidate = document.querySelector("input:not([type='hidden']):not([disabled]), textarea:not([disabled]), [contenteditable='true']");
    if (!(candidate instanceof HTMLElement)) {
      return { ok: false, reason: "未找到可聚焦的输入框。" };
    }

    candidate.focus({ preventScroll: false });
    return { ok: true, reason: "已聚焦页面输入区域。" };
  };

  const scrollPage = (payload = {}) => {
    const behavior = "smooth";
    if (payload.target === "top") {
      globalThis.scrollTo({ top: 0, behavior });
      return { ok: true, reason: "已滚动到顶部。" };
    }

    if (payload.target === "bottom") {
      globalThis.scrollTo({ top: document.documentElement.scrollHeight, behavior });
      return { ok: true, reason: "已滚动到底部。" };
    }

    const delta = typeof payload.delta === "number" ? payload.delta : 640;
    globalThis.scrollBy({ top: delta, behavior });
    return { ok: true, reason: "已滚动页面。" };
  };

  const goBack = () => {
    if (globalThis.history.length <= 1) {
      return { ok: false, reason: "当前页面没有可返回的历史记录。" };
    }

    globalThis.history.back();
    return { ok: true, reason: "已返回上一页。" };
  };

  const runPageSearch = (payload = {}) => {
    const query = normalizeText(payload.query ?? "");
    if (!query) {
      return { ok: false, reason: "请输入页内查找关键词。" };
    }

    const found = globalThis.find?.(query, false, false, true, false, false, false);
    if (!found) {
      return { ok: false, reason: `没有在当前页面找到“${query}”。` };
    }

    return { ok: true, reason: `已在当前页面定位“${query}”。` };
  };

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === "sidebar:content:get-context") {
      sendResponse({ ok: true, context: readPageContext() });
      return false;
    }

    if (message?.type === "sidebar:content:focus-input") {
      sendResponse(focusBestInput());
      return false;
    }

    if (message?.type === "sidebar:content:scroll") {
      sendResponse(scrollPage(message.payload));
      return false;
    }

    if (message?.type === "sidebar:content:go-back") {
      sendResponse(goBack());
      return false;
    }

    return false;
  });
})();
