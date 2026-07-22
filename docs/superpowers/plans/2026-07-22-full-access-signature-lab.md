# Full Access Signature Lab Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a built-in Full Access signature-analysis playbook and harden all default follow-up, export, and workflow artifact paths so raw signature experiment values do not leave the current authorized session.

**Architecture:** Reuse the existing automation playbook registry, selected-playbook prompt injection, Full Access tool executor, Network attachment model, markdown export, and workflow artifact pipeline. No new tool executor is required: the feature is a critical-risk playbook plus prompt guidance and redaction gates around existing raw Full Access attachments.

**Tech Stack:** TypeScript, Vitest, Vite MV3 extension, existing `networkContext` redaction helpers, existing `security/redaction` helpers, Zustand side-panel workflow state.

---

## Merge Gates

- [ ] `full_access_signature_lab` is a default-enabled built-in playbook with `risk: "critical"`.
- [ ] Natural-language requests such as "逆向这个请求签名", "找 sign 生成逻辑", and "分析 nonce 怎么生成" trigger automation playbook selection.
- [ ] When the selected playbook is `full_access_signature_lab`, the model receives the signature-lab strategy prompt and the Full Access runtime guidance in the same system prompt.
- [ ] Raw Full Access Network attachments remain available through `collectRawMessageToolAttachments` for current-session UI inspection.
- [ ] `formatToolAttachmentForPrompt`, `formatToolAttachmentForPromptSummary`, `formatToolAttachmentForExport`, markdown export/clipboard, chat-request history expansion, context compression budget text, and workflow artifacts do not emit raw `token`, `Authorization`, `Cookie`, `password`, `sign`, `signature`, `sig`, or `nonce` values by default.
- [ ] The legacy `src/shared/automation-playbooks.mjs` registry remains unchanged; `npm run test:legacy` still passes with its two-playbook snapshot.

## File Map

Modify:

- `src/shared/automationPlaybooks.ts`
- `tests/unit/shared/automationPlaybooks.test.ts`
- `src/background/backgroundToolRuntime.ts`
- `tests/unit/background/backgroundToolRuntime.test.ts`
- `src/shared/networkContext.ts`
- `tests/unit/shared/networkContext.test.ts`
- `src/shared/security/redaction.ts`
- `tests/unit/shared/redaction.test.ts`
- `src/shared/toolArtifacts.ts`
- `tests/unit/shared/toolArtifacts.test.ts`
- `tests/unit/shared/chatRequestMessages.toolAttachments.test.ts`
- `tests/unit/side-panel/chatMarkdownExport.test.ts`
- `src/side-panel/state/appStoreWorkflowTasks.ts`
- `tests/unit/side-panel/appStoreWorkflowTasks.test.ts`

Do not modify for this feature:

- `src/shared/automation-playbooks.mjs`
- `scripts/test_automation_playbooks.mjs`
- `src/background/browserControl/fullAccessToolExecutor.ts`, unless a failing regression test shows the existing Full Access executor contract no longer holds.

## Task 1: Add the Built-In Signature Lab Playbook

**Files:**

- `src/shared/automationPlaybooks.ts`
- `tests/unit/shared/automationPlaybooks.test.ts`

### Test First

- [ ] In `tests/unit/shared/automationPlaybooks.test.ts`, update the built-in ID snapshot so `full_access_signature_lab` appears after `source_runtime_analysis` and before skill-package playbooks:

```ts
expect(playbooks.map((playbook) => playbook.id)).toEqual([
  "page_reading",
  "multi_page_synthesis",
  "form_interaction",
  "site_diagnostics",
  "network_api_analysis",
  "source_runtime_analysis",
  "full_access_signature_lab",
  "register_relay_site",
  "query_model_marketplace_sites",
  "start_all_checkin",
  "repair_failed_checkin",
]);
```

- [ ] Add a playbook-contract test:

