import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { DragEvent } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import type { ChatFolder, ChatSession } from "../../shared/types";
import { useAppStore } from "../state/appStore";
import type { ChatSessionBatchPartition } from "../state/appStoreChatSessions";
import type { ChatTaskMap, ChatTaskStatus } from "../state/appStoreChatTasks";
import { SessionBatchControls, type SessionBatchOperation } from "./SessionBatchControls";

interface SessionListProps {
  compact?: boolean;
  compactExpanded?: boolean;
  compactVisibleLimit?: number;
}

type DropTargetFolderId = string | undefined;
const SESSION_MENU_VIEWPORT_MARGIN = 8;
const SESSION_MENU_ANCHOR_GAP = 4;

interface SessionFolderProps {
  folderId?: string;
  title: string;
  sessions: ChatSession[];
  collapsed: boolean;
  menuPlacement?: "down" | "up";
  activeSessionId: string;
  pendingDeleteSessionId?: string;
  chatTasksBySessionId: ChatTaskMap;
  dismissedChatTaskIdsBySessionId: Record<string, string>;
  renaming: boolean;
  renamingValue: string;
  dragOver: boolean;
  onToggle: () => void;
  onStartRenameFolder?: () => void;
  folderMenuOpen?: boolean;
  pendingDeleteFolder?: boolean;
  onToggleFolderMenu?: () => void;
  onRequestDeleteFolder?: () => void;
  onConfirmDeleteFolder?: () => void;
  onRenameChange: (value: string) => void;
  onRenameCancel: () => void;
  onRenameSave: () => void;
  onRenameCommit: () => void;
  onSelect: (sessionId: string) => void;
  onArchive?: (sessionId: string) => void;
  onRenameSession: (sessionId: string) => void;
  onRequestDelete: (sessionId: string) => void;
  onConfirmDelete: (sessionId: string) => void;
  onDragStart?: (sessionId: string, event: DragEvent<HTMLElement>) => void;
  onDragEnd?: () => void;
  onDragOver: (folderId: DropTargetFolderId) => void;
  onDragLeave: () => void;
  onDrop: (folderId: DropTargetFolderId, event: DragEvent<HTMLElement>) => void;
  openMenuSessionId?: string;
  renamingSessionId?: string;
  renamingSessionValue: string;
  onToggleSessionMenu: (sessionId: string) => void;
  onCloseSessionMenu: () => void;
  onSessionRenameChange: (value: string) => void;
  onSessionRenameCancel: () => void;
  onSessionRenameSave: () => void;
  onSessionRenameCommit: () => void;
  isCompactSessionHidden?: (sessionId: string) => boolean;
  batchMode?: boolean;
  selectionEnabled?: boolean;
  selectedSessionIds?: ReadonlySet<string>;
  onToggleSessionSelection?: (sessionId: string) => void;
  onToggleFolderSelection?: (sessionIds: string[]) => void;
}

interface SessionItemProps {
  session: ChatSession;
  active: boolean;
  compactHidden?: boolean;
  menuOpen: boolean;
  menuPlacement: "down" | "up";
  renaming: boolean;
  renamingValue: string;
  pendingDelete: boolean;
  taskStatus?: ChatTaskStatus;
  onSelect: (sessionId: string) => void;
  onArchive?: (sessionId: string) => void;
  onRename: (sessionId: string) => void;
  onRequestDelete: (sessionId: string) => void;
  onConfirmDelete: (sessionId: string) => void;
  onDragStart?: (sessionId: string, event: DragEvent<HTMLElement>) => void;
  onDragEnd?: () => void;
  onToggleMenu: (sessionId: string) => void;
  onCloseMenu: () => void;
  onRenameChange: (value: string) => void;
  onRenameCancel: () => void;
  onRenameSave: () => void;
  onRenameCommit: () => void;
  batchMode?: boolean;
  selected?: boolean;
  selectionEnabled?: boolean;
  onToggleSelection?: (sessionId: string) => void;
}

function positionFloatingSessionMenu(menu: HTMLElement, button: HTMLElement) {
  const drawer = menu.closest(".history-drawer");
  const drawerRect = drawer instanceof HTMLElement
    ? drawer.getBoundingClientRect()
    : ({
        left: 0,
        right: window.innerWidth,
        top: 0,
        bottom: window.innerHeight,
      } as DOMRect);
  const buttonRect = button.getBoundingClientRect();
  const menuWidth = Math.max(menu.offsetWidth || menu.getBoundingClientRect().width, 120);
  const menuHeight = Math.max(menu.offsetHeight || menu.getBoundingClientRect().height, 112);
  const leftMin = Math.max(SESSION_MENU_VIEWPORT_MARGIN, drawerRect.left + SESSION_MENU_VIEWPORT_MARGIN);
  const leftMax = Math.max(
    leftMin,
    Math.min(window.innerWidth - menuWidth - SESSION_MENU_VIEWPORT_MARGIN, drawerRect.right - menuWidth - SESSION_MENU_VIEWPORT_MARGIN),
  );
  const topMin = Math.max(SESSION_MENU_VIEWPORT_MARGIN, drawerRect.top + SESSION_MENU_VIEWPORT_MARGIN);
  const topMax = Math.max(
    topMin,
    Math.min(window.innerHeight - menuHeight - SESSION_MENU_VIEWPORT_MARGIN, drawerRect.bottom - menuHeight - SESSION_MENU_VIEWPORT_MARGIN),
  );

  let left = buttonRect.right - menuWidth;
  let top = buttonRect.bottom + SESSION_MENU_ANCHOR_GAP;
  if (top + menuHeight > drawerRect.bottom - SESSION_MENU_VIEWPORT_MARGIN) {
    top = buttonRect.top - menuHeight - SESSION_MENU_ANCHOR_GAP;
  }

  left = Math.max(leftMin, Math.min(left, leftMax));
  top = Math.max(topMin, Math.min(top, topMax));
  menu.style.setProperty("--sidepanel-session-menu-left", `${Math.round(left)}px`);
  menu.style.setProperty("--sidepanel-session-menu-top", `${Math.round(top)}px`);
}

