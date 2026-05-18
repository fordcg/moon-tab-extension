# Homepage Background Continuity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate the vertical background seam that appears after viewport resize or AI sidebar open on the warm-light new tab page, while keeping the refreshed-page look continuous.

**Architecture:** Add a targeted Playwright verifier that reproduces the seam and measures center-band continuity from screenshots. Then fix the runtime refresh path so viewport changes and `is-ai-sidebar-open` state changes both trigger a reliable homepage layout + bubble-layer refresh; only apply a CSS fallback if the runtime fix still leaves a measurable seam.

**Tech Stack:** Manifest V3 extension, native ESM, Playwright Python, Pillow, Three.js/WebGL, CSS fixed-layer backgrounds

---

## File Map

- **Create:** `.tmp/verify_newtab_extension.py`
  - Targeted regression verifier for this bug only.
  - Opens the unpacked extension new tab page, captures baseline/resize/sidebar screenshots, and asserts center-band continuity.
- **Modify:** `src/pages/newtab/index.mjs`
  - Centralize homepage layout refresh logic.
  - Ensure resize and AI sidebar open both explicitly refresh the bubble layer without duplicating timing code.
- **Modify:** `src/pages/newtab/liquid-glass-bubble-layer.mjs`
  - Make `syncSize()` return whether the render surface changed.
  - Ensure `handleResize()` and exported `refresh()` force a render after size changes.
- **Modify only if Task 3 is needed:** `src/pages/newtab/styles/index.css`
  - Remove the sidebar-open background attachment mismatch and normalize sidebar-open background overlays.

---

### Task 1: Create the targeted failing verifier

**Files:**
- Create: `.tmp/verify_newtab_extension.py`
- Reference only: `.tmp/verify_warm_light_theme.py`
- Test: `.tmp/verify_newtab_extension.py`

- [ ] **Step 1: Write the failing verifier script**

Create `D:/proj/test/.worktrees/ai-sidebar-mvp/.tmp/verify_newtab_extension.py` with this content:

