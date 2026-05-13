import json
import re
import shutil
import sys
import tempfile
from io import BytesIO
from pathlib import Path
from statistics import median
from typing import Optional, Tuple

from PIL import Image, ImageFilter, ImageStat
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
EXTENSION_PATH = str(ROOT)


def parse_color(value: str) -> Optional[Tuple[int, int, int]]:
    raw = (value or "").strip().lower()
    if not raw:
        return None

    if raw.startswith("#"):
        hex_value = raw[1:]
        if len(hex_value) == 3:
            r, g, b = (int(ch * 2, 16) for ch in hex_value)
            return (r, g, b)
        if len(hex_value) in {6, 8}:
            return (int(hex_value[0:2], 16), int(hex_value[2:4], 16), int(hex_value[4:6], 16))
        return None

    rgb_match = re.match(r"rgba?\(([^)]+)\)", raw)
    if rgb_match:
        parts = [part.strip() for part in rgb_match.group(1).split(",")]
        if len(parts) < 3:
            return None
        try:
            return (int(float(parts[0])), int(float(parts[1])), int(float(parts[2])))
        except ValueError:
            return None

    named = {
        "white": (255, 255, 255),
        "black": (0, 0, 0),
    }
    return named.get(raw)


def relative_luminance(rgb: Tuple[int, int, int]) -> float:
    def to_linear(channel: int) -> float:
        value = channel / 255
        if value <= 0.03928:
            return value / 12.92
        return ((value + 0.055) / 1.055) ** 2.4

    r, g, b = rgb
    return 0.2126 * to_linear(r) + 0.7152 * to_linear(g) + 0.0722 * to_linear(b)


def color_luminance(value: str) -> Optional[float]:
    rgb = parse_color(value)
    if not rgb:
        return None
    return relative_luminance(rgb)


def color_alpha(value: str) -> Optional[float]:
    raw = (value or "").strip().lower()
    if not raw:
        return None

    if raw == "transparent":
        return 0.0

    if raw.startswith("#"):
        hex_value = raw[1:]
        if len(hex_value) == 4:
            return int(hex_value[3] * 2, 16) / 255
        if len(hex_value) == 8:
            return int(hex_value[6:8], 16) / 255
        return 1.0

    rgb_match = re.match(r"rgba?\(([^)]+)\)", raw)
    if not rgb_match:
        return None

    parts = [part.strip() for part in rgb_match.group(1).split(",")]
    if len(parts) < 3:
        return None
    if len(parts) == 3:
        return 1.0

    alpha_raw = parts[3]
    try:
        if alpha_raw.endswith("%"):
            return max(0.0, min(1.0, float(alpha_raw[:-1]) / 100))
        return max(0.0, min(1.0, float(alpha_raw)))
    except ValueError:
        return None


def parse_css_number(value: str) -> Optional[float]:
    raw = (value or "").strip().lower()
    if not raw:
        return None

    try:
        return float(raw.replace("px", "").strip())
    except ValueError:
        return None


def first_color_token(value: str) -> Optional[str]:
    match = re.search(r"rgba?\([^)]+\)|#[0-9a-fA-F]{3,8}", value or "")
    if not match:
        return None
    return match.group(0)


def extract_color_tokens(value: str) -> list[str]:
    return re.findall(r"rgba?\([^)]+\)|#[0-9a-fA-F]{3,8}", value or "")


def min_opaque_luminance(*values: str, min_alpha: float = 0.78) -> Optional[float]:
    luminances = []
    for value in values:
        for token in extract_color_tokens(value):
            alpha = color_alpha(token)
            luminance = color_luminance(token)
            if luminance is None:
                continue
            if alpha is None:
                alpha = 1.0
            if alpha >= min_alpha:
                luminances.append(luminance)

    if not luminances:
        return None
    return min(luminances)


def max_alpha_for_dark_tokens(*values: str, max_luminance: float = 0.55) -> Optional[float]:
    alphas = []
    for value in values:
        for token in extract_color_tokens(value):
            token_luminance = color_luminance(token)
            if token_luminance is None or token_luminance > max_luminance:
                continue

            alpha = color_alpha(token)
            if alpha is None:
                alpha = 1.0
            alphas.append(alpha)

    if not alphas:
        return None
    return max(alphas)


def contrast_ratio(luma_a: Optional[float], luma_b: Optional[float]) -> Optional[float]:
    if luma_a is None or luma_b is None:
        return None
    bright = max(luma_a, luma_b)
    dark = min(luma_a, luma_b)
    return (bright + 0.05) / (dark + 0.05)


def measure_bubble_continuity_from_screenshot(screenshot_bytes: bytes) -> Optional[dict]:
    if not screenshot_bytes:
        return None

    try:
        image = Image.open(BytesIO(screenshot_bytes)).convert("RGB")
    except Exception:
        return None

    width, height = image.size
    if width < 320 or height < 240:
        return None

    crop_left = int(width * 0.08)
    crop_right = int(width * 0.95)
    crop_top = int(height * 0.16)
    crop_bottom = int(height * 0.84)
    if crop_right - crop_left < 180 or crop_bottom - crop_top < 120:
        return None

    region = image.crop((crop_left, crop_top, crop_right, crop_bottom))
    blur_radius = max(1.4, region.width / 420)
    blurred = region.filter(ImageFilter.GaussianBlur(radius=blur_radius)).convert("L")

    region_width, _ = blurred.size
    if region_width < 16:
        return None

    column_strip = blurred.resize((region_width, 1))
    column_lumas = [value / 255 for value in column_strip.getdata()]
    gradients = [abs(column_lumas[index + 1] - column_lumas[index]) for index in range(region_width - 1)]
    if len(gradients) < 8:
        return None

    sidebar_start = max(2, int(region_width * 0.56))
    sidebar_end = min(len(gradients) - 2, int(region_width * 0.94))
    baseline_start = max(2, int(region_width * 0.12))
    baseline_end = min(len(gradients) - 2, int(region_width * 0.48))

    sidebar_gradients = gradients[sidebar_start:sidebar_end]
    baseline_gradients = gradients[baseline_start:baseline_end]
    if not sidebar_gradients or not baseline_gradients:
        return None

    sidebar_peak = max(sidebar_gradients)
    sidebar_peak_offset = sidebar_gradients.index(sidebar_peak)
    sidebar_peak_x = sidebar_start + sidebar_peak_offset + 1
    baseline_median = median(baseline_gradients)
    sidebar_ratio = sidebar_peak / max(baseline_median, 1e-6)

    luma_stats = ImageStat.Stat(blurred)
    mean_luma = (luma_stats.mean[0] / 255) if luma_stats.mean else None
    stddev_luma = (luma_stats.stddev[0] / 255) if luma_stats.stddev else None
    luma_span = max(column_lumas) - min(column_lumas)

    return {
        "width": width,
        "height": height,
        "crop": {
            "left": crop_left,
            "right": crop_right,
            "top": crop_top,
            "bottom": crop_bottom,
            "width": region.width,
            "height": region.height,
        },
        "blurRadius": blur_radius,
        "meanLuma": mean_luma,
        "stddevLuma": stddev_luma,
        "lumaSpan": luma_span,
        "sidebarPeakStep": sidebar_peak,
        "sidebarPeakX": sidebar_peak_x,
        "sidebarPeakXNormalized": sidebar_peak_x / region_width,
        "baselineMedianStep": baseline_median,
        "sidebarPeakToBaselineRatio": sidebar_ratio,
    }