```ts
it("完全访问签名实验室声明最高风险、Full Access 能力和脱敏交付边界", () => {
  const playbook = getAutomationPlaybookById("full_access_signature_lab");

  expect(playbook).toMatchObject({
    title: "Full Access 签名实验室",
    risk: "critical",
    defaultEnabled: true,
    source: "builtin",
  });
  expect(playbook?.recommendedCapabilities).toEqual(expect.arrayContaining([
    "observe_page",
    "analyze_site",
    "full_access",
    "deliver_result",
  ]));
  expect(playbook?.selectionHints).toEqual(expect.arrayContaining([
    "逆向这个请求签名",
    "找 sign 生成逻辑",
    "分析 nonce 怎么生成",
  ]));
  expect(playbook?.prompt).toEqual(expect.stringContaining("任务策略：Full Access 签名实验室"));
  expect(playbook?.prompt).toEqual(expect.stringContaining("full_access.get_network_details"));
  expect(playbook?.prompt).toEqual(expect.stringContaining("full_access.execute_script"));
  expect(playbook?.prompt).toEqual(expect.stringContaining("full_access.fetch"));
  expect(playbook?.prompt).toEqual(expect.stringContaining("可复现实验记录"));
  expect(playbook?.prompt).toEqual(expect.stringContaining("默认导出、后续追问和工作流产物只保留脱敏摘要"));
});
```

- [ ] Extend the trigger test:

```ts
expect(shouldRunAutomationPlaybookSelection("逆向这个请求签名")).toBe(true);
expect(shouldRunAutomationPlaybookSelection("找 sign 生成逻辑")).toBe(true);
expect(shouldRunAutomationPlaybookSelection("分析 nonce 怎么生成")).toBe(true);
expect(shouldRunAutomationPlaybookSelection("定位 debug 参数加密算法")).toBe(true);
```

- [ ] Extend the natural-language hint test:

```ts
expect(matchAutomationPlaybookByHints("找 sign 生成逻辑", playbooks)?.id).toBe("full_access_signature_lab");
expect(matchAutomationPlaybookByHints("逆向这个请求签名", playbooks)?.id).toBe("full_access_signature_lab");
```

### Expected Failure

- [ ] Run:

```powershell
npx vitest run tests/unit/shared/automationPlaybooks.test.ts
```

Expected output: the playbook ID snapshot and new signature-lab contract tests fail because `full_access_signature_lab` does not exist yet.

### Implementation

- [ ] Add this object to `CORE_BUILTIN_AUTOMATION_PLAYBOOKS` immediately after `source_runtime_analysis`:

```ts
{
  id: "full_access_signature_lab",
  title: "Full Access 签名实验室",
  description: "在用户已开启完全访问模式后，结合原始 Network、页面运行态、JS/Source Map 线索和凭据请求实验，定位签名、加密、nonce/debug 参数的生成链路。",
  tags: ["Full Access", "签名", "逆向", "加密", "Nonce", "Network", "JS"],
  source: "builtin",
  defaultEnabled: true,
  risk: "critical",
  recommendedCapabilities: ["observe_page", "analyze_site", "full_access", "deliver_result"],
  selectionHints: [
    "逆向这个请求签名",
    "找 sign 生成逻辑",
    "分析 signature 怎么生成",
    "分析 nonce 怎么生成",
    "定位 debug 参数加密算法",
    "复现接口加签",
    "Full Access 签名实验室",
  ],
  prompt: [
    "任务策略：Full Access 签名实验室",
    "仅在当前会话已经启用 Full Access 工具时执行本策略；策略本身不能开启完全访问、不能替代用户授权，也不能声称绕过 Chrome、网页 CSP 或扩展平台硬限制。",
    "先确认目标页面、目标操作和目标请求；使用 network_summarize_api_candidates、network_find_parameter_candidates、network_extract_js_candidates、JS/Source Map/Runtime 只读工具缩小候选范围，再对已选 requestIds 使用 full_access.get_network_details 读取原始请求细节。",
    "需要验证生成链路时，可使用 full_access.execute_script 读取页面运行态函数、调用栈线索和全局变量；需要做同源凭据实验时，可使用 full_access.fetch，并显式记录 method、URL、关键参数差异、响应状态和观察结果。",
    "对 sign、signature、sig、nonce、timestamp、debug、token、cookie、authorization 等字段，要区分字段名、原始值、生成算法、依赖输入和实验结论；不要把未验证猜测写成确定事实。",
    "交付时输出可复现实验记录：目标请求、关键样本差异、定位到的源码/运行态证据、最小复现步骤、失败尝试和下一步验证建议。",
    "当前会话工具附件可以追溯 Full Access 原文；默认导出、后续追问和工作流产物只保留脱敏摘要，不在最终回答中复制完整敏感原文，除非用户在当前授权会话明确要求展示具体片段。",
  ].join("\n"),
}
```

