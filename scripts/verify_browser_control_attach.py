import json
import shutil
import sys
import tempfile
import threading
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
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


class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, *args):  # noqa: ANN002 - http.server callback signature.
        return


def add_check(result, name, ok, actual=None, expected=None):
    entry = {"name": name, "ok": bool(ok)}
    if actual is not None:
        entry["actual"] = actual
    if expected is not None:
        entry["expected"] = expected
    result["checks"].append(entry)
    if not ok:
        result.setdefault("failed_checks", []).append(name)


def main():
    if not (DIST_DIR / "manifest.json").exists():
        raise FileNotFoundError("缺少 dist/manifest.json，请先运行 npm run build:extension")

    result = {
        "ok": False,
        "extension_id": "",
        "target_url": "",
        "checks": [],
    }
    user_data_dir = tempfile.mkdtemp(prefix="ai-sidebar-browser-control-")
    site_dir = Path(tempfile.mkdtemp(prefix="ai-sidebar-browser-control-site-"))
    server = None

    try:
        (site_dir / "index.html").write_text(
            "\n".join(
                [
                    "<!doctype html>",
                    '<meta charset="utf-8">',
                    "<title>Browser Control Smoke</title>",
                    '<button id="primary-action">可点击按钮</button>',
                    '<input id="name-input" value="" placeholder="姓名">',
                    "<p>Hello Browser Control Smoke</p>",
                ],
            ),
            encoding="utf-8",
        )

        server = ThreadingHTTPServer(
            ("127.0.0.1", 0),
            lambda *args, **kwargs: QuietHandler(*args, directory=str(site_dir), **kwargs),
        )
        threading.Thread(target=server.serve_forever, daemon=True).start()
        target_url = f"http://127.0.0.1:{server.server_port}/index.html"
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
                    """async (targetUrl) => {
                        const [tab] = await chrome.tabs.query({ url: targetUrl });
                        if (!tab?.id) {
                            return { ok: false, stage: "query-tab", tabs: await chrome.tabs.query({}) };
                        }

                        const enable = await chrome.runtime.sendMessage({
                            type: "browserControl.setEnabled",
                            enabled: true,
                            tabId: tab.id,
                        });
                        const disable = await chrome.runtime.sendMessage({
                            type: "browserControl.setEnabled",
                            enabled: false,
                            tabId: tab.id,
                        });

                        return { ok: true, tabId: tab.id, enable, disable };
                    }""",
                    target_url,
                )

                result["browserControl"] = response
                add_check(
                    result,
                    "browser control can attach to an ordinary http page",
                    bool(response.get("enable", {}).get("ok") and response.get("enable", {}).get("attached") is True),
                    actual=response.get("enable"),
                    expected="runtime browserControl.setEnabled returns ok=true and attached=true",
                )
                add_check(
                    result,
                    "browser control can detach cleanly",
                    bool(response.get("disable", {}).get("ok") and response.get("disable", {}).get("attached") is False),
                    actual=response.get("disable"),
                    expected="runtime browserControl.setEnabled(false) returns ok=true and attached=false",
                )
            finally:
                context.close()
    except TimeoutError as error:
        result["failed_checks"] = result.get("failed_checks", []) + ["timeout while verifying browser control attach"]
        result["error"] = str(error)
    except Exception as error:  # noqa: BLE001 - verifier should report any unexpected failure as JSON.
        result["failed_checks"] = result.get("failed_checks", []) + ["unexpected browser control verifier failure"]
        result["error"] = str(error)
    finally:
        if server is not None:
            server.shutdown()
        shutil.rmtree(user_data_dir, ignore_errors=True)
        shutil.rmtree(site_dir, ignore_errors=True)

    result["ok"] = not result.get("failed_checks")
    output_path = OUT_DIR / "verify-browser-control-attach-results.json"
    output_path.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
