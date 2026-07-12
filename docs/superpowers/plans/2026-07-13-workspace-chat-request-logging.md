# Workspace Chat Request Logging Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When `workspaceRequestLoggingEnabled` is on, write full AI side-panel request timelines (sidebar mode/tools, prompt messages, model responses, tool/MCP steps) into the current workspace via a local HTTP sink at `.tmp/chat-request-logs/`.

**Architecture:** Side panel sends a logging flag + sidebar state snapshot with `chat.send`. Background emits lifecycle events through a localhost HTTP client (replacing `chrome.downloads` request-log files). `scripts/model_diagnostics_sink.mjs` receives events, merges by `requestId`, and writes JSON/Markdown/NDJSON under `.tmp/chat-request-logs/`. Logging failures never fail chat.

**Tech Stack:** TypeScript MV3 extension, Vitest, Node http sink (`scripts/model_diagnostics_sink.mjs`), `fetch` to `127.0.0.1:17334`.

**Spec:** `docs/superpowers/specs/2026-07-13-workspace-chat-request-logging-design.md`

## Global Constraints

- Default off: `workspaceRequestLoggingEnabled: false`
- Full logs only when switch is on
- Never log API keys / Authorization / MCP bearer / cookies
- POST only to `127.0.0.1` / `localhost`
- Do not write complete logs to `%USERPROFILE%\Downloads\moon-tab\...`
- Sink down must not break chat
- Include mode, tool inventory, full prompt messages, model answer, tool/MCP process

## File Map

| File | Responsibility |
|------|----------------|
| `src/shared/types.ts` | Add preference field + optional chat.send logging payload types if shared |
| `src/side-panel/state/appStorePreferences.ts` | Default + normalize preference |
| `src/side-panel/components/settings/ChatPreferenceSettings.tsx` | Toggle UI |
| `src/side-panel/state/appStore.ts` | Pass logging flag + sidebar snapshot on `chat.send` |
| `src/background/chatRequestLogFile.ts` | Replace downloads writer with HTTP event client + redaction helpers |
| `src/background/modelRequestHandler.ts` | Emit session/model events; accept logging config |
| `src/background/toolCalling/toolLoop.ts` | Already has tool callbacks; wire logging from handler |
| `src/background/backgroundToolRuntime.ts` / MCP path | Emit MCP events where MCP tools execute (if not covered by tool callbacks) |
| `scripts/model_diagnostics_sink.mjs` | `/chat-request-logs` routes + workspace file writers |
| `scripts/test_model_diagnostics_sink.mjs` | Sink tests for chat request logs |
| `tests/unit/background/chatMessageHandler.test.ts` | Replace downloads assertions with HTTP client mocks |
| `tests/unit/side-panel/appStore.test.ts` / preferences tests | Preference normalize + send payload |

---

### Task 1: Preference Field + Normalize

**Files:**
- Modify: `src/shared/types.ts` (`ChatPreferenceValues`)
- Modify: `src/side-panel/state/appStorePreferences.ts`
- Test: `tests/unit/side-panel/appStorePreferences.test.ts` (create if missing) or extend existing preferences coverage in `tests/unit/side-panel/appStore.test.ts`

**Interfaces:**
- Produces: `ChatPreferenceValues.workspaceRequestLoggingEnabled: boolean`
- Produces: default `false` via `createDefaultChatPreferences()` / `normalizeChatPreferences()`

- [ ] **Step 1: Write the failing test**

Add to a preferences unit test file (create `tests/unit/side-panel/appStorePreferences.test.ts` if none exists):