- [ ] In `shouldRunAutomationPlaybookSelection`, add a signature-lab intent branch after the Metapi branch and before the generic browser-scene branch:

```ts
const hasSignatureLabIntent =
  /(?:逆向|分析|定位|找|还原|复现|调试|研究).*(?:签名|加签|验签|sign|signature|sig|nonce|debug\s*参数|加密|encrypt|crypto|hash|md5|sha1|sha256)|(?:签名|加签|验签|sign|signature|sig|nonce|debug\s*参数|加密|encrypt|crypto|hash|md5|sha1|sha256).*(?:生成|逻辑|算法|来源|参数|逆向|分析|定位|找|还原|复现|调试)/.test(text);
if (hasSignatureLabIntent) {
  return true;
}
```

### Verify

- [ ] Run:

```powershell
npx vitest run tests/unit/shared/automationPlaybooks.test.ts
```

Expected output: all tests in `automationPlaybooks.test.ts` pass.

- [ ] Commit:

```powershell
git add src/shared/automationPlaybooks.ts tests/unit/shared/automationPlaybooks.test.ts
git commit -m "feat: 新增完全访问签名实验策略"
```

## Task 2: Strengthen Full Access Prompt Injection

**Files:**

- `src/background/backgroundToolRuntime.ts`
- `tests/unit/background/backgroundToolRuntime.test.ts`

### Test First

- [ ] Extend the existing test named `完全访问提示要求模型直接放行边界而不走受控增强确认` with these assertions:

```ts
expect(result[0].content).toContain("默认导出、后续追问和工作流产物仍按脱敏策略处理");
expect(result[0].content).toContain("签名、加密、nonce/debug 参数实验");
```

- [ ] Add a selected-playbook prompt test:

```ts
it("选中完全访问签名实验室时注入签名实验策略和 Full Access 工具指引", () => {
  const result = appendBrowserControlPromptIfNeeded(
    [createMessage("system", "你是网页助手"), createMessage("user", "逆向这个请求签名")],
    [
      { id: "network.summarize_api_candidates", name: "network_summarize_api_candidates", parameters: {} },
      { id: "full_access.get_network_details", name: "full_access_get_network_details", parameters: {} },
      { id: "full_access.execute_script", name: "full_access_execute_script", parameters: {} },
      { id: "full_access.fetch", name: "full_access_fetch", parameters: {} },
    ],
    {
      playbookId: "full_access_signature_lab",
      title: "Full Access 签名实验室",
      source: "builtin",
      confidence: "high",
      reason: "用户要求逆向请求签名",
    },
  );

  expect(result[0].content).toContain("当前处于完全访问模式");
  expect(result[0].content).toContain("当前选中的浏览器自动化任务策略：Full Access 签名实验室");
  expect(result[0].content).toContain("任务策略：Full Access 签名实验室");
  expect(result[0].content).toContain("full_access.get_network_details");
  expect(result[0].content).toContain("full_access.execute_script");
  expect(result[0].content).toContain("full_access.fetch");
  expect(result[0].content).toContain("可复现实验记录");
  expect(result[0].content).not.toContain("任务策略：Network/API 分析");
});
```

### Expected Failure

- [ ] Run:

```powershell
npx vitest run tests/unit/background/backgroundToolRuntime.test.ts
```

