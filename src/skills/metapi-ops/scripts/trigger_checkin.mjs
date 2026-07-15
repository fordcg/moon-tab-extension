import { metapiRequest } from "./_common.mjs";

const waitSeconds = Number(process.argv[2] || 0);
metapiRequest("POST", "/api/checkin/trigger", {});
if (Number.isFinite(waitSeconds) && waitSeconds > 0) {
  // scripts are fire-and-forget; waiting is better done by caller
  console.error(`提示：如需等待请在调用侧 sleep ${waitSeconds}s 后再拉日志`);
}
