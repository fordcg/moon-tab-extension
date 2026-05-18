import { SIDEBAR_TRACE_EVENT_TYPES } from "../../shared/sidebar-contract.mjs";

export const createSidebarExecutionController = ({ domController }) => {
  const activeEvents = [];

  const append = (type, label, status) => {
    const trace = {
      type,
      label,
      status,
      timestamp: new Date().toISOString(),
    };
    activeEvents.push(trace);
    domController.appendTrace(trace);
    return trace;
  };

  return {
    reset() {
      activeEvents.length = 0;
      domController.clearTrace();
    },
    start(type, label) {
      return append(type, label, "running");
    },
    finish(type, label) {
      return append(type, label, "done");
    },
    fail(type, label) {
      return append(type, label, "failed");
    },
    markCompleted(label = "已完成") {
      return append(SIDEBAR_TRACE_EVENT_TYPES.COMPLETED, label, "done");
    },
    markFailed(label = "执行失败") {
      return append(SIDEBAR_TRACE_EVENT_TYPES.FAILED, label, "failed");
    },
    getEvents() {
      return [...activeEvents];
    },
  };
};