Expected output: the new prompt assertions fail because the Full Access runtime prompt does not yet include signature-lab redaction and experiment guidance.

### Implementation

- [ ] In the Full Access branch of `appendBrowserControlPromptIfNeeded`, keep the existing direct-use and no-boundary-confirmation bullets, then add these bullets:

```ts
"- Full Access 工具返回的敏感原文只用于当前授权会话中的分析和可见附件追溯；默认导出、后续追问和工作流产物仍按脱敏策略处理，除非用户在当前授权会话明确要求展示具体片段。",
"- 做签名、加密、nonce/debug 参数实验时，先锁定目标请求和触发动作，再组合使用 Network/JS/Source Map/Runtime 只读工具、full_access.get_network_details、full_access.execute_script 和 full_access.fetch；回答中保留可复现实验记录、证据来源和不确定性。",
```

### Verify

- [ ] Run:

```powershell
npx vitest run tests/unit/background/backgroundToolRuntime.test.ts
```

Expected output: all tests in `backgroundToolRuntime.test.ts` pass.

- [ ] Commit:

```powershell
git add src/background/backgroundToolRuntime.ts tests/unit/background/backgroundToolRuntime.test.ts
git commit -m "feat: 强化完全访问签名实验提示"
```

## Task 3: Redact Signature Fields in Shared Text Paths

**Files:**

- `src/shared/networkContext.ts`
- `tests/unit/shared/networkContext.test.ts`
- `src/shared/security/redaction.ts`
- `tests/unit/shared/redaction.test.ts`

### Test First

- [ ] In `tests/unit/shared/networkContext.test.ts`, update the sensitive-detail fixture or add a new test so Network redaction covers signature-lab field names:

```ts
it("脱敏签名实验字段中的 sign、signature、sig 和 nonce", () => {
  const detail = redactNetworkRequestDetail(createDetail({
    url: "https://api.example.com/search?sign=raw-signature&signature=raw-long-signature&sig=raw-sig&nonce=raw-nonce&safe=1",
    requestHeaders: [{ name: "X-Nonce", value: "raw-header-nonce" }],
    requestBody: "{\"sign\":\"raw-body-sign\",\"nonce\":\"raw-body-nonce\",\"q\":\"apple\"}",
    responseBody: "{\"signature\":\"raw-response-sign\",\"ok\":true}",
  }));

  const text = JSON.stringify(detail);

  expect(text).toContain("[已脱敏]");
  expect(text).not.toMatch(/raw-signature|raw-long-signature|raw-sig|raw-nonce|raw-header-nonce|raw-body-sign|raw-body-nonce|raw-response-sign/);
  expect(detail.url).toContain("sign=[已脱敏]");
  expect(detail.url).toContain("signature=[已脱敏]");
  expect(detail.url).toContain("sig=[已脱敏]");
  expect(detail.url).toContain("nonce=[已脱敏]");
});
```

- [ ] In `tests/unit/shared/redaction.test.ts`, add a generic export redaction test:

```ts
it("会脱敏签名实验字段的赋值、查询参数和 JSON 值", () => {
  const values = [
    "https://example.com/api?sign=raw-signature&nonce=raw-nonce",
    "{\"signature\":\"raw-signature\",\"sig\":\"raw-sig\",\"nonce\":\"raw-nonce\"}",
    "sign=raw-signature nonce=raw-nonce sig=raw-sig",
  ];

  for (const value of values) {
    const redacted = redactSensitiveText(value);

    expect(redacted).toContain("[已脱敏]");
    expect(redacted).not.toMatch(/raw-signature|raw-nonce|raw-sig/);
  }
});
```

### Expected Failure

- [ ] Run:

```powershell
npx vitest run tests/unit/shared/networkContext.test.ts tests/unit/shared/redaction.test.ts
```

Expected output: the new signature-field tests fail because `sign`, `signature`, `sig`, and `nonce` are not sensitive names yet.

### Implementation

- [ ] In `src/shared/networkContext.ts`, extend both name-based and inline redaction patterns:

