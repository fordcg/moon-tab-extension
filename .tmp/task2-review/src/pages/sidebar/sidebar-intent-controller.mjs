import { SIDEBAR_RESULT_KINDS } from "../../shared/sidebar-contract.mjs";

const TOOL_PROMPT_PATTERN = /(打开|切到|切换|刷新|返回|后退|滚动|复制|聚焦|搜索页内|查找|新标签页)/;
const MIXED_PROMPT_PATTERN = /(先|然后|再帮我|并且|顺便)/;

export const createSidebarIntentController = () => ({
  classifyPrompt(prompt = "") {
    const normalizedPrompt = prompt.trim();
    if (!normalizedPrompt) {
      return SIDEBAR_RESULT_KINDS.ANSWER;
    }

    if (MIXED_PROMPT_PATTERN.test(normalizedPrompt) && TOOL_PROMPT_PATTERN.test(normalizedPrompt)) {
      return SIDEBAR_RESULT_KINDS.MIXED;
    }

    if (TOOL_PROMPT_PATTERN.test(normalizedPrompt)) {
      return SIDEBAR_RESULT_KINDS.TOOL;
    }

    return SIDEBAR_RESULT_KINDS.ANSWER;
  },
});
