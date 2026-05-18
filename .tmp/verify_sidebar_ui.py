import json
import re
import shutil
import sys
import tempfile
from pathlib import Path

from playwright.sync_api import sync_playwright


ROOT = Path(__file__).resolve().parent.parent
EXTENSION_PATH = str(ROOT)


def parse_rgba(value: str):
    match = re.fullmatch(
        r"rgba?\(\s*([0-9.]+)\s*,\s*([0-9.]+)\s*,\s*([0-9.]+)(?:\s*,\s*([0-9.]+))?\s*\)",
        (value or "").strip(),
    )
    if not match:
        return None

    red, green, blue, alpha = match.groups()
    return (
        float(red),
        float(green),
        float(blue),
        float(alpha) if alpha is not None else 1.0,
    )


def is_deep_night_surface(color: str, *, max_rgb: int = 56, min_alpha: float = 0.78) -> bool:
    parsed = parse_rgba(color)
    if parsed is None:
        return False

    red, green, blue, alpha = parsed
    return red <= max_rgb and green <= max_rgb and blue <= max_rgb and alpha >= min_alpha


def is_deep_night_text(color: str, *, min_rgb: int = 180, min_alpha: float = 0.78) -> bool:
    parsed = parse_rgba(color)
    if parsed is None:
        return False

    red, green, blue, alpha = parsed
    return red >= min_rgb and green >= min_rgb and blue >= min_rgb and alpha >= min_alpha


def add_check(result: dict, failed: list[str], name: str, ok: bool, actual=None, expected=None) -> None:
    entry = {"name": name, "ok": ok}
    if actual is not None:
        entry["actual"] = actual
    if expected is not None:
        entry["expected"] = expected
    result["checks"].append(entry)
    if not ok:
        failed.append(name)


def is_style_block(value) -> bool:
    return isinstance(value, dict)


def read_style_field(style_block, field: str):
    if not isinstance(style_block, dict):
        return None
    return style_block.get(field)


def seed_runtime_state(page, *, endpoint: str, api_key: str, model: str, last_test_status: str, last_test_message: str, last_runtime_error_message: str) -> None:
    page.evaluate(
        """async (payload) => {
            await new Promise((resolve) => {
                chrome.storage.local.set(
                    {
                        searchApiEndpoint: payload.endpoint,
                        searchApiKey: payload.apiKey,
                        searchApiModel: payload.model,
                        aiSearchEnabled: Boolean(payload.endpoint),
                        searchRuntimeConfigState: '',
                        searchRuntimeLastTestStatus: payload.lastTestStatus,
                        searchRuntimeLastTestMessage: payload.lastTestMessage,
                        searchRuntimeLastTestAt: payload.lastTestStatus ? '2026-05-13T00:00:00.000Z' : '',
                        searchRuntimeLastRuntimeErrorMessage: payload.lastRuntimeErrorMessage,
                        searchRuntimeLastRuntimeErrorAt: payload.lastRuntimeErrorMessage ? '2026-05-13T00:00:00.000Z' : '',
                    },
                    resolve,
                );
            });
        }""",
        {
            "endpoint": endpoint,
            "apiKey": api_key,
            "model": model,
            "lastTestStatus": last_test_status,
            "lastTestMessage": last_test_message,
            "lastRuntimeErrorMessage": last_runtime_error_message,
        },
    )


def sync_sidebar(page) -> dict:
    return page.evaluate(
        """async () => {
            return await window.__SIDEBAR_TEST_HOOKS__.syncState();
        }"""
    )


def read_shell_state(page) -> dict:
    return page.evaluate(
        """() => {
            const shell = document.querySelector('.sidebar-shell');
            const chatShell = document.getElementById('sidebar-chat-shell');
            const locked = document.getElementById('sidebar-locked-state');
            const error = document.getElementById('sidebar-error-state');
            const form = document.getElementById('sidebar-form');
            const input = document.getElementById('sidebar-input');
            const topbarAiStatus = document.getElementById('sidebar-topbar-ai-status');

            return {
                shellState: shell?.dataset.sidebarShellState ?? '',
                chatState: chatShell?.dataset.chatState ?? '',
                lockedHidden: locked?.hidden,
                lockedVariant: locked?.dataset.sidebarStateVariant ?? '',
                errorHidden: error?.hidden,
                errorVariant: error?.dataset.sidebarStateVariant ?? '',
                composerEnabled: form?.dataset.composerEnabled ?? '',
                inputDisabled: input?.disabled ?? null,
                aiStatusText: topbarAiStatus?.textContent?.trim() ?? '',
                hookPresent: Boolean(window.__SIDEBAR_TEST_HOOKS__?.syncState),
            };
        }"""
    )


