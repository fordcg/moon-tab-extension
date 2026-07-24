export interface SearchTarget {
  id: string;
  label: string;
  isGeneral: boolean;
  buildSearchUrl: (query: string) => string;
}

export interface SearchSettings {
  endpoint: string;
  apiKey: string;
  model: string;
  aiSearchEnabled: boolean;
}

export interface AiRuntimeState {
  protocol: string;
  configState: string;
  lastTestStatus: string;
  lastTestMessage: string;
  lastTestAt: string;
  lastRuntimeErrorMessage: string;
  lastRuntimeErrorAt: string;
}

export interface StatusMessage {
  message: string;
  tone: "neutral" | "success" | "error";
}

export interface SuggestionItem {
  type: "query" | "action";
  query: string;
  label: string;
  source?: string;
  targetId?: string;
}

export interface AiPreviewAction {
  type: "open" | "search";
  target: string;
  label: string;
}

export interface AiPreviewWebsite {
  title: string;
  url: string;
  host?: string;
  description?: string;
}

export interface AiSearchPreviewModel {
  originalQuery: string;
  intent?: string;
  target: string;
  refinedQuery?: string;
  websites: AiPreviewWebsite[];
  summary: string;
  targetLabel: string;
  primaryAction: AiPreviewAction;
  secondaryAction?: AiPreviewAction | null;
  relatedQueries: string[];
  readyMessage: string;
}

export interface WidgetDefinition {
  id: "search" | "quicksites" | "calendar" | "todo";
  title: string;
  core: boolean;
  canHide: boolean;
  defaultVisible: boolean;
}

export interface WidgetLayout {
  version: number;
  orderedWidgetIds: string[];
  hiddenWidgetIds: string[];
  widgetPrefs: Record<string, Record<string, unknown>>;
}

export interface TodoTask {
  id: string;
  title: string;
  completed: boolean;
  priority: "low" | "medium" | "high";
  dueDate: string;
  createdAt: string;
  updatedAt: string;
  completedAt: string;
  order: number;
}

export type TodoMode = "list" | "create" | "edit";

export const createEmptyStatus = (): StatusMessage => ({ message: "", tone: "neutral" });

export const extensionApi = typeof chrome !== "undefined" ? chrome : null;

export function normalizeStatusTone(tone: StatusMessage["tone"] | undefined): StatusMessage["tone"] {
  return tone === "success" || tone === "error" ? tone : "neutral";
}
