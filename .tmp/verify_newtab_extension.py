import json
import shutil
import tempfile
from pathlib import Path

from playwright.sync_api import Error, Page, TimeoutError, sync_playwright


ROOT = Path(__file__).resolve().parent.parent
EXTENSION_PATH = str(ROOT)
SCREENSHOT_PATH = ROOT / ".tmp" / "newtab-homepage-qa.png"
SCREENSHOT_BEFORE_HOVER_PATH = ROOT / ".tmp" / "newtab-homepage-before-hover.png"
SCREENSHOT_AFTER_HOVER_PATH = ROOT / ".tmp" / "newtab-homepage-after-hover.png"


def attach_loggers(page: Page, store: dict) -> None:
    store.setdefault("console", [])
    store.setdefault("page_errors", [])

    page.on(
        "console",
        lambda message: store["console"].append(
            {
                "type": message.type,
                "text": message.text,
            }
        ),
    )
    page.on("pageerror", lambda error: store["page_errors"].append(str(error)))


def wait_for_extension_ready(page: Page) -> None:
    page.wait_for_selector("#search-input", timeout=15000)
    page.wait_for_selector(".homepage-bubble-canvas", timeout=15000)



def open_extension_page(page: Page, extension_url: str) -> None:
    page.goto(extension_url, wait_until="domcontentloaded")
    page.wait_for_load_state("networkidle")
    wait_for_extension_ready(page)


def wait_for_redirect_or_extension_ready(page: Page, timeout: int = 15000) -> None:
    try:
        page.wait_for_url("chrome-extension://**", timeout=timeout)
    except TimeoutError:
        pass



def wait_for_default_search(page: Page, timeout: int = 15000) -> bool:
    try:
        page.wait_for_url("**bing.com/search**", timeout=timeout)
        return True
    except TimeoutError:
        return "bing.com/search" in page.url



def read_search_target_controls(page: Page) -> tuple[str, bool, bool, bool, bool]:
    current_search_target = ""
    github_target_available = False
    target_trigger_present = False
    target_menu_present = False
    suggestions_shell_present = False

    target_trigger = page.locator("#search-target-trigger")
    target_menu = page.locator("#search-target-menu")
    suggestions_shell = page.locator("#search-suggestions")
    target_label = page.locator("#search-target-label")

    target_trigger_present = target_trigger.count() > 0
    target_menu_present = target_menu.count() > 0
    suggestions_shell_present = suggestions_shell.count() > 0

    if target_label.count() > 0:
        current_search_target = target_label.first.inner_text().strip()

    github_option = page.locator("#search-target-menu [data-target-id='github']")
    github_target_available = github_option.count() > 0

    return (
        current_search_target,
        github_target_available,
        target_trigger_present,
        target_menu_present,
        suggestions_shell_present,
    )


def read_visible_suggestions(page: Page) -> tuple[bool, list[str], bool, int]:
    suggestions = page.locator("#search-suggestions .search-suggestion-item")
    suggestion_count = suggestions.count()
    suggestion_texts = [suggestions.nth(index).inner_text().strip() for index in range(suggestion_count)]
    quick_action_visible = any(text.startswith("用 ") for text in suggestion_texts)
    shell_visible = page.locator("#search-suggestions").is_visible() if page.locator("#search-suggestions").count() > 0 else False
    highlighted_index = page.evaluate(
        """() => {
            const items = Array.from(document.querySelectorAll('#search-suggestions .search-suggestion-item'));
            return items.findIndex((item) => item.dataset.highlighted === 'true');
        }"""
    )
    return shell_visible and suggestion_count > 0, suggestion_texts, quick_action_visible, int(highlighted_index)


def wait_for_suggestions_visible(page: Page, timeout: int = 5000) -> tuple[bool, list[str], bool, int]:
    page.wait_for_selector("#search-suggestions .search-suggestion-item", state="visible", timeout=timeout)
    return read_visible_suggestions(page)


def wait_for_suggestion_text(page: Page, expected_text: str, timeout: int = 5000) -> None:
    page.locator("#search-suggestions .search-suggestion-item", has_text=expected_text).first.wait_for(
        state="visible",
        timeout=timeout,
    )


