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
    warn.mockRestore();
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