def read_visual_contract(page) -> dict:
    return page.evaluate(
        """() => {
            const shell = document.querySelector('.sidebar-shell');
            const topbar = document.querySelector('.sidebar-topbar');
            const messages = document.getElementById('sidebar-messages');
            const form = document.getElementById('sidebar-form');
            const inputShell = document.querySelector('.sidebar-input-shell');
            const input = document.getElementById('sidebar-input');
            const submit = document.getElementById('sidebar-submit');

            const style_block = (element) => {
                if (!(element instanceof HTMLElement)) {
                    return null;
                }

                const styles = getComputedStyle(element);
                return {
                    backgroundColor: styles.backgroundColor,
                    backgroundImage: styles.backgroundImage,
                    borderTopColor: styles.borderTopColor,
                    color: styles.color,
                    boxShadow: styles.boxShadow,
                };
            };

            return {
                metaColorScheme: document.querySelector('meta[name=\"color-scheme\"]')?.content ?? '',
                rootColorScheme: getComputedStyle(document.documentElement).colorScheme,
                body: {
                    backgroundColor: getComputedStyle(document.body).backgroundColor,
                    backgroundImage: getComputedStyle(document.body).backgroundImage,
                    color: getComputedStyle(document.body).color,
                },
                shell: style_block(shell),
                topbar: style_block(topbar),
                messages: style_block(messages),
                composer: style_block(form),
                inputShell: style_block(inputShell),
                input: style_block(input),
                submit: style_block(submit),
            };
        }"""
    )


