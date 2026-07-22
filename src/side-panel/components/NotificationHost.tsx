import { useCallback, useEffect, useRef, useState } from "react";
import type { AppNotification } from "../state/appNotifications";
import { useAppStore } from "../state/appStore";

const NOTIFICATION_ICON_LABEL: Record<AppNotification["type"], string> = {
  success: "成功",
  warning: "警告",
  error: "错误",
  info: "消息",
};
const NOTIFICATION_EXIT_DURATION_MS = 180;

export function NotificationHost() {
  const notifications = useAppStore((state) => state.notifications);
  const failure = useAppStore((state) => state.failure);
  const channelOperations = useAppStore((state) => state.channelOperations);
  const syncOperation = useAppStore((state) => state.syncOperation);
  const addNotification = useAppStore((state) => state.addNotification);
  const dismissNotification = useAppStore((state) => state.dismissNotification);
  const clearFailure = useAppStore((state) => state.clearFailure);
  const clearSyncOperationNotice = useAppStore((state) => state.clearSyncOperationNotice);
  const clearChannelOperationNotice = useAppStore((state) => state.clearChannelOperationNotice);
  const consumedFailureMessageRef = useRef<string | undefined>(undefined);
  const consumedChannelOperationRef = useRef<Record<string, string>>({});
  const consumedSyncOperationRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (!failure?.message) {
      consumedFailureMessageRef.current = undefined;
      return;
    }

    if (consumedFailureMessageRef.current === failure.message) {
      return;
    }

    consumedFailureMessageRef.current = failure.message;
    addNotification({ type: "error", title: "操作失败", message: failure.message });
    clearFailure();
  }, [addNotification, clearFailure, failure]);

  useEffect(() => {
    if (!syncOperation.message && !syncOperation.error) {
      consumedSyncOperationRef.current = undefined;
      return;
    }

    const message = syncOperation.error ?? syncOperation.message;
    if (!message || consumedSyncOperationRef.current === message) {
      return;
    }

    consumedSyncOperationRef.current = message;
    addNotification({
      type: syncOperation.error ? "error" : "success",
      title: syncOperation.error ? "同步失败" : "同步完成",
      message,
    });
    clearSyncOperationNotice();
  }, [addNotification, clearSyncOperationNotice, syncOperation]);

  useEffect(() => {
    const currentProviderIds = new Set(Object.keys(channelOperations));
    for (const providerId of Object.keys(consumedChannelOperationRef.current)) {
      const operation = channelOperations[providerId];
      if (!currentProviderIds.has(providerId) || (!operation?.message && !operation?.error)) {
        delete consumedChannelOperationRef.current[providerId];
      }
    }

    for (const [providerId, operation] of Object.entries(channelOperations)) {
      const message = operation.error ?? operation.message;
      if (!message || consumedChannelOperationRef.current[providerId] === message) {
        continue;
      }

      consumedChannelOperationRef.current[providerId] = message;
      addNotification({
        type: operation.error ? "error" : "success",
        title: operation.error ? "模型列表失败" : "模型列表已更新",
        message,
      });
      clearChannelOperationNotice(providerId);
    }
  }, [addNotification, channelOperations, clearChannelOperationNotice]);

  if (notifications.length === 0) {
    return null;
  }

  return (
    <div className="notification-host" aria-live="polite">
      {notifications.map((notification) => (
        <NotificationItem key={notification.id} notification={notification} dismissNotification={dismissNotification} />
      ))}
    </div>
  );
}

function NotificationItem({
  notification,
  dismissNotification,
}: {
  notification: AppNotification;
  dismissNotification: (notificationId: string) => void;
}) {
  const [closing, setClosing] = useState(false);
  const exitTimerRef = useRef<number | undefined>(undefined);
  const title = notification.title ?? NOTIFICATION_ICON_LABEL[notification.type];
  const message = notification.message.trim();
  const showMessage = Boolean(message) && message !== title;

  const closeWithAnimation = useCallback(() => {
    if (closing) {
      return;
    }

    setClosing(true);
    exitTimerRef.current = window.setTimeout(() => {
      exitTimerRef.current = undefined;
      dismissNotification(notification.id);
    }, NOTIFICATION_EXIT_DURATION_MS);
  }, [closing, dismissNotification, notification.id]);

  useEffect(() => {
    return () => {
      if (exitTimerRef.current !== undefined) {
        window.clearTimeout(exitTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (notification.durationMs <= 0 || closing) {
      return;
    }

    const timer = window.setTimeout(closeWithAnimation, notification.durationMs);
    return () => window.clearTimeout(timer);
  }, [closeWithAnimation, closing, notification.durationMs]);

  return (
    <section
      className={`notification notification-${notification.type}${closing ? " notification-closing" : ""}${showMessage ? "" : " notification-compact"}`}
      role={notification.type === "error" ? "alert" : "status"}
    >
      <span className="notification-accent" aria-hidden="true" />
      <div className="notification-icon" aria-hidden="true">
        <NotificationGlyph type={notification.type} />
      </div>
      <div className="notification-content">
        <p className="notification-title">{title}</p>
        {showMessage ? <p className="notification-message">{message}</p> : null}
      </div>
      <button className="notification-close" type="button" aria-label={`关闭通知：${title}`} onClick={closeWithAnimation} />
    </section>
  );
}

function NotificationGlyph({ type }: { type: AppNotification["type"] }) {
  if (type === "success") {
    return (
      <svg viewBox="0 0 16 16" className="notification-glyph" aria-hidden="true">
        <path d="M3.5 8.2 6.4 11l6.1-6.6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  if (type === "warning") {
    return (
      <svg viewBox="0 0 16 16" className="notification-glyph" aria-hidden="true">
        <path d="M8 3.2 2.6 12.4h10.8L8 3.2Z" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
        <path d="M8 6.4v2.8" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        <circle cx="8" cy="11.1" r="0.8" fill="currentColor" />
      </svg>
    );
  }
  if (type === "error") {
    return (
      <svg viewBox="0 0 16 16" className="notification-glyph" aria-hidden="true">
        <path d="m5 5 6 6M11 5 5 11" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 16 16" className="notification-glyph" aria-hidden="true">
      <circle cx="8" cy="8" r="5.2" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <path d="M8 7.1v3.4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <circle cx="8" cy="5.1" r="0.75" fill="currentColor" />
    </svg>
  );
}
