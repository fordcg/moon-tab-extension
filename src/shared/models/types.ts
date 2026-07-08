import type { ChatMessage, ChatTokenUsageEntry, ChatToolAttachment, ChatToolCallRecord } from "../types";
import type { BrowserAutomationMode } from "../toolAuthorization";
import type { ToolRiskCapability } from "../toolAuthorization";

export interface ModelRequestPayload {
  url: string;
  headers: Record<string, string>;
  body: unknown;
}

export interface ModelToolDefinition {
  name: string;
  description?: string;
  parameters: Record<string, unknown>;
}

export type ModelToolRuntimeRequirement = "local" | "external_web" | "browser_control" | "controlled_enhanced" | "full_access" | "mcp_remote";

export type ModelToolCapability =
  | "observe_page"
  | "operate_page"
  | "analyze_site"
  | "confirm_boundary"
  | "deliver_result"
  | "search_public_web"
  | "system_context"
  | "call_remote_tool";

export type ModelToolRisk = "low" | "medium" | "high" | "critical";

export interface ModelToolClassification {
  runtime: ModelToolRuntimeRequirement;
  capabilities: ModelToolCapability[];
  risk: ModelToolRisk;
}

export interface ModelToolRegistryEntry extends ModelToolDefinition {
  id: string;
  displayName?: string;
  groupId?: string;
  requiredCapabilities?: ToolRiskCapability[];
  toolClassification?: ModelToolClassification;
}

export type ModelToolAvailabilityReasonCode =
  | "available"
  | "debugger_permission_missing"
  | "browser_control_disabled"
  | "browser_control_not_attached"
  | "controlled_enhanced_required"
  | "full_access_required"
  | "network_unavailable";

export type BrowserAutomationNetworkSource = "debugger_recorder" | "devtools_fallback" | "unavailable";

export interface ModelToolAvailabilityRuntime {
  debuggerPermissionDeclared: boolean;
  browserControlEnabled: boolean;
  browserControlAttached: boolean;
  browserAutomationMode: BrowserAutomationMode;
  networkSource: BrowserAutomationNetworkSource;
}

export interface ModelToolAvailabilityStatus {
  available: boolean;
  reasonCode: ModelToolAvailabilityReasonCode;
  reason: string;
  requiresDebugger: boolean;
  requiresAutomationMode?: BrowserAutomationMode;
  networkSource: BrowserAutomationNetworkSource;
  checkedAt: number;
}

export interface ModelToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
  parseError?: string;
}

export interface ModelToolResult {
  toolCallId: string;
  name: string;
  content: string;
  isError?: boolean;
  toolAttachments?: ChatToolAttachment[];
}

export type ModelToolChoice = "auto" | "none" | { type: "tool"; name: string };

export interface ModelToolOptions {
  tools?: ModelToolDefinition[];
  toolChoice?: ModelToolChoice;
}

export interface ModelSystemMessage {
  role: "system";
  content: string;
}

export interface ModelUserMessage {
  role: "user";
  content: string;
}

export interface ModelAssistantToolMessage {
  role: "assistant";
  content: string;
  toolCalls: ModelToolCall[];
  reasoningContent?: string;
}

export interface ModelToolResultMessage extends ModelToolResult {
  role: "tool";
}

export type ModelRequestMessage = ChatMessage | ModelSystemMessage | ModelUserMessage | ModelAssistantToolMessage | ModelToolResultMessage;

export interface ModelToolExecutionContext {
  signal?: AbortSignal;
}

export type ModelToolExecutor = (call: ModelToolCall, tool: ModelToolRegistryEntry, context?: ModelToolExecutionContext) => Promise<ModelToolResult>;

export interface ModelResponseData {
  content: string;
  thinking?: string;
  reasoningContent?: string;
  toolCalls?: ModelToolCall[];
  toolCallRecords?: ChatToolCallRecord[];
  toolAttachments?: ChatToolAttachment[];
  toolTurnMessages?: ChatMessage[];
  tokenUsageEntries?: ChatTokenUsageEntry[];
}

export interface OpenAIJsonSchemaResponseFormat {
  type: "json_schema";
  json_schema: {
    name: string;
    strict?: boolean;
    schema: Record<string, unknown>;
  };
}

export interface OpenAIToolChoiceResponseFormat {
  type: "tool";
  tool: {
    name: string;
    description?: string;
    parameters: Record<string, unknown>;
  };
}

export type OpenAIStructuredOutputFormat = OpenAIJsonSchemaResponseFormat | OpenAIToolChoiceResponseFormat;

export interface ModelValidationResult {
  ok: boolean;
  message: string;
}
