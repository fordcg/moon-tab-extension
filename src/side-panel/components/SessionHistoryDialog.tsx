import * as Dialog from "@radix-ui/react-dialog";
import { useEffect, useRef, useState, type RefObject } from "react";
import { NotificationHost } from "./NotificationHost";
import { SessionList } from "./SessionList";
import { SettingsPanel, type SettingsTab } from "./SettingsPanel";
import { useAppStore } from "../state/appStore";

export type SidePanelDrawerPage = "history" | "settings";

interface SessionHistoryDialogProps {
  open: boolean;
  page: SidePanelDrawerPage;
  origin: "header" | "history";
  settingsInitialTab: SettingsTab;
  onOpenChange: (open: boolean) => void;
  onOpenSettings: (tab?: SettingsTab) => void;
  onReturnToHistory: () => void;
  onRestoreFocus: () => void;
}

const SETTINGS_ICON_PATHS = [
  "M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z",
  "M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2Z",
];
const RECENT_HISTORY_COMPACT_LIMIT = 5;
type HistoryDrawerMode = "compact" | "expanded";
// Both enter and return are single-phase: shell height flips immediately,
// and page content slides in parallel (no two-phase out→swap→in).
type DrawerPageTransition = "history-to-settings" | "settings-to-history" | "";
type HistoryPageTransition = "is-history-page-in-left" | "is-history-page-in-right" | "is-history-page-out-left" | "is-history-page-out-right" | "";

function usePrefersReducedMotion() {
  const getValue = () => typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const [reducedMotion, setReducedMotion] = useState(getValue);

  useEffect(() => {
    if (typeof window.matchMedia !== "function") {
      return;
    }

    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReducedMotion(media.matches);
    update();
    media.addEventListener?.("change", update);
    return () => media.removeEventListener?.("change", update);
  }, []);

  return reducedMotion;
}

