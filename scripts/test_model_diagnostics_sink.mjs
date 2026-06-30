import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  createDiagnosticsServer,
  diagnosticsPaths,
  handleDiagnosticRecord,
  renderDiagnosticsMarkdown,
  resetDiagnostics,
  upsertDiagnosticsRecord,
} from "./model_diagnostics_sink.mjs";

const pending = {
  id: "call-1",
  kind: "model-call",
  status: "pending",
  startedAt: 1,
  request: {
    method: "POST",
    url: "https://api.example.test/v1/chat/completions",
    headers: { authorization: "[已脱敏]" },
    body: {
      model: "test-model",
      messages: [
        { role: "system", content: "你是测试助手" },
        { role: "user", content: "请读取页面上下文" },
      ],
      tools: [
        {
          type: "function",
          function: {
            name: "pageContext.extract",
            description: "提取当前页面内容",
            parameters: { type: "object", required: ["tabId"] },
          },
        },
      ],
    },
  },
  promptSummary: "2 条消息（system → user），工具 1 个",
};

const completed = {
  id: "call-1",
  status: "success",
  completedAt: 3,
  durationMs: 2,
  response: {
    status: 200,
    statusText: "OK",
    ok: true,
    body: {
      choices: [{ message: { role: "assistant", content: "页面上下文为空，需要检查注入。" } }],
    },
  },
  responseSummary: "页面上下文为空，需要检查注入。",
};

const merged = upsertDiagnosticsRecord(upsertDiagnosticsRecord([], pending), completed);
assert.equal(merged.length, 1);
assert.equal(merged[0].status, "success");
assert.equal(merged[0].request.body.model, "test-model");
assert.equal(merged[0].response.status, 200);

const markdown = renderDiagnosticsMarkdown(merged);
assert.match(markdown, /提示词 \/ messages/);
assert.match(markdown, /工具定义摘要/);
assert.match(markdown, /pageContext\.extract/);
assert.match(markdown, /页面上下文为空/);

const tempDir = await mkdtemp(join(tmpdir(), "model-diagnostics-test-"));
try {
  const paths = diagnosticsPaths(tempDir);
  await resetDiagnostics(paths);
  await handleDiagnosticRecord(pending, { paths, now: 10 });
  await handleDiagnosticRecord(completed, { paths, now: 20 });
  const json = JSON.parse(await readFile(paths.json, "utf8"));
  const readable = await readFile(paths.readable, "utf8");
  const ndjson = await readFile(paths.ndjson, "utf8");
  assert.equal(json.length, 1);
  assert.equal(json[0].status, "success");
  assert.match(readable, /完整请求体/);
  assert.equal(ndjson.trim().split("\n").length, 2);
} finally {
  await rm(tempDir, { recursive: true, force: true });
}

const serverTempDir = await mkdtemp(join(tmpdir(), "model-diagnostics-http-test-"));
try {
  const paths = diagnosticsPaths(serverTempDir);
  const { server } = createDiagnosticsServer({ host: "127.0.0.1", port: 0, paths });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  try {
    const address = server.address();
    const baseUrl = `http://127.0.0.1:${address.port}`;
    const postResponse = await fetch(`${baseUrl}/model-diagnostics`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(pending),
    });
    assert.equal(postResponse.status, 200);

    const getResponse = await fetch(`${baseUrl}/model-diagnostics`);
    assert.equal(getResponse.status, 200);
    const records = await getResponse.json();
    assert.equal(records.length, 1);
    assert.equal(records[0].id, "call-1");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
} finally {
  await rm(serverTempDir, { recursive: true, force: true });
}

console.log("model diagnostics sink tests passed");
