import { createCachedSettingsReader } from "../../shared/search-settings.mjs";
import { createSidebarActionController } from "./sidebar-action-controller.mjs";
import { createSidebarAiController } from "./sidebar-ai-controller.mjs";
import { createSidebarChatController } from "./sidebar-chat-controller.mjs";
import { createSidebarContextController } from "./sidebar-context-controller.mjs";
import { createSidebarDomController } from "./sidebar-dom-controller.mjs";
import { createSidebarExecutionController } from "./sidebar-execution-controller.mjs";
import { createSidebarIntentController } from "./sidebar-intent-controller.mjs";
import { createSidebarStateController } from "./sidebar-state-controller.mjs";

const extensionApi = typeof chrome !== "undefined" ? chrome : null;
const settingsCache = createCachedSettingsReader(extensionApi);

const elements = {
  shell: document.querySelector(".sidebar-shell"),
  lockedState: document.getElementById("sidebar-locked-state"),
  errorState: document.getElementById("sidebar-error-state"),
  chatShell: document.getElementById("sidebar-chat-shell"),
  topbarSettingsButton: document.getElementById("sidebar-topbar-settings-button"),
  openSettingsButton: document.getElementById("sidebar-open-settings-button"),
  refreshShellButton: document.getElementById("sidebar-refresh-shell-button"),
  retestButton: document.getElementById("sidebar-retest-button"),
  editConfigButton: document.getElementById("sidebar-edit-config-button"),
  topbarAiStatus: document.getElementById("sidebar-topbar-ai-status"),
  errorMessage: document.getElementById("sidebar-error-message"),
  quickActionButtons: Array.from(document.querySelectorAll(".sidebar-quick-action")),
  suggestionButtons: Array.from(document.querySelectorAll("[data-sidebar-suggestion]")),
  messages: document.getElementById("sidebar-messages"),
  trace: document.getElementById("sidebar-trace"),
  emptyState: document.querySelector("[data-sidebar-empty-state]"),
  form: document.getElementById("sidebar-form"),
  input: document.getElementById("sidebar-input"),
  submitButton: document.getElementById("sidebar-submit"),
  feedback: document.getElementById("sidebar-feedback"),
  contextStatus: document.getElementById("sidebar-context-status"),
  contextTitle: document.getElementById("sidebar-context-title"),
  contextUrl: document.getElementById("sidebar-context-url"),
};

const domController = createSidebarDomController(elements);
const contextController = createSidebarContextController({ extensionApi, domController });
const intentController = createSidebarIntentController();
const executionController = createSidebarExecutionController({ domController });
const aiController = createSidebarAiController({
  intentController,
  settingsReader: () => settingsCache.getSettings(),
  invalidateSettingsCache: () => settingsCache.invalidate(),
});
const actionController = createSidebarActionController({ extensionApi, domController, contextController });
const chatController = createSidebarChatController({
  domController,
  contextController,
  actionController,
  aiController,
  executionController,
});
const stateController = createSidebarStateController({
  domController,
  configStateReader: () => settingsCache.getConfigState(),
  contextController,
});

const runTaskSafely = async (task) => {
  try {
    await task();
  } catch (error) {
    domController.setFeedback(error instanceof Error ? error.message : "这次没有顺利完成。", "error");
  }
};

let submitHandler = async (prompt) => {
  await chatController.handlePromptSubmit(prompt);
  await stateController.syncState();
};

const submitPrompt = async (prompt) => {
  const nextPrompt = prompt.trim();
  if (!nextPrompt) {
    return;
  }

  await runTaskSafely(async () => {
    await submitHandler(nextPrompt);
    if (elements.input instanceof HTMLTextAreaElement) {
      elements.input.value = "";
    }
  });
};

const openSettingsEntry = () => {
  if (!extensionApi?.tabs?.create) {
    return;
  }

  extensionApi.tabs.create({ url: extensionApi.runtime.getURL("src/pages/newtab/index.html"), active: true });
};

if (extensionApi?.tabs?.onActivated) {
  extensionApi.tabs.onActivated.addListener(() => {
    contextController.invalidateContext();
    void runTaskSafely(() => stateController.syncState());
  });
}

if (extensionApi?.tabs?.onUpdated) {
  extensionApi.tabs.onUpdated.addListener((_tabId, changeInfo) => {
    if (typeof changeInfo?.url === "string" || changeInfo?.status === "loading") {
      contextController.invalidateContext();
      void runTaskSafely(() => stateController.syncState());
    }
  });
}

elements.form?.addEventListener("submit", (event) => {
  event.preventDefault();
  const prompt = elements.input instanceof HTMLTextAreaElement ? elements.input.value : "";
  void submitPrompt(prompt);
});

elements.input?.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    const prompt = elements.input instanceof HTMLTextAreaElement ? elements.input.value : "";
    void submitPrompt(prompt);
  }
});

elements.quickActionButtons.forEach((button) => {
  button.addEventListener("click", () => {
    void runTaskSafely(() => chatController.handleQuickAction(button.dataset.quickAction ?? ""));
  });
});

elements.suggestionButtons.forEach((button) => {
  button.addEventListener("click", () => {
    void submitPrompt(button.dataset.sidebarSuggestion ?? "");
  });
});

elements.topbarSettingsButton?.addEventListener("click", openSettingsEntry);
elements.openSettingsButton?.addEventListener("click", openSettingsEntry);
elements.editConfigButton?.addEventListener("click", openSettingsEntry);
elements.refreshShellButton?.addEventListener("click", () => {
  void runTaskSafely(() => stateController.syncState());
});
elements.retestButton?.addEventListener("click", openSettingsEntry);

window.__SIDEBAR_TEST_HOOKS__ = {
  setSubmitHandler(nextHandler) {
    submitHandler = nextHandler;
  },
  syncState() {
    return stateController.syncState();
  },
};

void runTaskSafely(() => stateController.syncState());