```ts
import { describe, expect, it } from "vitest";
import { createDefaultChatPreferences, normalizeChatPreferences } from "../../../src/side-panel/state/appStorePreferences";

describe("workspaceRequestLoggingEnabled", () => {
  it("defaults to false", () => {
    expect(createDefaultChatPreferences().workspaceRequestLoggingEnabled).toBe(false);
    expect(normalizeChatPreferences(undefined).workspaceRequestLoggingEnabled).toBe(false);
  });

  it("normalizes truthy values", () => {
    expect(normalizeChatPreferences({ workspaceRequestLoggingEnabled: true }).workspaceRequestLoggingEnabled).toBe(true);
    expect(normalizeChatPreferences({ workspaceRequestLoggingEnabled: false }).workspaceRequestLoggingEnabled).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/side-panel/appStorePreferences.test.ts`

Expected: FAIL — property missing / type error / undefined

- [ ] **Step 3: Minimal implementation**

In `src/shared/types.ts` inside `ChatPreferenceValues`:

```ts
workspaceRequestLoggingEnabled: boolean;
```

In `src/side-panel/state/appStorePreferences.ts`:

```ts
// createDefaultChatPreferences
workspaceRequestLoggingEnabled: false,

// normalizeChatPreferences
workspaceRequestLoggingEnabled: normalizeBoolean(
  value?.workspaceRequestLoggingEnabled,
  defaults.workspaceRequestLoggingEnabled,
),
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/side-panel/appStorePreferences.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/shared/types.ts src/side-panel/state/appStorePreferences.ts tests/unit/side-panel/appStorePreferences.test.ts
git commit -m "feat: add workspace request logging preference"
```

---

### Task 2: Settings Toggle UI

**Files:**
- Modify: `src/side-panel/components/settings/ChatPreferenceSettings.tsx`
- Test: extend `tests/unit/side-panel/App.test.tsx` only if settings rendering is already covered; otherwise skip UI test and rely on preference store tests

**Interfaces:**
- Consumes: `chatPreferences.workspaceRequestLoggingEnabled`
- Consumes: `updateChatPreferences({ workspaceRequestLoggingEnabled })`

- [ ] **Step 1: Add switch after tool-calling switches**

Place near “启用工具调用” / display mode switches:

```tsx
<label className="chat-preference-switch">
  <input
    className="chat-preference-switch-input"
    type="checkbox"
    checked={chatPreferences.workspaceRequestLoggingEnabled}
    onChange={(event) => void updateChatPreferences({ workspaceRequestLoggingEnabled: event.target.checked })}
  />
  <span className="chat-preference-switch-control" aria-hidden="true">
    <span className="chat-preference-switch-thumb" />
  </span>
  <span className="chat-preference-switch-label">工作区请求日志</span>
</label>
<p className="ui-muted text-xs">
  开启后，完整请求过程（侧栏状态、提示词上下文、模型回答、工具/MCP）写入本机日志服务
  （需先运行 npm run model-diagnostics；输出 .tmp/chat-request-logs/）。默认关闭，不记录 API Key。
</p>
```

- [ ] **Step 2: Typecheck/settings smoke**

Run: `npx tsc --noEmit`

Expected: no errors related to the new field

- [ ] **Step 3: Commit**

```bash
git add src/side-panel/components/settings/ChatPreferenceSettings.tsx
git commit -m "feat: add workspace request logging settings toggle"
```

---

### Task 3: HTTP Log Client (Replace Downloads Writer)

**Files:**
- Rewrite: `src/background/chatRequestLogFile.ts`
- Create: `tests/unit/background/chatRequestLogFile.test.ts`

**Interfaces:**
- Produces:
  - `CHAT_REQUEST_LOG_ENDPOINT = "http://127.0.0.1:17334/chat-request-logs"`
  - `export type ChatRequestLogEventType = "session_start" | "model_request" | "model_response" | "tool_call_start" | "tool_call_complete" | "mcp_call" | "mcp_result" | "session_end"`
  - `export interface ChatRequestLogEvent { schemaVersion: 1; requestId: string; type: ChatRequestLogEventType; at: number; atIso: string; source?: string; sessionId?: string; [key: string]: unknown }`
  - `export interface ChatRequestLogClient { enabled: boolean; requestId: string; emit(type: ChatRequestLogEventType, payload?: Record<string, unknown>): void }`
  - `export function createChatRequestLogClient(input: { enabled: boolean; requestId: string; source?: string; sessionId?: string; fetcher?: typeof fetch; endpoint?: string }): ChatRequestLogClient`
  - `export function redactForChatRequestLog<T>(value: T): T` (or unknown)
  - Remove `writeChatRequestLogFiles` downloads behavior (or keep as no-op deprecated not called)