def main() -> int:
    result = {
        "ok": False,
        "extension_id": "",
        "checks": [],
        "errors": [],
    }
    failed_checks = []

    def add_check(name: str, ok: bool, actual=None, expected=None) -> None:
        entry = {"name": name, "ok": ok}
        if actual is not None:
            entry["actual"] = actual
        if expected is not None:
            entry["expected"] = expected
        result["checks"].append(entry)
        if not ok:
            failed_checks.append(name)

    user_data_dir = Path(tempfile.mkdtemp(prefix="warm-light-theme-verify-"))

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

                newtab_url = f"chrome-extension://{extension_id}/src/pages/newtab/index.html"
                sidebar_url = f"chrome-extension://{extension_id}/src/pages/sidebar/index.html"

                newtab = context.new_page()
                newtab.goto(newtab_url, wait_until="domcontentloaded")
                newtab.wait_for_selector("#search-input", timeout=15000)

                has_search_input = newtab.locator("#search-input").count() > 0
                search_enabled = has_search_input and newtab.locator("#search-input").is_enabled()
                add_check("newtab shell renders search input", has_search_input and search_enabled)

                newtab_theme = newtab.evaluate(
                    """() => {
                        const root = document.documentElement;
                        const style = getComputedStyle(root);
                        const meta = document.querySelector('meta[name="color-scheme"]');
                        return {
                            metaColorScheme: (meta?.content || '').trim(),
                            computedColorScheme: (style.colorScheme || '').trim(),
                            surfaceBase0: style.getPropertyValue('--surface-base-0').trim(),
                            inkPrimary: style.getPropertyValue('--ink-primary').trim(),
                        };
                    }"""
                )

                add_check(
                    "newtab meta color-scheme includes light",
                    "light" in newtab_theme["metaColorScheme"].lower(),
                    actual={
                        "computed": newtab_theme["computedColorScheme"],
                        "meta": newtab_theme["metaColorScheme"],
                    },
                    expected="meta color-scheme contains 'light'",
                )

                surface_rgb = parse_color(newtab_theme["surfaceBase0"])
                surface_luma = relative_luminance(surface_rgb) if surface_rgb else None
                add_check(
                    "newtab --surface-base-0 is light",
                    surface_luma is not None and surface_luma >= 0.7,
                    actual={"token": newtab_theme["surfaceBase0"], "luminance": surface_luma},
                    expected="luminance >= 0.7",
                )

                ink_rgb = parse_color(newtab_theme["inkPrimary"])
                ink_luma = relative_luminance(ink_rgb) if ink_rgb else None
                add_check(
                    "newtab --ink-primary is dark enough",
                    ink_luma is not None and ink_luma <= 0.35,
                    actual={"token": newtab_theme["inkPrimary"], "luminance": ink_luma},
                    expected="luminance <= 0.35",
                )

                newtab.wait_for_timeout(140)
                bubble_backdrop_samples = newtab.evaluate(
                    """() => new Promise((resolve) => {
                        const canvas = document.querySelector('.homepage-bubble-layer canvas');
                        if (!canvas) {
                            resolve(null);
                            return;
                        }

                        const sampleCanvasLuminance = () => {
                            const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
                            if (!gl) {
                                return null;
                            }

                            const width = gl.drawingBufferWidth || canvas.width;
                            const height = gl.drawingBufferHeight || canvas.height;
                            if (!width || !height) {
                                return null;
                            }

                            const toLinear = (channel) => {
                                const value = channel / 255;
                                if (value <= 0.03928) {
                                    return value / 12.92;
                                }
                                return Math.pow((value + 0.055) / 1.055, 2.4);
                            };

                            const points = [
                                [0.50, 0.50],
                                [0.16, 0.22],
                                [0.84, 0.22],
                                [0.50, 0.14],
                                [0.50, 0.78],
                                [0.22, 0.74],
                                [0.78, 0.74],
                            ];

                            const samples = [];
                            for (const [nx, ny] of points) {
                                const x = Math.max(0, Math.min(width - 1, Math.floor(nx * width)));
                                const y = Math.max(0, Math.min(height - 1, Math.floor(ny * height)));
                                const pixel = new Uint8Array(4);
                                gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);

                                const luminance =
                                    0.2126 * toLinear(pixel[0]) +
                                    0.7152 * toLinear(pixel[1]) +
                                    0.0722 * toLinear(pixel[2]);

                                samples.push({
                                    x,
                                    y,
                                    rgba: [pixel[0], pixel[1], pixel[2], pixel[3]],
                                    luminance,
                                });
                            }

                            const luminances = samples.map((entry) => entry.luminance);
                            return {
                                width,
                                height,
                                samples,
                                avgLuminance: luminances.reduce((sum, value) => sum + value, 0) / luminances.length,
                                minLuminance: Math.min(...luminances),
                            };
                        };

                        requestAnimationFrame(() => resolve(sampleCanvasLuminance()));
                    })"""
                )

                add_check("newtab bubble backdrop sample is readable", isinstance(bubble_backdrop_samples, dict))
                if isinstance(bubble_backdrop_samples, dict):
                    add_check(
                        "newtab bubble backdrop is warm-light (not materially dark)",
                        bubble_backdrop_samples["avgLuminance"] >= 0.5 and bubble_backdrop_samples["minLuminance"] >= 0.28,
                        actual={
                            "avgLuminance": bubble_backdrop_samples["avgLuminance"],
                            "minLuminance": bubble_backdrop_samples["minLuminance"],
                            "samples": bubble_backdrop_samples["samples"],
                        },
                        expected="avg luminance >= 0.5 and min luminance >= 0.28",
                    )

                open_settings_button = newtab.locator("#open-settings")
                add_check("settings trigger exists", open_settings_button.count() > 0)
                open_settings_button.click()
                newtab.wait_for_selector("body.is-settings-open", timeout=10000)

                settings_styles = newtab.evaluate(
                    """() => {
                        const popup = document.querySelector('.settings-popup');
                        const title = document.querySelector('.settings-popup-title');
                        const input = document.querySelector('.settings-input');
                        const secondaryButton = document.querySelector('.settings-secondary-button');
                        if (!popup || !title || !input || !secondaryButton) {
                            return null;
                        }

                        const popupStyle = getComputedStyle(popup);
                        const titleStyle = getComputedStyle(title);
                        const inputStyle = getComputedStyle(input);
                        const secondaryButtonStyle = getComputedStyle(secondaryButton);
                        return {
                            popupBackgroundColor: popupStyle.backgroundColor,
                            titleColor: titleStyle.color,
                            inputBackgroundColor: inputStyle.backgroundColor,
                            inputColor: inputStyle.color,
                            secondaryButtonBackgroundColor: secondaryButtonStyle.backgroundColor,
                            secondaryButtonTextColor: secondaryButtonStyle.color,
                        };
                    }"""
                )

                add_check("settings popup style block is readable", isinstance(settings_styles, dict))
                if isinstance(settings_styles, dict):
                    popup_bg_rgb = parse_color(settings_styles["popupBackgroundColor"])
                    popup_bg_luma = relative_luminance(popup_bg_rgb) if popup_bg_rgb else None
                    add_check(
                        "settings popup background is light",
                        popup_bg_luma is not None and popup_bg_luma >= 0.74,
                        actual={"color": settings_styles["popupBackgroundColor"], "luminance": popup_bg_luma},
                        expected="luminance >= 0.74",
                    )

                    title_rgb = parse_color(settings_styles["titleColor"])
                    title_luma = relative_luminance(title_rgb) if title_rgb else None
                    add_check(
                        "settings popup title text is dark enough",
                        title_luma is not None and title_luma <= 0.35,
                        actual={"color": settings_styles["titleColor"], "luminance": title_luma},
                        expected="luminance <= 0.35",
                    )

                    input_bg_rgb = parse_color(settings_styles["inputBackgroundColor"])
                    input_bg_luma = relative_luminance(input_bg_rgb) if input_bg_rgb else None
                    add_check(
                        "settings input background is light",
                        input_bg_luma is not None and input_bg_luma >= 0.78,
                        actual={"color": settings_styles["inputBackgroundColor"], "luminance": input_bg_luma},
                        expected="luminance >= 0.78",
                    )

                    input_rgb = parse_color(settings_styles["inputColor"])
                    input_luma = relative_luminance(input_rgb) if input_rgb else None
                    add_check(
                        "settings input text is dark enough",
                        input_luma is not None and input_luma <= 0.35,
                        actual={"color": settings_styles["inputColor"], "luminance": input_luma},
                        expected="luminance <= 0.35",
                    )

                    secondary_bg_luma = color_luminance(settings_styles["secondaryButtonBackgroundColor"])
                    secondary_text_luma = color_luminance(settings_styles["secondaryButtonTextColor"])
                    secondary_contrast = contrast_ratio(secondary_bg_luma, secondary_text_luma)
                    add_check(
                        "settings secondary button is light with readable dark text",
                        secondary_bg_luma is not None
                        and secondary_bg_luma >= 0.72
                        and secondary_text_luma is not None
                        and secondary_text_luma <= 0.38
                        and secondary_contrast is not None
                        and secondary_contrast >= 4.5,
                        actual={
                            "background": settings_styles["secondaryButtonBackgroundColor"],
                            "backgroundLuminance": secondary_bg_luma,
                            "textColor": settings_styles["secondaryButtonTextColor"],
                            "textLuminance": secondary_text_luma,
                            "contrast": secondary_contrast,
                        },
                        expected="background luminance >= 0.72, text luminance <= 0.38, contrast >= 4.5",
                    )

                newtab.keyboard.press("Escape")
                newtab.wait_for_timeout(80)

                newtab.locator("#search-target-trigger").click()
                newtab.wait_for_selector("#search-target-menu:not([hidden])", timeout=10000)

                target_menu_styles = newtab.evaluate(
                    """() => {
                        const menu = document.querySelector('#search-target-menu');
                        const item = document.querySelector('.search-target-menu-item');
                        if (!menu || !item || menu.hidden) {
                            return null;
                        }

                        const menuStyle = getComputedStyle(menu);
                        const itemStyle = getComputedStyle(item);
                        return {
                            menuBackgroundColor: menuStyle.backgroundColor,
                            itemColor: itemStyle.color,
                        };
                    }"""
                )

                add_check("search target menu style block is readable", isinstance(target_menu_styles, dict))
                if isinstance(target_menu_styles, dict):
                    menu_bg_rgb = parse_color(target_menu_styles["menuBackgroundColor"])
                    menu_bg_luma = relative_luminance(menu_bg_rgb) if menu_bg_rgb else None
                    add_check(
                        "search target menu background is light",
                        menu_bg_luma is not None and menu_bg_luma >= 0.74,
                        actual={"color": target_menu_styles["menuBackgroundColor"], "luminance": menu_bg_luma},
                        expected="luminance >= 0.74",
                    )

                    menu_item_rgb = parse_color(target_menu_styles["itemColor"])
                    menu_item_luma = relative_luminance(menu_item_rgb) if menu_item_rgb else None
                    add_check(
                        "search target menu item text is dark enough",
                        menu_item_luma is not None and menu_item_luma <= 0.38,
                        actual={"color": target_menu_styles["itemColor"], "luminance": menu_item_luma},
                        expected="luminance <= 0.38",
                    )

                newtab.locator("#search-input").fill("warm paper")
                newtab.wait_for_selector("#search-suggestions:not([hidden])", timeout=10000)

                suggestion_styles = newtab.evaluate(
                    """() => {
                        const input = document.querySelector('#search-input');
                        const suggestions = document.querySelector('#search-suggestions');
                        if (!input || !suggestions || suggestions.hidden) {
                            return null;
                        }

                        const inputStyle = getComputedStyle(input);
                        const placeholderStyle = getComputedStyle(input, '::placeholder');
                        const suggestionsStyle = getComputedStyle(suggestions);
                        return {
                            inputColor: inputStyle.color,
                            placeholderColor: placeholderStyle.color,
                            suggestionsBackgroundColor: suggestionsStyle.backgroundColor,
                        };
                    }"""
                )

                add_check("search suggestions style block is readable", isinstance(suggestion_styles, dict))
                if isinstance(suggestion_styles, dict):
                    suggestions_bg_rgb = parse_color(suggestion_styles["suggestionsBackgroundColor"])
                    suggestions_bg_luma = relative_luminance(suggestions_bg_rgb) if suggestions_bg_rgb else None
                    add_check(
                        "search suggestions background is light",
                        suggestions_bg_luma is not None and suggestions_bg_luma >= 0.74,
                        actual={"color": suggestion_styles["suggestionsBackgroundColor"], "luminance": suggestions_bg_luma},
                        expected="luminance >= 0.74",
                    )

                    input_color_rgb = parse_color(suggestion_styles["inputColor"])
                    input_color_luma = relative_luminance(input_color_rgb) if input_color_rgb else None
                    add_check(
                        "search input text color is dark enough",
                        input_color_luma is not None and input_color_luma <= 0.38,
                        actual={"color": suggestion_styles["inputColor"], "luminance": input_color_luma},
                        expected="luminance <= 0.38",
                    )

                    placeholder_rgb = parse_color(suggestion_styles["placeholderColor"])
                    placeholder_luma = relative_luminance(placeholder_rgb) if placeholder_rgb else None
                    add_check(
                        "search input placeholder color is not too faint",
                        placeholder_luma is not None and placeholder_luma <= 0.62,
                        actual={"color": suggestion_styles["placeholderColor"], "luminance": placeholder_luma},
                        expected="luminance <= 0.62",
                    )

                preview_styles = newtab.evaluate(
                    """() => {
                        const body = document.body;
                        const fixture = document.createElement('section');
                        fixture.id = 'verify-ai-preview-fixture';
                        fixture.style.position = 'fixed';
                        fixture.style.left = '-9999px';
                        fixture.style.top = '-9999px';
                        fixture.style.width = '480px';
                        fixture.style.pointerEvents = 'none';
                        fixture.innerHTML = `
                            <article class="ai-search-preview">
                                <div class="ai-search-preview-content">
                                    <p class="ai-search-preview-summary">Summary text for theme verification.</p>
                                    <div class="ai-search-preview-query-map">
                                        <div class="ai-search-preview-query-item">
                                            <p class="ai-search-preview-target-label">Query</p>
                                            <p class="ai-search-preview-target">warm paper preview style</p>
                                        </div>
                                    </div>
                                    <div class="ai-search-preview-related">
                                        <p class="ai-search-preview-related-label">Websites</p>
                                        <div class="ai-search-preview-websites-list">
                                            <article class="ai-search-preview-website-card">
                                                <div class="ai-search-preview-website-header">
                                                    <div>
                                                        <h4 class="ai-search-preview-website-title">Example</h4>
                                                        <p class="ai-search-preview-website-host">example.com</p>
                                                    </div>
                                                    <button class="ai-search-preview-website-button" type="button">Open</button>
                                                </div>
                                                <p class="ai-search-preview-website-description">Description text for readability checks.</p>
                                            </article>
                                        </div>
                                    </div>
                                    <div class="ai-search-preview-actions">
                                        <button class="ai-search-preview-button" type="button">Search now</button>
                                        <button class="ai-search-preview-button-secondary" type="button">Refine</button>
                                    </div>
                                </div>
                            </article>
                        `;
                        body.appendChild(fixture);

                        try {
                            const preview = fixture.querySelector('.ai-search-preview');
                            const summary = fixture.querySelector('.ai-search-preview-summary');
                            const queryMap = fixture.querySelector('.ai-search-preview-query-map');
                            const websiteCard = fixture.querySelector('.ai-search-preview-website-card');
                            const primaryButton = fixture.querySelector('.ai-search-preview-button');
                            const secondaryButton = fixture.querySelector('.ai-search-preview-button-secondary');
                            const host = fixture.querySelector('.ai-search-preview-website-host');
                            const description = fixture.querySelector('.ai-search-preview-website-description');
                            const relatedLabel = fixture.querySelector('.ai-search-preview-related-label');

                            if (!preview || !summary || !queryMap || !websiteCard || !primaryButton || !secondaryButton || !host || !description || !relatedLabel) {
                                return null;
                            }

                            const previewStyle = getComputedStyle(preview);
                            const summaryStyle = getComputedStyle(summary);
                            const queryMapStyle = getComputedStyle(queryMap);
                            const websiteCardStyle = getComputedStyle(websiteCard);
                            const primaryButtonStyle = getComputedStyle(primaryButton);
                            const secondaryButtonStyle = getComputedStyle(secondaryButton);
                            const hostStyle = getComputedStyle(host);
                            const descriptionStyle = getComputedStyle(description);
                            const relatedLabelStyle = getComputedStyle(relatedLabel);

                            return {
                                previewBackgroundColor: previewStyle.backgroundColor,
                                summaryColor: summaryStyle.color,
                                queryMapBackgroundColor: queryMapStyle.backgroundColor,
                                websiteCardBackgroundColor: websiteCardStyle.backgroundColor,
                                primaryButtonBackground: primaryButtonStyle.backgroundImage || primaryButtonStyle.backgroundColor,
                                primaryButtonTextColor: primaryButtonStyle.color,
                                secondaryButtonBackgroundColor: secondaryButtonStyle.backgroundColor,
                                secondaryButtonTextColor: secondaryButtonStyle.color,
                                websiteHostColor: hostStyle.color,
                                websiteDescriptionColor: descriptionStyle.color,
                                relatedLabelColor: relatedLabelStyle.color,
                            };
                        } finally {
                            fixture.remove();
                        }
                    }"""
                )

                add_check("preview style block is readable", isinstance(preview_styles, dict))
                if isinstance(preview_styles, dict):
                    preview_bg_luma = color_luminance(preview_styles["previewBackgroundColor"])
                    add_check(
                        "ai preview background is light enough",
                        preview_bg_luma is not None and preview_bg_luma >= 0.72,
                        actual={"color": preview_styles["previewBackgroundColor"], "luminance": preview_bg_luma},
                        expected="luminance >= 0.72",
                    )

                    summary_luma = color_luminance(preview_styles["summaryColor"])
                    add_check(
                        "ai preview summary text is dark enough",
                        summary_luma is not None and summary_luma <= 0.38,
                        actual={"color": preview_styles["summaryColor"], "luminance": summary_luma},
                        expected="luminance <= 0.38",
                    )

                    query_map_luma = color_luminance(preview_styles["queryMapBackgroundColor"])
                    add_check(
                        "ai preview query map is light enough",
                        query_map_luma is not None and query_map_luma >= 0.74,
                        actual={"color": preview_styles["queryMapBackgroundColor"], "luminance": query_map_luma},
                        expected="luminance >= 0.74",
                    )

                    website_card_luma = color_luminance(preview_styles["websiteCardBackgroundColor"])
                    add_check(
                        "ai preview website card is light enough",
                        website_card_luma is not None and website_card_luma >= 0.74,
                        actual={"color": preview_styles["websiteCardBackgroundColor"], "luminance": website_card_luma},
                        expected="luminance >= 0.74",
                    )

                    primary_bg_token = first_color_token(preview_styles["primaryButtonBackground"]) or preview_styles["primaryButtonBackground"]
                    primary_bg_luma = color_luminance(primary_bg_token)
                    primary_text_luma = color_luminance(preview_styles["primaryButtonTextColor"])
                    primary_contrast = contrast_ratio(primary_bg_luma, primary_text_luma)
                    add_check(
                        "ai preview primary button is strong and readable",
                        primary_bg_luma is not None
                        and primary_bg_luma <= 0.48
                        and primary_text_luma is not None
                        and primary_text_luma >= 0.85
                        and primary_contrast is not None
                        and primary_contrast >= 4.5,
                        actual={
                            "background": preview_styles["primaryButtonBackground"],
                            "backgroundToken": primary_bg_token,
                            "backgroundLuminance": primary_bg_luma,
                            "textColor": preview_styles["primaryButtonTextColor"],
                            "textLuminance": primary_text_luma,
                            "contrast": primary_contrast,
                        },
                        expected="background luminance <= 0.48, text luminance >= 0.85, contrast >= 4.5",
                    )

                    secondary_bg_luma = color_luminance(preview_styles["secondaryButtonBackgroundColor"])
                    secondary_text_luma = color_luminance(preview_styles["secondaryButtonTextColor"])
                    secondary_contrast = contrast_ratio(secondary_bg_luma, secondary_text_luma)
                    add_check(
                        "ai preview secondary button is light with dark text",
                        secondary_bg_luma is not None
                        and secondary_bg_luma >= 0.74
                        and secondary_text_luma is not None
                        and secondary_text_luma <= 0.38
                        and secondary_contrast is not None
                        and secondary_contrast >= 4.5,
                        actual={
                            "background": preview_styles["secondaryButtonBackgroundColor"],
                            "backgroundLuminance": secondary_bg_luma,
                            "textColor": preview_styles["secondaryButtonTextColor"],
                            "textLuminance": secondary_text_luma,
                            "contrast": secondary_contrast,
                        },
                        expected="background luminance >= 0.74, text luminance <= 0.38, contrast >= 4.5",
                    )

                    website_host_luma = color_luminance(preview_styles["websiteHostColor"])
                    add_check(
                        "ai preview website host text is readable",
                        website_host_luma is not None and website_host_luma <= 0.45,
                        actual={"color": preview_styles["websiteHostColor"], "luminance": website_host_luma},
                        expected="luminance <= 0.45",
                    )

                    website_description_luma = color_luminance(preview_styles["websiteDescriptionColor"])
                    add_check(
                        "ai preview website description text is readable",
                        website_description_luma is not None and website_description_luma <= 0.45,
                        actual={"color": preview_styles["websiteDescriptionColor"], "luminance": website_description_luma},
                        expected="luminance <= 0.45",
                    )

                    related_label_luma = color_luminance(preview_styles["relatedLabelColor"])
                    add_check(
                        "ai preview related label text is readable",
                        related_label_luma is not None and related_label_luma <= 0.5,
                        actual={"color": preview_styles["relatedLabelColor"], "luminance": related_label_luma},
                        expected="luminance <= 0.5",
                    )

                ai_state_preflight = newtab.evaluate(
                    """() => {
                        const body = document.body;
                        const hintElement = document.querySelector('.search-shell-hint') || (() => {
                            const node = document.createElement('p');
                            node.className = 'search-shell-hint';
                            node.textContent = 'hint';
                            node.style.position = 'fixed';
                            node.style.left = '-9999px';
                            node.style.top = '-9999px';
                            body.appendChild(node);
                            return node;
                        })();

                        const indicator = document.querySelector('#ai-search-indicator');
                        const settingsTrigger = document.querySelector('#open-settings');
                        const searchStatus = document.querySelector('#search-status');
                        const coilSpan = document.querySelector('.ai-toggle-coil span');
                        const geoTrack = document.querySelector('.geo-track');
                        const geoScan = document.querySelector('.geo-scan');
                        const geoNode = document.querySelector('.geo-node');

                        if (!indicator || !settingsTrigger || !searchStatus || !coilSpan || !geoTrack || !geoScan || !geoNode || !hintElement) {
                            return {"ok": false};
                        }

                        return {"ok": true};
                    }"""
                )

                ai_state_styles = None
                if isinstance(ai_state_preflight, dict) and ai_state_preflight.get("ok"):
                    newtab.evaluate(
                        """() => {
                            const body = document.body;
                            const indicator = document.querySelector('#ai-search-indicator');
                            body.classList.add('is-ai-search-enabled');
                            body.classList.remove('is-ai-search-searching');
                            if (indicator) {
                                indicator.removeAttribute('data-state');
                            }
                        }"""
                    )
                    newtab.wait_for_timeout(350)

                    enabled_styles = newtab.evaluate(
                        """() => {
                            const settingsTrigger = document.querySelector('#open-settings');
                            const indicator = document.querySelector('#ai-search-indicator');
                            if (!settingsTrigger || !indicator) {
                                return null;
                            }
                            return {
                                triggerColor: getComputedStyle(settingsTrigger).color,
                                indicatorOffColor: getComputedStyle(indicator).color,
                            };
                        }"""
                    )

                    newtab.evaluate(
                        """() => {
                            const indicator = document.querySelector('#ai-search-indicator');
                            if (indicator) {
                                indicator.setAttribute('data-state', 'ready');
                            }
                        }"""
                    )
                    newtab.wait_for_timeout(350)

                    ready_styles = newtab.evaluate(
                        """() => {
                            const indicator = document.querySelector('#ai-search-indicator');
                            if (!indicator) {
                                return null;
                            }
                            return {
                                indicatorReadyColor: getComputedStyle(indicator).color,
                            };
                        }"""
                    )

                    newtab.evaluate(
                        """() => {
                            const body = document.body;
                            const indicator = document.querySelector('#ai-search-indicator');
                            body.classList.add('is-ai-search-searching');
                            if (indicator) {
                                indicator.setAttribute('data-state', 'searching');
                            }
                        }"""
                    )
                    newtab.wait_for_timeout(350)

                    searching_styles = newtab.evaluate(
                        """() => {
                            const settingsTrigger = document.querySelector('#open-settings');
                            const indicator = document.querySelector('#ai-search-indicator');
                            const hintElement = document.querySelector('.search-shell-hint');
                            const searchStatus = document.querySelector('#search-status');
                            const searchSurface = document.querySelector('.outline-search-frame');
                            const coilSpan = document.querySelector('.ai-toggle-coil span');
                            const geoTrack = document.querySelector('.geo-track');
                            const geoScan = document.querySelector('.geo-scan');
                            const geoNode = document.querySelector('.geo-node');
                            if (!settingsTrigger || !indicator || !hintElement || !searchStatus || !searchSurface || !coilSpan || !geoTrack || !geoScan || !geoNode) {
                                return null;
                            }

                            const previousTone = searchStatus.getAttribute('data-tone');
                            const previousText = searchStatus.textContent;
                            const hadHidden = searchStatus.hasAttribute('hidden');
                            const hadAriaHidden = searchStatus.hasAttribute('aria-hidden');
                            const previousAriaHidden = searchStatus.getAttribute('aria-hidden');
                            const statusColorDefault = getComputedStyle(searchStatus).color;

                            try {
                                searchStatus.setAttribute('data-tone', 'error');
                                searchStatus.removeAttribute('hidden');
                                searchStatus.setAttribute('aria-hidden', 'false');
                                if (!(searchStatus.textContent || '').trim()) {
                                    searchStatus.textContent = 'Error status readability fixture';
                                }

                                return {
                                    triggerColorSearching: getComputedStyle(settingsTrigger).color,
                                    indicatorSearchingColor: getComputedStyle(indicator).color,
                                    hintColor: getComputedStyle(hintElement).color,
                                    statusColor: statusColorDefault,
                                    statusErrorColor: getComputedStyle(searchStatus).color,
                                    statusTone: searchStatus.getAttribute('data-tone') || '',
                                    searchSurfaceBackgroundImage: getComputedStyle(searchSurface).backgroundImage,
                                    searchSurfaceBackgroundColor: getComputedStyle(searchSurface).backgroundColor,
                                    coilBorderColor: getComputedStyle(coilSpan).borderTopColor,
                                    geoTrackColor: getComputedStyle(geoTrack).stroke,
                                    geoScanColor: getComputedStyle(geoScan).stroke,
                                    geoNodeStrokeColor: getComputedStyle(geoNode).stroke,
                                    geoNodeFillColor: getComputedStyle(geoNode).fill,
                                };
                            } finally {
                                if (previousTone === null) {
                                    searchStatus.removeAttribute('data-tone');
                                } else {
                                    searchStatus.setAttribute('data-tone', previousTone);
                                }
                                searchStatus.textContent = previousText;
                                if (hadHidden) {
                                    searchStatus.setAttribute('hidden', '');
                                } else {
                                    searchStatus.removeAttribute('hidden');
                                }
                                if (hadAriaHidden) {
                                    if (previousAriaHidden === null) {
                                        searchStatus.removeAttribute('aria-hidden');
                                    } else {
                                        searchStatus.setAttribute('aria-hidden', previousAriaHidden);
                                    }
                                } else {
                                    searchStatus.removeAttribute('aria-hidden');
                                }
                            }
                        }"""
                    )

                    if isinstance(enabled_styles, dict) and isinstance(ready_styles, dict) and isinstance(searching_styles, dict):
                        ai_state_styles = {
                            **enabled_styles,
                            **ready_styles,
                            **searching_styles,
                        }

                    newtab.evaluate(
                        """() => {
                            const body = document.body;
                            const indicator = document.querySelector('#ai-search-indicator');
                            body.classList.remove('is-ai-search-searching');
                            body.classList.remove('is-ai-search-enabled');
                            if (indicator) {
                                indicator.removeAttribute('data-state');
                            }
                        }"""
                    )

                add_check("ai state style block is readable", isinstance(ai_state_styles, dict))
                if isinstance(ai_state_styles, dict):
                    trigger_enabled_luma = color_luminance(ai_state_styles["triggerColor"])
                    add_check(
                        "ai-enabled search settings trigger color is dark enough",
                        trigger_enabled_luma is not None and trigger_enabled_luma <= 0.45,
                        actual={"color": ai_state_styles["triggerColor"], "luminance": trigger_enabled_luma},
                        expected="luminance <= 0.45",
                    )

                    trigger_searching_luma = color_luminance(ai_state_styles["triggerColorSearching"])
                    add_check(
                        "ai-searching search settings trigger color is dark enough",
                        trigger_searching_luma is not None and trigger_searching_luma <= 0.45,
                        actual={"color": ai_state_styles["triggerColorSearching"], "luminance": trigger_searching_luma},
                        expected="luminance <= 0.45",
                    )

                    indicator_off_luma = color_luminance(ai_state_styles["indicatorOffColor"])
                    add_check(
                        "ai indicator off color is dark enough",
                        indicator_off_luma is not None and indicator_off_luma <= 0.5,
                        actual={"color": ai_state_styles["indicatorOffColor"], "luminance": indicator_off_luma},
                        expected="luminance <= 0.5",
                    )

                    indicator_ready_luma = color_luminance(ai_state_styles["indicatorReadyColor"])
                    add_check(
                        "ai indicator ready color is dark enough",
                        indicator_ready_luma is not None and indicator_ready_luma <= 0.5,
                        actual={"color": ai_state_styles["indicatorReadyColor"], "luminance": indicator_ready_luma},
                        expected="luminance <= 0.5",
                    )

                    indicator_searching_luma = color_luminance(ai_state_styles["indicatorSearchingColor"])
                    add_check(
                        "ai indicator searching color is dark enough",
                        indicator_searching_luma is not None and indicator_searching_luma <= 0.5,
                        actual={"color": ai_state_styles["indicatorSearchingColor"], "luminance": indicator_searching_luma},
                        expected="luminance <= 0.5",
                    )

                    shell_hint_luma = color_luminance(ai_state_styles["hintColor"])
                    add_check(
                        "search shell hint color is dark enough",
                        shell_hint_luma is not None and shell_hint_luma <= 0.5,
                        actual={"color": ai_state_styles["hintColor"], "luminance": shell_hint_luma},
                        expected="luminance <= 0.5",
                    )

                    search_status_luma = color_luminance(ai_state_styles["statusColor"])
                    add_check(
                        "search status color is dark enough",
                        search_status_luma is not None and search_status_luma <= 0.5,
                        actual={"color": ai_state_styles["statusColor"], "luminance": search_status_luma},
                        expected="luminance <= 0.5",
                    )

                    status_error_luma = color_luminance(ai_state_styles["statusErrorColor"])
                    search_surface_luma = min_opaque_luminance(
                        ai_state_styles["searchSurfaceBackgroundImage"],
                        ai_state_styles["searchSurfaceBackgroundColor"],
                        min_alpha=0.72,
                    )
                    status_error_contrast = contrast_ratio(search_surface_luma, status_error_luma)
                    add_check(
                        "search error status text is readable on light search surface",
                        ai_state_styles["statusTone"] == "error"
                        and search_surface_luma is not None
                        and search_surface_luma >= 0.72
                        and status_error_luma is not None
                        and status_error_luma <= 0.4
                        and status_error_contrast is not None
                        and status_error_contrast >= 4.5,
                        actual={
                            "tone": ai_state_styles["statusTone"],
                            "searchSurfaceBackgroundImage": ai_state_styles["searchSurfaceBackgroundImage"],
                            "searchSurfaceBackgroundColor": ai_state_styles["searchSurfaceBackgroundColor"],
                            "searchSurfaceLuminance": search_surface_luma,
                            "errorColor": ai_state_styles["statusErrorColor"],
                            "errorColorLuminance": status_error_luma,
                            "contrast": status_error_contrast,
                        },
                        expected="tone=error, surface luminance >= 0.72, error luminance <= 0.4, contrast >= 4.5",
                    )

                    coil_border_luma = color_luminance(ai_state_styles["coilBorderColor"])
                    add_check(
                        "ai toggle coil searching color is bright enough",
                        coil_border_luma is not None and coil_border_luma >= 0.9,
                        actual={"color": ai_state_styles["coilBorderColor"], "luminance": coil_border_luma},
                        expected="luminance >= 0.9",
                    )

                    geo_track_luma = color_luminance(ai_state_styles["geoTrackColor"])
                    add_check(
                        "ai loading track color is not near-white",
                        geo_track_luma is not None and geo_track_luma <= 0.72,
                        actual={"color": ai_state_styles["geoTrackColor"], "luminance": geo_track_luma},
                        expected="luminance <= 0.72",
                    )

                    geo_scan_luma = color_luminance(ai_state_styles["geoScanColor"])
                    add_check(
                        "ai loading scan color is not near-white",
                        geo_scan_luma is not None and geo_scan_luma <= 0.72,
                        actual={"color": ai_state_styles["geoScanColor"], "luminance": geo_scan_luma},
                        expected="luminance <= 0.72",
                    )

                    geo_node_stroke_luma = color_luminance(ai_state_styles["geoNodeStrokeColor"])
                    add_check(
                        "ai loading node stroke color is not near-white",
                        geo_node_stroke_luma is not None and geo_node_stroke_luma <= 0.72,
                        actual={"color": ai_state_styles["geoNodeStrokeColor"], "luminance": geo_node_stroke_luma},
                        expected="luminance <= 0.72",
                    )

                    geo_node_fill_luma = color_luminance(ai_state_styles["geoNodeFillColor"])
                    add_check(
                        "ai loading node fill color is dark enough",
                        geo_node_fill_luma is not None and geo_node_fill_luma <= 0.45,
                        actual={"color": ai_state_styles["geoNodeFillColor"], "luminance": geo_node_fill_luma},
                        expected="luminance <= 0.45",
                    )

                sidebar = context.new_page()
                sidebar.goto(sidebar_url, wait_until="domcontentloaded")
                sidebar.wait_for_selector(".sidebar-topbar", timeout=15000)

                for selector in [".sidebar-topbar", "#sidebar-messages", "#sidebar-form"]:
                    add_check(
                        f"sidebar shell has {selector}",
                        sidebar.locator(selector).count() > 0,
                    )

                sidebar_theme = sidebar.evaluate(
                    """() => {
                        const root = document.documentElement;
                        const style = getComputedStyle(root);
                        const meta = document.querySelector('meta[name="color-scheme"]');
                        return {
                            metaColorScheme: (meta?.content || '').trim(),
                            computedColorScheme: (style.colorScheme || '').trim(),
                            sidebarBgTop: style.getPropertyValue('--sidebar-bg-top').trim(),
                            rootColor: style.color.trim(),
                        };
                    }"""
                )

                add_check(
                    "sidebar meta color-scheme includes light",
                    "light" in sidebar_theme["metaColorScheme"].lower(),
                    actual={
                        "computed": sidebar_theme["computedColorScheme"],
                        "meta": sidebar_theme["metaColorScheme"],
                    },
                    expected="meta color-scheme contains 'light'",
                )

                sidebar_bg_rgb = parse_color(sidebar_theme["sidebarBgTop"])
                sidebar_bg_luma = relative_luminance(sidebar_bg_rgb) if sidebar_bg_rgb else None
                add_check(
                    "sidebar --sidebar-bg-top is light",
                    sidebar_bg_luma is not None and sidebar_bg_luma >= 0.7,
                    actual={"token": sidebar_theme["sidebarBgTop"], "luminance": sidebar_bg_luma},
                    expected="luminance >= 0.7",
                )

                root_color_rgb = parse_color(sidebar_theme["rootColor"])
                root_color_luma = relative_luminance(root_color_rgb) if root_color_rgb else None
                add_check(
                    "sidebar root color is dark enough",
                    root_color_luma is not None and root_color_luma <= 0.35,
                    actual={"color": sidebar_theme["rootColor"], "luminance": root_color_luma},
                    expected="luminance <= 0.35",
                )

                sidebar_surface_styles = sidebar.evaluate(
                    """() => {
                        const shell = document.querySelector('.sidebar-shell');
                        const topbar = document.querySelector('.sidebar-topbar');
                        const topbarTitle = document.querySelector('.sidebar-topbar-title');
                        const statusPill = document.querySelector('.sidebar-status-pill');
                        const messages = document.querySelector('#sidebar-messages');
                        const form = document.querySelector('#sidebar-form');
                        const inputShell = document.querySelector('.sidebar-input-shell');
                        const input = document.querySelector('#sidebar-input');
                        const submit = document.querySelector('#sidebar-submit');
                        const quickAction = document.querySelector('.sidebar-quick-action');

                        if (!shell || !topbar || !topbarTitle || !statusPill || !messages || !form || !inputShell || !input || !submit || !quickAction) {
                            return null;
                        }

                        const fixture = document.createElement('section');
                        fixture.id = 'verify-sidebar-task4-fixture';
                        fixture.style.position = 'fixed';
                        fixture.style.left = '-9999px';
                        fixture.style.top = '-9999px';
                        fixture.style.width = '360px';
                        fixture.style.pointerEvents = 'none';
                        fixture.innerHTML = `
                            <div class="sidebar-message-row" data-role="assistant">
                                <p class="sidebar-message-meta">assistant</p>
                                <div class="sidebar-message-bubble">助手消息可读性检查。</div>
                            </div>
                            <div class="sidebar-message-row" data-role="user">
                                <p class="sidebar-message-meta">user</p>
                                <div class="sidebar-message-bubble">用户消息可读性检查。</div>
                            </div>
                            <div class="sidebar-message-row" data-role="assistant" data-sidebar-message-kind="tool_result">
                                <p class="sidebar-message-meta">tool</p>
                                <div class="sidebar-message-bubble">
                                    <div class="sidebar-tool-receipt-head">
                                        <span class="sidebar-tool-receipt-glyph">✓</span>
                                        <span class="sidebar-tool-receipt-label">工具执行</span>
                                    </div>
                                    <p class="sidebar-tool-receipt-text">工具结果卡片可读性检查。</p>
                                </div>
                            </div>
                            <section class="sidebar-state-card sidebar-inline-state" data-sidebar-state-variant="locked">
                                <h2 class="sidebar-state-title">locked</h2>
                                <p class="sidebar-state-description">locked description</p>
                            </section>
                            <section class="sidebar-state-card sidebar-inline-state" data-sidebar-state-variant="error">
                                <h2 class="sidebar-state-title">error</h2>
                                <p class="sidebar-state-description">error description</p>
                            </section>
                            <section class="sidebar-state-card sidebar-inline-state" data-sidebar-state-variant="degraded">
                                <h2 class="sidebar-state-title">degraded</h2>
                                <p class="sidebar-state-description">degraded description</p>
                            </section>
                            <section class="sidebar-trace">
                                <div class="sidebar-trace-rail"></div>
                                <div class="sidebar-trace-row" data-trace-status="done">
                                    <span class="sidebar-trace-dot"></span>
                                    <span class="sidebar-trace-copy">
                                        <span class="sidebar-trace-text">trace readable text</span>
                                        <span class="sidebar-trace-meta">meta</span>
                                    </span>
                                </div>
                            </section>
                        `;
                        document.body.appendChild(fixture);

                        try {
                            const assistantBubble = fixture.querySelector('.sidebar-message-row[data-role="assistant"] .sidebar-message-bubble');
                            const userBubble = fixture.querySelector('.sidebar-message-row[data-role="user"] .sidebar-message-bubble');
                            const toolBubble = fixture.querySelector('[data-sidebar-message-kind="tool_result"] .sidebar-message-bubble');
                            const toolText = fixture.querySelector('.sidebar-tool-receipt-text');
                            const lockedCard = fixture.querySelector('[data-sidebar-state-variant="locked"]');
                            const lockedText = lockedCard?.querySelector('.sidebar-state-description');
                            const errorCard = fixture.querySelector('[data-sidebar-state-variant="error"]');
                            const errorText = errorCard?.querySelector('.sidebar-state-description');
                            const degradedCard = fixture.querySelector('[data-sidebar-state-variant="degraded"]');
                            const degradedText = degradedCard?.querySelector('.sidebar-state-description');
                            const trace = fixture.querySelector('.sidebar-trace');
                            const traceRow = fixture.querySelector('.sidebar-trace-row');
                            const traceText = fixture.querySelector('.sidebar-trace-text');

                            if (!assistantBubble || !userBubble || !toolBubble || !toolText || !lockedCard || !lockedText || !errorCard || !errorText || !degradedCard || !degradedText || !trace || !traceRow || !traceText) {
                                return null;
                            }

                            const shellStyle = getComputedStyle(shell);
                            const topbarStyle = getComputedStyle(topbar);
                            const topbarTitleStyle = getComputedStyle(topbarTitle);
                            const statusPillStyle = getComputedStyle(statusPill);
                            const messagesStyle = getComputedStyle(messages);
                            const assistantBubbleStyle = getComputedStyle(assistantBubble);
                            const userBubbleStyle = getComputedStyle(userBubble);
                            const toolBubbleStyle = getComputedStyle(toolBubble);
                            const toolTextStyle = getComputedStyle(toolText);
                            const formStyle = getComputedStyle(form);
                            const inputShellStyle = getComputedStyle(inputShell);
                            const inputStyle = getComputedStyle(input);
                            const inputPlaceholderStyle = getComputedStyle(input, '::placeholder');
                            const submitStyle = getComputedStyle(submit);
                            const quickActionStyle = getComputedStyle(quickAction);
                            const lockedCardStyle = getComputedStyle(lockedCard);
                            const lockedTextStyle = getComputedStyle(lockedText);
                            const errorCardStyle = getComputedStyle(errorCard);
                            const errorTextStyle = getComputedStyle(errorText);
                            const degradedCardStyle = getComputedStyle(degradedCard);
                            const degradedTextStyle = getComputedStyle(degradedText);
                            const traceStyle = getComputedStyle(trace);
                            const traceRowStyle = getComputedStyle(traceRow);
                            const traceTextStyle = getComputedStyle(traceText);
                            const shellRect = shell.getBoundingClientRect();
                            const topbarRect = topbar.getBoundingClientRect();

                            return {
                                shellBackgroundImage: shellStyle.backgroundImage,
                                shellBackgroundColor: shellStyle.backgroundColor,
                                shellBorderColor: shellStyle.borderColor,
                                topbarBackgroundImage: topbarStyle.backgroundImage,
                                topbarBackgroundColor: topbarStyle.backgroundColor,
                                topbarBorderColor: topbarStyle.borderColor,
                                topbarTitleColor: topbarTitleStyle.color,
                                statusPillBackgroundColor: statusPillStyle.backgroundColor,
                                statusPillColor: statusPillStyle.color,
                                messagesBackgroundImage: messagesStyle.backgroundImage,
                                messagesBackgroundColor: messagesStyle.backgroundColor,
                                messagesBorderColor: messagesStyle.borderColor,
                                assistantBubbleBackgroundColor: assistantBubbleStyle.backgroundColor,
                                assistantBubbleColor: assistantBubbleStyle.color,
                                userBubbleBackgroundColor: userBubbleStyle.backgroundColor,
                                userBubbleColor: userBubbleStyle.color,
                                toolBubbleBackgroundImage: toolBubbleStyle.backgroundImage,
                                toolBubbleBackgroundColor: toolBubbleStyle.backgroundColor,
                                toolBubbleTextColor: toolTextStyle.color,
                                formBackgroundImage: formStyle.backgroundImage,
                                formBackgroundColor: formStyle.backgroundColor,
                                formBorderColor: formStyle.borderColor,
                                inputShellBackgroundColor: inputShellStyle.backgroundColor,
                                inputColor: inputStyle.color,
                                inputPlaceholderColor: inputPlaceholderStyle.color,
                                submitBackgroundImage: submitStyle.backgroundImage,
                                submitBackgroundColor: submitStyle.backgroundColor,
                                submitTextColor: submitStyle.color,
                                quickActionBackgroundColor: quickActionStyle.backgroundColor,
                                quickActionColor: quickActionStyle.color,
                                lockedCardBackgroundImage: lockedCardStyle.backgroundImage,
                                lockedCardBackgroundColor: lockedCardStyle.backgroundColor,
                                lockedCardTextColor: lockedTextStyle.color,
                                lockedCardBorderColor: lockedCardStyle.borderColor,
                                errorCardBackgroundImage: errorCardStyle.backgroundImage,
                                errorCardBackgroundColor: errorCardStyle.backgroundColor,
                                errorCardTextColor: errorTextStyle.color,
                                errorCardBorderColor: errorCardStyle.borderColor,
                                degradedCardBackgroundImage: degradedCardStyle.backgroundImage,
                                degradedCardBackgroundColor: degradedCardStyle.backgroundColor,
                                degradedCardTextColor: degradedTextStyle.color,
                                degradedCardBorderColor: degradedCardStyle.borderColor,
                                traceBackgroundImage: traceStyle.backgroundImage,
                                traceBackgroundColor: traceStyle.backgroundColor,
                                traceRowBackgroundImage: traceRowStyle.backgroundImage,
                                traceRowBackgroundColor: traceRowStyle.backgroundColor,
                                traceRowTextColor: traceTextStyle.color,
                                shellWidth: shellRect.width,
                                topbarWidth: topbarRect.width,
                            };
                        } finally {
                            fixture.remove();
                        }
                    }"""
                )

                add_check("sidebar task4 style fixture renders", isinstance(sidebar_surface_styles, dict))
                if isinstance(sidebar_surface_styles, dict):
                    shell_surface_luma = min_opaque_luminance(
                        sidebar_surface_styles["shellBackgroundImage"],
                        sidebar_surface_styles["shellBackgroundColor"],
                    )
                    add_check(
                        "sidebar shell background reads as light surface",
                        shell_surface_luma is not None and shell_surface_luma >= 0.66,
                        actual={
                            "backgroundImage": sidebar_surface_styles["shellBackgroundImage"],
                            "backgroundColor": sidebar_surface_styles["shellBackgroundColor"],
                            "luminance": shell_surface_luma,
                        },
                        expected="luminance >= 0.66",
                    )

                    topbar_surface_luma = min_opaque_luminance(
                        sidebar_surface_styles["topbarBackgroundImage"],
                        sidebar_surface_styles["topbarBackgroundColor"],
                        min_alpha=0.55,
                    )
                    topbar_title_luma = color_luminance(sidebar_surface_styles["topbarTitleColor"])
                    add_check(
                        "sidebar topbar surface and title are readable on light theme",
                        topbar_surface_luma is not None
                        and topbar_surface_luma >= 0.68
                        and topbar_title_luma is not None
                        and topbar_title_luma <= 0.45,
                        actual={
                            "backgroundImage": sidebar_surface_styles["topbarBackgroundImage"],
                            "backgroundColor": sidebar_surface_styles["topbarBackgroundColor"],
                            "surfaceLuminance": topbar_surface_luma,
                            "titleColor": sidebar_surface_styles["topbarTitleColor"],
                            "titleLuminance": topbar_title_luma,
                        },
                        expected="topbar surface luminance >= 0.68 and title luminance <= 0.45",
                    )

                    status_pill_luma = color_luminance(sidebar_surface_styles["statusPillColor"])
                    add_check(
                        "sidebar status pill text is readable on light topbar",
                        status_pill_luma is not None and status_pill_luma <= 0.5,
                        actual={
                            "pillColor": sidebar_surface_styles["statusPillColor"],
                            "pillLuminance": status_pill_luma,
                            "pillBackground": sidebar_surface_styles["statusPillBackgroundColor"],
                        },
                        expected="luminance <= 0.5",
                    )

                    messages_surface_luma = min_opaque_luminance(
                        sidebar_surface_styles["messagesBackgroundImage"],
                        sidebar_surface_styles["messagesBackgroundColor"],
                        min_alpha=0.55,
                    )
                    add_check(
                        "sidebar messages panel is light enough",
                        messages_surface_luma is not None and messages_surface_luma >= 0.7,
                        actual={
                            "backgroundImage": sidebar_surface_styles["messagesBackgroundImage"],
                            "backgroundColor": sidebar_surface_styles["messagesBackgroundColor"],
                            "luminance": messages_surface_luma,
                        },
                        expected="luminance >= 0.7",
                    )

                    newtab_shell_styles = newtab.evaluate(
                        """() => {
                            const frame = document.querySelector('.outline-search-frame');
                            const frameRect = frame?.getBoundingClientRect();
                            if (!frame || !frameRect) {
                                return null;
                            }
                            const frameStyle = getComputedStyle(frame);
                            const rect = document.querySelector('.outline-search-outline-rect');
                            const trigger = document.querySelector('#search-target-trigger');
                            const bubbleLayer = document.querySelector('.homepage-bubble-layer');
                            const shellWidth = Math.round(frameRect.width * 1000) / 1000;
                            const shellBorderWidth = frameStyle.borderTopWidth;
                            const shellBorderColor = frameStyle.borderTopColor;
                            const frameBackgroundImage = frameStyle.backgroundImage;
                            const frameBackgroundColor = frameStyle.backgroundColor;

                            return {
                                frameBackgroundImage,
                                frameBackgroundColor,
                                shellBorderColor,
                                outlineStroke: rect ? getComputedStyle(rect).stroke : null,
                                triggerBorderColor: trigger ? getComputedStyle(trigger).borderRightColor : null,
                                bodyBackgroundImage: getComputedStyle(document.body).backgroundImage,
                                bubbleLayerOpacity: bubbleLayer ? getComputedStyle(bubbleLayer).opacity : null,
                                bubbleLayerFilter: bubbleLayer ? getComputedStyle(bubbleLayer).filter : null,
                                lineAlignmentGeometry: (() => {
                                    const frameBorderTopWidth = Number.parseFloat(frameStyle.borderTopWidth) || 0;
                                    const frameBorderRightWidth = Number.parseFloat(frameStyle.borderRightWidth) || 0;
                                    const frameBorderBottomWidth = Number.parseFloat(frameStyle.borderBottomWidth) || 0;
                                    const frameBorderLeftWidth = Number.parseFloat(frameStyle.borderLeftWidth) || 0;
                                    const frameBorder = {
                                        left: frameRect.left + frameBorderLeftWidth / 2,
                                        top: frameRect.top + frameBorderTopWidth / 2,
                                        right: frameRect.right - frameBorderRightWidth / 2,
                                        bottom: frameRect.bottom - frameBorderBottomWidth / 2,
                                        widths: {
                                            top: frameBorderTopWidth,
                                            right: frameBorderRightWidth,
                                            bottom: frameBorderBottomWidth,
                                            left: frameBorderLeftWidth,
                                        },
                                    };

                                    const outlineRect = rect?.getBoundingClientRect();
                                    const outline = outlineRect
                                        ? {
                                            left: outlineRect.left,
                                            top: outlineRect.top,
                                            right: outlineRect.right,
                                            bottom: outlineRect.bottom,
                                        }
                                        : null;

                                    const triggerRect = trigger?.getBoundingClientRect();
                                    const triggerStyle = trigger ? getComputedStyle(trigger) : null;
                                    const triggerBorderRightWidth = triggerStyle
                                        ? (Number.parseFloat(triggerStyle.borderRightWidth) || 0)
                                        : 0;
                                    const separator = triggerRect
                                        ? {
                                            x: triggerRect.right - triggerBorderRightWidth / 2,
                                            top: triggerRect.top,
                                            bottom: triggerRect.bottom,
                                            width: triggerBorderRightWidth,
                                        }
                                        : null;

                                    return {
                                        frameBorder,
                                        outline,
                                        separator,
                                    };
                                })(),
                                bubbleBackdropSamples: (() => {
                                    const canvas = bubbleLayer?.querySelector('canvas');
                                    if (!canvas) {
                                        return null;
                                    }
                                    const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
                                    if (!gl) {
                                        return null;
                                    }
                                    const width = gl.drawingBufferWidth || canvas.width;
                                    const height = gl.drawingBufferHeight || canvas.height;
                                    if (!width || !height) {
                                        return null;
                                    }
                                    const toLinear = (channel) => {
                                        const value = channel / 255;
                                        if (value <= 0.03928) {
                                            return value / 12.92;
                                        }
                                        return Math.pow((value + 0.055) / 1.055, 2.4);
                                    };
                                    const sampleAt = (nx, ny) => {
                                        const x = Math.max(0, Math.min(width - 1, Math.floor(nx * width)));
                                        const y = Math.max(0, Math.min(height - 1, Math.floor(ny * height)));
                                        const pixel = new Uint8Array(4);
                                        gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
                                        return 0.2126 * toLinear(pixel[0]) + 0.7152 * toLinear(pixel[1]) + 0.0722 * toLinear(pixel[2]);
                                    };
                                    const seamLeft = sampleAt(0.70, 0.52);
                                    const seamRight = sampleAt(0.86, 0.52);
                                    return {
                                        seamLeft,
                                        seamRight,
                                        seamDelta: Math.abs(seamLeft - seamRight),
                                    };
                                })(),
                                shellWidth,
                            };
                        }"""
                    )

                    add_check("newtab shell style block is readable", isinstance(newtab_shell_styles, dict))
                    if isinstance(newtab_shell_styles, dict):
                        newtab_surface_luma = min_opaque_luminance(
                            newtab_shell_styles["frameBackgroundImage"],
                            newtab_shell_styles["frameBackgroundColor"],
                            min_alpha=0.55,
                        )
                        add_check(
                            "newtab search shell is warm-light",
                            newtab_surface_luma is not None and newtab_surface_luma >= 0.72,
                            actual={
                                "backgroundImage": newtab_shell_styles["frameBackgroundImage"],
                                "backgroundColor": newtab_shell_styles["frameBackgroundColor"],
                                "luminance": newtab_surface_luma,
                            },
                            expected="luminance >= 0.72",
                        )

                        shell_vs_newtab_delta = (
                            abs(shell_surface_luma - newtab_surface_luma)
                            if shell_surface_luma is not None and newtab_surface_luma is not None
                            else None
                        )
                        add_check(
                            "sidebar shell and newtab search shell are cohesive",
                            shell_vs_newtab_delta is not None and shell_vs_newtab_delta <= 0.13,
                            actual={
                                "sidebarShellLuminance": shell_surface_luma,
                                "newtabShellLuminance": newtab_surface_luma,
                                "delta": shell_vs_newtab_delta,
                            },
                            expected="surface luminance delta <= 0.13",
                        )

                        topbar_vs_newtab_delta = (
                            abs(topbar_surface_luma - newtab_surface_luma)
                            if topbar_surface_luma is not None and newtab_surface_luma is not None
                            else None
                        )
                        add_check(
                            "sidebar topbar and newtab shell are visually aligned",
                            topbar_vs_newtab_delta is not None and topbar_vs_newtab_delta <= 0.08,
                            actual={
                                "sidebarTopbarLuminance": topbar_surface_luma,
                                "newtabShellLuminance": newtab_surface_luma,
                                "delta": topbar_vs_newtab_delta,
                            },
                            expected="surface luminance delta <= 0.08",
                        )

                        line_alignment_geometry = newtab_shell_styles.get("lineAlignmentGeometry")
                        frame_border_geometry = (
                            line_alignment_geometry.get("frameBorder")
                            if isinstance(line_alignment_geometry, dict)
                            else None
                        )
                        outline_geometry = (
                            line_alignment_geometry.get("outline")
                            if isinstance(line_alignment_geometry, dict)
                            else None
                        )
                        separator_geometry = (
                            line_alignment_geometry.get("separator")
                            if isinstance(line_alignment_geometry, dict)
                            else None
                        )

                        frame_outline_edge_delta = None
                        if isinstance(frame_border_geometry, dict) and isinstance(outline_geometry, dict):
                            frame_outline_edge_delta = max(
                                abs(frame_border_geometry["left"] - outline_geometry["left"]),
                                abs(frame_border_geometry["top"] - outline_geometry["top"]),
                                abs(frame_border_geometry["right"] - outline_geometry["right"]),
                                abs(frame_border_geometry["bottom"] - outline_geometry["bottom"]),
                            )

                        separator_outline_span_delta = None
                        if isinstance(separator_geometry, dict) and isinstance(outline_geometry, dict):
                            separator_outline_span_delta = max(
                                abs(separator_geometry["top"] - outline_geometry["top"]),
                                abs(separator_geometry["bottom"] - outline_geometry["bottom"]),
                            )

                        separator_frame_span_delta = None
                        if isinstance(separator_geometry, dict) and isinstance(frame_border_geometry, dict):
                            separator_frame_span_delta = max(
                                abs(separator_geometry["top"] - frame_border_geometry["top"]),
                                abs(separator_geometry["bottom"] - frame_border_geometry["bottom"]),
                            )

                        add_check(
                            "search outline rect overlaps visible frame border geometry",
                            frame_outline_edge_delta is not None and frame_outline_edge_delta <= 1.25,
                            actual={
                                "frameBorder": frame_border_geometry,
                                "outline": outline_geometry,
                                "maxEdgeDelta": frame_outline_edge_delta,
                            },
                            expected="max edge delta <= 1.25px",
                        )

                        add_check(
                            "search separator line aligns with outline vertical span",
                            separator_outline_span_delta is not None and separator_outline_span_delta <= 1.25,
                            actual={
                                "separator": separator_geometry,
                                "outline": outline_geometry,
                                "maxSpanDelta": separator_outline_span_delta,
                            },
                            expected="separator top/bottom vs outline top/bottom delta <= 1.25px",
                        )

                        add_check(
                            "search separator line aligns with frame border vertical span",
                            separator_frame_span_delta is not None and separator_frame_span_delta <= 1.25,
                            actual={
                                "separator": separator_geometry,
                                "frameBorder": frame_border_geometry,
                                "maxSpanDelta": separator_frame_span_delta,
                            },
                            expected="separator top/bottom vs frame-border top/bottom delta <= 1.25px",
                        )

                        outline_stroke_luma = color_luminance(newtab_shell_styles["outlineStroke"])
                        frame_border_luma = color_luminance(newtab_shell_styles["shellBorderColor"])
                        outline_border_delta = (
                            abs(outline_stroke_luma - frame_border_luma)
                            if outline_stroke_luma is not None and frame_border_luma is not None
                            else None
                        )
                        outline_border_contrast = contrast_ratio(outline_stroke_luma, frame_border_luma)
                        add_check(
                            "search animated outline stroke is visually distinguishable from frame border",
                            outline_stroke_luma is not None
                            and frame_border_luma is not None
                            and outline_border_delta is not None
                            and outline_border_delta >= 0.065
                            and outline_border_contrast is not None
                            and outline_border_contrast >= 1.22,
                            actual={
                                "outlineStroke": newtab_shell_styles["outlineStroke"],
                                "outlineLuminance": outline_stroke_luma,
                                "frameBorder": newtab_shell_styles["shellBorderColor"],
                                "frameBorderLuminance": frame_border_luma,
                                "luminanceDelta": outline_border_delta,
                                "contrast": outline_border_contrast,
                            },
                            expected="outline/frame luminance delta >= 0.065 and contrast >= 1.22",
                        )

                        card_border_lumas = [
                            color_luminance(sidebar_surface_styles["lockedCardBorderColor"]),
                            color_luminance(sidebar_surface_styles["errorCardBorderColor"]),
                            color_luminance(sidebar_surface_styles["degradedCardBorderColor"]),
                        ]
                        card_border_opaque_alpha = max_alpha_for_dark_tokens(
                            sidebar_surface_styles["lockedCardBorderColor"],
                            sidebar_surface_styles["errorCardBorderColor"],
                            sidebar_surface_styles["degradedCardBorderColor"],
                        )
                        add_check(
                            "sidebar state cards keep visible warm paper borders",
                            all(luma is not None and luma <= 0.5 for luma in card_border_lumas)
                            and card_border_opaque_alpha is not None
                            and card_border_opaque_alpha >= 0.2,
                            actual={
                                "lockedCardBorder": sidebar_surface_styles["lockedCardBorderColor"],
                                "errorCardBorder": sidebar_surface_styles["errorCardBorderColor"],
                                "degradedCardBorder": sidebar_surface_styles["degradedCardBorderColor"],
                                "borderLuminances": card_border_lumas,
                                "maxOpaqueAlpha": card_border_opaque_alpha,
                            },
                            expected="border luminance <= 0.5 and alpha >= 0.2",
                        )

                    sidebar_open_patch = newtab.evaluate(
                        """() => {
                            const extensionApi = typeof chrome !== 'undefined' ? chrome : null;
                            const tabsApi = extensionApi?.tabs;
                            const sidePanelApi = extensionApi?.sidePanel;
                            if (!tabsApi?.query || !sidePanelApi?.open) {
                                return {
                                    ok: false,
                                    reason: 'missing-sidepanel-api',
                                    hasTabsQuery: Boolean(tabsApi?.query),
                                    hasSidePanelOpen: Boolean(sidePanelApi?.open),
                                };
                            }

                            try {
                                const originalQuery = tabsApi.query.bind(tabsApi);
                                const originalOpen = sidePanelApi.open.bind(sidePanelApi);
                                window.__VERIFY_SIDE_PANEL_PATCH__ = {
                                    queryCallCount: 0,
                                    openCallCount: 0,
                                    restore: () => {
                                        tabsApi.query = originalQuery;
                                        sidePanelApi.open = originalOpen;
                                    },
                                };

                                tabsApi.query = async () => {
                                    window.__VERIFY_SIDE_PANEL_PATCH__.queryCallCount += 1;
                                    return [{ id: 1, active: true, windowId: 9001 }];
                                };

                                sidePanelApi.open = async () => {
                                    window.__VERIFY_SIDE_PANEL_PATCH__.openCallCount += 1;
                                    await new Promise((resolve) => setTimeout(resolve, 110));
                                };

                                return {
                                    ok: true,
                                    viewport: {
                                        width: window.innerWidth,
                                        height: window.innerHeight,
                                    },
                                };
                            } catch (error) {
                                return {
                                    ok: false,
                                    reason: 'patch-failed',
                                    message: error instanceof Error ? error.message : String(error),
                                };
                            }
                        }"""
                    )

                    add_check(
                        "ai sidebar open flow hook is ready",
                        isinstance(sidebar_open_patch, dict) and sidebar_open_patch.get("ok") is True,
                        actual=sidebar_open_patch,
                        expected="can patch chrome.tabs.query and chrome.sidePanel.open for real open-flow verification",
                    )

                    if isinstance(sidebar_open_patch, dict) and sidebar_open_patch.get("ok"):
                        bubble_before_open = newtab.evaluate(
                            """() => {
                                const body = document.body;
                                const layer = document.querySelector('.homepage-bubble-layer');
                                if (!layer) {
                                    return null;
                                }

                                const sample = () => {
                                    const canvas = layer.querySelector('canvas');
                                    if (!canvas) {
                                        return null;
                                    }
                                    const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
                                    if (!gl) {
                                        return null;
                                    }
                                    const width = gl.drawingBufferWidth || canvas.width;
                                    const height = gl.drawingBufferHeight || canvas.height;
                                    if (!width || !height) {
                                        return null;
                                    }
                                    const toLinear = (channel) => {
                                        const value = channel / 255;
                                        if (value <= 0.03928) {
                                            return value / 12.92;
                                        }
                                        return Math.pow((value + 0.055) / 1.055, 2.4);
                                    };
                                    const points = [[0.18, 0.5], [0.52, 0.5], [0.74, 0.5], [0.88, 0.5]];
                                    const values = points.map(([nx, ny]) => {
                                        const x = Math.max(0, Math.min(width - 1, Math.floor(nx * width)));
                                        const y = Math.max(0, Math.min(height - 1, Math.floor(ny * height)));
                                        const pixel = new Uint8Array(4);
                                        gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
                                        return 0.2126 * toLinear(pixel[0]) + 0.7152 * toLinear(pixel[1]) + 0.0722 * toLinear(pixel[2]);
                                    });
                                    const minLuma = Math.min(...values);
                                    const maxLuma = Math.max(...values);
                                    return {
                                        samples: values,
                                        minLuma,
                                        maxLuma,
                                        spread: maxLuma - minLuma,
                                    };
                                };

                                return {
                                    bodyClass: body.className,
                                    hasSidebarOpenClass: body.classList.contains('is-ai-sidebar-open'),
                                    opacity: getComputedStyle(layer).opacity,
                                    filter: getComputedStyle(layer).filter,
                                    sample: sample(),
                                };
                            }"""
                        )

                        open_sidebar_button = newtab.locator("#open-ai-sidebar")
                        add_check("open-ai-sidebar trigger exists", open_sidebar_button.count() > 0)

                        bubble_after_open = None
                        bubble_after_resize = None
                        class_toggled = False
                        if open_sidebar_button.count() > 0:
                            open_sidebar_button.click()
                            try:
                                newtab.wait_for_function(
                                    """() => document.body.classList.contains('is-ai-sidebar-open')""",
                                    timeout=4000,
                                )
                                class_toggled = True
                            except Exception:
                                class_toggled = False

                            newtab.wait_for_timeout(120)
                            bubble_after_open = newtab.evaluate(
                                """() => {
                                    const body = document.body;
                                    const layer = document.querySelector('.homepage-bubble-layer');
                                    if (!layer) {
                                        return null;
                                    }

                                    const sample = () => {
                                        const canvas = layer.querySelector('canvas');
                                        if (!canvas) {
                                            return null;
                                        }
                                        const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
                                        if (!gl) {
                                            return null;
                                        }
                                        const width = gl.drawingBufferWidth || canvas.width;
                                        const height = gl.drawingBufferHeight || canvas.height;
                                        if (!width || !height) {
                                            return null;
                                        }
                                        const toLinear = (channel) => {
                                            const value = channel / 255;
                                            if (value <= 0.03928) {
                                                return value / 12.92;
                                            }
                                            return Math.pow((value + 0.055) / 1.055, 2.4);
                                        };
                                        const points = [[0.18, 0.5], [0.52, 0.5], [0.74, 0.5], [0.88, 0.5]];
                                        const values = points.map(([nx, ny]) => {
                                            const x = Math.max(0, Math.min(width - 1, Math.floor(nx * width)));
                                            const y = Math.max(0, Math.min(height - 1, Math.floor(ny * height)));
                                            const pixel = new Uint8Array(4);
                                            gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
                                            return 0.2126 * toLinear(pixel[0]) + 0.7152 * toLinear(pixel[1]) + 0.0722 * toLinear(pixel[2]);
                                        });
                                        const minLuma = Math.min(...values);
                                        const maxLuma = Math.max(...values);
                                        return {
                                            samples: values,
                                            minLuma,
                                            maxLuma,
                                            spread: maxLuma - minLuma,
                                        };
                                    };

                                    return {
                                        bodyClass: body.className,
                                        hasSidebarOpenClass: body.classList.contains('is-ai-sidebar-open'),
                                        opacity: getComputedStyle(layer).opacity,
                                        filter: getComputedStyle(layer).filter,
                                        sample: sample(),
                                    };
                                }"""
                            )

                            viewport = sidebar_open_patch.get("viewport") or {"width": 1280, "height": 720}
                            original_width = max(760, int(viewport.get("width", 1280)))
                            original_height = max(620, int(viewport.get("height", 720)))
                            resized_width = max(760, original_width - 220)
                            newtab.set_viewport_size({"width": resized_width, "height": original_height})
                            newtab.wait_for_timeout(180)
                            bubble_after_resize = newtab.evaluate(
                                """() => {
                                    const body = document.body;
                                    const layer = document.querySelector('.homepage-bubble-layer');
                                    if (!layer) {
                                        return null;
                                    }

                                    const sample = () => {
                                        const canvas = layer.querySelector('canvas');
                                        if (!canvas) {
                                            return null;
                                        }
                                        const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
                                        if (!gl) {
                                            return null;
                                        }
                                        const width = gl.drawingBufferWidth || canvas.width;
                                        const height = gl.drawingBufferHeight || canvas.height;
                                        if (!width || !height) {
                                            return null;
                                        }
                                        const toLinear = (channel) => {
                                            const value = channel / 255;
                                            if (value <= 0.03928) {
                                                return value / 12.92;
                                            }
                                            return Math.pow((value + 0.055) / 1.055, 2.4);
                                        };
                                        const points = [[0.18, 0.5], [0.52, 0.5], [0.74, 0.5], [0.88, 0.5]];
                                        const values = points.map(([nx, ny]) => {
                                            const x = Math.max(0, Math.min(width - 1, Math.floor(nx * width)));
                                            const y = Math.max(0, Math.min(height - 1, Math.floor(ny * height)));
                                            const pixel = new Uint8Array(4);
                                            gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
                                            return 0.2126 * toLinear(pixel[0]) + 0.7152 * toLinear(pixel[1]) + 0.0722 * toLinear(pixel[2]);
                                        });
                                        const minLuma = Math.min(...values);
                                        const maxLuma = Math.max(...values);
                                        return {
                                            samples: values,
                                            minLuma,
                                            maxLuma,
                                            spread: maxLuma - minLuma,
                                        };
                                    };

                                    return {
                                        bodyClass: body.className,
                                        hasSidebarOpenClass: body.classList.contains('is-ai-sidebar-open'),
                                        opacity: getComputedStyle(layer).opacity,
                                        filter: getComputedStyle(layer).filter,
                                        sample: sample(),
                                    };
                                }"""
                            )
                            newtab.set_viewport_size({"width": original_width, "height": original_height})
                            newtab.wait_for_timeout(100)

                        sidepanel_call_metrics = newtab.evaluate(
                            """() => ({
                                queryCallCount: window.__VERIFY_SIDE_PANEL_PATCH__?.queryCallCount ?? 0,
                                openCallCount: window.__VERIFY_SIDE_PANEL_PATCH__?.openCallCount ?? 0,
                            })"""
                        )

                        sidebar_open_style_changed = (
                            isinstance(bubble_before_open, dict)
                            and isinstance(bubble_after_open, dict)
                            and (
                                bubble_after_open.get("opacity") != bubble_before_open.get("opacity")
                                or bubble_after_open.get("filter") != bubble_before_open.get("filter")
                            )
                        )

                        add_check(
                            "real ai sidebar open flow toggles stable open-state class",
                            class_toggled
                            and isinstance(sidepanel_call_metrics, dict)
                            and sidepanel_call_metrics.get("queryCallCount", 0) >= 1
                            and sidepanel_call_metrics.get("openCallCount", 0) >= 1
                            and isinstance(bubble_after_open, dict)
                            and bubble_after_open.get("hasSidebarOpenClass") is True
                            and isinstance(bubble_after_resize, dict)
                            and bubble_after_resize.get("hasSidebarOpenClass") is True
                            and sidebar_open_style_changed,
                            actual={
                                "classToggled": class_toggled,
                                "styleChanged": sidebar_open_style_changed,
                                "sidePanelCallMetrics": sidepanel_call_metrics,
                                "before": bubble_before_open,
                                "afterOpen": bubble_after_open,
                                "afterResize": bubble_after_resize,
                            },
                            expected="open flow calls tabs.query + sidePanel.open, sets is-ai-sidebar-open, keeps class through resize, and applies sidebar-open visual style",
                        )

                        before_open_continuity = None
                        after_resize_continuity = None
                        if isinstance(bubble_before_open, dict) and open_sidebar_button.count() > 0:
                            before_open_screenshot = newtab.screenshot(type="png", full_page=True)
                            before_open_continuity = measure_bubble_continuity_from_screenshot(before_open_screenshot)
                        if isinstance(bubble_after_resize, dict) and open_sidebar_button.count() > 0:
                            after_resize_screenshot = newtab.screenshot(type="png", full_page=True)
                            after_resize_continuity = measure_bubble_continuity_from_screenshot(after_resize_screenshot)

                        continuity_has_signal = (
                            isinstance(before_open_continuity, dict)
                            and isinstance(after_resize_continuity, dict)
                        )
                        continuity_keeps_warm_light = (
                            continuity_has_signal
                            and after_resize_continuity["meanLuma"] is not None
                            and after_resize_continuity["stddevLuma"] is not None
                            and after_resize_continuity["meanLuma"] >= 0.44
                            and after_resize_continuity["stddevLuma"] <= 0.15
                            and after_resize_continuity["lumaSpan"] <= 0.28
                        )
                        continuity_has_no_harsh_seam = (
                            continuity_has_signal
                            and after_resize_continuity["sidebarPeakStep"] <= 0.0011
                            and after_resize_continuity["sidebarPeakToBaselineRatio"] <= 1.8
                        )

                        add_check(
                            "sidebar-open bubble backdrop remains warm-light and without harsh seam",
                            continuity_keeps_warm_light and continuity_has_no_harsh_seam,
                            actual={
                                "continuityHasSignal": continuity_has_signal,
                                "continuityKeepsWarmLight": continuity_keeps_warm_light,
                                "continuityHasNoHarshSeam": continuity_has_no_harsh_seam,
                                "beforeOpenContinuity": before_open_continuity,
                                "afterResizeContinuity": after_resize_continuity,
                                "beforeSample": bubble_before_open.get("sample") if isinstance(bubble_before_open, dict) else None,
                                "afterResizeSample": bubble_after_resize.get("sample") if isinstance(bubble_after_resize, dict) else None,
                                "beforeOpacity": bubble_before_open.get("opacity") if isinstance(bubble_before_open, dict) else None,
                                "afterResizeOpacity": bubble_after_resize.get("opacity") if isinstance(bubble_after_resize, dict) else None,
                                "beforeFilter": bubble_before_open.get("filter") if isinstance(bubble_before_open, dict) else None,
                                "afterResizeFilter": bubble_after_resize.get("filter") if isinstance(bubble_after_resize, dict) else None,
                            },
                            expected="real screenshot continuity signal is required; after resize meanLuma >= 0.44, stddev <= 0.15, luma span <= 0.28, sidebar peak step <= 0.0011, and sidebar peak/baseline ratio <= 1.8",
                        )

                        newtab.evaluate(
                            """() => {
                                try {
                                    window.__VERIFY_SIDE_PANEL_PATCH__?.restore?.();
                                } catch (_) {
                                }
                                delete window.__VERIFY_SIDE_PANEL_PATCH__;
                                document.body.classList.remove('is-ai-sidebar-open');
                            }"""
                        )

                    assistant_bubble_luma = color_luminance(sidebar_surface_styles["assistantBubbleBackgroundColor"])
                    assistant_text_luma = color_luminance(sidebar_surface_styles["assistantBubbleColor"])
                    add_check(
                        "assistant bubble is readable on warm light surface",
                        assistant_bubble_luma is not None
                        and assistant_bubble_luma >= 0.7
                        and assistant_text_luma is not None
                        and assistant_text_luma <= 0.45,
                        actual={
                            "background": sidebar_surface_styles["assistantBubbleBackgroundColor"],
                            "backgroundLuminance": assistant_bubble_luma,
                            "textColor": sidebar_surface_styles["assistantBubbleColor"],
                            "textLuminance": assistant_text_luma,
                        },
                        expected="background luminance >= 0.7 and text luminance <= 0.45",
                    )

                    user_bubble_luma = color_luminance(sidebar_surface_styles["userBubbleBackgroundColor"])
                    user_text_luma = color_luminance(sidebar_surface_styles["userBubbleColor"])
                    bubble_delta = abs(user_bubble_luma - assistant_bubble_luma) if user_bubble_luma is not None and assistant_bubble_luma is not None else None
                    add_check(
                        "user bubble stays distinct from assistant bubble",
                        user_bubble_luma is not None
                        and user_text_luma is not None
                        and user_text_luma <= 0.45
                        and bubble_delta is not None
                        and bubble_delta >= 0.04,
                        actual={
                            "userBackground": sidebar_surface_styles["userBubbleBackgroundColor"],
                            "userBackgroundLuminance": user_bubble_luma,
                            "assistantBackgroundLuminance": assistant_bubble_luma,
                            "backgroundDelta": bubble_delta,
                            "userTextColor": sidebar_surface_styles["userBubbleColor"],
                            "userTextLuminance": user_text_luma,
                        },
                        expected="user text luminance <= 0.45 and bubble luminance delta >= 0.04",
                    )

                    tool_bubble_luma = min_opaque_luminance(
                        sidebar_surface_styles["toolBubbleBackgroundImage"],
                        sidebar_surface_styles["toolBubbleBackgroundColor"],
                        min_alpha=0.45,
                    )
                    tool_text_luma = color_luminance(sidebar_surface_styles["toolBubbleTextColor"])
                    add_check(
                        "tool-result bubble reads like light paper receipt",
                        tool_bubble_luma is not None
                        and tool_bubble_luma >= 0.66
                        and tool_text_luma is not None
                        and tool_text_luma <= 0.45,
                        actual={
                            "backgroundImage": sidebar_surface_styles["toolBubbleBackgroundImage"],
                            "backgroundColor": sidebar_surface_styles["toolBubbleBackgroundColor"],
                            "backgroundLuminance": tool_bubble_luma,
                            "textColor": sidebar_surface_styles["toolBubbleTextColor"],
                            "textLuminance": tool_text_luma,
                        },
                        expected="background luminance >= 0.66 and text luminance <= 0.45",
                    )

                    form_surface_luma = min_opaque_luminance(
                        sidebar_surface_styles["formBackgroundImage"],
                        sidebar_surface_styles["formBackgroundColor"],
                        min_alpha=0.55,
                    )
                    input_shell_luma = color_luminance(sidebar_surface_styles["inputShellBackgroundColor"])
                    input_text_luma = color_luminance(sidebar_surface_styles["inputColor"])
                    placeholder_luma = color_luminance(sidebar_surface_styles["inputPlaceholderColor"])
                    add_check(
                        "composer and input are readable on light theme",
                        form_surface_luma is not None
                        and form_surface_luma >= 0.68
                        and input_shell_luma is not None
                        and input_shell_luma >= 0.7
                        and input_text_luma is not None
                        and input_text_luma <= 0.45
                        and placeholder_luma is not None
                        and placeholder_luma <= 0.62,
                        actual={
                            "formBackgroundImage": sidebar_surface_styles["formBackgroundImage"],
                            "formBackgroundColor": sidebar_surface_styles["formBackgroundColor"],
                            "formLuminance": form_surface_luma,
                            "inputShellBackground": sidebar_surface_styles["inputShellBackgroundColor"],
                            "inputShellLuminance": input_shell_luma,
                            "inputColor": sidebar_surface_styles["inputColor"],
                            "inputLuminance": input_text_luma,
                            "placeholderColor": sidebar_surface_styles["inputPlaceholderColor"],
                            "placeholderLuminance": placeholder_luma,
                        },
                        expected="form/input shell luminance >= 0.68/0.7, input text <= 0.45, placeholder <= 0.62",
                    )

                    submit_background_token = first_color_token(sidebar_surface_styles["submitBackgroundImage"]) or sidebar_surface_styles["submitBackgroundColor"]
                    submit_bg_luma = color_luminance(submit_background_token)
                    submit_text_luma = color_luminance(sidebar_surface_styles["submitTextColor"])
                    submit_contrast = contrast_ratio(submit_bg_luma, submit_text_luma)
                    add_check(
                        "composer submit button keeps strong readable contrast",
                        submit_bg_luma is not None
                        and submit_bg_luma <= 0.55
                        and submit_text_luma is not None
                        and submit_text_luma >= 0.88
                        and submit_contrast is not None
                        and submit_contrast >= 4.5,
                        actual={
                            "background": sidebar_surface_styles["submitBackgroundImage"],
                            "backgroundToken": submit_background_token,
                            "backgroundLuminance": submit_bg_luma,
                            "textColor": sidebar_surface_styles["submitTextColor"],
                            "textLuminance": submit_text_luma,
                            "contrast": submit_contrast,
                        },
                        expected="button background luminance <= 0.55, text >= 0.88, contrast >= 4.5",
                    )

                    quick_action_bg_luma = color_luminance(sidebar_surface_styles["quickActionBackgroundColor"])
                    quick_action_text_luma = color_luminance(sidebar_surface_styles["quickActionColor"])
                    add_check(
                        "quick action chip is light with readable text",
                        quick_action_bg_luma is not None
                        and quick_action_bg_luma >= 0.72
                        and quick_action_text_luma is not None
                        and quick_action_text_luma <= 0.5,
                        actual={
                            "background": sidebar_surface_styles["quickActionBackgroundColor"],
                            "backgroundLuminance": quick_action_bg_luma,
                            "textColor": sidebar_surface_styles["quickActionColor"],
                            "textLuminance": quick_action_text_luma,
                        },
                        expected="background luminance >= 0.72 and text luminance <= 0.5",
                    )

                    def add_state_card_check(card_name: str, image_key: str, color_key: str, text_key: str) -> None:
                        card_surface_luma = min_opaque_luminance(
                            sidebar_surface_styles[image_key],
                            sidebar_surface_styles[color_key],
                            min_alpha=0.45,
                        )
                        card_text_luma = color_luminance(sidebar_surface_styles[text_key])
                        add_check(
                            f"{card_name} state card stays readable on light theme",
                            card_surface_luma is not None
                            and card_surface_luma >= 0.66
                            and card_text_luma is not None
                            and card_text_luma <= 0.5,
                            actual={
                                "backgroundImage": sidebar_surface_styles[image_key],
                                "backgroundColor": sidebar_surface_styles[color_key],
                                "backgroundLuminance": card_surface_luma,
                                "textColor": sidebar_surface_styles[text_key],
                                "textLuminance": card_text_luma,
                            },
                            expected="background luminance >= 0.66 and text luminance <= 0.5",
                        )

                    add_state_card_check("locked", "lockedCardBackgroundImage", "lockedCardBackgroundColor", "lockedCardTextColor")
                    add_state_card_check("error", "errorCardBackgroundImage", "errorCardBackgroundColor", "errorCardTextColor")
                    add_state_card_check("degraded", "degradedCardBackgroundImage", "degradedCardBackgroundColor", "degradedCardTextColor")

                    trace_surface_luma = min_opaque_luminance(
                        sidebar_surface_styles["traceBackgroundImage"],
                        sidebar_surface_styles["traceBackgroundColor"],
                        min_alpha=0.3,
                    )
                    trace_row_luma = min_opaque_luminance(
                        sidebar_surface_styles["traceRowBackgroundImage"],
                        sidebar_surface_styles["traceRowBackgroundColor"],
                        min_alpha=0.25,
                    )
                    trace_text_luma = color_luminance(sidebar_surface_styles["traceRowTextColor"])
                    add_check(
                        "trace panel and rows are readable on light theme",
                        trace_surface_luma is not None
                        and trace_surface_luma >= 0.64
                        and trace_row_luma is not None
                        and trace_row_luma >= 0.66
                        and trace_text_luma is not None
                        and trace_text_luma <= 0.5,
                        actual={
                            "traceBackgroundImage": sidebar_surface_styles["traceBackgroundImage"],
                            "traceBackgroundColor": sidebar_surface_styles["traceBackgroundColor"],
                            "traceLuminance": trace_surface_luma,
                            "traceRowBackgroundImage": sidebar_surface_styles["traceRowBackgroundImage"],
                            "traceRowBackgroundColor": sidebar_surface_styles["traceRowBackgroundColor"],
                            "traceRowLuminance": trace_row_luma,
                            "traceTextColor": sidebar_surface_styles["traceRowTextColor"],
                            "traceTextLuminance": trace_text_luma,
                        },
                        expected="trace panel/row luminance >= 0.64/0.66 and trace text luminance <= 0.5",
                    )

                newtab.close()
                sidebar.close()
            finally:
                context.close()
    except Exception as exc:
        result["errors"].append(f"{type(exc).__name__}: {exc}")
    finally:
        shutil.rmtree(user_data_dir, ignore_errors=True)

    result["ok"] = not failed_checks and not result["errors"]
    if failed_checks:
        result["failed_checks"] = failed_checks

    print(json.dumps(result, ensure_ascii=False, separators=(",", ":")))
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    sys.exit(main())
