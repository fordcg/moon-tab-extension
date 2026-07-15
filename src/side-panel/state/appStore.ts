import { create, type StoreApi } from "zustand";
import { buildChatRequestMessages } from "../../shared/chat/buildChatRequestMessages";
import { createModelConfig } from "../../shared/chat/modelConfig";
import { createPageContextPrompt } from "../../shared/chat/pageContextPrompt";
import { mergeTokenUsageEntries } from "../../shared/chat/tokenUsage";
import {
  AUTOMATION_PLAYBOOK_SETTINGS_KEY,
  AUTOMATION_SKILL_PLAYBOOKS_KEY,
  getRegisteredAutomationPlaybooks,
  mergeImportedSkillPlaybooks,
  normalizeAutomationPlaybookSettings,
  normalizeImportedSkillPlaybooks,
  parseSkillPlaybookImportJson,
} from "../../shared/automationPlaybooks";
import type { RemoteModelInfo } from "../../shared/models/modelCatalog";
import {
  CURRENT_TIME_TOOL_ID,
  getRegisteredModelTools,
  resolveEnabledModelTools,
} from "../../shared/models/toolRegistry";
import type { ModelToolChoice, OpenAIStructuredOutputFormat } from "../../shared/models/types";
import {
  deleteChatSession,
  deleteModelProvider,
  deleteProviderModel,
  getAppSetting,
  getChatFolders,
  getChatSessions,
  getModelProviders,
  getProviderModels,
  saveAppSetting,
  saveChatSession,
  saveModelProvider,
  saveProviderModel,
  recoverInterruptedChatSessions,
  updateChatSession,
} from "../../shared/storage/repositories";
import {
  DEFAULT_SYNC_SECRETS,
  DEFAULT_SYNC_SETTINGS,
} from "../../shared/sync/settings";
import {
  DEFAULT_WEB_SEARCH_SETTINGS,
  getWebSearchSettings,
} from "../../shared/webSearch/settings";
import {
  clearMcpBearerToken,
  getMcpBearerToken,
  getMcpSettings,
  saveMcpBearerToken,
  saveMcpSettings,
} from "../../shared/mcp/settings";
import { parseMcpToolId } from "../../shared/mcp/toolAdapter";
import type { SyncSecrets, SyncSettings } from "../../shared/sync/types";
import type { SyncRemoteBackupMeta } from "../../shared/sync/types";
import type { TavilySearchOptions } from "../../shared/webSearch/tavily";
import type {
  AutomationPlaybookSettings,
  ChatSendDebugContext,
  ChatFolder,
  ChatImageAttachment,
  ChatMessage,
  ChatPendingFollowUp,
  ChatPromptInvocation,
  ChatPreferenceValues,
  ChatSession,
  ChatSessionPreferenceOverrides,
  ChatTokenUsageEntry,
  ChatTokenUsageSource,
  ChatToolAttachment,
  ChatToolCallRecord,
  EndpointType,
  ExtractionRule,
  ImportedAutomationPlaybook,
  ModelProvider,
  McpServerConfig,
  McpServerSecretMap,
  McpSettings,
  PageContextExtractMode,
  PromptTemplate,
  ProviderModel,
  SendShortcut,
  WebSearchSettings,
  WorkflowArtifact,
  WorkflowContextItem,
  WorkflowSkill,
  WorkflowTask,
  WorkflowTaskStatus,
  WorkflowTaskStep,
  WorkflowTaskTemplate,
} from "../../shared/types";
import {
  BROWSER_CONTROL_BOUNDARY_CHOICE_RESPOND_MESSAGE_TYPE,
  BROWSER_CONTROL_GET_DIAGNOSTICS_MESSAGE_TYPE,
  BROWSER_CONTROL_SET_AUTOMATION_MODE_MESSAGE_TYPE,
  BROWSER_CONTROL_SET_ENABLED_MESSAGE_TYPE,
  BROWSER_CONTROL_SET_RUNTIME_READONLY_MESSAGE_TYPE,
  type BrowserControlBoundaryChoiceRequestMessage,
  type BrowserControlDiagnostics,
  type BrowserControlResponse,
} from "../../shared/browserControl";
import type { BrowserAutomationMode } from "../../shared/toolAuthorization";
import {
  createChatFolderAction,
  deleteEmptyChatFolderAction,
  moveChatSessionToFolderAction,
  renameChatFolderAction,
} from "./appStoreChatFolders";
import {
  archiveChatSessionAction,
  clearPendingDeleteSessionAction,
  confirmDeleteChatSessionAction,
  renameChatSessionAction,
  requestDeleteChatSessionAction,
} from "./appStoreChatSessions";
import {
  deleteRuleAction,
  generateUrlPatternsAction,
  loadExtractionRulesAction,
  moveRuleAction,
  saveRuleDraftAction,
} from "./appStoreExtractionRules";
import {
  loadContextTabsAction,
  refreshPageContextAction,
  resetPageContextRefreshSequence,
  toggleContextTabSelectionAction,
} from "./appStorePageContext";
import {
  deletePromptAction,
  loadPromptTemplatesAction,
  reorderPromptTemplatesAction,
  savePromptTemplateDraftAction,
} from "./appStorePromptTemplates";
import {
  resolveActiveChatSessionSelection,
  resolveAvailableModelId,
  resolveConfiguredModelId,
  resolveSessionModelId,
  syncActiveSessionSelectedModelAfterModelRemoval,
} from "./appStoreModelSelection";
import {
  createDefaultChatPreferences,
  normalizeChatPreferenceOverrides,
  normalizeChatPreferences,
  resolveDefaultContextMode,
  resolveEffectiveChatPreferences,
  resolveRuntimeEnabledToolIds,
} from "./appStorePreferences";
import { upsertSession } from "./appStoreSessionUtils";
import {
  createWorkflowArtifactsFromAssistantMessage,
  createWorkflowContextItemsFromToolAttachments,
  createWorkflowTaskActions,
  createWorkflowTaskStepFromToolRecord,
} from "./appStoreWorkflowTasks";
import {
  abortChatTaskHandle,
  clearChatTask,
  clearChatTaskAbortHandles,
  createChatTask,
  finishChatTask,
  type ChatTaskMap,
  isSessionTaskRunning,
  registerChatTaskAbortHandle,
  registerChatTaskExecution,
  registerChatTaskFollowUpHandle,
  sendChatTaskFollowUp,
  settleChatTaskExecution,
  unregisterChatTaskAbortHandle,
  unregisterChatTaskFollowUpHandle,
  upsertChatTask,
} from "./appStoreChatTasks";
import { sendStreamingChatMessage } from "./appStoreStreaming";
import {
  backupNowAction,
  loadRemoteBackupsAction,
  loadSyncSettingsAction,
  restoreNowAction,
  updateSyncSecretAction,
  updateSyncSettingsAction,
  updateWebSearchSettingsAction,
} from "./appStoreSyncActions";
import { generateTitleForSession, generateTitleFromSavedPrivateSession, hasAvailableTitleModel } from "./appStoreTitleGeneration";
import { createAppNotification, type AppNotification, type AppNotificationDraft } from "./appNotifications";
import { sendRuntimeMessage } from "./runtimeMessage";

function createSessionId(timestamp = Date.now()): string {
  return `session-${timestamp}-${Math.random().toString(36).slice(2, 8)}`;
}

interface RequestFailure {
  message: string;
}

function shouldShowFailureForSession(state: AppState, sessionId: string): boolean {
  if (state.privateModeActive) {
    return state.privateChatSession?.id === sessionId;
  }

  return !state.activeSessionId || state.activeSessionId === sessionId;
}

interface ChannelOperationState {
  loading: boolean;
  message?: string;
  error?: string;
}

interface ModelConnectivityState {
  loading: boolean;
  success?: boolean;
  error?: string;
}

interface PageContextState {
  loading: boolean;
  url?: string;
  title?: string;
  text: string;
  extractMode: PageContextExtractMode;
  truncated: boolean;
  usedFallback: boolean;
  matchedRuleId?: string;
  formatted?: boolean;
  error?: string;
}

export interface ContextTabCandidate {
  tabId: number;
  title: string;
  url: string;
  active: boolean;
  selected: boolean;
  favIconUrl?: string;
  loading?: boolean;
  error?: string;
}

interface SyncOperationState {
  loading: boolean;
  message?: string;
  error?: string;
}

export interface ChatRetryProgress {
  currentRetry: number;
  maxRetries: number;
}

export type ChatFollowUpItem = ChatPendingFollowUp;

export interface AppState {
  providers: ModelProvider[];
  models: ProviderModel[];
  extractionRules: ExtractionRule[];
  promptTemplates: PromptTemplate[];
  workflowSkills: WorkflowSkill[];
  chatSessions: ChatSession[];
  chatFolders: ChatFolder[];
  pageContext: PageContextState;
  contextTabs: ContextTabCandidate[];
  contextTabsLoading: boolean;
  contextTabsError?: string;
  remoteModels: Record<string, RemoteModelInfo[]>;
  channelOperations: Record<string, ChannelOperationState>;
  modelConnectivity: Record<string, ModelConnectivityState>;
  selectedModelId: string;
  defaultChatModelId: string;
  chatPreferences: ChatPreferenceValues;
  automationPlaybookSettings: AutomationPlaybookSettings;
  importedSkillPlaybooks: ImportedAutomationPlaybook[];
  browserControlEnabled: boolean;
  browserAutomationMode: BrowserAutomationMode;
  runtimeReadonlyEnabled: boolean;
  browserAutomationDiagnostics?: BrowserControlDiagnostics;
  pendingBoundaryChoice?: BrowserControlBoundaryChoiceRequestMessage;
  activeSessionId: string;
  privateModeActive: boolean;
  privateChatSession?: ChatSession;
  pendingDeleteSessionId?: string;
  composerHasDraft: boolean;
  chatTasksBySessionId: ChatTaskMap;
  dismissedChatTaskIdsBySessionId: Record<string, string>;
  followUpsBySessionId: Record<string, ChatFollowUpItem[]>;
  chatRetryProgressByMessageId: Record<string, ChatRetryProgress>;
  appendPageContextToSystemPrompt: boolean;
  streamMode: boolean;
  sending: boolean;
  contextMode: PageContextExtractMode;
  syncSettings: SyncSettings;
  syncSecrets: SyncSecrets;
  webSearchSettings: WebSearchSettings;
  mcpSettings: McpSettings;
  mcpBearerTokens: McpServerSecretMap;
  remoteBackups: SyncRemoteBackupMeta[];
  syncOperation: SyncOperationState;
  syncRestoreBarrierActive: boolean;
  failure?: RequestFailure;
  notifications: AppNotification[];
  addNotification: (notification: AppNotificationDraft) => string;
  dismissNotification: (notificationId: string) => void;
  clearFailure: () => void;
  clearSyncOperationNotice: () => void;
  clearChannelOperationNotice: (providerId: string) => void;
  addExampleModel: () => void;
  addProvider: () => ModelProvider;
  updateProvider: (providerId: string, updates: Partial<Pick<ModelProvider, "name" | "endpointType" | "endpointUrl" | "apiKey">>) => void;
  addModel: (providerId: string, overrides?: Partial<Pick<ProviderModel, "displayName" | "modelId">>) => ProviderModel;
  addRemoteModel: (providerId: string, remoteModel: RemoteModelInfo) => ProviderModel;
  updateModel: (modelId: string, updates: Partial<Pick<ProviderModel, "displayName" | "modelId" | "temperature" | "maxTokens" | "topK" | "systemPrompt" | "supportsVision">>) => void;
  setTitleModel: (modelId: string) => void;
  setDefaultChatModel: (modelId: string) => Promise<void>;
  updateChatPreferences: (updates: Partial<ChatPreferenceValues>) => Promise<void>;
  updateAutomationPlaybookSettings: (updates: Partial<AutomationPlaybookSettings>) => Promise<void>;
  importSkillPlaybooksFromJson: (fileText: string) => Promise<{ ok: true; importedCount: number } | { ok: false; message: string }>;
  removeImportedSkillPlaybook: (playbookId: string) => Promise<void>;
  updateActiveSessionChatPreferences: (updates: ChatSessionPreferenceOverrides) => Promise<void>;
  setBrowserControlEnabled: (enabled: boolean) => Promise<void>;
  setBrowserAutomationMode: (mode: BrowserAutomationMode) => Promise<void>;
  setRuntimeReadonlyEnabled: (enabled: boolean) => Promise<void>;
  refreshBrowserAutomationDiagnostics: () => Promise<void>;
  markBrowserControlDetached: () => void;
  markBrowserAutomationModeChanged: (mode: BrowserAutomationMode) => void;
  markRuntimeReadonlyChanged: (enabled: boolean) => void;
  showBoundaryChoiceRequest: (request: BrowserControlBoundaryChoiceRequestMessage) => void;
  respondBoundaryChoice: (requestId: string, selectedChoiceIds: string[], otherText?: string) => Promise<void>;
  deleteProvider: (providerId: string) => void;
  deleteModel: (modelId: string) => void;
  loadChannelConfig: () => Promise<void>;
  loadChatData: () => Promise<void>;
  createChatSession: (options?: { preserveSelectedModel?: boolean }) => Promise<ChatSession>;
  enterPrivateMode: () => Promise<void>;
  savePrivateChatSession: () => Promise<void>;
  selectChatSession: (sessionId: string, options?: { discardPrivateSession?: boolean }) => void;
  renameChatSession: (sessionId: string, title: string) => Promise<void>;
  archiveChatSession: (sessionId: string) => Promise<void>;
  requestDeleteChatSession: (sessionId: string) => void;
  confirmDeleteChatSession: (sessionId: string) => Promise<void>;
  clearPendingDeleteSession: () => void;
  createChatFolder: (name: string) => Promise<ChatFolder>;
  renameChatFolder: (folderId: string, name: string) => Promise<void>;
  deleteEmptyChatFolder: (folderId: string) => Promise<boolean>;
  moveChatSessionToFolder: (sessionId: string, folderId: string | undefined) => Promise<void>;
  loadExtractionRules: () => Promise<void>;
  saveRuleDraft: (ruleId: string | undefined, draft: Pick<ExtractionRule, "alias" | "urlPattern" | "selectorsText">) => Promise<{ ok: true; rule: ExtractionRule } | { ok: false; message: string }>;
  deleteRule: (ruleId: string) => Promise<void>;
  moveRule: (ruleId: string, direction: "up" | "down") => Promise<void>;
  loadPromptTemplates: () => Promise<void>;
  savePromptTemplateDraft: (promptId: string | undefined, draft: Pick<PromptTemplate, "title" | "content">) => Promise<{ ok: true; prompt: PromptTemplate } | { ok: false; message: string }>;
  deletePrompt: (promptId: string) => Promise<void>;
  reorderPromptTemplates: (orderedIds: string[]) => Promise<void>;
  createWorkflowTask: (template: WorkflowTaskTemplate, objective: string) => Promise<WorkflowTask>;
  updateWorkflowTaskStatus: (taskId: string, status: WorkflowTaskStatus, reason?: string) => Promise<void>;
  cancelWorkflowTask: (taskId: string) => Promise<void>;
  upsertWorkflowTaskStep: (taskId: string, step: WorkflowTaskStep) => Promise<void>;
  addWorkflowContextItem: (taskId: string, item: WorkflowContextItem) => Promise<void>;
  updateWorkflowContextItem: (
    taskId: string,
    contextItemId: string,
    updates: Pick<WorkflowContextItem, "title" | "summary" | "capturedAt" | "truncated">,
  ) => Promise<void>;
  removeWorkflowContextItem: (taskId: string, contextItemId: string) => Promise<void>;
  toggleWorkflowContextPinned: (taskId: string, contextItemId: string) => Promise<void>;
  addWorkflowArtifact: (taskId: string, artifact: WorkflowArtifact) => Promise<void>;
  loadWorkflowSkills: () => Promise<void>;
  saveWorkflowSkill: (taskId: string, draft: Pick<WorkflowSkill, "title" | "variables">) => Promise<WorkflowSkill>;
  startWorkflowSkill: (skillId: string, values: Record<string, string>) => Promise<WorkflowTask>;
  sendWorkflowTaskMessage: (taskId: string, content: string) => Promise<void>;
  refreshPageContext: () => Promise<void>;
  loadContextTabs: () => Promise<void>;
  toggleContextTabSelection: (tabId: number) => void;
  generateUrlPatterns: (modelId?: string) => Promise<{ ok: true; patterns: string[] } | { ok: false; message: string }>;
  fetchRemoteModels: (providerId: string) => Promise<void>;
  testModel: (providerId: string, modelId: string) => Promise<void>;
  selectModel: (modelId: string) => Promise<void>;
  setComposerHasDraft: (hasDraft: boolean) => void;
  setAppendPageContextToSystemPrompt: (enabled: boolean) => void;
  setStreamMode: (streamMode: boolean) => void;
  setContextMode: (contextMode: PageContextExtractMode) => void;
  loadSyncSettings: () => Promise<void>;
  updateSyncSettings: (updates: Partial<SyncSettings>) => Promise<void>;
  updateSyncSecret: (key: keyof SyncSecrets, value: string) => Promise<void>;
  updateWebSearchSettings: (updates: Partial<WebSearchSettings>) => Promise<void>;
  updateMcpServer: (serverId: string | undefined, draft: Pick<McpServerConfig, "name" | "endpointUrl" | "enabled"> & { bearerToken?: string }) => Promise<{ ok: true; server: McpServerConfig } | { ok: false; message: string }>;
  setMcpServerEnabled: (serverId: string, enabled: boolean) => Promise<void>;
  deleteMcpServer: (serverId: string) => Promise<void>;
  refreshMcpServerTools: (serverId: string) => Promise<void>;
  loadRemoteBackups: () => Promise<void>;
  backupNow: () => Promise<void>;
  restoreNow: (backupId: string) => Promise<void>;
  sendChatMessage: (content: string, attachments?: ChatImageAttachment[], promptInvocations?: ChatPromptInvocation[], selectedPlaybookId?: string) => Promise<void>;
  submitChatFollowUp: (
    content: string,
    attachments?: ChatImageAttachment[],
    promptInvocations?: ChatPromptInvocation[],
    options?: { behavior?: ChatPreferenceValues["followUpBehavior"] },
  ) => Promise<void>;
  removeChatFollowUp: (sessionId: string, followUpId: string) => void;
  guideChatFollowUp: (sessionId: string, followUpId: string) => void;
  regenerateMessage: (messageId: string) => Promise<void>;
  editAndRegenerateUserMessage: (messageId: string, content: string, promptInvocations?: ChatPromptInvocation[]) => Promise<void>;
  abortChatTask: (sessionId: string) => void;
  abortActiveChatTask: () => void;
  reset: () => void;
}

