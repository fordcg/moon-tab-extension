import json
import shutil
import tempfile
from pathlib import Path

from PIL import Image
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
    page.wait_for_selector("#homepage-bubble-layer", timeout=15000)
    page.wait_for_function(
        """() => {
            const input = document.querySelector('#search-input');
            const layer = document.querySelector('#homepage-bubble-layer');
            return Boolean(input && !input.disabled && layer);
        }""",
        timeout=15000,
    )


def wait_for_widget_runtime_ready(page: Page, timeout: int = 10000) -> None:
    try:
        page.wait_for_function(
            """() => Boolean(
                document.querySelector('#widget-root')
                && document.querySelector('#toggle-widget-edit-mode')
            )""",
            timeout=timeout,
        )
    except TimeoutError:
        pass


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

def read_widget_runtime_state(page: Page) -> dict:
    state = page.evaluate(
        """() => {
            const widgetRoot = document.querySelector('#widget-root');
            const editButton = document.querySelector('#toggle-widget-edit-mode');
            const settingsButton = document.querySelector('#open-settings');
            const manageMenu = document.querySelector('#homepage-manage-menu');
            const manageTrigger = document.querySelector('#homepage-manage-trigger');
            const searchActions = document.querySelector('.search-shell-actions');
            const aiToggle = document.querySelector('#ai-toggle-btn');
            const searchTargetTrigger = document.querySelector('#search-target-trigger');
            const panel = document.querySelector('#widget-panel');
            const aiToggleRect = aiToggle?.getBoundingClientRect();
            const searchTargetRect = searchTargetTrigger?.getBoundingClientRect();
            const searchActionsRect = searchActions?.getBoundingClientRect();
            const isRenderedVisible = (element) => {
                if (!(element instanceof HTMLElement) || element.hidden) {
                    return false;
                }

                const styles = getComputedStyle(element);
                if (styles.display === 'none' || styles.visibility === 'hidden') {
                    return false;
                }

                return element.offsetParent !== null || element.getClientRects().length > 0;
            };
            const cards = Array.from(
                document.querySelectorAll('#widget-root .homepage-widget-card[data-widget-id]')
            ).filter((card) => isRenderedVisible(card));
            return {
                widget_root_present: Boolean(widgetRoot),
                edit_button_present: Boolean(editButton),
                management_menu_present: manageMenu instanceof HTMLDetailsElement,
                management_menu_collapsed_by_default: manageMenu instanceof HTMLDetailsElement && !manageMenu.open,
                management_menu_contains_layout_actions: manageMenu instanceof HTMLElement
                    && manageMenu.contains(editButton)
                    && manageMenu.contains(settingsButton),
                search_actions_keep_search_controls_only: searchActions instanceof HTMLElement
                    && Boolean(searchActions.querySelector('#ai-toggle-btn'))
                    && !Boolean(searchActions.querySelector('#open-settings'))
                    && !searchActions.textContent?.includes('侧栏')
                    && !searchActions.contains(editButton),
                ai_toggle_single_label: aiToggle instanceof HTMLElement
                    && aiToggle.textContent?.trim() === 'AI'
                    && aiToggle.querySelectorAll('.ai-toggle-icon').length === 1
                    && aiToggle.querySelectorAll('.ai-toggle-text').length === 0,
                ai_toggle_matches_target_button_size: Boolean(aiToggleRect && searchTargetRect)
                    && Math.abs(aiToggleRect.height - searchTargetRect.height) <= 1
                    && Math.abs(aiToggleRect.width - searchTargetRect.width) <= 2,
                ai_visual_shell_matches_target_button_size: Boolean(searchActionsRect && searchTargetRect)
                    && Math.abs(searchActionsRect.height - searchTargetRect.height) <= 1
                    && Math.abs(searchActionsRect.width - searchTargetRect.width) <= 2,
                ai_toggle_rect: aiToggleRect ? { width: aiToggleRect.width, height: aiToggleRect.height } : null,
                search_target_rect: searchTargetRect ? { width: searchTargetRect.width, height: searchTargetRect.height } : null,
                search_actions_rect: searchActionsRect ? { width: searchActionsRect.width, height: searchActionsRect.height } : null,
                manage_trigger_label: manageTrigger instanceof HTMLElement
                    && manageTrigger.getAttribute('aria-label') === '打开页面管理菜单',
                panel_present: Boolean(panel),
                visible_widget_ids: cards.map((card) => card.getAttribute('data-widget-id')).filter(Boolean),
            };
        }"""
    )
    return state if isinstance(state, dict) else {}


def read_homepage_manage_menu_interaction_state(page: Page) -> dict:
    state = page.evaluate(
        """() => {
            const menu = document.querySelector('#homepage-manage-menu');
            const trigger = document.querySelector('#homepage-manage-trigger');
            const editButton = document.querySelector('#toggle-widget-edit-mode');
            const panel = document.querySelector('#widget-panel');
            const saveButton = document.querySelector('#save-widget-layout');
            const panelTitle = panel?.querySelector('.widget-panel-title');
            const panelStatus = panel?.querySelector('#widget-panel-status');
            const popover = document.querySelector('.homepage-manage-popover');
            const items = Array.from(document.querySelectorAll('.homepage-manage-item'));
            const outsideTarget = document.querySelector('.outline-search-frame');

            if (!(menu instanceof HTMLDetailsElement) || !(trigger instanceof HTMLElement)) {
                return { menu_present: false };
            }

            menu.open = true;
            if (panel instanceof HTMLElement) panel.hidden = true;
            editButton?.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }));
            const panelRect = panel instanceof HTMLElement ? panel.getBoundingClientRect() : null;
            const popoverRect = popover instanceof HTMLElement ? popover.getBoundingClientRect() : null;
            const itemRects = items.map((item) => item.getBoundingClientRect());
            const editClickOpensWidgetPanel = panel instanceof HTMLElement && !panel.hidden;
            const editModeEntered = document.querySelector('#widget-root')?.dataset.widgetEditMode === 'true';
            const panelIsEditSurface = panel instanceof HTMLElement && panel.dataset.widgetEditSurface === 'true';
            const editButtonKeepsLabel = editButton instanceof HTMLElement && editButton.textContent?.trim() === '编辑布局';
            const saveButtonIsIconOnly = saveButton instanceof HTMLElement
                && saveButton.getAttribute('aria-label') === '保存布局'
                && saveButton.textContent?.trim() === '';
            const viewportHeight = window.innerHeight;
            const panelIsBottomTray = Boolean(panelRect)
                && panelRect.height <= 180
                && panelRect.top >= viewportHeight - 220
                && panelRect.bottom <= viewportHeight + 1;
            const panelHasNoTitleOrStatus = !(panelTitle instanceof HTMLElement)
                && (!(panelStatus instanceof HTMLElement) || panelStatus.hidden || panelStatus.textContent?.trim() === '');
            const panelHasNoInternalScroll = panel instanceof HTMLElement
                && panel.scrollHeight <= panel.clientHeight + 1
                && panel.scrollWidth <= panel.clientWidth + 1;
            const openAfterProgrammaticOpen = menu.open;
            outsideTarget?.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }));
            const closedAfterOutsideClick = !menu.open;

            if (editModeEntered) {
                saveButton?.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }));
            }
            const saveClickExitsEditMode = document.querySelector('#widget-root')?.dataset.widgetEditMode === 'false';
            const saveClickHidesPanel = panel instanceof HTMLElement && panel.hidden;

            menu.open = true;
            document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
            const closedAfterEscape = !menu.open;

            return {
                menu_present: true,
                open_after_programmatic_open: openAfterProgrammaticOpen,
                edit_click_enters_edit_mode: editModeEntered,
                edit_click_opens_widget_panel: editClickOpensWidgetPanel,
                widget_panel_is_edit_surface: panelIsEditSurface,
                widget_panel_is_bottom_tray: panelIsBottomTray,
                widget_panel_has_no_title_or_status: panelHasNoTitleOrStatus,
                widget_panel_has_no_internal_scroll: panelHasNoInternalScroll,
                edit_button_keeps_label: editButtonKeepsLabel,
                save_button_is_icon_only: saveButtonIsIconOnly,
                save_click_exits_edit_mode: saveClickExitsEditMode,
                save_click_hides_widget_panel: saveClickHidesPanel,
                closed_after_outside_click: closedAfterOutsideClick,
                closed_after_escape: closedAfterEscape,
                popover_width: popoverRect?.width ?? 0,
                items_fill_popover: Boolean(popoverRect) && itemRects.every((rect) =>
                    rect.width >= popoverRect.width - 18
                ),
                items_left_aligned: itemRects.every((rect, index) =>
                    index === 0 || Math.abs(rect.left - itemRects[0].left) <= 1
                ),
            };
        }"""
    )
    return state if isinstance(state, dict) else {}


def seed_widget_layout(page: Page, layout: dict) -> None:
    page.evaluate(
        """(nextLayout) => new Promise((resolve) => {
            chrome.storage.local.set({ newtabWidgetLayout: nextLayout }, resolve);
        })""",
        layout,
    )


def read_widget_layout_storage(page: Page) -> dict | None:
    layout = page.evaluate(
        """() => new Promise((resolve) => {
            chrome.storage.local.get(['newtabWidgetLayout'], (items) => {
                resolve(items?.newtabWidgetLayout ?? null);
            });
        })"""
    )
    return layout if isinstance(layout, dict) else None


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
                            searchApiKey: 'mock-key',
                            searchApiModel: 'mock-model',
                            aiSearchEnabled: true,
                            searchRuntimeConfigState: 'valid',
                            searchRuntimeLastTestStatus: 'passed',
                            searchRuntimeLastTestMessage: 'mock connection ok',
                            searchRuntimeLastTestAt: '2026-04-03T00:00:00.000Z',
                            searchRuntimeLastRuntimeErrorMessage: '',
                            searchRuntimeLastRuntimeErrorAt: '',
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


def read_background_foundation_state(page: Page) -> dict:
    background_state = page.evaluate(
        """() => {
            const layer = document.querySelector('#homepage-bubble-layer');
            const bodyStyle = getComputedStyle(document.body);
            const bodyBefore = getComputedStyle(document.body, '::before');
            const bodyAfter = getComputedStyle(document.body, '::after');
            const layerBefore = layer ? getComputedStyle(layer, '::before') : null;
            const layerAfter = layer ? getComputedStyle(layer, '::after') : null;
            const runtimeHandleKey = "__" + "HOMEPAGE_BUBBLE_LAYER" + "__";

            return {
                layerPresent: Boolean(layer),
                hasCanvas: Boolean(layer?.querySelector('canvas')),
                hasRuntimeHandle: Boolean(window[runtimeHandleKey]),
                bodyBackgroundImage: bodyStyle.backgroundImage,
                bodyBeforeBackgroundImage: bodyBefore.backgroundImage,
                bodyAfterBackgroundImage: bodyAfter.backgroundImage,
                layerBeforeBackgroundImage: layerBefore ? layerBefore.backgroundImage : 'none',
                layerAfterBackgroundImage: layerAfter ? layerAfter.backgroundImage : 'none',
                layerPointerEvents: layer ? getComputedStyle(layer).pointerEvents : 'missing',
                layerOpacity: layer ? getComputedStyle(layer).opacity : 'missing',
                layerFilter: layer ? getComputedStyle(layer).filter : 'missing',
            };
        }"""
    )
    return background_state if isinstance(background_state, dict) else {}


def read_illustrated_stage_state(page: Page) -> dict:
    state = page.evaluate(
        """() => {
            const requiredAssets = [
                'bg-ambient',
                'cloud-ribbon',
                'pet-left',
                'pet-right',
                'pet-mini',
            ];
            const assetElements = requiredAssets.map((name) => document.querySelector(`[data-stage-asset="${name}"]`));
            const bubbleElements = Array.from(document.querySelectorAll('[data-stage-bubble]'));
            const allImages = assetElements.filter(Boolean);
            const widgetSlots = Object.fromEntries(
                Array.from(document.querySelectorAll('#widget-root .homepage-widget-card[data-widget-id]'))
                    .map((card) => [card.getAttribute('data-widget-id'), card.getAttribute('data-widget-slot')])
            );
            const decor = document.querySelector('.homepage-stage__decor');
            const todoCard = document.querySelector('#widget-root .homepage-widget-card[data-widget-id="todo"]');
            const todoPet = todoCard?.querySelector('.todo-drawer-toggle__pet');
            const todoPetSrc = todoPet?.getAttribute('src') ?? '';
            const todoPetRect = todoPet?.getBoundingClientRect();
            const todoCardRect = todoCard?.getBoundingClientRect();
            const stagePetLeft = document.querySelector('[data-stage-asset="pet-left"]');
            return {
                stage_present: document.querySelectorAll('#homepage-stage').length === 1,
                stage_asset_count: assetElements.filter(Boolean).length,
                stage_bubble_count: bubbleElements.filter(Boolean).length,
                title_copy_removed: !document.body.textContent?.includes('猫狗搭子新标签页')
                    && !document.body.textContent?.includes('今天想找点什么？'),
                stage_assets_loaded: allImages.every((image) => image instanceof HTMLImageElement && image.complete && image.naturalWidth > 0),
                stage_decor_noninteractive: decor ? getComputedStyle(decor).pointerEvents === 'none' : false,
                stage_pet_left_hidden: stagePetLeft instanceof HTMLElement && getComputedStyle(stagePetLeft).display === 'none',
                paw_cursor_enabled: getComputedStyle(document.body).cursor.includes('paw-cursor-tilted.png'),
                widget_slots: widgetSlots,
                todo_pet_attached: todoPet instanceof HTMLImageElement
                    && (
                        todoPetSrc.endsWith('/assets/hero/pet-groom/pet-groom.png')
                        || todoPetSrc.endsWith('/assets/hero/pet-groom/pet-groom-01.png')
                    ),
                todo_pet_peeks_above_card: Boolean(todoPetRect && todoCardRect)
                    && todoPetRect.bottom > todoCardRect.top
                    && Math.abs((todoPetRect.left + todoPetRect.width / 2) - (todoCardRect.left + todoCardRect.width / 2)) <= 24,
                search_slot_center: widgetSlots.search === 'center',
                calendar_slot_right_lower: widgetSlots.calendar === 'right-lower',
                quicksites_slot_lower_center: widgetSlots.quicksites === 'lower-center',
            };
        }"""
    )
    return state if isinstance(state, dict) else {}


