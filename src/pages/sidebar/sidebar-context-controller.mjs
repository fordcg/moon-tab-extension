import { SIDEBAR_MESSAGE_TYPES } from "../../shared/sidebar-contract.mjs";

const DISCONNECTED_STATUS = "未连接网页";
const DISCONNECTED_TITLE = "请先打开一个普通网页";
const DISCONNECTED_MESSAGE = "当前窗口没有可连接的网页标签页，请先打开一个普通网页。";

const buildUnavailablePageState = (errorMessage) => ({
  available: false,
  status: DISCONNECTED_STATUS,
  title: DISCONNECTED_TITLE,
  url: "",
  hasSelection: false,
  hasMainText: false,
  feedbackMessage: errorMessage || DISCONNECTED_MESSAGE,
  feedbackTone: "error",
});

const buildAvailablePageState = (context) => ({
  available: true,
  status: "当前页面已准备好",
  title: context?.title || "未命名页面",
  url: context?.url || "",
  hasSelection: Boolean(context?.selectionText),
  hasMainText: Boolean(context?.mainText),
  feedbackMessage: "这一页已经准备好了，可以直接问我。",
  feedbackTone: "success",
});

export const createSidebarContextController = ({ extensionApi, domController }) => {
  let latestContext = null;
  let latestPageState = buildUnavailablePageState(DISCONNECTED_MESSAGE);
  let lastFetchedAt = 0;

  const CONTEXT_FRESHNESS_MS = 30_000;

  const syncContextAvailability = async (messageType = SIDEBAR_MESSAGE_TYPES.GET_ACTIVE_CONTEXT) => {
    const response = await extensionApi.runtime.sendMessage({ type: messageType });
    if (!response?.ok || !response.context) {
      latestContext = null;
      lastFetchedAt = 0;
      latestPageState = buildUnavailablePageState(response?.error || DISCONNECTED_MESSAGE);
      return latestPageState;
    }

    latestContext = response.context;
    lastFetchedAt = Date.now();
    latestPageState = buildAvailablePageState(latestContext);
    return latestPageState;
  };

  const isCachedContextFresh = () => {
    if (!latestContext || !lastFetchedAt) {
      return false;
    }

    return Date.now() - lastFetchedAt < CONTEXT_FRESHNESS_MS;
  };

  const syncContext = async (messageType = SIDEBAR_MESSAGE_TYPES.GET_ACTIVE_CONTEXT) => {
    if (isCachedContextFresh()) {
      return latestContext;
    }

    const pageState = await syncContextAvailability(messageType);
    domController.renderContext(pageState);
    domController.setFeedback(pageState.feedbackMessage, pageState.feedbackTone);
    if (!pageState.available) {
      throw new Error(pageState.feedbackMessage);
    }

    return latestContext;
  };

  return {
    syncContext,
    syncContextAvailability,
    getLatestContext: () => latestContext,
    getLatestPageState: () => latestPageState,
    invalidateContext() {
      latestContext = null;
      latestPageState = buildUnavailablePageState(DISCONNECTED_MESSAGE);
      lastFetchedAt = 0;
    },
  };
};