```ts
const SENSITIVE_NAME_PATTERN = /(authorization|cookie|set-cookie|token|access[_-]?token|refresh[_-]?token|jwt|api[_-]?key|secret|password|passwd|credential|session|sid|csrf|xsrf|signature|sign|sig|nonce)/i;
const SENSITIVE_INLINE_PATTERN = /\b(api[_-]?key|access[_-]?token|refresh[_-]?token|token|jwt|secret|password|passwd|credential|session|sid|csrf|xsrf|signature|sign|sig|nonce)\s*[:=]\s*[^\s,;&"'}）]+/gi;
```

- [ ] In `src/shared/security/redaction.ts`, extend the shared export/clipboard key pattern:

```ts
const SENSITIVE_KEY = "(?:access[_-]?token|token|secret|password|passwd|pwd|authorization|auth|api[_-]?key|session|jwt|credential|cookie|set-cookie|bearer|signature|sign|sig|nonce)";
```

### Verify

- [ ] Run:

```powershell
npx vitest run tests/unit/shared/networkContext.test.ts tests/unit/shared/redaction.test.ts
```

Expected output: both test files pass.

- [ ] Commit:

```powershell
git add src/shared/networkContext.ts tests/unit/shared/networkContext.test.ts src/shared/security/redaction.ts tests/unit/shared/redaction.test.ts
git commit -m "fix: 脱敏签名实验字段"
```

## Task 4: Redact Full Access Network Attachments in Prompt and Export Formatters

**Files:**

- `src/shared/toolArtifacts.ts`
- `tests/unit/shared/toolArtifacts.test.ts`

### Test First

- [ ] Add `formatToolAttachmentForPromptSummary` to the import list in `tests/unit/shared/toolArtifacts.test.ts`.

- [ ] Replace the existing test named `完全访问 Network 附件归一化和聚合后仍保留原文` with a test that keeps raw UI access but redacts shared text:

```ts
it("完全访问 Network 附件在原始收集保留原文，提示摘要和导出默认脱敏", () => {
  const message = createAssistantMessage({
    toolAttachments: [
      {
        id: "attachment-network-full-access",
        kind: "network",
        title: "Network 请求详情",
        summary: "原始详情",
        sourceToolCallId: "call-network",
        createdAt: 2,
        redacted: false,
        fullAccess: true,
        truncated: false,
        requests: [
          {
            id: "req-1",
            url: "https://example.com/login?sign=raw-signature&nonce=raw-nonce&token=secret",
            method: "POST",
            requestHeaders: [{ name: "Authorization", value: "Bearer secret" }],
            requestBody: "{\"password\":\"123456\",\"sign\":\"raw-body-sign\",\"nonce\":\"raw-body-nonce\"}",
            responseBody: "{\"signature\":\"raw-response-sign\",\"ok\":true}",
            redacted: false,
            truncated: false,
          },
        ],
      },
    ],
  });

  const [rawAttachment] = collectRawMessageToolAttachments(message);
  const [attachment] = collectMessageToolAttachments(message);

  expect(rawAttachment).toMatchObject({ kind: "network", redacted: false, fullAccess: true });
  expect(JSON.stringify(rawAttachment)).toContain("raw-signature");
  expect(JSON.stringify(rawAttachment)).toContain("Bearer secret");
  expect(attachment).toMatchObject({ kind: "network", redacted: false, fullAccess: true });

  for (const text of [
    formatToolAttachmentForPrompt(attachment),
    formatToolAttachmentForPromptSummary(attachment),
    formatToolAttachmentForExport(attachment),
  ]) {
    expect(text).toContain("[已脱敏]");
    expect(text).not.toMatch(/raw-signature|raw-nonce|secret|123456|raw-body-sign|raw-body-nonce|raw-response-sign/);
  }
});
```

### Expected Failure

- [ ] Run:

```powershell
npx vitest run tests/unit/shared/toolArtifacts.test.ts
```

