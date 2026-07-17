export const SIDE_PANEL_PATH = "index.html";
export const OPENED_SIDE_PANEL_TABS_KEY = "sidePanel.openedTabs.v1";

export const SIDE_PANEL_OPEN_FLOATING_TYPE = "sidePanel.openFloating";
export const LEGACY_SIDE_PANEL_OPEN_FLOATING_TYPE = "sidepanelFloating.openCurrentTab";
export const SIDE_PANEL_FLOATING_ATTACH_TYPE = "sidePanel.floating.attach";
export const LEGACY_SIDE_PANEL_FLOATING_ATTACH_TYPE = "sidepanelFloating.open";
export const SIDE_PANEL_FLOATING_CLOSE_TYPE = "sidePanel.floating.close";
export const SIDE_PANEL_CLOSE_TYPE = "sidePanel.close";
export const CONTROL_BEACON_CLOSE_TYPE = "sidePanel.controlBeacon.close";
export const CONTROL_BEACON_HOST_MESSAGE_TYPE = "sidePanel.controlBeacon.host";
export const CONTROL_BEACON_ACTIVE_STORAGE_KEY = "sidePanel.controlBeaconActive.v1";

/** postMessage bridge between in-page control orb iframe and content script. */
export const CONTROL_BEACON_FRAME_SOURCE = "moon-tab-control-beacon";
export const CONTROL_BEACON_DRAG_MOVE_TYPE = "control-beacon-drag-move";
export const CONTROL_BEACON_DRAG_END_TYPE = "control-beacon-drag-end";
export const CONTROL_BEACON_LAYOUT_TYPE = "control-beacon-layout";
export const CONTROL_BEACON_POSITION_STORAGE_KEY = "sidePanel.controlBeaconPosition.v1";

export interface ControlBeaconFrameMessage {
  source: typeof CONTROL_BEACON_FRAME_SOURCE;
  type:
    | typeof CONTROL_BEACON_DRAG_MOVE_TYPE
    | typeof CONTROL_BEACON_DRAG_END_TYPE
    | typeof CONTROL_BEACON_LAYOUT_TYPE;
  dx?: number;
  dy?: number;
  expanded?: boolean;
}

export interface ControlBeaconHostRuntimeMessage {
  type: typeof CONTROL_BEACON_HOST_MESSAGE_TYPE;
  payload: Omit<ControlBeaconFrameMessage, "source"> & { source?: typeof CONTROL_BEACON_FRAME_SOURCE };
}

export interface ControlBeaconCloseMessage {
  type: typeof CONTROL_BEACON_CLOSE_TYPE;
}

export function isControlBeaconFrameMessage(value: unknown): value is ControlBeaconFrameMessage {
  if (!value || typeof value !== "object" || !("source" in value) || !("type" in value)) {
    return false;
  }
  const message = value as { source?: unknown; type?: unknown };
  return (
    message.source === CONTROL_BEACON_FRAME_SOURCE &&
    (message.type === CONTROL_BEACON_DRAG_MOVE_TYPE ||
      message.type === CONTROL_BEACON_DRAG_END_TYPE ||
      message.type === CONTROL_BEACON_LAYOUT_TYPE)
  );
}

export function isControlBeaconHostRuntimeMessage(value: unknown): value is ControlBeaconHostRuntimeMessage {
  return Boolean(
    value &&
      typeof value === "object" &&
      "type" in value &&
      (value as { type?: unknown }).type === CONTROL_BEACON_HOST_MESSAGE_TYPE &&
      "payload" in value,
  );
}

export interface SidePanelOpenFloatingMessage {
  type: typeof SIDE_PANEL_OPEN_FLOATING_TYPE | typeof LEGACY_SIDE_PANEL_OPEN_FLOATING_TYPE;
}

export interface SidePanelCloseMessage {
  type: typeof SIDE_PANEL_CLOSE_TYPE;
  tabId?: number;
  windowId?: number;
}

export interface SidePanelFloatingAttachMessage {
  type: typeof SIDE_PANEL_FLOATING_ATTACH_TYPE | typeof LEGACY_SIDE_PANEL_FLOATING_ATTACH_TYPE;
  url: string;
}

export interface SidePanelFloatingCloseMessage {
  type: typeof SIDE_PANEL_FLOATING_CLOSE_TYPE;
}

export type SidePanelRuntimeMessage = SidePanelOpenFloatingMessage | SidePanelCloseMessage | ControlBeaconHostRuntimeMessage;
export type SidePanelContentMessage =
  | SidePanelFloatingAttachMessage
  | SidePanelFloatingCloseMessage
  | ControlBeaconCloseMessage;

export function createFloatingSidePanelPath(input: { tabId?: number; windowId?: number } = {}): string {
  const params = new URLSearchParams({ floating: "1" });
  if (typeof input.tabId === "number") {
    params.set("tabId", String(input.tabId));
  }
  if (typeof input.windowId === "number") {
    params.set("windowId", String(input.windowId));
  }
  return `${SIDE_PANEL_PATH}?${params.toString()}`;
}

/** Compact in-page beacon used while browser control is active. */
export function createFloatingControlBeaconPath(input: { tabId?: number; windowId?: number } = {}): string {
  const params = new URLSearchParams({ floating: "1", controlWindow: "1" });
  if (typeof input.tabId === "number") {
    params.set("tabId", String(input.tabId));
  }
  if (typeof input.windowId === "number") {
    params.set("windowId", String(input.windowId));
  }
  return `${SIDE_PANEL_PATH}?${params.toString()}`;
}
