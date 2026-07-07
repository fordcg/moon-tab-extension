import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { aggregateDisplayAttachmentsByKind, getJsSourceAttachmentDisplayCount, MessageList } from "../../../src/side-panel/components/MessageList";
import type { ChatAutomationReportToolAttachment, ChatBrowserScreenshotToolAttachment, ChatGenericToolAttachment, ChatJsSourceToolAttachment, ChatMessage, ChatNetworkToolAttachment } from "../../../src/shared/types";

function createJsSourceAttachment(partial: Partial<ChatJsSourceToolAttachment>): ChatJsSourceToolAttachment {
  return {
    id: "attachment-js",
    kind: "js-source",
    title: "JS 源码片段",
    summary: "JS 资源 1 个",
    createdAt: 1,
    redacted: true,
    truncated: false,
    resources: [],
    jsMatches: [],
    contexts: [],
    failedFetches: [],
    ...partial,
  };
}

function createNetworkAttachment(partial: Partial<ChatNetworkToolAttachment>): ChatNetworkToolAttachment {
  return {
    id: "attachment-network",
    kind: "network",
    title: "Network 请求详情",
    summary: "已注入 1 个 Network 请求：POST 200 https://api.example.com/login",
    createdAt: 1,
    redacted: false,
    truncated: false,
    requests: [
      {
        id: "req-1",
        url: "https://api.example.com/login",
        method: "POST",
        status: 200,
        requestBody: "{\"password\":\"123456\",\"name\":\"张三\"}",
        responseBody: "{\"ok\":true}",
        redacted: false,
        truncated: false,
      },
    ],
    ...partial,
  };
}

function createGenericAttachment(partial: Partial<ChatGenericToolAttachment>): ChatGenericToolAttachment {
  return {
    id: "attachment-generic",
    kind: "page-context",
    title: "页面上下文",
    summary: "页面摘要",
    createdAt: 1,
    redacted: false,
    truncated: false,
    ...partial,
  };
}

function createScreenshotAttachment(partial: Partial<ChatBrowserScreenshotToolAttachment>): ChatBrowserScreenshotToolAttachment {
  return {
    id: "attachment-screenshot",
    kind: "browser-screenshot",
    title: "浏览器截图",
    summary: "当前视口截图，PNG，3 B。",
    createdAt: 1,
    redacted: false,
    truncated: false,
    mediaType: "image/png",
    dataUrl: "data:image/png;base64,QUJD",
    target: "viewport",
    byteSize: 3,
    ...partial,
  };
}

function createAutomationReportAttachment(partial: Partial<ChatAutomationReportToolAttachment>): ChatAutomationReportToolAttachment {
  return {
    id: "attachment-report",
    kind: "automation-report",
    title: "自动化任务报告",
    summary: "任务报告：总步骤=2，成功=1，失败=1。",
    createdAt: 1,
    redacted: true,
    truncated: false,
    objective: "排查登录失败",
    conclusion: "发现一个 Network 500。",
    reportType: "interface_analysis",
    fullAccessIncluded: false,
    timeline: [
      {
        id: "event-1",
        type: "tool_call",
        at: 1,
        label: "调用浏览器页面状态",
        detail: "页面已加载",
        toolCallId: "call-1",
        status: "success",
      },
      {
        id: "event-2",
        type: "failure_recovery",
        at: 4,
        label: "失败恢复建议",
        detail: "检查失败步骤的参数、页面状态或授权边界后重试。",
        toolCallId: "call-2",
        status: "error",
      },
    ],
    steps: [
      {
        toolCallId: "call-1",
        toolName: "get_page_state",
        displayName: "浏览器页面状态",
        status: "success",
        startedAt: 1,
        completedAt: 2,
        evidence: "页面已加载",
        attachmentKinds: [],
      },
      {
        toolCallId: "call-2",
        toolName: "network_list_requests",
        displayName: "列出 Network 请求",
        status: "error",
        startedAt: 3,
        completedAt: 4,
        evidence: "Network 500",
        attachmentKinds: ["network"],
      },
    ],
    failureSummary: {
      failedStepCount: 1,
      failedTools: ["列出 Network 请求"],
      recoverableActions: ["检查失败步骤的参数、页面状态或授权边界后重试。"],
    },
    ...partial,
  };
}