def main() -> int:
    result = {
        "ok": False,
        "extension_id": "",
        "checks": [],
        "state_snapshots": {},
        "visual_contract": {},
        "failure_reason": "",
    }
    failed_checks: list[str] = []

    user_data_dir = Path(tempfile.mkdtemp(prefix="sidebar-ui-verify-"))

    try:
        with sync_playwright() as playwright:
            launch_kwargs = {
                "user_data_dir": str(user_data_dir),
                "headless": True,
                "args": [
                    f"--disable-extensions-except={EXTENSION_PATH}",
                    f"--load-extension={EXTENSION_PATH}",
                ],
            }

            try:
                context = playwright.chromium.launch_persistent_context(channel="chromium", **launch_kwargs)
            except Exception:
                context = playwright.chromium.launch_persistent_context(**launch_kwargs)

            try:
                service_worker = context.service_workers[0] if context.service_workers else context.wait_for_event("serviceworker", timeout=15000)
                extension_id = service_worker.url.split("/")[2]
                result["extension_id"] = extension_id

                sidebar_url = f"chrome-extension://{extension_id}/src/pages/sidebar/index.html"
                page = context.new_page()
                page.add_init_script(
                    """
                    (() => {
                        const contextResponse = {
                            ok: true,
                            context: {
                                title: 'Midnight Console Fixture',
                                url: 'https://example.com/midnight-console',
                                selectionText: 'selected text',
                                mainText: 'fixture main text',
                            },
                        };

                        const runtime = globalThis.chrome?.runtime;
                        if (runtime?.sendMessage) {
                            const originalSendMessage = runtime.sendMessage.bind(runtime);
                            runtime.sendMessage = async (message, ...args) => {
                                if (message?.type === 'sidebar:get-active-context' || message?.type === 'sidebar:refresh-context') {
                                    return contextResponse;
                                }
                                return originalSendMessage(message, ...args);
                            };
                        }

                        if (globalThis.chrome?.tabs?.onActivated?.addListener) {
                            globalThis.chrome.tabs.onActivated.addListener = () => {};
                        }
                        if (globalThis.chrome?.tabs?.onUpdated?.addListener) {
                            globalThis.chrome.tabs.onUpdated.addListener = () => {};
                        }
                        if (globalThis.chrome?.tabs?.create) {
                            globalThis.chrome.tabs.create = () => {};
                        }
                    })();
                    """
                )

                page.goto(sidebar_url, wait_until="domcontentloaded")
                page.wait_for_selector(".sidebar-shell", timeout=15000)
                page.wait_for_function("() => Boolean(window.__SIDEBAR_TEST_HOOKS__?.syncState)", timeout=15000)

                initial_state = read_shell_state(page)
                add_check(
                    result,
                    failed_checks,
                    "sidebar hooks are available on direct sidebar page load",
                    initial_state["hookPresent"] is True,
                    actual=initial_state,
                    expected="window.__SIDEBAR_TEST_HOOKS__.syncState is present",
                )

                seed_runtime_state(
                    page,
                    endpoint="https://api.example.com/v1/chat/completions",
                    api_key="fixture-key",
                    model="fixture-model",
                    last_test_status="",
                    last_test_message="",
                    last_runtime_error_message="",
                )
                locked_sync = sync_sidebar(page)
                locked_snapshot = read_shell_state(page)
                result["state_snapshots"]["locked"] = {"sync": locked_sync, "dom": locked_snapshot}
                add_check(
                    result,
                    failed_checks,
                    "locked shell state renders with hidden error card and disabled composer",
                    locked_snapshot["shellState"] == "locked"
                    and locked_snapshot["chatState"] == "locked"
                    and locked_snapshot["lockedHidden"] is False
                    and locked_snapshot["lockedVariant"] == "locked"
                    and locked_snapshot["errorHidden"] is True
                    and locked_snapshot["composerEnabled"] == "false"
                    and locked_snapshot["inputDisabled"] is True,
                    actual=locked_snapshot,
                    expected="locked shell shows locked card and disables composer",
                )

                seed_runtime_state(
                    page,
                    endpoint="https://api.example.com/v1/chat/completions",
                    api_key="fixture-key",
                    model="fixture-model",
                    last_test_status="failed",
                    last_test_message="Fixture invalid connection",
                    last_runtime_error_message="",
                )
                error_sync = sync_sidebar(page)
                error_snapshot = read_shell_state(page)
                result["state_snapshots"]["error"] = {"sync": error_sync, "dom": error_snapshot}
                add_check(
                    result,
                    failed_checks,
                    "error shell state renders error surface and keeps composer disabled",
                    error_sync["shellState"] == "error"
                    and error_sync["surfaceVariant"] == "error"
                    and error_sync["configState"] == "invalid"
                    and error_sync["aiStatusTone"] == "error"
                    and error_snapshot["shellState"] == error_sync["shellState"]
                    and error_snapshot["chatState"] == error_sync["shellState"]
                    and error_snapshot["lockedHidden"] is True
                    and error_snapshot["errorHidden"] is False
                    and error_snapshot["errorVariant"] == error_sync["surfaceVariant"]
                    and error_snapshot["composerEnabled"] == "false"
                    and error_snapshot["inputDisabled"] is True,
                    actual={"sync": error_sync, "dom": error_snapshot},
                    expected="error sync result and DOM state agree on error shell, error variant, and disabled composer",
                )

                seed_runtime_state(
                    page,
                    endpoint="https://api.example.com/v1/chat/completions",
                    api_key="fixture-key",
                    model="fixture-model",
                    last_test_status="passed",
                    last_test_message="Fixture valid connection",
                    last_runtime_error_message="Fixture degraded runtime",
                )
                degraded_sync = sync_sidebar(page)
                degraded_snapshot = read_shell_state(page)
                result["state_snapshots"]["degraded"] = {"sync": degraded_sync, "dom": degraded_snapshot}
                add_check(
                    result,
                    failed_checks,
                    "degraded shell state keeps error shell but enables composer via degraded surface",
                    degraded_sync["shellState"] == "error"
                    and degraded_sync["surfaceVariant"] == "degraded"
                    and degraded_sync["configState"] == "degraded"
                    and degraded_sync["aiStatusTone"] == "degraded"
                    and degraded_snapshot["shellState"] == degraded_sync["shellState"]
                    and degraded_snapshot["chatState"] == degraded_sync["shellState"]
                    and degraded_snapshot["errorHidden"] is False
                    and degraded_snapshot["errorVariant"] == degraded_sync["surfaceVariant"]
                    and degraded_snapshot["composerEnabled"] == "true"
                    and degraded_snapshot["inputDisabled"] is False,
                    actual={"sync": degraded_sync, "dom": degraded_snapshot},
                    expected="degraded sync result and DOM state agree on degraded surface and enabled composer",
                )

                seed_runtime_state(
                    page,
                    endpoint="https://api.example.com/v1/chat/completions",
                    api_key="fixture-key",
                    model="fixture-model",
                    last_test_status="passed",
                    last_test_message="Fixture valid connection",
                    last_runtime_error_message="",
                )
                active_sync = sync_sidebar(page)
                active_snapshot = read_shell_state(page)
                result["state_snapshots"]["active"] = {"sync": active_sync, "dom": active_snapshot}
                add_check(
                    result,
                    failed_checks,
                    "active shell state hides inline state cards and enables composer",
                    active_sync["shellState"] == "active"
                    and active_sync["surfaceVariant"] == "active"
                    and active_sync["configState"] == "valid"
                    and active_sync["aiStatusTone"] == "success"
                    and active_snapshot["shellState"] == active_sync["shellState"]
                    and active_snapshot["chatState"] == active_sync["shellState"]
                    and active_snapshot["lockedHidden"] is True
                    and active_snapshot["errorHidden"] is True
                    and active_snapshot["composerEnabled"] == "true"
                    and active_snapshot["inputDisabled"] is False,
                    actual={"sync": active_sync, "dom": active_snapshot},
                    expected="active sync result and DOM state agree on active shell and enabled composer",
                )

                visual_contract = read_visual_contract(page)
                result["visual_contract"] = visual_contract

                required_visual_blocks = ["body", "shell", "topbar", "messages", "composer", "inputShell", "input", "submit"]
                missing_visual_blocks = [
                    block_name for block_name in required_visual_blocks
                    if not is_style_block(visual_contract.get(block_name))
                ]
                add_check(
                    result,
                    failed_checks,
                    "visual contract snapshots exist for shell, topbar, messages, composer, input, and submit",
                    not missing_visual_blocks,
                    actual={
                        "missing": missing_visual_blocks,
                        "available_keys": sorted(visual_contract.keys()),
                        "raw": {block_name: visual_contract.get(block_name) for block_name in required_visual_blocks},
                    },
                    expected="all required visual blocks are present as style snapshots",
                )

                add_check(
                    result,
                    failed_checks,
                    "midnight console color-scheme advertises dark surfaces",
                    "dark" in visual_contract["metaColorScheme"].lower()
                    and "dark" in visual_contract["rootColorScheme"].lower(),
                    actual={
                        "metaColorScheme": visual_contract["metaColorScheme"],
                        "rootColorScheme": visual_contract["rootColorScheme"],
                    },
                    expected="meta and computed color-scheme contain dark",
                )

                add_check(
                    result,
                    failed_checks,
                    "midnight console shell uses deep-night body and shell surfaces",
                    is_style_block(visual_contract.get("body"))
                    and is_style_block(visual_contract.get("shell"))
                    and is_deep_night_surface(read_style_field(visual_contract.get("body"), "backgroundColor"), max_rgb=40, min_alpha=0.95)
                    and is_deep_night_surface(read_style_field(visual_contract.get("shell"), "backgroundColor"), max_rgb=56, min_alpha=0.78),
                    actual={
                        "body": visual_contract.get("body"),
                        "shell": visual_contract.get("shell"),
                    },
                    expected="body and shell backgrounds are dark blue/charcoal surfaces",
                )

                add_check(
                    result,
                    failed_checks,
                    "midnight console topbar and messages stay on dark surfaces with bright text",
                    is_style_block(visual_contract.get("topbar"))
                    and is_style_block(visual_contract.get("messages"))
                    and is_deep_night_surface(read_style_field(visual_contract.get("topbar"), "backgroundColor"), max_rgb=72, min_alpha=0.68)
                    and is_deep_night_surface(read_style_field(visual_contract.get("messages"), "backgroundColor"), max_rgb=72, min_alpha=0.2)
                    and is_deep_night_text(read_style_field(visual_contract.get("topbar"), "color"), min_rgb=190, min_alpha=0.78)
                    and is_deep_night_text(read_style_field(visual_contract.get("messages"), "color"), min_rgb=170, min_alpha=0.7),
                    actual={
                        "topbar": visual_contract.get("topbar"),
                        "messages": visual_contract.get("messages"),
                    },
                    expected="topbar/messages use dark panels with light text",
                )

                add_check(
                    result,
                    failed_checks,
                    "midnight console composer and input shell stay dark with luminous submit contrast",
                    is_style_block(visual_contract.get("composer"))
                    and is_style_block(visual_contract.get("inputShell"))
                    and is_style_block(visual_contract.get("input"))
                    and is_style_block(visual_contract.get("submit"))
                    and is_deep_night_surface(read_style_field(visual_contract.get("composer"), "backgroundColor"), max_rgb=72, min_alpha=0.2)
                    and is_deep_night_surface(read_style_field(visual_contract.get("inputShell"), "backgroundColor"), max_rgb=72, min_alpha=0.68)
                    and is_deep_night_text(read_style_field(visual_contract.get("input"), "color"), min_rgb=190, min_alpha=0.78)
                    and is_deep_night_text(read_style_field(visual_contract.get("submit"), "color"), min_rgb=210, min_alpha=0.9),
                    actual={
                        "composer": visual_contract.get("composer"),
                        "inputShell": visual_contract.get("inputShell"),
                        "input": visual_contract.get("input"),
                        "submit": visual_contract.get("submit"),
                    },
                    expected="composer/input shell are dark and input/submit text are bright",
                )
            finally:
                context.close()
    finally:
        shutil.rmtree(user_data_dir, ignore_errors=True)

    result["ok"] = not failed_checks
    if failed_checks:
        result["failed_checks"] = failed_checks
        midnight_failures = [name for name in failed_checks if name.startswith("midnight console")]
        if midnight_failures:
            result["failure_reason"] = f"Expected Midnight Console deep-night contract mismatch: {midnight_failures[0]}"
        else:
            result["failure_reason"] = failed_checks[0]

    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    sys.exit(main())