const exampleProvider: ModelProvider = {
  id: "provider-1",
  name: "默认渠道",
  endpointType: "openai_chat",
  endpointUrl: "https://api.example.com/v1/chat/completions",
  apiKey: "sk-example",
  enabled: true,
  createdAt: 1,
  updatedAt: 1,
};

const exampleModel: ProviderModel = {
  id: "model-1",
  providerId: exampleProvider.id,
  displayName: "默认 OpenAI",
  modelId: "gpt-test",
  temperature: 0.7,
  maxTokens: 1024,
  systemPrompt: "你是网页助手",
  isTitleModel: false,
  supportsVision: false,
  enabled: true,
  createdAt: 1,
  updatedAt: 1,
};

let modelCatalogRevision = 0;

function markModelCatalogChanged() {
  modelCatalogRevision += 1;
}

export const useAppStore = create<AppState>()((set, get) => ({
  providers: [],
  models: [],
  extractionRules: [],
  promptTemplates: [],
  workflowSkills: [],
  chatSessions: [],
  chatFolders: [],
  pageContext: {
    loading: false,
    text: "",
    extractMode: "text",
    truncated: false,
    usedFallback: true,
  },
  contextTabs: [],
  contextTabsLoading: false,
  contextTabsError: undefined,
  remoteModels: {},
  channelOperations: {},
  modelConnectivity: {},
  selectedModelId: "",
  defaultChatModelId: "",
  chatPreferences: createDefaultChatPreferences(),
  automationPlaybookSettings: normalizeAutomationPlaybookSettings(undefined),
  importedSkillPlaybooks: [],
  browserControlEnabled: false,
  browserAutomationMode: "normal_restricted",
  runtimeReadonlyEnabled: false,
  browserAutomationDiagnostics: undefined,
  pendingBoundaryChoice: undefined,
  activeSessionId: "",
  privateModeActive: false,
  privateChatSession: undefined,
  pendingDeleteSessionId: undefined,
  composerHasDraft: false,
  chatTasksBySessionId: {},
  dismissedChatTaskIdsBySessionId: {},
  followUpsBySessionId: {},
  chatRetryProgressByMessageId: {},
  appendPageContextToSystemPrompt: true,
  streamMode: true,
  sending: false,
  contextMode: "text",
  syncSettings: DEFAULT_SYNC_SETTINGS,
  syncSecrets: DEFAULT_SYNC_SECRETS,
  webSearchSettings: DEFAULT_WEB_SEARCH_SETTINGS,
  mcpSettings: { servers: [] },
  mcpBearerTokens: {},
  remoteBackups: [],
  syncOperation: {
    loading: false,
  },
  syncRestoreBarrierActive: false,
  notifications: [],
  addNotification: (notification) => {
    const item = createAppNotification(notification);
    set((state) => ({ notifications: [item, ...state.notifications].slice(0, 5) }));
    return item.id;
  },
  dismissNotification: (notificationId) => {
    set((state) => ({ notifications: state.notifications.filter((notification) => notification.id !== notificationId) }));
  },
  clearFailure: () => set({ failure: undefined }),
  clearSyncOperationNotice: () => {
    set((state) => (
      state.syncOperation.message || state.syncOperation.error
        ? { syncOperation: { loading: state.syncOperation.loading } }
        : {}
    ));
  },
  clearChannelOperationNotice: (providerId) => {
    set((state) => {
      const operation = state.channelOperations[providerId];
      if (!operation?.message && !operation?.error) {
        return {};
      }

      return {
        channelOperations: {
          ...state.channelOperations,
          [providerId]: { loading: operation.loading },
        },
      };
    });
  },
  addExampleModel: () =>
    set(() => {
      markModelCatalogChanged();
      void saveModelProvider(exampleProvider);
      void saveProviderModel(exampleModel);

      return {
        providers: [exampleProvider],
        models: [exampleModel],
        selectedModelId: exampleModel.id,
      };
    }),
  addProvider: () => {
    markModelCatalogChanged();
    const now = Date.now();
    const index = get().providers.length + 1;
    const provider: ModelProvider = {
      id: `provider-${now}-${index}`,
      name: `新渠道 ${index}`,
      endpointType: "openai_chat",
      endpointUrl: "https://api.openai.com",
      apiKey: "",
      enabled: true,
      createdAt: now,
      updatedAt: now,
    };

    set((state) => ({ providers: [...state.providers, provider] }));
    void saveModelProvider(provider);
    return provider;
  },
  updateProvider: (providerId, updates) => {
    markModelCatalogChanged();
    set((state) => {
      const providers = state.providers.map((provider) =>
        provider.id === providerId
          ? {
              ...provider,
              ...updates,
              endpointType: updates.endpointType ? (updates.endpointType as EndpointType) : provider.endpointType,
              updatedAt: Date.now(),
            }
          : provider,
      );
      const updatedProvider = providers.find((provider) => provider.id === providerId);

      if (updatedProvider) {
        void saveModelProvider(updatedProvider);
      }

      return { providers };
    });
  },
  addModel: (providerId, overrides) => createAndStoreModel(providerId, get, set, overrides),
  addRemoteModel: (providerId, remoteModel) =>
    createAndStoreModel(providerId, get, set, {
      displayName: remoteModel.displayName,
      modelId: remoteModel.id,
    }),
  updateModel: (modelId, updates) => {
    markModelCatalogChanged();
    set((state) => {
      const models = state.models.map((model) =>
        model.id === modelId
          ? {
              ...model,
              ...updates,
              updatedAt: Date.now(),
            }
          : model,
      );
      const updatedModel = models.find((model) => model.id === modelId);

      if (updatedModel) {
        void saveProviderModel(updatedModel);
      }

      return { models };
    });
  },
  setTitleModel: (modelId) => {
    markModelCatalogChanged();
    set((state) => {
      const now = Date.now();
      const models = state.models.map((model) => {
        const isTitleModel = Boolean(modelId) && model.id === modelId;
        if (model.isTitleModel === isTitleModel) {
          return model;
        }

        return {
          ...model,
          isTitleModel,
          updatedAt: now,
        };
      });

      // 标题生成模型是全局唯一配置；保存所有变化项，避免刷新后出现多个标题模型。
      void Promise.all(models.filter((model, index) => model !== state.models[index]).map(saveProviderModel));

      return { models };
    });
  },
  setDefaultChatModel: async (modelId) => {
    const normalizedModelId = modelId.trim();

    await saveAppSetting({
      key: "defaultChatModelId",
      value: normalizedModelId,
      updatedAt: Date.now(),
    });

    set({ defaultChatModelId: normalizedModelId });
  },
  updateChatPreferences: async (updates) => {
    const previousPreferences = get().chatPreferences;
    const preferences = normalizeChatPreferences({
      ...previousPreferences,
      ...updates,
    });

    await saveAppSetting({
      key: "chatPreferences",
      value: preferences,
      updatedAt: Date.now(),
    });

    const activeSession = get().privateModeActive
      ? get().privateChatSession
      : get().chatSessions.find((session) => session.id === get().activeSessionId);
    const shouldApplyContextDefaultToCurrentChat =
      updates.injectPageContextByDefault !== undefined && (!activeSession || activeSession.messages.length === 0);
    const shouldApplyExtractDefaultToCurrentChat =
      updates.extractHtmlByDefault !== undefined && (!activeSession || activeSession.messages.length === 0);
    const defaultContextMode = resolveDefaultContextMode(preferences);

    set({
      chatPreferences: preferences,
      // 全局默认值只初始化空白新对话，避免改动已有消息对话中用户手动切换过的注入状态。
      ...(shouldApplyContextDefaultToCurrentChat ? { appendPageContextToSystemPrompt: preferences.injectPageContextByDefault } : {}),
      ...(shouldApplyExtractDefaultToCurrentChat
        ? {
            contextMode: defaultContextMode,
            pageContext: {
              ...get().pageContext,
              extractMode: defaultContextMode,
            },
          }
        : {}),
    });
    if (shouldApplyExtractDefaultToCurrentChat) {
      void get().refreshPageContext();
    }
  },
  updateAutomationPlaybookSettings: async (updates) => {
    const knownIds = getRegisteredAutomationPlaybooks(get().importedSkillPlaybooks).map((item) => item.id);
    const settings = normalizeAutomationPlaybookSettings({
      ...get().automationPlaybookSettings,
      ...updates,
    }, knownIds);
    await saveAppSetting({
      key: AUTOMATION_PLAYBOOK_SETTINGS_KEY,
      value: settings,
      updatedAt: Date.now(),
    });
    set({ automationPlaybookSettings: settings });
  },
  importSkillPlaybooksFromJson: async (fileText) => {
    const parsed = parseSkillPlaybookImportJson(fileText);
    if (!parsed.ok) {
      return parsed;
    }
    const now = Date.now();
    const merged = mergeImportedSkillPlaybooks(get().importedSkillPlaybooks, parsed.playbooks, now);
    if (!merged.ok) {
      return merged;
    }
    await saveAppSetting({
      key: AUTOMATION_SKILL_PLAYBOOKS_KEY,
      value: { playbooks: merged.playbooks },
      updatedAt: now,
    });
    set({ importedSkillPlaybooks: merged.playbooks });
    return { ok: true, importedCount: parsed.playbooks.length };
  },
  removeImportedSkillPlaybook: async (playbookId) => {
    const nextPlaybooks = get().importedSkillPlaybooks.filter((item) => item.id !== playbookId);
    const now = Date.now();
    await saveAppSetting({
      key: AUTOMATION_SKILL_PLAYBOOKS_KEY,
      value: { playbooks: nextPlaybooks },
      updatedAt: now,
    });
    const knownIds = getRegisteredAutomationPlaybooks(nextPlaybooks).map((item) => item.id);
    const automationPlaybookSettings = normalizeAutomationPlaybookSettings(
      {
        disabledPlaybookIds: get().automationPlaybookSettings.disabledPlaybookIds.filter((id) => id !== playbookId),
      },
      knownIds,
    );
    await saveAppSetting({
      key: AUTOMATION_PLAYBOOK_SETTINGS_KEY,
      value: automationPlaybookSettings,
      updatedAt: now,
    });
    set({
      importedSkillPlaybooks: nextPlaybooks,
      automationPlaybookSettings,
    });
  },
  updateActiveSessionChatPreferences: async (updates) => {
    const state = get();
    const now = Date.now();
    if (state.privateModeActive && state.privateChatSession) {
      set((current) => {
        if (!current.privateModeActive || !current.privateChatSession || current.privateChatSession.id !== state.privateChatSession?.id) {
          return {};
        }
        return {
          privateChatSession: {
            ...current.privateChatSession,
            updatedAt: Math.max(now, current.privateChatSession.updatedAt + 1),
            chatPreferenceOverrides: normalizeChatPreferenceOverrides({
              ...current.privateChatSession.chatPreferenceOverrides,
              ...updates,
            }),
          },
        };
      });
      return;
    }

    const existingSession = state.chatSessions.find((session) => session.id === state.activeSessionId);
    if (!existingSession) {
      const session: ChatSession = {
        id: createSessionId(now),
        title: "新对话",
        archived: false,
        sortOrder: now,
        createdAt: now,
        updatedAt: now,
        selectedModelId: state.selectedModelId,
        messages: [],
        chatPreferenceOverrides: normalizeChatPreferenceOverrides(updates),
      };
      await saveChatSession(session);
      set((current) => ({
        activeSessionId: session.id,
        chatSessions: upsertSession(current.chatSessions, session),
      }));
      return;
    }

    const updatedSession = await updateChatSession(existingSession.id, (latestSession) => ({
      ...latestSession,
      updatedAt: Math.max(now, latestSession.updatedAt + 1),
      chatPreferenceOverrides: normalizeChatPreferenceOverrides({
        ...latestSession.chatPreferenceOverrides,
        ...updates,
      }),
    }));
    if (!updatedSession) {
      return;
    }
    set((current) => ({
      activeSessionId: updatedSession.id,
      chatSessions: upsertSession(current.chatSessions, updatedSession),
    }));
  },
  setBrowserControlEnabled: async (enabled) => {
    const previousEnabled = get().browserControlEnabled;
    const previousMode = get().browserAutomationMode;
    if (previousEnabled === enabled) {
      return;
    }

    set({
      browserControlEnabled: enabled,
      browserAutomationMode: "normal_restricted",
      ...(enabled ? { pendingBoundaryChoice: undefined } : { runtimeReadonlyEnabled: false, pendingBoundaryChoice: undefined }),
    });
    const response = await syncBrowserControlEnabled(enabled);
    if (!response.ok) {
      set({
        browserControlEnabled: previousEnabled,
        browserAutomationMode: previousMode,
        failure: { message: response.message },
      });
    }
  },
  setBrowserAutomationMode: async (mode) => {
    if (!get().browserControlEnabled) {
      set({ browserAutomationMode: "normal_restricted", failure: { message: "请先开启浏览器控制，再切换自动化模式。" } });
      return;
    }
    const previousMode = get().browserAutomationMode;
    set({ browserAutomationMode: mode, pendingBoundaryChoice: undefined });
    const response = await syncBrowserAutomationMode(mode);
    if (!response.ok) {
      set({ browserAutomationMode: previousMode, failure: { message: response.message } });
    }
  },
  setRuntimeReadonlyEnabled: async (enabled) => {
    const previousEnabled = get().runtimeReadonlyEnabled;
    if (previousEnabled === enabled) {
      return;
    }
    if (enabled && !get().browserControlEnabled) {
      set({ failure: { message: "请先开启浏览器控制，再开启运行时只读分析。" } });
      return;
    }

    set({ runtimeReadonlyEnabled: enabled });
    const response = await syncRuntimeReadonlyEnabled(enabled);
    if (!response.ok) {
      set({
        runtimeReadonlyEnabled: previousEnabled,
        failure: { message: response.message },
      });
    }
  },
  refreshBrowserAutomationDiagnostics: async () => {
    const response = await sendRuntimeMessage<{
      ok: boolean;
      diagnostics?: BrowserControlDiagnostics;
      message?: string;
    }>({
      type: BROWSER_CONTROL_GET_DIAGNOSTICS_MESSAGE_TYPE,
    });

    if (response?.ok && response.diagnostics) {
      set({ browserAutomationDiagnostics: response.diagnostics });
    }
  },
  markBrowserControlDetached: () => {
    set({
      browserControlEnabled: false,
      runtimeReadonlyEnabled: false,
      browserAutomationMode: "normal_restricted",
      browserAutomationDiagnostics: undefined,
      pendingBoundaryChoice: undefined,
    });
  },
  markBrowserAutomationModeChanged: (mode) => {
    set((state) => ({
      browserAutomationMode: state.browserControlEnabled ? mode : "normal_restricted",
      runtimeReadonlyEnabled: state.browserControlEnabled,
      ...(mode === "normal_restricted" ? { pendingBoundaryChoice: undefined } : {}),
    }));
  },
  markRuntimeReadonlyChanged: (enabled) => {
    set((state) => ({
      runtimeReadonlyEnabled: enabled && state.browserControlEnabled,
    }));
  },
  showBoundaryChoiceRequest: (request) => {
    set({ pendingBoundaryChoice: request });
  },
  respondBoundaryChoice: async (requestId, selectedChoiceIds, otherText) => {
    const response = await sendRuntimeMessage<BrowserControlResponse>({
      type: BROWSER_CONTROL_BOUNDARY_CHOICE_RESPOND_MESSAGE_TYPE,
      requestId,
      selectedChoiceIds,
      otherText,
    });
    if (!response?.ok) {
      set({ failure: { message: response?.message || "提交边界确认失败。" } });
      return;
    }
    set((state) => state.pendingBoundaryChoice?.requestId === requestId ? { pendingBoundaryChoice: undefined } : {});
  },
  deleteProvider: (providerId) => {
    markModelCatalogChanged();
    let sessionToPersist: ChatSession | undefined;
    set((state) => {
      const removedModelIds = new Set(state.models.filter((model) => model.providerId === providerId).map((model) => model.id));
      const models = state.models.filter((model) => model.providerId !== providerId);
      const selectedModelId = removedModelIds.has(state.selectedModelId) ? models[0]?.id ?? "" : state.selectedModelId;
      const shouldClearDefaultChatModel = removedModelIds.has(state.defaultChatModelId);
      const defaultChatModelId = shouldClearDefaultChatModel ? "" : state.defaultChatModelId;
      const { [providerId]: _remoteModels, ...remoteModels } = state.remoteModels;
      const { [providerId]: _operation, ...channelOperations } = state.channelOperations;
      const modelConnectivity = Object.fromEntries(
        Object.entries(state.modelConnectivity).filter(([modelId]) => !removedModelIds.has(modelId)),
      );

      removedModelIds.forEach(clearModelConnectivityResetTimer);

      void deleteModelProvider(providerId);
      if (shouldClearDefaultChatModel) {
        // 默认对话模型不能指向已删除模型，否则刷新后会留下无效配置。
        void saveAppSetting({ key: "defaultChatModelId", value: "", updatedAt: Date.now() });
      }

      const modelSyncResult = syncActiveSessionSelectedModelAfterModelRemoval(
        state.chatSessions,
        state.activeSessionId,
        removedModelIds,
        selectedModelId,
      );
      sessionToPersist = modelSyncResult.session;

      return {
        providers: state.providers.filter((provider) => provider.id !== providerId),
        models,
        chatSessions: modelSyncResult.chatSessions,
        selectedModelId,
        defaultChatModelId,
        remoteModels,
        channelOperations,
        modelConnectivity,
      };
    });
    if (sessionToPersist) {
      void persistSessionSelectedModel(sessionToPersist);
    }
  },
  deleteModel: (modelId) => {
    markModelCatalogChanged();
    let sessionToPersist: ChatSession | undefined;
    set((state) => {
      const models = state.models.filter((model) => model.id !== modelId);
      const selectedModelId = state.selectedModelId === modelId ? models[0]?.id ?? "" : state.selectedModelId;
      const shouldClearDefaultChatModel = state.defaultChatModelId === modelId;
      const defaultChatModelId = shouldClearDefaultChatModel ? "" : state.defaultChatModelId;
      const { [modelId]: _operation, ...modelConnectivity } = state.modelConnectivity;

      clearModelConnectivityResetTimer(modelId);

      void deleteProviderModel(modelId);
      if (shouldClearDefaultChatModel) {
        // 默认对话模型不能指向已删除模型，否则刷新后会留下无效配置。
        void saveAppSetting({ key: "defaultChatModelId", value: "", updatedAt: Date.now() });
      }

      const modelSyncResult = syncActiveSessionSelectedModelAfterModelRemoval(
        state.chatSessions,
        state.activeSessionId,
        new Set([modelId]),
        selectedModelId,
      );
      sessionToPersist = modelSyncResult.session;

      return {
        models,
        chatSessions: modelSyncResult.chatSessions,
        selectedModelId,
        defaultChatModelId,
        modelConnectivity,
      };
    });
    if (sessionToPersist) {
      void persistSessionSelectedModel(sessionToPersist);
    }
  },
  loadChannelConfig: async () => {
    const revisionAtStart = modelCatalogRevision;
    const [providers, models, savedDefaultChatModelId, savedChatPreferences, savedAutomationPlaybookSettings, savedSkillPlaybooks, webSearchSettings, mcpSettings] = await Promise.all([
      getModelProviders(),
      getProviderModels(),
      getAppSetting<string>("defaultChatModelId"),
      getAppSetting<Partial<ChatPreferenceValues>>("chatPreferences"),
      getAppSetting<Partial<AutomationPlaybookSettings>>(AUTOMATION_PLAYBOOK_SETTINGS_KEY),
      getAppSetting<unknown>(AUTOMATION_SKILL_PLAYBOOKS_KEY),
      getWebSearchSettings(),
      getMcpSettings(),
    ]);
    const mcpBearerTokens = await readMcpBearerTokens(mcpSettings);
    const currentState = get();
    const catalogChangedDuringLoad = modelCatalogRevision !== revisionAtStart;
    const resolvedProviders = catalogChangedDuringLoad ? currentState.providers : providers;
    const resolvedModels = catalogChangedDuringLoad ? currentState.models : models;
    const defaultChatModelId = resolveConfiguredModelId(savedDefaultChatModelId ?? "", resolvedModels, resolvedProviders);
    const currentSelectedModelId = currentState.selectedModelId;
    const selectedModelStillExists = Boolean(
      currentSelectedModelId &&
      resolveAvailableModelId(currentSelectedModelId, resolvedModels, resolvedProviders) === currentSelectedModelId,
    );
    const activeSession = currentState.chatSessions.find((session) => session.id === currentState.activeSessionId);
    const activeSessionModelId = activeSession?.selectedModelId
      ? resolveAvailableModelId(activeSession.selectedModelId, resolvedModels, resolvedProviders)
      : "";
    const chatPreferences = normalizeChatPreferences(savedChatPreferences);
    const importedSkillPlaybooks = normalizeImportedSkillPlaybooks(savedSkillPlaybooks);
    const knownIds = getRegisteredAutomationPlaybooks(importedSkillPlaybooks).map((item) => item.id);
    const automationPlaybookSettings = normalizeAutomationPlaybookSettings(savedAutomationPlaybookSettings, knownIds);

    set({
      providers: resolvedProviders,
      models: resolvedModels,
      defaultChatModelId,
      chatPreferences,
      automationPlaybookSettings,
      importedSkillPlaybooks,
      webSearchSettings,
      mcpSettings,
      mcpBearerTokens,
      appendPageContextToSystemPrompt: chatPreferences.injectPageContextByDefault,
      contextMode: resolveDefaultContextMode(chatPreferences),
      pageContext: {
        ...get().pageContext,
        extractMode: resolveDefaultContextMode(chatPreferences),
      },
      selectedModelId:
        activeSessionModelId ||
        (selectedModelStillExists
          ? currentSelectedModelId
          : (defaultChatModelId || resolveAvailableModelId("", resolvedModels, resolvedProviders))),
    });
  },
  loadChatData: async () => {
    if (globalThis.chrome?.runtime?.id) {
      let activeStreamSessionIds: string[] = [];
      const response = await sendRuntimeMessage<{ ok?: boolean; sessionIds?: string[] }>({ type: "chat.getActiveStreamSessions" });
      if (response?.ok && Array.isArray(response.sessionIds)) {
        activeStreamSessionIds = response.sessionIds.filter((sessionId): sessionId is string => typeof sessionId === "string");
      }
      await recoverInterruptedChatSessions(activeStreamSessionIds);
    }
    const [chatSessions, chatFolders] = await Promise.all([getChatSessions(), getChatFolders()]);
    const followUpsBySessionId = Object.fromEntries(
      chatSessions
        .filter((session) => session.pendingFollowUps?.length)
        .map((session) => [session.id, session.pendingFollowUps ?? []]),
    );
    set((state) => ({
      chatSessions,
      chatFolders,
      followUpsBySessionId,
      ...resolveActiveChatSessionSelection(state, chatSessions),
    }));
    await get().loadWorkflowSkills();
  },
  createChatSession: async (options) => {
    const now = Date.now();
    const currentState = get();
    const selectedModelId = options?.preserveSelectedModel
      ? resolveAvailableModelId(currentState.selectedModelId, currentState.models, currentState.providers)
      : resolveAvailableModelId(currentState.defaultChatModelId, currentState.models, currentState.providers);
    const session: ChatSession = {
      id: createSessionId(now),
      title: "新对话",
      archived: false,
      sortOrder: now,
      createdAt: now,
      updatedAt: now,
      selectedModelId,
      messages: [],
    };

    if (currentState.syncRestoreBarrierActive) {
      return currentState.privateChatSession
        ?? currentState.chatSessions.find((item) => item.id === currentState.activeSessionId)
        ?? currentState.chatSessions[0]
        ?? session;
    }

    await saveChatSession(session);
    const defaultContextMode = resolveDefaultContextMode(currentState.chatPreferences);
    set((state) => ({
      followUpsBySessionId: removeSessionFollowUps(state.followUpsBySessionId, currentState.privateChatSession?.id),
      chatSessions: [session, ...state.chatSessions],
      activeSessionId: session.id,
      selectedModelId,
      privateModeActive: false,
      privateChatSession: undefined,
      pendingDeleteSessionId: undefined,
      sending: false,
      appendPageContextToSystemPrompt: currentState.chatPreferences.injectPageContextByDefault,
      contextMode: defaultContextMode,
      pageContext: {
        ...state.pageContext,
        extractMode: defaultContextMode,
      },
      contextTabs: [],
      contextTabsLoading: false,
      contextTabsError: undefined,
    }));
    if (currentState.chatPreferences.extractHtmlByDefault) {
      void get().refreshPageContext();
    }
    return session;
  },
  enterPrivateMode: async () => {
    const state = get();
    if (state.syncRestoreBarrierActive || state.privateModeActive) {
      return;
    }

    const activeSession = state.chatSessions.find((session) => session.id === state.activeSessionId);
    if (activeSession && activeSession.messages.length > 0) {
      return;
    }

    if (activeSession) {
      await deleteChatSession(activeSession.id);
    }

    const now = Date.now();
    const selectedModelId = resolveAvailableModelId(
      activeSession?.selectedModelId || state.selectedModelId || state.defaultChatModelId,
      state.models,
      state.providers,
    );
    const privateChatSession: ChatSession = {
      id: `private-session-${now}`,
      title: "新对话",
      archived: false,
      sortOrder: now,
      createdAt: now,
      updatedAt: now,
      selectedModelId,
      messages: [],
    };
    const defaultContextMode = resolveDefaultContextMode(state.chatPreferences);

    set((current) => ({
      privateModeActive: true,
      privateChatSession,
      activeSessionId: "",
      selectedModelId,
      pendingDeleteSessionId: undefined,
      sending: false,
      chatSessions: activeSession ? current.chatSessions.filter((session) => session.id !== activeSession.id) : current.chatSessions,
      appendPageContextToSystemPrompt: state.chatPreferences.injectPageContextByDefault,
      contextMode: defaultContextMode,
      pageContext: {
        ...current.pageContext,
        extractMode: defaultContextMode,
      },
      contextTabs: [],
      contextTabsLoading: false,
      contextTabsError: undefined,
    }));
    if (state.chatPreferences.extractHtmlByDefault) {
      void get().refreshPageContext();
    }
  },
  savePrivateChatSession: async () => {
    const state = get();
    if (state.syncRestoreBarrierActive) {
      return;
    }
    const privateChatSession = state.privateChatSession;
    if (!state.privateModeActive || !privateChatSession || privateChatSession.messages.length === 0) {
      set({ privateModeActive: false, privateChatSession: undefined });
      return;
    }
    if (isSessionTaskRunning(state.chatTasksBySessionId, privateChatSession.id)) {
      set({ failure: { message: "隐私对话仍在生成中，请先终止或等待完成后再保存。" } });
      return;
    }

    const sessionId = privateChatSession.id.replace(/^private-session-/, "session-");
    const pendingFollowUps = (state.followUpsBySessionId[privateChatSession.id] ?? []).map((followUp) => ({
      ...followUp,
      sessionId,
    }));
    const sessionToSave: ChatSession = {
      ...privateChatSession,
      id: sessionId,
      updatedAt: Date.now(),
      pendingFollowUps: pendingFollowUps.length ? pendingFollowUps : undefined,
      workflowTasks: privateChatSession.workflowTasks?.map((task) => ({
        ...task,
        sessionId,
      })),
    };

    await saveChatSession(sessionToSave);
    set((current) => ({
      privateModeActive: false,
      privateChatSession: undefined,
      activeSessionId: sessionToSave.id,
      selectedModelId: resolveSessionModelId(sessionToSave, current),
      sending: isSessionTaskRunning(current.chatTasksBySessionId, sessionToSave.id),
      chatSessions: upsertSession(current.chatSessions, sessionToSave),
      followUpsBySessionId: migrateSessionFollowUps(current.followUpsBySessionId, privateChatSession.id, sessionToSave.id),
    }));
    await generateTitleFromSavedPrivateSession({
      session: sessionToSave,
      get,
      set,
    });
  },
  selectChatSession: (sessionId, options) => {
    set((state) => {
      const session = state.chatSessions.find((item) => item.id === sessionId);
      if (!session) {
        return { pendingDeleteSessionId: undefined };
      }
      if (state.privateModeActive && state.privateChatSession && state.privateChatSession.messages.length > 0 && !options?.discardPrivateSession) {
        return { pendingDeleteSessionId: undefined };
      }

      const taskId = state.chatTasksBySessionId[sessionId]?.id;
      const dismissedChatTaskIdsBySessionId = { ...state.dismissedChatTaskIdsBySessionId };
      const activeTask = state.activeSessionId ? state.chatTasksBySessionId[state.activeSessionId] : undefined;
      // 运行中会话被用户切回时只是临时隐藏边框，离开后仍需恢复后台运行提示；终态会话被打开后视为已读，保留隐藏记录。
      if (state.activeSessionId && state.activeSessionId !== sessionId && activeTask?.status === "running") {
        delete dismissedChatTaskIdsBySessionId[state.activeSessionId];
      }
      if (taskId) {
        dismissedChatTaskIdsBySessionId[sessionId] = taskId;
      }
      return {
        activeSessionId: sessionId,
        privateModeActive: false,
        privateChatSession: undefined,
        pendingDeleteSessionId: undefined,
        followUpsBySessionId: removeSessionFollowUps(state.followUpsBySessionId, state.privateChatSession?.id),
        dismissedChatTaskIdsBySessionId,
        sending: isSessionTaskRunning(state.chatTasksBySessionId, sessionId),
        selectedModelId: resolveSessionModelId(session, state),
        ...(session.messages.length === 0
          ? {
              contextTabs: [],
              contextTabsLoading: false,
              contextTabsError: undefined,
            }
          : {}),
      };
    });
  },
  renameChatSession: (sessionId, title) => get().syncRestoreBarrierActive
    ? Promise.resolve()
    : renameChatSessionAction({ sessionId, title, get, set }),
  archiveChatSession: (sessionId) => get().syncRestoreBarrierActive
    ? Promise.resolve()
    : archiveChatSessionAction({ sessionId, get, set }),
  requestDeleteChatSession: (sessionId) => {
    if (!get().syncRestoreBarrierActive) {
      requestDeleteChatSessionAction({ sessionId, set });
    }
  },
  confirmDeleteChatSession: async (sessionId) => {
    if (get().syncRestoreBarrierActive) {
      return;
    }
    get().abortChatTask(sessionId);
    await confirmDeleteChatSessionAction({ sessionId, set });
    set((state) => {
      const chatTasksBySessionId = clearChatTask(state.chatTasksBySessionId, sessionId);
      const dismissedChatTaskIdsBySessionId = { ...state.dismissedChatTaskIdsBySessionId };
      const followUpsBySessionId = { ...state.followUpsBySessionId };
      delete dismissedChatTaskIdsBySessionId[sessionId];
      delete followUpsBySessionId[sessionId];
      return {
        chatTasksBySessionId,
        dismissedChatTaskIdsBySessionId,
        followUpsBySessionId,
        sending: isSessionTaskRunning(chatTasksBySessionId, state.activeSessionId),
      };
    });
  },
  clearPendingDeleteSession: () => clearPendingDeleteSessionAction({ set }),
  createChatFolder: (name) => createChatFolderAction({ name, set }),
  renameChatFolder: (folderId, name) => renameChatFolderAction({ folderId, name, get, set }),
  deleteEmptyChatFolder: (folderId) => deleteEmptyChatFolderAction({ folderId, get, set }),
  moveChatSessionToFolder: (sessionId, folderId) => get().syncRestoreBarrierActive
    ? Promise.resolve()
    : moveChatSessionToFolderAction({ sessionId, folderId, get, set }),
  loadExtractionRules: () => loadExtractionRulesAction({ set }),
  saveRuleDraft: (ruleId, draft) => saveRuleDraftAction({ ruleId, draft, get }),
  deleteRule: (ruleId) => deleteRuleAction({ ruleId, get }),
  moveRule: (ruleId, direction) => moveRuleAction({ ruleId, direction, get }),
  loadPromptTemplates: () => loadPromptTemplatesAction({ set }),
  savePromptTemplateDraft: (promptId, draft) => savePromptTemplateDraftAction({ promptId, draft, get }),
  deletePrompt: (promptId) => deletePromptAction({ promptId, get }),
  reorderPromptTemplates: (orderedIds) => reorderPromptTemplatesAction({ orderedIds, get }),
  loadContextTabs: () => loadContextTabsAction({ set }),
  toggleContextTabSelection: (tabId) => toggleContextTabSelectionAction({ tabId, get, set }),
  refreshPageContext: () => refreshPageContextAction({ get, set }),
  generateUrlPatterns: (modelId) => generateUrlPatternsAction({ modelId, get }),
  fetchRemoteModels: async (providerId) => {
    const provider = get().providers.find((item) => item.id === providerId);
    if (!provider) {
      return;
    }

    setChannelOperation(set, providerId, { loading: true });

    const response = await sendRuntimeMessage<{ ok: boolean; models?: RemoteModelInfo[]; message?: string }>({
      type: "modelCatalog.list",
      provider,
    });

    if (response.ok) {
      set((state) => ({
        remoteModels: {
          ...state.remoteModels,
          [providerId]: response.models ?? [],
        },
        channelOperations: {
          ...state.channelOperations,
          [providerId]: {
            loading: false,
            message: "模型列表获取成功",
          },
        },
      }));
      return;
    }

    setChannelOperation(set, providerId, { loading: false, error: response.message ?? "获取模型列表失败" });
  },
  testModel: async (providerId, modelId) => {
    const provider = get().providers.find((item) => item.id === providerId);
    const model = get().models.find((item) => item.id === modelId);
    if (!provider || !model) {
      return;
    }

    setModelConnectivity(set, modelId, { loading: true });

    const response = await sendRuntimeMessage<{ ok: boolean; message: string }>({
      type: "modelCatalog.test",
      provider,
      model,
    });

    if (response.ok) {
      setModelConnectivity(set, modelId, { loading: false, success: true });
      scheduleModelConnectivityReset(set, modelId);
      return;
    }

    setModelConnectivity(set, modelId, { loading: false, error: response.message });
  },
  selectModel: async (modelId) => {
    const state = get();
    const normalizedModelId = modelId.trim();
    const selectedModelId = normalizedModelId
      ? resolveAvailableModelId(normalizedModelId, state.models, state.providers)
      : "";
    if (state.privateModeActive && state.privateChatSession) {
      const privateSessionId = state.privateChatSession.id;
      set((current) => current.privateModeActive && current.privateChatSession?.id === privateSessionId
        ? {
            selectedModelId,
            privateChatSession: {
              ...current.privateChatSession,
              selectedModelId,
              updatedAt: Date.now(),
            },
          }
        : {});
      return;
    }

    const activeSession = state.chatSessions.find((session) => session.id === state.activeSessionId);

    if (!activeSession) {
      set({ selectedModelId });
      return;
    }

    const updatedSession = await updateChatSession(activeSession.id, (latestSession) => ({
      ...latestSession,
      selectedModelId,
      updatedAt: Date.now(),
    }));

    set((current) => ({
      selectedModelId,
      chatSessions: updatedSession ? upsertSession(current.chatSessions, updatedSession) : current.chatSessions,
    }));
  },
  setComposerHasDraft: (hasDraft) => set({ composerHasDraft: hasDraft }),
  setAppendPageContextToSystemPrompt: (enabled) => set({ appendPageContextToSystemPrompt: enabled }),
  setStreamMode: (streamMode) => set({ streamMode }),
  setContextMode: (contextMode) => {
    set((state) => ({
      contextMode,
      pageContext: {
        ...state.pageContext,
        extractMode: contextMode,
      },
    }));
    void get().refreshPageContext();
  },
  loadSyncSettings: () => loadSyncSettingsAction({ set }),
  updateSyncSettings: (updates) => updateSyncSettingsAction({ updates, get, set }),
  updateSyncSecret: (key, value) => updateSyncSecretAction({ key, value, set }),
  updateWebSearchSettings: (updates) => updateWebSearchSettingsAction({ updates, get, set }),
  updateMcpServer: (serverId, draft) => updateMcpServerAction({ serverId, draft, get, set }),
  setMcpServerEnabled: (serverId, enabled) => setMcpServerEnabledAction({ serverId, enabled, get, set }),
  deleteMcpServer: (serverId) => deleteMcpServerAction({ serverId, get, set }),
  refreshMcpServerTools: (serverId) => refreshMcpServerToolsAction({ serverId, get, set, enableDiscoveredTools: true }),
  backupNow: () => backupNowAction({ set }),
  loadRemoteBackups: () => loadRemoteBackupsAction({ set }),
  restoreNow: (backupId) => restoreNowAction({ backupId, get, set }),
  sendChatMessage: async (content, attachments = [], promptInvocations = [], selectedPlaybookId) => {
    await sendChatMessageWithState({ content, attachments, promptInvocations, selectedPlaybookId, get, set });
  },
  sendWorkflowTaskMessage: async (taskId, content) => {
    const state = get();
    if (state.syncRestoreBarrierActive) {
      return;
    }
    const task = findWorkflowTaskInState(state, taskId);
    if (!task) {
      throw new Error("未找到工作流任务");
    }

    if (task.status === "running") {
      return;
    }
    if (task.status !== "preparing" && task.status !== "waiting") {
      throw new Error("任务已结束，不能继续发送");
    }
    await get().updateWorkflowTaskStatus(taskId, "running");
    const sent = await sendChatMessageWithState({
      content,
      targetSessionId: task.sessionId,
      workflowTaskId: taskId,
      get,
      set,
    });
    if (!sent) {
      await get().updateWorkflowTaskStatus(taskId, "failed", "消息未发送，请检查模型配置后重试");
    }
  },
  submitChatFollowUp: (content, attachments = [], promptInvocations = [], options = {}) =>
    submitChatFollowUpWithState({ content, attachments, promptInvocations, behavior: options.behavior, get, set }),
  removeChatFollowUp: (sessionId, followUpId) => {
    set((state) => updateSessionFollowUpsInState(
      state,
      sessionId,
      (state.followUpsBySessionId[sessionId] ?? []).filter((item) => item.id !== followUpId),
    ));
    void persistSessionFollowUps(sessionId, (followUps) => followUps.filter((item) => item.id !== followUpId));
  },
  guideChatFollowUp: (sessionId, followUpId) => {
    const state = get();
    if (state.syncRestoreBarrierActive) {
      return;
    }
    const followUp = state.followUpsBySessionId[sessionId]?.find((item) => item.id === followUpId);
    if (!followUp) {
      return;
    }
    if (!isSessionTaskRunning(state.chatTasksBySessionId, sessionId)) {
      void consumeQueuedFollowUp(sessionId, followUpId, get, set);
      return;
    }
    const userMessageId = followUp.userMessageId ?? appendFollowUpUserMessage({
      sessionId,
      followUp,
      state,
      set,
    });
    const delivered = sendChatTaskFollowUp(sessionId, {
      id: followUp.id,
      content: followUp.content,
      attachments: followUp.attachments,
      promptInvocations: followUp.promptInvocations,
      userMessageId,
    });

    set((current) => updateSessionFollowUpsInState(
      current,
      sessionId,
      (current.followUpsBySessionId[sessionId] ?? []).map((item) =>
        item.id === followUpId ? { ...item, behavior: delivered ? "guide" : "queue", userMessageId } : item,
      ),
    ));
    void persistSessionFollowUps(sessionId, (followUps) => followUps.map((item) =>
      item.id === followUpId ? { ...item, behavior: delivered ? "guide" : "queue", userMessageId } : item,
    ));
  },
  regenerateMessage: (messageId) => regenerateChatMessage({ messageId, get, set }),
  editAndRegenerateUserMessage: (messageId, content, promptInvocations) => editAndRegenerateUserMessage({ messageId, content, promptInvocations, get, set }),
  abortChatTask: (sessionId) => {
    const aborted = abortChatTaskHandle(sessionId);
    set((state) => {
      const taskId = state.chatTasksBySessionId[sessionId]?.id;
      const chatTasksBySessionId = finishChatTask(state.chatTasksBySessionId, sessionId, "canceled", Date.now(), taskId);
      return {
        chatTasksBySessionId,
        chatRetryProgressByMessageId: clearChatRetryProgressForSession(state, sessionId),
        sending: isSessionTaskRunning(chatTasksBySessionId, state.activeSessionId),
        pendingBoundaryChoice: undefined,
        ...(aborted ? { failure: undefined } : {}),
      };
    });
  },
  abortActiveChatTask: () => {
    const state = get();
    const sessionId = state.privateModeActive ? state.privateChatSession?.id : state.activeSessionId;
    if (sessionId) {
      get().abortChatTask(sessionId);
    }
  },
  reset: () => {
    markModelCatalogChanged();
    clearAllModelConnectivityResetTimers();
    clearChatTaskAbortHandles();
    resetPageContextRefreshSequence();

    set({
      providers: [],
      models: [],
      extractionRules: [],
      promptTemplates: [],
      workflowSkills: [],
      chatSessions: [],
      chatFolders: [],
      pageContext: {
        loading: false,
        text: "",
        extractMode: "text",
        truncated: false,
        usedFallback: true,
      },
      contextTabs: [],
      contextTabsLoading: false,
      contextTabsError: undefined,
      remoteModels: {},
      channelOperations: {},
      modelConnectivity: {},
      selectedModelId: "",
      defaultChatModelId: "",
      chatPreferences: createDefaultChatPreferences(),
      automationPlaybookSettings: normalizeAutomationPlaybookSettings(undefined),
      importedSkillPlaybooks: [],
      browserControlEnabled: false,
      browserAutomationMode: "normal_restricted",
      runtimeReadonlyEnabled: false,
      browserAutomationDiagnostics: undefined,
      activeSessionId: "",
      privateModeActive: false,
      privateChatSession: undefined,
      pendingDeleteSessionId: undefined,
      composerHasDraft: false,
      chatTasksBySessionId: {},
      dismissedChatTaskIdsBySessionId: {},
      followUpsBySessionId: {},
      chatRetryProgressByMessageId: {},
      appendPageContextToSystemPrompt: true,
      streamMode: true,
      sending: false,
      contextMode: "text",
      syncSettings: DEFAULT_SYNC_SETTINGS,
      syncSecrets: DEFAULT_SYNC_SECRETS,
      webSearchSettings: DEFAULT_WEB_SEARCH_SETTINGS,
      mcpSettings: { servers: [] },
      mcpBearerTokens: {},
      pendingBoundaryChoice: undefined,
      syncOperation: {
        loading: false,
      },
      syncRestoreBarrierActive: false,
      remoteBackups: [],
      failure: undefined,
      notifications: [],
    });
  },
  ...createWorkflowTaskActions({ get, set }),
}));