- [ ] **Step 1: Write failing client tests**

```ts
import { describe, expect, it, vi } from "vitest";
import { createChatRequestLogClient, redactForChatRequestLog } from "../../../src/background/chatRequestLogFile";

describe("chatRequestLog client", () => {
  it("does not post when disabled", () => {
    const fetcher = vi.fn();
    const client = createChatRequestLogClient({ enabled: false, requestId: "r1", fetcher: fetcher as typeof fetch });
    client.emit("session_start", { mode: "normal_restricted" });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("posts redacted events to localhost endpoint when enabled", async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: true });
    const client = createChatRequestLogClient({
      enabled: true,
      requestId: "chat-1",
      source: "side_panel_chat",
      sessionId: "s1",
      fetcher: fetcher as typeof fetch,
      endpoint: "http://127.0.0.1:17334/chat-request-logs",
    });
    client.emit("model_request", {
      model: { id: "m1", apiKey: "sk-secret" },
      headers: { Authorization: "Bearer sk-secret" },
      messages: [{ role: "user", content: "hello" }],
    });
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalled());
    const [url, init] = fetcher.mock.calls[0];
    expect(url).toBe("http://127.0.0.1:17334/chat-request-logs");
    const body = JSON.parse(String((init as RequestInit).body));
    expect(body.requestId).toBe("chat-1");
    expect(body.type).toBe("model_request");
    expect(JSON.stringify(body)).not.toContain("sk-secret");
    expect(body.messages[0].content).toBe("hello");
  });

  it("swallows post failures", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const fetcher = vi.fn().mockRejectedValue(new Error("down"));
    const client = createChatRequestLogClient({ enabled: true, requestId: "chat-2", fetcher: fetcher as typeof fetch });
    expect(() => client.emit("session_end", { status: "error" })).not.toThrow();
    await vi.waitFor(() => expect(warn).toHaveBeenCalled());
  });

  it("redacts sensitive keys", () => {
    const redacted = redactForChatRequestLog({
      apiKey: "sk-1",
      token: "abc",
      nested: { authorization: "Bearer x", ok: true },
    }) as any;
    expect(redacted.apiKey).toBe("[已脱敏]");
    expect(redacted.token).toBe("[已脱敏]");
    expect(redacted.nested.authorization).toBe("[已脱敏]");
    expect(redacted.nested.ok).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests — expect FAIL**

Run: `npx vitest run tests/unit/background/chatRequestLogFile.test.ts`

- [ ] **Step 3: Implement client**

Rewrite `src/background/chatRequestLogFile.ts` roughly as:

```ts
export const CHAT_REQUEST_LOG_ENDPOINT = "http://127.0.0.1:17334/chat-request-logs";
const REDACTED = "[已脱敏]";
const SENSITIVE_KEY = /(?:token|secret|password|passwd|pwd|authorization|auth|api[_-]?key|session|jwt|credential|cookie|set-cookie|bearer)/i;

export type ChatRequestLogEventType =
  | "session_start"
  | "model_request"
  | "model_response"
  | "tool_call_start"
  | "tool_call_complete"
  | "mcp_call"
  | "mcp_result"
  | "session_end";

export interface ChatRequestLogClient {
  enabled: boolean;
  requestId: string;
  emit(type: ChatRequestLogEventType, payload?: Record<string, unknown>): void;
}

