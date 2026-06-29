import assert from "node:assert/strict";
import { buildAiSearchPreview, createAiPreviewService } from "../src/pages/newtab/ai-preview-service.mjs";

const buildService = ({ fetchImpl } = {}) => {
  const originalFetch = globalThis.fetch;
  if (fetchImpl) {
    globalThis.fetch = fetchImpl;
  }

  const service = createAiPreviewService({
    deps: {
      ensureOriginPermission: async () => true,
      isChatCompletionsEndpoint: (endpoint) => /chat\/completions/i.test(endpoint),
      resolveChatCompletionsEndpoint: (endpoint) => endpoint,
      resolveOriginPatternSafely: () => "https://api.example.test/*",
    },
    config: {
      searchRequestTimeout: 1000,
      transientRetryDelays: [],
    },
  });

  return {
    service,
    restore: () => {
      globalThis.fetch = originalFetch;
    },
  };
};

const preview = buildAiSearchPreview({
  mode: "search",
  target: "AI skill marketplace",
  summary: "聚焦搜索 AI skill 资源。",
  intent: "资源查找",
  relatedQueries: ["AI skill examples", "AI skill marketplace", "AI skill tools"],
  websites: [
    { title: "Example", url: "https://example.com/skills", description: "查看示例。" },
    { title: "Example duplicate", url: "https://example.com/skills", description: "重复项应去重。" },
  ],
}, "ai skill");

assert.equal(preview.primaryAction.type, "search");
assert.equal(preview.secondaryAction?.type, "search");
assert.equal(preview.relatedQueries.includes("AI skill marketplace"), false);
assert.equal(preview.websites.length, 1);
assert.equal(preview.websites[0].host, "example.com");

const openPreview = buildAiSearchPreview({
  mode: "open",
  target: "https://github.com/",
  relatedQueries: [],
  websites: [],
}, "github.com");

assert.equal(openPreview.primaryAction.type, "open");
assert.equal(openPreview.targetLabel, "目标地址");

const chatPayload = {
  choices: [{
    message: {
      content: JSON.stringify({
        mode: "search",
        query: "AI 技能 网站 推荐",
        summary: "查找 AI skill 网站。",
        suggestions: ["AI skill examples", "AI skill tools", "AI skill marketplace"],
      }),
    },
  }],
};

const { service, restore } = buildService({
  fetchImpl: async () => ({
    ok: true,
    text: async () => JSON.stringify(chatPayload),
  }),
});

try {
  const decision = await service.requestAiSearchDecision("ai的skill网站", {
    endpoint: "https://api.example.test/v1/chat/completions",
    model: "test-model",
    apiKey: "",
  });

  assert.equal(decision.mode, "search");
  assert.equal(decision.target, "ai 的 skill 网站");
  assert.equal(decision.intent, "术语保留搜索");
  assert.deepEqual(decision.websites, []);
} finally {
  restore();
}

console.log("ai preview service tests passed");