async function persistSessionSelectedModel(session: ChatSession): Promise<void> {
  await updateChatSession(session.id, (latestSession) => ({
    ...latestSession,
    selectedModelId: session.selectedModelId,
    updatedAt: session.updatedAt,
  }));
}

function createDefaultSessionTitle(content: string): string {
  return content.length > 20 ? `${content.slice(0, 20)}...` : content;
}

function createVisibleUserTitleContent(content: string, promptInvocations: ChatPromptInvocation[]): string {
  const trimmedContent = content.trim();
  if (trimmedContent) {
    return trimmedContent;
  }

  return promptInvocations.map((prompt) => prompt.title).join("、") || "新对话";
}

export type StoreGetter = StoreApi<AppState>["getState"];
export type StoreSetter = StoreApi<AppState>["setState"];

function findWorkflowTaskInState(state: AppState, taskId: string): WorkflowTask | undefined {
  const privateTask = state.privateChatSession?.workflowTasks?.find((task) => task.id === taskId);
  if (privateTask) {
    return privateTask;
  }

  for (const session of state.chatSessions) {
    const task = session.workflowTasks?.find((item) => item.id === taskId);
    if (task) {
      return task;
    }
  }

  return undefined;
}

export type AppChatSendMessage = {
  type: "chat.send";
  tabId?: number;
  model: ReturnType<typeof createModelConfig>;
  messages: ChatMessage[];
  stream: boolean;
  structuredOutput?: OpenAIStructuredOutputFormat;
  enabledToolIds?: string[];
  toolChoice?: ModelToolChoice;
  tavily?: TavilySearchOptions;
  retryCount?: number;
  tokenUsageSource?: ChatTokenUsageSource;
  browserAutomationMaxToolIterations?: number;
  automationPlaybookSettings?: AutomationPlaybookSettings;
  importedSkillPlaybooks?: ImportedAutomationPlaybook[];
  selectedPlaybookId?: string;
  extractionRules?: ExtractionRule[];
  mcp?: McpSettings & { bearerTokens?: McpServerSecretMap };
  debugContext?: ChatSendDebugContext;
  workspaceRequestLoggingEnabled?: boolean;
  requestLogging?: {
    sidebarState: {
      mode: AppState["browserAutomationMode"];
      privateMode?: boolean;
      toolCallingEnabled: boolean;
      enabledToolIds: string[];
      toolCallDisplayMode: ChatPreferenceValues["toolCallDisplayMode"];
      showToolCallProcessInAssistantMode: boolean;
      browserAutomationMaxToolIterations: number;
      followUpBehavior: ChatPreferenceValues["followUpBehavior"];
      systemPrompt: string;
      pageContext: {
        inject: boolean;
        extractMode?: PageContextExtractMode;
      };
      mcp: {
        servers: Array<{ id: string; enabled: boolean; toolCount?: number }>;
      };
      browserControlEnabled?: boolean;
      streamMode?: boolean;
    };
  };
};

