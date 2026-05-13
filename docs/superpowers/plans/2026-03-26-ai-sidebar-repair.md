# AI Sidebar Repair Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the sidebar so “当前页问答” reliably targets the user’s real web page instead of the extension new-tab page, uses one clear background→content-script flow, and reports unsupported states clearly.

**Architecture:** Keep the existing sidebar UI, but tighten the runtime boundary: the background worker becomes the single authority for choosing the target tab, and the content script becomes the single place that reads page context and performs in-page actions. The sidebar page only renders state and sends structured requests; it never guesses which tab is “current”.

**Tech Stack:** Manifest V3 extension APIs, background service worker messaging, content scripts, plain HTML/CSS, native ESM modules, Python Playwright smoke validation.

---

## File structure

### Files to modify

- `manifest.json` — confirm sidebar/content-script permissions remain sufficient after the repair.
- `src/background/sidebar-bridge.js` — fix target-tab selection, remove duplicate executeScript path, route all context/action work through content-script messages, improve errors.
- `src/content/page-context.js` — remain the only in-page implementation for context extraction, scrolling, and focus.
- `src/pages/sidebar/sidebar-context-controller.mjs` — surface precise unsupported/empty-state messages from the background worker.
- `src/pages/sidebar/sidebar-action-controller.mjs` — keep action follow-up behavior aligned with the repaired message flow.
- `src/pages/sidebar/index.html` — only if an empty-state or explanatory copy change is needed.
- `.tmp/verify_newtab_extension.py` — add or adjust verification for “real web tab vs extension tab” behavior.

### Files to inspect while implementing

- `src/pages/newtab/index.mjs` — confirm the sidebar open flow still only opens the panel and does not claim the new-tab page is valid context.
- `src/shared/sidebar-contract.mjs` — reuse existing message/action constants exactly.

---

### Task 1: Reproduce the broken targeting behavior with an explicit check

**Files:**
- Modify: `.tmp/verify_newtab_extension.py`
- Inspect: `src/background/sidebar-bridge.js`
- Inspect: `src/pages/sidebar/sidebar-context-controller.mjs`

- [ ] **Step 1: Add a failing verification that proves the sidebar is not allowed to bind to the extension new-tab page**

Add a helper to the smoke script that opens a normal web page in the same browser window before opening the extension sidebar, then reads the sidebar’s rendered context URL/title.

Use this shape in `.tmp/verify_newtab_extension.py`:

```python
def assert_sidebar_context_targets_web_page(sidebar_page: Page, expected_url_fragment: str) -> None:
    sidebar_page.wait_for_selector("#sidebar-context-url", timeout=15000)
    context_url = sidebar_page.locator("#sidebar-context-url").inner_text().strip()
    assert expected_url_fragment in context_url, (
        f"Expected sidebar context URL to include {expected_url_fragment!r}, got {context_url!r}"
    )
    assert "chrome-extension://" not in context_url, (
        f"Sidebar incorrectly targeted extension page: {context_url!r}"
    )
```

In the main flow, after loading the unpacked extension and before opening the sidebar, navigate a regular tab to a stable HTTP/HTTPS page used by the existing smoke environment, then assert the sidebar context points to that page instead of the extension page.

- [ ] **Step 2: Run the verification to prove the current implementation fails**

Run: `python .tmp/verify_newtab_extension.py`

Expected: FAIL with an assertion similar to `Sidebar incorrectly targeted extension page` or a mismatch where the context URL is the extension new-tab page.

- [ ] **Step 3: Commit the failing test change only after capturing the failure locally in notes, not to git**

Do not commit the red state. Keep the modified verification file in the working tree while implementing the fix.

### Task 2: Make the background worker select only real target tabs

**Files:**
- Modify: `src/background/sidebar-bridge.js`
- Inspect: `manifest.json`
- Test: `.tmp/verify_newtab_extension.py`

- [ ] **Step 1: Replace permissive tab selection with explicit filtering rules**

