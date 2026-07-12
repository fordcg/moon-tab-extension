import json
import shutil
import sys
import tempfile
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from playwright.sync_api import Error, TimeoutError, sync_playwright

ROOT = Path(__file__).resolve().parent.parent
DIST_DIR = ROOT / "dist"
EXTENSION_PATH = str(DIST_DIR)
OUT_DIR = ROOT / ".tmp"
OUT_DIR.mkdir(exist_ok=True)
MCP_SERVER_ID = "dev"
MCP_SERVER_NAME = "Smoke MCP"
BRIDGE_TOOL_ID = "dev.echo"
MCP_TOOL_ID = "mcp.dev.dev.echo"
MCP_TOOL_NAME = "mcp_dev_dev_echo"
MCP_TOOL_SCHEMA = {
    "type": "object",
    "required": ["text"],
    "properties": {"text": {"type": "string"}},
    "additionalProperties": False,
}

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass


class FakeMcpBridgeHandler(BaseHTTPRequestHandler):
    calls = []

    def log_message(self, *args):  # noqa: ANN002 - http.server callback signature.
        return

    def do_GET(self):  # noqa: N802 - http.server callback name.
        if self.path.rstrip("/") != "/tools/list":
            self.write_json({"message": "not found"}, status=404)
            return
        self.write_json(
            {
                "tools": [
                    {
                        "id": BRIDGE_TOOL_ID,
                        "name": BRIDGE_TOOL_ID,
                        "description": "Echo through local MCP bridge",
                        "inputSchema": MCP_TOOL_SCHEMA,
                    },
                ],
            },
        )

    def do_POST(self):  # noqa: N802 - http.server callback name.
        if self.path.rstrip("/") != "/tools/call":
            self.write_json({"message": "not found"}, status=404)
            return
        length = int(self.headers.get("content-length", "0") or 0)
        payload = json.loads(self.rfile.read(length).decode("utf-8") or "{}")
        self.calls.append(payload)
        self.write_json(
            {
                "ok": True,
                "content": f"MCP Echo: {payload.get('input', {}).get('text', '')}",
            },
        )

    def write_json(self, payload, status=200):
        raw = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)


class FakeOpenAiHandler(BaseHTTPRequestHandler):
    calls = []

    def log_message(self, *args):  # noqa: ANN002 - http.server callback signature.
        return

    def do_POST(self):  # noqa: N802 - http.server callback name.
        length = int(self.headers.get("content-length", "0") or 0)
        body = json.loads(self.rfile.read(length).decode("utf-8") or "{}")
        self.calls.append(body)

        messages = body.get("messages") if isinstance(body, dict) else []
        messages = messages if isinstance(messages, list) else []
        has_mcp_result = any(
            isinstance(item, dict)
            and item.get("role") == "tool"
            and item.get("name") == MCP_TOOL_NAME
            for item in messages
        )

        if has_mcp_result:
            response = {
                "choices": [
                    {
                        "message": {
                            "role": "assistant",
                            "content": "MCP 工具已执行。",
                        },
                    },
                ],
            }
        else:
            response = {
                "choices": [
                    {
                        "message": {
                            "role": "assistant",
                            "content": "",
                            "tool_calls": [
                                {
                                    "id": "call_mcp_echo",
                                    "type": "function",
                                    "function": {
                                        "name": MCP_TOOL_NAME,
                                        "arguments": json.dumps(
                                            {
                                                "text": "hello from chat",
                                                "apiKey": "sk-should-be-redacted",
                                                "password": "pw-should-be-redacted",
                                            },
                                        ),
                                    },
                                },
                            ],
                        },
                    },
                ],
            }

        raw = json.dumps(response, ensure_ascii=False).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)


def add_check(result, name, ok, actual=None, expected=None):
    entry = {"name": name, "ok": bool(ok)}
    if actual is not None:
        entry["actual"] = actual
    if expected is not None:
        entry["expected"] = expected
    result["checks"].append(entry)
    if not ok:
        result.setdefault("failed_checks", []).append(name)


def flatten_tool_records(chat_result):
    records = []
    for message in chat_result.get("toolTurnMessages") or []:
        records.extend(message.get("toolCallRecords") or [])
    return records


