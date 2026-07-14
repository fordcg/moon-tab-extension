import { expect, test, type Page } from "@playwright/test";
import type { WorkflowTaskTemplate } from "../../src/shared/types";

type StreamMode = "success" | "disconnect-once";

interface WorkflowRuntimeScenario {
  assistantContent: string;
  attachmentKind: string;
  attachmentTitle: string;
  contextSummary: string;
  mode?: StreamMode;
  ordinaryContent?: string;
  toolId: string;
  toolLabel: string;
  toolSummary: string;
}

interface WorkflowTemplateCase {
  artifactText: string;
  objective: string;
  scenario: WorkflowRuntimeScenario;
  template: WorkflowTaskTemplate;
  templateLabel: string;
}

const DATABASE_NAME = "browser-ai-assistant";
const STORE_SCHEMA = {
  modelConfigs: { keyPath: "id", indexes: ["channelName", "endpointType", "updatedAt"] },
  modelProviders: { keyPath: "id", indexes: ["name", "endpointType", "updatedAt"] },
  providerModels: { keyPath: "id", indexes: ["providerId", "displayName", "updatedAt"] },
  extractionRules: { keyPath: "id", indexes: ["sortOrder", "urlPattern", "updatedAt"] },
  chatSessions: { keyPath: "id", indexes: ["folderId", "archived", "sortOrder", "updatedAt"] },
  chatFolders: { keyPath: "id", indexes: ["sortOrder", "updatedAt"] },
  appSettings: { keyPath: "key", indexes: ["updatedAt"] },
  promptTemplates: { keyPath: "id", indexes: ["sortOrder", "updatedAt"] },
} as const;

const TEMPLATE_CASES: WorkflowTemplateCase[] = [
  {
    template: "research",
    templateLabel: "网页研究",
    objective: "整理当前页面要点",
    artifactText: "页面要点结论",
    scenario: {
      toolId: "browser.extract_content",
      toolLabel: "提取页面内容",
      toolSummary: "已提取当前页面正文",
      attachmentKind: "web-search",
      attachmentTitle: "页面资料",
      contextSummary: "E2E 页面正文包含版本、权限和发布注意事项。",
      assistantContent: [
        "## 结论",
        "",
        "页面要点结论：版本说明已经整理完成。",
        "",
        "| 项目 | 状态 |",
        "| --- | --- |",
        "| 权限 | 已核对 |",
      ].join("\n"),
    },
  },
  {
    template: "debug",
    templateLabel: "开发调试",
    objective: "排查 Network 500 错误",
    artifactText: "调试报告结论",
    scenario: {
      toolId: "browser.get_network_requests",
      toolLabel: "Network 请求诊断",
      toolSummary: "已定位 500 请求",
      attachmentKind: "network",
      attachmentTitle: "Network 请求详情",
      contextSummary: "GET /api/report 返回 500，响应头已脱敏。",
      assistantContent: [
        "## 调试报告",
        "",
        "调试报告结论：/api/report 返回 500，需要补齐服务端参数校验。",
      ].join("\n"),
    },
  },
  {
    template: "automation",
    templateLabel: "网页自动化",
    objective: "点击提交并核验结果",
    artifactText: "自动化报告结论",
    scenario: {
      toolId: "browser.click",
      toolLabel: "click 提交按钮",
      toolSummary: "已点击提交按钮并读取结果",
      attachmentKind: "automation-report",
      attachmentTitle: "自动化执行报告",
      contextSummary: "提交按钮点击后出现成功提示，页面状态已核验。",
      assistantContent: [
        "## 自动化报告",
        "",
        "自动化报告结论：提交成功提示已经出现。",
      ].join("\n"),
    },
  },
];

