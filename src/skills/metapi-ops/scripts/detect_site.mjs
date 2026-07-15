import { metapiRequest } from "./_common.mjs";

const url = process.argv[2];
if (!url) {
  console.error("用法: node detect_site.mjs <url>");
  process.exit(1);
}
metapiRequest("POST", "/api/sites/detect", { url });