def main():
    if not (DIST_DIR / "manifest.json").exists():
        raise FileNotFoundError("缺少 dist/manifest.json，请先运行 npm run build:extension")

    result = {
        "ok": False,
        "extension_id": "",
        "checks": [],
        "model_request_count": 0,
        "mcp_call_count": 0,
    }
    user_data_dir = tempfile.mkdtemp(prefix="ai-sidebar-mcp-loop-")
    mcp_server = None
    model_server = None
    FakeMcpBridgeHandler.calls = []
    FakeOpenAiHandler.calls = []

    try:
        mcp_server = ThreadingHTTPServer(("127.0.0.1", 0), FakeMcpBridgeHandler)
        model_server = ThreadingHTTPServer(("127.0.0.1", 0), FakeOpenAiHandler)
        threading.Thread(target=mcp_server.serve_forever, daemon=True).start()
        threading.Thread(target=model_server.serve_forever, daemon=True).start()
        mcp_url = f"http://127.0.0.1:{mcp_server.server_port}/"
        model_url = f"http://127.0.0.1:{model_server.server_port}/v1/chat/completions"

        with sync_playwright() as playwright:
            launch_kwargs = {
                "user_data_dir": user_data_dir,
                "headless": True,
                "viewport": {"width": 412, "height": 900},
                "args": [
                    f"--disable-extensions-except={EXTENSION_PATH}",
                    f"--load-extension={EXTENSION_PATH}",
                ],
            }
            try:
                context = playwright.chromium.launch_persistent_context(channel="chromium", **launch_kwargs)
            except Error:
                context = playwright.chromium.launch_persistent_context(**launch_kwargs)

            try:
                service_worker = context.service_workers[0] if context.service_workers else context.wait_for_event("serviceworker", timeout=15000)
                extension_id = service_worker.url.split("/")[2]
                result["extension_id"] = extension_id
                add_check(result, "extension service worker is available", bool(extension_id), actual=service_worker.url)

                page = context.new_page()
                page.goto(f"chrome-extension://{extension_id}/index.html", wait_until="domcontentloaded")
                page.wait_for_selector(".app-shell", timeout=15000)

                response = page.evaluate(
                    """async ({ mcpUrl, modelUrl }) => {
                        const mcpServer = {
                            id: "dev",
                            name: "Smoke MCP",
                            endpointUrl: mcpUrl,
                            enabled: true,
                            tools: [],
                        };
                        const discoveredTool = {
                            name: "dev.echo",
                            description: "Echo through local MCP bridge",
                            inputSchema: {
                                type: "object",
                                required: ["text"],
                                properties: { text: { type: "string" } },
                                additionalProperties: false,
                            },
                        };
                        const configured = await chrome.runtime.sendMessage({
                            type: "agentTools.configureMcp",
                            mcp: {
                                servers: [mcpServer],
                            },
                        });
                        await chrome.runtime.sendMessage({ type: "agentTools.clearAuditLog" });
                        const refreshed = await chrome.runtime.sendMessage({
                            type: "agentTools.refreshMcp",
                            serverId: "dev",
                        });
                        const listed = await chrome.runtime.sendMessage({
                            type: "agentTools.getStatus",
                        });
                        const directCall = await chrome.runtime.sendMessage({
                            type: "agentTools.call",
                            toolId: "mcp.dev.dev.echo",
                            input: {
                                text: "hello direct",
                                apiKey: "sk-direct-should-be-redacted",
                                password: "pw-direct-should-be-redacted",
                            },
                        });
                        const now = Date.now();
                        const chat = await chrome.runtime.sendMessage({
                            type: "chat.send",
                            model: {
                                id: "fake-model",
                                displayName: "Fake Model",
                                name: "Fake Model",
                                modelId: "fake-model",
                                endpointType: "openai_chat",
                                endpointUrl: modelUrl,
                                apiKey: "fake-key",
                                temperature: 0,
                                maxTokens: 512,
                            },
                            messages: [{
                                id: "user-1",
                                role: "user",
                                content: "调用 MCP echo 工具",
                                createdAt: now,
                                modelId: "fake-model",
                                endpointType: "openai_chat",
                                contextMode: "text",
                                streamMode: false,
                                systemPrompt: "",
                                contextPrompt: "",
                            }],
                            enabledToolIds: ["mcp.dev.dev.echo"],
                            mcp: {
                                servers: [{
                                    ...mcpServer,
                                    tools: [discoveredTool],
                                }],
                            },
                            toolChoice: "auto",
                            structuredOutput: false,
                            stream: false,
                            retryCount: 0,
                        });
                        const audit = await chrome.runtime.sendMessage({ type: "agentTools.getAuditLog" });
                        return { configured, refreshed, listed, directCall, chat, audit };
                    }""",
                    {"mcpUrl": mcp_url, "modelUrl": model_url},
                )

                result["mcpBridgeToolLoop"] = response
                result["model_request_count"] = len(FakeOpenAiHandler.calls)
                result["mcp_call_count"] = len(FakeMcpBridgeHandler.calls)

                listed_tools = response.get("listed", {}).get("mcp", {}).get("tools", [])
                chat = response.get("chat") or {}
                records = flatten_tool_records(chat)
                mcp_record = next((item for item in records if item.get("name") == MCP_TOOL_NAME), {})
                audit_log = response.get("audit", {}).get("auditLog", [])
                mcp_audit = next((
                    item for item in audit_log
                    if (item.get("tool") or {}).get("name") == MCP_TOOL_NAME
                    or (item.get("toolCall") or {}).get("name") == MCP_TOOL_NAME
                    or item.get("name") == MCP_TOOL_NAME
                ), {})

                add_check(
                    result,
                    "mcp bridge status exposes sanitized chat tool",
                    any(item.get("id") == MCP_TOOL_ID and item.get("name") == MCP_TOOL_NAME for item in listed_tools),
                    actual=listed_tools,
                    expected=f"{MCP_TOOL_ID} is listed as {MCP_TOOL_NAME}",
                )
                add_check(
                    result,
                    "direct MCP tool call writes redacted audit log",
                    bool(
                        response.get("directCall", {}).get("ok")
                        and mcp_audit
                        and mcp_audit.get("status") == "success"
                        and mcp_audit.get("arguments", {}).get("apiKey") == "[已脱敏]"
                        and mcp_audit.get("arguments", {}).get("password") == "[已脱敏]"
                    ),
                    actual={"directCall": response.get("directCall"), "audit": mcp_audit},
                    expected=f"agentTools.call succeeds and audit log contains redacted {MCP_TOOL_NAME}",
                )
                add_check(
                    result,
                    "fake model can call MCP tool through chat loop",
                    bool(chat.get("ok") and mcp_record.get("status") == "success"),
                    actual=mcp_record,
                    expected="chat.send returns a successful MCP tool record",
                )
                add_check(
                    result,
                    "mcp chat tool record arguments are redacted",
                    bool(
                        mcp_record
                        and mcp_record.get("arguments", {}).get("apiKey") == "[已脱敏]"
                        and mcp_record.get("arguments", {}).get("password") == "[已脱敏]"
                    ),
                    actual=mcp_record.get("arguments") if mcp_record else {},
                    expected="chat toolCallRecords arguments redact apiKey/password",
                )
                add_check(
                    result,
                    "mcp bridge receives direct and chat tool calls",
                    len(FakeMcpBridgeHandler.calls) == 2,
                    actual=FakeMcpBridgeHandler.calls,
                    expected=f"two POST /tools/call requests with toolId {BRIDGE_TOOL_ID}",
                )
            finally:
                context.close()
    except TimeoutError as error:
        result["failed_checks"] = result.get("failed_checks", []) + ["timeout while verifying mcp bridge tool loop"]
        result["error"] = str(error)
    except Exception as error:  # noqa: BLE001 - verifier should report any unexpected failure as JSON.
        result["failed_checks"] = result.get("failed_checks", []) + ["unexpected mcp bridge verifier failure"]
        result["error"] = str(error)
    finally:
        if mcp_server is not None:
            mcp_server.shutdown()
        if model_server is not None:
            model_server.shutdown()
        shutil.rmtree(user_data_dir, ignore_errors=True)

    result["ok"] = not result.get("failed_checks")
    output_path = OUT_DIR / "verify-mcp-bridge-tool-loop-results.json"
    output_path.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
