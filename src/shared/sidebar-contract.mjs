export const SIDEBAR_MESSAGE_TYPES = {
  GET_ACTIVE_CONTEXT: "sidebar:get-active-context",
  EXECUTE_ACTION: "sidebar:execute-action",
  REFRESH_CONTEXT: "sidebar:refresh-context",
};

export const SIDEBAR_RUNTIME_STATES = {
  LOCKED: "locked",
  ERROR: "error",
  ACTIVE: "active",
};

export const SIDEBAR_RESULT_KINDS = {
  ANSWER: "answer",
  TOOL: "tool",
  MIXED: "mixed",
};

export const SIDEBAR_TRACE_EVENT_TYPES = {
  THINKING: "thinking",
  READING_PAGE: "reading_page",
  SELECTING_TOOL: "selecting_tool",
  EXECUTING_TOOL: "executing_tool",
  COMPLETED: "completed",
  FAILED: "failed",
};

export const SIDEBAR_CONTENT_MESSAGE_TYPES = {
  GET_CONTEXT: "sidebar:content:get-context",
  FOCUS_INPUT: "sidebar:content:focus-input",
  SCROLL: "sidebar:content:scroll",
  GO_BACK: "sidebar:content:go-back",
  RUN_PAGE_SEARCH: "sidebar:content:run-page-search",
};

export const SIDEBAR_ACTION_TYPES = {
  SCROLL: "scroll",
  OPEN_LINK: "open_link",
  SWITCH_TAB: "switch_tab",
  COPY: "copy",
  FOCUS_INPUT: "focus_input",
  NEW_TAB: "new_tab",
  REFRESH_PAGE: "refresh_page",
  GO_BACK: "go_back",
  RUN_SEARCH: "run_search",
};

export const SIDEBAR_ACTION_TYPE_SET = new Set(Object.values(SIDEBAR_ACTION_TYPES));

export const normalizeSidebarText = (value) => (typeof value === "string" ? value.trim() : "");

export const truncateSidebarText = (value, maxLength = 6000) => {
  const normalized = normalizeSidebarText(value);
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength)}…` : normalized;
};

export const isSidebarActionType = (value) => SIDEBAR_ACTION_TYPE_SET.has(value);

export const createSidebarAnswerResult = (text) => ({ kind: SIDEBAR_RESULT_KINDS.ANSWER, text });
export const createSidebarToolResult = (text, action) => ({ kind: SIDEBAR_RESULT_KINDS.TOOL, text, action });
export const createSidebarMixedResult = (text, action) => ({ kind: SIDEBAR_RESULT_KINDS.MIXED, text, action });
export const createSidebarActionResult = createSidebarToolResult;