In `src/background/sidebar-bridge.js`, update `queryActiveTab()` so it excludes:

- the sidebar page URL from `chrome.runtime.getURL("src/pages/sidebar/index.html")`
- the extension new-tab page URL from `chrome.runtime.getURL("src/pages/newtab/index.html")`
- any other `chrome-extension://` URL for this extension
- non-web pages such as `about:blank`, `chrome://*`, `edge://*`, and other non-HTTP(S) URLs

Implement the filter as a single helper so the selection rule is obvious:

```javascript
const isUsableSidebarTargetUrl = (url = "") => {
  if (!url || url === "about:blank") {
    return false;
  }

  if (url.startsWith(extensionApi.runtime.getURL(""))) {
    return false;
  }

  return url.startsWith("http://") || url.startsWith("https://");
};
```

Then use it inside `queryActiveTab()`:

```javascript
const queryActiveTab = async () => {
  const tabs = await extensionApi.tabs.query({ currentWindow: true });
  const candidateTabs = tabs.filter((tab) => typeof tab?.id === "number" && isUsableSidebarTargetUrl(tab.url || ""));

  const activeCandidateTab = candidateTabs.find((tab) => tab.active);
  if (activeCandidateTab) {
    return activeCandidateTab;
  }

  return candidateTabs.at(-1) ?? null;
};
```

- [ ] **Step 2: Return a precise error when no usable web page exists**

Update both `getActiveTabContext()` and `executeSidebarAction()` in `src/background/sidebar-bridge.js` to throw a user-facing error like:

```javascript
throw new Error("当前窗口没有可连接的网页标签页，请先打开一个普通网页。")
```

Use the same message in both places so the sidebar renders a consistent empty state.

- [ ] **Step 3: Run the smoke verification again**

Run: `python .tmp/verify_newtab_extension.py`

Expected: the previous wrong-target assertion is gone; later checks may still fail because the bridge is still using duplicated execution paths.

### Task 3: Remove the duplicate executeScript implementation and use one content-script message flow

**Files:**
- Modify: `src/background/sidebar-bridge.js`
- Inspect: `src/content/page-context.js`
- Inspect: `src/shared/sidebar-contract.mjs`
- Test: `.tmp/verify_newtab_extension.py`

- [ ] **Step 1: Delete the in-background DOM execution helpers**

From `src/background/sidebar-bridge.js`, remove:

- `buildPageContext`
- `executeScriptInTab`
- the inline DOM functions used for focus and scroll

The background worker should no longer read page DOM or manipulate the page directly.

- [ ] **Step 2: Route context reads and actions through the existing content-script contract**

Use the existing constants from `src/shared/sidebar-contract.mjs` and send messages to the selected tab:

```javascript
const sendSidebarContentMessage = async (tabId, message) => {
  return extensionApi.tabs.sendMessage(tabId, message);
};
```

For context:

```javascript
const response = await sendSidebarContentMessage(activeTab.id, {
  type: SIDEBAR_CONTENT_MESSAGE_TYPES.GET_CONTEXT,
});

if (!response?.ok || !response.context) {
  throw new Error(response?.error || "同步当前页上下文失败。");
}
```

For focus/scroll:

```javascript
return sendSidebarContentMessage(activeTab.id, {
  type: SIDEBAR_CONTENT_MESSAGE_TYPES.FOCUS_INPUT,
});
```

and

```javascript
return sendSidebarContentMessage(activeTab.id, {
  type: SIDEBAR_CONTENT_MESSAGE_TYPES.SCROLL,
  payload: payload.payload ?? {},
});
```

Keep `COPY`, `OPEN_LINK`, and `SWITCH_TAB` in the background worker because they are browser-level actions, not in-page actions.

- [ ] **Step 3: Keep action validation strict and unchanged**

Preserve the `isSidebarActionType(payload.type)` guard exactly before branching. Do not add any new action types in this repair.

- [ ] **Step 4: Run the smoke verification again**

Run: `python .tmp/verify_newtab_extension.py`

