import { AI_CONFIG_STATES } from "../../shared/ai-config-state.mjs";
import { SIDEBAR_RUNTIME_STATES } from "../../shared/sidebar-contract.mjs";

const LOCKED_CONFIG_STATES = new Set([
  AI_CONFIG_STATES.UNCONFIGURED,
  AI_CONFIG_STATES.CONFIGURED,
]);

const ERROR_CONFIG_STATES = new Set([
  AI_CONFIG_STATES.INVALID,
]);

const DEGRADED_CONFIG_STATES = new Set([
  AI_CONFIG_STATES.DEGRADED,
]);

const buildShellState = ({ runtimeState, pageState }) => {
  const configState = runtimeState?.configState || AI_CONFIG_STATES.UNCONFIGURED;
  const pageAvailable = Boolean(pageState?.available);

  if (!pageAvailable) {
    return {
      shellState: SIDEBAR_RUNTIME_STATES.LOCKED,
      surfaceVariant: "locked",
      configState,
      pageState,
      aiStatusText: "等待连接页面",
      aiStatusTone: "neutral",
      pageStatusText: pageState?.status || "未连接网页",
      headline: "先连接一个网页标签页",
      description: pageState?.feedbackMessage || "打开一个普通网页后，侧边栏才能读取页面内容并进入对话状态。",
      detailItems: [],
      footnote: "",
      primaryActionLabel: "去完成配置",
      secondaryActionLabel: "刷新页面状态",
      feedbackMessage: pageState?.feedbackMessage || "当前窗口没有可连接的网页标签页，请先打开一个普通网页。",
      feedbackTone: "error",
      contextState: pageState,
    };
  }

  if (LOCKED_CONFIG_STATES.has(configState)) {
    return {
      shellState: SIDEBAR_RUNTIME_STATES.LOCKED,
      surfaceVariant: "locked",
      configState,
      pageState,
      aiStatusText: "尚未连接 AI",
      aiStatusTone: "neutral",
      pageStatusText: pageState.status,
      headline: "还差一步，先连上 AI",
      description: "配置好接口后，侧边栏就能结合这一页继续回答，也能帮你完成轻量、可逆的浏览器操作。",
      detailItems: [
        "填写接口地址、API Key 和模型",
        "在设置页完成一次连通测试",
      ],
      footnote: "配置只会在扩展里保存，不会离开当前页面。",
      primaryActionLabel: "去完成配置",
      secondaryActionLabel: "刷新页面状态",
      feedbackMessage: configState === AI_CONFIG_STATES.CONFIGURED
        ? "AI 配置已保存，去设置页做一次连通测试后就能开始使用。"
        : "先完成 AI 配置，侧边栏才会进入聊天可用态。",
      feedbackTone: "neutral",
      contextState: pageState,
    };
  }

  if (ERROR_CONFIG_STATES.has(configState)) {
    const errorReason = runtimeState?.lastRuntimeErrorMessage || runtimeState?.lastTestMessage || "AI 接口暂时不可用，请重新测试连接。";
    return {
      shellState: SIDEBAR_RUNTIME_STATES.ERROR,
      surfaceVariant: "error",
      configState,
      pageState,
      aiStatusText: "连接需要重新确认",
      aiStatusTone: "error",
      pageStatusText: pageState.status,
      headline: "这次没有连上，检查一下配置",
      description: errorReason,
      detailItems: [
        "确认接口地址、Key 和模型仍然有效",
        "回到设置页重新测试连接",
      ],
      footnote: "重新连通后即可继续对话，现有页面上下文不会丢失。",
      primaryActionLabel: "去设置里重新连接",
      secondaryActionLabel: "刷新页面状态",
      feedbackMessage: errorReason,
      feedbackTone: "error",
      contextState: pageState,
    };
  }

  if (DEGRADED_CONFIG_STATES.has(configState)) {
    const degradedReason = runtimeState?.lastRuntimeErrorMessage || runtimeState?.lastTestMessage || "远程 AI 暂时不稳定，请稍后重试。";
    return {
      shellState: SIDEBAR_RUNTIME_STATES.ERROR,
      surfaceVariant: "degraded",
      configState,
      pageState,
      aiStatusText: "AI 暂时不稳",
      aiStatusTone: "degraded",
      pageStatusText: pageState.status,
      headline: "现在有点不稳，稍后再试一次",
      description: degradedReason,
      detailItems: [
        "页面内容已经连接好，恢复后可以继续从这里接着问",
        "如果持续波动，可以去设置页重新测试连接",
      ],
      footnote: "设置页里仍保留最近一次连通配置，只是这次运行没有成功。",
      primaryActionLabel: "去设置页检查连接",
      secondaryActionLabel: "刷新页面状态",
      feedbackMessage: degradedReason,
      feedbackTone: "error",
      contextState: pageState,
    };
  }

  return {
    shellState: SIDEBAR_RUNTIME_STATES.ACTIVE,
    surfaceVariant: "active",
    configState,
    pageState,
    aiStatusText: "远程 AI 已就绪",
    aiStatusTone: "success",
    pageStatusText: pageState.status,
    headline: "当前页面已连接，可以开始对话",
    description: "聊天区会优先结合当前页面内容回答，也可以在需要时执行轻量、可逆的浏览器动作，并展示执行轨迹。",
    detailItems: [],
    footnote: "",
    primaryActionLabel: "",
    secondaryActionLabel: "",
    feedbackMessage: "这一页已经准备好了，可以直接问我。",
    feedbackTone: "success",
    contextState: pageState,
  };
};

export const createSidebarStateController = ({ domController, configStateReader, contextController }) => ({
  syncState: async () => {
    const [runtimeState, pageState] = await Promise.all([
      configStateReader(),
      contextController.syncContextAvailability(),
    ]);
    const shellState = buildShellState({ runtimeState, pageState });
    domController.renderShellState(shellState);
    domController.renderContext(shellState.contextState);
    domController.setFeedback(shellState.feedbackMessage, shellState.feedbackTone);
    return shellState;
  },
});
