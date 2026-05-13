import {
  SIDEBAR_ACTION_TYPES,
  SIDEBAR_RESULT_KINDS,
  SIDEBAR_TRACE_EVENT_TYPES,
} from "../../shared/sidebar-contract.mjs";

export const createSidebarChatController = ({
  domController,
  contextController,
  actionController,
  aiController,
  executionController,
}) => {
  const finalizeInteraction = () => {
    domController.clearPendingAssistantMessage();
    domController.setBusy(false);
  };

  const appendFinalAssistantMessage = (result, actionResponse) => {
    if (result.kind === SIDEBAR_RESULT_KINDS.TOOL) {
      domController.appendMessage({
        role: "assistant",
        text: actionResponse?.reason || result.text,
        kind: "tool_result",
      });
      return;
    }

    if (result.kind === SIDEBAR_RESULT_KINDS.MIXED) {
      domController.appendMessage({
        role: "assistant",
        text: actionResponse?.reason || "已完成工具动作。",
        kind: "tool_result",
      });
      const assistantText = typeof result.text === "string" && result.text.trim()
        ? result.text.trim()
        : "已为你完成这个请求。";
      domController.appendMessage({
        role: "assistant",
        text: assistantText,
        kind: "assistant",
      });
      return;
    }

    domController.appendMessage({
      role: "assistant",
      text: result.text,
      kind: "assistant",
    });
  };

  const handlePromptSubmit = async (input) => {
    const prompt = input.trim();
    if (!prompt) {
      return;
    }

    domController.appendMessage({ role: "user", text: prompt, kind: "user" });
    domController.setBusy(true);
    domController.showPendingAssistantMessage();
    executionController.reset();
    executionController.start(SIDEBAR_TRACE_EVENT_TYPES.THINKING, "正在分析你的请求");

    try {
      executionController.finish(SIDEBAR_TRACE_EVENT_TYPES.THINKING, "已完成意图判断");
      executionController.start(SIDEBAR_TRACE_EVENT_TYPES.READING_PAGE, "正在读取当前页面上下文");
      const latestContext = await contextController.syncContext();
      executionController.finish(SIDEBAR_TRACE_EVENT_TYPES.READING_PAGE, "已读取当前页面上下文");

      const result = await aiController.resolvePrompt(prompt, latestContext);
      domController.clearPendingAssistantMessage();

      if (result.kind === SIDEBAR_RESULT_KINDS.ANSWER) {
        executionController.markCompleted("已完成回答");
        appendFinalAssistantMessage(result);
        domController.setFeedback("已经准备好这一页的回答。", "success");
        return;
      }

      executionController.start(SIDEBAR_TRACE_EVENT_TYPES.SELECTING_TOOL, "已选择合适的工具");
      executionController.finish(SIDEBAR_TRACE_EVENT_TYPES.SELECTING_TOOL, "准备执行工具动作");
      executionController.start(SIDEBAR_TRACE_EVENT_TYPES.EXECUTING_TOOL, result.text);

      try {
        const actionResponse = await actionController.executeAction(result.action);
        executionController.finish(SIDEBAR_TRACE_EVENT_TYPES.EXECUTING_TOOL, actionResponse?.reason || "动作已完成");
        executionController.markCompleted(result.kind === SIDEBAR_RESULT_KINDS.MIXED ? "已完成回答和动作" : "已完成工具动作");
        appendFinalAssistantMessage(result, actionResponse);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "执行失败";
        executionController.fail(SIDEBAR_TRACE_EVENT_TYPES.EXECUTING_TOOL, errorMessage);

        if (result.kind === SIDEBAR_RESULT_KINDS.MIXED) {
          executionController.markFailed(errorMessage);
          domController.setFeedback(errorMessage, "error");
          appendFinalAssistantMessage(result, { reason: errorMessage });
          return;
        }

        throw error;
      }
    } catch (error) {
      executionController.markFailed(error instanceof Error ? error.message : "执行失败");
      throw error;
    } finally {
      finalizeInteraction();
    }
  };

  const handleQuickAction = async (quickAction) => {
    const currentContext = contextController.getLatestContext();
    if (!currentContext) {
      throw new Error("当前页上下文尚未准备好。");
    }

    if (quickAction === "copy_title_link") {
      await actionController.executeAction({
        type: SIDEBAR_ACTION_TYPES.COPY,
        value: `${currentContext.title}\n${currentContext.url}`,
        reason: "已复制当前页面标题和链接。",
      });
      domController.appendMessage({
        role: "assistant",
        text: "已复制当前页面标题和链接。",
        kind: "tool_result",
      });
      return;
    }

    if (quickAction === "focus_input") {
      await actionController.executeAction({ type: SIDEBAR_ACTION_TYPES.FOCUS_INPUT });
      domController.appendMessage({ role: "assistant", text: "已聚焦当前页输入区域。", kind: "tool_result" });
      return;
    }

    const prompt = quickAction === "summarize" ? "请总结当前页面。" : "请提取当前页面的 3 个重点。";
    await handlePromptSubmit(prompt);
  };

  return { handlePromptSubmit, handleQuickAction };
};