test.describe("侧栏任务工作流", () => {
  for (const item of TEMPLATE_CASES) {
    test(`${item.templateLabel}任务可以完成并导出产物`, async ({ page }) => {
      await openSeededSidebar(page, item.scenario);

      await startWorkflowTask(page, item.objective, item.templateLabel);

      const taskCard = page.getByRole("article", { name: `任务：${item.objective}` });
      await expect(taskCard).toContainText(item.templateLabel);
      await expect(taskCard).toContainText("已完成");
      await expect(taskCard).toContainText(item.scenario.toolLabel);
      await expect(taskCard).toContainText(item.scenario.contextSummary);
      await expect(taskCard).toContainText(item.artifactText);
      await expect(taskCard.getByText("上下文 1")).toBeVisible();
      await expect(taskCard.getByRole("button", { name: "保存为技能" })).toBeVisible();

      const exportButton = taskCard.getByRole("button", { name: "导出任务 Markdown" });
      await expect(exportButton).toBeEnabled();
      const downloadPromise = page.waitForEvent("download");
      await exportButton.click();
      const download = await downloadPromise;
      expect(download.suggestedFilename()).toContain(item.objective);
    });
  }

  test("流式端口断开后任务明确失败，普通聊天仍可发送", async ({ page }) => {
    await openSeededSidebar(page, {
      mode: "disconnect-once",
      toolId: "browser.click",
      toolLabel: "click 登录按钮",
      toolSummary: "已准备点击登录按钮",
      attachmentKind: "automation-report",
      attachmentTitle: "自动化执行报告",
      contextSummary: "端口断开前采集到的页面状态。",
      assistantContent: "## 自动化报告\n\n自动化报告结论：恢复后可继续执行。",
      ordinaryContent: "普通回复：主聊天仍然可用。",
    });

    await startWorkflowTask(page, "提交表单时模拟调试器断开", "网页自动化");

    const taskCard = page.getByRole("article", { name: "任务：提交表单时模拟调试器断开" });
    await expect(taskCard).toContainText("失败");
    await expect(taskCard).toContainText("流式响应失败，请重试");
    await expect(taskCard.getByRole("textbox", { name: "继续任务：提交表单时模拟调试器断开" })).toHaveCount(0);
    await expect(taskCard.getByRole("button", { name: "取消任务" })).toHaveCount(0);

    const composer = page.getByRole("textbox", { name: "对话输入" });
    await composer.fill("普通消息");
    await page.getByRole("button", { name: "发送" }).click();

    await expect(page.getByLabel("消息列表")).toContainText("普通回复：主聊天仍然可用。");
    await expect(taskCard).toContainText("失败");
  });
});

async function openSeededSidebar(page: Page, scenario: WorkflowRuntimeScenario): Promise<void> {
  await installMockRuntime(page, scenario);
  await page.goto("/");
  await expect
    .poll(() =>
      page.evaluate(() => {
        const runtime = (globalThis as typeof globalThis & {
          chrome?: { runtime?: { connect?: unknown; sendMessage?: unknown } };
        }).chrome?.runtime;
        return typeof runtime?.connect === "function" && typeof runtime?.sendMessage === "function";
      }),
    )
    .toBe(true);
  await expect(page.getByRole("button", { name: "发送" })).toBeVisible();
  await seedSidebarStorage(page);
  await page.reload();
  await expect(page.getByRole("button", { name: "发送" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "新建任务" })).toBeDisabled();
  await expect(page.getByText("请先配置 API Key 后再开始对话")).not.toBeVisible();
}

async function startWorkflowTask(page: Page, objective: string, templateLabel: string): Promise<void> {
  const composer = page.getByRole("textbox", { name: "对话输入" });
  await composer.fill(objective);
  const newTaskButton = page.getByRole("button", { name: "新建任务" });
  await expect(newTaskButton).toBeEnabled();
  await newTaskButton.click();
  await page.getByRole("menuitem", { name: templateLabel }).click();
}

