(() => {
  const isExtensionRuntime = globalThis.location?.protocol === "chrome-extension:";
  const params = new URLSearchParams(globalThis.location?.search ?? "");
  const isPreviewFrame = params.has("open-design-preview");

  if (isExtensionRuntime || isPreviewFrame) {
    return;
  }

  globalThis.location.replace(new URL("./open-design-preview.html", globalThis.location.href));
})();
