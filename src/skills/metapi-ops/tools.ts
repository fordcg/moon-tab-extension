import type { SkillToolDefinition } from "../types";
import {
  METAPI_CONFIGURE_TOOL_ID,
  METAPI_CONFIGURE_TOOL_NAME,
  METAPI_CREATE_ACCOUNT_TOOL_ID,
  METAPI_CREATE_ACCOUNT_TOOL_NAME,
  METAPI_CREATE_SITE_TOOL_ID,
  METAPI_CREATE_SITE_TOOL_NAME,
  METAPI_DETECT_SITE_TOOL_ID,
  METAPI_DETECT_SITE_TOOL_NAME,
  METAPI_LIST_SITES_TOOL_ID,
  METAPI_LIST_SITES_TOOL_NAME,
  METAPI_PARSE_REGISTER_ARGS_TOOL_ID,
  METAPI_PARSE_REGISTER_ARGS_TOOL_NAME,
  METAPI_VERIFY_ACCOUNT_TOKEN_TOOL_ID,
  METAPI_VERIFY_ACCOUNT_TOKEN_TOOL_NAME,
} from "./toolIds";

// Keep group id literal to avoid skill package <-> toolRegistry circular import.
const SYSTEM_GROUP_ID = "system";

export const METAPI_OPS_TOOLS: SkillToolDefinition[] = [
  {
    id: METAPI_CONFIGURE_TOOL_ID,
    name: METAPI_CONFIGURE_TOOL_NAME,
    groupId: SYSTEM_GROUP_ID,
    displayName: "Metapi 管理配置",
    description: "配置本地 Metapi 管理 API 的 baseUrl 与 authToken（METAPI_AUTH_TOKEN）。token 仅保存在本地扩展存储。",
    toolClassification: { runtime: "local", capabilities: ["system_context", "deliver_result"], risk: "medium" },
    parameters: {
      type: "object",
      properties: {
        baseUrl: {
          type: "string",
          description: "管理端地址，默认 http://127.0.0.1:4000",
        },
        authToken: {
          type: "string",
          description: "Metapi 管理令牌 METAPI_AUTH_TOKEN",
        },
      },
      required: ["authToken"],
      additionalProperties: false,
    },
  },
  {
    id: METAPI_PARSE_REGISTER_ARGS_TOOL_ID,
    name: METAPI_PARSE_REGISTER_ARGS_TOOL_NAME,
    groupId: SYSTEM_GROUP_ID,
    displayName: "解析收录参数",
    description: "解析“/收录中转站 ...”命令中的站点名与是否开启系统代理等参数。",
    toolClassification: { runtime: "local", capabilities: ["system_context", "deliver_result"], risk: "low" },
    parameters: {
      type: "object",
      properties: {
        text: {
          type: "string",
          description: "命令参数文本，例如：gpt(name) 开启系统代理",
        },
      },
      required: ["text"],
      additionalProperties: false,
    },
  },
  {
    id: METAPI_LIST_SITES_TOOL_ID,
    name: METAPI_LIST_SITES_TOOL_NAME,
    groupId: SYSTEM_GROUP_ID,
    displayName: "Metapi 站点列表",
    description: "读取 Metapi 已收录站点；可传 url 检查是否已存在。",
    toolClassification: { runtime: "local", capabilities: ["deliver_result"], risk: "medium" },
    parameters: {
      type: "object",
      properties: {
        url: {
          type: "string",
          description: "可选，用于判断该 URL 是否已收录。",
        },
      },
      required: [],
      additionalProperties: false,
    },
  },
  {
    id: METAPI_DETECT_SITE_TOOL_ID,
    name: METAPI_DETECT_SITE_TOOL_NAME,
    groupId: SYSTEM_GROUP_ID,
    displayName: "Metapi 识别站点类型",
    description: "调用 POST /api/sites/detect 识别中转站平台类型。",
    toolClassification: { runtime: "local", capabilities: ["deliver_result"], risk: "medium" },
    parameters: {
      type: "object",
      properties: {
        url: {
          type: "string",
          description: "站点根 URL，不要带 /v1。",
        },
      },
      required: ["url"],
      additionalProperties: false,
    },
  },
  {
    id: METAPI_CREATE_SITE_TOOL_ID,
    name: METAPI_CREATE_SITE_TOOL_NAME,
    groupId: SYSTEM_GROUP_ID,
    displayName: "Metapi 创建站点",
    description: "调用 POST /api/sites 创建新站点。若站点已存在则返回 SITE_EXISTS，不重复创建。",
    toolClassification: { runtime: "local", capabilities: ["deliver_result"], risk: "high" },
    parameters: {
      type: "object",
      properties: {
        name: { type: "string", description: "站点名称" },
        url: { type: "string", description: "站点 URL" },
        platform: { type: "string", description: "平台类型，如 new-api" },
        useSystemProxy: { type: "boolean", description: "是否开启系统代理" },
        proxyUrl: { type: "string", description: "可选代理地址" },
        externalCheckinUrl: { type: "string", description: "可选外部签到 URL" },
        initializationPresetId: { type: "string", description: "detect 返回的官方预设 ID" },
      },
      required: ["name", "url"],
      additionalProperties: false,
    },
  },
  {
    id: METAPI_VERIFY_ACCOUNT_TOKEN_TOOL_ID,
    name: METAPI_VERIFY_ACCOUNT_TOKEN_TOOL_NAME,
    groupId: SYSTEM_GROUP_ID,
    displayName: "Metapi 验证账号令牌",
    description: "调用 POST /api/accounts/verify-token。accessToken 填系统访问令牌或 session cookie；platformUserId 为可选用户 ID。",
    toolClassification: { runtime: "local", capabilities: ["deliver_result"], risk: "high" },
    parameters: {
      type: "object",
      properties: {
        siteId: { type: "integer", minimum: 1, description: "站点 ID" },
        accessToken: { type: "string", description: "系统访问令牌 / session cookie / API key" },
        platformUserId: { type: "integer", minimum: 1, description: "可选用户 ID（New-API-User）" },
        credentialMode: {
          type: "string",
          enum: ["auto", "session", "apikey"],
          description: "凭证模式，默认 session",
        },
      },
      required: ["siteId", "accessToken"],
      additionalProperties: false,
    },
  },
  {
    id: METAPI_CREATE_ACCOUNT_TOOL_ID,
    name: METAPI_CREATE_ACCOUNT_TOOL_NAME,
    groupId: SYSTEM_GROUP_ID,
    displayName: "Metapi 添加账号连接",
    description: "调用 POST /api/accounts 保存账号连接。必须先 verify-token 成功。",
    toolClassification: { runtime: "local", capabilities: ["deliver_result"], risk: "high" },
    parameters: {
      type: "object",
      properties: {
        siteId: { type: "integer", minimum: 1, description: "站点 ID" },
        accessToken: { type: "string", description: "系统访问令牌 / session cookie / API key" },
        platformUserId: { type: "integer", minimum: 1, description: "可选用户 ID" },
        credentialMode: {
          type: "string",
          enum: ["auto", "session", "apikey"],
          description: "凭证模式，默认 session",
        },
        skipModelFetch: { type: "boolean", description: "是否跳过模型拉取，默认 false" },
        username: { type: "string", description: "可选用户名" },
      },
      required: ["siteId", "accessToken"],
      additionalProperties: false,
    },
  },
];
