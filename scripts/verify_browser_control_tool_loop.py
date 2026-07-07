import json
import re
import shutil
import sys
import tempfile
import threading
from http.server import BaseHTTPRequestHandler, SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from playwright.sync_api import Error, TimeoutError, sync_playwright

ROOT = Path(__file__).resolve().parent.parent
DIST_DIR = ROOT / "dist"
EXTENSION_PATH = str(DIST_DIR)
OUT_DIR = ROOT / ".tmp"
OUT_DIR.mkdir(exist_ok=True)

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass


class QuietStaticHandler(SimpleHTTPRequestHandler):
    def log_message(self, *args):  # noqa: ANN002 - http.server callback signature.
        return


class FakeOpenAiHandler(BaseHTTPRequestHandler):
    calls = []

    def log_message(self, *args):  # noqa: ANN002 - http.server callback signature.
        return

    def do_POST(self):  # noqa: N802 - http.server callback name.
        length = int(self.headers.get("content-length", "0") or 0)
        raw_body = self.rfile.read(length).decode("utf-8")
        try:
            body = json.loads(raw_body)
        except Exception:
            body = {}
        self.calls.append(body)

        messages = body.get("messages") if isinstance(body, dict) else []
        messages = messages if isinstance(messages, list) else []
        completed_tools = [
            item.get("name")
            for item in messages
            if isinstance(item, dict) and item.get("role") == "tool"
        ]

        if not completed_tools:
            response = self.make_tool_call(
                "call_network_idle",
                "wait_for_network_idle",
                {"idleMs": 200, "timeout": 3000},
            )
        elif "scroll_page" not in completed_tools:
            response = self.make_tool_call(
                "call_scroll",
                "scroll_page",
                {"direction": "down", "amount": 300},
            )
        elif "take_snapshot" not in completed_tools:
            response = self.make_tool_call("call_snapshot", "take_snapshot", {})
        elif "click" not in completed_tools:
            snapshot_text = "\n".join(
                str(item.get("content") or "")
                for item in messages
                if isinstance(item, dict) and item.get("role") == "tool"
            )
            match = re.search(r'uid=([^\s]+)\s+button\s+"可点击按钮"', snapshot_text)
            response = self.make_tool_call(
                "call_click",
                "click",
                {"uid": match.group(1) if match else "missing-button-uid", "includeSnapshot": True},
            )
        else:
            response = {
                "choices": [
                    {
                        "message": {
                            "role": "assistant",
                            "content": "已完成浏览器等待、滚动、快照和点击。",
                        },
                    },
                ],
            }

        raw_response = json.dumps(response, ensure_ascii=False).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(raw_response)))
        self.end_headers()
        self.wfile.write(raw_response)

    @staticmethod
    def make_tool_call(call_id, name, arguments):
        return {
            "choices": [
                {
                    "message": {
                        "role": "assistant",
                        "content": "",
                        "tool_calls": [
                            {
                                "id": call_id,
                                "type": "function",
                                "function": {
                                    "name": name,
                                    "arguments": json.dumps(arguments, ensure_ascii=False),
                                },
                            },
                        ],
                    },
                },
            ],
        }


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
        "target_url": "",
        "model_request_count": 0,
        "checks": [],
    }
    user_data_dir = tempfile.mkdtemp(prefix="ai-sidebar-tool-loop-")
    site_dir = Path(tempfile.mkdtemp(prefix="ai-sidebar-tool-loop-site-"))
    site_server = None
    model_server = None
    FakeOpenAiHandler.calls = []

    try:
        (site_dir / "index.html").write_text(
            "\n".join(
                [
                    "<!doctype html>",
                    '<meta charset="utf-8">',
                    "<title>BC Click Smoke</title>",
                    (
                        '<button id="primary-action" '
                        'onclick="document.body.dataset.clicked = \'yes\'; this.textContent = \'已点击按钮\';">'
                        "可点击按钮</button>"
                    ),
                    "<p>Hello Browser Control Click</p>",
                ],
            ),
            encoding="utf-8",
        )

        site_server = ThreadingHTTPServer(
            ("127.0.0.1", 0),
            lambda *args, **kwargs: QuietStaticHandler(*args, directory=str(site_dir), **kwargs),
        )
        model_server = ThreadingHTTPServer(("127.0.0.1", 0), FakeOpenAiHandler)
        threading.Thread(target=site_server.serve_forever, daemon=True).start()
        threading.Thread(target=model_server.serve_forever, daemon=True).start()

        target_url = f"http://127.0.0.1:{site_server.server_port}/index.html"
        model_url = f"http://127.0.0.1:{model_server.server_port}/v1/chat/completions"
        result["target_url"] = target_url

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

                target_page = context.new_page()
                target_page.goto(target_url, wait_until="domcontentloaded")
                target_page.wait_for_selector("#primary-action", timeout=10000)

                extension_page = context.new_page()
                extension_page.goto(f"chrome-extension://{extension_id}/index.html", wait_until="domcontentloaded")
                extension_page.wait_for_selector(".app-shell", timeout=15000)

                response = extension_page.evaluate(
                    """async ({ targetUrl, modelUrl }) => {
                        const [tab] = await chrome.tabs.query({ url: targetUrl });
                        if (!tab?.id) {
                            return { ok: false, stage: "query-tab", tabs: await chrome.tabs.query({}) };
                        }

                        const enable = await chrome.runtime.sendMessage({
                            type: "browserControl.setEnabled",
                            enabled: true,
                            tabId: tab.id,
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
                                content: "等待页面稳定，向下滚动，读取当前页面快照，然后点击可点击按钮",
                                createdAt: now,
                                modelId: "fake-model",
                                endpointType: "openai_chat",
                                contextMode: "text",
                                streamMode: false,
                                systemPrompt: "",
                                contextPrompt: "",
                            }],
                            enabledToolIds: [
                                "browser.wait_for_network_idle",
                                "browser.scroll_page",
                                "browser.take_snapshot",
                                "browser.click"
                            ],
                            toolChoice: "auto",
                            structuredOutput: false,
                            stream: false,
                            retryCount: 0,
                            browserAutomationMaxToolIterations: 5,
                        });

                        const disable = await chrome.runtime.sendMessage({
                            type: "browserControl.setEnabled",
                            enabled: false,
                            tabId: tab.id,
                        });

                        return { ok: true, tabId: tab.id, enable, chat, disable };
                    }""",
                    {"targetUrl": target_url, "modelUrl": model_url},
                )

                result["browserControlToolLoop"] = response
                result["model_request_count"] = len(FakeOpenAiHandler.calls)
                clicked_state = target_page.evaluate("document.body.dataset.clicked || ''")
                result["clicked_state"] = clicked_state

                chat = response.get("chat") or {}
                records = flatten_tool_records(chat)
                network_idle_record = next((item for item in records if item.get("name") == "wait_for_network_idle"), {})
                scroll_record = next((item for item in records if item.get("name") == "scroll_page"), {})
                snapshot_record = next((item for item in records if item.get("name") == "take_snapshot"), {})
                click_record = next((item for item in records if item.get("name") == "click"), {})

                add_check(
                    result,
                    "fake model can trigger wait_for_network_idle through chat tool loop",
                    bool(chat.get("ok") and network_idle_record.get("status") == "success"),
                    actual=network_idle_record,
                    expected="chat.send returns a successful wait_for_network_idle tool record",
                )
                add_check(
                    result,
                    "fake model can trigger scroll_page through chat tool loop",
                    bool(chat.get("ok") and scroll_record.get("status") == "success"),
                    actual=scroll_record,
                    expected="chat.send returns a successful scroll_page tool record",
                )
                add_check(
                    result,
                    "fake model can trigger take_snapshot through chat tool loop",
                    bool(chat.get("ok") and snapshot_record.get("status") == "success"),
                    actual=snapshot_record,
                    expected="chat.send returns a successful take_snapshot tool record",
                )
                add_check(
                    result,
                    "fake model can trigger click through chat tool loop",
                    bool(chat.get("ok") and click_record.get("status") == "success" and clicked_state == "yes"),
                    actual={"clickRecord": click_record, "clickedState": clicked_state},
                    expected="click tool succeeds and the target page DOM records the click",
                )
                add_check(
                    result,
                    "browser control tool loop detaches cleanly",
                    bool(response.get("disable", {}).get("ok") and response.get("disable", {}).get("attached") is False),
                    actual=response.get("disable"),
                    expected="runtime browserControl.setEnabled(false) returns ok=true and attached=false",
                )
                add_check(
                    result,
                    "tool loop used local fake model only",
                    len(FakeOpenAiHandler.calls) >= 5,
                    actual={"requestCount": len(FakeOpenAiHandler.calls)},
                    expected="requests for wait, scroll, snapshot, click, and final answer",
                )
            finally:
                context.close()
    except TimeoutError as error:
        result["failed_checks"] = result.get("failed_checks", []) + ["timeout while verifying browser control tool loop"]
        result["error"] = str(error)
    except Exception as error:  # noqa: BLE001 - verifier should report any unexpected failure as JSON.
        result["failed_checks"] = result.get("failed_checks", []) + ["unexpected browser control tool loop verifier failure"]
        result["error"] = str(error)
    finally:
        if site_server is not None:
            site_server.shutdown()
        if model_server is not None:
            model_server.shutdown()
        shutil.rmtree(user_data_dir, ignore_errors=True)
        shutil.rmtree(site_dir, ignore_errors=True)

    result["ok"] = not result.get("failed_checks")
    output_path = OUT_DIR / "verify-browser-control-tool-loop-results.json"
    output_path.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
