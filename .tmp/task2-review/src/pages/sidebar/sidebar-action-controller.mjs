import { SIDEBAR_ACTION_TYPES, SIDEBAR_MESSAGE_TYPES } from "../../shared/sidebar-contract.mjs";

export const createSidebarActionController = ({ extensionApi, domController, contextController }) => {
  const copyToClipboard = async (value) => {
    await navigator.clipboard.writeText(value);
  };

  const executeAction = async (payload) => {
    const response = await extensionApi.runtime.sendMessage({
      type: SIDEBAR_MESSAGE_TYPES.EXECUTE_ACTION,
      payload,
    });

    if (!response?.ok) {
      throw new Error(response?.error || "执行动作失败。");
    }

    if (payload.type === SIDEBAR_ACTION_TYPES.COPY) {
      await copyToClipboard(response.copyValue || payload.value || "");
      const copyReason = payload.reason || response.reason || "已复制当前页面内容。";
      domController.setFeedback(copyReason, "success");
      return {
        ok: true,
        reason: copyReason,
      };
    }

    if (
      payload.type === SIDEBAR_ACTION_TYPES.FOCUS_INPUT
      || payload.type === SIDEBAR_ACTION_TYPES.SCROLL
      || payload.type === SIDEBAR_ACTION_TYPES.RUN_SEARCH
      || payload.type === SIDEBAR_ACTION_TYPES.GO_BACK
      || payload.type === SIDEBAR_ACTION_TYPES.REFRESH_PAGE
    ) {
      await contextController.syncContext(SIDEBAR_MESSAGE_TYPES.REFRESH_CONTEXT);
    }

    const successReason = response.reason || "动作执行成功。";
    domController.setFeedback(successReason, "success");
    return {
      ok: true,
      reason: successReason,
      copyValue: response.copyValue || "",
    };
  };

  return { executeAction };
};