async function installMockRuntime(page: Page, scenario: WorkflowRuntimeScenario): Promise<void> {
  await page.addInitScript((input: WorkflowRuntimeScenario) => {
    type RuntimeListener = (message: unknown) => void;
    type Callback = (response: unknown) => void;

    const runtimeListeners = new Set<RuntimeListener>();
    let disconnectedOnce = false;
    let streamSequence = 0;

    const createRuntimeResponse = (message: unknown): unknown => {
      if (isRecord(message) && message.type === "pageContext.listTabs") {
        return {
          ok: true,
          tabs: [
            {
              tabId: 101,
              title: "E2E 页面",
              url: "https://example.test/workflow",
              active: true,
            },
          ],
        };
      }

      if (isRecord(message) && message.type === "pageContext.extract") {
        return {
          ok: true,
          url: "https://example.test/workflow",
          title: "E2E 页面",
          text: "E2E 页面正文，包含工作流测试材料。",
          truncated: false,
          usedFallback: false,
        };
      }

      if (isRecord(message) && message.type === "chat.send") {
        return {
          ok: true,
          content: input.ordinaryContent ?? "普通回复：主聊天仍然可用。",
        };
      }

      return { ok: true };
    };

    const emitRuntimeMessage = (message: unknown) => {
      for (const listener of runtimeListeners) {
        listener(message);
      }
    };

    const runtime = {
      lastError: undefined,
      onMessage: {
        addListener(listener: RuntimeListener) {
          runtimeListeners.add(listener);
        },
        removeListener(listener: RuntimeListener) {
          runtimeListeners.delete(listener);
        },
      },
      sendMessage(message: unknown, callback?: Callback) {
        const response = createRuntimeResponse(message);
        window.queueMicrotask(() => callback?.(response));
        return Promise.resolve(response);
      },
      connect(options?: { name?: string }) {
        return createFakePort(options?.name ?? "chat.stream");
      },
    };

    const createFakePort = (name: string) => {
      const messageListeners = new Set<RuntimeListener>();
      const disconnectListeners = new Set<() => void>();
      let disconnected = false;

      const emit = (message: unknown) => {
        if (disconnected) {
          return;
        }
        for (const listener of messageListeners) {
          listener(message);
        }
      };

      const disconnect = () => {
        if (disconnected) {
          return;
        }
        disconnected = true;
        for (const listener of disconnectListeners) {
          listener();
        }
      };

      return {
        name,
        onMessage: {
          addListener(listener: RuntimeListener) {
            messageListeners.add(listener);
          },
          removeListener(listener: RuntimeListener) {
            messageListeners.delete(listener);
          },
        },
        onDisconnect: {
          addListener(listener: () => void) {
            disconnectListeners.add(listener);
          },
          removeListener(listener: () => void) {
            disconnectListeners.delete(listener);
          },
        },
        postMessage(message: unknown) {
          if (!isStreamStartMessage(message)) {
            return;
          }

          const latestUserContent = getLatestUserContent(message.payload);
          window.setTimeout(() => {
            if (input.mode === "disconnect-once" && !disconnectedOnce) {
              disconnectedOnce = true;
              disconnect();
              return;
            }

            streamSequence += 1;
            const startedAt = Date.now();
            const recordId = `tool-${streamSequence}`;
            const runningRecord = {
              id: recordId,
              toolId: input.toolId,
              name: input.toolId,
              displayName: input.toolLabel,
              arguments: {},
              status: "running",
              startedAt,
            };
            const completedRecord = {
              ...runningRecord,
              status: "success",
              resultSummary: input.toolSummary,
              completedAt: Date.now(),
              attachmentIds: [`attachment-${streamSequence}`],
            };
            const attachment = {
              id: `attachment-${streamSequence}`,
              kind: input.attachmentKind,
              title: input.attachmentTitle,
              summary: input.contextSummary,
              sourceToolCallId: recordId,
              createdAt: Date.now(),
              redacted: true,
              truncated: false,
            };
            const content = latestUserContent.includes("普通消息")
              ? input.ordinaryContent ?? "普通回复：主聊天仍然可用。"
              : input.assistantContent;

            emit({ type: "tool:start", record: runningRecord });
            emit({ type: "tool:complete", record: completedRecord, attachments: [attachment] });
            emit({
              type: "complete",
              content,
              toolCallRecords: [completedRecord],
              toolAttachments: [attachment],
            });
          }, 20);
        },
        disconnect,
      };
    };

    const globalWithChrome = globalThis as typeof globalThis & { chrome?: Record<string, unknown> };
    const chromeHost = isRecord(globalWithChrome.chrome) ? globalWithChrome.chrome : {};
    Object.defineProperty(chromeHost, "runtime", {
      configurable: true,
      value: runtime,
      writable: true,
    });
    if (!isRecord(globalWithChrome.chrome)) {
      Object.defineProperty(globalThis, "chrome", {
        configurable: true,
        value: chromeHost,
        writable: true,
      });
    }

    Object.defineProperty(globalThis, "__workflowE2eEmitRuntimeMessage", {
      configurable: true,
      value: emitRuntimeMessage,
    });

    function isStreamStartMessage(value: unknown): value is { type: "chat.stream.start"; payload: unknown } {
      return isRecord(value) && value.type === "chat.stream.start" && "payload" in value;
    }

    function getLatestUserContent(payload: unknown): string {
      if (!isRecord(payload) || !Array.isArray(payload.messages)) {
        return "";
      }

      const messages = payload.messages.filter(isRecord);
      const latestUserMessage = [...messages].reverse().find((item) => item.role === "user");
      return typeof latestUserMessage?.content === "string" ? latestUserMessage.content : "";
    }

    function isRecord(value: unknown): value is Record<string, unknown> {
      return typeof value === "object" && value !== null;
    }
  }, scenario);
}