export function createChatRequestLogClient(input: {
  enabled: boolean;
  requestId: string;
  source?: string;
  sessionId?: string;
  fetcher?: typeof fetch;
  endpoint?: string;
}): ChatRequestLogClient {
  const fetcher = input.fetcher ?? globalThis.fetch?.bind(globalThis);
  const endpoint = input.endpoint ?? CHAT_REQUEST_LOG_ENDPOINT;
  return {
    enabled: Boolean(input.enabled),
    requestId: input.requestId,
    emit(type, payload = {}) {
      if (!input.enabled || !fetcher) return;
      if (!isLocalEndpoint(endpoint)) {
        console.warn("[chat-send] 拒绝非本机请求日志端点", { endpoint });
        return;
      }
      const at = Date.now();
      const event = redactForChatRequestLog({
        schemaVersion: 1 as const,
        requestId: input.requestId,
        type,
        at,
        atIso: new Date(at).toISOString(),
        ...(input.source ? { source: input.source } : {}),
        ...(input.sessionId ? { sessionId: input.sessionId } : {}),
        ...payload,
      });
      void Promise.resolve()
        .then(() =>
          fetcher(endpoint, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(event),
          }),
        )
        .catch((error) => {
          console.warn("[chat-send] 写入工作区请求日志失败", {
            type,
            message: error instanceof Error ? error.message : String(error),
          });
        });
    },
  };
}

export function redactForChatRequestLog<T>(value: T, depth = 0): T {
  // deep clone with sensitive key replacement; truncate huge strings if needed
  // strip base64-looking image data fields to placeholders
  ...
}

function isLocalEndpoint(endpoint: string): boolean {
  try {
    const url = new URL(endpoint);
    return url.hostname === "127.0.0.1" || url.hostname === "localhost";
  } catch {
    return false;
  }
}
```

Delete downloads/`writeChatRequestLogFiles` usage. Keep filename for fewer import churn, or rename imports carefully in Task 4.

- [ ] **Step 4: Run client tests — PASS**

Run: `npx vitest run tests/unit/background/chatRequestLogFile.test.ts`

- [ ] **Step 5: Commit**

```bash
git add src/background/chatRequestLogFile.ts tests/unit/background/chatRequestLogFile.test.ts
git commit -m "feat: replace chat request downloads logger with localhost HTTP client"
```

---

### Task 4: Emit Session + Model Events in `modelRequestHandler`

**Files:**
- Modify: `src/background/modelRequestHandler.ts`
- Modify: `tests/unit/background/chatMessageHandler.test.ts`

**Interfaces:**
- Consumes: `createChatRequestLogClient`
- Extend `ChatSendMessage` with:
  ```ts
  workspaceRequestLoggingEnabled?: boolean;
  requestLogging?: {
    sidebarState?: Record<string, unknown>;
  };
  ```
- `logPreparedModelRequest` becomes event emission using full messages payload (not only counts)

- [ ] **Step 1: Update failing integration tests**

Replace the downloads-based test `"模型请求会自动生成可读取的请求日志文件"` with HTTP client assertions:

```ts
it("开关开启时会向本机日志服务发送 model_request 且不含密钥与正文敏感 key", async () => {
  const fetchMock = vi.fn()
    // first call(s) for model API
    .mockResolvedValueOnce({
      ok: true,
      json: vi.fn().mockResolvedValue({ choices: [{ message: { content: "AI 回复" } }] }),
    })
    // subsequent calls for log sink
    .mockResolvedValue({ ok: true });

  const result = await handleChatSendMessage(
    {
      type: "chat.send",
      model: createModel({ apiKey: "sk-sensitive" }),
      messages: [createMessage("user", "不要泄露")],
      stream: false,
      workspaceRequestLoggingEnabled: true,
      debugContext: {
        source: "side_panel_chat",
        requestId: "chat-debug-file-1",
        requestCreatedAt: 1783908184005,
        requestCreatedAtIso: "2026-07-13T02:03:04.005Z",
        sessionId: "session-debug-file",
      },
      requestLogging: {
        sidebarState: {
          mode: "full_access",
          enabledToolIds: ["system.current_time"],
          systemPrompt: "你是网页助手",
        },
      },
    } as any,
    fetchMock as any,
  );

  expect(result).toMatchObject({ ok: true });
  await vi.waitFor(() => {
    const logCalls = fetchMock.mock.calls.filter(([url]) => String(url).includes("/chat-request-logs"));
    expect(logCalls.length).toBeGreaterThan(0);
  });
  const bodies = fetchMock.mock.calls
    .filter(([url]) => String(url).includes("/chat-request-logs"))
    .map(([, init]) => JSON.parse(String((init as RequestInit).body)));
  expect(bodies.some((b) => b.type === "session_start")).toBe(true);
  expect(bodies.some((b) => b.type === "model_request")).toBe(true);
  expect(bodies.some((b) => b.type === "model_response" || b.type === "session_end")).toBe(true);
  expect(JSON.stringify(bodies)).not.toContain("sk-sensitive");
});

