import json
import shutil
import sys
import tempfile
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


def add_check(result, name, ok, actual=None, expected=None):
    entry = {"name": name, "ok": bool(ok)}
    if actual is not None:
        entry["actual"] = actual
    if expected is not None:
        entry["expected"] = expected
    result["checks"].append(entry)
    if not ok:
        result.setdefault("failed_checks", []).append(name)


def read_sidebar_state(page):
    return page.evaluate(
        """() => {
            const visible = (selector) => {
                const node = document.querySelector(selector);
                if (!(node instanceof HTMLElement)) return false;
                const style = getComputedStyle(node);
                const rect = node.getBoundingClientRect();
                return style.visibility !== 'hidden' && style.display !== 'none' && rect.width > 0 && rect.height > 0;
            };
            return {
                appShell: Boolean(document.querySelector('.app-shell')),
                messageList: visible('.message-list'),
                composer: visible('.chat-composer'),
                inputShell: visible('.chat-input-shell'),
                historyTrigger: visible('.chat-history-trigger'),
                addTabButton: visible('.sidepanel-add-tab-button'),
                toolsToggle: visible('.sidepanel-tools-toggle'),
                modelSelector: visible('.model-selector'),
                sendButton: visible('.composer-actions .ui-button-primary'),
                bodyText: document.body.innerText.slice(0, 500),
            };
        }"""
    )


def click_if_present(page, selector):
    return page.evaluate(
        """(selector) => {
            const node = document.querySelector(selector);
            if (!(node instanceof HTMLElement)) return false;
            node.click();
            return true;
        }""",
        selector,
    )


def resolve_extension_id(context):
    service_worker = context.service_workers[0] if context.service_workers else None
    if service_worker is None:
        try:
            service_worker = context.wait_for_event("serviceworker", timeout=3000)
        except TimeoutError:
            service_worker = None

    if service_worker is not None:
        return service_worker.url.split("/")[2], service_worker.url

    discovery_page = context.new_page()
    try:
        discovery_page.goto("chrome://newtab/")
        discovery_page.wait_for_url(
            lambda url: url.startswith("chrome-extension://")
            and url.endswith("/src/pages/newtab/index.html"),
            timeout=5000,
        )
        return discovery_page.url.split("/")[2], discovery_page.url
    finally:
        discovery_page.close()


