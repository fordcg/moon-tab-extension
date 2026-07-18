export const SIDE_PANEL_PATH = "index.html";
export const OPENED_SIDE_PANEL_TABS_KEY = "sidePanel.openedTabs.v1";

export const SIDE_PANEL_OPEN_FLOATING_TYPE = "sidePanel.openFloating";
export const LEGACY_SIDE_PANEL_OPEN_FLOATING_TYPE = "sidepanelFloating.openCurrentTab";
export const SIDE_PANEL_FLOATING_ATTACH_TYPE = "sidePanel.floating.attach";
export const LEGACY_SIDE_PANEL_FLOATING_ATTACH_TYPE = "sidepanelFloating.open";
export const SIDE_PANEL_FLOATING_CLOSE_TYPE = "sidePanel.floating.close";
export const SIDE_PANEL_CLOSE_TYPE = "sidePanel.close";

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

export type SidePanelRuntimeMessage = SidePanelOpenFloatingMessage | SidePanelCloseMessage;
export type SidePanelContentMessage = SidePanelFloatingAttachMessage | SidePanelFloatingCloseMessage;

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