def read_mobile_stage_state(page: Page, extension_url: str) -> dict:
    page.set_viewport_size({"width": 390, "height": 844})
    open_extension_page(page, extension_url)
    wait_for_widget_runtime_ready(page)
    state = page.evaluate(
        """() => {
            const stage = document.querySelector('#homepage-stage');
            const stageRect = stage?.getBoundingClientRect();
            const cards = Array.from(document.querySelectorAll('#widget-root .homepage-widget-card[data-widget-slot]'));
            const visibleCards = cards.filter((card) => {
                const styles = getComputedStyle(card);
                return styles.display !== 'none' && styles.visibility !== 'hidden';
            });
            const bubbles = Array.from(document.querySelectorAll('[data-stage-bubble]'));
            return {
                stage_width_fits_viewport: Boolean(stageRect) && stageRect.width <= window.innerWidth,
                visible_card_count: visibleCards.length,
                visible_cards_relative: visibleCards.every((card) => getComputedStyle(card).position === 'relative'),
                decorative_bubbles_hidden: bubbles.every((bubble) => getComputedStyle(bubble).display === 'none'),
            };
        }"""
    )
    return state if isinstance(state, dict) else {}


def read_widget_transform_state(page: Page) -> dict:
    state = page.evaluate(
        """() => {
            const focusShell = document.querySelector('.homepage-focus-shell');
            const root = document.querySelector('#widget-root');
            const editButton = document.querySelector('#toggle-widget-edit-mode');
            const saveButton = document.querySelector('#save-widget-layout');
            const rootWasOffByDefault = root?.dataset.widgetEditMode === 'false';
            const transformableCards = Array.from(
                document.querySelectorAll(
                    '#widget-root .homepage-widget-card[data-widget-transformable="true"]'
                )
            );
            const requiredControls = ['resize', 'rotate'];
            const dragControls = Array.from(
                document.querySelectorAll('#widget-root [data-widget-transform-control="drag"]')
            );
            const hideButtons = Array.from(
                document.querySelectorAll('#widget-root .homepage-widget-card[data-widget-transformable="true"] [data-widget-action="hide"]')
            );
            const cardsWithOrnaments = transformableCards.filter((card) =>
                card.querySelector('.homepage-widget-card-ornament .widget-note__sticker')
            );
            const ornamentSizesReadable = cardsWithOrnaments.every((card) => {
                const sticker = card.querySelector('.homepage-widget-card-ornament .widget-note__sticker');
                if (!(sticker instanceof HTMLElement)) {
                    return false;
                }

                const rect = sticker.getBoundingClientRect();
                return rect.width >= 56 && rect.height >= 34;
            });
            const ornamentsAlignedNearTitleUpperRight = cardsWithOrnaments.every((card) => {
                const title = card.querySelector('.homepage-widget-card-title');
                const ornament = card.querySelector('.homepage-widget-card-ornament .widget-note__sticker');
                const bodySticker = card.querySelector('.homepage-widget-card-body .widget-note__sticker');
                if (!(title instanceof HTMLElement) || !(ornament instanceof HTMLElement) || bodySticker) {
                    return false;
                }

                const titleRect = title.getBoundingClientRect();
                const ornamentRect = ornament.getBoundingClientRect();
                const cardRect = card.getBoundingClientRect();
                const titleCenter = titleRect.top + titleRect.height / 2;
                const ornamentCenter = ornamentRect.top + ornamentRect.height / 2;
                const ornamentLift = titleCenter - ornamentCenter;
                return ornamentLift >= 2
                    && ornamentLift <= 14
                    && ornamentRect.right >= cardRect.right - 52;
            });
            const editModeVisualState = (() => {
                if (!(editButton instanceof HTMLButtonElement)) {
                    return {
                        stickersHidden: false,
                        rotateAtTopRight: false,
                        hideButtonsCompact: false,
                    };
                }

                editButton.click();
                const stickersHidden = cardsWithOrnaments.every((card) => {
                    const sticker = card.querySelector('.homepage-widget-card-ornament .widget-note__sticker');
                    return sticker instanceof HTMLElement && getComputedStyle(sticker).display === 'none';
                });
                const rotateAtTopRight = transformableCards.every((card) => {
                    const rotate = card.querySelector('[data-widget-transform-control="rotate"]');
                    if (!(rotate instanceof HTMLElement)) {
                        return false;
                    }

                    const cardRect = card.getBoundingClientRect();
                    const rotateRect = rotate.getBoundingClientRect();
                    const rotateCenterX = rotateRect.left + rotateRect.width / 2;
                    const rotateCenterY = rotateRect.top + rotateRect.height / 2;
                    return Math.abs(rotateCenterX - cardRect.right) <= 10
                        && Math.abs(rotateCenterY - cardRect.top) <= 10;
                });
                const hideButtonsCompact = hideButtons.every((button) => {
                    if (!(button instanceof HTMLElement)) {
                        return false;
                    }

                    const rect = button.getBoundingClientRect();
                    return rect.width <= 26 && rect.height <= 26;
                });
                saveButton?.click();
                return {
                    stickersHidden,
                    rotateAtTopRight,
                    hideButtonsCompact,
                };
            })();
            const shellRect = focusShell?.getBoundingClientRect();
            const rootRect = root?.getBoundingClientRect();
            const viewportCenterX = window.innerWidth / 2;
            const shellCenterDelta = shellRect
                ? Math.abs((shellRect.left + shellRect.width / 2) - viewportCenterX)
                : 9999;
            const rootCenterDelta = rootRect
                ? Math.abs((rootRect.left + rootRect.width / 2) - viewportCenterX)
                : 9999;

            return {
                edit_button_present: editButton instanceof HTMLButtonElement,
                root_edit_mode_off_by_default: rootWasOffByDefault && root?.dataset.widgetEditMode === 'false',
                transformable_count: transformableCards.length,
                every_transformable_has_controls: transformableCards.every((card) =>
                    requiredControls.every((control) =>
                        Boolean(card.querySelector(`[data-widget-transform-control="${control}"]`))
                    )
                ),
                controls_hidden_by_default: transformableCards.every((card) =>
                    requiredControls.every((control) => {
                        const element = card.querySelector(`[data-widget-transform-control="${control}"]`);
                        return element instanceof HTMLElement && getComputedStyle(element).display === 'none';
                    })
                ),
                drag_controls_absent: dragControls.length === 0,
                hide_buttons_hidden_by_default: hideButtons.every((button) =>
                    button instanceof HTMLElement && getComputedStyle(button).display === 'none'
                ),
                stickers_hidden_in_edit_mode: editModeVisualState.stickersHidden,
                rotate_controls_at_top_right_vertex: editModeVisualState.rotateAtTopRight,
                hide_buttons_compact_in_edit_mode: editModeVisualState.hideButtonsCompact,
                stickers_moved_to_header_ornaments: cardsWithOrnaments.length === transformableCards.length,
                sticker_sizes_readable: ornamentSizesReadable,
                stickers_aligned_near_title_upper_right: ornamentsAlignedNearTitleUpperRight,
                focus_shell_centered: shellCenterDelta <= 1,
                widget_root_centered: rootCenterDelta <= 1,
                shell_center_delta: shellCenterDelta,
                root_center_delta: rootCenterDelta,
            };
        }"""
    )
    return state if isinstance(state, dict) else {}


def exercise_widget_transform_controls(page: Page) -> dict:
    card_selector = "#widget-root .homepage-widget-card[data-widget-id='quicksites']"
    todo_card_selector = "#widget-root .homepage-widget-card[data-widget-id='todo']"
    page.locator(card_selector).wait_for(state="visible", timeout=10000)
    page.evaluate("() => { const menu = document.querySelector('#homepage-manage-menu'); if (menu) menu.open = true; }")
    page.locator("#toggle-widget-edit-mode").click()
    page.wait_for_function(
        """() => document.querySelector('#widget-root')?.dataset.widgetEditMode === 'true'""",
        timeout=5000,
    )

    def drag_control(control: str, delta_x: int, delta_y: int) -> None:
        locator = page.locator(f"{card_selector} [data-widget-transform-control='{control}']")
        box = locator.bounding_box()
        assert box is not None, f"expected {control} transform control box"
        start_x = box["x"] + box["width"] / 2
        start_y = box["y"] + box["height"] / 2
        page.mouse.move(start_x, start_y)
        page.mouse.down()
        page.mouse.move(start_x + delta_x, start_y + delta_y, steps=6)
        page.mouse.up()
        page.wait_for_timeout(250)

    card_box = page.locator(card_selector).bounding_box()
    assert card_box is not None, "expected card box for hover drag"
    start_x = card_box["x"] + card_box["width"] / 2
    start_y = card_box["y"] + 44
    page.mouse.move(start_x, start_y)
    page.mouse.down()
    page.mouse.move(start_x + 36, start_y + 24, steps=6)
    page.mouse.up()
    page.wait_for_timeout(250)
    drag_control("resize", 42, 0)
    drag_control("rotate", 30, -40)

    todo_pet_box = page.locator(f"{todo_card_selector} .todo-drawer-toggle").bounding_box()
    assert todo_pet_box is not None, "expected todo pet trigger box for edit-mode drag"
    todo_start_x = todo_pet_box["x"] + todo_pet_box["width"] / 2
    todo_start_y = todo_pet_box["y"] + todo_pet_box["height"] / 2
    page.mouse.move(todo_start_x, todo_start_y)
    page.mouse.down()
    page.mouse.move(todo_start_x + 34, todo_start_y + 22, steps=6)
    page.mouse.up()
    page.wait_for_timeout(250)
    todo_stayed_collapsed_in_edit_drag = (
        page.locator("[data-todo-drawer]").get_attribute("aria-hidden") == "true"
        and page.locator(f"{todo_card_selector} .todo-drawer-toggle").get_attribute("aria-expanded") == "false"
    )

    page.locator("#save-widget-layout").click()
    page.wait_for_function(
        """() => document.querySelector('#widget-root')?.dataset.widgetEditMode === 'false'""",
        timeout=5000,
    )

    page.wait_for_function(
        """() => new Promise((resolve) => {
            chrome.storage.local.get(['newtabWidgetLayout'], (items) => {
                const transform = items?.newtabWidgetLayout?.widgetPrefs?.quicksites?.stageTransform;
                const todoTransform = items?.newtabWidgetLayout?.widgetPrefs?.todo?.stageTransform;
                resolve(Boolean(
                    transform
                    && Math.abs(Number(transform.offsetX)) > 0
                    && Math.abs(Number(transform.offsetY)) > 0
                    && Number(transform.width) > 0
                    && Math.abs(Number(transform.rotation)) > 0
                    && todoTransform
                    && Math.abs(Number(todoTransform.offsetX)) > 0
                    && Math.abs(Number(todoTransform.offsetY)) > 0
                ));
            });
        })""",
        timeout=5000,
    )
    layout = read_widget_layout_storage(page) or {}
    transform = (
        layout.get("widgetPrefs", {})
        .get("quicksites", {})
        .get("stageTransform", {})
    )
    todo_transform = (
        layout.get("widgetPrefs", {})
        .get("todo", {})
        .get("stageTransform", {})
    )
    return {
        "edit_mode_entered": page.locator("#toggle-widget-edit-mode").get_attribute("aria-pressed") == "false",
        "controls_hidden_after_exit": page.locator(
            f"{card_selector} [data-widget-transform-control='rotate']"
        ).evaluate("(element) => getComputedStyle(element).display === 'none'"),
        "quicksites_transform_saved": bool(transform),
        "quicksites_drag_saved": abs(float(transform.get("offsetX", 0))) > 0 and abs(float(transform.get("offsetY", 0))) > 0,
        "quicksites_resize_saved": float(transform.get("width", 0)) > 0,
        "quicksites_rotation_saved": abs(float(transform.get("rotation", 0))) > 0,
        "quicksites_transform": transform,
        "todo_pet_drag_saved": abs(float(todo_transform.get("offsetX", 0))) > 0 and abs(float(todo_transform.get("offsetY", 0))) > 0,
        "todo_pet_drag_did_not_open_drawer": todo_stayed_collapsed_in_edit_drag,
        "todo_transform": todo_transform,
    }


