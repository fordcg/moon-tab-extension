const DEFAULT_DURATION_MS = 3000;
const REDUCED_MOTION_DURATION_MS = 120;
const COMMAND_REVEAL_START_MS = 160;
const COMMAND_REVEAL_INTERVAL_MS = 300;
const DEFAULT_COMMANDS = Object.freeze([
  { level: "info", text: "[记录] 风从门缝里灌进来……" },
  { level: "success", text: "> 找到一小堆干木头" },
  { level: "success", text: "> 检查火种" },
  { level: "info", text: "[记录] 旅程存档：本地" },
  { level: "success", text: "> 推开沉重的木门" },
  { level: "alert", text: "[警告] 屋里冷得像冰" },
  { level: "success", text: "> 暗室已就绪" },
]);

const getDocument = (documentRef) => documentRef ?? document;

const getPrefersReducedMotion = (windowRef) =>
  Boolean(windowRef?.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches);

const removeExistingOverlay = (documentRef) => {
  documentRef.querySelector("[data-page-transition-overlay]")?.remove();
};

const createCommandList = ({ documentRef, commands }) => {
  const list = documentRef.createElement("div");
  list.className = "page-transition-overlay__commands";
  list.setAttribute("aria-hidden", "true");

  commands.forEach((command, index) => {
    const line = documentRef.createElement("span");
    line.className = "page-transition-overlay__command";
    line.style.setProperty("--command-index", String(index));
    const normalizedCommand =
      typeof command === "string" ? { level: "success", text: command } : command;
    line.dataset.level = normalizedCommand.level ?? "success";
    line.textContent = normalizedCommand.text ?? "";
    list.appendChild(line);
  });

  return list;
};

const createOverlay = ({ documentRef, mode, commands }) => {
  const overlay = documentRef.createElement("div");
  overlay.className = "page-transition-overlay";
  overlay.dataset.pageTransitionOverlay = "true";
  overlay.dataset.mode = mode;
  overlay.setAttribute("role", "status");
  overlay.setAttribute("aria-live", "polite");

  const scan = documentRef.createElement("div");
  scan.className = "page-transition-overlay__scan";
  scan.setAttribute("aria-hidden", "true");

  overlay.append(scan, createCommandList({ documentRef, commands }));
  return overlay;
};

const revealCommands = ({ overlay, windowRef, immediate = false }) => {
  const commandNodes = Array.from(overlay.querySelectorAll(".page-transition-overlay__command"));
  if (immediate) {
    commandNodes.forEach((command) => {
      command.dataset.visible = "true";
    });
    return [];
  }

  return commandNodes.map((command, index) =>
    windowRef.setTimeout(() => {
      command.dataset.visible = "true";
    }, COMMAND_REVEAL_START_MS + index * COMMAND_REVEAL_INTERVAL_MS),
  );
};

const clearRevealTimers = ({ windowRef, timers }) => {
  timers.forEach((timer) => {
    windowRef.clearTimeout(timer);
  });
};

const revealAllCommands = (overlay) => {
  overlay.querySelectorAll(".page-transition-overlay__command").forEach((command) => {
    command.dataset.visible = "true";
  });
};

export const runPageTransition = async ({
  documentRef,
  windowRef,
  label,
  mode = "enter-game",
  commands = DEFAULT_COMMANDS,
  onComplete,
}) => {
  const resolvedDocument = getDocument(documentRef);
  const resolvedWindow = windowRef ?? window;
  const prefersReducedMotion = getPrefersReducedMotion(resolvedWindow);
  const duration = prefersReducedMotion ? REDUCED_MOTION_DURATION_MS : DEFAULT_DURATION_MS;

  removeExistingOverlay(resolvedDocument);
  const overlay = createOverlay({
    documentRef: resolvedDocument,
    mode,
    commands,
  });
  if (prefersReducedMotion) {
    overlay.dataset.reducedMotion = "true";
  }

  resolvedDocument.body.appendChild(overlay);
  const revealTimers = revealCommands({
    overlay,
    windowRef: resolvedWindow,
    immediate: prefersReducedMotion,
  });
  resolvedWindow.requestAnimationFrame(() => {
    overlay.dataset.state = "active";
  });

  await new Promise((resolve) => {
    resolvedWindow.setTimeout(resolve, duration);
  });
  clearRevealTimers({ windowRef: resolvedWindow, timers: revealTimers });
  revealAllCommands(overlay);

  if (typeof onComplete === "function") {
    onComplete();
    return;
  }

  overlay.remove();
};
