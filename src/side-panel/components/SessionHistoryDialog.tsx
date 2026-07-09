import * as Dialog from "@radix-ui/react-dialog";
import { useEffect, useState } from "react";
import { SessionList } from "./SessionList";
import type { SettingsTab } from "./SettingsPanel";
import { useAppStore } from "../state/appStore";

interface SessionHistoryDialogProps {
  browserControlEnabled: boolean;
  open: boolean;
  transitionClassName?: string;
  onOpenChange: (open: boolean) => void;
  onOpenAgentTools: () => void;
  onOpenSettings: (tab?: SettingsTab) => void;
  onToggleBrowserControl: () => void;
}

const BROWSER_CONTROL_ICON_PATHS = [
  "M5 5h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Z",
  "M3 9h18M12 12v4M10 14h4",
];
const TOOLS_ICON_PATHS = [
  "M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3",
  "M2 14h4M10 8h4M18 16h4",
];
const SETTINGS_ICON_PATHS = [
  "M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z",
  "M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2Z",
];
const RECENT_HISTORY_COMPACT_LIMIT = 5;
type HistoryDrawerMode = "compact" | "expanded";

export function SessionHistoryDialog({ browserControlEnabled, open, transitionClassName = "", onOpenAgentTools, onOpenChange, onOpenSettings, onToggleBrowserControl }: SessionHistoryDialogProps) {
  const [historyMode, setHistoryMode] = useState<HistoryDrawerMode>("compact");
  const activeHistoryCount = useAppStore((state) => state.chatSessions.filter((session) => !session.archived).length);
  const expanded = historyMode === "expanded";
  const showMoreAction = activeHistoryCount > RECENT_HISTORY_COMPACT_LIMIT;
  const openSettings = (tab?: SettingsTab) => {
    onOpenSettings(tab);
  };

  useEffect(() => {
    if (!open) {
      setHistoryMode("compact");
    }
  }, [open]);

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content
          className={[
            expanded ? "drawer-panel history-dialog history-drawer is-history-expanded" : "drawer-panel history-dialog history-drawer",
            transitionClassName,
          ]
            .filter(Boolean)
            .join(" ")}
          data-sidepanel-history-mode={historyMode}
        >
          <div className="drawer-header">
            <Dialog.Title className="history-dialog-title">历史记录</Dialog.Title>
            <Dialog.Description className="sr-only">浏览和管理历史对话</Dialog.Description>
          </div>
          <div className="sidepanel-history-more-header">
            <button className="sidepanel-history-back" type="button" aria-label="返回近期对话菜单" onClick={() => setHistoryMode("compact")}>
              返回
            </button>
          </div>
          <div className="history-dialog-body">
            <div className="history-dialog-scroll">
              <SessionList compact compactExpanded={expanded} compactVisibleLimit={RECENT_HISTORY_COMPACT_LIMIT} />
            </div>
            {showMoreAction && !expanded ? (
              <button className="sidepanel-history-more-action" type="button" aria-label="查看更多近期对话" onClick={() => setHistoryMode("expanded")}>
                更多
              </button>
            ) : null}
          </div>
          <div className="sidepanel-drawer-footer" data-variant="recent-menu">
            <DrawerAction
              active={browserControlEnabled}
              ariaPressed={browserControlEnabled}
              className="sidepanel-browser-control-action"
              iconPaths={BROWSER_CONTROL_ICON_PATHS}
              label="浏览器控制"
              status={browserControlEnabled ? "已开启" : "已关闭"}
              title={browserControlEnabled ? "浏览器控制已开启。点击后关闭。" : "浏览器控制已关闭。点击后开启。"}
              onClick={onToggleBrowserControl}
            />
            <DrawerAction iconPaths={TOOLS_ICON_PATHS} label="工具和 MCP" onClick={onOpenAgentTools} />
            <DrawerAction chevron iconPaths={SETTINGS_ICON_PATHS} label="设置和帮助" onClick={() => openSettings("channels")} />
          </div>
          {expanded ? (
            <div className="sidepanel-history-scrollbar" aria-hidden="true">
              <div className="sidepanel-history-scrollbar-thumb" />
            </div>
          ) : null}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

interface DrawerActionProps {
  active?: boolean;
  ariaPressed?: boolean;
  chevron?: boolean;
  className?: string;
  iconPaths: string[];
  label: string;
  status?: string;
  title?: string;
  onClick: () => void;
}

function DrawerAction({ active = false, ariaPressed, chevron = false, className = "", iconPaths, label, status, title, onClick }: DrawerActionProps) {
  return (
    <button
      className={[
        "sidepanel-drawer-action",
        chevron ? "sidepanel-drawer-action-chevron" : "",
        active ? "is-enabled" : "",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      type="button"
      aria-pressed={ariaPressed}
      title={title}
      onClick={onClick}
    >
      <svg viewBox="0 0 24 24" aria-hidden="true">
        {iconPaths.map((path) => (
          <path key={path} d={path} />
        ))}
      </svg>
      <span>{label}</span>
      {status ? (
        <span className="sidepanel-drawer-action-status" aria-hidden="true">
          {status}
        </span>
      ) : null}
    </button>
  );
}