function resolveSelectedContextTabId(contextTabs: ContextTabCandidate[]): number | undefined {
  const selectedTab = contextTabs.find((tab) => tab.selected && tab.active) ?? contextTabs.find((tab) => tab.selected);
  const tabId = selectedTab?.tabId;

  return typeof tabId === "number" && Number.isInteger(tabId) ? tabId : undefined;
}

function formatDebugTimestamp(timestamp: number): string {
  return new Date(timestamp).toISOString();
}

function getDebugTimeZone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return undefined;
  }
}

function createChatSendDebugContext(input: {
  requestCreatedAt: number;
  session: ChatSession;
  nextSession: ChatSession;
  userMessage: ChatMessage;
  existingMessageCount: number;
  requestMessageCount: number;
  stream: boolean;
  privateMode?: boolean;
  selectedContextTabId?: number;
  enabledToolIds: string[];
}): ChatSendDebugContext {
  return {
    source: "side_panel_chat",
    requestId: `chat-${input.requestCreatedAt}-${Math.random().toString(36).slice(2, 8)}`,
    requestCreatedAt: input.requestCreatedAt,
    requestCreatedAtIso: formatDebugTimestamp(input.requestCreatedAt),
    requestTimeZone: getDebugTimeZone(),
    sessionId: input.nextSession.id,
    sessionTitle: input.nextSession.title,
    sessionCreatedAt: input.nextSession.createdAt,
    sessionCreatedAtIso: formatDebugTimestamp(input.nextSession.createdAt),
    sessionUpdatedAtBeforeRequest: input.session.updatedAt,
    sessionUpdatedAtBeforeRequestIso: formatDebugTimestamp(input.session.updatedAt),
    sessionUpdatedAtAtRequest: input.nextSession.updatedAt,
    sessionUpdatedAtAtRequestIso: formatDebugTimestamp(input.nextSession.updatedAt),
    userMessageId: input.userMessage.id,
    userMessageCreatedAt: input.userMessage.createdAt,
    userMessageCreatedAtIso: formatDebugTimestamp(input.userMessage.createdAt),
    messageCountBeforeRequest: input.existingMessageCount,
    messageCountInSessionAtRequest: input.nextSession.messages.length,
    requestMessageCount: input.requestMessageCount,
    privateMode: Boolean(input.privateMode),
    stream: input.stream,
    enabledToolIds: input.enabledToolIds,
    currentTimeToolEnabled: input.enabledToolIds.includes(CURRENT_TIME_TOOL_ID),
    ...(input.selectedContextTabId !== undefined ? { selectedTabId: input.selectedContextTabId } : {}),
  };
}