Expected output: the replacement test fails because `formatToolAttachmentForPrompt`, `formatToolAttachmentForPromptSummary`, or `formatToolAttachmentForExport` still formats Full Access network requests without redacting them.

### Implementation

- [ ] In `src/shared/toolArtifacts.ts`, add a helper near `shouldPreserveNetworkAttachmentRaw`:

```ts
function redactNetworkAttachmentRequestsForSharedText(
  attachment: ChatNetworkToolAttachment,
): ChatNetworkToolAttachment["requests"] {
  return attachment.requests.map(redactNetworkRequestDetail);
}
```

- [ ] Change the Network branch in `formatToolAttachmentForPrompt` to always use the helper:

```ts
const requests = redactNetworkAttachmentRequestsForSharedText(attachment);
return ["后续追问需要继续参考以下历史 Network 请求详情：", formatNetworkAttachmentForExport(requests)].join("\n");
```

- [ ] Change the Network branch in `formatToolAttachmentForPromptSummary` to use the helper before calling `formatNetworkAttachmentSummary`:

```ts
const requests = redactNetworkAttachmentRequestsForSharedText(attachment);
const summary = formatNetworkAttachmentSummary(requests).trim();
```

- [ ] Change the Network branch in `formatToolAttachmentForExport` to always use the helper:

```ts
const requests = redactNetworkAttachmentRequestsForSharedText(attachment);
return ["# Network 请求详情附件", "", formatNetworkAttachmentSummary(requests), "", formatNetworkAttachmentForExport(requests)].join("\n");
```

- [ ] Keep `shouldPreserveNetworkAttachmentRaw` for normalization and aggregation only. Do not change `collectRawMessageToolAttachments`, `normalizeNetworkToolAttachment`, or the current-session UI raw attachment path.

### Verify

- [ ] Run:

```powershell
npx vitest run tests/unit/shared/toolArtifacts.test.ts
```

Expected output: all tests in `toolArtifacts.test.ts` pass, including the raw UI preservation assertion and the prompt/export redaction assertions.

- [ ] Commit:

```powershell
git add src/shared/toolArtifacts.ts tests/unit/shared/toolArtifacts.test.ts
git commit -m "fix: 脱敏完全访问附件共享文本"
```

## Task 5: Guard Follow-Up Context and Markdown Export

**Files:**

- `tests/unit/shared/chatRequestMessages.toolAttachments.test.ts`
- `tests/unit/side-panel/chatMarkdownExport.test.ts`

### Test First

- [ ] In `tests/unit/shared/chatRequestMessages.toolAttachments.test.ts`, add a follow-up context regression:

```ts
it("后续追问展开完全访问 Network 附件时只注入脱敏摘要", () => {
  const model = createModelConfig(createProvider(), createModel());
  const assistantMessage = createMessage({
    id: "message-full-access-tool-turn",
    assistantMessageKind: "tool_call_turn",
    content: "已读取原始请求。",
    toolAttachments: [
      {
        id: "attachment-full-access-network",
        kind: "network",
        title: "Network 请求详情",
        summary: "原始详情",
        sourceToolCallId: "call-full-access",
        createdAt: 2,
        redacted: false,
        fullAccess: true,
        truncated: false,
        requests: [
          {
            id: "req-1",
            url: "https://example.com/api?sign=raw-signature&nonce=raw-nonce",
            method: "POST",
            status: 200,
            requestBody: "{\"signature\":\"raw-body-sign\",\"password\":\"123456\"}",
            redacted: false,
            truncated: false,
          },
        ],
      },
    ],
  });
  const userMessage = createMessage({
    id: "message-user-follow-up",
    role: "user",
    content: "继续分析",
    createdAt: 4,
  });

  const result = buildChatRequestMessages({
    model,
    pageContext: "",
    existingMessages: [assistantMessage],
    userMessage,
  });

  const expandedAssistant = result.find((message) => message.id === "message-full-access-tool-turn");
  expect(expandedAssistant?.content).toContain("后续追问可参考以下历史 Network 请求摘要");
  expect(expandedAssistant?.content).toContain("[已脱敏]");
  expect(expandedAssistant?.content).not.toMatch(/raw-signature|raw-nonce|raw-body-sign|123456/);
});
```