def exercise_todo_manager(page: Page, extension_url: str) -> dict:
    result = {
        "modules_present": (
            (ROOT / "src" / "pages" / "newtab" / "widgets" / "todo" / "todo-constants.mjs").exists()
            and (ROOT / "src" / "pages" / "newtab" / "widgets" / "todo" / "todo-model.mjs").exists()
            and (ROOT / "src" / "pages" / "newtab" / "widgets" / "todo" / "todo-storage.mjs").exists()
            and (ROOT / "src" / "pages" / "newtab" / "widgets" / "todo" / "todo-view.mjs").exists()
            and (ROOT / "src" / "pages" / "newtab" / "widgets" / "todo" / "todo-controller.mjs").exists()
        ),
        "manager_present": False,
        "drawer_collapsed_by_default": False,
        "pet_groom_frames_present": False,
        "pet_groom_animation_advances": False,
        "pet_idle_without_today_tasks": False,
        "pet_animates_with_today_tasks": False,
        "pet_returns_idle_after_today_done": False,
        "drawer_opens_from_pet_trigger": False,
        "closed_state_hides_todo_card": False,
        "open_state_hides_trigger_pet": False,
        "peek_pet_appears_from_drawer": False,
        "peek_pet_click_collapses_drawer": False,
        "icon_add_button_aligned_with_filters": False,
        "priority_uses_color_without_visible_text": False,
        "list_and_editor_are_separate": False,
        "controls_present_after_open_create": False,
        "add_task_visible": False,
        "storage_after_add_contains_task": False,
        "task_persists_after_reload": False,
        "overdue_filter_shows_active_overdue_task": False,
        "completed_filter_shows_completed_task": False,
        "delete_removes_task": False,
        "clear_completed_removes_completed_tasks": False,
    }

    page.evaluate(
        """() => new Promise((resolve) => {
            chrome.storage.local.remove(['newtabTodoTasks'], resolve);
        })"""
    )
    page.goto(extension_url, wait_until="domcontentloaded")
    page.wait_for_load_state("networkidle")
    wait_for_extension_ready(page)
    wait_for_widget_runtime_ready(page)

    result["manager_present"] = page.locator("[data-todo-manager]").count() == 1
    if not result["manager_present"]:
        return result

    result["pet_groom_frames_present"] = all(
        (ROOT / "src" / "pages" / "newtab" / "assets" / "hero" / "pet-groom" / f"pet-groom-{index:02d}.png").exists()
        for index in range(1, 9)
    ) and (ROOT / "src" / "pages" / "newtab" / "assets" / "hero" / "pet-groom" / "pet-groom.png").exists()
    with Image.open(ROOT / "src" / "pages" / "newtab" / "assets" / "hero" / "pet-groom" / "pet-groom.png") as pet_groom_apng:
        result["pet_groom_animation_advances"] = getattr(pet_groom_apng, "n_frames", 1) == 8
    result["pet_idle_without_today_tasks"] = page.evaluate(
        """() => {
            const root = document.querySelector('[data-todo-manager]');
            const pet = document.querySelector('.todo-drawer-toggle__pet');
            return root instanceof HTMLElement
                && pet instanceof HTMLImageElement
                && root.dataset.todoHasTodayTasks === 'false'
                && pet.getAttribute('src')?.endsWith('/assets/hero/pet-groom/pet-groom-01.png');
        }"""
    )

    result["drawer_collapsed_by_default"] = (
        page.locator("[data-todo-drawer]").get_attribute("aria-hidden") == "true"
        and page.locator(".todo-drawer-toggle").get_attribute("aria-expanded") == "false"
    )
    page.wait_for_function(
        """() => {
            const card = document.querySelector('#widget-root .homepage-widget-card[data-widget-id="todo"]');
            const header = card?.querySelector('.homepage-widget-card-header');
            const drawer = card?.querySelector('[data-todo-drawer]');
            const trigger = card?.querySelector('.todo-drawer-toggle');
            return card instanceof HTMLElement
                && header instanceof HTMLElement
                && drawer instanceof HTMLElement
                && trigger instanceof HTMLElement
                && getComputedStyle(header).opacity === '0'
                && drawer.getAttribute('aria-hidden') === 'true'
                && getComputedStyle(trigger).visibility !== 'hidden';
        }""",
        timeout=5000,
    )
    result["closed_state_hides_todo_card"] = page.evaluate(
        """() => {
            const card = document.querySelector('#widget-root .homepage-widget-card[data-widget-id="todo"]');
            const header = card?.querySelector('.homepage-widget-card-header');
            const drawer = card?.querySelector('[data-todo-drawer]');
            const trigger = card?.querySelector('.todo-drawer-toggle');
            return card instanceof HTMLElement
                && header instanceof HTMLElement
                && drawer instanceof HTMLElement
                && trigger instanceof HTMLElement
                && getComputedStyle(header).opacity === '0'
                && drawer.getAttribute('aria-hidden') === 'true'
                && getComputedStyle(trigger).visibility !== 'hidden';
        }"""
    )
    page.locator(".todo-drawer-toggle").click()
    page.wait_for_function(
        """() => document.querySelector('[data-todo-drawer]')?.getAttribute('aria-hidden') === 'false'""",
        timeout=5000,
    )
    page.wait_for_timeout(360)
    result["drawer_opens_from_pet_trigger"] = (
        page.locator(".todo-drawer-toggle").get_attribute("aria-expanded") == "true"
    )
    result["open_state_hides_trigger_pet"] = page.evaluate(
        """() => {
            const trigger = document.querySelector('.todo-drawer-toggle');
            return trigger instanceof HTMLElement
                && getComputedStyle(trigger).visibility === 'hidden'
                && getComputedStyle(trigger).pointerEvents === 'none';
        }"""
    )
    result["peek_pet_appears_from_drawer"] = page.evaluate(
        """() => {
            const card = document.querySelector('#widget-root .homepage-widget-card[data-widget-id="todo"]');
            const peek = card?.querySelector('.widget-note__pet-peek');
            const panel = card?.querySelector('[data-todo-panel="list"]');
            if (!(card instanceof HTMLElement) || !(peek instanceof HTMLImageElement) || !(panel instanceof HTMLElement)) {
                return false;
            }
            const peekRect = peek.getBoundingClientRect();
            const panelRect = panel.getBoundingClientRect();
            return peek.getAttribute('src')?.endsWith('/assets/hero/pet-left-peek.png')
                && getComputedStyle(peek).opacity !== '0'
                && peekRect.top < panelRect.top
                && peekRect.bottom > panelRect.top;
        }"""
    )
    page.locator(".widget-note__pet-peek-button").click()
    page.wait_for_function(
        """() => document.querySelector('[data-todo-drawer]')?.getAttribute('aria-hidden') === 'true'""",
        timeout=5000,
    )
    result["peek_pet_click_collapses_drawer"] = page.evaluate(
        """() => {
            const drawer = document.querySelector('[data-todo-drawer]');
            const trigger = document.querySelector('.todo-drawer-toggle');
            const triggerPet = document.querySelector('.todo-drawer-toggle__pet');
            return drawer instanceof HTMLElement
                && trigger instanceof HTMLElement
                && triggerPet instanceof HTMLImageElement
                && drawer.getAttribute('aria-hidden') === 'true'
                && trigger.getAttribute('aria-expanded') === 'false'
                && getComputedStyle(trigger).visibility !== 'hidden'
                && triggerPet.getAttribute('src')?.endsWith('/assets/hero/pet-groom/pet-groom-01.png');
        }"""
    )
    page.locator(".todo-drawer-toggle").click()
    page.wait_for_function(
        """() => document.querySelector('[data-todo-drawer]')?.getAttribute('aria-hidden') === 'false'""",
        timeout=5000,
    )
    page.wait_for_timeout(360)
    result["icon_add_button_aligned_with_filters"] = page.evaluate(
        """() => {
            const add = document.querySelector('[data-todo-action="open-create"]');
            const filters = document.querySelector('.todo-filter-list');
            if (!(add instanceof HTMLElement) || !(filters instanceof HTMLElement)) {
                return false;
            }
            const addRect = add.getBoundingClientRect();
            const filtersRect = filters.getBoundingClientRect();
            return add.textContent?.trim() === '+'
                && Math.abs((addRect.top + addRect.height / 2) - (filtersRect.top + filtersRect.height / 2)) <= 8
                && addRect.left >= filtersRect.right;
        }"""
    )

    result["list_and_editor_are_separate"] = (
        page.locator("[data-todo-panel='list']").is_visible()
        and page.locator("[data-todo-panel='editor']").is_hidden()
    )
    page.locator("[data-todo-action='open-create']").click()

    title_input = page.locator("[data-todo-input='title']")
    priority_input = page.locator("[data-todo-input='priority']")
    due_input = page.locator("[data-todo-input='dueDate']")
    add_button = page.locator("[data-todo-action='add']")
    result["controls_present_after_open_create"] = (
        title_input.count() == 1
        and priority_input.count() == 1
        and due_input.count() == 1
        and add_button.count() == 1
        and page.locator("[data-todo-panel='list']").is_hidden()
        and page.locator("[data-todo-panel='editor']").is_visible()
    )
    if not result["controls_present_after_open_create"]:
        return result

    today_title = "Verifier today task"
    active_title = "Verifier active overdue task"
    completed_title = "Verifier completed task"
    delete_title = "Verifier delete task"
    today_date = page.evaluate(
        """() => {
            const now = new Date();
            return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
        }"""
    )

    title_input.fill(today_title)
    priority_input.select_option("medium")
    due_input.fill(today_date)
    add_button.click()
    page.locator("[data-todo-task-title]", has_text=today_title).wait_for(state="visible", timeout=5000)
    result["pet_animates_with_today_tasks"] = page.evaluate(
        """() => {
            const root = document.querySelector('[data-todo-manager]');
            const pet = document.querySelector('.todo-drawer-toggle__pet');
            return root instanceof HTMLElement
                && pet instanceof HTMLImageElement
                && root.dataset.todoHasTodayTasks === 'true'
                && pet.getAttribute('src')?.endsWith('/assets/hero/pet-groom/pet-groom.png');
        }"""
    )
    page.locator("[data-todo-task]", has_text=today_title).first.locator("[data-todo-action='toggle']").click()
    page.wait_for_timeout(150)
    result["pet_returns_idle_after_today_done"] = page.evaluate(
        """() => {
            const root = document.querySelector('[data-todo-manager]');
            const pet = document.querySelector('.todo-drawer-toggle__pet');
            return root instanceof HTMLElement
                && pet instanceof HTMLImageElement
                && root.dataset.todoHasTodayTasks === 'false'
                && pet.getAttribute('src')?.endsWith('/assets/hero/pet-groom/pet-groom-01.png');
        }"""
    )
    page.locator("[data-todo-action='open-create']").click()

    title_input.fill(active_title)
    priority_input.select_option("high")
    due_input.fill("2000-01-01")
    add_button.click()
    page.locator("[data-todo-task-title]", has_text=active_title).wait_for(state="visible", timeout=5000)
    result["add_task_visible"] = True
    result["priority_uses_color_without_visible_text"] = page.evaluate(
        """() => {
            const task = Array.from(document.querySelectorAll('[data-todo-task]'))
                .find((row) => row.textContent?.includes('Verifier active overdue task'));
            const marker = task?.querySelector('.todo-priority-marker[data-priority="high"]');
            const text = task?.textContent ?? '';
            return marker instanceof HTMLElement
                && getComputedStyle(marker).backgroundColor !== 'rgba(0, 0, 0, 0)'
                && !text.includes('高优先级')
                && !text.includes('中优先级')
                && !text.includes('低优先级')
                && !/高|中|低/.test(text.replace('Verifier active overdue task', ''));
        }"""
    )

    stored_after_add = page.evaluate(
        """() => new Promise((resolve) => {
            chrome.storage.local.get(['newtabTodoTasks'], (items) => resolve(items.newtabTodoTasks ?? null));
        })"""
    )
    result["storage_after_add_contains_task"] = (
        isinstance(stored_after_add, dict)
        and any(task.get("title") == active_title for task in stored_after_add.get("tasks", []))
    )

    page.goto(extension_url, wait_until="domcontentloaded")
    page.wait_for_load_state("networkidle")
    wait_for_extension_ready(page)
    wait_for_widget_runtime_ready(page)
    page.locator(".todo-drawer-toggle").click()
    page.wait_for_function(
        """() => document.querySelector('[data-todo-drawer]')?.getAttribute('aria-hidden') === 'false'""",
        timeout=5000,
    )
    result["task_persists_after_reload"] = page.locator("[data-todo-task-title]", has_text=active_title).count() == 1

    page.locator("[data-todo-filter='overdue']").click()
    result["overdue_filter_shows_active_overdue_task"] = (
        page.locator("[data-todo-task-title]", has_text=active_title).count() == 1
    )

    page.locator("[data-todo-filter='all']").click()
    page.locator("[data-todo-task]", has_text=active_title).first.locator("[data-todo-action='toggle']").click()
    page.locator("[data-todo-filter='completed']").click()
    result["completed_filter_shows_completed_task"] = (
        page.locator("[data-todo-task-title]", has_text=active_title).count() == 1
    )

    page.locator("[data-todo-filter='all']").click()
    page.locator("[data-todo-action='open-create']").click()
    title_input.fill(delete_title)
    priority_input.select_option("low")
    due_input.fill("")
    add_button.click()
    page.locator("[data-todo-task-title]", has_text=delete_title).wait_for(state="visible", timeout=5000)
    page.locator("[data-todo-task]", has_text=delete_title).first.locator("[data-todo-action='edit']").click()
    page.locator("[data-todo-action='delete']").click()
    page.wait_for_timeout(150)
    stored_after_delete = page.evaluate(
        """() => new Promise((resolve) => {
            chrome.storage.local.get(['newtabTodoTasks'], (items) => resolve(items.newtabTodoTasks ?? null));
        })"""
    )
    result["delete_removes_task"] = (
        isinstance(stored_after_delete, dict)
        and all(task.get("title") != delete_title for task in stored_after_delete.get("tasks", []))
        and page.locator("[data-todo-task-title]", has_text=delete_title).count() == 0
    )

    page.locator("[data-todo-action='open-create']").click()
    title_input.fill(completed_title)
    priority_input.select_option("medium")
    due_input.fill("")
    add_button.click()
    page.locator("[data-todo-task-title]", has_text=completed_title).wait_for(state="visible", timeout=5000)
    page.locator("[data-todo-task]", has_text=completed_title).first.locator("[data-todo-action='toggle']").click()
    page.locator("[data-todo-action='clear-completed']").click()
    page.wait_for_timeout(150)
    stored_after_clear = page.evaluate(
        """() => new Promise((resolve) => {
            chrome.storage.local.get(['newtabTodoTasks'], (items) => resolve(items.newtabTodoTasks ?? null));
        })"""
    )
    result["clear_completed_removes_completed_tasks"] = (
        isinstance(stored_after_clear, dict)
        and all(
            task.get("title") not in {today_title, active_title, completed_title}
            for task in stored_after_clear.get("tasks", [])
        )
    )

    return result