```python
import json
import shutil
import tempfile
from io import BytesIO
from pathlib import Path

from PIL import Image, ImageFilter, ImageStat
from playwright.sync_api import TimeoutError, sync_playwright

ROOT = Path(__file__).resolve().parent.parent
EXTENSION_PATH = str(ROOT)
ARTIFACT_DIR = ROOT / ".tmp"
BASELINE_SCREENSHOT = ARTIFACT_DIR / "background-continuity-baseline.png"
RESIZE_SCREENSHOT = ARTIFACT_DIR / "background-continuity-resize.png"
SIDEBAR_SCREENSHOT = ARTIFACT_DIR / "background-continuity-sidebar.png"
RESULT_PATH = ARTIFACT_DIR / "background-continuity-result.json"


def wait_for_newtab_ready(page) -> None:
    page.wait_for_selector("#search-input", timeout=15000)
    page.wait_for_selector("#open-ai-sidebar", timeout=15000)
    page.wait_for_selector(".homepage-bubble-canvas", timeout=15000)
    page.wait_for_function(
        """() => {
            const input = document.querySelector('#search-input');
            return Boolean(input && !input.disabled);
        }""",
        timeout=15000,
    )


def open_newtab_page(context, extension_id: str):
    page = context.new_page()
    page.set_viewport_size({"width": 1440, "height": 960})
    page.goto(f"chrome-extension://{extension_id}/src/pages/newtab/index.html", wait_until="domcontentloaded")
    wait_for_newtab_ready(page)
    return page


def measure_center_band_delta(screenshot_bytes: bytes) -> dict:
    image = Image.open(BytesIO(screenshot_bytes)).convert("RGB")
    width, height = image.size
    top = int(height * 0.34)
    bottom = int(height * 0.94)
    center_x = width // 2
    band_width = max(24, width // 28)
    gap = max(10, width // 120)

    left_band = image.crop((center_x - gap - band_width, top, center_x - gap, bottom))
    right_band = image.crop((center_x + gap, top, center_x + gap + band_width, bottom))
    center_band = image.crop((center_x - 6, top, center_x + 6, bottom))

    left_band = left_band.filter(ImageFilter.GaussianBlur(radius=10)).convert("L")
    right_band = right_band.filter(ImageFilter.GaussianBlur(radius=10)).convert("L")
    center_band = center_band.filter(ImageFilter.GaussianBlur(radius=10)).convert("L")

    left_mean = ImageStat.Stat(left_band).mean[0] / 255
    right_mean = ImageStat.Stat(right_band).mean[0] / 255
    center_mean = ImageStat.Stat(center_band).mean[0] / 255

    return {
        "width": width,
        "height": height,
        "top": top,
        "bottom": bottom,
        "leftMean": left_mean,
        "rightMean": right_mean,
        "centerMean": center_mean,
        "bandDelta": abs(left_mean - right_mean),
        "centerToBandDelta": max(abs(center_mean - left_mean), abs(center_mean - right_mean)),
    }


def capture_metrics(page, screenshot_path: Path) -> dict:
    screenshot_bytes = page.screenshot(path=str(screenshot_path), full_page=True)
    metrics = measure_center_band_delta(screenshot_bytes)
    metrics["screenshot"] = str(screenshot_path)
    return metrics


def open_ai_sidebar(page) -> None:
    page.locator("#open-ai-sidebar").click()
    page.wait_for_function(
        "document.body.classList.contains('is-ai-sidebar-open')",
        timeout=15000,
    )
    page.wait_for_timeout(220)


def assert_continuity(label: str, baseline: dict, current: dict) -> None:
    assert current["bandDelta"] <= 0.035, (
        f"{label}: left/right luminance delta too large: {current['bandDelta']:.4f}"
    )
    assert current["centerToBandDelta"] <= 0.050, (
        f"{label}: center seam delta too large: {current['centerToBandDelta']:.4f}"
    )
    assert current["bandDelta"] - baseline["bandDelta"] <= 0.018, (
        f"{label}: resize/sidebar introduced extra seam delta: "
        f"baseline={baseline['bandDelta']:.4f}, current={current['bandDelta']:.4f}"
    )


def main() -> int:
    result = {
        "ok": False,
        "checks": [],
        "baseline": {},
        "resize": {},
        "sidebar": {},
        "errors": [],
    }
    user_data_dir = Path(tempfile.mkdtemp(prefix="background-continuity-verify-"))

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
                service_worker = (
                    context.service_workers[0]
                    if context.service_workers
                    else context.wait_for_event("serviceworker", timeout=15000)
                )
                extension_id = service_worker.url.split("/")[2]
                result["extensionId"] = extension_id

                page = open_newtab_page(context, extension_id)
                baseline = capture_metrics(page, BASELINE_SCREENSHOT)
                result["baseline"] = baseline
                result["checks"].append({"name": "baseline page ready", "ok": True})

                page.set_viewport_size({"width": 1100, "height": 860})
                page.wait_for_timeout(220)
                resize_metrics = capture_metrics(page, RESIZE_SCREENSHOT)
                result["resize"] = resize_metrics
                assert_continuity("resize continuity", baseline, resize_metrics)
                result["checks"].append({"name": "resize continuity", "ok": True, "metrics": resize_metrics})

                page.reload(wait_until="domcontentloaded")
                wait_for_newtab_ready(page)
                baseline_for_sidebar = capture_metrics(page, BASELINE_SCREENSHOT)
                open_ai_sidebar(page)
                sidebar_metrics = capture_metrics(page, SIDEBAR_SCREENSHOT)
                result["sidebar"] = sidebar_metrics
                assert_continuity("sidebar continuity", baseline_for_sidebar, sidebar_metrics)
                result["checks"].append({"name": "sidebar continuity", "ok": True, "metrics": sidebar_metrics})

                result["ok"] = True
            finally:
                context.close()
    except TimeoutError as error:
        result["errors"].append(f"timeout: {error}")
    except AssertionError as error:
        result["errors"].append(str(error))
    finally:
        RESULT_PATH.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
        shutil.rmtree(user_data_dir, ignore_errors=True)

    if result["ok"]:
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return 0

    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
```

