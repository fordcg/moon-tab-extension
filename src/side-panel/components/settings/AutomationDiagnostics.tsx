import { useEffect, useState } from "react";
import { useAppStore } from "../../state/appStore";

export function AutomationDiagnostics() {
  const diagnostics = useAppStore((state) => state.browserAutomationDiagnostics);
  const refresh = useAppStore((state) => state.refreshBrowserAutomationDiagnostics);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (!globalThis.chrome?.runtime?.onMessage?.addListener) {
      return;
    }
    void refresh();
  }, [refresh]);

  const summary = diagnostics
    ? `${diagnostics.browserControlAttached ? "已连接" : "未连接"} · ${diagnostics.availableToolCount ?? 0}/${(diagnostics.availableToolCount ?? 0) + (diagnostics.disabledToolCount ?? 0)} 工具可用`
    : "未读取";

  return (
    <section className="grid w-full gap-3 border-b border-[var(--color-hairline)] pb-4" aria-labelledby="automation-diagnostics-title">
      <div className="flex min-w-0 items-center justify-between gap-3">
        <button
          className="automation-diagnostics-toggle min-w-0 text-left"
          type="button"
          aria-expanded={expanded}
          aria-controls="automation-diagnostics-panel"
          onClick={() => setExpanded((value) => !value)}
        >
          <span id="automation-diagnostics-title" className="text-base font-semibold">
            浏览器自动化诊断
          </span>
          <span className="automation-diagnostics-toggle-meta ui-muted text-xs">{summary}</span>
        </button>
        <button className="ui-button-secondary shrink-0 px-3 py-1 text-xs" type="button" onClick={() => void refresh()}>
          刷新
        </button>
      </div>
      {expanded ? (
        <dl id="automation-diagnostics-panel" className="grid gap-2 text-sm sm:grid-cols-2">
          <div className="grid min-w-0 gap-1">
            <dt className="ui-muted text-xs">Debugger 权限</dt>
            <dd className="min-w-0 truncate">{diagnostics?.debuggerPermissionDeclared ? "已声明" : "未声明"}</dd>
          </div>
          <div className="grid min-w-0 gap-1">
            <dt className="ui-muted text-xs">连接状态</dt>
            <dd className="min-w-0 truncate">{diagnostics?.browserControlAttached ? "已连接" : "未连接"}</dd>
          </div>
          <div className="grid min-w-0 gap-1">
            <dt className="ui-muted text-xs">Network 来源</dt>
            <dd className="min-w-0 truncate">{diagnostics?.networkSource ?? "unavailable"}</dd>
          </div>
          <div className="grid min-w-0 gap-1">
            <dt className="ui-muted text-xs">工具状态</dt>
            <dd className="min-w-0 truncate">{`${diagnostics?.availableToolCount ?? 0} 可用 / ${diagnostics?.disabledToolCount ?? 0} 不可用`}</dd>
          </div>
        </dl>
      ) : null}
    </section>
  );
}