- [ ] In `tests/unit/side-panel/chatMarkdownExport.test.ts`, add a markdown/clipboard regression using `toolAttachments` rather than `networkContextAttachment`:

```ts
it("导出和复制完全访问 Network 原始附件前会脱敏签名字段", () => {
  const message = createMessage({
    id: "message-full-access-network-export",
    role: "assistant",
    content: "签名实验完成：sign=raw-final-sign",
    toolAttachments: [
      {
        id: "tool-full-access-network",
        kind: "network",
        title: "Network 请求详情",
        summary: "原始详情 sign=raw-summary-sign",
        createdAt: 1700000000000,
        redacted: false,
        fullAccess: true,
        truncated: false,
        requests: [
          {
            id: "req-1",
            url: "https://example.com/api?sign=raw-url-sign&nonce=raw-url-nonce",
            method: "POST",
            requestBody: "{\"signature\":\"raw-body-sign\",\"nonce\":\"raw-body-nonce\"}",
            responseBody: "{\"sig\":\"raw-response-sig\"}",
            redacted: false,
            truncated: false,
          },
        ],
      },
    ],
    createdAt: 1700000000000,
  });
  const session = createSession({
    title: "签名实验",
    messages: [message],
  });

  const markdown = createChatSessionMarkdown(session, 1700000200000);
  const printHtml = createChatSessionPrintHtml(session, 1700000200000);
  const copied = createChatMessageMarkdown(message);

  for (const exportedText of [markdown, printHtml, copied]) {
    expect(exportedText).toContain("[已脱敏]");
    expect(exportedText).not.toMatch(/raw-final-sign|raw-summary-sign|raw-url-sign|raw-url-nonce|raw-body-sign|raw-body-nonce|raw-response-sig/);
  }
});
```

### Expected Failure

- [ ] Run before Task 4 implementation if this task is executed independently:

```powershell
npx vitest run tests/unit/shared/chatRequestMessages.toolAttachments.test.ts tests/unit/side-panel/chatMarkdownExport.test.ts
```

Expected output: the follow-up context test fails while Full Access Network summaries still preserve raw URL values. The markdown test fails until both the formatter redaction and generic signature-field redaction are in place.

### Implementation

- [ ] No production-code change should be required beyond Tasks 3 and 4.
- [ ] If these tests fail after Tasks 3 and 4, inspect only the call path that failed:
  - `src/shared/chat/buildChatRequestMessages.ts` and `src/shared/chat/contextCompression.ts` should both rely on `formatToolAttachmentForPromptSummary`.
  - `src/side-panel/utils/chatMarkdownExport.ts` should rely on `formatToolAttachmentForExport` and `redactSensitiveText`.

### Verify

- [ ] Run:

```powershell
npx vitest run tests/unit/shared/chatRequestMessages.toolAttachments.test.ts tests/unit/side-panel/chatMarkdownExport.test.ts
```

Expected output: both files pass.

- [ ] Commit:

```powershell
git add tests/unit/shared/chatRequestMessages.toolAttachments.test.ts tests/unit/side-panel/chatMarkdownExport.test.ts
git commit -m "test: 验证完全访问上下文导出脱敏"
```

## Task 6: Classify Signature Lab Workflow Artifacts as Debug Reports

**Files:**

- `src/side-panel/state/appStoreWorkflowTasks.ts`
- `tests/unit/side-panel/appStoreWorkflowTasks.test.ts`

### Test First

- [ ] Add this test near `从最终助手消息按模板创建脱敏产物`:

```ts
it("签名实验工作流会生成脱敏调试报告产物", () => {
  const task = createWorkflowTaskFixture({
    template: "debug",
    contextItems: [{
      id: "context-network",
      kind: "network",
      title: "Network 摘要",
      summary: "sign=[已脱敏]",
      capturedAt: 1,
      redacted: true,
      truncated: false,
      sensitive: false,
    }],
    steps: [{
      id: "step-signature",
      title: "Full Access 签名实验室 full_access.fetch",
      status: "completed",
      updatedAt: 2,
    }],
  });

  const artifact = createWorkflowArtifactFromAssistantMessage(
    task,
    createAssistantMessage("sign=raw-workflow-sign\nnonce=raw-workflow-nonce\nAuthorization: Bearer raw-workflow-token"),
    30,
  );

  expect(artifact).toMatchObject({
    kind: "debug-report",
    title: "调试报告",
    contextItemIds: ["context-network"],
    createdAt: 30,
  });
  expect(artifact?.content).toContain("[已脱敏]");
  expect(artifact?.content).not.toMatch(/raw-workflow-sign|raw-workflow-nonce|raw-workflow-token/);
});
```

### Expected Failure

- [ ] Run:

```powershell
npx vitest run tests/unit/side-panel/appStoreWorkflowTasks.test.ts
```

Expected output: the new test fails if `sign`/`nonce` are not recognized by `redactSensitiveText`, or if the completed signature step is not classified as a debug report.

### Implementation

- [ ] Extend `DEBUG_STEP_KEYWORDS` in `src/side-panel/state/appStoreWorkflowTasks.ts`:

```ts
"signature", "sign", "sig", "nonce", "crypto", "encrypt", "hash",
"签名", "加签", "验签", "加密",
```

- [ ] Do not change `cleanArtifactContent` except through Task 3's `redactSensitiveText` update. The existing `cleanArtifactContent` path should redact the final assistant content and remove data URLs.

### Verify

- [ ] Run:

```powershell
npx vitest run tests/unit/side-panel/appStoreWorkflowTasks.test.ts
```

Expected output: all tests in `appStoreWorkflowTasks.test.ts` pass.

- [ ] Commit:

```powershell
git add src/side-panel/state/appStoreWorkflowTasks.ts tests/unit/side-panel/appStoreWorkflowTasks.test.ts
git commit -m "fix: 保护签名实验工作流产物"
```

## Task 7: Final Verification

**Commands:**

- [ ] Run targeted tests:

```powershell
npx vitest run tests/unit/shared/automationPlaybooks.test.ts tests/unit/background/backgroundToolRuntime.test.ts tests/unit/shared/networkContext.test.ts tests/unit/shared/redaction.test.ts tests/unit/shared/toolArtifacts.test.ts tests/unit/shared/chatRequestMessages.toolAttachments.test.ts tests/unit/side-panel/chatMarkdownExport.test.ts tests/unit/side-panel/appStoreWorkflowTasks.test.ts
```

Expected output: all targeted Vitest files pass.

- [ ] Run typecheck:

```powershell
npm run typecheck
```

Expected output: `tsc --noEmit` completes with exit code 0.

- [ ] Run legacy tests to prove the `.mjs` automation registry remains unchanged:

```powershell
npm run test:legacy
```

Expected output: `automation playbooks tests passed` appears and the command exits with code 0.

- [ ] Run extension build:

```powershell
npm run build:extension
```

Expected output: Vite completes the production build with exit code 0.

- [ ] If time allows, run the full Vitest suite:

```powershell
npm test
```

Expected output: all Vitest tests pass.

- [ ] Commit any final verification-only test adjustments with a Chinese message that describes the actual change.

## Self-Review Checklist

- [ ] Playbook prompt does not claim Full Access can bypass browser, CSP, extension, or site-side limits.
- [ ] Playbook prompt tells the model to record reproducible evidence, not just final guesses.
- [ ] Existing Full Access executor behavior remains raw for current-session tool results and UI attachments.
- [ ] No default follow-up, export, clipboard, compression-budget, or workflow artifact path emits raw signature experiment values.
- [ ] Signature field redaction is name-based and keeps field names visible, so analysis can still say which fields changed without preserving exact values.
- [ ] No unrelated UI, content-script, legacy `.mjs`, or package metadata files changed.