export function SessionList({ compact = false, compactExpanded = false, compactVisibleLimit = 5 }: SessionListProps) {
  const [collapsedFolderIds, setCollapsedFolderIds] = useState<Set<string>>(new Set());
  const [archivedCollapsed, setArchivedCollapsed] = useState(true);
  const [batchMode, setBatchMode] = useState(false);
  const [batchPartition, setBatchPartition] = useState<ChatSessionBatchPartition>("active");
  const [selectedSessionIds, setSelectedSessionIds] = useState<Set<string>>(new Set());
  const [batchConfirmOperation, setBatchConfirmOperation] = useState<SessionBatchOperation>();
  const [batchOperationPending, setBatchOperationPending] = useState(false);
  const [openMenuSessionId, setOpenMenuSessionId] = useState<string>();
  const [openMenuFolderId, setOpenMenuFolderId] = useState<string>();
  const [pendingDeleteFolderId, setPendingDeleteFolderId] = useState<string>();
  const [renamingSessionId, setRenamingSessionId] = useState<string>();
  const [renamingSessionValue, setRenamingSessionValue] = useState("");
  const [renamingFolderId, setRenamingFolderId] = useState<string>();
  const [renamingFolderValue, setRenamingFolderValue] = useState("");
  const [draggingSessionId, setDraggingSessionId] = useState<string>();
  const [dragOverFolderId, setDragOverFolderId] = useState<string>();
  const [pendingPrivateSwitchSessionId, setPendingPrivateSwitchSessionId] = useState<string>();
  const handledSessionRenameId = useRef<string | undefined>(undefined);
  const handledFolderRenameId = useRef<string | undefined>(undefined);
  const initializedCollapsedFolderIds = useRef<Set<string>>(new Set());
  const chatSessions = useAppStore((state) => state.chatSessions);
  const chatFolders = useAppStore((state) => state.chatFolders);
  const activeSessionId = useAppStore((state) => state.activeSessionId);
  const pendingDeleteSessionId = useAppStore((state) => state.pendingDeleteSessionId);
  const chatTasksBySessionId = useAppStore((state) => state.chatTasksBySessionId);
  const dismissedChatTaskIdsBySessionId = useAppStore((state) => state.dismissedChatTaskIdsBySessionId);
  const composerHasDraft = useAppStore((state) => state.composerHasDraft);
  const privateModeActive = useAppStore((state) => state.privateModeActive);
  const privateChatSession = useAppStore((state) => state.privateChatSession);
  const createChatSession = useAppStore((state) => state.createChatSession);
  const renameChatSession = useAppStore((state) => state.renameChatSession);
  const selectChatSession = useAppStore((state) => state.selectChatSession);
  const archiveChatSession = useAppStore((state) => state.archiveChatSession);
  const archiveChatSessions = useAppStore((state) => state.archiveChatSessions);
  const requestDeleteChatSession = useAppStore((state) => state.requestDeleteChatSession);
  const confirmDeleteChatSession = useAppStore((state) => state.confirmDeleteChatSession);
  const deleteChatSessions = useAppStore((state) => state.deleteChatSessions);
  const clearPendingDeleteSession = useAppStore((state) => state.clearPendingDeleteSession);
  const createChatFolder = useAppStore((state) => state.createChatFolder);
  const renameChatFolder = useAppStore((state) => state.renameChatFolder);
  const deleteEmptyChatFolder = useAppStore((state) => state.deleteEmptyChatFolder);
  const moveChatSessionToFolder = useAppStore((state) => state.moveChatSessionToFolder);
  const handleSelectChatSession = (sessionId: string) => {
    if (privateModeActive && (privateChatSession?.messages.length ?? 0) > 0) {
      setPendingPrivateSwitchSessionId(sessionId);
      return;
    }

    selectChatSession(sessionId);
  };
  const confirmPrivateSwitch = () => {
    if (!pendingPrivateSwitchSessionId) {
      return;
    }

    selectChatSession(pendingPrivateSwitchSessionId, { discardPrivateSession: true });
    setPendingPrivateSwitchSessionId(undefined);
  };

  const activeSessions = chatSessions.filter((session) => !session.archived);
  const archivedSessions = chatSessions.filter((session) => session.archived);
  const batchTargetSessions = batchPartition === "active" ? activeSessions : archivedSessions;
  const selectedBatchSessionIds = batchTargetSessions
    .filter((session) => selectedSessionIds.has(session.id))
    .map((session) => session.id);
  const defaultSessions = activeSessions.filter((session) => !session.folderId);
  const sessionsByFolder = useMemo(() => {
    return new Map(chatFolders.map((folder) => [folder.id, activeSessions.filter((session) => session.folderId === folder.id)]));
  }, [activeSessions, chatFolders]);
  const compactSessionIndexById = useMemo(() => {
    if (!compact) {
      return new Map<string, number>();
    }

    const orderedSessionIds: string[] = [];
    if (!collapsedFolderIds.has("default")) {
      orderedSessionIds.push(...defaultSessions.map((session) => session.id));
    }
    for (const folder of chatFolders) {
      if (!collapsedFolderIds.has(folder.id)) {
        orderedSessionIds.push(...(sessionsByFolder.get(folder.id) ?? []).map((session) => session.id));
      }
    }
    if (!archivedCollapsed) {
      orderedSessionIds.push(...archivedSessions.map((session) => session.id));
    }

    return new Map(orderedSessionIds.map((sessionId, index) => [sessionId, index]));
  }, [archivedCollapsed, archivedSessions, chatFolders, collapsedFolderIds, compact, defaultSessions, sessionsByFolder]);
  const isCompactSessionHidden = (sessionId: string) => {
    if (!compact || compactExpanded) {
      return false;
    }

    const index = compactSessionIndexById.get(sessionId);
    return typeof index === "number" && index >= compactVisibleLimit;
  };

  useEffect(() => {
    setCollapsedFolderIds((current) => {
      const next = new Set(current);
      for (const folder of chatFolders) {
        if (!initializedCollapsedFolderIds.current.has(folder.id)) {
          initializedCollapsedFolderIds.current.add(folder.id);
          next.add(folder.id);
        }
      }
      return next;
    });
  }, [chatFolders]);

  const toggleFolder = (folderId: string) => {
    setCollapsedFolderIds((current) => {
      const next = new Set(current);
      if (next.has(folderId)) {
        next.delete(folderId);
      } else {
        next.add(folderId);
      }
      return next;
    });
  };

  const closeSessionMenu = () => {
    setOpenMenuSessionId(undefined);
    clearPendingDeleteSession();
  };

  const closeFolderMenu = () => {
    setOpenMenuFolderId(undefined);
    setPendingDeleteFolderId(undefined);
  };

  const closeOpenMenus = () => {
    closeSessionMenu();
    closeFolderMenu();
  };

  useEffect(() => {
    if (!openMenuSessionId && !openMenuFolderId) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) {
        return;
      }

      if (target.closest(".session-item-menu-wrap") || target.closest(".session-folder-menu-wrap")) {
        return;
      }

      setOpenMenuSessionId(undefined);
      clearPendingDeleteSession();
      setOpenMenuFolderId(undefined);
      setPendingDeleteFolderId(undefined);
    };

    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [clearPendingDeleteSession, openMenuFolderId, openMenuSessionId]);

  const toggleSessionMenu = (sessionId: string) => {
    setRenamingSessionId(undefined);
    closeFolderMenu();
    setOpenMenuSessionId((current) => (current === sessionId ? undefined : sessionId));
    clearPendingDeleteSession();
  };

  const toggleFolderMenu = (folderId: string) => {
    setRenamingFolderId(undefined);
    closeSessionMenu();
    setOpenMenuFolderId((current) => (current === folderId ? undefined : folderId));
    setPendingDeleteFolderId(undefined);
  };

  const startRenameSession = (sessionId: string) => {
    const session = chatSessions.find((item) => item.id === sessionId);
    if (!session) {
      return;
    }

    closeOpenMenus();
    handledSessionRenameId.current = undefined;
    setRenamingSessionId(sessionId);
    setRenamingSessionValue(session.title);
  };

  const cancelRenameSession = () => {
    setRenamingSessionId(undefined);
    setRenamingSessionValue("");
  };

  const saveRenameSession = () => {
    if (!renamingSessionId) {
      return;
    }

    const title = renamingSessionValue.trim();
    const sessionId = renamingSessionId;
    cancelRenameSession();
    if (title) {
      void renameChatSession(sessionId, title);
    }
  };

  const startRenameFolder = (folder: ChatFolder) => {
    closeOpenMenus();
    handledFolderRenameId.current = undefined;
    setRenamingFolderId(folder.id);
    setRenamingFolderValue(folder.name);
    setCollapsedFolderIds((current) => {
      const next = new Set(current);
      next.delete(folder.id);
      return next;
    });
  };

  const cancelRenameFolder = () => {
    setRenamingFolderId(undefined);
    setRenamingFolderValue("");
  };

  const saveRenameFolder = () => {
    if (!renamingFolderId) {
      return;
    }

    const name = renamingFolderValue.trim();
    const folderId = renamingFolderId;
    cancelRenameFolder();
    if (name) {
      void renameChatFolder(folderId, name);
    }
  };

  const commitRenameSessionByKey = () => {
    handledSessionRenameId.current = renamingSessionId;
    saveRenameSession();
  };

  const cancelRenameSessionByKey = () => {
    handledSessionRenameId.current = renamingSessionId;
    setRenamingSessionId(undefined);
    setRenamingSessionValue("");
  };

  const commitRenameFolderByKey = () => {
    handledFolderRenameId.current = renamingFolderId;
    saveRenameFolder();
  };

  const cancelRenameFolderByKey = () => {
    handledFolderRenameId.current = renamingFolderId;
    setRenamingFolderId(undefined);
    setRenamingFolderValue("");
  };

  const saveRenameSessionOnBlur = () => {
    if (renamingSessionId && handledSessionRenameId.current === renamingSessionId) {
      handledSessionRenameId.current = undefined;
      return;
    }

    saveRenameSession();
  };

  const saveRenameFolderOnBlur = () => {
    if (renamingFolderId && handledFolderRenameId.current === renamingFolderId) {
      handledFolderRenameId.current = undefined;
      return;
    }

    saveRenameFolder();
  };

  const handleCreateFolder = async () => {
    closeOpenMenus();
    const folder = await createChatFolder("新文件夹");
    startRenameFolder(folder);
  };

  const requestDeleteFolder = (folderId: string) => {
    setPendingDeleteFolderId(folderId);
  };

  const confirmDeleteFolder = async (folderId: string) => {
    const deleted = await deleteEmptyChatFolder(folderId);
    if (deleted) {
      closeFolderMenu();
    } else {
      setPendingDeleteFolderId(undefined);
    }
  };

  const handleDragSessionStart = (sessionId: string, event: DragEvent<HTMLElement>) => {
    setDraggingSessionId(sessionId);
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", sessionId);
    }
  };

  const exitBatchMode = () => {
    setBatchMode(false);
    setBatchPartition("active");
    setSelectedSessionIds(new Set());
    setBatchConfirmOperation(undefined);
    setBatchOperationPending(false);
  };

  const enterBatchMode = () => {
    setOpenMenuSessionId(undefined);
    setOpenMenuFolderId(undefined);
    setPendingDeleteFolderId(undefined);
    setBatchPartition("active");
    setSelectedSessionIds(new Set());
    setBatchMode(true);
  };

  const changeBatchPartition = (partition: ChatSessionBatchPartition) => {
    setBatchPartition(partition);
    setSelectedSessionIds(new Set());
    setBatchConfirmOperation(undefined);
    setArchivedCollapsed(partition !== "archived");
  };

  const toggleBatchSessionSelection = (sessionId: string) => {
    const eligible = batchTargetSessions.some((session) => session.id === sessionId);
    if (!eligible) {
      return;
    }
    setSelectedSessionIds((current) => {
      const next = new Set(current);
      if (next.has(sessionId)) {
        next.delete(sessionId);
      } else {
        next.add(sessionId);
      }
      return next;
    });
  };

  const toggleBatchFolderSelection = (sessionIds: string[]) => {
    const eligibleSessionIds = sessionIds.filter((sessionId) =>
      batchTargetSessions.some((session) => session.id === sessionId),
    );
    if (eligibleSessionIds.length === 0) {
      return;
    }
    setSelectedSessionIds((current) => {
      const next = new Set(current);
      const allSelected = eligibleSessionIds.every((sessionId) => current.has(sessionId));
      for (const sessionId of eligibleSessionIds) {
        if (allSelected) {
          next.delete(sessionId);
        } else {
          next.add(sessionId);
        }
      }
      return next;
    });
  };

  const confirmBatchOperation = async () => {
    if (!batchConfirmOperation || selectedBatchSessionIds.length === 0) {
      return;
    }
    setBatchOperationPending(true);
    const succeeded = batchConfirmOperation === "archive"
      ? await archiveChatSessions(selectedBatchSessionIds)
      : await deleteChatSessions(selectedBatchSessionIds, batchPartition);
    if (succeeded) {
      exitBatchMode();
      return;
    }
    setBatchOperationPending(false);
    setBatchConfirmOperation(undefined);
  };

  const handleDropSession = (folderId: DropTargetFolderId, event: DragEvent<HTMLElement>) => {
    const sessionId = draggingSessionId ?? event.dataTransfer?.getData("text/plain").trim();
    setDragOverFolderId(undefined);
    setDraggingSessionId(undefined);
    if (sessionId) {
      void moveChatSessionToFolder(sessionId, folderId);
    }
  };

  return (
    <aside aria-label="历史会话" className={compact ? "session-list session-list-compact" : "session-list"}>
      <div className="session-list-header">
        <p className="session-list-title">历史对话</p>
        <div className="session-list-header-actions">
          <button
            className="ui-button-secondary session-header-button session-batch-toggle"
            type="button"
            aria-label="批量操作"
            aria-pressed={batchMode}
            disabled={batchOperationPending}
            onClick={batchMode ? exitBatchMode : enterBatchMode}
          >
            批量操作
          </button>
          <button
            className="ui-button-secondary session-header-button"
            type="button"
            aria-label="新建文件夹"
            disabled={batchMode || batchOperationPending}
            onClick={() => void handleCreateFolder()}
          >
            新建文件夹
          </button>
          <button
            className="ui-button-secondary session-header-button"
            type="button"
            aria-label="新对话"
            disabled={batchMode || batchOperationPending}
            onClick={() => void createChatSession({ preserveSelectedModel: composerHasDraft })}
          >
            新建
          </button>
        </div>
        {batchMode ? (
          <SessionBatchControls
            partition={batchPartition}
            selectedCount={selectedBatchSessionIds.length}
            pending={batchOperationPending}
            confirmOperation={batchConfirmOperation}
            onPartitionChange={changeBatchPartition}
            onRequestOperation={setBatchConfirmOperation}
            onCancelConfirm={() => setBatchConfirmOperation(undefined)}
            onConfirm={() => void confirmBatchOperation()}
          />
        ) : null}
      </div>
      <div className="session-list-scroll">
        <div className="session-folder-stack-scroll">
          <div className="session-folder-stack">
            <SessionFolder
              folderId={undefined}
              title="默认文件夹"
              sessions={defaultSessions}
              collapsed={collapsedFolderIds.has("default")}
              renaming={false}
              renamingValue=""
              dragOver={dragOverFolderId === "default"}
              onToggle={() => toggleFolder("default")}
              onRenameChange={() => undefined}
              onRenameCancel={() => undefined}
              onRenameSave={() => undefined}
              onRenameCommit={() => undefined}
              activeSessionId={activeSessionId}
              pendingDeleteSessionId={pendingDeleteSessionId}
              chatTasksBySessionId={chatTasksBySessionId}
              dismissedChatTaskIdsBySessionId={dismissedChatTaskIdsBySessionId}
              onSelect={handleSelectChatSession}
              onArchive={(sessionId) => void archiveChatSession(sessionId)}
              onRenameSession={startRenameSession}
              onRequestDelete={requestDeleteChatSession}
              onConfirmDelete={(sessionId) => void confirmDeleteChatSession(sessionId)}
              onDragStart={handleDragSessionStart}
              onDragEnd={() => {
                setDraggingSessionId(undefined);
                setDragOverFolderId(undefined);
              }}
              onDragOver={() => setDragOverFolderId("default")}
              onDragLeave={() => setDragOverFolderId(undefined)}
              onDrop={handleDropSession}
              openMenuSessionId={openMenuSessionId}
              renamingSessionId={renamingSessionId}
              renamingSessionValue={renamingSessionValue}
              onToggleSessionMenu={toggleSessionMenu}
              onCloseSessionMenu={closeSessionMenu}
              onSessionRenameChange={setRenamingSessionValue}
              onSessionRenameCancel={cancelRenameSessionByKey}
              onSessionRenameSave={saveRenameSessionOnBlur}
              onSessionRenameCommit={commitRenameSessionByKey}
              isCompactSessionHidden={isCompactSessionHidden}
              batchMode={batchMode}
              selectionEnabled={batchMode}
              selectedSessionIds={selectedSessionIds}
              onToggleSessionSelection={toggleBatchSessionSelection}
              onToggleFolderSelection={toggleBatchFolderSelection}
            />
            {chatFolders.map((folder) => (
              <SessionFolder
                key={folder.id}
                folderId={folder.id}
                title={folder.name}
                sessions={sessionsByFolder.get(folder.id) ?? []}
                collapsed={collapsedFolderIds.has(folder.id)}
                renaming={renamingFolderId === folder.id}
                renamingValue={renamingFolderValue}
                dragOver={dragOverFolderId === folder.id}
                onToggle={() => toggleFolder(folder.id)}
                folderMenuOpen={openMenuFolderId === folder.id}
                pendingDeleteFolder={pendingDeleteFolderId === folder.id}
                onToggleFolderMenu={() => toggleFolderMenu(folder.id)}
                onStartRenameFolder={() => startRenameFolder(folder)}
                onRequestDeleteFolder={() => requestDeleteFolder(folder.id)}
                onConfirmDeleteFolder={() => void confirmDeleteFolder(folder.id)}
                onRenameChange={setRenamingFolderValue}
                onRenameCancel={cancelRenameFolderByKey}
                onRenameSave={saveRenameFolderOnBlur}
                onRenameCommit={commitRenameFolderByKey}
                activeSessionId={activeSessionId}
                pendingDeleteSessionId={pendingDeleteSessionId}
                chatTasksBySessionId={chatTasksBySessionId}
                dismissedChatTaskIdsBySessionId={dismissedChatTaskIdsBySessionId}
                onSelect={handleSelectChatSession}
                onArchive={(sessionId) => void archiveChatSession(sessionId)}
                onRenameSession={startRenameSession}
                onRequestDelete={requestDeleteChatSession}
                onConfirmDelete={(sessionId) => void confirmDeleteChatSession(sessionId)}
                onDragStart={handleDragSessionStart}
                onDragEnd={() => {
                  setDraggingSessionId(undefined);
                  setDragOverFolderId(undefined);
                }}
                onDragOver={() => setDragOverFolderId(folder.id)}
                onDragLeave={() => setDragOverFolderId(undefined)}
                onDrop={handleDropSession}
                openMenuSessionId={openMenuSessionId}
                renamingSessionId={renamingSessionId}
                renamingSessionValue={renamingSessionValue}
                onToggleSessionMenu={toggleSessionMenu}
                onCloseSessionMenu={closeSessionMenu}
                onSessionRenameChange={setRenamingSessionValue}
                onSessionRenameCancel={cancelRenameSessionByKey}
                onSessionRenameSave={saveRenameSessionOnBlur}
                onSessionRenameCommit={commitRenameSessionByKey}
                isCompactSessionHidden={isCompactSessionHidden}
              batchMode={batchMode}
              selectionEnabled={batchMode}
              selectedSessionIds={selectedSessionIds}
              onToggleSessionSelection={toggleBatchSessionSelection}
              onToggleFolderSelection={toggleBatchFolderSelection}
              />
            ))}
          </div>
        </div>
      </div>
      <div className="session-archive-bottom shrink-0">
          <SessionFolder
            title="已归档"
            sessions={archivedSessions}
            collapsed={archivedCollapsed}
            menuPlacement="up"
            renaming={false}
            renamingValue=""
            dragOver={false}
            onToggle={() => setArchivedCollapsed((value) => !value)}
            onRenameChange={() => undefined}
            onRenameCancel={() => undefined}
            onRenameSave={() => undefined}
            onRenameCommit={() => undefined}
            activeSessionId={activeSessionId}
            pendingDeleteSessionId={pendingDeleteSessionId}
            chatTasksBySessionId={chatTasksBySessionId}
            dismissedChatTaskIdsBySessionId={dismissedChatTaskIdsBySessionId}
            onSelect={handleSelectChatSession}
            onRenameSession={startRenameSession}
            onRequestDelete={requestDeleteChatSession}
            onConfirmDelete={(sessionId) => void confirmDeleteChatSession(sessionId)}
            onDragOver={() => undefined}
            onDragLeave={() => undefined}
            onDrop={() => undefined}
            openMenuSessionId={openMenuSessionId}
            renamingSessionId={renamingSessionId}
            renamingSessionValue={renamingSessionValue}
            onToggleSessionMenu={toggleSessionMenu}
            onCloseSessionMenu={closeSessionMenu}
            onSessionRenameChange={setRenamingSessionValue}
            onSessionRenameCancel={cancelRenameSessionByKey}
            onSessionRenameSave={saveRenameSessionOnBlur}
            onSessionRenameCommit={commitRenameSessionByKey}
            isCompactSessionHidden={isCompactSessionHidden}
              batchMode={batchMode}
              selectionEnabled={batchMode}
              selectedSessionIds={selectedSessionIds}
              onToggleSessionSelection={toggleBatchSessionSelection}
              onToggleFolderSelection={toggleBatchFolderSelection}
          />
      </div>
      <Dialog.Root open={Boolean(pendingPrivateSwitchSessionId)} onOpenChange={(open) => {
        if (!open) {
          setPendingPrivateSwitchSessionId(undefined);
        }
      }}>
        <Dialog.Portal>
          <Dialog.Overlay className="dialog-overlay" />
          <Dialog.Content className="private-switch-dialog">
            <Dialog.Title className="private-switch-dialog-title">丢弃隐私对话？</Dialog.Title>
            <Dialog.Description className="private-switch-dialog-description">
              当前隐私对话尚未保存，切换历史会话会丢弃这些内容。
            </Dialog.Description>
            <div className="private-switch-dialog-actions">
              <Dialog.Close className="ui-button-secondary private-switch-dialog-button" type="button">
                继续保留
              </Dialog.Close>
              <button className="ui-button-primary private-switch-dialog-button" type="button" onClick={confirmPrivateSwitch}>
                丢弃并切换
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </aside>
  );
}