Expected: sidebar context sync, focus, and scroll behavior now pass through one consistent path. Any remaining failures should be concrete UI/assertion mismatches rather than wrong-tab routing.

### Task 4: Make the sidebar UI explain unsupported states clearly

**Files:**
- Modify: `src/pages/sidebar/sidebar-context-controller.mjs`
- Modify: `src/pages/sidebar/index.html` (only if copy or empty-state structure needs adjustment)
- Test: `.tmp/verify_newtab_extension.py`

- [ ] **Step 1: Preserve background-worker errors instead of masking them**

In `src/pages/sidebar/sidebar-context-controller.mjs`, keep throwing the original background message when `response?.ok` is false, and render a disconnected state before throwing.

Use this structure:

```javascript
if (!response?.ok || !response.context) {
  domController.renderContext({
    status: "未连接网页",
    title: "请先打开一个普通网页",
    url: "",
    hasSelection: false,
    hasMainText: false,
  });
  throw new Error(response?.error || "同步当前页上下文失败。");
}
```

- [ ] **Step 2: Verify the initial success state still shows real page data**

Keep the success branch unchanged except for any copy tweaks needed to distinguish a real connected page from an unsupported state.

- [ ] **Step 3: Add a verification for the empty state**

Extend `.tmp/verify_newtab_extension.py` with one scenario where the sidebar is opened without any usable HTTP(S) tab in the current window and assert that the feedback contains the explicit unsupported-state message instead of silently showing extension-page data.

- [ ] **Step 4: Run the smoke verification again**

Run: `python .tmp/verify_newtab_extension.py`

Expected: both the supported and unsupported scenarios pass with clear, deterministic sidebar messages.

### Task 5: Final verification and cleanup

**Files:**
- Modify: `manifest.json` (only if verification exposed missing permission/config)
- Verify: `.tmp/verify_newtab_extension.py`
- Verify: relevant changed JS files

- [ ] **Step 1: Confirm manifest and runtime wiring still match the repaired design**

Check that `manifest.json` still includes:

```json
{
  "permissions": ["permissions", "tabs", "storage", "sidePanel", "scripting", "activeTab"],
  "side_panel": {
    "default_path": "src/pages/sidebar/index.html"
  },
  "content_scripts": [
    {
      "matches": ["http://*/*", "https://*/*"],
      "js": ["src/content/page-context.js"],
      "run_at": "document_idle"
    }
  ]
}
```

If `scripting` is no longer needed after removing executeScript, remove it in this task and keep the manifest minimal.

- [ ] **Step 2: Run the full smoke verification fresh**

Run: `python .tmp/verify_newtab_extension.py`

Expected: PASS with no sidebar targeting regressions and no homepage smoke regressions.

- [ ] **Step 3: Review the diff for leftover dead code**

Specifically confirm there is no unused helper left in `src/background/sidebar-bridge.js` such as the old `sendMessageToTab`, `buildPageContext`, or `executeScriptInTab` path.

- [ ] **Step 4: Commit the repair**

```bash
git add manifest.json src/background/sidebar-bridge.js src/content/page-context.js src/pages/sidebar/sidebar-context-controller.mjs src/pages/sidebar/sidebar-action-controller.mjs src/pages/sidebar/index.html .tmp/verify_newtab_extension.py
git commit -m "fix: repair sidebar page targeting"
```

---

## Self-review

- **Spec coverage:** The plan covers the approved repair scope: correct target-tab selection, single content-script execution path, clear unsupported-state handling, and verification. It intentionally does not expand sidebar capabilities beyond the existing whitelist.
- **Placeholder scan:** No TODO/TBD placeholders remain. Each task names exact files, exact commands, and the concrete behavioral expectation.
- **Type consistency:** The plan uses the existing sidebar contract names (`SIDEBAR_MESSAGE_TYPES`, `SIDEBAR_CONTENT_MESSAGE_TYPES`, `isSidebarActionType`) consistently and keeps browser-level actions in the background worker only.