- [ ] **Step 2: Run the verifier and confirm it fails on the current bug**

Run:

```bash
python ".tmp/verify_newtab_extension.py"
```

Expected: exit code `1` with a failure mentioning `resize continuity` and/or `sidebar continuity`, plus `.tmp/background-continuity-*.png` artifacts.

- [ ] **Step 3: Inspect the generated JSON and screenshots before touching production code**

Run:

```bash
python - <<'PY'
from pathlib import Path
print(Path('.tmp/background-continuity-result.json').read_text(encoding='utf-8'))
PY
```

Expected: the JSON contains `baseline`, `resize`, and/or `sidebar` metrics showing the seam grows after runtime changes.

- [ ] **Step 4: Do not commit yet**

Expected state:
- `.tmp/verify_newtab_extension.py` exists.
- The verifier reproduces the bug.
- The branch is intentionally red for this targeted regression.

---

### Task 2: Fix runtime refresh for resize and AI sidebar open

**Files:**
- Modify: `src/pages/newtab/index.mjs:136-185, 415-441`
- Modify: `src/pages/newtab/liquid-glass-bubble-layer.mjs:667-705, 839-884`
- Test: `.tmp/verify_newtab_extension.py`

- [ ] **Step 1: Re-run the targeted verifier immediately before code changes**

Run:

```bash
python ".tmp/verify_newtab_extension.py"
```

Expected: FAIL again for the same continuity check(s). Do not proceed if the failure has changed unexpectedly.

- [ ] **Step 2: Replace the duplicated sidebar refresh timing in `src/pages/newtab/index.mjs` with one reusable homepage refresh path**

Replace the current block starting at `const syncAiSidebarOpenState = (isOpen) => {` through the end of `openAiSidebar`, and update the bottom resize listener, with this code:

```js
const refreshHomepageLayout = () => {
  startupController.handleResize();
  window.__HOMEPAGE_BUBBLE_LAYER__?.refresh?.();
};

const scheduleHomepageLayoutRefresh = ({ delayMs = 0 } = {}) => {
  const run = () => {
    window.requestAnimationFrame(() => {
      refreshHomepageLayout();
      window.requestAnimationFrame(() => {
        refreshHomepageLayout();
      });
    });
  };

  if (delayMs > 0) {
    window.setTimeout(run, delayMs);
    return;
  }

  run();
};

const syncAiSidebarOpenState = (isOpen) => {
  if (typeof document === "undefined" || !(document.body instanceof HTMLElement)) {
    return;
  }

  const nextOpenState = Boolean(isOpen);
  const didChange = document.body.classList.contains("is-ai-sidebar-open") !== nextOpenState;
  document.body.classList.toggle("is-ai-sidebar-open", nextOpenState);

  if (didChange) {
    scheduleHomepageLayoutRefresh();
    scheduleHomepageLayoutRefresh({ delayMs: 120 });
  }
};

const openAiSidebar = async () => {
  if (!extensionApi?.sidePanel?.open || !extensionApi?.tabs?.query || typeof window === "undefined") {
    syncAiSidebarOpenState(false);
    setSearchStatus("当前环境不支持侧边栏，请在兼容浏览器中重试。", "error");
    return;
  }

  const wasSidebarOpen = document.body.classList.contains("is-ai-sidebar-open");

  try {
    const [activeTab] = await extensionApi.tabs.query({ active: true, currentWindow: true });
    if (!activeTab?.windowId) {
      syncAiSidebarOpenState(wasSidebarOpen);
      setSearchStatus("未找到当前窗口，无法打开 AI 侧边栏。", "error");
      return;
    }

    syncAiSidebarOpenState(true);
    await extensionApi.sidePanel.open({ windowId: activeTab.windowId });
    scheduleHomepageLayoutRefresh();
    scheduleHomepageLayoutRefresh({ delayMs: 120 });
    setSearchStatus("已打开 AI 助手侧边栏。", "success");
  } catch (error) {
    syncAiSidebarOpenState(wasSidebarOpen);
    setSearchStatus(error instanceof Error ? error.message : "打开 AI 侧边栏失败。", "error");
  }
};

window.addEventListener("resize", () => {
  refreshHomepageLayout();
});
```