interface SendChatMessageWithStateInput {
  content: string;
  attachments?: ChatImageAttachment[];
  promptInvocations?: ChatPromptInvocation[];
  selectedPlaybookId?: string;
  targetSessionId?: string;
  workflowTaskId?: string;
  get: StoreGetter;
  set: StoreSetter;
}

interface SubmitChatFollowUpInput {
  content: string;
  attachments?: ChatImageAttachment[];
  promptInvocations?: ChatPromptInvocation[];
  behavior?: ChatPreferenceValues["followUpBehavior"];
  get: StoreGetter;
  set: StoreSetter;
}

interface RegenerateChatMessageInput {
  messageId: string;
  get: StoreGetter;
  set: StoreSetter;
}

interface EditAndRegenerateUserMessageInput {
  messageId: string;
  content: string;
  promptInvocations?: ChatPromptInvocation[];
  get: StoreGetter;
  set: StoreSetter;
}

interface RunChatRequestInput {
  state: AppState;
  privateMode?: boolean;
  pageContextPrompt: string;
  session: ChatSession;
  userMessage: ChatMessage;
  existingMessages: ChatMessage[];
  nextMessages: ChatMessage[];
  shouldGenerateTitle: boolean;
  nextTitle: string;
  fallbackTitle: string;
  model: ProviderModel;
  provider: ModelProvider;
  workflowTaskId?: string;
  selectedPlaybookId?: string;
  get: StoreGetter;
  set: StoreSetter;
}

async function sendChatMessageWithState(input: SendChatMessageWithStateInput): Promise<boolean> {
  const trimmedContent = input.content.trim();
  const imageAttachments = (input.attachments ?? []).filter((attachment) => attachment.mediaType.startsWith("image/"));
  const promptInvocations = input.promptInvocations ?? [];
  if (!trimmedContent && imageAttachments.length === 0 && promptInvocations.length === 0) {
    return false;
  }

  const state = input.get();
  if (state.syncRestoreBarrierActive) {
    return false;
  }
  const targetSessionId = input.targetSessionId ?? (state.privateModeActive ? state.privateChatSession?.id : state.activeSessionId);
  const baseSession = input.targetSessionId
    ? state.privateChatSession?.id === input.targetSessionId
      ? state.privateChatSession
      : state.chatSessions.find((session) => session.id === input.targetSessionId)
    : state.privateModeActive
      ? state.privateChatSession
      : state.chatSessions.find((session) => session.id === targetSessionId);
  const selectedModelId = baseSession?.selectedModelId || state.selectedModelId;
  const model = state.models.find((item) => item.id === selectedModelId);
  const provider = model ? state.providers.find((item) => item.id === model.providerId) : undefined;
  if (!model || !provider || !model.enabled || !provider.enabled) {
    input.set({ failure: { message: "请先配置可用模型后再发送" } });
    return false;
  }
  if (imageAttachments.length > 0 && !model.supportsVision) {
    input.set({ failure: { message: "当前模型不支持视觉理解，无法添加图片" } });
    return false;
  }

  const now = Date.now();
  if (!baseSession && Object.values(state.chatTasksBySessionId).some((task) => task.status === "running")) {
    return false;
  }
  const effectiveChatPreferences = resolveEffectiveChatPreferences(state.chatPreferences, baseSession?.chatPreferenceOverrides);
  const session =
    baseSession ??
    {
      id: createSessionId(now),
      title: createDefaultSessionTitle(createVisibleUserTitleContent(trimmedContent, promptInvocations)),
      archived: false,
      sortOrder: now,
      createdAt: now,
      updatedAt: now,
      selectedModelId: model.id,
      messages: [],
    };
  if (isSessionTaskRunning(state.chatTasksBySessionId, session.id)) {
    return false;
  }
  const shouldInjectPageContext = session.messages.length === 0 && state.appendPageContextToSystemPrompt;
  const requestPageContextPrompt = shouldInjectPageContext
    ? state.pageContext.formatted
      ? state.pageContext.text
      : createPageContextPrompt(state.pageContext)
    : "";
  const userMessage: ChatMessage = {
    id: `message-${now}-user`,
    role: "user",
    content: trimmedContent,
    createdAt: now,
    modelId: model.id,
    endpointType: provider.endpointType,
    streamMode: state.streamMode,
    systemPrompt: effectiveChatPreferences.systemPrompt,
    contextPrompt: requestPageContextPrompt,
    contextMode: state.contextMode,
    matchedRuleId: state.pageContext.matchedRuleId,
    attachments: imageAttachments.length > 0 ? imageAttachments : undefined,
    promptInvocations: promptInvocations.length > 0 ? promptInvocations : undefined,
  };

  await runChatRequest({
    state,
    privateMode: state.privateChatSession?.id === session.id,
    pageContextPrompt: requestPageContextPrompt,
    session,
    userMessage,
    existingMessages: session.messages,
    nextMessages: [...session.messages, userMessage],
    shouldGenerateTitle: session.messages.length === 0 && hasAvailableTitleModel(state),
    nextTitle: session.messages.length === 0 ? createDefaultSessionTitle(createVisibleUserTitleContent(trimmedContent, promptInvocations)) : session.title,
    fallbackTitle: session.messages.length === 0 ? createDefaultSessionTitle(createVisibleUserTitleContent(trimmedContent, promptInvocations)) : session.title,
    model,
    provider,
    workflowTaskId: input.workflowTaskId,
    selectedPlaybookId: input.selectedPlaybookId,
    get: input.get,
    set: input.set,
  });
  return true;
}