describe("MessageList 工具附件展示聚合", () => {
  it("自动化报告附件展示步骤、失败摘要和完全访问标记", () => {
    const message: ChatMessage = {
      id: "assistant-report",
      role: "assistant",
      content: "已完成排查",
      createdAt: 1,
      modelId: "model-1",
      endpointType: "openai_chat",
      streamMode: false,
      systemPrompt: "",
      contextPrompt: "",
      contextMode: "text",
      toolAttachments: [createAutomationReportAttachment({ fullAccessIncluded: true })],
    };

    render(
      <MessageList
        messages={[message]}
        retryProgressByMessageId={{}}
        toolCallDisplayMode="assistant_grouped"
        showToolCallProcessInAssistantMode
        onRegenerateMessage={() => undefined}
        onEditAndRegenerateUserMessage={() => undefined}
        regenerating={false}
      />,
    );

    expect(screen.getByText("自动化任务报告")).toBeInTheDocument();
    expect(screen.getByText(/目标：排查登录失败/)).toBeInTheDocument();
    expect(screen.getByText(/任务类型：接口分析/)).toBeInTheDocument();
    expect(screen.getByText(/完全访问原文结果：是/)).toBeInTheDocument();
    expect(screen.getByText(/时间线/)).toBeInTheDocument();
    expect(screen.getByText(/调用浏览器页面状态/)).toBeInTheDocument();
    expect(screen.getByText(/失败恢复建议/)).toBeInTheDocument();
    expect(screen.getByText("浏览器页面状态")).toBeInTheDocument();
    expect(screen.getByText(/失败工具：列出 Network 请求/)).toBeInTheDocument();
  });

  it("多个自动化报告展示附件聚合后仍保留 typed 结构", () => {
    const attachments = aggregateDisplayAttachmentsByKind([
      createAutomationReportAttachment({ id: "report-a" }),
      createAutomationReportAttachment({
        id: "report-b",
        createdAt: 2,
        objective: "复查登录接口",
        conclusion: "发现鉴权重试失败。",
        fullAccessIncluded: true,
        timeline: [
          {
            id: "event-3",
            type: "tool_call",
            at: 5,
            label: "调用重试接口",
            detail: "鉴权重试返回 401",
            toolCallId: "call-3",
            status: "error",
          },
        ],
        steps: [
          {
            toolCallId: "call-3",
            toolName: "network_replay_request",
            displayName: "重放 Network 请求",
            status: "error",
            startedAt: 5,
            completedAt: 6,
            evidence: "鉴权重试返回 401",
            attachmentKinds: ["network"],
          },
        ],
        failureSummary: {
          failedStepCount: 1,
          failedTools: ["重放 Network 请求"],
          recoverableActions: ["重新获取授权后重试。"],
        },
      }),
    ]);

    expect(attachments).toHaveLength(1);
    const [attachment] = attachments;
    expect(attachment.kind).toBe("automation-report");
    expect("steps" in attachment && attachment.steps).toHaveLength(3);
    expect("timeline" in attachment && attachment.timeline).toHaveLength(3);
    expect("failureSummary" in attachment && attachment.failureSummary?.failedTools).toContain("重放 Network 请求");
    expect("fullAccessIncluded" in attachment && attachment.fullAccessIncluded).toBe(true);
    expect("details" in attachment).toBe(false);

    const message: ChatMessage = {
      id: "assistant-report-aggregated",
      role: "assistant",
      content: "已完成聚合排查",
      createdAt: 1,
      modelId: "model-1",
      endpointType: "openai_chat",
      streamMode: false,
      systemPrompt: "",
      contextPrompt: "",
      contextMode: "text",
      toolAttachments: attachments,
    };

    render(
      <MessageList
        messages={[message]}
        retryProgressByMessageId={{}}
        toolCallDisplayMode="assistant_grouped"
        showToolCallProcessInAssistantMode
        onRegenerateMessage={() => undefined}
        onEditAndRegenerateUserMessage={() => undefined}
        regenerating={false}
      />,
    );

    expect(screen.getByText("自动化任务报告")).toBeInTheDocument();
    expect(screen.getByText(/目标：排查登录失败；复查登录接口/)).toBeInTheDocument();
    expect(screen.getByText(/完全访问原文结果：是/)).toBeInTheDocument();
    expect(screen.getByText("重放 Network 请求")).toBeInTheDocument();
    expect(screen.getByText(/失败工具：列出 Network 请求、重放 Network 请求/)).toBeInTheDocument();
  });

  it("浏览器截图附件默认折叠且支持点击全屏预览", async () => {
    const user = userEvent.setup();
    const attachments = aggregateDisplayAttachmentsByKind([
      createScreenshotAttachment({ id: "screenshot-a", summary: "当前视口截图，PNG，3 B。" }),
      createScreenshotAttachment({ id: "screenshot-b", createdAt: 2, summary: "元素截图，PNG，3 B。", target: "element", uid: "1_1" }),
    ]);
    expect(attachments).toHaveLength(2);
    expect(attachments[0]).toMatchObject({ kind: "browser-screenshot", dataUrl: "data:image/png;base64,QUJD" });

    const message: ChatMessage = {
      id: "assistant-screenshot",
      role: "assistant",
      content: "已截图",
      createdAt: 1,
      modelId: "model-1",
      endpointType: "openai_chat",
      streamMode: false,
      systemPrompt: "",
      contextPrompt: "",
      contextMode: "text",
      toolAttachments: attachments,
    };

    render(
      <MessageList
        messages={[message]}
        retryProgressByMessageId={{}}
        toolCallDisplayMode="assistant_grouped"
        showToolCallProcessInAssistantMode
        onRegenerateMessage={() => undefined}
        onEditAndRegenerateUserMessage={() => undefined}
        regenerating={false}
      />,
    );

    const screenshotDetails = document.querySelectorAll(".message-browser-screenshot-attachment");
    expect(screenshotDetails).toHaveLength(2);
    screenshotDetails.forEach((details) => expect(details).not.toHaveAttribute("open"));
    expect(screen.getAllByText("浏览器截图")).toHaveLength(2);
    expect(screen.getAllByAltText("浏览器截图")).toHaveLength(2);
    expect(screen.getByText("当前视口截图，PNG，3 B。")).toBeInTheDocument();
    expect(screen.getByText("元素截图，PNG，3 B。")).toBeInTheDocument();

    screenshotDetails[0]?.setAttribute("open", "");
    await user.click(screen.getAllByRole("button", { name: "全屏预览浏览器截图" })[0]);
    const previewDialog = screen.getByRole("dialog", { name: "图片预览" });
    expect(previewDialog).toBeInTheDocument();
    expect(within(previewDialog).getByAltText("浏览器截图")).toBeInTheDocument();
  });

  it("当前一次性授权的 Network 附件展示时不再二次脱敏", () => {
    const message: ChatMessage = {
      id: "assistant-network",
      role: "assistant",
      content: "已读取 Network 请求",
      createdAt: 1,
      modelId: "model-1",
      endpointType: "openai_chat",
      streamMode: false,
      systemPrompt: "",
      contextPrompt: "",
      contextMode: "text",
      toolAttachments: [createNetworkAttachment({})],
    };

    render(
      <MessageList
        messages={[message]}
        retryProgressByMessageId={{}}
        toolCallDisplayMode="assistant_grouped"
        showToolCallProcessInAssistantMode
        onRegenerateMessage={() => undefined}
        onEditAndRegenerateUserMessage={() => undefined}
        regenerating={false}
      />,
    );

    expect(screen.getByText(/password/)).toBeInTheDocument();
    expect(screen.getByText(/123456/)).toBeInTheDocument();
    expect(screen.queryByText(/\[已脱敏]/)).not.toBeInTheDocument();
  });

  it("完全访问 Network 附件聚合后仍展示原文", () => {
    const attachments = aggregateDisplayAttachmentsByKind([
      createNetworkAttachment({
        id: "network-full-a",
        fullAccess: true,
        requests: [
          {
            id: "req-a",
            url: "https://api.example.com/login?token=secret-token",
            method: "POST",
            status: 200,
            requestHeaders: [{ name: "Authorization", value: "Bearer secret" }],
            requestBody: "{\"password\":\"123456\"}",
            responseBody: "{\"access_token\":\"secret-token\"}",
            redacted: false,
            truncated: false,
          },
        ],
      }),
      createNetworkAttachment({
        id: "network-full-b",
        createdAt: 2,
        fullAccess: true,
        requests: [
          {
            id: "req-b",
            url: "https://api.example.com/profile?token=profile-token",
            method: "GET",
            status: 200,
            requestHeaders: [{ name: "Cookie", value: "sid=secret" }],
            responseBody: "{\"email\":\"user@example.com\"}",
            redacted: false,
            truncated: false,
          },
        ],
      }),
    ]);

    expect(attachments).toHaveLength(1);
    const attachment = attachments[0] as ChatNetworkToolAttachment;
    expect(attachment.redacted).toBe(false);
    expect(attachment.fullAccess).toBe(true);
    expect(JSON.stringify(attachment.requests)).toContain("123456");
    expect(JSON.stringify(attachment.requests)).toContain("Bearer secret");
    expect(JSON.stringify(attachment.requests)).not.toContain("[已脱敏]");
  });

  it("单个通用展示附件会脱敏 JSON 形态摘要和详情", () => {
    const attachments = aggregateDisplayAttachmentsByKind([
      createGenericAttachment({
        id: "generic-display-json-a",
        summary: "{\"api_key\":\"xai-secret\",\"token\":\"summary-token\"}",
        details: "{\"password\":\"123456\",\"access_token\":\"abc\",\"secret\":\"raw-json-secret\"}",
      }),
    ]);

    expect(attachments).toHaveLength(1);
    const [attachment] = attachments as ChatGenericToolAttachment[];
    expect(attachment.redacted).toBe(true);
    for (const output of [attachment.summary, attachment.details]) {
      expect(output).not.toContain("xai-secret");
      expect(output).not.toContain("summary-token");
      expect(output).not.toContain("123456");
      expect(output).not.toContain("abc");
      expect(output).not.toContain("raw-json-secret");
      expect(output).toContain("[已脱敏]");
    }
  });

  it("多个通用展示附件聚合前会脱敏 JSON 形态摘要和详情", () => {
    const attachments = aggregateDisplayAttachmentsByKind([
      createGenericAttachment({
        id: "generic-display-json-a",
        summary: "{\"api_key\":\"xai-secret\"}",
        details: "{\"password\":\"123456\"}",
      }),
      createGenericAttachment({
        id: "generic-display-json-b",
        createdAt: 2,
        summary: "{\"token\":\"summary-token\"}",
        details: "{\"access_token\":\"abc\",\"secret\":\"raw-json-secret\"}",
      }),
    ]);

    expect(attachments).toHaveLength(1);
    const [attachment] = attachments as ChatGenericToolAttachment[];
    expect(attachment.redacted).toBe(true);
    for (const output of [attachment.summary, attachment.details]) {
      expect(output).not.toContain("xai-secret");
      expect(output).not.toContain("summary-token");
      expect(output).not.toContain("123456");
      expect(output).not.toContain("abc");
      expect(output).not.toContain("raw-json-secret");
      expect(output).toContain("[已脱敏]");
    }
  });

  it("通用展示附件会脱敏字符串化 JSON body", () => {
    const singleAttachments = aggregateDisplayAttachmentsByKind([
      createGenericAttachment({
        id: "generic-display-stringified-json-a",
        summary: JSON.stringify({ requestBody: JSON.stringify({ api_key: "xai-secret" }) }),
        details: JSON.stringify({ requestBody: JSON.stringify({ password: "123456", access_token: "abc" }) }),
      }),
    ]) as ChatGenericToolAttachment[];

    const multiAttachments = aggregateDisplayAttachmentsByKind([
      createGenericAttachment({
        id: "generic-display-stringified-json-b",
        summary: JSON.stringify({ requestBody: JSON.stringify({ api_key: "xai-secret" }) }),
        details: JSON.stringify({ requestBody: JSON.stringify({ password: "123456" }) }),
      }),
      createGenericAttachment({
        id: "generic-display-stringified-json-c",
        createdAt: 2,
        summary: JSON.stringify({ responseBody: JSON.stringify({ token: "summary-token" }) }),
        details: JSON.stringify({ responseBody: JSON.stringify({ access_token: "abc" }) }),
      }),
    ]) as ChatGenericToolAttachment[];

    for (const attachments of [singleAttachments, multiAttachments]) {
      expect(attachments).toHaveLength(1);
      const [attachment] = attachments;
      expect(attachment.redacted).toBe(true);
      for (const output of [attachment.summary, attachment.details]) {
        expect(output).not.toContain("xai-secret");
        expect(output).not.toContain("summary-token");
        expect(output).not.toContain("123456");
        expect(output).not.toContain("abc");
        expect(output).toContain("[已脱敏]");
      }
    }
  });

  it("通用展示附件会脱敏内嵌 JSON snippet", () => {
    const singleAttachments = aggregateDisplayAttachmentsByKind([
      createGenericAttachment({
        id: "generic-display-embedded-json-a",
        summary: JSON.stringify({ requestBody: 'Request body: {"api_key":"xai-secret"}' }),
        details: JSON.stringify({ requestBody: 'payload={"password":"123456","access_token":"abc"}' }),
      }),
    ]) as ChatGenericToolAttachment[];

    const multiAttachments = aggregateDisplayAttachmentsByKind([
      createGenericAttachment({
        id: "generic-display-embedded-json-b",
        summary: JSON.stringify({ requestBody: 'Request body: {"api_key":"xai-secret"}' }),
        details: JSON.stringify({ requestBody: 'payload={"password":"123456"}' }),
      }),
      createGenericAttachment({
        id: "generic-display-embedded-json-c",
        createdAt: 2,
        summary: JSON.stringify({ responseBody: 'payload={"access_token":"abc"}' }),
        details: JSON.stringify({ responseBody: 'Request body: {"api_key":"xai-secret"}' }),
      }),
    ]) as ChatGenericToolAttachment[];

    for (const attachments of [singleAttachments, multiAttachments]) {
      expect(attachments).toHaveLength(1);
      const [attachment] = attachments;
      expect(attachment.redacted).toBe(true);
      for (const output of [attachment.summary, attachment.details]) {
        expect(output).not.toContain("xai-secret");
        expect(output).not.toContain("123456");
        expect(output).not.toContain("abc");
        expect(output).toContain("[已脱敏]");
      }
    }
  });

  it("通用展示附件会脱敏直接内嵌 JSON snippet", () => {
    const singleAttachments = aggregateDisplayAttachmentsByKind([
      createGenericAttachment({
        id: "generic-display-direct-embedded-json-a",
        summary: 'Request body: {"api_key":"xai-secret"}',
        details: 'payload={"password":"123456","access_token":"abc"}',
      }),
    ]) as ChatGenericToolAttachment[];

    const multiAttachments = aggregateDisplayAttachmentsByKind([
      createGenericAttachment({
        id: "generic-display-direct-embedded-json-b",
        summary: 'Request body: {"api_key":"xai-secret"}',
        details: 'payload={"password":"123456"}',
      }),
      createGenericAttachment({
        id: "generic-display-direct-embedded-json-c",
        createdAt: 2,
        summary: 'payload={"access_token":"abc"}',
        details: 'Request body: {"api_key":"xai-secret"}',
      }),
    ]) as ChatGenericToolAttachment[];

    for (const attachments of [singleAttachments, multiAttachments]) {
      expect(attachments).toHaveLength(1);
      const [attachment] = attachments;
      expect(attachment.redacted).toBe(true);
      for (const output of [attachment.summary, attachment.details]) {
        expect(output).not.toContain("xai-secret");
        expect(output).not.toContain("123456");
        expect(output).not.toContain("abc");
        expect(output).toContain("[已脱敏]");
      }
    }
  });

  it("通用展示附件会脱敏嵌套直接内嵌 JSON snippet 的敏感父键", () => {
    const singleAttachments = aggregateDisplayAttachmentsByKind([
      createGenericAttachment({
        id: "generic-display-nested-direct-embedded-json-a",
        summary: 'payload={"password":{"value":"123456"}}',
        details: 'items={"items":[{"token":"abc"}]}',
      }),
    ]) as ChatGenericToolAttachment[];

    const multiAttachments = aggregateDisplayAttachmentsByKind([
      createGenericAttachment({
        id: "generic-display-nested-direct-embedded-json-b",
        summary: 'payload={"password":{"value":"123456"}}',
        details: 'items={"items":[{"token":"abc"}]}',
      }),
      createGenericAttachment({
        id: "generic-display-nested-direct-embedded-json-c",
        createdAt: 2,
        summary: 'body={"api_key":{"value":"xai-secret"}}',
        details: 'payload={"password":["123456"]}',
      }),
    ]) as ChatGenericToolAttachment[];

    for (const attachments of [singleAttachments, multiAttachments]) {
      expect(attachments).toHaveLength(1);
      const [attachment] = attachments;
      expect(attachment.redacted).toBe(true);
      for (const output of [attachment.summary, attachment.details]) {
        expect(output).not.toContain("123456");
        expect(output).not.toContain("abc");
        expect(output).not.toContain("xai-secret");
        expect(output).toContain("[已脱敏]");
      }
    }
  });

  it("同一气泡下多个 JS 源码附件聚合后仍保留结构化数据", () => {
    const attachments = aggregateDisplayAttachmentsByKind([
      createJsSourceAttachment({
        id: "attachment-js-a",
        resources: [
          {
            id: "script-a",
            source: "network",
            url: "https://example.com/a.js",
            size: 1,
            searchable: true,
            redacted: true,
            truncated: false,
          },
        ],
        jsMatches: [
          {
            resourceId: "script-a",
            source: "network",
            url: "https://example.com/a.js",
            term: "sign",
            position: 10,
            line: 1,
            column: 11,
            snippet: "function sign(){}",
            redacted: true,
            truncated: false,
          },
        ],
      }),
      createJsSourceAttachment({
        id: "attachment-js-b",
        createdAt: 2,
        truncated: true,
        resources: [
          {
            id: "script-b",
            source: "same-origin-fetch",
            url: "https://example.com/b.js",
            size: 1,
            searchable: true,
            redacted: true,
            truncated: false,
          },
        ],
        contexts: [
          {
            resourceId: "script-b",
            source: "same-origin-fetch",
            url: "https://example.com/b.js",
            position: 20,
            line: 2,
            column: 5,
            snippet: "const token = \"[已脱敏]\"",
            redacted: true,
            truncated: true,
          },
        ],
        failedFetches: [{ url: "https://example.com/missing.js", message: "同源 JS 补位读取失败。" }],
      }),
    ]);

    expect(attachments).toHaveLength(1);
    expect(attachments[0]).toMatchObject({
      kind: "js-source",
      id: "message-display-js-source-attachment-js-a-attachment-js-b",
      truncated: true,
      resources: [
        expect.objectContaining({ id: "script-a" }),
        expect.objectContaining({ id: "script-b" }),
      ],
      jsMatches: [expect.objectContaining({ resourceId: "script-a" })],
      contexts: [expect.objectContaining({ resourceId: "script-b" })],
      failedFetches: [expect.objectContaining({ message: "同源 JS 补位读取失败。" })],
    });
    expect(attachments[0]).not.toHaveProperty("details");
  });
  it("聚合 JS 源码附件时会基于去重后的结构重新生成摘要", () => {
    const attachments = aggregateDisplayAttachmentsByKind([
      createJsSourceAttachment({
        id: "attachment-js-a",
        summary: "旧摘要 A",
        resources: [
          {
            id: "script-a",
            source: "network",
            url: "https://example.com/a.js",
            size: 1,
            searchable: true,
            redacted: true,
            truncated: false,
          },
        ],
        jsMatches: [
          {
            resourceId: "script-a",
            source: "network",
            url: "https://example.com/a.js",
            term: "sign",
            position: 10,
            line: 1,
            column: 11,
            snippet: "function sign(){}",
            redacted: true,
            truncated: false,
          },
        ],
      }),
      createJsSourceAttachment({
        id: "attachment-js-b",
        summary: "旧摘要 B",
        resources: [
          {
            id: "script-a",
            source: "network",
            url: "https://example.com/a.js",
            size: 1,
            searchable: true,
            redacted: true,
            truncated: false,
          },
        ],
        jsMatches: [
          {
            resourceId: "script-a",
            source: "network",
            url: "https://example.com/a.js",
            term: "sign",
            position: 10,
            line: 1,
            column: 11,
            snippet: "function sign(){}",
            redacted: true,
            truncated: false,
          },
        ],
      }),
    ]);

    expect(attachments[0]).toMatchObject({
      kind: "js-source",
      summary: "JS 资源 1 个，命中 1 个，上下文 0 个，补位失败 0 个。",
    });
  });

  it("JS 源码附件标题计数在无片段时显示资源数，有片段时显示片段数", () => {
    expect(getJsSourceAttachmentDisplayCount(createJsSourceAttachment({
      resources: [
        {
          id: "script-a",
          source: "network",
          url: "https://example.com/a.js",
          size: 1,
          searchable: true,
          redacted: true,
          truncated: false,
        },
        {
          id: "script-b",
          source: "network",
          url: "https://example.com/b.js",
          size: 1,
          searchable: true,
          redacted: true,
          truncated: false,
        },
      ],
    }))).toBe(2);

    expect(getJsSourceAttachmentDisplayCount(createJsSourceAttachment({
      resources: [
        {
          id: "script-a",
          source: "network",
          url: "https://example.com/a.js",
          size: 1,
          searchable: true,
          redacted: true,
          truncated: false,
        },
      ],
      jsMatches: [
        {
          resourceId: "script-a",
          source: "network",
          url: "https://example.com/a.js",
          term: "login",
          position: 10,
          line: 1,
          column: 11,
          snippet: "login()",
          redacted: true,
          truncated: false,
        },
      ],
      contexts: [
        {
          resourceId: "script-a",
          source: "network",
          url: "https://example.com/a.js",
          position: 20,
          line: 2,
          column: 5,
          snippet: "function login(){}",
          redacted: true,
          truncated: false,
        },
      ],
    }))).toBe(2);
  });

  it("Source Map 映射详情展示安全摘要，不直接输出完整资源 URL", () => {
    const message: ChatMessage = {
      id: "assistant-1",
      role: "assistant",
      content: "已解析 Source Map",
      createdAt: 1,
      modelId: "model-1",
      endpointType: "openai_chat",
      streamMode: false,
      systemPrompt: "",
      contextPrompt: "",
      contextMode: "text",
      toolAttachments: [
        {
          id: "attachment-map",
          kind: "source-map",
          title: "Source Map 解析结果",
          summary: "Source Map 候选 0 个，映射 1 个，原始片段 0 个，失败 0 个。",
          createdAt: 1,
          redacted: true,
          truncated: false,
          candidates: [],
          resolvedLocations: [
            {
              resourceId: "script-1",
              resourceUrl: "https://example.com/internal/admin-panel.js?token=secret",
              generatedLine: 10,
              generatedColumn: 20,
              source: "src/app.ts",
              originalLine: 2,
              originalColumn: 5,
              name: "renderAdmin",
              ignored: false,
              hasSourceContent: true,
            },
          ],
          originalContexts: [],
          failures: [],
        },
      ],
    };

    render(
      <MessageList
        messages={[message]}
        retryProgressByMessageId={{}}
        toolCallDisplayMode="assistant_grouped"
        showToolCallProcessInAssistantMode
        onRegenerateMessage={() => undefined}
        onEditAndRegenerateUserMessage={() => undefined}
        regenerating={false}
      />,
    );

    expect(screen.getByText("resourceId: script-1", { exact: false })).toBeInTheDocument();
    expect(screen.getByText("name: renderAdmin", { exact: false })).toBeInTheDocument();
    expect(screen.queryByText(/admin-panel\.js\?token=secret/)).not.toBeInTheDocument();
  });

  it("Source Map 候选展示只显示安全位置摘要，不直接输出完整 map URL", () => {
    const message: ChatMessage = {
      id: "assistant-2",
      role: "assistant",
      content: "已发现 Source Map 候选",
      createdAt: 2,
      modelId: "model-1",
      endpointType: "openai_chat",
      streamMode: false,
      systemPrompt: "",
      contextPrompt: "",
      contextMode: "text",
      toolAttachments: [
        {
          id: "attachment-map-2",
          kind: "source-map",
          title: "Source Map 解析结果",
          summary: "Source Map 候选 1 个，映射 0 个，原始片段 0 个，失败 0 个。",
          createdAt: 2,
          redacted: true,
          truncated: false,
          candidates: [
            {
              resourceId: "script-2",
              resourceUrl: "https://example.com/assets/app.js",
              source: "source-mapping-url",
              url: "https://example.com/assets/app.js.map?token=secret",
              inline: false,
              status: "fetchable",
              parsed: false,
            },
          ],
          resolvedLocations: [],
          originalContexts: [],
          failures: [],
        },
      ],
    };

    render(
      <MessageList
        messages={[message]}
        retryProgressByMessageId={{}}
        toolCallDisplayMode="assistant_grouped"
        showToolCallProcessInAssistantMode
        onRegenerateMessage={() => undefined}
        onEditAndRegenerateUserMessage={() => undefined}
        regenerating={false}
      />,
    );

    expect(screen.getByText("script-2 | source-mapping-url | fetchable | 外部 Source Map")).toBeInTheDocument();
    expect(screen.queryByText(/app\.js\.map\?token=secret/)).not.toBeInTheDocument();
  });
});