it("开关关闭时不发送工作区请求日志", async () => {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    json: vi.fn().mockResolvedValue({ choices: [{ message: { content: "AI 回复" } }] }),
  });
  await handleChatSendMessage(
    {
      type: "chat.send",
      model: createModel(),
      messages: [createMessage("user", "hi")],
      stream: false,
      workspaceRequestLoggingEnabled: false,
      debugContext: { source: "side_panel_chat", requestId: "off-1", requestCreatedAt: 1, requestCreatedAtIso: "x" },
    } as any,
    fetchMock as any,
  );
  expect(fetchMock.mock.calls.every(([url]) => !String(url).includes("/chat-request-logs"))).toBe(true);
});
```

Keep/adapt the existing console.debug test if still desired; it may still log metadata.

- [ ] **Step 2: Run tests — FAIL on missing fields/wiring**

Run: `npx vitest run tests/unit/background/chatMessageHandler.test.ts -t "工作区|请求日志|debug"`

- [ ] **Step 3: Implement handler wiring**

In `handleChatSendMessage`:

1. Resolve `requestId` from `message.debugContext?.requestId` or generate one.
2. Create client:
   ```ts
   const log = createChatRequestLogClient({
     enabled: Boolean(message.workspaceRequestLoggingEnabled),
     requestId,
     source: message.debugContext?.source,
     sessionId: message.debugContext?.sessionId,
   });
   ```
3. After computing `exposedTools` / `initialMessages` / automation selection, emit:
   ```ts
   log.emit("session_start", {
     debugContext: message.debugContext,
     sidebarState: message.requestLogging?.sidebarState,
     mode: message.requestLogging?.sidebarState?.mode,
     enabledToolIds: message.enabledToolIds ?? [],
     exposedToolIds: exposedToolIds,
     toolDefinitions: exposedTools.map((t) => ({
       id: t.id,
       name: t.name,
       displayName: t.displayName,
       description: t.description,
       runtime: t.runtime,
       risk: t.risk,
     })),
     mcp: summarizeMcpForLog(message.mcp), // servers + tool names, no tokens
     model: {
       id: message.model.id,
       modelId: message.model.modelId,
       displayName: message.model.displayName,
       channelName: message.model.channelName,
       endpointType: message.model.endpointType,
     },
     systemPrompt: extractSystemPrompt(initialMessages),
     privateMode: message.debugContext?.privateMode,
   });
   ```
4. In `requestModelOnce`, replace downloads snapshot write with:
   ```ts
   log?.emit("model_request", {
     tokenUsageSource: message.tokenUsageSource ?? "chat",
     stream: message.stream,
     retryCount,
     messages: message.messages,
     tools: message.tools,
     toolChoice: message.toolChoice,
     endpointType: message.model.endpointType,
     modelId: message.model.modelId,
   });
   ```
   On success emit `model_response` with content/thinking/toolCalls/tokenUsage; on failure emit error fields.
5. Thread `log` into tool loop callbacks:
   ```ts
   onToolCallStart: (record) => {
     log.emit("tool_call_start", { record });
     callbacks.onToolCallStart?.(record);
   },
   onToolCallComplete: (record, attachments) => {
     log.emit("tool_call_complete", { record, attachments: summarizeAttachments(attachments) });
     callbacks.onToolCallComplete?.(record, attachments);
   },
   ```
6. For MCP: if tool id/name indicates MCP (`parseMcpToolId` / runtime `mcp_remote`), also emit `mcp_call` / `mcp_result` from the same callbacks (payload includes serverId when parseable).
7. Finally emit `session_end` with status and summary.

Pass `log` into `requestModelOnce` via closure/options (cleanest: add optional `log?: ChatRequestLogClient` param to internal functions).

Remove `writeChatRequestLogFiles(snapshot)` call.

- [ ] **Step 4: Run handler tests — PASS**

Run: `npx vitest run tests/unit/background/chatMessageHandler.test.ts`

- [ ] **Step 5: Commit**

```bash
git add src/background/modelRequestHandler.ts tests/unit/background/chatMessageHandler.test.ts
git commit -m "feat: emit workspace chat request lifecycle log events"
```

---

### Task 5: Side Panel Sends Logging Flag + Sidebar State Snapshot

**Files:**
- Modify: `src/side-panel/state/appStore.ts` (`RunChatRequest` / `AppChatSendMessage` / `createChatSendDebugContext` area ~1871)
- Modify: `src/side-panel/state/appStoreTitleGeneration.ts` (optional: logging off for title, or pass enabled + source title_generation)
- Test: `tests/unit/side-panel/appStore.test.ts`

**Interfaces:**
- Produces on `chat.send`:
  ```ts
  workspaceRequestLoggingEnabled: boolean;
  requestLogging?: {
    sidebarState: {
      mode: BrowserAutomationMode;
      privateMode?: boolean;
      toolCallingEnabled: boolean;
      enabledToolIds: string[];
      toolCallDisplayMode: ToolCallDisplayMode;
      showToolCallProcessInAssistantMode: boolean;
      browserAutomationMaxToolIterations: number;
      followUpBehavior: FollowUpBehavior;
      systemPrompt: string;
      pageContext: {
        inject: boolean;
        extractMode?: string;
      };
      mcp: {
        servers: Array<{ id: string; enabled: boolean; toolCount?: number }>;
      };
      browserControlEnabled?: boolean;
      streamMode?: boolean;
    };
  };
  ```

- [ ] **Step 1: Write failing appStore test**

Assert that when preferences.workspaceRequestLoggingEnabled is true, the runtime message includes the flag and sidebarState.mode / enabledToolIds / systemPrompt.

(Mock `sendRuntimeMessage` / streaming helper already used by appStore tests.)

- [ ] **Step 2: Run — FAIL**

Run: `npx vitest run tests/unit/side-panel/appStore.test.ts -t "workspace|请求日志|logging"`

- [ ] **Step 3: Implement snapshot in request assembly**

Around request construction:

```ts
const loggingEnabled = Boolean(input.state.chatPreferences.workspaceRequestLoggingEnabled);
const request: AppChatSendMessage = {
  ...
  workspaceRequestLoggingEnabled: loggingEnabled,
  ...(loggingEnabled
    ? {
        requestLogging: {
          sidebarState: {
            mode: input.state.browserAutomationMode ?? input.state.chatPreferences.defaultBrowserAutomationMode ?? "normal_restricted",
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
  debugContext: createChatSendDebugContext(...),
};
```

Use actual property names present on `AppState` (verify `browserAutomationMode`, `mcpSettings.servers`, `contextMode` while implementing; adjust to real fields).

Title generation: keep `workspaceRequestLoggingEnabled: false` unless you intentionally want title requests logged; if preference is global true, still allow title logs with `source: "title_generation"` and minimal sidebarState.

- [ ] **Step 4: Run appStore tests — PASS**

Run: `npx vitest run tests/unit/side-panel/appStore.test.ts`

- [ ] **Step 5: Commit**

```bash
git add src/side-panel/state/appStore.ts src/side-panel/state/appStoreTitleGeneration.ts tests/unit/side-panel/appStore.test.ts
git commit -m "feat: pass workspace logging flag and sidebar state on chat.send"
```

---

### Task 6: Sink Server Writes `.tmp/chat-request-logs/`

**Files:**
- Modify: `scripts/model_diagnostics_sink.mjs`
- Modify: `scripts/test_model_diagnostics_sink.mjs`
- Optional package script already exists: `npm run model-diagnostics`

**Interfaces:**
- Produces paths:
  ```js
  export function chatRequestLogPaths(outputDir = resolve(PROJECT_ROOT, ".tmp/chat-request-logs")) {
    return {
      outputDir,
      latestJson: resolve(outputDir, "latest.json"),
      latestMd: resolve(outputDir, "latest.md"),
      eventsNdjson: resolve(outputDir, "events.ndjson"),
      historyDir: resolve(outputDir, "history"),
    };
  }
  ```
- Routes:
  - `POST /chat-request-logs` → append event, merge session, write files
  - `GET /chat-request-logs/latest` → latest JSON
  - keep existing `/model-diagnostics*` routes

- [ ] **Step 1: Write failing sink tests** in `scripts/test_model_diagnostics_sink.mjs`

```js
const chatDir = await mkdtemp(join(tmpdir(), "chat-request-logs-test-"));
const paths = chatRequestLogPaths(chatDir);
await handleChatRequestLogEvent({
  schemaVersion: 1,
  requestId: "chat-1",
  type: "session_start",
  at: 1,
  atIso: "2026-07-13T00:00:00.001Z",
  mode: "full_access",
  enabledToolIds: ["system.current_time"],
  systemPrompt: "你是网页助手",
}, { paths });
await handleChatRequestLogEvent({
  schemaVersion: 1,
  requestId: "chat-1",
  type: "model_request",
  at: 2,
  atIso: "2026-07-13T00:00:00.002Z",
  messages: [{ role: "user", content: "现在几点" }],
}, { paths });
await handleChatRequestLogEvent({
  schemaVersion: 1,
  requestId: "chat-1",
  type: "session_end",
  at: 3,
  atIso: "2026-07-13T00:00:00.003Z",
  status: "success",
}, { paths });

const latest = JSON.parse(await readFile(paths.latestJson, "utf8"));
assert.equal(latest.requestId, "chat-1");
assert.equal(latest.events.length, 3);
const md = await readFile(paths.latestMd, "utf8");
assert.match(md, /full_access|完全访问|mode/i);
assert.match(md, /现在几点/);
assert.equal((await readFile(paths.eventsNdjson, "utf8")).trim().split("\n").length, 3);
```

Also HTTP POST test against `createDiagnosticsServer` with temp chat paths.

- [ ] **Step 2: Run — FAIL**

Run: `node scripts/test_model_diagnostics_sink.mjs`

- [ ] **Step 3: Implement sink handlers**

Core logic:

```js
export async function handleChatRequestLogEvent(event, options = {}) {
  const paths = options.paths || chatRequestLogPaths(options.outputDir);
  await mkdir(paths.outputDir, { recursive: true });
  await mkdir(paths.historyDir, { recursive: true });
  const normalized = normalizeChatEvent(event, options.now ?? Date.now());
  await appendFile(paths.eventsNdjson, `${JSON.stringify(normalized)}\n`, "utf8");

  const sessionPath = resolve(paths.historyDir, `${sanitize(normalized.requestId)}.json`);
  const session = await readJsonObject(sessionPath, { requestId: normalized.requestId, events: [] });
  session.events = [...(session.events || []), normalized];
  session.updatedAt = normalized.at;
  // denormalize convenient fields from session_start / session_end
  if (normalized.type === "session_start") {
    session.sidebarState = normalized.sidebarState ?? session.sidebarState;
    session.mode = normalized.mode ?? normalized.sidebarState?.mode;
    session.systemPrompt = normalized.systemPrompt ?? normalized.sidebarState?.systemPrompt;
    session.exposedToolIds = normalized.exposedToolIds;
    session.enabledToolIds = normalized.enabledToolIds;
  }
  if (normalized.type === "session_end") {
    session.status = normalized.status;
  }
  await writeFile(sessionPath, `${JSON.stringify(session, null, 2)}\n`, "utf8");
  await writeFile(resolve(paths.historyDir, `${sanitize(normalized.requestId)}.md`), renderChatSessionMarkdown(session), "utf8");
  await writeFile(paths.latestJson, `${JSON.stringify(session, null, 2)}\n`, "utf8");
  await writeFile(paths.latestMd, renderChatSessionMarkdown(session), "utf8");
  return { requestId: session.requestId, eventCount: session.events.length };
}
```

`renderChatSessionMarkdown(session)` sections:
1. title + requestId/status
2. 侧栏状态 (mode, tools, mcp, systemPrompt)
3. 时间线 per event (model_request messages, tool calls, responses)

Wire routes inside `createDiagnosticsServer`.

- [ ] **Step 4: Run sink tests — PASS**

Run: `node scripts/test_model_diagnostics_sink.mjs`

- [ ] **Step 5: Commit**

```bash
git add scripts/model_diagnostics_sink.mjs scripts/test_model_diagnostics_sink.mjs
git commit -m "feat: write workspace chat request logs from local diagnostics sink"
```

---

### Task 7: Final Wiring Cleanup + Regression

**Files:**
- Modify any remaining imports of `writeChatRequestLogFiles`
- Ensure `public/manifest.json` does not require new permissions (host to 127.0.0.1 already covered by `<all_urls>` / existing host_permissions)
- Update `tests/unit/background/extensionBuildContract.test.ts` only if it asserts downloads log filenames
- Grep cleanup

- [ ] **Step 1: Grep leftovers**

Run:

```bash
rg "writeChatRequestLogFiles|moon-tab/request-logs|CHAT_REQUEST_LOG_LATEST" src tests scripts
```

Expected: no production downloads path left (tests for old behavior removed)

- [ ] **Step 2: Run focused regression suite**

```bash
npx vitest run tests/unit/background/chatRequestLogFile.test.ts tests/unit/background/chatMessageHandler.test.ts tests/unit/side-panel/appStorePreferences.test.ts tests/unit/side-panel/appStore.test.ts
node scripts/test_model_diagnostics_sink.mjs
npx tsc --noEmit
```

Expected: all pass

- [ ] **Step 3: Manual checklist (document in commit body if executed)**

1. `npm run model-diagnostics`
2. Load extension build
3. Settings → enable 工作区请求日志
4. Send a chat that uses a tool
5. Open `.tmp/chat-request-logs/latest.md`
6. Confirm mode, tools, messages, response, tool process present; no apiKey

- [ ] **Step 4: Commit**

```bash
git add -A src tests scripts docs/superpowers/plans/2026-07-13-workspace-chat-request-logging.md
git commit -m "test: finish workspace chat request logging regression coverage"
```

---

## Self-Review vs Spec

| Spec requirement | Task |
|------------------|------|
| Default-off preference | Task 1 |
| Settings toggle copy + path/service hint | Task 2 |
| Localhost HTTP client, no Downloads full logs | Task 3 |
| session/model/tool/mcp/session_end events | Task 4 |
| Sidebar mode + tools + systemPrompt snapshot | Task 5 |
| Full prompt messages in model_request | Task 4 |
| Sink writes `.tmp/chat-request-logs/` latest/history/md/ndjson | Task 6 |
| Redaction of secrets | Task 3 + 4 |
| Failure does not break chat | Task 3 |
| Tests for off/on + sink merge | Tasks 1,3,4,5,6,7 |

No TBD placeholders left in tasks. Names kept consistent: `workspaceRequestLoggingEnabled`, `createChatRequestLogClient`, `handleChatRequestLogEvent`, `chatRequestLogPaths`.