async function seedSidebarStorage(page: Page): Promise<void> {
  await page.evaluate(
    async ({ databaseName, schema }) => {
      type StoreDefinition = { keyPath: string; indexes: readonly string[] };
      type Schema = Record<string, StoreDefinition>;

      const openDatabase = () =>
        new Promise<IDBDatabase>((resolve, reject) => {
          const request = indexedDB.open(databaseName);
          request.onupgradeneeded = () => {
            const db = request.result;
            const transaction = request.transaction;
            for (const [storeName, definition] of Object.entries(schema as Schema)) {
              const store = db.objectStoreNames.contains(storeName)
                ? transaction?.objectStore(storeName)
                : db.createObjectStore(storeName, { keyPath: definition.keyPath });
              if (!store) {
                continue;
              }
              for (const indexName of definition.indexes) {
                if (!store.indexNames.contains(indexName)) {
                  store.createIndex(indexName, indexName);
                }
              }
            }
          };
          request.onerror = () => reject(request.error ?? new Error("IndexedDB open failed"));
          request.onsuccess = () => resolve(request.result);
        });

      const db = await openDatabase();
      await new Promise<void>((resolve, reject) => {
        const storeNames = Object.keys(schema);
        const tx = db.transaction(storeNames, "readwrite");
        tx.onerror = () => reject(tx.error ?? new Error("IndexedDB transaction failed"));
        tx.oncomplete = () => {
          db.close();
          resolve();
        };

        for (const storeName of storeNames) {
          tx.objectStore(storeName).clear();
        }

        const now = 1;
        tx.objectStore("modelProviders").put({
          id: "provider-e2e",
          name: "E2E OpenAI",
          endpointType: "openai_chat",
          endpointUrl: "https://e2e.invalid/v1/chat/completions",
          apiKey: "test-key",
          enabled: true,
          createdAt: now,
          updatedAt: now,
        });
        tx.objectStore("providerModels").put({
          id: "model-e2e",
          providerId: "provider-e2e",
          displayName: "E2E Model",
          modelId: "e2e-model",
          temperature: 0.2,
          maxTokens: 1024,
          systemPrompt: "你是测试助手",
          isTitleModel: false,
          supportsVision: false,
          enabled: true,
          createdAt: now,
          updatedAt: now,
        });
        tx.objectStore("chatSessions").put({
          id: "session-e2e",
          title: "E2E 会话",
          selectedModelId: "model-e2e",
          archived: false,
          sortOrder: now,
          createdAt: now,
          updatedAt: now,
          messages: [],
        });
        tx.objectStore("appSettings").put({
          key: "defaultChatModelId",
          value: "model-e2e",
          updatedAt: now,
        });
        tx.objectStore("appSettings").put({
          key: "chatPreferences",
          value: {
            toolCallingEnabled: false,
            enabledToolIds: [],
            injectPageContextByDefault: true,
            extractHtmlByDefault: false,
            sendShortcut: "enter",
            followUpBehavior: "queue",
          },
          updatedAt: now,
        });
      });
    },
    {
      databaseName: DATABASE_NAME,
      schema: STORE_SCHEMA,
    },
  );
}