async function regenerateChatMessage(input: RegenerateChatMessageInput): Promise<void> {
  const state = input.get();
  if (state.syncRestoreBarrierActive) {
    return;
  }

  const session = state.privateModeActive
    ? state.privateChatSession
    : state.chatSessions.find((item) => item.id === state.activeSessionId);
  if (!session) {
    return;
  }
  if (isSessionTaskRunning(state.chatTasksBySessionId, session.id)) {
    return;
  }

  const messageIndex = session.messages.findIndex((message) => message.id === input.messageId);
  const targetMessage = session.messages[messageIndex];
  if (messageIndex < 0 || !targetMessage) {
    return;
  }

  const userMessage = targetMessage.role === "assistant" ? findPreviousUserMessage(session.messages, messageIndex) : targetMessage;
  if (!userMessage || userMessage.role !== "user") {
    input.set({ failure: { message: "未找到可重新生成的用户消息" } });
    return;
  }

  const model = state.models.find((item) => item.id === state.selectedModelId);
  const provider = model ? state.providers.find((item) => item.id === model.providerId) : undefined;
  if (!model || !provider || !model.enabled || !provider.enabled) {
    input.set({ failure: { message: "请先配置可用模型后再发送" } });
    return;
  }
  if ((userMessage.attachments?.length ?? 0) > 0 && !model.supportsVision) {
    input.set({ failure: { message: "当前模型不支持视觉理解，无法添加图片" } });
    return;
  }

  const userMessageIndex = session.messages.findIndex((message) => message.id === userMessage.id);
  const existingMessages = session.messages.slice(0, userMessageIndex);

  await runChatRequest({
    state,
    privateMode: state.privateModeActive,
    pageContextPrompt: "",
    session,
    userMessage,
    existingMessages,
    nextMessages: [...existingMessages, userMessage],
    shouldGenerateTitle: false,
    nextTitle: session.title,
    fallbackTitle: session.title,
    model,
    provider,
    get: input.get,
    set: input.set,
  });
}

async function editAndRegenerateUserMessage(input: EditAndRegenerateUserMessageInput): Promise<void> {
  const trimmedContent = input.content.trim();
  const state = input.get();
  if (state.syncRestoreBarrierActive) {
    return;
  }
  const promptInvocations = input.promptInvocations;
  if (!trimmedContent && (!promptInvocations || promptInvocations.length === 0)) {
    return;
  }

  const session = state.privateModeActive
    ? state.privateChatSession
    : state.chatSessions.find((item) => item.id === state.activeSessionId);
  if (!session) {
    return;
  }
  if (isSessionTaskRunning(state.chatTasksBySessionId, session.id)) {
    return;
  }

  const userMessageIndex = session.messages.findIndex((message) => message.id === input.messageId);
  const originalUserMessage = session.messages[userMessageIndex];
  if (!originalUserMessage || originalUserMessage.role !== "user") {
    input.set({ failure: { message: "未找到可编辑的用户消息" } });
    return;
  }

  const model = state.models.find((item) => item.id === state.selectedModelId);
  const provider = model ? state.providers.find((item) => item.id === model.providerId) : undefined;
  if (!model || !provider || !model.enabled || !provider.enabled) {
    input.set({ failure: { message: "请先配置可用模型后再发送" } });
    return;
  }
  if ((originalUserMessage.attachments?.length ?? 0) > 0 && !model.supportsVision) {
    input.set({ failure: { message: "当前模型不支持视觉理解，无法添加图片" } });
    return;
  }

  const editedUserMessage: ChatMessage = {
    ...originalUserMessage,
    content: trimmedContent,
    promptInvocations: promptInvocations ?? originalUserMessage.promptInvocations,
  };
  const existingMessages = session.messages.slice(0, userMessageIndex);

  await runChatRequest({
    state,
    privateMode: state.privateModeActive,
    pageContextPrompt: "",
    session,
    userMessage: editedUserMessage,
    existingMessages,
    nextMessages: [...existingMessages, editedUserMessage],
    shouldGenerateTitle: false,
    nextTitle: session.title,
    fallbackTitle: session.title,
    model,
    provider,
    get: input.get,
    set: input.set,
  });
}

async function sendExistingFollowUpMessageWithState(input: {
  sessionId: string;
  messageId: string;
  get: StoreGetter;
  set: StoreSetter;
}): Promise<boolean> {
  const state = input.get();
  const session = state.privateModeActive && state.privateChatSession?.id === input.sessionId
    ? state.privateChatSession
    : state.chatSessions.find((item) => item.id === input.sessionId);
  if (!session || isSessionTaskRunning(state.chatTasksBySessionId, session.id)) {
    return false;
  }

  const userMessageIndex = session.messages.findIndex((message) => message.id === input.messageId);
  const userMessage = session.messages[userMessageIndex];
  if (!userMessage || userMessage.role !== "user") {
    return false;
  }

  const selectedModelId = session.selectedModelId || state.selectedModelId;
  const model = state.models.find((item) => item.id === selectedModelId);
  const provider = model ? state.providers.find((item) => item.id === model.providerId) : undefined;
  if (!model || !provider || !model.enabled || !provider.enabled) {
    input.set({ failure: { message: "请先配置可用模型后再发送" } });
    return false;
  }
  if ((userMessage.attachments?.length ?? 0) > 0 && !model.supportsVision) {
    input.set({ failure: { message: "当前模型不支持视觉理解，无法添加图片" } });
    return false;
  }

  await runChatRequest({
    state,
    privateMode: state.privateModeActive && state.privateChatSession?.id === session.id,
    pageContextPrompt: "",
    session,
    userMessage,
    existingMessages: session.messages.slice(0, userMessageIndex),
    nextMessages: session.messages,
    shouldGenerateTitle: false,
    nextTitle: session.title,
    fallbackTitle: session.title,
    model,
    provider,
    get: input.get,
    set: input.set,
  });
  return true;
}

function findPreviousUserMessage(messages: ChatMessage[], startIndex: number): ChatMessage | undefined {
  for (let index = startIndex - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === "user") {
      return messages[index];
    }
  }

  return undefined;
}

async function runChatRequest(input: RunChatRequestInput): Promise<void> {
  const effectiveChatPreferences = resolveEffectiveChatPreferences(input.state.chatPreferences, input.session.chatPreferenceOverrides);
  const modelConfig = createModelConfig(input.provider, input.model, effectiveChatPreferences);
  const now = Date.now();
  const chatTask = createChatTask(input.session.id, now, input.workflowTaskId);
  registerChatTaskExecution(chatTask.sessionId, chatTask.id);
  const nextSession: ChatSession = {
    ...input.session,
    title: input.nextTitle,
    titleGenerating: input.shouldGenerateTitle,
    updatedAt: now,
    selectedModelId: input.model.id,
    messages: input.nextMessages,
  };
  input.set((current) => {
    const chatTasksBySessionId = upsertChatTask(current.chatTasksBySessionId, chatTask);
    const dismissedChatTaskIdsBySessionId = { ...current.dismissedChatTaskIdsBySessionId };
    delete dismissedChatTaskIdsBySessionId[nextSession.id];
    return {
      chatTasksBySessionId,
      dismissedChatTaskIdsBySessionId,
      sending: isSessionTaskRunning(chatTasksBySessionId, current.activeSessionId || nextSession.id),
      failure: undefined,
    };
  });
  let taskStatus: "completed" | "failed" | "canceled" = "completed";
  let restoreCanceled = false;
  const updateWorkflowTaskStatus = async (status: WorkflowTaskStatus, reason?: string): Promise<void> => {
    if (input.workflowTaskId) {
      await input.get().updateWorkflowTaskStatus(input.workflowTaskId, status, reason);
    }
  };
  const addWorkflowArtifactsFromAssistantMessage = async (message: ChatMessage): Promise<void> => {
    if (!input.workflowTaskId) {
      return;
    }

    const task = findWorkflowTaskInState(input.get(), input.workflowTaskId);
    if (!task) {
      return;
    }

    for (const artifact of createWorkflowArtifactsFromAssistantMessage(task, message, message.createdAt)) {
      await input.get().addWorkflowArtifact(input.workflowTaskId, artifact);
    }
  };

  try {
    if (input.privateMode) {
      input.set({ privateChatSession: nextSession });
    } else {
      const updatedSession = await updateChatSession(nextSession.id, (latestSession) => mergeSessionForChatRequest(
        latestSession,
        input.session,
        nextSession,
      ));
      const persistedSession = updatedSession ?? nextSession;
      if (!updatedSession) {
        await saveChatSession(nextSession);
      }
      input.set((current) => ({
        activeSessionId: current.activeSessionId || persistedSession.id,
        chatSessions: upsertSession(current.chatSessions, persistedSession),
        sending: isSessionTaskRunning(current.chatTasksBySessionId, current.activeSessionId || persistedSession.id),
      }));
    }

    if (!input.privateMode && input.shouldGenerateTitle) {
      void generateTitleForSession({
        sessionId: nextSession.id,
        fallbackTitle: input.fallbackTitle,
        userContent: input.userMessage.content,
        pageContext: input.state.appendPageContextToSystemPrompt ? input.state.pageContext.text : "",
        retryCount: effectiveChatPreferences.aiRequestRetryCount,
        get: input.get,
        set: input.set,
      });
    }

    const registeredModelTools = getRegisteredModelTools(input.state.mcpSettings);
    const enabledTools = effectiveChatPreferences.toolCallingEnabled
      ? resolveEnabledModelTools(
          registeredModelTools,
          resolveRuntimeEnabledToolIds(effectiveChatPreferences.enabledToolIds, input.state.browserControlEnabled, input.state.browserAutomationMode),
        )
      : [];
    const enabledToolIds = enabledTools.map((tool) => tool.id);
    const requestStreamMode = input.state.streamMode;
    const selectedContextTabId = resolveSelectedContextTabId(input.state.contextTabs);
    const requestMessages = buildChatRequestMessages({
      model: modelConfig,
      pageContext: input.pageContextPrompt,
      existingMessages: input.existingMessages,
      userMessage: input.userMessage,
      systemPrompt: effectiveChatPreferences.systemPrompt,
      appendPageContextToSystemPrompt: input.state.appendPageContextToSystemPrompt,
    });
    const loggingEnabled = Boolean(input.state.chatPreferences.workspaceRequestLoggingEnabled);
    const request: AppChatSendMessage = {
      type: "chat.send",
      ...(selectedContextTabId !== undefined ? { tabId: selectedContextTabId } : {}),
      model: modelConfig,
      messages: requestMessages,
      stream: requestStreamMode,
      retryCount: effectiveChatPreferences.aiRequestRetryCount,
      browserAutomationMaxToolIterations: effectiveChatPreferences.browserAutomationMaxToolIterations,
      automationPlaybookSettings: input.state.automationPlaybookSettings,
      importedSkillPlaybooks: input.state.importedSkillPlaybooks,
      ...(input.selectedPlaybookId ? { selectedPlaybookId: input.selectedPlaybookId } : {}),
      extractionRules: input.state.extractionRules,
      mcp: {
        ...input.state.mcpSettings,
        bearerTokens: input.state.mcpBearerTokens,
      },
      tavily: {
        includeAnswer: input.state.webSearchSettings.tavily.includeAnswer,
        includeRawContent: input.state.webSearchSettings.tavily.includeRawContent,
        maxResults: input.state.webSearchSettings.tavily.maxResults,
      },
      ...(enabledTools.length > 0
        ? {
            enabledToolIds,
            toolChoice: "auto",
          }
        : {}),
      workspaceRequestLoggingEnabled: loggingEnabled,
      ...(loggingEnabled
        ? {
            requestLogging: {
              sidebarState: {
                mode: input.state.browserAutomationMode ?? "normal_restricted",
                privateMode: Boolean(input.privateMode),
                toolCallingEnabled: effectiveChatPreferences.toolCallingEnabled,
                enabledToolIds,
                toolCallDisplayMode: input.state.chatPreferences.toolCallDisplayMode,
                showToolCallProcessInAssistantMode: input.state.chatPreferences.showToolCallProcessInAssistantMode,
                browserAutomationMaxToolIterations: effectiveChatPreferences.browserAutomationMaxToolIterations,
                followUpBehavior: input.state.chatPreferences.followUpBehavior,
                systemPrompt: effectiveChatPreferences.systemPrompt,
                pageContext: {
                  inject: Boolean(input.state.appendPageContextToSystemPrompt),
                  extractMode: input.state.contextMode,
                },
                mcp: {
                  servers: (input.state.mcpSettings?.servers ?? []).map((server) => ({
                    id: server.id,
                    enabled: Boolean(server.enabled),
                    toolCount: Array.isArray(server.tools) ? server.tools.length : undefined,
                  })),
                },
                browserControlEnabled: input.state.browserControlEnabled,
                streamMode: requestStreamMode,
              },
            },
          }
        : {}),
      debugContext: createChatSendDebugContext({
        requestCreatedAt: now,
        session: input.session,
        nextSession,
        userMessage: input.userMessage,
        existingMessageCount: input.existingMessages.length,
        requestMessageCount: requestMessages.length,
        stream: requestStreamMode,
        privateMode: input.privateMode,
        selectedContextTabId,
        enabledToolIds,
      }),
    };

    {
      const streamResult = await sendStreamingChatMessage({
        set: input.set,
        sessionId: nextSession.id,
        modelId: input.model.id,
        endpointType: input.provider.endpointType,
        systemPrompt: effectiveChatPreferences.systemPrompt,
        contextPrompt: input.pageContextPrompt,
        contextMode: input.state.contextMode,
        matchedRuleId: input.state.pageContext.matchedRuleId,
        privateMode: input.privateMode,
        streamMode: requestStreamMode,
        request,
        onAbortHandle: (handle) => registerChatTaskAbortHandle(nextSession.id, chatTask.id, handle),
        onFollowUpHandle: (handle) => registerChatTaskFollowUpHandle(nextSession.id, chatTask.id, handle),
        onFollowUpConsumed: (followUpId) => markChatFollowUpConsumed(input.set, nextSession.id, followUpId),
        shouldShowFailure: () => shouldShowFailureForSession(input.get(), nextSession.id),
        onWorkflowToolStart: async (record) => {
          if (!input.workflowTaskId) {
            return;
          }
          await input.get().upsertWorkflowTaskStep(input.workflowTaskId, createWorkflowTaskStepFromToolRecord(record));
        },
        onWorkflowToolComplete: async (record, attachments) => {
          if (!input.workflowTaskId) {
            return;
          }
          await input.get().upsertWorkflowTaskStep(input.workflowTaskId, createWorkflowTaskStepFromToolRecord(record));
          for (const contextItem of createWorkflowContextItemsFromToolAttachments(attachments)) {
            await input.get().addWorkflowContextItem(input.workflowTaskId, contextItem);
          }
        },
      });
      unregisterChatTaskAbortHandle(nextSession.id, chatTask.id);
      unregisterChatTaskFollowUpHandle(nextSession.id, chatTask.id);
      if (streamResult.restoreCanceled) {
        restoreCanceled = true;
        taskStatus = "canceled";
        return;
      } else if (streamResult.canceled) {
        taskStatus = "canceled";
        await updateWorkflowTaskStatus("canceled");
      } else if (streamResult.failed) {
        taskStatus = "failed";
        await updateWorkflowTaskStatus("failed", "流式响应失败，请重试");
      }
      if (streamResult.completed) {
        if (!streamResult.canceled && !streamResult.failed) {
          const workflowAssistantCreatedAt = Date.now();
          await addWorkflowArtifactsFromAssistantMessage({
            id: `message-${workflowAssistantCreatedAt}-assistant-workflow-artifact`,
            role: "assistant",
            content: streamResult.assistantContent ?? "",
            createdAt: workflowAssistantCreatedAt,
            modelId: input.model.id,
            endpointType: input.provider.endpointType,
            streamMode: requestStreamMode,
            systemPrompt: effectiveChatPreferences.systemPrompt,
            contextPrompt: input.pageContextPrompt,
            contextMode: input.state.contextMode,
            matchedRuleId: input.state.pageContext.matchedRuleId,
          });
          await updateWorkflowTaskStatus("completed");
        }
        return;
      }

      request.stream = false;
    }

    const response = await sendRuntimeMessage<
      | {
          ok: true;
          content: string;
          thinking?: string;
          reasoningContent?: string;
          toolCallRecords?: ChatToolCallRecord[];
          toolAttachments?: ChatToolAttachment[];
          toolTurnMessages?: ChatMessage[];
          tokenUsageEntries?: ChatTokenUsageEntry[];
        }
      | { ok: false; message: string; restoreCanceled?: boolean }
      | undefined
    >(request);

    if (response?.ok === false && response.restoreCanceled) {
      restoreCanceled = true;
      taskStatus = "canceled";
      return;
    }
    if (input.get().syncRestoreBarrierActive) {
      restoreCanceled = true;
      taskStatus = "canceled";
      return;
    }
    if (!response) {
      taskStatus = "failed";
      await updateWorkflowTaskStatus("failed", "模型请求失败，请重试");
      input.set((current) => (shouldShowFailureForSession(current, nextSession.id) ? { failure: { message: "模型请求失败，请重试" } } : {}));
      return;
    }

    if (!response.ok) {
      taskStatus = "failed";
      await updateWorkflowTaskStatus("failed", response.message);
      input.set((current) => (shouldShowFailureForSession(current, nextSession.id) ? { failure: { message: response.message } } : {}));
      return;
    }

    const assistantCreatedAt = Date.now();
    const assistantMessage: ChatMessage = {
      id: `message-${assistantCreatedAt}-assistant`,
      role: "assistant",
      content: response.content,
      thinking: response.thinking,
      reasoningContent: response.reasoningContent,
      createdAt: assistantCreatedAt,
      modelId: input.model.id,
      endpointType: input.provider.endpointType,
      streamMode: requestStreamMode,
      systemPrompt: effectiveChatPreferences.systemPrompt,
      contextPrompt: input.pageContextPrompt,
      contextMode: input.state.contextMode,
      matchedRuleId: input.state.pageContext.matchedRuleId,
      toolAttachments: response.toolAttachments,
    };
    const assistantMessages = [...(response.toolTurnMessages ?? []), assistantMessage];
    if (input.privateMode) {
      input.set((current) => {
        const currentSession = current.privateChatSession;
        if (!current.privateModeActive || !currentSession || currentSession.id !== nextSession.id) {
          return {};
        }

        return {
          privateChatSession: {
            ...currentSession,
            updatedAt: assistantMessage.createdAt,
            tokenUsageEntries: mergeTokenUsageEntries(currentSession.tokenUsageEntries, response.tokenUsageEntries),
            messages: [...currentSession.messages, ...assistantMessages],
          },
        };
      });
      await addWorkflowArtifactsFromAssistantMessage(assistantMessage);
      await updateWorkflowTaskStatus("completed");
      return;
    }

    const completedSession = await updateChatSession(nextSession.id, (latestSession) => ({
      ...latestSession,
      updatedAt: assistantMessage.createdAt,
      tokenUsageEntries: mergeTokenUsageEntries(latestSession.tokenUsageEntries, response.tokenUsageEntries),
      messages: [...latestSession.messages, ...assistantMessages],
    }));
    if (!completedSession) {
      return;
    }

    input.set((current) => {
      const currentSession = current.chatSessions.find((session) => session.id === completedSession.id);
      if (!currentSession) {
        return {};
      }

      return {
        chatSessions: upsertSession(current.chatSessions, completedSession),
      };
    });
    await addWorkflowArtifactsFromAssistantMessage(assistantMessage);
    await updateWorkflowTaskStatus("completed");
  } catch {
    taskStatus = "failed";
    const failureMessage = "消息保存失败，请重试";
    await updateWorkflowTaskStatus("failed", failureMessage);
    input.set((current) =>
      shouldShowFailureForSession(current, nextSession.id)
        ? {
            failure: {
              message: failureMessage,
            },
          }
        : {},
    );
  } finally {
    unregisterChatTaskAbortHandle(nextSession.id, chatTask.id);
    unregisterChatTaskFollowUpHandle(nextSession.id, chatTask.id);
    input.set((current) => {
      const chatTasksBySessionId = finishChatTask(current.chatTasksBySessionId, nextSession.id, taskStatus, Date.now(), chatTask.id);
      return {
        chatTasksBySessionId,
        chatRetryProgressByMessageId: clearChatRetryProgressForSession(current, nextSession.id),
        sending: isSessionTaskRunning(chatTasksBySessionId, current.activeSessionId),
      };
    });
    if (restoreCanceled) {
      settleChatTaskExecution(nextSession.id, chatTask.id);
    } else {
      void consumeNextQueuedFollowUp(nextSession.id, input.get, input.set)
        .finally(() => settleChatTaskExecution(nextSession.id, chatTask.id));
    }
  }
}

