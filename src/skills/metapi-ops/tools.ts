import type { SkillToolDefinition } from "../types";
import {
  METAPI_CONFIGURE_TOOL_ID,
  METAPI_CONFIGURE_TOOL_NAME,
  METAPI_CREATE_ACCOUNT_TOOL_ID,
  METAPI_CREATE_ACCOUNT_TOOL_NAME,
  METAPI_CREATE_SITE_TOOL_ID,
  METAPI_CREATE_SITE_TOOL_NAME,
  METAPI_DELETE_SITE_TOOL_ID,
  METAPI_DELETE_SITE_TOOL_NAME,
  METAPI_DETECT_SITE_TOOL_ID,
  METAPI_DETECT_SITE_TOOL_NAME,
  METAPI_GET_CHECKIN_LOGS_TOOL_ID,
  METAPI_GET_CHECKIN_LOGS_TOOL_NAME,
  METAPI_LIST_BROWSER_CHECKIN_RESULTS_TOOL_ID,
  METAPI_LIST_BROWSER_CHECKIN_RESULTS_TOOL_NAME,
  METAPI_LIST_SITES_TOOL_ID,
  METAPI_LIST_SITES_TOOL_NAME,
  METAPI_PARSE_REGISTER_ARGS_TOOL_ID,
  METAPI_PARSE_REGISTER_ARGS_TOOL_NAME,
  METAPI_RECORD_BROWSER_CHECKIN_TOOL_ID,
  METAPI_RECORD_BROWSER_CHECKIN_TOOL_NAME,
  METAPI_SET_SITE_CHECKIN_ENABLED_TOOL_ID,
  METAPI_SET_SITE_CHECKIN_ENABLED_TOOL_NAME,
  METAPI_SUMMARIZE_CHECKIN_LOGS_TOOL_ID,
  METAPI_SUMMARIZE_CHECKIN_LOGS_TOOL_NAME,
  METAPI_TRIGGER_CHECKIN_TOOL_ID,
  METAPI_TRIGGER_CHECKIN_TOOL_NAME,
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
          description: "站点根 URL（仅 origin，不要带 /profile、/console、/v1 等路径）。",
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
  {
    id: METAPI_TRIGGER_CHECKIN_TOOL_ID,
    name: METAPI_TRIGGER_CHECKIN_TOOL_NAME,
    groupId: SYSTEM_GROUP_ID,
    displayName: "Metapi 开始全部签到",
    description:
      "调用 POST /api/checkin/trigger 开始全部签到。默认会在工具内等待并轮询签到日志（类似后台 job），返回 jobId、等待时长、新增日志摘要。不要触发后立刻连续空轮询。",
    toolClassification: { runtime: "local", capabilities: ["deliver_result"], risk: "medium" },
    parameters: {
      type: "object",
      properties: {
        waitSeconds: {
          type: "integer",
          minimum: 0,
          maximum: 180,
          description: "触发后最长等待秒数并轮询日志，默认 45；设为 0 则立即返回 jobId。",
        },
        pollIntervalSeconds: {
          type: "integer",
          minimum: 2,
          maximum: 30,
          description: "等待期间轮询签到日志的间隔秒数，默认 5。",
        },
      },
      required: [],
      additionalProperties: false,
    },
  },
  {
    id: METAPI_GET_CHECKIN_LOGS_TOOL_ID,
    name: METAPI_GET_CHECKIN_LOGS_TOOL_NAME,
    groupId: SYSTEM_GROUP_ID,
    displayName: "Metapi 签到日志",
    description: "调用 GET /api/checkin/logs?limit=... 获取最近签到日志。",
    toolClassification: { runtime: "local", capabilities: ["deliver_result"], risk: "low" },
    parameters: {
      type: "object",
      properties: {
        limit: {
          type: "integer",
          minimum: 1,
          maximum: 500,
          description: "返回条数，默认 100",
        },
        jobId: {
          type: "string",
          description: "可选，仅保留该 jobId 相关日志（若日志字段支持）",
        },
      },
      required: [],
      additionalProperties: false,
    },
  },
  {
    id: METAPI_SUMMARIZE_CHECKIN_LOGS_TOOL_ID,
    name: METAPI_SUMMARIZE_CHECKIN_LOGS_TOOL_NAME,
    groupId: SYSTEM_GROUP_ID,
    displayName: "汇总签到结果",
    description: "读取签到日志并分类 success/failed/skipped，输出补签候选（含站点 URL）。",
    toolClassification: { runtime: "local", capabilities: ["deliver_result"], risk: "low" },
    parameters: {
      type: "object",
      properties: {
        limit: {
          type: "integer",
          minimum: 1,
          maximum: 500,
          description: "读取日志条数，默认 100",
        },
        jobId: {
          type: "string",
          description: "可选，优先匹配该 jobId",
        },
      },
      required: [],
      additionalProperties: false,
    },
  },
  {
    id: METAPI_RECORD_BROWSER_CHECKIN_TOOL_ID,
    name: METAPI_RECORD_BROWSER_CHECKIN_TOOL_NAME,
    groupId: SYSTEM_GROUP_ID,
    displayName: "记录浏览器补签结果",
    description: "浏览器补签完成后写入本地结果。Metapi 官方日志不会自动更新；该记录用于避免重复补签，并在汇总时标记已浏览器补签。",
    toolClassification: { runtime: "local", capabilities: ["deliver_result"], risk: "low" },
    parameters: {
      type: "object",
      properties: {
        siteUrl: { type: "string", description: "站点源站 URL" },
        siteId: { type: "integer", minimum: 1, description: "可选站点 ID" },
        siteName: { type: "string", description: "可选站点名" },
        username: { type: "string", description: "可选用户名" },
        status: {
          type: "string",
          enum: ["success", "failed", "skipped", "needs_human"],
          description: "浏览器补签结果",
        },
        message: { type: "string", description: "可选说明，如已签到/验证码" },
      },
      required: ["siteUrl", "status"],
      additionalProperties: false,
    },
  },
  {
    id: METAPI_LIST_BROWSER_CHECKIN_RESULTS_TOOL_ID,
    name: METAPI_LIST_BROWSER_CHECKIN_RESULTS_TOOL_NAME,
    groupId: SYSTEM_GROUP_ID,
    displayName: "查看浏览器补签记录",
    description: "列出本地记录的浏览器补签结果（默认仅今天）。",
    toolClassification: { runtime: "local", capabilities: ["deliver_result"], risk: "low" },
    parameters: {
      type: "object",
      properties: {
        todayOnly: {
          type: "boolean",
          description: "是否仅返回今天记录，默认 true",
        },
      },
      required: [],
      additionalProperties: false,
    },
  },
  {
    id: METAPI_DELETE_SITE_TOOL_ID,
    name: METAPI_DELETE_SITE_TOOL_NAME,
    groupId: SYSTEM_GROUP_ID,
    displayName: "删除 Metapi 站点",
    description: "调用 DELETE /api/sites/:id 删除站点（及其关联账号，取决于服务端实现）。仅在用户明确要求删除时使用。",
    toolClassification: { runtime: "local", capabilities: ["deliver_result"], risk: "high" },
    parameters: {
      type: "object",
      properties: {
        siteId: {
          type: "integer",
          minimum: 1,
          description: "要删除的站点 ID",
        },
        url: {
          type: "string",
          description: "可选：用站点 URL 解析 siteId（当未给 siteId 时）",
        },
        confirm: {
          type: "boolean",
          description: "必须为 true 才执行删除，防止误删",
        },
      },
      required: ["confirm"],
      additionalProperties: false,
    },
  },
  {
    id: METAPI_SET_SITE_CHECKIN_ENABLED_TOOL_ID,
    name: METAPI_SET_SITE_CHECKIN_ENABLED_TOOL_NAME,
    groupId: SYSTEM_GROUP_ID,
    displayName: "开关站点签到",
    description: "调用 PATCH/PUT /api/sites/:id 设置 checkinEnabled/checkin_enabled，用于关闭或开启某站自动签到。",
    toolClassification: { runtime: "local", capabilities: ["deliver_result"], risk: "medium" },
    parameters: {
      type: "object",
      properties: {
        siteId: {
          type: "integer",
          minimum: 1,
          description: "站点 ID",
        },
        url: {
          type: "string",
          description: "可选：用站点 URL 解析 siteId",
        },
        enabled: {
          type: "boolean",
          description: "true=开启签到，false=关闭签到",
        },
      },
      required: ["enabled"],
      additionalProperties: false,
    },
  },
];