Why this exact change:
- It removes the ad hoc inline refresh duplication.
- It refreshes both the SVG/search shell layout and the bubble layer from one path.
- It avoids `dispatchEvent(new Event("resize"))`, which would become recursive once resize itself also refreshes the bubble layer.

- [ ] **Step 3: Make `src/pages/newtab/liquid-glass-bubble-layer.mjs` force a render after size changes**

Update the `state` shape, `syncSize()`, `handleResize()`, and `refresh()` to this form:

```js
const state = {
  width: 1,
  height: 1,
  aspect: 1,
  devicePixelRatio: Math.min(2, window.devicePixelRatio || 1),
  droplets: initializeDroplets(),
  pointer: {
    x: 0,
    y: 0,
    active: false,
    down: false,
  },
  spawnCooldownMs: 0,
  autoSpawnElapsedMs: 0,
  simTimeMs: 0,
};

const syncSize = () => {
  const rect = root.getBoundingClientRect();
  const width = Math.max(1, Math.round(rect.width));
  const height = Math.max(1, Math.round(rect.height));
  const devicePixelRatio = Math.min(2, window.devicePixelRatio || 1);
  const pixelWidth = Math.max(1, Math.round(width * devicePixelRatio));
  const pixelHeight = Math.max(1, Math.round(height * devicePixelRatio));

  const didChange = (
    width !== state.width
    || height !== state.height
    || devicePixelRatio !== state.devicePixelRatio
    || renderer.domElement.width !== pixelWidth
    || renderer.domElement.height !== pixelHeight
  );

  state.width = width;
  state.height = height;
  state.aspect = width / height;
  state.devicePixelRatio = devicePixelRatio;

  renderer.setPixelRatio(devicePixelRatio);
  renderer.setSize(width, height, false);
  uniforms.uResolution.value.set(pixelWidth, pixelHeight);
  drawHeroBackdrop(backdrop, pixelWidth, pixelHeight);

  const limitX = state.aspect * 0.58;
  for (let index = 0; index < state.droplets.length; index += 1) {
    const droplet = state.droplets[index];
    droplet.x = clamp(droplet.x, -limitX, limitX);
    droplet.baseRestX = clamp(droplet.baseRestX, -limitX * 0.88, limitX * 0.88);
    droplet.restX = clamp(droplet.restX, -limitX * 0.88, limitX * 0.88);
    droplet.restY = clamp(droplet.restY, -0.45, 0.45);
  }

  return didChange;
};

const handleResize = () => {
  const didChange = syncSize();
  if (didChange) {
    renderFrame();
  }
  if (prefersReducedMotion() || document.hidden) {
    settleStaticPose();
  }
};

const refresh = () => {
  const didChange = syncSize();
  if (didChange || !rafId) {
    renderFrame();
  }
  if (prefersReducedMotion() || document.hidden) {
    settleStaticPose();
  }
};
```

Important details:
- Keep the existing droplet clamping loop exactly in `syncSize()`.
- Use `renderer.setSize(width, height, false)` so the canvas size updates without reintroducing style width/height churn.
- `refresh()` must be safe to call repeatedly from resize and sidebar timing hooks.

- [ ] **Step 4: Run the verifier and confirm the bug is fixed without CSS fallback**

Run:

```bash
python ".tmp/verify_newtab_extension.py"
```

Expected: exit code `0` and checks for both `resize continuity` and `sidebar continuity` pass.

- [ ] **Step 5: Commit the green regression test plus runtime fix**

Run:

```bash
git add .tmp/verify_newtab_extension.py src/pages/newtab/index.mjs src/pages/newtab/liquid-glass-bubble-layer.mjs && git commit -m "fix: resync homepage background after runtime layout changes"
```