function mergeSessionForChatRequest(latestSession: ChatSession, snapshotSession: ChatSession, nextSession: ChatSession): ChatSession {
  const snapshotMessages = new Map(snapshotSession.messages.map((message) => [message.id, message]));
  const latestMessages = new Map(latestSession.messages.map((message) => [message.id, message]));
  const mergedMessages = nextSession.messages.map((message) => {
    const snapshotMessage = snapshotMessages.get(message.id);
    return snapshotMessage === message ? latestMessages.get(message.id) ?? message : message;
  });
  const mergedMessageIds = new Set(mergedMessages.map((message) => message.id));
  for (const message of latestSession.messages) {
    if (!snapshotMessages.has(message.id) && !mergedMessageIds.has(message.id)) {
      mergedMessages.push(message);
      mergedMessageIds.add(message.id);
    }
  }
  mergedMessages.sort((left, right) => left.createdAt - right.createdAt);

  const titleChangedConcurrently = latestSession.title !== snapshotSession.title
    || latestSession.titleGenerating !== snapshotSession.titleGenerating;
  return {
    ...latestSession,
    title: titleChangedConcurrently ? latestSession.title : nextSession.title,
    titleGenerating: titleChangedConcurrently ? latestSession.titleGenerating : nextSession.titleGenerating,
    selectedModelId: nextSession.selectedModelId,
    updatedAt: Math.max(latestSession.updatedAt, nextSession.updatedAt),
    messages: mergedMessages,
  };
}

function updateSessionFollowUpsInState(state: AppState, sessionId: string, followUps: ChatFollowUpItem[]): Partial<AppState> {
  const followUpsBySessionId = { ...state.followUpsBySessionId };
  followUpsBySessionId[sessionId] = followUps;

  if (state.privateModeActive && state.privateChatSession?.id === sessionId) {
    return {
      followUpsBySessionId,
      privateChatSession: {
        ...state.privateChatSession,
        pendingFollowUps: followUps.length ? followUps : undefined,
      },
    };
  }

  return {
    followUpsBySessionId,
    chatSessions: state.chatSessions.map((session) => session.id === sessionId
      ? { ...session, pendingFollowUps: followUps.length ? followUps : undefined }
      : session),
  };
}

async function persistSessionFollowUps(
  sessionId: string,
  updater: (followUps: ChatFollowUpItem[]) => ChatFollowUpItem[],
): Promise<void> {
  if (!globalThis.chrome?.runtime?.id) {
    return;
  }
  await updateChatSession(sessionId, (latestSession) => {
    const pendingFollowUps = updater(latestSession.pendingFollowUps ?? []);
    return {
      ...latestSession,
      pendingFollowUps: pendingFollowUps.length ? pendingFollowUps : undefined,
    };
  });
}

async function markChatFollowUpConsumed(set: StoreSetter, sessionId: string, followUpId: string): Promise<void> {
  set((current) => updateSessionFollowUpsInState(
    current,
    sessionId,
    (current.followUpsBySessionId[sessionId] ?? []).filter((item) => item.id !== followUpId),
  ));
  await persistSessionFollowUps(sessionId, (followUps) => followUps.filter((item) => item.id !== followUpId));
}

function removeSessionFollowUps(
  followUpsBySessionId: Record<string, ChatFollowUpItem[]>,
  sessionId: string | undefined,
): Record<string, ChatFollowUpItem[]> {
  if (!sessionId || !followUpsBySessionId[sessionId]) {
    return followUpsBySessionId;
  }

  const next = { ...followUpsBySessionId };
  delete next[sessionId];
  return next;
}

function migrateSessionFollowUps(
  followUpsBySessionId: Record<string, ChatFollowUpItem[]>,
  fromSessionId: string,
  toSessionId: string,
): Record<string, ChatFollowUpItem[]> {
  const movingItems = followUpsBySessionId[fromSessionId];
  if (!movingItems?.length || fromSessionId === toSessionId) {
    return followUpsBySessionId;
  }

  const next = { ...followUpsBySessionId };
  delete next[fromSessionId];
  next[toSessionId] = [...(next[toSessionId] ?? []), ...movingItems.map((item) => ({ ...item, sessionId: toSessionId }))];
  return next;
}

async function consumeNextQueuedFollowUp(sessionId: string, get: StoreGetter, set: StoreSetter): Promise<void> {
  const nextFollowUp = get().followUpsBySessionId[sessionId]?.find((item) => item.behavior === "queue" || item.userMessageId);
  if (!nextFollowUp) {
    return;
  }

  await consumeQueuedFollowUp(sessionId, nextFollowUp.id, get, set);
}

async function consumeQueuedFollowUp(sessionId: string, followUpId: string, get: StoreGetter, set: StoreSetter): Promise<void> {
  const nextFollowUp = get().followUpsBySessionId[sessionId]?.find((item) => item.id === followUpId);
  if (!nextFollowUp || isSessionTaskRunning(get().chatTasksBySessionId, sessionId) || get().syncRestoreBarrierActive) {
    return;
  }

  // 跟进队列必须等当前任务完成后再消费；先临时移除可避免 runChatRequest 收尾时重复看到同一条。
  await removeQueuedFollowUp(set, sessionId, nextFollowUp.id);
  let sent = false;
  if (nextFollowUp.userMessageId) {
    sent = await sendExistingFollowUpMessageWithState({
      sessionId,
      messageId: nextFollowUp.userMessageId,
      get,
      set,
    });
  } else {
    sent = await sendChatMessageWithState({
      content: nextFollowUp.content,
      attachments: nextFollowUp.attachments ?? [],
      promptInvocations: nextFollowUp.promptInvocations ?? [],
      targetSessionId: sessionId,
      get,
      set,
    });
  }

  if (!sent) {
    await restoreQueuedFollowUp(set, sessionId, nextFollowUp);
  }
}

async function removeQueuedFollowUp(set: StoreSetter, sessionId: string, followUpId: string): Promise<void> {
  set((current) => updateSessionFollowUpsInState(
    current,
    sessionId,
    (current.followUpsBySessionId[sessionId] ?? []).filter((item) => item.id !== followUpId),
  ));
  await persistSessionFollowUps(sessionId, (followUps) => followUps.filter((item) => item.id !== followUpId));
}

async function restoreQueuedFollowUp(set: StoreSetter, sessionId: string, followUp: ChatFollowUpItem): Promise<void> {
  set((current) => {
    const currentItems = current.followUpsBySessionId[sessionId] ?? [];
    if (currentItems.some((item) => item.id === followUp.id)) {
      return current;
    }
    return updateSessionFollowUpsInState(current, sessionId, [followUp, ...currentItems]);
  });
  await persistSessionFollowUps(sessionId, (followUps) => followUps.some((item) => item.id === followUp.id)
    ? followUps
    : [followUp, ...followUps]);
}

function appendFollowUpUserMessage(input: {
  sessionId: string;
  followUp: Pick<ChatFollowUpItem, "content" | "attachments" | "promptInvocations">;
  state: AppState;
  set: StoreSetter;
}): string {
  const now = Date.now();
  const session = input.state.privateModeActive && input.state.privateChatSession?.id === input.sessionId
    ? input.state.privateChatSession
    : input.state.chatSessions.find((item) => item.id === input.sessionId);
  const modelId = session?.selectedModelId || input.state.selectedModelId;
  const userMessageId = `message-${now}-follow-up-user`;
  const userMessage: ChatMessage = {
    id: userMessageId,
    role: "user",
    content: input.followUp.content,
    createdAt: now,
    modelId,
    endpointType: resolveEndpointTypeForModel(input.state, modelId),
    streamMode: input.state.streamMode,
    systemPrompt: input.state.chatPreferences.systemPrompt,
    contextPrompt: "",
    contextMode: input.state.contextMode,
    attachments: input.followUp.attachments,
    promptInvocations: input.followUp.promptInvocations,
  };

  if (input.state.privateModeActive && input.state.privateChatSession?.id === input.sessionId) {
    input.set((current) => {
      if (!current.privateChatSession || current.privateChatSession.id !== input.sessionId) {
        return {};
      }

      return {
        privateChatSession: {
          ...current.privateChatSession,
          updatedAt: now,
          messages: [...current.privateChatSession.messages, userMessage],
        },
      };
    });
    return userMessageId;
  }

  void updateChatSession(input.sessionId, (latestSession) => ({
    ...latestSession,
    updatedAt: now,
    messages: [...latestSession.messages, userMessage],
  }));
  input.set((current) => {
    const currentSession = current.chatSessions.find((item) => item.id === input.sessionId);
    if (!currentSession) {
      return {};
    }

    return {
      chatSessions: upsertSession(current.chatSessions, {
        ...currentSession,
        updatedAt: now,
        messages: [...currentSession.messages, userMessage],
      }),
    };
  });

  return userMessageId;
}