def read_search_outline_alignment_state(page: Page) -> dict:
    alignment_state = page.evaluate(
        """() => {
            const frame = document.querySelector('.outline-search-frame');
            const outlineSvg = document.querySelector('.outline-search-outline');
            const outline = document.querySelector('.outline-search-outline-rect');
            if (!(frame instanceof HTMLElement) || !(outlineSvg instanceof SVGSVGElement) || !(outline instanceof SVGRectElement)) {
                return {
                    framePresent: frame instanceof HTMLElement,
                    outlineSvgPresent: outlineSvg instanceof SVGSVGElement,
                    outlinePresent: outline instanceof SVGRectElement,
                };
            }

            const frameRect = frame.getBoundingClientRect();
            const outlineSvgRect = outlineSvg.getBoundingClientRect();
            const frameStyles = getComputedStyle(frame);
            const frameBorderWidth = Number.parseFloat(frameStyles.borderTopWidth) || 0;
            const frameRadius = Number.parseFloat(frameStyles.borderTopLeftRadius) || 0;
            const outlineX = Number.parseFloat(outline.getAttribute('x') || '0');
            const outlineY = Number.parseFloat(outline.getAttribute('y') || '0');
            const outlineWidth = Number.parseFloat(outline.getAttribute('width') || '0');
            const outlineHeight = Number.parseFloat(outline.getAttribute('height') || '0');
            const outlineRadius = Number.parseFloat(outline.getAttribute('rx') || '0');
            const outlineStyles = getComputedStyle(outline);
            const outlineStrokeWidth = Number.parseFloat(outlineStyles.strokeWidth) || 0;
            const outlineStroke = outlineStyles.stroke;
            const expectedInset = frameBorderWidth / 2;
            const expectedWidth = Math.max(0, frameRect.width - frameBorderWidth);
            const expectedHeight = Math.max(0, frameRect.height - frameBorderWidth);
            const expectedRadius = Math.max(0, frameRadius - frameBorderWidth / 2);
            const epsilon = 0.75;
            const svgBoxLeftAligned = Math.abs(outlineSvgRect.left - frameRect.left) <= epsilon;
            const svgBoxTopAligned = Math.abs(outlineSvgRect.top - frameRect.top) <= epsilon;
            const svgBoxWidthAligned = Math.abs(outlineSvgRect.width - frameRect.width) <= epsilon;
            const svgBoxHeightAligned = Math.abs(outlineSvgRect.height - frameRect.height) <= epsilon;

            return {
                framePresent: true,
                outlineSvgPresent: true,
                outlinePresent: true,
                frameBorderWidth,
                frameBorderColor: frameStyles.borderTopColor,
                frameBorderStyle: frameStyles.borderTopStyle,
                frameWidth: frameRect.width,
                frameHeight: frameRect.height,
                frameRadius,
                outlineSvgLeft: outlineSvgRect.left,
                outlineSvgTop: outlineSvgRect.top,
                outlineSvgWidth: outlineSvgRect.width,
                outlineSvgHeight: outlineSvgRect.height,
                outlineX,
                outlineY,
                outlineWidth,
                outlineHeight,
                outlineRadius,
                svgBoxLeftAligned,
                svgBoxTopAligned,
                svgBoxWidthAligned,
                svgBoxHeightAligned,
                svgBoxAligned: svgBoxLeftAligned && svgBoxTopAligned && svgBoxWidthAligned && svgBoxHeightAligned,
                xAligned: Math.abs(outlineX - expectedInset) <= epsilon,
                yAligned: Math.abs(outlineY - expectedInset) <= epsilon,
                widthAligned: Math.abs(outlineWidth - expectedWidth) <= epsilon,
                heightAligned: Math.abs(outlineHeight - expectedHeight) <= epsilon,
                radiusAligned: Math.abs(outlineRadius - expectedRadius) <= epsilon,
                outlineVisible: outlineStrokeWidth > 0 && outlineStroke !== 'rgba(0, 0, 0, 0)',
                frameBorderVisible: frameStyles.borderTopStyle !== 'none' && frameBorderWidth > 0 && frameStyles.borderTopColor !== 'rgba(0, 0, 0, 0)',
            };
        }"""
    )
    return alignment_state if isinstance(alignment_state, dict) else {}