def main():
    if not (DIST_DIR / "manifest.json").exists():
        raise FileNotFoundError("缺少 dist/manifest.json，请先运行 npm run build:extension")

    result = {
        "ok": False,
        "extension_id": "",
        "checks": [],
        "snapshots": {},
        "page_errors": [],
        "console_errors": [],
    }
    user_data_dir = tempfile.mkdtemp(prefix="ai-sidebar-core-")

    try:
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
                extension_id, extension_source_url = resolve_extension_id(context)
                result["extension_id"] = extension_id
                add_check(result, "extension identity is available", bool(extension_id), actual=extension_source_url)

                page = context.new_page()
                page.on("pageerror", lambda error: result["page_errors"].append(str(error)))
                page.on(
                    "console",
                    lambda message: result["console_errors"].append(message.text)
                    if message.type in {"error"}
                    else None,
                )

                page.goto(f"chrome-extension://{extension_id}/index.html", wait_until="domcontentloaded")
                page.wait_for_selector(".app-shell", timeout=15000)
                page.wait_for_timeout(1800)

                state = read_sidebar_state(page)
                result["snapshots"]["initial"] = state
                add_check(
                    result,
                    "sidebar main shell renders without blank screen",
                    state["appShell"] and state["messageList"] and state["composer"] and state["inputShell"],
                    actual=state,
                    expected="app shell, message list, composer, and input shell are visible",
                )
                add_check(
                    result,
                    "core composer controls are visible",
                    state["historyTrigger"] and state["toolsToggle"] and state["addTabButton"] and state["modelSelector"] and state["sendButton"],
                    actual=state,
                    expected="history, tools, add-context, model selector, and send button are visible",
                )

                page.evaluate(
                    """async () => {
                        await chrome.storage.local.set({
                            "aiSidebar.agentTools.audit.v1": [{
                                id: "audit-smoke-1",
                                toolCallId: "call-smoke-1",
                                toolId: "mcp.dev.echo",
                                name: "mcp_dev_echo",
                                displayName: "MCP · Smoke Tool",
                                permission: "mcp",
                                status: "success",
                                startedAt: Date.now() - 25,
                                completedAt: Date.now(),
                                durationMs: 25,
                                arguments: {
                                    text: "hello smoke",
                                    apiKey: "[已脱敏]"
                                },
                                resultSummary: "smoke audit item"
                            }]
                        });
                    }"""
                )

                clicked_history = click_if_present(page, ".chat-history-trigger")
                page.wait_for_timeout(700)
                drawer = page.evaluate(
                    """(clickedHistory) => {
                        const drawer = document.querySelector('.drawer-panel.history-drawer');
                        const style = drawer instanceof HTMLElement ? getComputedStyle(drawer) : null;
                        return {
                            clickedHistory,
                            drawerPresent: Boolean(drawer),
                            drawerVisible: Boolean(drawer && style && style.display !== 'none' && style.visibility !== 'hidden'),
                            title: drawer?.querySelector('.history-dialog-title')?.textContent?.trim() || '',
                            actions: Array.from(drawer?.querySelectorAll('.sidepanel-drawer-action') || []).map((node) => ({
                                text: node.textContent.trim(),
                                pressed: node.getAttribute('aria-pressed') || '',
                                disabled: node.getAttribute('aria-disabled') || '',
                            })),
                        };
                    }""",
                    clicked_history,
                )
                result["snapshots"]["historyDrawer"] = drawer
                action_text = "\n".join(action["text"] for action in drawer["actions"])
                add_check(
                    result,
                    "history drawer opens and exposes settings entry",
                    drawer["drawerPresent"] and drawer["drawerVisible"] and "设置" in action_text,
                    actual=drawer,
                    expected="drawer visible with settings action",
                )

                clicked_settings = page.evaluate(
                    """() => {
                        const buttons = Array.from(document.querySelectorAll('.sidepanel-drawer-action'));
                        const button = buttons.find((node) => node.textContent.trim() === '设置');
                        if (!(button instanceof HTMLElement)) return false;
                        button.click();
                        return true;
                    }"""
                )
                page.wait_for_timeout(900)
                clicked_agent_tools = page.evaluate(
                    """() => {
                        const tabs = Array.from(document.querySelectorAll('[role="tab"]'));
                        const tab = tabs.find((node) => node.textContent.trim() === '工具和 MCP');
                        if (!(tab instanceof HTMLElement)) return false;
                        tab.click();
                        return true;
                    }"""
                )
                page.wait_for_timeout(900)
                agent_tools_settings = page.evaluate(
                    """({ clickedSettings, clickedAgentTools }) => {
                        const panel = document.querySelector('[role="tabpanel"] section[aria-label="工具和 MCP"]');
                        return {
                            clickedSettings,
                            clickedAgentTools,
                            present: Boolean(panel),
                            title: panel?.querySelector('h3')?.textContent?.trim() || '',
                            hasServerUrlInput: Boolean(panel?.querySelector('input[aria-label="MCP Server 地址"]')),
                            buttons: Array.from(panel?.querySelectorAll('button') || []).map((node) => node.textContent.trim()).filter(Boolean),
                            auditText: panel?.querySelector('.sidepanel-agent-tools-audit-list')?.innerText || '',
                        };
                    }""",
                    {
                        "clickedSettings": clicked_settings,
                        "clickedAgentTools": clicked_agent_tools,
                    },
                )
                result["snapshots"]["agentToolsSettings"] = agent_tools_settings
                add_check(
                    result,
                    "tools and MCP settings open",
                    clicked_settings
                    and clicked_agent_tools
                    and agent_tools_settings["present"]
                    and agent_tools_settings["title"] == "工具和 MCP"
                    and agent_tools_settings["hasServerUrlInput"]
                    and "保存并刷新" in agent_tools_settings["buttons"],
                    actual=agent_tools_settings,
                    expected="settings tab titled 工具和 MCP with MCP URL input and save action",
                )
                add_check(
                    result,
                    "tools and MCP settings show tool audit log",
                    "mcp_dev_echo" in agent_tools_settings["auditText"] and "[已脱敏]" in agent_tools_settings["auditText"],
                    actual=agent_tools_settings,
                    expected="seeded redacted audit entry is visible before clearing",
                )
                clicked_clear_audit = page.evaluate(
                    """() => {
                        const panel = document.querySelector('[role="tabpanel"] section[aria-label="工具和 MCP"]');
                        const button = Array.from(panel?.querySelectorAll('button') || [])
                            .find((node) => node.textContent.trim() === '清空记录');
                        const beforeText = panel?.querySelector('.sidepanel-agent-tools-audit-list')?.innerText || '';
                        const beforeDisabled = button instanceof HTMLButtonElement ? button.disabled : true;
                        if (!(button instanceof HTMLButtonElement) || button.disabled) {
                            return { clicked: false, beforeText, beforeDisabled };
                        }
                        button.click();
                        return { clicked: true, beforeText, beforeDisabled };
                    }"""
                )
                page.wait_for_timeout(900)
                clear_audit_state = page.evaluate(
                    """(clickedClearAudit) => {
                        const panel = document.querySelector('[role="tabpanel"] section[aria-label="工具和 MCP"]');
                        const button = Array.from(panel?.querySelectorAll('button') || [])
                            .find((node) => node.textContent.trim() === '清空记录');
                        return {
                            ...clickedClearAudit,
                            present: Boolean(panel),
                            afterText: panel?.querySelector('.sidepanel-agent-tools-audit-list')?.innerText || '',
                            afterDisabled: button instanceof HTMLButtonElement ? button.disabled : null,
                        };
                    }""",
                    clicked_clear_audit,
                )
                result["snapshots"]["agentToolsClearAudit"] = clear_audit_state
                add_check(
                    result,
                    "tools and MCP dialog clears audit log",
                    clear_audit_state["clicked"]
                    and "mcp_dev_echo" in clear_audit_state["beforeText"]
                    and "暂无工具调用记录" in clear_audit_state["afterText"]
                    and clear_audit_state["afterDisabled"] is True,
                    actual=clear_audit_state,
                    expected="clicking 清空 removes audit entries and disables the clear button",
                )
                click_if_present(page, ".settings-dialog-back")
                page.wait_for_timeout(200)

                clicked_tools = click_if_present(page, ".sidepanel-tools-toggle")
                page.wait_for_timeout(400)
                tools = page.evaluate(
                    """(clickedTools) => {
                        const composer = document.querySelector('.chat-composer');
                        const switches = document.querySelector('.composer-switches');
                        return {
                            clickedTools,
                            openClass: composer?.classList.contains('is-tools-open') || false,
                            ariaHidden: switches?.getAttribute('aria-hidden') || '',
                            labels: Array.from(switches?.querySelectorAll('button, label, select, input') || [])
                                .map((node) => (node.getAttribute('aria-label') || node.textContent || node.title || '').trim())
                                .filter(Boolean)
                                .slice(0, 12),
                        };
                    }""",
                    clicked_tools,
                )
                result["snapshots"]["tools"] = tools
                add_check(
                    result,
                    "tools menu opens and exposes browser control",
                    clicked_tools
                    and tools["openClass"]
                    and tools["ariaHidden"] in {"", "false"}
                    and any("浏览器控制" in label for label in tools["labels"]),
                    actual=tools,
                    expected="composer has is-tools-open and an aria-visible browser control entry",
                )

                clicked_context = click_if_present(page, ".sidepanel-add-tab-button")
                page.wait_for_timeout(800)
                context_dialog = page.evaluate(
                    """(clickedContext) => {
                        const dialog = document.querySelector('.context-dialog');
                        return {
                            clickedContext,
                            present: Boolean(dialog),
                            title: dialog?.querySelector('.context-dialog-title')?.textContent?.trim() || '',
                            previewNotice: dialog?.querySelector('.sidepanel-preview-notice')?.textContent?.trim() || '',
                            rowCount: dialog?.querySelectorAll('.context-tab-item, .context-tab-item-active').length || 0,
                        };
                    }""",
                    clicked_context,
                )
                result["snapshots"]["contextDialog"] = context_dialog
                add_check(
                    result,
                    "add-tab context dialog opens",
                    clicked_context and context_dialog["present"] and context_dialog["title"] == "选择注入标签页",
                    actual=context_dialog,
                    expected="context dialog titled 选择注入标签页 is present",
                )

                add_check(
                    result,
                    "side panel has no page-level JavaScript errors",
                    len(result["page_errors"]) == 0 and len(result["console_errors"]) == 0,
                    actual={"page_errors": result["page_errors"], "console_errors": result["console_errors"]},
                    expected="no pageerror or console.error entries during smoke flow",
                )
            finally:
                context.close()
    except TimeoutError as error:
        result["failed_checks"] = result.get("failed_checks", []) + ["timeout while verifying sidebar"]
        result["error"] = str(error)
    except Exception as error:  # noqa: BLE001 - verifier should report any unexpected failure as JSON.
        result["failed_checks"] = result.get("failed_checks", []) + ["unexpected verifier failure"]
        result["error"] = str(error)
    finally:
        shutil.rmtree(user_data_dir, ignore_errors=True)

    result["ok"] = not result.get("failed_checks")
    output_path = OUT_DIR / "verify-ai-sidebar-core-results.json"
    output_path.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
