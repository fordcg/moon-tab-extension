import time

from newtab_verifier_support import *

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
                        const rock = rocks.at(-1);
                        const mountain = document.querySelector('.ore-mountain');
                        if (!rock || !mountain) {
                            return false;
                        }

                        const beforeOre = Number(mountain.dataset.ore);
                        const rect = rock.getBoundingClientRect();
                        const clickX = rect.left + rect.width / 2;
                        const clickY = rect.top + rect.height / 2;
                        const hit = document.elementFromPoint(clickX, clickY);
                        if (!hit || hit === rock || rock.contains(hit)) {
                            return false;
                        }

                        hit.dispatchEvent(new PointerEvent('pointerdown', {
                            bubbles: true,
                            pointerId: 29,
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
                result["game_deck_ore_mountain_taller"] = page.evaluate(
                    """() => {
                        const mountain = document.querySelector('.ore-mountain');
                        const rect = mountain?.getBoundingClientRect();
                        if (!rect) {
                            return false;
                        }

                        return rect.height >= 220 && rect.width >= 340;
                    }"""
                )

                result["game_deck_ore_rocks_use_images"] = page.evaluate(
                    """() => {
                        const sprite = document.querySelector('.ore-rock-drop__sprite');
                        if (!(sprite instanceof HTMLImageElement)) {
                            return false;
                        }

                        return sprite.currentSrc.includes('ore-pebble-')
                            && sprite.naturalWidth > 0
                            && sprite.naturalHeight > 0;
                    }"""
                )

                result["game_deck_ore_rocks_pile_near_base"] = page.evaluate(
                    """async () => {
                        const mountain = document.querySelector('.ore-mountain');
                        const target = mountain?.querySelector(`.ore-mountain__hitbox--${mountain.dataset.stage}`);
                        const ground = document.querySelector('.game-ground-line');
                        if (!mountain || !target || !ground) {
                            return false;
                        }

                        const initialRockCount = document.querySelectorAll('.ore-rock-drop').length;
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
                        let lastRockCount = -1;
                        let stableFrames = 0;

                        while (performance.now() < deadline) {
                            const rocks = Array.from(document.querySelectorAll('.ore-rock-drop')).slice(initialRockCount);
                            if (rocks.length >= 6) {
                                const groundRect = ground.getBoundingClientRect();
                                const settled = rocks.filter((rock) => {
                                    const rockRect = rock.getBoundingClientRect();
                                    return Math.abs(rockRect.bottom - groundRect.top) <= 42;
                                });

                                if (rocks.length === lastRockCount) {
                                    stableFrames += 1;
                                } else {
                                    stableFrames = 0;
                                    lastRockCount = rocks.length;
                                }

                                if (settled.length >= 5 && stableFrames >= 2) {
                                    const xs = settled.map((rock) => rock.getBoundingClientRect().left);
                                    const spread = Math.max(...xs) - Math.min(...xs);
                                    return spread <= 260;
                                }
                            }

                            await new Promise((resolve) => requestAnimationFrame(resolve));
                        }

                        return false;
                    }"""
                )

                result["game_deck_ore_rocks_do_not_overlap_visibly"] = page.evaluate(
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

                assert result["game_deck_ore_mountain_taller"], "expected ore mountain to be about 60% taller than the current version"
                assert result["game_deck_ore_rocks_use_images"], "expected dropped rocks to use ore sprite images"
                assert result["game_deck_ore_rocks_pile_near_base"], "expected dropped rocks to settle into a compact pile near the mountain base"
                assert result["game_deck_ore_rocks_do_not_overlap_visibly"], "expected piled rocks not to visually pass through each other"

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