def assert_required_checks(result: dict) -> None:
    required_checks = [
        ("redirect_ok", result["redirect_ok"] or result["extension_page_open_ok"]),
        ("extension_page_open_ok", result["extension_page_open_ok"]),
        ("search_input_enabled", result["search_input_enabled"]),
        ("background_layer_present", result["background_layer_present"]),
        ("background_has_no_canvas", result["background_has_no_canvas"]),
        ("background_has_no_runtime_handle", result["background_has_no_runtime_handle"]),
        ("background_layer_noninteractive", result["background_layer_noninteractive"]),
        ("background_has_texture_overlay", result["background_has_texture_overlay"]),
        ("background_has_focus_overlay", result["background_has_focus_overlay"]),
        ("illustrated_stage_present", result["illustrated_stage"].get("stage_present")),
        ("illustrated_stage_assets_present", result["illustrated_stage"].get("stage_asset_count") == 5),
        ("illustrated_stage_bubbles_removed", result["illustrated_stage"].get("stage_bubble_count") == 0),
        ("illustrated_stage_title_copy_removed", result["illustrated_stage"].get("title_copy_removed")),
        ("illustrated_stage_assets_loaded", result["illustrated_stage"].get("stage_assets_loaded")),
        ("illustrated_stage_decor_noninteractive", result["illustrated_stage"].get("stage_decor_noninteractive")),
        ("illustrated_stage_paw_cursor_enabled", result["illustrated_stage"].get("paw_cursor_enabled")),
        ("illustrated_stage_pet_left_hidden_as_standalone_decor", result["illustrated_stage"].get("stage_pet_left_hidden")),
        ("todo_pet_attached_to_todo_card", result["illustrated_stage"].get("todo_pet_attached")),
        ("todo_pet_peeks_above_todo_card", result["illustrated_stage"].get("todo_pet_peeks_above_card")),
        ("illustrated_search_slot_center", result["illustrated_stage"].get("search_slot_center")),
        ("illustrated_calendar_slot_right_lower", result["illustrated_stage"].get("calendar_slot_right_lower")),
        ("illustrated_quicksites_slot_lower_center", result["illustrated_stage"].get("quicksites_slot_lower_center")),
        ("mobile_stage_width_fits_viewport", result["mobile_stage"].get("stage_width_fits_viewport")),
        ("mobile_stage_cards_relative", result["mobile_stage"].get("visible_cards_relative")),
        ("mobile_stage_bubbles_hidden", result["mobile_stage"].get("decorative_bubbles_hidden")),
        ("widget_edit_button_present", result["widget_transform"].get("edit_button_present")),
        ("widget_edit_mode_off_by_default", result["widget_transform"].get("root_edit_mode_off_by_default")),
        ("widget_transform_controls_hidden_by_default", result["widget_transform"].get("controls_hidden_by_default")),
        ("widget_drag_controls_absent", result["widget_transform"].get("drag_controls_absent")),
        ("widget_hide_buttons_hidden_by_default", result["widget_transform"].get("hide_buttons_hidden_by_default")),
        ("widget_stickers_hidden_in_edit_mode", result["widget_transform"].get("stickers_hidden_in_edit_mode")),
        ("widget_rotate_controls_at_top_right_vertex", result["widget_transform"].get("rotate_controls_at_top_right_vertex")),
        ("widget_hide_buttons_compact_in_edit_mode", result["widget_transform"].get("hide_buttons_compact_in_edit_mode")),
        ("widget_stickers_moved_to_header_ornaments", result["widget_transform"].get("stickers_moved_to_header_ornaments")),
        ("widget_sticker_sizes_readable", result["widget_transform"].get("sticker_sizes_readable")),
        ("widget_stickers_aligned_near_title_upper_right", result["widget_transform"].get("stickers_aligned_near_title_upper_right")),
        ("widget_transformable_controls_present", result["widget_transform"].get("every_transformable_has_controls")),
        ("widget_transformable_cards_present", result["widget_transform"].get("transformable_count") >= 3),
        ("homepage_focus_shell_centered", result["widget_transform"].get("focus_shell_centered")),
        ("homepage_widget_root_centered", result["widget_transform"].get("widget_root_centered")),
        ("widget_edit_mode_entered_and_exited", result["widget_transform_interaction"].get("edit_mode_entered")),
        ("widget_controls_hidden_after_exit", result["widget_transform_interaction"].get("controls_hidden_after_exit")),
        ("widget_drag_transform_saved", result["widget_transform_interaction"].get("quicksites_drag_saved")),
        ("widget_resize_transform_saved", result["widget_transform_interaction"].get("quicksites_resize_saved")),
        ("widget_rotation_transform_saved", result["widget_transform_interaction"].get("quicksites_rotation_saved")),
        ("todo_pet_edit_drag_saved", result["widget_transform_interaction"].get("todo_pet_drag_saved")),
        ("todo_pet_edit_drag_did_not_open_drawer", result["widget_transform_interaction"].get("todo_pet_drag_did_not_open_drawer")),
        ("widget_edit_modules_present", result.get("widget_edit_modules_present")),
        ("todo_manager_modules_present", result["todo_manager"].get("modules_present")),
        ("todo_manager_present", result["todo_manager"].get("manager_present")),
        ("todo_manager_pet_groom_frames_present", result["todo_manager"].get("pet_groom_frames_present")),
        ("todo_manager_pet_groom_animation_advances", result["todo_manager"].get("pet_groom_animation_advances")),
        ("todo_manager_pet_idle_without_today_tasks", result["todo_manager"].get("pet_idle_without_today_tasks")),
        ("todo_manager_pet_animates_with_today_tasks", result["todo_manager"].get("pet_animates_with_today_tasks")),
        ("todo_manager_pet_returns_idle_after_today_done", result["todo_manager"].get("pet_returns_idle_after_today_done")),
        ("todo_manager_drawer_collapsed_by_default", result["todo_manager"].get("drawer_collapsed_by_default")),
        ("todo_manager_drawer_opens_from_pet_trigger", result["todo_manager"].get("drawer_opens_from_pet_trigger")),
        ("todo_manager_closed_state_hides_todo_card", result["todo_manager"].get("closed_state_hides_todo_card")),
        ("todo_manager_open_state_hides_trigger_pet", result["todo_manager"].get("open_state_hides_trigger_pet")),
        ("todo_manager_peek_pet_appears_from_drawer", result["todo_manager"].get("peek_pet_appears_from_drawer")),
        ("todo_manager_peek_pet_click_collapses_drawer", result["todo_manager"].get("peek_pet_click_collapses_drawer")),
        ("todo_manager_icon_add_button_aligned_with_filters", result["todo_manager"].get("icon_add_button_aligned_with_filters")),
        ("todo_manager_priority_uses_color_without_visible_text", result["todo_manager"].get("priority_uses_color_without_visible_text")),
        ("todo_manager_list_and_editor_are_separate", result["todo_manager"].get("list_and_editor_are_separate")),
        ("todo_manager_controls_present_after_open_create", result["todo_manager"].get("controls_present_after_open_create")),
        ("todo_manager_add_task_visible", result["todo_manager"].get("add_task_visible")),
        ("todo_manager_storage_after_add_contains_task", result["todo_manager"].get("storage_after_add_contains_task")),
        ("todo_manager_task_persists_after_reload", result["todo_manager"].get("task_persists_after_reload")),
        ("todo_manager_overdue_filter_shows_active_overdue_task", result["todo_manager"].get("overdue_filter_shows_active_overdue_task")),
        ("todo_manager_completed_filter_shows_completed_task", result["todo_manager"].get("completed_filter_shows_completed_task")),
        ("todo_manager_delete_removes_task", result["todo_manager"].get("delete_removes_task")),
        ("todo_manager_clear_completed_removes_completed_tasks", result["todo_manager"].get("clear_completed_removes_completed_tasks")),
        ("search_outline_visible", result["search_outline_alignment"].get("outlineVisible")),
        ("search_outline_svg_box_aligned", result["search_outline_alignment"].get("svgBoxAligned")),
        ("search_outline_x_aligned", result["search_outline_alignment"].get("xAligned")),
        ("search_outline_y_aligned", result["search_outline_alignment"].get("yAligned")),
        ("search_outline_width_aligned", result["search_outline_alignment"].get("widthAligned")),
        ("search_outline_height_aligned", result["search_outline_alignment"].get("heightAligned")),
        ("search_outline_radius_aligned", result["search_outline_alignment"].get("radiusAligned")),
        ("widget_root_present", result["widget_runtime"].get("widget_root_present")),
        ("widget_edit_button_present_in_management_menu", result["widget_runtime"].get("edit_button_present")),
        ("homepage_management_menu_present", result["widget_runtime"].get("management_menu_present")),
        ("homepage_management_menu_collapsed_by_default", result["widget_runtime"].get("management_menu_collapsed_by_default")),
        ("homepage_management_menu_contains_layout_actions", result["widget_runtime"].get("management_menu_contains_layout_actions")),
        ("homepage_search_actions_keep_search_controls_only", result["widget_runtime"].get("search_actions_keep_search_controls_only")),
        ("homepage_ai_toggle_single_label", result["widget_runtime"].get("ai_toggle_single_label")),
        ("homepage_ai_toggle_matches_target_button_size", result["widget_runtime"].get("ai_toggle_matches_target_button_size")),
        ("homepage_ai_visual_shell_matches_target_button_size", result["widget_runtime"].get("ai_visual_shell_matches_target_button_size")),
        ("homepage_manage_trigger_label", result["widget_runtime"].get("manage_trigger_label")),
        ("homepage_edit_click_enters_edit_mode", result["homepage_manage_menu"].get("edit_click_enters_edit_mode")),
        ("homepage_edit_click_opens_widget_panel", result["homepage_manage_menu"].get("edit_click_opens_widget_panel")),
        ("homepage_widget_panel_is_edit_surface", result["homepage_manage_menu"].get("widget_panel_is_edit_surface")),
        ("homepage_widget_panel_is_bottom_tray", result["homepage_manage_menu"].get("widget_panel_is_bottom_tray")),
        ("homepage_widget_panel_has_no_title_or_status", result["homepage_manage_menu"].get("widget_panel_has_no_title_or_status")),
        ("homepage_widget_panel_has_no_internal_scroll", result["homepage_manage_menu"].get("widget_panel_has_no_internal_scroll")),
        ("homepage_edit_button_keeps_label", result["homepage_manage_menu"].get("edit_button_keeps_label")),
        ("homepage_save_button_is_icon_only", result["homepage_manage_menu"].get("save_button_is_icon_only")),
        ("homepage_save_click_exits_edit_mode", result["homepage_manage_menu"].get("save_click_exits_edit_mode")),
        ("homepage_save_click_hides_widget_panel", result["homepage_manage_menu"].get("save_click_hides_widget_panel")),
        ("homepage_manage_menu_closes_on_outside_click", result["homepage_manage_menu"].get("closed_after_outside_click")),
        ("homepage_manage_menu_closes_on_escape", result["homepage_manage_menu"].get("closed_after_escape")),
        ("homepage_manage_menu_items_fill_popover", result["homepage_manage_menu"].get("items_fill_popover")),
        ("homepage_manage_menu_items_left_aligned", result["homepage_manage_menu"].get("items_left_aligned")),
        ("widget_search_visible", "search" in result["widget_runtime"].get("visible_widget_ids", [])),
        ("settings_opened", result["settings_opened"]),
        ("settings_closed", result["settings_closed"]),
        ("widget_hide_restore_ok", result["widget_hide_restore_ok"]),
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
        ("ai_runtime_invalid_skips_preview", result["ai_runtime_invalid_skips_preview"]),
        ("search_history_contains_query", result["search_history_contains_query"]),
        ("last_search_query", result["last_search_query"] == "moon tab invalid runtime"),
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



import time


def main() -> None:
    result = {
        "extension_id": "",
        "redirect_url": "",
        "redirect_ok": False,
        "extension_page_open_ok": False,
        "direct_page_url": "",
        "background_foundation": {},
        "background_layer_present": False,
        "background_has_no_canvas": False,
        "background_has_no_runtime_handle": False,
        "background_layer_noninteractive": False,
        "background_has_texture_overlay": False,
        "background_has_focus_overlay": False,
        "illustrated_stage": {},
        "mobile_stage": {},
        "widget_transform": {},
        "widget_transform_interaction": {},
        "todo_manager": {},
        "widget_edit_modules_present": (
            (ROOT / "src" / "pages" / "newtab" / "widgets" / "widget-edit-mode.mjs").exists()
            and (ROOT / "src" / "pages" / "newtab" / "widgets" / "widget-transform.mjs").exists()
        ),
        "search_input_enabled": False,
        "settings_opened": False,
        "settings_closed": False,
        "game_deck_entry_present": False,
        "game_deck_opened": False,
        "game_deck_title_visible": False,
        "game_deck_return_visible": False,
        "game_deck_return_icon_button": False,
        "game_deck_return_icon_centered": False,
        "game_deck_search_visible": False,
        "game_deck_status_visible": False,
        "game_deck_start_visible": False,
        "game_deck_paused_by_default": False,
        "game_deck_pause_mountain_decor_visible": False,
        "game_deck_world_mountain_hidden_while_paused": False,
        "game_deck_world_mountain_removed_after_start": False,
        "game_deck_no_vertical_scroll": False,
        "game_deck_kicker_below_topbar": False,
        "game_deck_started": False,
        "game_deck_pause_title_hidden_after_start": False,
        "game_deck_world_scrolls_horizontally": False,
        "game_deck_world_draggable_horizontally": False,
        "game_deck_search_static_during_world_scroll": False,
        "game_deck_single_grid_layer_while_playing": False,
        "game_deck_ground_line_present": False,
        "game_deck_ground_line_two_cm_from_bottom": False,
        "game_deck_ore_mountain_present": False,
        "game_deck_ore_count_hidden_until_hover": False,
        "game_deck_ore_tooltip_follows_cursor": False,
        "game_deck_ore_cursor_is_mining": False,
        "game_deck_ore_has_no_ridge_lines": False,
        "game_deck_ore_base_open_and_aligned": False,
        "game_deck_ore_click_decreases_count": False,
        "game_deck_ore_outside_click_does_not_mine": False,
        "game_deck_ore_click_spawns_chips": False,
        "game_deck_ore_chips_disappear": False,
        "game_deck_ore_click_spawns_rock_drop": False,
        "game_deck_ore_rock_parabolic": False,
        "game_deck_ore_all_rocks_land_above_ground": False,
        "game_deck_ore_landed_rock_blocks_mining_click": False,
        "game_deck_ore_stage_changes_as_resource_drops": False,
        "game_deck_ore_mountain_taller": False,
        "game_deck_ore_rocks_use_images": False,
        "game_deck_ore_rocks_pile_near_base": False,
        "game_deck_ore_rocks_do_not_overlap_visibly": False,
        "game_deck_miner_stays_at_mountain": False,
        "game_deck_hauler_clears_visible_rocks": False,
        "game_deck_boot_commands_visible": False,
        "game_deck_return_commands_visible": False,
        "game_deck_boot_terminal_unframed": False,
        "game_deck_boot_terminal_has_levels": False,
        "game_deck_boot_terminal_centered": False,
        "game_deck_boot_terminal_game_related": False,
        "game_deck_boot_all_commands_visible_before_nav": False,
        "game_deck_boot_transition_duration_ms": 0,
        "game_deck_interface_not_cyber": False,
        "game_deck_monochrome_line_style": False,
        "game_deck_mountain_line_art": False,
        "game_deck_returned_to_pet_page": False,
        "default_search_ok": False,
        "widget_runtime": {},
        "homepage_manage_menu": {},
        "widget_hide_restore_ok": False,
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
        "ai_runtime_invalid_skips_preview": False,
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
        "search_outline_alignment": {},
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
                game_page_url = f"chrome-extension://{result['extension_id']}/src/pages/game/index.html"

                seed_page = context.new_page()
                open_extension_page(seed_page, expected_extension_url)
                seed_widget_layout(
                    seed_page,
                    {
                        "version": 1,
                        "orderedWidgetIds": ["search", "search", "ghost", "calendar"],
                        "hiddenWidgetIds": ["search", "ghost"],
                        "widgetPrefs": "invalid",
                    },
                )
                seed_page.close()

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
                wait_for_widget_runtime_ready(page)
                widget_runtime = read_widget_runtime_state(page)
                result["widget_runtime"] = widget_runtime
                result["widget_layout_storage"] = read_widget_layout_storage(page)
                assert widget_runtime["widget_root_present"], "expected #widget-root mount"
                assert "search" in widget_runtime["visible_widget_ids"], "expected search core widget to be rendered"
                assert "ghost" not in widget_runtime["visible_widget_ids"], "expected unknown widget removal"
                assert result["widget_layout_storage"] == {
                    "version": 1,
                    "orderedWidgetIds": ["search", "calendar", "quicksites", "todo"],
                    "hiddenWidgetIds": [],
                    "widgetPrefs": {},
                }, "expected malformed widget layout storage rewrite"

                wait_for_extension_ready(page)

                result["direct_page_url"] = page.url
                result["extension_page_open_ok"] = page.url.startswith(expected_extension_url)

                page.evaluate("() => { const menu = document.querySelector('#homepage-manage-menu'); if (menu) menu.open = true; }")
                result["game_deck_entry_present"] = page.locator("#open-game-deck").count() == 1
                assert result["game_deck_entry_present"], "expected #open-game-deck management menu action"
                transition_started_at = time.perf_counter()
                page.locator("#open-game-deck").click()
                page.wait_for_selector(".page-transition-overlay__command", timeout=1000)
                result["game_deck_boot_commands_visible"] = 5 <= page.locator(".page-transition-overlay__command").count() <= 8
                result["game_deck_boot_terminal_unframed"] = page.evaluate(
                    """() => {
                        const overlay = document.querySelector('.page-transition-overlay');
                        const frame = document.querySelector('.page-transition-overlay__frame');
                        const label = document.querySelector('.page-transition-overlay__label');
                        const rect = overlay?.getBoundingClientRect();
                        return Boolean(overlay)
                            && !frame
                            && !label
                            && rect
                            && Math.abs(rect.width - window.innerWidth) <= 2
                            && Math.abs(rect.height - window.innerHeight) <= 2;
                    }"""
                )
                result["game_deck_boot_terminal_has_levels"] = page.evaluate(
                    """() => {
                        const commands = Array.from(document.querySelectorAll('.page-transition-overlay__command'));
                        const levels = new Set(commands.map((command) => command.dataset.level).filter(Boolean));
                        return levels.has('info') && levels.has('success') && levels.has('alert');
                    }"""
                )
                result["game_deck_boot_terminal_centered"] = page.evaluate(
                    """() => {
                        const commands = document.querySelector('.page-transition-overlay__commands');
                        const rect = commands?.getBoundingClientRect();
                        if (!rect) {
                            return false;
                        }

                        const centerDeltaX = Math.abs((rect.left + rect.width / 2) - window.innerWidth / 2);
                        const centerDeltaY = Math.abs((rect.top + rect.height / 2) - window.innerHeight / 2);
                        return centerDeltaX <= 12 && centerDeltaY <= 16;
                    }"""
                )
                result["game_deck_boot_terminal_game_related"] = page.evaluate(
                    """() => {
                        const text = Array.from(document.querySelectorAll('.page-transition-overlay__command'))
                            .map((command) => command.textContent ?? '')
                            .join(' ')
                            .toLowerCase();
                        return ['game', 'deck', 'save', 'sprite', 'level', 'controller', 'asset']
                            .filter((keyword) => text.includes(keyword)).length >= 4;
                    }"""
                )
                assert result["game_deck_boot_commands_visible"], "expected 5 to 8 terminal command lines during game deck transition"
                assert result["game_deck_boot_terminal_unframed"], "expected unframed full-screen terminal transition"
                assert result["game_deck_boot_terminal_has_levels"], "expected info, success, and alert terminal command levels"
                assert result["game_deck_boot_terminal_centered"], "expected terminal command block centered on screen"
                assert result["game_deck_boot_terminal_game_related"], "expected terminal commands to relate to game loading"
                page.wait_for_timeout(2600)
                result["game_deck_boot_all_commands_visible_before_nav"] = page.evaluate(
                    """() => {
                        const commands = Array.from(document.querySelectorAll('.page-transition-overlay__command'));
                        return commands.length > 0
                            && commands.every((command) => getComputedStyle(command).opacity === '1');
                    }"""
                )
                assert result["game_deck_boot_all_commands_visible_before_nav"], "expected every terminal command visible before navigation"
                page.wait_for_url("**/src/pages/game/index.html", timeout=10000)
                result["game_deck_boot_transition_duration_ms"] = round((time.perf_counter() - transition_started_at) * 1000)
                assert 2700 <= result["game_deck_boot_transition_duration_ms"] <= 3600, "expected game deck transition to load for about 3 seconds"
                result["game_deck_opened"] = page.url.endswith("/src/pages/game/index.html")
                page.wait_for_selector("h1:has-text('GAME DECK')", timeout=10000)
                result["game_deck_title_visible"] = page.locator("h1", has_text="GAME DECK").is_visible()
                result["game_deck_return_visible"] = page.locator("#return-pet-page").is_visible()
                result["game_deck_return_icon_button"] = page.evaluate(
                    """() => {
                        const button = document.querySelector('#return-pet-page');
                        const rect = button?.getBoundingClientRect();
                        if (!button || !rect) {
                            return false;
                        }

                        return button.getAttribute('aria-label') === '返回宠物页'
                            && !button.textContent.includes('返回宠物页')
                            && rect.width <= 54
                            && rect.height <= 54
                            && getComputedStyle(button).backgroundColor === 'rgb(255, 255, 255)';
                    }"""
                )
                result["game_deck_return_icon_centered"] = page.evaluate(
                    """() => {
                        const button = document.querySelector('#return-pet-page');
                        const icon = button?.querySelector('.game-deck-back__icon');
                        const buttonRect = button?.getBoundingClientRect();
                        const iconRect = icon?.getBoundingClientRect();
                        if (!buttonRect || !iconRect) {
                            return false;
                        }

                        const buttonCenterX = buttonRect.left + buttonRect.width / 2;
                        const buttonCenterY = buttonRect.top + buttonRect.height / 2;
                        const iconCenterX = iconRect.left + iconRect.width / 2;
                        const iconCenterY = iconRect.top + iconRect.height / 2;
                        return Math.abs(buttonCenterX - iconCenterX) <= 1
                            && Math.abs(buttonCenterY - iconCenterY) <= 1;
                    }"""
                )
                result["game_deck_search_visible"] = page.locator("#game-search-input").is_visible()
                result["game_deck_status_visible"] = page.locator(".game-deck-state", has_text="PAUSED").is_visible()
                result["game_deck_start_visible"] = page.locator("#start-game").is_visible()
                result["game_deck_paused_by_default"] = page.evaluate(
                    "() => document.body.dataset.gameState === 'paused'"
                )
                result["game_deck_pause_mountain_decor_visible"] = page.locator(".game-pause-mountain").is_visible()
                result["game_deck_world_mountain_hidden_while_paused"] = page.locator(".game-world .game-mountain").is_hidden()
                result["game_deck_no_vertical_scroll"] = page.evaluate(
                    "() => document.documentElement.scrollHeight <= window.innerHeight + 1"
                )
                result["game_deck_kicker_below_topbar"] = page.evaluate(
                    """() => {
                        const topbar = document.querySelector('.game-deck-topbar');
                        const kicker = document.querySelector('.game-deck-kicker');
                        const topbarRect = topbar?.getBoundingClientRect();
                        const kickerRect = kicker?.getBoundingClientRect();
                        if (!topbarRect || !kickerRect) {
                            return false;
                        }

                        return kickerRect.top >= topbarRect.bottom + 24;
                    }"""
                )
                result["game_deck_interface_not_cyber"] = page.evaluate(
                    """() => {
                        const body = window.getComputedStyle(document.body);
                        return !document.querySelector('.game-scanlines')
                            && !body.backgroundImage.includes('0, 255, 65')
                            && !body.backgroundImage.includes('0, 243, 255');
                    }"""
                )
                result["game_deck_monochrome_line_style"] = page.evaluate(
                    """() => {
                        const root = getComputedStyle(document.documentElement);
                        const body = getComputedStyle(document.body);
                        const topbar = getComputedStyle(document.querySelector('.game-deck-topbar'));
                        const title = getComputedStyle(document.querySelector('.game-deck-title h1'));
                        return root.getPropertyValue('--game-primary').trim() === '#000'
                            && root.getPropertyValue('--game-bg').trim() === '#fff'
                            && topbar.borderTopColor === 'rgb(0, 0, 0)'
                            && title.textShadow === 'none'
                            && body.backgroundImage.includes('linear-gradient');
                    }"""
                )
                assert result["game_deck_opened"], "expected game deck page to open"
                assert result["game_deck_title_visible"], "expected GAME DECK title"
                assert result["game_deck_return_visible"], "expected return-to-pet-page button"
                assert result["game_deck_return_icon_button"], "expected compact icon-only return button"
                assert result["game_deck_return_icon_centered"], "expected return icon centered in button"
                assert result["game_deck_search_visible"], "expected game deck search input"
                assert result["game_deck_status_visible"], "expected paused game deck status"
                assert result["game_deck_start_visible"], "expected start game button on pause screen"
                assert result["game_deck_paused_by_default"], "expected game deck to be paused by default"
                assert result["game_deck_pause_mountain_decor_visible"], "expected mountain decoration on pause screen"
                assert result["game_deck_world_mountain_hidden_while_paused"], "expected world mountain hidden on pause screen"
                assert result["game_deck_no_vertical_scroll"], "expected game deck page to avoid vertical scroll"
                assert result["game_deck_kicker_below_topbar"], "expected GAME SPACE below the fixed topbar area"
                assert result["game_deck_interface_not_cyber"], "expected game deck page interface to avoid cyber terminal styling"
                assert result["game_deck_monochrome_line_style"], "expected black-white line art game deck interface"
                page.locator("#start-game").click()
                result["game_deck_started"] = page.evaluate(
                    "() => document.body.dataset.gameState === 'playing'"
                )
                result["game_deck_pause_title_hidden_after_start"] = page.locator(".game-deck-title").is_hidden()
                result["game_deck_world_mountain_removed_after_start"] = page.evaluate(
                    "() => document.querySelector('.game-world .game-mountain') === null"
                )
                result["game_deck_no_vertical_scroll"] = page.evaluate(
                    "() => document.documentElement.scrollHeight <= window.innerHeight + 1"
                )
                result["game_deck_world_scrolls_horizontally"] = page.evaluate(
                    """() => {
                        const scene = document.querySelector('.game-scene');
                        const world = document.querySelector('.game-world');
                        if (!scene || !world) {
                            return false;
                        }

                        const sceneStyle = getComputedStyle(scene);
                        return scene.scrollWidth > scene.clientWidth + 300
                            && world.getBoundingClientRect().width > window.innerWidth * 1.6
                            && ['auto', 'scroll'].includes(sceneStyle.overflowX);
                    }"""
                )
                result["game_deck_world_draggable_horizontally"] = page.evaluate(
                    """async () => {
                        const scene = document.querySelector('.game-scene');
                        if (!scene || scene.scrollWidth <= scene.clientWidth) {
                            return false;
                        }

                        scene.scrollLeft = 320;
                        const rect = scene.getBoundingClientRect();
                        const startX = rect.left + rect.width * 0.52;
                        const startY = rect.top + rect.height * 0.5;
                        const before = scene.scrollLeft;

                        scene.dispatchEvent(new PointerEvent('pointerdown', {
                            bubbles: true,
                            pointerId: 7,
                            pointerType: 'mouse',
                            clientX: startX,
                            clientY: startY,
                            button: 0,
                            buttons: 1,
                        }));
                        scene.dispatchEvent(new PointerEvent('pointermove', {
                            bubbles: true,
                            pointerId: 7,
                            pointerType: 'mouse',
                            clientX: startX - 160,
                            clientY: startY,
                            buttons: 1,
                        }));
                        scene.dispatchEvent(new PointerEvent('pointerup', {
                            bubbles: true,
                            pointerId: 7,
                            pointerType: 'mouse',
                            clientX: startX - 160,
                            clientY: startY,
                            button: 0,
                            buttons: 0,
                        }));

                        await new Promise((resolve) => requestAnimationFrame(resolve));
                        return scene.scrollLeft > before + 80;
                    }"""
                )
                result["game_deck_search_static_during_world_scroll"] = page.evaluate(
                    """() => {
                        const scene = document.querySelector('.game-scene');
                        const search = document.querySelector('.game-search');
                        if (!scene || !search) {
                            return false;
                        }

                        const before = search.getBoundingClientRect().left;
                        scene.scrollLeft = 360;
                        const after = search.getBoundingClientRect().left;
                        return scene.scrollLeft > 0 && Math.abs(before - after) <= 1;
                    }"""
                )
                result["game_deck_single_grid_layer_while_playing"] = page.evaluate(
                    """() => {
                        const world = document.querySelector('.game-world');
                        const bodyBackground = getComputedStyle(document.body).backgroundImage;
                        const worldBackground = world ? getComputedStyle(world).backgroundImage : '';
                        return bodyBackground === 'none'
                            && worldBackground.includes('linear-gradient');
                    }"""
                )
                result["game_deck_ground_line_present"] = page.locator(".game-ground-line").is_visible()
                result["game_deck_ground_line_two_cm_from_bottom"] = page.evaluate(
                    """() => {
                        const line = document.querySelector('.game-ground-line');
                        const world = document.querySelector('.game-world');
                        const lineRect = line?.getBoundingClientRect();
                        const worldRect = world?.getBoundingClientRect();
                        if (!lineRect || !worldRect) {
                            return false;
                        }

                        const cssPxPerCm = 96 / 2.54;
                        const distance = worldRect.bottom - (lineRect.top + lineRect.height / 2);
                        return Math.abs(distance - (2 * cssPxPerCm)) <= 3
                            && lineRect.width >= worldRect.width - 2
                            && lineRect.height >= 2;
                    }"""
                )
                result["game_deck_ore_mountain_present"] = page.locator(".ore-mountain").is_visible()
                result["game_deck_ore_count_hidden_until_hover"] = page.evaluate(
                    """async () => {
                        const mountain = document.querySelector('.ore-mountain');
                        const target = mountain?.querySelector(`.ore-mountain__hitbox--${mountain.dataset.stage}`);
                        const tooltip = document.querySelector('.ore-mountain__tooltip');
                        if (!mountain || !target || !tooltip) {
                            return false;
                        }

                        const hiddenBefore = getComputedStyle(tooltip).opacity === '0';
                        const rect = target.getBoundingClientRect();
                        const x = rect.left + rect.width * 0.62;
                        const y = rect.top + rect.height * 0.45;
                        target.dispatchEvent(new PointerEvent('pointerenter', {
                            bubbles: true,
                            pointerId: 21,
                            pointerType: 'mouse',
                            clientX: x,
                            clientY: y,
                        }));
                        target.dispatchEvent(new PointerEvent('pointermove', {
                            bubbles: true,
                            pointerId: 21,
                            pointerType: 'mouse',
                            clientX: x,
                            clientY: y,
                        }));
                        await new Promise((resolve) => requestAnimationFrame(resolve));
                        const visibleOnHover = getComputedStyle(tooltip).opacity === '1'
                            && tooltip.textContent?.trim() === '100';
                        target.dispatchEvent(new PointerEvent('pointerleave', {
                            bubbles: true,
                            pointerId: 21,
                            pointerType: 'mouse',
                            clientX: x,
                            clientY: y,
                        }));
                        await new Promise((resolve) => setTimeout(resolve, 150));
                        const hiddenAfter = getComputedStyle(tooltip).opacity === '0';
                        return hiddenBefore && visibleOnHover && hiddenAfter;
                    }"""
                )
                result["game_deck_ore_tooltip_follows_cursor"] = page.evaluate(
                    """async () => {
                        const mountain = document.querySelector('.ore-mountain');
                        const target = mountain?.querySelector(`.ore-mountain__hitbox--${mountain.dataset.stage}`);
                        const tooltip = document.querySelector('.ore-mountain__tooltip');
                        if (!mountain || !target || !tooltip) {
                            return false;
                        }

                        const rect = target.getBoundingClientRect();
                        const x = rect.left + rect.width * 0.48;
                        const y = rect.top + rect.height * 0.34;
                        target.dispatchEvent(new PointerEvent('pointerenter', {
                            bubbles: true,
                            pointerId: 22,
                            pointerType: 'mouse',
                            clientX: x,
                            clientY: y,
                        }));
                        target.dispatchEvent(new PointerEvent('pointermove', {
                            bubbles: true,
                            pointerId: 22,
                            pointerType: 'mouse',
                            clientX: x,
                            clientY: y,
                        }));
                        await new Promise((resolve) => requestAnimationFrame(resolve));
                        const tooltipRect = tooltip.getBoundingClientRect();
                        return tooltipRect.left >= x + 8
                            && tooltipRect.left <= x + 52
                            && tooltipRect.top <= y + 8
                            && tooltipRect.bottom >= y - 56;
                    }"""
                )
                result["game_deck_ore_cursor_is_mining"] = page.evaluate(
                    """() => {
                        const mountain = document.querySelector('.ore-mountain');
                        return mountain ? getComputedStyle(mountain).cursor === 'crosshair' : false;
                    }"""
                )
                result["game_deck_ore_has_no_ridge_lines"] = page.evaluate(
                    "() => document.querySelectorAll('.ore-mountain__crack').length === 0"
                )
                result["game_deck_ore_base_open_and_aligned"] = page.evaluate(
                    """() => {
                        const art = document.querySelector('.ore-mountain__art');
                        const ground = document.querySelector('.game-ground-line');
                        const visibleShape = Array.from(document.querySelectorAll('.ore-mountain__shape')).find((shape) => {
                            const style = getComputedStyle(shape);
                            return Number.parseFloat(style.opacity) > 0.5;
                        });
                        const artRect = art?.getBoundingClientRect();
                        const groundRect = ground?.getBoundingClientRect();
                        const pathData = visibleShape?.getAttribute('d') ?? '';
                        if (!artRect || !groundRect || !visibleShape) {
                            return false;
                        }

                        return !/[zZ]/.test(pathData)
                            && Math.abs(artRect.bottom - groundRect.top) <= 6;
                    }"""
                )
                result["game_deck_ore_outside_click_does_not_mine"] = page.evaluate(
                    """() => {
                        const mountain = document.querySelector('.ore-mountain');
                        if (!mountain) {
                            return false;
                        }

                        const beforeOre = Number(mountain.dataset.ore);
                        const beforeRocks = document.querySelectorAll('.ore-rock-drop').length;
                        const rect = mountain.getBoundingClientRect();
                        const clickX = rect.left + rect.width * 0.08;
                        const clickY = rect.top + rect.height * 0.14;
                        const hit = document.elementFromPoint(clickX, clickY);

                        if (hit && (hit === mountain || hit.closest('.ore-mountain__shape'))) {
                            return false;
                        }

                        if (hit) {
                            hit.dispatchEvent(new PointerEvent('pointerdown', {
                                bubbles: true,
                                pointerId: 30,
                                pointerType: 'mouse',
                                clientX: clickX,
                                clientY: clickY,
                                button: 0,
                                buttons: 1,
                            }));
                            hit.dispatchEvent(new MouseEvent('click', {
                                bubbles: true,
                                clientX: clickX,
                                clientY: clickY,
                            }));
                        }

                        return Number(mountain.dataset.ore) === beforeOre
                            && document.querySelectorAll('.ore-rock-drop').length === beforeRocks;
                    }"""
                )
                result["game_deck_ore_click_decreases_count"] = page.evaluate(
                    """() => {
                        const mountain = document.querySelector('.ore-mountain');
                        const target = mountain?.querySelector(`.ore-mountain__hitbox--${mountain.dataset.stage}`);
                        if (!mountain || !target) {
                            return false;
                        }

                        const before = Number(mountain.dataset.ore);
                        const rect = target.getBoundingClientRect();
                        target.dispatchEvent(new PointerEvent('pointerdown', {
                            bubbles: true,
                            pointerId: 11,
                            pointerType: 'mouse',
                            clientX: rect.left + rect.width * 0.55,
                            clientY: rect.top + rect.height * 0.55,
                            button: 0,
                            buttons: 1,
                        }));
                        target.dispatchEvent(new PointerEvent('pointerup', {
                            bubbles: true,
                            pointerId: 11,
                            pointerType: 'mouse',
                            clientX: rect.left + rect.width * 0.55,
                            clientY: rect.top + rect.height * 0.55,
                            button: 0,
                            buttons: 0,
                        }));
                        target.dispatchEvent(new MouseEvent('click', {
                            bubbles: true,
                            clientX: rect.left + rect.width * 0.55,
                            clientY: rect.top + rect.height * 0.55,
                        }));

                        return mountain.dataset.ore === String(before - 1)
                            && /剩余 99/.test(mountain.getAttribute('aria-label') ?? '');
                    }"""
                )
                result["game_deck_ore_click_spawns_chips"] = page.evaluate(
                    "() => document.querySelectorAll('.ore-chip').length >= 2 && document.querySelectorAll('.ore-chip').length <= 4"
                )
                result["game_deck_ore_click_spawns_rock_drop"] = page.evaluate(
                    "() => document.querySelectorAll('.ore-rock-drop').length === 1"
                )
                result["game_deck_ore_rock_parabolic"] = page.evaluate(
                    """async () => {
                        const mountain = document.querySelector('.ore-mountain');
                        const target = mountain?.querySelector(`.ore-mountain__hitbox--${mountain.dataset.stage}`);
                        if (!mountain || !target) {
                            return false;
                        }

                        const beforeCount = document.querySelectorAll('.ore-rock-drop').length;
                        const rect = target.getBoundingClientRect();
                        target.dispatchEvent(new MouseEvent('click', {
                            bubbles: true,
                            clientX: rect.left + rect.width * 0.52,
                            clientY: rect.top + rect.height * 0.46,
                        }));

                        const rocks = Array.from(document.querySelectorAll('.ore-rock-drop'));
                        const rock = rocks[rocks.length - 1];
                        if (!rock || rocks.length !== beforeCount + 1) {
                            return false;
                        }

                        const startTop = rock.getBoundingClientRect().top;
                        await new Promise((resolve) => setTimeout(resolve, 140));
                        const riseTop = rock.getBoundingClientRect().top;
                        await new Promise((resolve) => setTimeout(resolve, 320));
                        const fallTop = rock.getBoundingClientRect().top;
                        return riseTop < startTop - 4 && fallTop > riseTop + 4;
                    }"""
                )
                result["game_deck_ore_all_rocks_land_above_ground"] = page.evaluate(
                    """async () => {
                        const mountain = document.querySelector('.ore-mountain');
                        const target = mountain?.querySelector(`.ore-mountain__hitbox--${mountain.dataset.stage}`);
                        const ground = document.querySelector('.game-ground-line');
                        if (!mountain || !target || !ground) {
                            return false;
                        }

                        const rect = target.getBoundingClientRect();
                        for (const ratio of [0.34, 0.56, 0.78]) {
                            target.dispatchEvent(new MouseEvent('click', {
                                bubbles: true,
                                clientX: rect.left + rect.width * ratio,
                                clientY: rect.top + rect.height * 0.72,
                            }));
                        }

                        await new Promise((resolve) => setTimeout(resolve, 2200));
                        const rocks = Array.from(document.querySelectorAll('.ore-rock-drop'));
                        const groundRect = ground.getBoundingClientRect();
                        if (rocks.length < 4) {
                            return false;
                        }

                        return rocks.every((rock) => {
                            const rockRect = rock.getBoundingClientRect();
                            const centerY = rockRect.top + rockRect.height / 2;
                            return centerY <= groundRect.top + 40
                                && rockRect.bottom <= groundRect.top + rockRect.height * 0.82;
                        });
                    }"""
                )
                result["game_deck_ore_chips_disappear"] = page.evaluate(
                    """async () => {
                        await new Promise((resolve) => setTimeout(resolve, 40));
                        return document.querySelectorAll('.ore-chip').length === 0;
                    }"""
                )
                result["game_deck_ore_landed_rock_blocks_mining_click"] = page.evaluate(
                    """() => {
                        const rocks = Array.from(document.querySelectorAll('.ore-rock-drop'));
                        const mountain = document.querySelector('.ore-mountain');
                        if (!mountain || rocks.length === 0) {
                            return false;
                        }

                        const beforeOre = Number(mountain.dataset.ore);
                        const candidates = rocks
                            .map((rock) => {
                                const rect = rock.getBoundingClientRect();
                                const clickX = rect.left + rect.width / 2;
                                const clickY = rect.top + rect.height / 2;
                                const hit = document.elementFromPoint(clickX, clickY);
                                return {
                                    rock,
                                    hit,
                                    clickX,
                                    clickY,
                                };
                            })
                            .filter(({ rock, hit }) =>
                                hit
                                && hit !== rock
                                && !rock.contains(hit)
                                && hit.closest('.ore-mountain') === mountain
                            );

                        const candidate = candidates[candidates.length - 1];
                        if (!candidate) {
                            return false;
                        }

                        candidate.hit.dispatchEvent(new PointerEvent('pointerdown', {
                            bubbles: true,
                            pointerId: 29,
                            pointerType: 'mouse',
                            clientX: candidate.clickX,
                            clientY: candidate.clickY,
                            button: 0,
                            buttons: 1,
                        }));
                        candidate.hit.dispatchEvent(new MouseEvent('click', {
                            bubbles: true,
                            clientX: candidate.clickX,
                            clientY: candidate.clickY,
                        }));

                        return Number(mountain.dataset.ore) === beforeOre - 1;
                    }"""
                )
                result["game_deck_ore_stage_changes_as_resource_drops"] = page.evaluate(
                    """async () => {
                        const mountain = document.querySelector('.ore-mountain');
                        const target = mountain?.querySelector(`.ore-mountain__hitbox--${mountain.dataset.stage}`);
                        if (!mountain || !target) {
                            return false;
                        }

                        const beforeOre = Number(mountain.dataset.ore);
                        const initialStage = mountain.dataset.stage;
                        const rect = target.getBoundingClientRect();
                        for (let i = 0; i < 25; i += 1) {
                            target.dispatchEvent(new MouseEvent('click', {
                                bubbles: true,
                                clientX: rect.left + rect.width * 0.5,
                                clientY: rect.top + rect.height * 0.6,
                            }));
                        }

                        await new Promise((resolve) => requestAnimationFrame(resolve));
                        return Number(mountain.dataset.ore) === beforeOre - 25
                            && mountain.dataset.stage !== initialStage
                            && mountain.dataset.stage === '4';
                    }"""
                )
                assert result["game_deck_started"], "expected start button to switch game deck to playing"
                assert result["game_deck_pause_title_hidden_after_start"], "expected pause title hidden after starting game"
                assert result["game_deck_world_mountain_removed_after_start"], "expected old mountain removed from playing world"
                assert result["game_deck_no_vertical_scroll"], "expected playing game deck to avoid vertical scroll"
                assert result["game_deck_world_scrolls_horizontally"], "expected playing game world to scroll horizontally"
                assert result["game_deck_world_draggable_horizontally"], "expected playing game world to drag horizontally"
                assert result["game_deck_search_static_during_world_scroll"], "expected search bar to stay fixed while world scrolls"
                assert result["game_deck_single_grid_layer_while_playing"], "expected a single grid layer while playing"
                assert result["game_deck_ground_line_present"], "expected ground line in playing world"
                assert result["game_deck_ground_line_two_cm_from_bottom"], "expected ground line 2cm from bottom"
                assert result["game_deck_ore_mountain_present"], "expected ore mountain in playing world"
                assert result["game_deck_ore_count_hidden_until_hover"], "expected ore amount hidden until hovering the mountain"
                assert result["game_deck_ore_tooltip_follows_cursor"], "expected ore amount tooltip to appear near the cursor"
                assert result["game_deck_ore_cursor_is_mining"], "expected ore mountain to use mining cursor"
                assert result["game_deck_ore_has_no_ridge_lines"], "expected ore mountain without ridge lines"
                assert result["game_deck_ore_base_open_and_aligned"], "expected ore mountain base open and aligned to ground"
                assert result["game_deck_ore_outside_click_does_not_mine"], "expected clicks outside mountain silhouette not to mine"
                assert result["game_deck_ore_click_decreases_count"], "expected mining click to decrease ore count"
                assert result["game_deck_ore_click_spawns_chips"], "expected mining click to spawn 2-4 chip particles"
                assert result["game_deck_ore_chips_disappear"], "expected chip particles to disappear quickly"
                assert result["game_deck_ore_click_spawns_rock_drop"], "expected mining click to spawn one rock drop"
                assert result["game_deck_ore_rock_parabolic"], "expected rock drop to follow a parabolic path"
                assert result["game_deck_ore_all_rocks_land_above_ground"], "expected physics rocks to settle near ground without sinking through it"
                assert result["game_deck_ore_landed_rock_blocks_mining_click"], "expected the noninteractive rock layer not to block further mining clicks"
                assert result["game_deck_ore_stage_changes_as_resource_drops"], "expected mountain stage to change as ore drops"
                rock_page = context.new_page()
                rock_page.goto(game_page_url, wait_until="domcontentloaded")
                rock_page.wait_for_load_state("networkidle")
                rock_page.locator("#start-game").click()
                rock_page.wait_for_function(
                    "() => document.body.dataset.gameState === 'playing'",
                    timeout=10000,
                )

                result["game_deck_ore_mountain_taller"] = rock_page.evaluate(
                    """() => {
                        const mountain = document.querySelector('.ore-mountain');
                        const rect = mountain?.getBoundingClientRect();
                        if (!rect) {
                            return false;
                        }

                        return rect.height >= 220 && rect.width >= 340;
                    }"""
                )

                result["game_deck_ore_rocks_pile_near_base"] = rock_page.evaluate(
                    """async () => {
                        const mountain = document.querySelector('.ore-mountain');
                        const target = mountain?.querySelector(`.ore-mountain__hitbox--${mountain.dataset.stage}`);
                        const ground = document.querySelector('.game-ground-line');
                        if (!mountain || !target || !ground) {
                            return false;
                        }

                        const rect = target.getBoundingClientRect();
                        for (let index = 0; index < 8; index += 1) {
                            target.dispatchEvent(new MouseEvent('click', {
                                bubbles: true,
                                clientX: rect.left + rect.width * 0.58,
                                clientY: rect.top + rect.height * 0.44,
                            }));
                            await new Promise((resolve) => setTimeout(resolve, 60));
                        }

                        const deadline = performance.now() + 4500;
                        let stableFrames = 0;
                        let lastSpread = null;

                        while (performance.now() < deadline) {
                            const rocks = Array.from(document.querySelectorAll('.ore-rock-drop'));
                            if (rocks.length >= 6) {
                                const groundRect = ground.getBoundingClientRect();
                                const settled = rocks.filter((rock) => {
                                    const rockRect = rock.getBoundingClientRect();
                                    return Math.abs(rockRect.bottom - groundRect.top) <= 42;
                                });

                                if (settled.length >= 5) {
                                    const xs = settled.map((rock) => rock.getBoundingClientRect().left);
                                    const spread = Math.max(...xs) - Math.min(...xs);

                                    if (lastSpread !== null && Math.abs(spread - lastSpread) <= 1.5) {
                                        stableFrames += 1;
                                    } else {
                                        stableFrames = 0;
                                    }

                                    lastSpread = spread;
                                    if (stableFrames >= 2) {
                                        return spread <= 260;
                                    }
                                }
                            }

                            await new Promise((resolve) => requestAnimationFrame(resolve));
                        }

                        return false;
                    }"""
                )

                result["game_deck_ore_rocks_use_images"] = rock_page.evaluate(
                    """() => {
                        const sprite = document.querySelector('.ore-rock-drop__sprite');
                        if (!(sprite instanceof HTMLImageElement)) {
                            return false;
                        }

                        return sprite.currentSrc.includes('ore-pebble.png')
                            && sprite.naturalWidth > 0
                            && sprite.naturalHeight > 0;
                    }"""
                )

                result["game_deck_ore_rocks_do_not_overlap_visibly"] = rock_page.evaluate(
                    """() => {
                        const rocks = Array.from(document.querySelectorAll('.ore-rock-drop'));
                        if (rocks.length < 4) {
                            return false;
                        }

                        for (let i = 0; i < rocks.length; i += 1) {
                            const rectA = rocks[i].getBoundingClientRect();
                            const ax = rectA.left + rectA.width / 2;
                            const ay = rectA.top + rectA.height / 2;
                            const radiusA = Math.min(rectA.width, rectA.height) / 2;

                            for (let j = i + 1; j < rocks.length; j += 1) {
                                const rectB = rocks[j].getBoundingClientRect();
                                const bx = rectB.left + rectB.width / 2;
                                const by = rectB.top + rectB.height / 2;
                                const radiusB = Math.min(rectB.width, rectB.height) / 2;
                                const distance = Math.hypot(ax - bx, ay - by);
                                if (distance < Math.min(radiusA, radiusB) * 0.66) {
                                    return false;
                                }
                            }
                        }

                        return true;
                    }"""
                )

                result["game_deck_miner_stays_at_mountain"] = rock_page.evaluate(
                    """async () => {
                        const mountain = document.querySelector('.ore-mountain');
                        const miner = document.querySelector('.game-worker[data-role="miner"]');
                        if (!mountain || !miner) {
                            return false;
                        }

                        const mountainRect = mountain.getBoundingClientRect();
                        const miningX = mountainRect.left + mountainRect.width * 0.6;
                        const deadline = performance.now() + 3400;
                        let previousOre = Number(mountain.dataset.ore || '0');
                        let oreDrops = 0;
                        let maxDeviation = 0;

                        while (performance.now() < deadline) {
                            const minerRect = miner.getBoundingClientRect();
                            const minerX = minerRect.left + minerRect.width / 2;
                            maxDeviation = Math.max(maxDeviation, Math.abs(minerX - miningX));

                            const currentOre = Number(mountain.dataset.ore || '0');
                            if (currentOre < previousOre) {
                                oreDrops += previousOre - currentOre;
                            }
                            previousOre = currentOre;

                            await new Promise((resolve) => requestAnimationFrame(resolve));
                        }

                        return oreDrops >= 2 && maxDeviation <= 56;
                    }"""
                )

                result["game_deck_hauler_clears_visible_rocks"] = rock_page.evaluate(
                    """async () => {
                        const mountain = document.querySelector('.ore-mountain');
                        const target = mountain?.querySelector(`.ore-mountain__hitbox--${mountain.dataset.stage}`);
                        const stored = document.querySelector('#stored-ore-count');
                        if (!mountain || !target || !stored) {
                            return false;
                        }

                        const rect = target.getBoundingClientRect();
                        for (let index = 0; index < 6; index += 1) {
                            target.dispatchEvent(new MouseEvent('click', {
                                bubbles: true,
                                clientX: rect.left + rect.width * 0.58,
                                clientY: rect.top + rect.height * 0.44,
                            }));
                            await new Promise((resolve) => setTimeout(resolve, 50));
                        }

                        const deadline = performance.now() + 6500;
                        let previousRockCount = document.querySelectorAll('.ore-rock-drop').length;
                        let sawRockCountDrop = false;
                        let sawStoredIncrease = Number(stored.textContent || '0') > 0;

                        while (performance.now() < deadline) {
                            const currentRockCount = document.querySelectorAll('.ore-rock-drop').length;
                            const storedCount = Number(stored.textContent || '0');
                            if (currentRockCount < previousRockCount) {
                                sawRockCountDrop = true;
                            }
                            if (storedCount > 0) {
                                sawStoredIncrease = true;
                            }
                            previousRockCount = currentRockCount;
                            await new Promise((resolve) => requestAnimationFrame(resolve));
                        }

                        return sawStoredIncrease && sawRockCountDrop;
                    }"""
                )
                rock_page.close()

                assert result["game_deck_ore_mountain_taller"], "expected ore mountain to be about 60% taller than the current version"
                assert result["game_deck_ore_rocks_use_images"], "expected dropped rocks to use ore sprite images"
                assert result["game_deck_ore_rocks_pile_near_base"], "expected dropped rocks to settle into a compact pile near the mountain base"
                assert result["game_deck_ore_rocks_do_not_overlap_visibly"], "expected piled rocks not to visually pass through each other"
                assert result["game_deck_miner_stays_at_mountain"], "expected autonomous miner to stay at the mountain while ore remains"
                assert result["game_deck_hauler_clears_visible_rocks"], "expected hauler pickups to remove visible ground rocks as ore is stored"

                page.locator("#return-pet-page").click()
                page.wait_for_selector(".page-transition-overlay__command", timeout=1000)
                result["game_deck_return_commands_visible"] = page.locator(".page-transition-overlay__command").count() >= 3
                assert result["game_deck_return_commands_visible"], "expected boot command decorations during return transition"
                page.wait_for_url("**/src/pages/newtab/index.html", timeout=10000)
                page.wait_for_selector("#homepage-stage", timeout=10000)
                result["game_deck_returned_to_pet_page"] = page.locator("#homepage-stage").is_visible()
                assert result["game_deck_returned_to_pet_page"], "expected return to pet newtab page"

                result["background_foundation"] = read_background_foundation_state(page)
                result["background_layer_present"] = bool(result["background_foundation"].get("layerPresent"))
                result["background_has_no_canvas"] = not result["background_foundation"].get("hasCanvas", False)
                result["background_has_no_runtime_handle"] = not result["background_foundation"].get("hasRuntimeHandle", False)
                result["background_layer_noninteractive"] = result["background_foundation"].get("layerPointerEvents") == "none"
                result["background_has_texture_overlay"] = result["background_foundation"].get("layerBeforeBackgroundImage") != "none"
                result["background_has_focus_overlay"] = result["background_foundation"].get("layerAfterBackgroundImage") != "none"
                result["illustrated_stage"] = read_illustrated_stage_state(page)
                result["homepage_manage_menu"] = read_homepage_manage_menu_interaction_state(page)
                result["widget_transform"] = read_widget_transform_state(page)
                result["widget_transform_interaction"] = exercise_widget_transform_controls(page)
                result["todo_manager"] = exercise_todo_manager(page, expected_extension_url)
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
                result["search_outline_alignment"] = read_search_outline_alignment_state(page)

                page.screenshot(path=str(SCREENSHOT_BEFORE_HOVER_PATH), full_page=True)
                page.mouse.move(1040, 320)
                page.wait_for_load_state("networkidle")
                page.screenshot(path=str(SCREENSHOT_AFTER_HOVER_PATH), full_page=True)
                page.screenshot(path=str(SCREENSHOT_PATH), full_page=True)

                mobile_stage_page = context.new_page()
                result["mobile_stage"] = read_mobile_stage_state(mobile_stage_page, expected_extension_url)
                mobile_stage_page.close()

                page.evaluate("() => { const menu = document.querySelector('#homepage-manage-menu'); if (menu) menu.open = true; }")
                page.locator("#open-settings").click()
                page.wait_for_selector("body.is-settings-open", timeout=10000)
                result["settings_opened"] = True
                page.locator("#close-settings").click()
                page.wait_for_selector("#settings-popup[aria-hidden='true']", timeout=10000)
                result["settings_closed"] = True
                quicksites_widget_selector = "#widget-root .homepage-widget-card[data-widget-id='quicksites']"
                quicksites_hide_selector = f"{quicksites_widget_selector} [data-widget-action='hide']"
                assert page.locator(quicksites_widget_selector).count() > 0, (
                    "expected quicksites widget card in #widget-root for hide/restore smoke scenario"
                )
                page.evaluate("() => { const menu = document.querySelector('#homepage-manage-menu'); if (menu) menu.open = true; }")
                page.locator("#toggle-widget-edit-mode").click()
                page.wait_for_function(
                    "() => document.querySelector('#widget-root')?.dataset.widgetEditMode === 'true'",
                    timeout=10000,
                )
                page.locator(quicksites_hide_selector).click()
                page.wait_for_function(
                    "() => !document.querySelector(\"#widget-root .homepage-widget-card[data-widget-id='quicksites']\")",
                    timeout=10000,
                )
                page.wait_for_selector("#widget-panel:not([hidden])", timeout=5000)
                page.locator("[data-widget-panel-action='restore'][data-widget-id='quicksites']").click()
                page.wait_for_function(
                    "() => Boolean(document.querySelector(\"#widget-root .homepage-widget-card[data-widget-id='quicksites']\"))",
                    timeout=10000,
                )
                page.locator("#save-widget-layout").click()
                page.wait_for_function(
                    "() => document.querySelector('#widget-root')?.dataset.widgetEditMode === 'false' && document.querySelector('#widget-panel')?.hidden",
                    timeout=10000,
                )
                result["widget_hide_restore_ok"] = True

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
                try:
                    preview_page.wait_for_selector("#ai-search-preview:not([hidden])", timeout=10000)
                    result["preview_generated"] = True
                except TimeoutError:
                    result["preview_generated"] = False

                if result["preview_generated"]:
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

                invalid_runtime_page = context.new_page()
                open_extension_page(invalid_runtime_page, expected_extension_url)
                invalid_runtime_page.evaluate(
                    """async () => {
                        await new Promise((resolve) => {
                            chrome.storage.local.set(
                                {
                                    searchApiEndpoint: 'https://mock-search.local/v1/chat/completions',
                                    searchApiKey: 'mock-key',
                                    searchApiModel: 'mock-model',
                                    aiSearchEnabled: true,
                                    searchRuntimeConfigState: 'configured',
                                    searchRuntimeLastTestStatus: '',
                                    searchRuntimeLastTestMessage: '',
                                    searchRuntimeLastTestAt: '',
                                    searchRuntimeLastRuntimeErrorMessage: '',
                                    searchRuntimeLastRuntimeErrorAt: '',
                                },
                                resolve,
                            );
                        });
                    }"""
                )
                invalid_runtime_page.goto(expected_extension_url, wait_until="domcontentloaded")
                invalid_runtime_page.wait_for_load_state("networkidle")
                wait_for_extension_ready(invalid_runtime_page)
                invalid_runtime_page.locator("#search-input").fill("moon tab invalid runtime")
                with invalid_runtime_page.expect_request(lambda request: "bing.com/search" in request.url, timeout=10000) as invalid_runtime_request_info:
                    invalid_runtime_page.locator("#search-form").evaluate("(form) => form.requestSubmit()")
                invalid_runtime_request = invalid_runtime_request_info.value
                invalid_runtime_page.wait_for_timeout(250)
                result["ai_runtime_invalid_skips_preview"] = (
                    "bing.com/search" in invalid_runtime_request.url
                    and invalid_runtime_page.locator("#ai-search-preview").is_hidden()
                )
                invalid_runtime_page.close()

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