function SessionFolder({
  folderId,
  title,
  sessions,
  collapsed,
  menuPlacement = "down",
  activeSessionId,
  pendingDeleteSessionId,
  chatTasksBySessionId,
  dismissedChatTaskIdsBySessionId,
  renaming,
  renamingValue,
  dragOver,
  onToggle,
  onStartRenameFolder,
  folderMenuOpen = false,
  pendingDeleteFolder = false,
  onToggleFolderMenu,
  onRequestDeleteFolder,
  onConfirmDeleteFolder,
  onRenameChange,
  onRenameCancel,
  onRenameSave,
  onRenameCommit,
  onSelect,
  onArchive,
  onRenameSession,
  onRequestDelete,
  onConfirmDelete,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDragLeave,
  onDrop,
  openMenuSessionId,
  renamingSessionId,
  renamingSessionValue,
  onToggleSessionMenu,
  onCloseSessionMenu,
  onSessionRenameChange,
  onSessionRenameCancel,
  onSessionRenameSave,
  onSessionRenameCommit,
  isCompactSessionHidden,
  batchMode = false,
  selectionEnabled = false,
  selectedSessionIds,
  onToggleSessionSelection,
  onToggleFolderSelection,
}: SessionFolderProps) {
  const folderMenuButtonRef = useRef<HTMLButtonElement>(null);
  const folderMenuRef = useRef<HTMLDivElement>(null);
  const folderClassName = dragOver ? "session-folder session-folder-drop-active" : "session-folder";

  useLayoutEffect(() => {
    if (!folderMenuOpen) {
      return undefined;
    }

    const updatePosition = () => {
      if (folderMenuRef.current && folderMenuButtonRef.current) {
        positionFloatingSessionMenu(folderMenuRef.current, folderMenuButtonRef.current);
      }
    };

    updatePosition();
    window.addEventListener("scroll", updatePosition, true);
    window.addEventListener("resize", updatePosition);
    return () => {
      window.removeEventListener("scroll", updatePosition, true);
      window.removeEventListener("resize", updatePosition);
    };
  }, [folderMenuOpen]);

  return (
    <section
      className={folderClassName}
      onDragOver={(event) => {
        event.preventDefault();
        onDragOver(folderId);
      }}
      onDragLeave={onDragLeave}
      onDrop={(event) => {
        event.preventDefault();
        onDrop(folderId, event);
      }}
    >
      {renaming ? (
        <input
          className="ui-input session-folder-rename-input"
          aria-label="重命名文件夹"
          value={renamingValue}
          autoFocus
          onChange={(event) => onRenameChange(event.target.value)}
          onBlur={onRenameSave}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              onRenameCommit();
            }
            if (event.key === "Escape") {
              onRenameCancel();
            }
          }}
        />
      ) : (
        <div className="session-folder-row">
          <button className="session-folder-toggle" type="button" onClick={onToggle} aria-expanded={!collapsed}>
            <span>{title}</span>
            <span className="session-count">{sessions.length}</span>
          </button>
          {onStartRenameFolder ? (
            <div className="session-folder-menu-wrap" onClick={(event) => event.stopPropagation()}>
              <button
                ref={folderMenuButtonRef}
                className="session-folder-rename-button"
                type="button"
                aria-label={`文件夹操作 ${title}`}
                aria-haspopup="menu"
                aria-expanded={folderMenuOpen}
                onClick={(event) => {
                  event.stopPropagation();
                  onToggleFolderMenu?.();
                }}
              >
                ⋯
              </button>
              {folderMenuOpen ? (
                <div ref={folderMenuRef} className="session-menu sidepanel-menu-floating" role="menu">
                  <button className="session-menu-item" type="button" role="menuitem" onClick={onStartRenameFolder}>
                    重命名
                  </button>
                  <button
                    className={pendingDeleteFolder ? "session-menu-item session-menu-delete-confirm" : "session-menu-item"}
                    type="button"
                    role="menuitem"
                    onClick={() => (pendingDeleteFolder ? onConfirmDeleteFolder?.() : onRequestDeleteFolder?.())}
                  >
                    {pendingDeleteFolder ? "确认删除" : "删除"}
                  </button>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      )}
      {collapsed ? null : (
        <div className="session-item-stack">
          {sessions.length === 0 ? <p className="session-empty">暂无对话</p> : null}
          {sessions.map((session) => {
            const task = chatTasksBySessionId[session.id];
            const taskStatus = task && dismissedChatTaskIdsBySessionId[session.id] !== task.id ? task.status : undefined;
            return (
              <SessionItem
                key={session.id}
                session={session}
                active={session.id === activeSessionId}
                taskStatus={taskStatus}
                menuOpen={session.id === openMenuSessionId}
                menuPlacement={menuPlacement}
                renaming={session.id === renamingSessionId}
                renamingValue={renamingSessionValue}
                pendingDelete={session.id === pendingDeleteSessionId}
                compactHidden={isCompactSessionHidden?.(session.id) ?? false}
                onSelect={onSelect}
                onArchive={onArchive}
                onRename={onRenameSession}
                onRequestDelete={onRequestDelete}
                onConfirmDelete={onConfirmDelete}
                onDragStart={onDragStart}
                onDragEnd={onDragEnd}
                onToggleMenu={onToggleSessionMenu}
                onCloseMenu={onCloseSessionMenu}
                onRenameChange={onSessionRenameChange}
                onRenameCancel={onSessionRenameCancel}
                onRenameSave={onSessionRenameSave}
                onRenameCommit={onSessionRenameCommit}
                batchMode={batchMode}
                selected={selectedSessionIds?.has(session.id) ?? false}
                selectionEnabled={selectionEnabled}
                onToggleSelection={onToggleSessionSelection}
              />
            );
          })}
        </div>
      )}
    </section>
  );
}

function SessionItem({
  session,
  active,
  compactHidden = false,
  taskStatus,
  menuOpen,
  menuPlacement,
  renaming,
  renamingValue,
  pendingDelete,
  onSelect,
  onArchive,
  onRename,
  onRequestDelete,
  onConfirmDelete,
  onDragStart,
  onDragEnd,
  onToggleMenu,
  onCloseMenu,
  onRenameChange,
  onRenameCancel,
  onRenameSave,
  onRenameCommit,
  batchMode = false,
  selected = false,
  selectionEnabled = false,
  onToggleSelection,
}: SessionItemProps) {
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const visibleTitle = session.titleGenerating ? "生成标题中..." : session.title;
  const taskClassName = resolveSessionTaskStatusClassName(taskStatus);
  const className = ["session-item", active ? "session-item-active" : "", compactHidden ? "sidepanel-history-hidden-compact" : "", taskClassName].filter(Boolean).join(" ");
  const statusAriaLabel = resolveSessionTaskStatusAriaLabel(taskStatus);

  useLayoutEffect(() => {
    if (!menuOpen) {
      return undefined;
    }

    const updatePosition = () => {
      if (menuRef.current && menuButtonRef.current) {
        positionFloatingSessionMenu(menuRef.current, menuButtonRef.current);
      }
    };

    updatePosition();
    window.addEventListener("scroll", updatePosition, true);
    window.addEventListener("resize", updatePosition);
    return () => {
      window.removeEventListener("scroll", updatePosition, true);
      window.removeEventListener("resize", updatePosition);
    };
  }, [menuOpen]);

  return (
    <article
      className={className}
      aria-label={statusAriaLabel ? `${session.title}，${statusAriaLabel}` : session.title}
      draggable={Boolean(onArchive)}
      onDragStart={(event) => onDragStart?.(session.id, event)}
      onDragEnd={onDragEnd}
    >
      <div className="session-item-row" onClick={() => {
        if (renaming) {
          return;
        }
        if (batchMode) {
          onToggleSelection?.(session.id);
          return;
        }
        onSelect(session.id);
      }}>
        {batchMode ? (
          <label className="session-batch-checkbox-label" onClick={(event) => event.stopPropagation()}>
            <input
              className="session-batch-checkbox"
              type="checkbox"
              checked={selected}
              disabled={!selectionEnabled}
              onChange={() => onToggleSelection?.(session.id)}
              aria-label={`选择会话 ${session.title}`}
            />
          </label>
        ) : null}
        {renaming ? (
          <input
            className="ui-input session-rename-input"
            aria-label="重命名会话"
            value={renamingValue}
            autoFocus
            onClick={(event) => event.stopPropagation()}
            onChange={(event) => onRenameChange(event.target.value)}
            onBlur={onRenameSave}
            onKeyDown={(event) => {
              event.stopPropagation();
              if (event.key === "Enter") {
                onRenameCommit();
              }
              if (event.key === "Escape") {
                onRenameCancel();
              }
            }}
          />
        ) : (
          <button
            className="session-title-button"
            type="button"
            title={session.title}
            onClick={(event) => {
              event.stopPropagation();
              onSelect(session.id);
            }}
          >
            <span className="session-item-title">{visibleTitle}</span>
          </button>
        )}
        <div className="session-item-menu-wrap" onClick={(event) => event.stopPropagation()}>
          <button
            ref={menuButtonRef}
            className="session-menu-button"
            type="button"
            aria-label={`会话操作 ${session.title}`}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            onClick={(event) => {
              event.stopPropagation();
              onToggleMenu(session.id);
            }}
          >
            ⋯
          </button>
          {menuOpen ? (
            <div
              ref={menuRef}
              className={menuPlacement === "up" ? "session-menu session-menu-up sidepanel-menu-floating" : "session-menu sidepanel-menu-floating"}
              role="menu"
            >
              <button className="session-menu-item" type="button" role="menuitem" onClick={() => onRename(session.id)}>
                重命名
              </button>
              {onArchive ? (
                <button
                  className="session-menu-item"
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    onCloseMenu();
                    onArchive(session.id);
                  }}
                >
                  归档
                </button>
              ) : null}
              <button
                className={pendingDelete ? "session-menu-item session-menu-delete-confirm" : "session-menu-item"}
                type="button"
                role="menuitem"
                onClick={() => (pendingDelete ? onConfirmDelete(session.id) : onRequestDelete(session.id))}
              >
                {pendingDelete ? "确认删除" : "删除"}
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </article>
  );
}

function resolveSessionTaskStatusClassName(status: ChatTaskStatus | undefined): string | undefined {
  if (status === "running") {
    return "session-item-running";
  }
  if (status === "completed") {
    return "session-item-completed";
  }
  if (status === "failed") {
    return "session-item-failed";
  }
  if (status === "canceled") {
    return "session-item-canceled";
  }

  return undefined;
}

function resolveSessionTaskStatusAriaLabel(status: ChatTaskStatus | undefined): string | undefined {
  if (status === "running") {
    return "正在生成";
  }
  if (status === "completed") {
    return "生成完成";
  }
  if (status === "failed") {
    return "生成失败";
  }
  if (status === "canceled") {
    return "已终止";
  }

  return undefined;
}
