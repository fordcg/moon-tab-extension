const TARGET_URL = chrome.runtime.getURL("src/pages/newtab/index.html");

function getTabUrl(tab, changeInfo = {}) {
  return changeInfo.url || tab.pendingUrl || tab.url || "";
}

function isEdgeNewTabUrl(rawUrl) {
  if (!rawUrl || rawUrl === TARGET_URL) {
    return false;
  }

  if (rawUrl === "edge://newtab/" || rawUrl === "chrome://newtab/" || rawUrl === "about:newtab") {
    return true;
  }

  try {
    const parsedUrl = new URL(rawUrl);
    return parsedUrl.hostname.startsWith("ntp.msn.") && parsedUrl.pathname === "/edge/ntp";
  } catch {
    return false;
  }
}

function redirectTab(tabId) {
  chrome.tabs.update(tabId, { url: TARGET_URL }, () => {
    if (chrome.runtime.lastError) {
      return;
    }
  });
}

function maybeRedirect(tab, changeInfo = {}) {
  if (!tab || typeof tab.id !== "number") {
    return;
  }

  const tabUrl = getTabUrl(tab, changeInfo);
  if (!isEdgeNewTabUrl(tabUrl)) {
    return;
  }

  redirectTab(tab.id);
}

chrome.tabs.onCreated.addListener((tab) => {
  maybeRedirect(tab);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (!changeInfo.url && changeInfo.status !== "loading") {
    return;
  }

  maybeRedirect({ ...tab, id: tabId }, changeInfo);
});