function resolveEndpointTypeForModel(state: AppState, modelId: string): EndpointType {
  const model = state.models.find((item) => item.id === modelId);
  return state.providers.find((provider) => provider.id === model?.providerId)?.endpointType ?? "openai_chat";
}

function clearChatRetryProgressForSession(state: AppState, sessionId: string): Record<string, ChatRetryProgress> {
  const session = state.privateModeActive && state.privateChatSession?.id === sessionId
    ? state.privateChatSession
    : state.chatSessions.find((item) => item.id === sessionId);
  if (!session) {
    return state.chatRetryProgressByMessageId;
  }

  const messageIds = new Set(session.messages.map((message) => message.id));
  const nextProgress = { ...state.chatRetryProgressByMessageId };
  for (const messageId of messageIds) {
    delete nextProgress[messageId];
  }
  return nextProgress;
}

async function submitChatFollowUpWithState(input: SubmitChatFollowUpInput): Promise<void> {
  const trimmedContent = input.content.trim();
  const imageAttachments = (input.attachments ?? []).filter((attachment) => attachment.mediaType.startsWith("image/"));
  const promptInvocations = input.promptInvocations ?? [];
  if (!trimmedContent && imageAttachments.length === 0 && promptInvocations.length === 0) {
    return;
  }

  const state = input.get();
  if (state.syncRestoreBarrierActive) {
    return;
  }
  const sessionId = state.privateModeActive ? state.privateChatSession?.id : state.activeSessionId;
  if (!sessionId || !isSessionTaskRunning(state.chatTasksBySessionId, sessionId)) {
    await sendChatMessageWithState({
      content: trimmedContent,
      attachments: imageAttachments,
      promptInvocations,
      get: input.get,
      set: input.set,
    });
    return;
  }

  const behavior = input.behavior ?? state.chatPreferences.followUpBehavior;
  const now = Date.now();
  const followUp: ChatFollowUpItem = {
    id: `follow-up-${now}-${Math.random().toString(36).slice(2, 8)}`,
    sessionId,
    content: trimmedContent,
    attachments: imageAttachments.length ? imageAttachments : undefined,
    promptInvocations: promptInvocations.length ? promptInvocations : undefined,
    behavior,
    createdAt: now,
  };

  if (behavior === "guide") {
    const userMessageId = appendFollowUpUserMessage({
      sessionId,
      followUp,
      state,
      set: input.set,
    });
    const delivered = sendChatTaskFollowUp(sessionId, {
      id: followUp.id,
      content: followUp.content,
      attachments: followUp.attachments,
      promptInvocations: followUp.promptInvocations,
      userMessageId,
    });
    const guidedFollowUp: ChatFollowUpItem = {
      ...followUp,
      behavior: delivered ? "guide" : "queue",
      userMessageId,
    };
    // 运行状态检查后流仍可能断开；保留为 queue 可在恢复后发送已追加的用户消息。
    input.set((current) => updateSessionFollowUpsInState(
      current,
      sessionId,
      [...(current.followUpsBySessionId[sessionId] ?? []), guidedFollowUp],
    ));
    if (!state.privateModeActive || state.privateChatSession?.id !== sessionId) {
      await persistSessionFollowUps(sessionId, (followUps) => followUps.some((item) => item.id === guidedFollowUp.id)
        ? followUps
        : [...followUps, guidedFollowUp]);
    }
    return;
  }

  const queuedFollowUp: ChatFollowUpItem = { ...followUp, behavior: "queue" };
  input.set((current) => updateSessionFollowUpsInState(
    current,
    sessionId,
    [...(current.followUpsBySessionId[sessionId] ?? []), queuedFollowUp],
  ));
  if (!state.privateModeActive || state.privateChatSession?.id !== sessionId) {
    await persistSessionFollowUps(sessionId, (followUps) => followUps.some((item) => item.id === queuedFollowUp.id)
      ? followUps
      : [...followUps, queuedFollowUp]);
  }
}

async function readMcpBearerTokens(settings: McpSettings): Promise<McpServerSecretMap> {
  const entries = await Promise.all(
    settings.servers.map(async (server) => [server.id, await getMcpBearerToken(server.id)] as const),
  );
  return Object.fromEntries(entries.filter(([, token]) => token));
}

async function updateMcpServerAction(input: {
  serverId: string | undefined;
  draft: Pick<McpServerConfig, "name" | "endpointUrl" | "enabled"> & { bearerToken?: string };
  get: StoreGetter;
  set: StoreSetter;
}): Promise<{ ok: true; server: McpServerConfig } | { ok: false; message: string }> {
  const name = input.draft.name.trim();
  const endpointUrl = normalizeMcpEndpointUrl(input.draft.endpointUrl);
  if (!name) {
    return { ok: false, message: "MCP Server 名称不能为空" };
  }
  if (!endpointUrl) {
    return { ok: false, message: "MCP Server 地址必须是合法的 HTTP 或 HTTPS URL" };
  }

  const now = Date.now();
  const currentSettings = input.get().mcpSettings;
  const existing = input.serverId ? currentSettings.servers.find((server) => server.id === input.serverId) : undefined;
  const isNewServer = !existing;
  const enabledChanged = Boolean(existing && existing.enabled !== input.draft.enabled);
  const server: McpServerConfig = {
    id: existing?.id ?? `mcp-${now}-${Math.random().toString(36).slice(2, 8)}`,
    name,
    endpointUrl,
    enabled: input.draft.enabled,
    tools: existing?.tools ?? [],
    lastRefreshError: existing?.lastRefreshError,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
  const servers = existing
    ? currentSettings.servers.map((item) => (item.id === server.id ? server : item))
    : [...currentSettings.servers, server];
  const mcpSettings = { servers };

  await saveMcpSettings(mcpSettings);
  if (input.draft.bearerToken !== undefined) {
    await saveMcpBearerToken(server.id, input.draft.bearerToken);
  }
  const mcpBearerTokens = await readMcpBearerTokens(mcpSettings);
  input.set({ mcpSettings, mcpBearerTokens });
  if (isNewServer && server.enabled) {
    await refreshMcpServerToolsAction({ serverId: server.id, get: input.get, set: input.set, enableDiscoveredTools: true });
  } else if (enabledChanged) {
    if (server.enabled) {
      await enableMcpToolsForServerAction({ serverId: server.id, mcpSettings, get: input.get, set: input.set });
    } else {
      await disableMcpToolsForServerAction({ serverId: server.id, get: input.get, set: input.set });
    }
  }
  return { ok: true, server };
}

async function setMcpServerEnabledAction(input: { serverId: string; enabled: boolean; get: StoreGetter; set: StoreSetter }): Promise<void> {
  const currentSettings = input.get().mcpSettings;
  const server = currentSettings.servers.find((item) => item.id === input.serverId);
  if (!server || server.enabled === input.enabled) {
    return;
  }

  const now = Date.now();
  const mcpSettings = {
    servers: currentSettings.servers.map((item) =>
      item.id === input.serverId
        ? {
            ...item,
            enabled: input.enabled,
            updatedAt: now,
          }
        : item,
    ),
  };

  await saveMcpSettings(mcpSettings);
  input.set({ mcpSettings });
  if (input.enabled) {
    await enableMcpToolsForServerAction({ serverId: input.serverId, mcpSettings, get: input.get, set: input.set });
  } else {
    await disableMcpToolsForServerAction({ serverId: input.serverId, get: input.get, set: input.set });
  }
}

async function deleteMcpServerAction(input: { serverId: string; get: StoreGetter; set: StoreSetter }): Promise<void> {
  const mcpSettings = {
    servers: input.get().mcpSettings.servers.filter((server) => server.id !== input.serverId),
  };
  await saveMcpSettings(mcpSettings);
  await clearMcpBearerToken(input.serverId);
  const mcpBearerTokens = await readMcpBearerTokens(mcpSettings);
  input.set({ mcpSettings, mcpBearerTokens });
}

async function refreshMcpServerToolsAction(input: { serverId: string; get: StoreGetter; set: StoreSetter; enableDiscoveredTools?: boolean }): Promise<void> {
  const server = input.get().mcpSettings.servers.find((item) => item.id === input.serverId);
  if (!server) {
    return;
  }

  const response = await sendRuntimeMessage<{ ok: true; tools: McpServerConfig["tools"] } | { ok: false; message: string } | undefined>({
    type: "mcp.listTools",
    serverId: server.id,
  });
  const now = Date.now();
  const mcpSettings = {
    servers: input.get().mcpSettings.servers.map((item) =>
      item.id === input.serverId
        ? {
            ...item,
            tools: response?.ok ? response.tools : item.tools,
            lastRefreshError: response?.ok ? undefined : response?.message ?? "MCP 工具刷新失败",
            updatedAt: now,
          }
        : item,
    ),
  };
  await saveMcpSettings(mcpSettings);
  input.set({ mcpSettings });
  if (input.enableDiscoveredTools && response?.ok) {
    await enableMcpToolsForServerAction({
      serverId: input.serverId,
      mcpSettings,
      get: input.get,
      set: input.set,
    });
  }
}

async function enableMcpToolsForServerAction(input: { serverId: string; mcpSettings: McpSettings; get: StoreGetter; set: StoreSetter }): Promise<void> {
  const toolIds = getRegisteredModelTools(input.mcpSettings)
    .filter((tool) => parseMcpToolId(tool.id)?.serverId === input.serverId)
    .map((tool) => tool.id);
  if (toolIds.length === 0) {
    return;
  }

  const chatPreferences = normalizeChatPreferences({
    ...input.get().chatPreferences,
    enabledToolIds: Array.from(new Set([...input.get().chatPreferences.enabledToolIds, ...toolIds])),
  });
  await saveAppSetting({
    key: "chatPreferences",
    value: chatPreferences,
    updatedAt: Date.now(),
  });
  input.set({ chatPreferences });
}

async function disableMcpToolsForServerAction(input: { serverId: string; get: StoreGetter; set: StoreSetter }): Promise<void> {
  const nextEnabledToolIds = input.get().chatPreferences.enabledToolIds.filter((toolId) => parseMcpToolId(toolId)?.serverId !== input.serverId);
  if (nextEnabledToolIds.length === input.get().chatPreferences.enabledToolIds.length) {
    return;
  }

  const chatPreferences = normalizeChatPreferences({
    ...input.get().chatPreferences,
    enabledToolIds: nextEnabledToolIds,
  });
  await saveAppSetting({
    key: "chatPreferences",
    value: chatPreferences,
    updatedAt: Date.now(),
  });
  input.set({ chatPreferences });
}

function normalizeMcpEndpointUrl(value: string): string | undefined {
  try {
    const url = new URL(value.trim());
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString().replace(/\/$/, "") : undefined;
  } catch {
    return undefined;
  }
}

function createAndStoreModel(
  providerId: string,
  get: StoreGetter,
  set: StoreSetter,
  overrides: Partial<Pick<ProviderModel, "displayName" | "modelId">> = {},
): ProviderModel {
  markModelCatalogChanged();
  const now = Date.now();
  const index = get().models.filter((model) => model.providerId === providerId).length + 1;
  const model: ProviderModel = {
    id: `model-${now}-${index}`,
    providerId,
    displayName: overrides.displayName ?? `新模型 ${index}`,
    modelId: overrides.modelId ?? "gpt-4.1-mini",
    temperature: 0.7,
    maxTokens: 1024,
    systemPrompt: "你是网页助手",
    isTitleModel: false,
    supportsVision: false,
    enabled: true,
    createdAt: now,
    updatedAt: now,
  };

  set((state) => ({
    models: [...state.models, model],
    selectedModelId: state.selectedModelId || model.id,
  }));
  void saveProviderModel(model);
  return model;
}

function setChannelOperation(set: StoreSetter, providerId: string, operation: ChannelOperationState) {
  set((state) => ({
    channelOperations: {
      ...state.channelOperations,
      [providerId]: operation,
    },
  }));
}

const modelConnectivityResetTimers = new Map<string, ReturnType<typeof setTimeout>>();

function setModelConnectivity(set: StoreSetter, modelId: string, operation: ModelConnectivityState) {
  set((state) => ({
    modelConnectivity: {
      ...state.modelConnectivity,
      [modelId]: operation,
    },
  }));
}

function scheduleModelConnectivityReset(set: StoreSetter, modelId: string) {
  clearModelConnectivityResetTimer(modelId);

  const timer = setTimeout(() => {
    set((state) => {
      const operation = state.modelConnectivity[modelId];

      if (!operation?.success) {
        return state;
      }

      return {
        modelConnectivity: {
          ...state.modelConnectivity,
          [modelId]: {
            ...operation,
            success: false,
          },
        },
      };
    });
    modelConnectivityResetTimers.delete(modelId);
  }, 5000);

  modelConnectivityResetTimers.set(modelId, timer);
}

function clearModelConnectivityResetTimer(modelId: string) {
  const timer = modelConnectivityResetTimers.get(modelId);

  if (!timer) {
    return;
  }

  clearTimeout(timer);
  modelConnectivityResetTimers.delete(modelId);
}

function clearAllModelConnectivityResetTimers() {
  modelConnectivityResetTimers.forEach((timer) => clearTimeout(timer));
  modelConnectivityResetTimers.clear();
}

async function syncBrowserControlEnabled(enabled: boolean): Promise<BrowserControlResponse> {
  return sendRuntimeMessage<BrowserControlResponse>({
    type: BROWSER_CONTROL_SET_ENABLED_MESSAGE_TYPE,
    enabled,
  });
}

async function syncRuntimeReadonlyEnabled(enabled: boolean): Promise<BrowserControlResponse> {
  return sendRuntimeMessage<BrowserControlResponse>({
    type: BROWSER_CONTROL_SET_RUNTIME_READONLY_MESSAGE_TYPE,
    enabled,
    reason: "用户在侧边栏临时开启运行时只读分析。",
  });
}

async function syncBrowserAutomationMode(mode: BrowserAutomationMode): Promise<BrowserControlResponse> {
  return sendRuntimeMessage<BrowserControlResponse>({
    type: BROWSER_CONTROL_SET_AUTOMATION_MODE_MESSAGE_TYPE,
    mode,
    reason: "用户在输入区切换浏览器自动化模式。",
  });
}
