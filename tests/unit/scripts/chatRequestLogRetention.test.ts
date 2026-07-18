import { describe, expect, it } from "vitest";
import { mkdtemp, mkdir, readFile, writeFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cleanupChatRequestLogs, chatRequestLogPaths } from "../../../scripts/model_diagnostics_sink.mjs";

describe("chat request log retention", () => {
  it("removes history files older than 24h and prunes events.ndjson", async () => {
    const root = await mkdtemp(join(tmpdir(), "chat-log-retention-"));
    const paths = chatRequestLogPaths(root);
    await mkdir(paths.historyDir, { recursive: true });

    const now = Date.now();
    const oldAt = now - 25 * 60 * 60 * 1000;
    const freshAt = now - 1 * 60 * 60 * 1000;

    await writeFile(join(paths.historyDir, "old.json"), JSON.stringify({ requestId: "old", updatedAt: oldAt }), "utf8");
    await writeFile(join(paths.historyDir, "fresh.json"), JSON.stringify({ requestId: "fresh", updatedAt: freshAt }), "utf8");
    // Force old mtime via utimes if available; fallback: write then rely on cleanup using mtime after touch.
    const { utimes } = await import("node:fs/promises");
    await utimes(join(paths.historyDir, "old.json"), new Date(oldAt), new Date(oldAt));
    await utimes(join(paths.historyDir, "fresh.json"), new Date(freshAt), new Date(freshAt));

    await writeFile(
      paths.eventsNdjson,
      [
        JSON.stringify({ schemaVersion: 1, requestId: "old", type: "session_end", at: oldAt, atIso: new Date(oldAt).toISOString() }),
        JSON.stringify({ schemaVersion: 1, requestId: "fresh", type: "session_end", at: freshAt, atIso: new Date(freshAt).toISOString() }),
        "",
      ].join("\n"),
      "utf8",
    );

    const result = await cleanupChatRequestLogs(paths, {
      now,
      retentionMs: 24 * 60 * 60 * 1000,
    });

    expect(result.removedHistoryFiles).toBeGreaterThanOrEqual(1);
    await expect(stat(join(paths.historyDir, "old.json"))).rejects.toBeTruthy();
    await expect(stat(join(paths.historyDir, "fresh.json"))).resolves.toBeTruthy();

    const events = await readFile(paths.eventsNdjson, "utf8");
    expect(events).toContain("fresh");
    expect(events).not.toContain('"requestId":"old"');
  });
});