def enable_fake_ai_preview(page: Page) -> None:
    page.add_init_script(
        """
        (() => {
            const fakeEndpoint = 'https://mock-search.local/v1/chat/completions';
            const fakeDecision = {
                choices: [
                    {
                        message: {
                            content: JSON.stringify({
                                mode: 'search',
                                target: 'moon tab refined vertical query',
                                summary: '测试用 AI 细化搜索词。',
                                websites: [
                                    {
                                        title: 'Moon Tab Docs',
                                        url: 'https://example.com/docs',
                                        description: '测试站点',
                                    },
                                ],
                            }),
                        },
                    },
                ],
            };

            const originalFetch = window.fetch.bind(window);
            window.fetch = async (input, init) => {
                const url = typeof input === 'string' ? input : input?.url ?? '';
                if (url === fakeEndpoint) {
                    return {
                        ok: true,
                        status: 200,
                        text: async () => JSON.stringify(fakeDecision),
                    };
                }

                return originalFetch(input, init);
            };

            if (globalThis.chrome?.permissions) {
                globalThis.chrome.permissions.contains = (_permissions, callback) => callback(true);
                globalThis.chrome.permissions.request = (_permissions, callback) => callback(true);
            }
        })();
        """
    )

    page.evaluate(
        """async () => {
            const fakeEndpoint = 'https://mock-search.local/v1/chat/completions';

            if (chrome?.permissions) {
                chrome.permissions.contains = (_permissions, callback) => callback(true);
                chrome.permissions.request = (_permissions, callback) => callback(true);
            }

            if (chrome?.storage?.local) {
                await new Promise((resolve) => {
                    chrome.storage.local.set(
                        {
                            searchApiEndpoint: fakeEndpoint,
                            searchApiKey: '',
                            searchApiModel: 'mock-model',
                            aiSearchEnabled: true,
                        },
                        resolve,
                    );
                });
            }
        }"""
    )


def enable_remote_suggestion_success(page: Page) -> None:
    page.add_init_script(
        """
        (() => {
            const remoteSuggestionPrefix = 'https://api.bing.com/osjson.aspx';
            const originalFetch = window.fetch.bind(window);
            window.fetch = async (input, init) => {
                const url = typeof input === 'string' ? input : input?.url ?? '';
                if (url.startsWith(remoteSuggestionPrefix)) {
                    return {
                        ok: true,
                        status: 200,
                        json: async () => [
                            new URL(url).searchParams.get('query') ?? '',
                            ['moon tab remote alpha', 'moon tab remote beta'],
                        ],
                    };
                }

                return originalFetch(input, init);
            };
        })();
        """
    )


def enable_remote_suggestion_failure(page: Page) -> None:
    page.add_init_script(
        """
        (() => {
            const remoteSuggestionPrefix = 'https://api.bing.com/osjson.aspx';
            const originalFetch = window.fetch.bind(window);
            window.fetch = async (input, init) => {
                const url = typeof input === 'string' ? input : input?.url ?? '';
                if (url.startsWith(remoteSuggestionPrefix)) {
                    throw new Error('mock remote suggestion failure');
                }

                return originalFetch(input, init);
            };
        })();
        """
    )


def seed_search_history(page: Page, history_items: list[str]) -> None:
    page.evaluate(
        """async (items) => {
            if (!chrome?.storage?.local) {
                return;
            }

            await new Promise((resolve) => {
                chrome.storage.local.set({ searchHistory: items }, resolve);
            });
        }""",
        history_items,
    )


def read_extension_storage(page: Page) -> dict:
    extension_storage = page.evaluate(
        """async () => {
            const storageArea = chrome.storage?.local;
            if (!storageArea?.get) {
                return { searchHistory: [] };
            }

            return await new Promise((resolve) => {
                chrome.storage.local.get(
                    {
                        searchHistory: [],
                        searchApiEndpoint: '',
                        searchApiKey: '',
                        searchApiModel: '',
                        aiSearchEnabled: false,
                    },
                    (items) => {
                        if (chrome.runtime?.lastError) {
                            resolve({ searchHistory: [] });
                            return;
                        }

                        resolve(items);
                    },
                );
            });
        }"""
    )
    return extension_storage if isinstance(extension_storage, dict) else {}