Expected: one commit containing the targeted verifier and the runtime refresh fix.

---

### Task 3: Apply the CSS continuity fallback only if Task 2 still fails

**Files:**
- Modify only if needed: `src/pages/newtab/styles/index.css:178-193`
- Test: `.tmp/verify_newtab_extension.py`

- [ ] **Step 1: Gate this task with the verifier**

Run:

```bash
python ".tmp/verify_newtab_extension.py"
```

Expected:
- If it passes, skip the remaining steps in this task and move to Task 4.
- If it fails specifically on `sidebar continuity`, continue with Step 2.

- [ ] **Step 2: Normalize the sidebar-open background layers in `src/pages/newtab/styles/index.css`**

Replace the current `body.is-ai-sidebar-open` block with this exact CSS:

```css
body.is-ai-sidebar-open::before {
  opacity: 0.3;
}

body.is-ai-sidebar-open::after {
  opacity: 0.26;
}

body.is-ai-sidebar-open .homepage-bubble-layer {
  opacity: 0.96;
  filter: saturate(0.94) brightness(0.97);
}
```

This change intentionally removes:

```css
body.is-ai-sidebar-open {
  background-attachment: fixed;
}
```

because that body-level fixed attachment is the most likely remaining mismatch once the runtime refresh path is correct.

- [ ] **Step 3: Re-run the targeted verifier and confirm the fallback closes the seam**

Run:

```bash
python ".tmp/verify_newtab_extension.py"
```

Expected: exit code `0`; both continuity checks pass.

- [ ] **Step 4: Commit the fallback only if you actually changed CSS**

Run:

```bash
git add src/pages/newtab/styles/index.css && git commit -m "fix: normalize sidebar background continuity fallback"
```

Expected: no commit if Step 2 was skipped; otherwise one CSS-only follow-up commit.

---

### Task 4: Run final verification and capture handoff evidence

**Files:**
- Test: `.tmp/verify_newtab_extension.py`
- Test: `.tmp/verify_warm_light_theme.py`
- Review: `.tmp/background-continuity-result.json`

- [ ] **Step 1: Run the targeted regression verifier one final time**

Run:

```bash
python ".tmp/verify_newtab_extension.py"
```

Expected: PASS with `resize continuity` and `sidebar continuity` both green.

- [ ] **Step 2: Run the warm-light verification script to catch collateral theme regressions**

Run:

```bash
python ".tmp/verify_warm_light_theme.py"
```

Expected: PASS.

- [ ] **Step 3: Record the exact artifacts to mention in the handoff**

Run:

```bash
python - <<'PY'
from pathlib import Path
for path in [
    Path('.tmp/background-continuity-result.json'),
    Path('.tmp/background-continuity-baseline.png'),
    Path('.tmp/background-continuity-resize.png'),
    Path('.tmp/background-continuity-sidebar.png'),
]:
    print(path, 'exists=' + str(path.exists()))
PY
```

Expected: all four files exist and can be referenced in the final handoff.

- [ ] **Step 4: Handoff summary**

Include these facts in the execution handoff:
- The targeted verifier now reproduces and guards both resize and sidebar-open continuity.
- `src/pages/newtab/index.mjs` owns the explicit post-layout refresh path.
- `src/pages/newtab/liquid-glass-bubble-layer.mjs` now renders immediately after real size changes.
- Whether the CSS fallback in `src/pages/newtab/styles/index.css` was needed or skipped.

---

## Self-Review

- **Spec coverage:**
  - Targeted verifier in worktree: covered by Task 1.
  - Runtime refresh fix for resize and sidebar open: covered by Task 2.
  - CSS fallback only if needed: covered by Task 3.
  - Final validation and artifact capture: covered by Task 4.
- **Placeholder scan:** no TBD/TODO markers; each code-changing step includes exact code or exact commands.
- **Type consistency:** plan uses the same public hook name everywhere: `window.__HOMEPAGE_BUBBLE_LAYER__?.refresh?.()`.