export function SessionHistoryDialog({
  open,
  page,
  origin,
  settingsInitialTab,
  onOpenChange,
  onOpenSettings,
  onReturnToHistory,
  onRestoreFocus,
}: SessionHistoryDialogProps) {
  const [historyMode, setHistoryMode] = useState<HistoryDrawerMode>("compact");
  const [historyPageTransitionClassName, setHistoryPageTransitionClassName] = useState<HistoryPageTransition>("");
  const [visiblePage, setVisiblePage] = useState<SidePanelDrawerPage>(page);
  const [drawerTransition, setDrawerTransition] = useState<DrawerPageTransition>("");
  const [drawerTransitionHeight, setDrawerTransitionHeight] = useState<number | null>(null);
  // Keep settings mounted after first open so later history↔settings slides
  // don't pay SettingsPanel mount cost mid-animation.
  const [settingsMounted, setSettingsMounted] = useState(page === "settings");
  const wasOpenRef = useRef(false);
  const drawerTransitionTargetRef = useRef<SidePanelDrawerPage | null>(null);
  const historyTransitionTargetRef = useRef<HistoryDrawerMode | null>(null);
  const pendingDrawerFocusPageRef = useRef<SidePanelDrawerPage | null>(null);
  const pendingHistoryFocusModeRef = useRef<HistoryDrawerMode | null>(null);
  const drawerContentRef = useRef<HTMLDivElement>(null);
  const drawerPagesRef = useRef<HTMLDivElement>(null);
  const historyDrawerPageRef = useRef<HTMLDivElement>(null);
  const settingsDrawerPageRef = useRef<HTMLDivElement>(null);
  const historyContentRef = useRef<HTMLDivElement>(null);
  const settingsActionRef = useRef<HTMLButtonElement>(null);
  const settingsBackButtonRef = useRef<HTMLButtonElement>(null);
  const settingsCloseButtonRef = useRef<HTMLButtonElement>(null);
  const historyBackButtonRef = useRef<HTMLButtonElement>(null);
  const historyMoreButtonRef = useRef<HTMLButtonElement>(null);
  const activeHistoryCount = useAppStore((state) => state.chatSessions.filter((session) => !session.archived).length);
  const reducedMotion = usePrefersReducedMotion();
  const expanded = historyMode === "expanded";
  const showMoreAction = activeHistoryCount > RECENT_HISTORY_COMPACT_LIMIT;
  const displayedPage = open && !wasOpenRef.current ? page : visiblePage;
  const drawerTransitionTarget = drawerTransitionTargetRef.current;
  const showHistoryPage = displayedPage === "history" || drawerTransitionTarget === "history";
  // Once warmed, keep settings mounted for the life of the open drawer so reverse
  // slides and repeat opens don't remount SettingsPanel. Idle CSS still hides the
  // inactive page via aria-hidden so both never paint side-by-side.
  const showSettingsPage =
    displayedPage === "settings" || drawerTransitionTarget === "settings" || (open && settingsMounted);
  const activePage = drawerTransitionTarget ?? displayedPage;
  // Drive shell chrome/height from the active (target) page so enter and return
  // both flip height at click — waiting until animation end caused a hitch.
  const shellPage = activePage;

  const queueDrawerPageFocus = (nextPage: SidePanelDrawerPage) => {
    pendingDrawerFocusPageRef.current = nextPage;
  };

  const queueHistoryModeFocus = (nextMode: HistoryDrawerMode) => {
    pendingHistoryFocusModeRef.current = nextMode;
  };

  useEffect(() => {
    const nextPage = pendingDrawerFocusPageRef.current;
    if (!open || drawerTransition || page !== visiblePage || nextPage !== visiblePage) {
      return;
    }

    const target = nextPage === "settings"
      ? origin === "history"
        ? settingsBackButtonRef.current ?? settingsCloseButtonRef.current
        : settingsCloseButtonRef.current ?? settingsBackButtonRef.current
      : historyMode === "expanded"
        ? historyBackButtonRef.current
        : settingsActionRef.current;
    if (!target?.isConnected) {
      return;
    }

    pendingDrawerFocusPageRef.current = null;
    target.focus({ preventScroll: true });
  }, [drawerTransition, historyMode, open, origin, page, visiblePage]);

  useEffect(() => {
    const nextMode = pendingHistoryFocusModeRef.current;
    if (!open || drawerTransition || page !== "history" || visiblePage !== "history" || historyPageTransitionClassName || nextMode !== historyMode) {
      return;
    }

    const target = nextMode === "expanded"
      ? historyBackButtonRef.current
      : historyMoreButtonRef.current ?? settingsActionRef.current;
    if (!target?.isConnected) {
      return;
    }

    pendingHistoryFocusModeRef.current = null;
    target.focus({ preventScroll: true });
  }, [drawerTransition, historyMode, historyPageTransitionClassName, open, page, visiblePage]);

  useEffect(() => {
    if (!open) {
      wasOpenRef.current = false;
      drawerTransitionTargetRef.current = null;
      historyTransitionTargetRef.current = null;
      pendingDrawerFocusPageRef.current = null;
      pendingHistoryFocusModeRef.current = null;
      setVisiblePage(page);
      setDrawerTransition("");
      setDrawerTransitionHeight(null);
      setHistoryPageTransitionClassName("");
      setHistoryMode("compact");
      setSettingsMounted(page === "settings");
      return;
    }

    if (!wasOpenRef.current) {
      wasOpenRef.current = true;
      setVisiblePage(page);
      setDrawerTransition("");
      setDrawerTransitionHeight(null);
      if (page === "settings") {
        setSettingsMounted(true);
      } else {
        // Warm settings after the drawer is already open so the first click on
        // 设置 only animates, instead of mounting a heavy tree mid-slide.
        const warmId = window.setTimeout(() => setSettingsMounted(true), 0);
        return () => window.clearTimeout(warmId);
      }
      return;
    }

    if (drawerTransition) {
      // Ignore prop churn while a transition is already running.
      // Reduced-motion or aborted target still snaps to the requested page.
      if (reducedMotion || drawerTransitionTargetRef.current !== page) {
        drawerTransitionTargetRef.current = null;
        setVisiblePage(page);
        setDrawerTransition("");
        setDrawerTransitionHeight(null);
        queueDrawerPageFocus(page);
      }
      return;
    }

    if (page === visiblePage) {
      return;
    }

    if (page === "settings") {
      setSettingsMounted(true);
    }

    if (reducedMotion) {
      setVisiblePage(page);
      setDrawerTransitionHeight(null);
      queueDrawerPageFocus(page);
      return;
    }

    // No pixel height lock. Enter flips to CSS settings-dialog height immediately.
    // Return lets the in-flow history page size the shell (see styles) so absolute
    // transition stacking cannot collapse the drawer to a padding-only pill.
    setDrawerTransitionHeight(null);
    drawerTransitionTargetRef.current = page;
    setDrawerTransition(visiblePage === "history" ? "history-to-settings" : "settings-to-history");
  }, [drawerTransition, open, page, reducedMotion, visiblePage]);

  const transitionHistoryMode = (nextMode: HistoryDrawerMode) => {
    if (nextMode === historyMode || historyPageTransitionClassName || drawerTransition) {
      return;
    }

    if (reducedMotion) {
      setHistoryMode(nextMode);
      queueHistoryModeFocus(nextMode);
      return;
    }

    historyTransitionTargetRef.current = nextMode;
    setHistoryPageTransitionClassName(nextMode === "expanded" ? "is-history-page-out-left" : "is-history-page-out-right");
  };

  const completeDrawerPageTransition = (completedPage: SidePanelDrawerPage) => {
    if (!drawerTransition) {
      return;
    }

    const target = drawerTransitionTargetRef.current;
    if (!target || target !== completedPage || page !== target) {
      return;
    }

    drawerTransitionTargetRef.current = null;
    setVisiblePage(target);
    setDrawerTransition("");
    setDrawerTransitionHeight(null);
    queueDrawerPageFocus(target);
  };

  const handleDrawerTrackAnimationEnd = (event: AnimationEvent) => {
    if (event.target !== event.currentTarget) {
      return;
    }

    const target = drawerTransitionTargetRef.current;
    if (!target) {
      return;
    }

    // Only the entering page should finish the transition.
    const currentPage = (event.currentTarget as HTMLElement).dataset.drawerPage;
    if (currentPage !== target) {
      return;
    }

    const animationName = typeof event.animationName === "string" ? event.animationName : "";
    if (animationName && !animationName.includes("sidepanel-slide-in")) {
      return;
    }

    completeDrawerPageTransition(target);
  };

  const handleHistoryPageTransitionEnd = (event: AnimationEvent) => {
    if (event.target !== event.currentTarget) {
      return;
    }

    if (!historyPageTransitionClassName) {
      return;
    }

    const target = historyTransitionTargetRef.current;
    if (!target) {
      return;
    }

    if (historyPageTransitionClassName === "is-history-page-out-left" || historyPageTransitionClassName === "is-history-page-out-right") {
      setHistoryMode(target);
      setHistoryPageTransitionClassName(target === "expanded" ? "is-history-page-in-right" : "is-history-page-in-left");
      return;
    }

    historyTransitionTargetRef.current = null;
    setHistoryPageTransitionClassName("");
    queueHistoryModeFocus(target);
  };

  useEffect(() => {
    if (!drawerTransition) {
      return;
    }

    const pages = [historyDrawerPageRef.current, settingsDrawerPageRef.current].filter(
      (node): node is HTMLDivElement => Boolean(node),
    );
    if (pages.length === 0) {
      return;
    }

    for (const pageNode of pages) {
      pageNode.addEventListener("animationend", handleDrawerTrackAnimationEnd);
    }
    return () => {
      for (const pageNode of pages) {
        pageNode.removeEventListener("animationend", handleDrawerTrackAnimationEnd);
      }
    };
  }, [drawerTransition, page]);

  useEffect(() => {
    const historyContent = historyContentRef.current;
    if (!historyContent || !historyPageTransitionClassName) {
      return;
    }

    historyContent.addEventListener("animationend", handleHistoryPageTransitionEnd);
    return () => historyContent.removeEventListener("animationend", handleHistoryPageTransitionEnd);
  }, [historyMode, historyPageTransitionClassName]);

  const drawerClassName = [
    "drawer-panel",
    "history-dialog",
    "history-drawer",
    "sidepanel-drawer-dialog",
    expanded ? "is-history-expanded" : "",
    shellPage === "settings" ? "settings-dialog" : "",
    drawerTransition ? "is-page-transitioning" : "",
    drawerTransition ? "is-" + drawerTransition : "",
  ]
    .filter(Boolean)
    .join(" ");
  // Active page is the transition target mid-slide, otherwise the idle page.
  // Leaving/inactive pages stay aria-hidden so pre-mounted settings never paints beside history.
  const historyPageIsInert = activePage !== "history";
  const settingsPageIsInert = activePage !== "settings";

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay sidepanel-drawer-overlay" />
        <Dialog.Content
          ref={drawerContentRef}
          className={drawerClassName}
          data-sidepanel-drawer-page={activePage}
          data-sidepanel-drawer-transition={drawerTransition || undefined}
          data-sidepanel-history-mode={historyMode}
          style={drawerTransitionHeight !== null ? { height: `${drawerTransitionHeight}px` } : undefined}
          onOpenAutoFocus={(event) => {
            // Keep the recent-menu list visually flat: no forced focus ring on first row.
            event.preventDefault();
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            onRestoreFocus();
          }}
          onEscapeKeyDown={(event) => {
            if (document.querySelector(".sidepanel-settings-select.is-model-menu-open")) {
              event.preventDefault();
            }
          }}
        >
          <Dialog.Title className="sr-only">{activePage === "settings" ? "设置" : "历史记录"}</Dialog.Title>
          <Dialog.Description className="sr-only">
            {activePage === "settings" ? "管理助手设置" : "浏览和管理历史对话"}
          </Dialog.Description>
          <div ref={drawerPagesRef} className="sidepanel-drawer-pages">
            {showHistoryPage ? (
              <div
                ref={historyDrawerPageRef}
                className="sidepanel-drawer-page sidepanel-drawer-page-history"
                data-drawer-page="history"
                aria-hidden={historyPageIsInert || undefined}
                inert={historyPageIsInert || undefined}
              >
                <div ref={historyContentRef} className={["sidepanel-history-content", historyPageTransitionClassName].filter(Boolean).join(" ")}>
                  <div className="sidepanel-history-more-header">
                    <button ref={historyBackButtonRef} className="sidepanel-history-back" type="button" aria-label="返回近期对话菜单" onClick={() => transitionHistoryMode("compact")}>
                      返回
                    </button>
                  </div>
                  <div className="history-dialog-body">
                    <div className="history-dialog-scroll">
                      <SessionList compact compactExpanded={expanded} compactVisibleLimit={RECENT_HISTORY_COMPACT_LIMIT} />
                    </div>
                    {showMoreAction && !expanded ? (
                      <button ref={historyMoreButtonRef} className="sidepanel-history-more-action" type="button" aria-label="查看更多近期对话" onClick={() => transitionHistoryMode("expanded")}>
                        更多
                      </button>
                    ) : null}
                  </div>
                  <div className="sidepanel-drawer-footer" data-variant="recent-menu">
                    <DrawerAction buttonRef={settingsActionRef} chevron iconPaths={SETTINGS_ICON_PATHS} label="设置" onClick={() => onOpenSettings("channels")} />
                  </div>
                </div>
              </div>
            ) : null}
            {showSettingsPage ? (
              <div
                ref={settingsDrawerPageRef}
                className="sidepanel-drawer-page sidepanel-drawer-page-settings"
                data-drawer-page="settings"
                aria-hidden={settingsPageIsInert || undefined}
                inert={settingsPageIsInert || undefined}
              >
                <SettingsPanel
                  embedded
                  initialTab={settingsInitialTab}
                  showBackButton={origin === "history"}
                  backButtonRef={settingsBackButtonRef}
                  closeButtonRef={settingsCloseButtonRef}
                  onBackToHistory={onReturnToHistory}
                  onClose={() => onOpenChange(false)}
                />
              </div>
            ) : null}
          </div>
          <NotificationHost />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

interface DrawerActionProps {
  active?: boolean;
  ariaPressed?: boolean;
  buttonRef?: RefObject<HTMLButtonElement | null>;
  chevron?: boolean;
  className?: string;
  iconPaths: string[];
  label: string;
  status?: string;
  title?: string;
  onClick: () => void;
}

function DrawerAction({ active = false, ariaPressed, buttonRef, chevron = false, className = "", iconPaths, label, status, title, onClick }: DrawerActionProps) {
  return (
    <button
      ref={buttonRef}
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