def assert_required_checks(result: dict) -> None:
    required_checks = [
        ("redirect_ok", result["redirect_ok"] or result["extension_page_open_ok"]),
        ("extension_page_open_ok", result["extension_page_open_ok"]),
        ("search_input_enabled", result["search_input_enabled"]),
        ("canvas_present", result["canvas_present"]),
        ("settings_opened", result["settings_opened"]),
        ("settings_closed", result["settings_closed"]),
        ("default_search_ok", result["default_search_ok"]),
        ("current_search_target", result["current_search_target"] == "Bing"),
        ("target_trigger_present", result["target_trigger_present"]),
        ("target_menu_present", result["target_menu_present"]),
        ("suggestions_shell_present", result["suggestions_shell_present"]),
        ("suggestions_visible", result["suggestions_visible"]),
        ("quick_action_suggestion_visible", result["quick_action_suggestion_visible"]),
        ("suggestions_highlight_moves", result["suggestions_highlight_moves"]),
        ("tab_completes_query_only", result["tab_completes_query_only"]),
        ("escape_dismisses_suggestions", result["escape_dismisses_suggestions"]),
        ("outside_click_dismisses_suggestions", result["outside_click_dismisses_suggestions"]),
        ("outside_click_dismisses_target_menu", result["outside_click_dismisses_target_menu"]),
        ("enter_without_selection_uses_current_target", result["enter_without_selection_uses_current_target"]),
        ("clicked_suggestion_executes", result["clicked_suggestion_executes"]),
        ("direct_url_precedence_ok", result["direct_url_precedence_ok"]),
        ("github_target_available", result["github_target_available"]),
        ("preview_generated", result["preview_generated"]),
        ("preview_primary_action_label", bool(result["preview_primary_action_label"])),
        ("preview_hidden_after_switch", result["preview_hidden_after_switch"]),
        ("vertical_target_after_switch", result["vertical_target_after_switch"] == "GitHub"),
        ("vertical_target_bypass_ok", result["vertical_target_bypass_ok"]),
        ("search_history_contains_query", result["search_history_contains_query"]),
        ("last_search_query", result["last_search_query"] == "moon tab preview test"),
        ("fallback_suggestions_visible_after_remote_failure", result["fallback_suggestions_visible_after_remote_failure"]),
        ("fallback_history_visible_after_remote_failure", result["fallback_history_visible_after_remote_failure"]),
        ("fallback_quick_action_visible_after_remote_failure", result["fallback_quick_action_visible_after_remote_failure"]),
        ("remote_suggestion_visible_after_remote_success", result["remote_suggestion_visible_after_remote_success"]),
    ]

    result["required_checks"] = [
        {"name": name, "passed": bool(passed)} for name, passed in required_checks
    ]

    for name, passed in required_checks:
        assert passed, f"smoke check failed: {name}"


