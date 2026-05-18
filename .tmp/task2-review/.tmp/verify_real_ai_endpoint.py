import json
import shutil
import tempfile
import time
from pathlib import Path

from playwright.sync_api import Error, TimeoutError, sync_playwright

ROOT = Path(__file__).resolve().parent.parent
EXTENSION_PATH = str(ROOT)

ENDPOINT = "https://free.9e.nz/v1/responses"
API_KEY = "sk-c166e22ad204e26abaa53ecb5e67e630923d2380e44ba2c61b514f9f996773cd"
MODEL = "gpt-5.4"


def open_extension_page(page, extension_url: str) -> None:
    page.goto(extension_url, wait_until="domcontentloaded")
    page.wait_for_load_state("networkidle")
    page.wait_for_selector("#search-input", timeout=15000)


def wait_until(page, predicate: str, arg=None, timeout: int = 15000, interval: float = 0.05):
    deadline = time.monotonic() + (timeout / 1000)
    last_error = None
    while time.monotonic() < deadline:
        try:
            if arg is None:
                if page.evaluate(predicate):
                    return
            elif page.evaluate(predicate, arg):
                return
        except Error as error:
            last_error = error
        time.sleep(interval)
    if last_error is not None:
        raise last_error
    raise TimeoutError(f"Timed out after {timeout}ms waiting for predicate")


def main() -> None:
    user_data_dir = Path(tempfile.mkdtemp(prefix="moon-tab-real-ai-"))
    result = {
        "settings_saved": False,
        "test_passed": False,
        "sidebar_opened": False,
        "sidebar_chat_visible": False,
        "assistant_text": "",
        "error": "",
    }

    try:
        with sync_playwright() as playwright:
            launch_kwargs = {
                'user_data_dir': str(user_data_dir),
                'headless': True,
                'args': [
                    f"--disable-extensions-except={EXTENSION_PATH}",
                    f"--load-extension={EXTENSION_PATH}",
                ],
            }
            try:
                context = playwright.chromium.launch_persistent_context(
                    channel="chromium",
                    **launch_kwargs,
                )
            except Exception:
                context = playwright.chromium.launch_persistent_context(**launch_kwargs)
            try:
                if context.service_workers:
                    service_worker = context.service_workers[0]
                else:
                    service_worker = context.wait_for_event("serviceworker", timeout=15000)

                extension_id = service_worker.url.split("/")[2]
                extension_url = f"chrome-extension://{extension_id}/src/pages/newtab/index.html"
                sidebar_url = f"chrome-extension://{extension_id}/src/pages/sidebar/index.html"

                page = context.new_page()
                open_extension_page(page, extension_url)

                page.locator("#open-settings").click()
                page.wait_for_selector("body.is-settings-open", timeout=10000)
                page.locator("#search-api-endpoint").fill(ENDPOINT)
                page.locator("#search-api-key").fill(API_KEY)
                page.locator("#search-api-model").fill(MODEL)
                page.locator("#save-settings").click()
                wait_until(
                    page,
                    """() => document.querySelector('#ai-config-state-card')?.dataset?.state === 'configured'""",
                    timeout=15000,
                )
                result["settings_saved"] = True

                page.locator("#test-search-api-connection").click()
                wait_until(
                    page,
                    """() => document.querySelector('#ai-config-state-card')?.dataset?.state === 'valid'""",
                    timeout=30000,
                )
                result["test_passed"] = True

                web_page = context.new_page()
                web_page.goto("https://example.com", wait_until="domcontentloaded")
                web_page.wait_for_load_state("networkidle")
                web_page.bring_to_front()

                sidebar_page = context.new_page()
                sidebar_page.goto(sidebar_url, wait_until="domcontentloaded")
                sidebar_page.wait_for_load_state("networkidle")
                sidebar_page.wait_for_selector("#sidebar-chat-shell:not([hidden])", timeout=15000)
                result["sidebar_opened"] = True
                result["sidebar_chat_visible"] = sidebar_page.locator("#sidebar-chat-shell").is_visible()

                sidebar_page.locator("#sidebar-input").fill("请总结当前页面的要点")
                sidebar_page.locator("#sidebar-form").evaluate("(form) => form.requestSubmit()")
                assistant = sidebar_page.locator("[data-sidebar-message-kind='assistant']").last
                assistant.wait_for(state="visible", timeout=30000)
                result["assistant_text"] = assistant.inner_text().strip()

                sidebar_page.close()
                web_page.close()
                page.close()
            finally:
                context.close()
    except Exception as exc:
        result["error"] = f"{type(exc).__name__}: {exc}"
    finally:
        shutil.rmtree(user_data_dir, ignore_errors=True)

    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