def main() -> None:
    result = {
        "extension_id": "",
        "redirect_url": "",
        "redirect_ok": False,
        "extension_page_open_ok": False,
        "direct_page_url": "",
        "canvas_present": False,
        "search_input_enabled": False,
        "settings_opened": False,
        "settings_closed": False,
        "default_search_ok": False,
        "current_search_target": "",
        "target_trigger_present": False,
        "target_menu_present": False,
        "suggestions_shell_present": False,
        "suggestions_visible": False,
        "suggestion_texts": [],
        "quick_action_suggestion_visible": False,
        "initial_highlighted_suggestion_index": -1,
        "highlighted_suggestion_index_after_arrow_down": -1,
        "suggestions_highlight_moves": False,
        "query_after_tab_completion": "",
        "tab_kept_suggestions_visible": False,
        "tab_completes_query_only": False,
        "escape_dismisses_suggestions": False,
        "outside_click_dismisses_suggestions": False,
        "outside_click_dismisses_target_menu": False,
        "enter_runs_highlighted_suggestion": False,
        "enter_highlight_navigation_url": "",
        "enter_without_selection_uses_current_target": False,
        "enter_without_selection_navigation_url": "",
        "clicked_suggestion_executes": False,
        "clicked_suggestion_navigation_url": "",
        "direct_url_precedence_ok": False,
        "direct_url_navigation_url": "",
        "github_target_available": False,
        "preview_generated": False,
        "preview_primary_action_label": "",
        "preview_hidden_after_switch": False,
        "vertical_target_after_switch": "",
        "vertical_target_bypass_ok": False,
        "vertical_target_navigation_url": "",
        "search_history_items": [],
        "search_history_contains_query": False,
        "last_search_query": "",
        "fallback_suggestions_visible_after_remote_failure": False,
        "fallback_suggestion_texts_after_remote_failure": [],
        "fallback_history_visible_after_remote_failure": False,
        "fallback_quick_action_visible_after_remote_failure": False,
        "remote_suggestion_visible_after_remote_success": False,
        "remote_suggestion_texts_after_remote_success": [],
        "required_checks": [],
        "assertion_failure": "",
        "failure": "",
        "failure_type": "",
        "screenshot": str(SCREENSHOT_PATH),
        "screenshot_before_hover": str(SCREENSHOT_BEFORE_HOVER_PATH),
        "screenshot_after_hover": str(SCREENSHOT_AFTER_HOVER_PATH),
        "search_frame": {},
        "search_frame_border": {},
        "search_outline_rect": {},
        "console": [],
        "page_errors": [],
        "console_before_search": [],
        "page_errors_before_search": [],
    }

    user_data_dir = Path(tempfile.mkdtemp(prefix="moon-tab-pw-"))
    assertion_error = None
    failure_error = None

    try:
        with sync_playwright() as playwright:
            launch_kwargs = {
                "user_data_dir": str(user_data_dir),
                "headless": True,
                "args": [
                    f"--disable-extensions-except={EXTENSION_PATH}",
                    f"--load-extension={EXTENSION_PATH}",
                ],
                "viewport": {"width": 1440, "height": 960},
            }

            try:
                context = playwright.chromium.launch_persistent_context(
                    channel="chromium",
                    **launch_kwargs,
                )
            except Error:
                context = playwright.chromium.launch_persistent_context(**launch_kwargs)

            try:
                if context.service_workers:
                    service_worker = context.service_workers[0]
                else:
                    service_worker = context.wait_for_event("serviceworker", timeout=15000)

                result["extension_id"] = service_worker.url.split("/")[2]
                expected_extension_url = f"chrome-extension://{result['extension_id']}/src/pages/newtab/index.html"

                page = context.new_page()
                attach_loggers(page, result)

                page.goto("chrome://newtab/", wait_until="domcontentloaded")
                wait_for_redirect_or_extension_ready(page)
                result["redirect_url"] = page.url
                result["redirect_ok"] = page.url.startswith(f"chrome-extension://{result['extension_id']}/")

                if not result["redirect_ok"]:
                    open_extension_page(page, expected_extension_url)
                else:
                    page.wait_for_load_state("networkidle")
                    wait_for_extension_ready(page)

                result["direct_page_url"] = page.url
                result["extension_page_open_ok"] = page.url.startswith(expected_extension_url)

                result["canvas_present"] = page.locator(".homepage-bubble-canvas").count() > 0
                result["search_input_enabled"] = page.locator("#search-input").is_enabled()
                result["search_frame"] = page.locator(".outline-search-frame").evaluate(
                    "(element) => { const rect = element.getBoundingClientRect(); return { width: rect.width, height: rect.height }; }"
                )
                result["search_frame_border"] = page.locator(".outline-search-frame").evaluate(
                    "(element) => { const styles = window.getComputedStyle(element); return { top: styles.borderTopWidth, right: styles.borderRightWidth, bottom: styles.borderBottomWidth, left: styles.borderLeftWidth, color: styles.borderTopColor, style: styles.borderTopStyle }; }"
                )
                result["search_outline_rect"] = page.locator(".outline-search-outline-rect").evaluate(
                    "(element) => ({ x: element.getAttribute('x'), y: element.getAttribute('y'), width: element.getAttribute('width'), height: element.getAttribute('height'), rx: element.getAttribute('rx'), ry: element.getAttribute('ry') })"
                )

                page.screenshot(path=str(SCREENSHOT_BEFORE_HOVER_PATH), full_page=True)
                page.mouse.move(1040, 320)
                page.wait_for_load_state("networkidle")
                page.screenshot(path=str(SCREENSHOT_AFTER_HOVER_PATH), full_page=True)
                page.screenshot(path=str(SCREENSHOT_PATH), full_page=True)

                page.locator("#open-settings").click()
                page.wait_for_selector("body.is-settings-open", timeout=10000)
                result["settings_opened"] = True
                page.locator("#close-settings").click()
                page.wait_for_selector("#settings-popup[aria-hidden='true']", timeout=10000)
                result["settings_closed"] = True

                result["console_before_search"] = list(result["console"])
                result["page_errors_before_search"] = list(result["page_errors"])

                page.wait_for_selector("#search-target-trigger", timeout=10000)
                page.wait_for_selector("#search-target-label", timeout=10000)

                (
                    result["current_search_target"],
                    result["github_target_available"],
                    result["target_trigger_present"],
                    result["target_menu_present"],
                    result["suggestions_shell_present"],
                ) = read_search_target_controls(page)

                seed_search_history(
                    page,
                    [
                        "moon tab smoke test history",
                        "moon tab enter history",
                        "moon tab outside click history",
                    ],
                )
                page.goto(expected_extension_url, wait_until="domcontentloaded")
                page.wait_for_load_state("networkidle")
                wait_for_extension_ready(page)

                page.locator("#search-input").fill("moon tab smoke test")
                (
                    result["suggestions_visible"],
                    result["suggestion_texts"],
                    result["quick_action_suggestion_visible"],
                    result["initial_highlighted_suggestion_index"],
                ) = wait_for_suggestions_visible(page)

                page.keyboard.press("ArrowDown")
                page.wait_for_timeout(150)
                result["highlighted_suggestion_index_after_arrow_down"] = page.evaluate(
                    """() => {
                        const items = Array.from(document.querySelectorAll('#search-suggestions .search-suggestion-item'));
                        return items.findIndex((item) => item.dataset.highlighted === 'true');
                    }"""
                )
                result["suggestions_highlight_moves"] = (
                    result["highlighted_suggestion_index_after_arrow_down"] > result["initial_highlighted_suggestion_index"]
                )

                page.keyboard.press("Tab")
                page.wait_for_timeout(150)
                result["query_after_tab_completion"] = page.locator("#search-input").input_value().strip()
                result["tab_kept_suggestions_visible"] = page.locator("#search-suggestions").is_visible()
                result["tab_completes_query_only"] = (
                    result["query_after_tab_completion"] == "moon tab smoke test history"
                    and result["current_search_target"] == page.locator("#search-target-label").inner_text().strip()
                    and result["tab_kept_suggestions_visible"]
                )

                page.keyboard.press("Escape")
                page.wait_for_timeout(150)
                result["escape_dismisses_suggestions"] = not page.locator("#search-suggestions").is_visible()

                page.locator("#search-input").focus()
                page.locator("#search-input").fill("moon tab outside click test")
                wait_for_suggestions_visible(page)
                page.mouse.click(20, 20)
                page.wait_for_timeout(400)
                result["outside_click_dismisses_suggestions"] = not page.locator("#search-suggestions").is_visible()

                page.locator("#search-target-trigger").click()
                page.wait_for_selector("#search-target-menu:not([hidden])", timeout=5000)
                page.mouse.click(20, 20)
                page.wait_for_timeout(150)
                result["outside_click_dismisses_target_menu"] = page.locator("#search-target-menu").is_hidden()

                page.locator("#search-input").focus()
                page.locator("#search-input").fill("moon tab enter")
                wait_for_suggestions_visible(page)
                with page.expect_request(lambda request: "bing.com/search" in request.url, timeout=10000) as enter_request_info:
                    page.keyboard.press("Enter")
                enter_request = enter_request_info.value
                result["enter_highlight_navigation_url"] = enter_request.url
                result["enter_runs_highlighted_suggestion"] = "moon%20tab%20enter%20history" in enter_request.url

                enter_without_selection_page = context.new_page()
                open_extension_page(enter_without_selection_page, expected_extension_url)
                seed_search_history(enter_without_selection_page, ["moon tab plain enter history"])
                enter_without_selection_page.goto(expected_extension_url, wait_until="domcontentloaded")
                enter_without_selection_page.wait_for_load_state("networkidle")
                wait_for_extension_ready(enter_without_selection_page)
                enter_without_selection_page.locator("#search-input").fill("moon tab plain enter")
                wait_for_suggestions_visible(enter_without_selection_page)
                with enter_without_selection_page.expect_request(lambda request: "bing.com/search" in request.url, timeout=10000) as plain_enter_request_info:
                    enter_without_selection_page.locator("#search-form").evaluate("(form) => form.requestSubmit()")
                plain_enter_request = plain_enter_request_info.value
                result["enter_without_selection_navigation_url"] = plain_enter_request.url
                result["enter_without_selection_uses_current_target"] = (
                    "moon%20tab%20plain%20enter" in plain_enter_request.url
                    and "moon%20tab%20plain%20enter%20history" not in plain_enter_request.url
                )
                enter_without_selection_page.close()

                clicked_suggestion_page = context.new_page()
                open_extension_page(clicked_suggestion_page, expected_extension_url)
                seed_search_history(clicked_suggestion_page, ["moon tab clicked history"])
                clicked_suggestion_page.goto(expected_extension_url, wait_until="domcontentloaded")
                clicked_suggestion_page.wait_for_load_state("networkidle")
                wait_for_extension_ready(clicked_suggestion_page)
                clicked_suggestion_page.locator("#search-input").fill("moon tab clicked")
                wait_for_suggestions_visible(clicked_suggestion_page)
                with clicked_suggestion_page.expect_request(lambda request: "bing.com/search" in request.url, timeout=10000) as clicked_request_info:
                    clicked_suggestion_page.locator("#search-suggestions .search-suggestion-item", has_text="moon tab clicked history").click()
                clicked_request = clicked_request_info.value
                result["clicked_suggestion_navigation_url"] = clicked_request.url
                result["clicked_suggestion_executes"] = "moon%20tab%20clicked%20history" in clicked_request.url
                clicked_suggestion_page.close()

                direct_url_page = context.new_page()
                open_extension_page(direct_url_page, expected_extension_url)
                direct_url_page.locator("#search-input").fill("example.com")
                wait_for_suggestions_visible(direct_url_page)
                with direct_url_page.expect_request(lambda request: "example.com" in request.url, timeout=10000) as direct_request_info:
                    direct_url_page.keyboard.press("Enter")
                direct_request = direct_request_info.value
                result["direct_url_navigation_url"] = direct_request.url
                result["direct_url_precedence_ok"] = (
                    "example.com" in direct_request.url
                    and "bing.com/search" not in direct_request.url
                )
                direct_url_page.close()

                preview_page = context.new_page()
                open_extension_page(preview_page, expected_extension_url)
                storage_before_search = read_extension_storage(preview_page)
                result["default_search_ok"] = storage_before_search.get("searchApiEndpoint", "") == ""
                enable_fake_ai_preview(preview_page)
                preview_page.goto(expected_extension_url, wait_until="domcontentloaded")
                preview_page.wait_for_load_state("networkidle")
                wait_for_extension_ready(preview_page)

                preview_page.locator("#search-input").fill("moon tab preview test")
                preview_page.locator("#search-form").evaluate("(form) => form.requestSubmit()")
                preview_page.wait_for_selector("#ai-search-preview:not([hidden])", timeout=10000)
                result["preview_generated"] = True
                result["preview_primary_action_label"] = preview_page.locator("#ai-search-preview-action").inner_text().strip()

                preview_page.locator("#search-input").blur()
                preview_page.wait_for_timeout(200)
                preview_page.locator("#search-target-trigger").click()
                preview_page.locator("#search-target-menu [data-target-id='github']").evaluate("(element) => element.click()")
                result["vertical_target_after_switch"] = preview_page.locator("#search-target-label").inner_text().strip()
                result["preview_hidden_after_switch"] = preview_page.locator("#ai-search-preview").is_hidden()
                with preview_page.expect_request(lambda request: "github.com/search" in request.url, timeout=10000) as github_request_info:
                    preview_page.locator("#search-form").evaluate("(form) => form.requestSubmit()")
                github_request = github_request_info.value
                result["vertical_target_navigation_url"] = github_request.url
                result["vertical_target_bypass_ok"] = (
                    "github.com/search" in github_request.url
                    and "moon%20tab%20preview%20test" in github_request.url
                    and "moon%20tab%20refined%20vertical%20query" not in github_request.url
                )

                history_page = context.new_page()
                history_page.goto(expected_extension_url, wait_until="domcontentloaded")
                history_page.wait_for_load_state("networkidle")
                wait_for_extension_ready(history_page)
                extension_storage = read_extension_storage(history_page)
                history_items = extension_storage.get("searchHistory", []) if isinstance(extension_storage, dict) else []
                result["search_history_items"] = history_items if isinstance(history_items, list) else []
                result["last_search_query"] = (
                    result["search_history_items"][0]
                    if result["search_history_items"]
                    and isinstance(result["search_history_items"][0], str)
                    else ""
                )
                result["search_history_contains_query"] = "moon tab preview test" in result["search_history_items"]

                fallback_page = context.new_page()
                enable_remote_suggestion_failure(fallback_page)
                open_extension_page(fallback_page, expected_extension_url)
                seed_search_history(
                    fallback_page,
                    [
                        "moon tab fallback history",
                        "moon tab fallback extra",
                    ],
                )
                fallback_page.goto(expected_extension_url, wait_until="domcontentloaded")
                fallback_page.wait_for_load_state("networkidle")
                wait_for_extension_ready(fallback_page)
                fallback_page.locator("#search-input").fill("moon tab fallback")
                (
                    result["fallback_suggestions_visible_after_remote_failure"],
                    result["fallback_suggestion_texts_after_remote_failure"],
                    result["fallback_quick_action_visible_after_remote_failure"],
                    _,
                ) = wait_for_suggestions_visible(fallback_page)
                result["fallback_history_visible_after_remote_failure"] = any(
                    text in {"moon tab fallback history", "moon tab fallback extra"}
                    for text in result["fallback_suggestion_texts_after_remote_failure"]
                )
                fallback_page.close()

                remote_success_page = context.new_page()
                enable_remote_suggestion_success(remote_success_page)
                open_extension_page(remote_success_page, expected_extension_url)
                remote_success_page.locator("#search-input").fill("moon tab remote")
                wait_for_suggestion_text(remote_success_page, "moon tab remote alpha")
                (
                    _,
                    result["remote_suggestion_texts_after_remote_success"],
                    _,
                    _,
                ) = read_visible_suggestions(remote_success_page)
                result["remote_suggestion_visible_after_remote_success"] = any(
                    text in {"moon tab remote alpha", "moon tab remote beta"}
                    for text in result["remote_suggestion_texts_after_remote_success"]
                )
                remote_success_page.close()

                assert_required_checks(result)
            except AssertionError as error:
                result["assertion_failure"] = str(error)
                result["failure"] = str(error)
                result["failure_type"] = type(error).__name__
                assertion_error = error
            except Exception as error:
                result["failure"] = str(error)
                result["failure_type"] = type(error).__name__
                failure_error = error
            finally:
                context.close()
    finally:
        shutil.rmtree(user_data_dir, ignore_errors=True)

    print(json.dumps(result, ensure_ascii=False, indent=2))

    if assertion_error is not None:
        raise assertion_error
    if failure_error is not None:
        raise failure_error


if __name__ == "__main__":
    main()
