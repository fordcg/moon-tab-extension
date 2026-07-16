import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(SCRIPT_DIR, "..");
const SINK_SCRIPT = resolve(SCRIPT_DIR, "model_diagnostics_sink.mjs");
const HOST = process.env.MODEL_DIAGNOSTICS_HOST || "127.0.0.1";
const PORT = Number.parseInt(process.env.MODEL_DIAGNOSTICS_PORT || "17334", 10);
const HEALTH_URL = `http://${HOST}:${PORT}/health`;

async function isHealthy() {
  try {
    const response = await fetch(HEALTH_URL, { method: "GET" });
    if (!response.ok) {
      return false;
    }
    const payload = await response.json().catch(() => null);
    return Boolean(payload && payload.ok);
  } catch {
    return false;
  }
}

async function main() {
  if (await isHealthy()) {
    console.log(`model-diagnostics already running at ${HEALTH_URL}`);
    process.exit(0);
  }

  const child = spawn(process.execPath, [SINK_SCRIPT], {
    cwd: PROJECT_ROOT,
    detached: true,
    stdio: "ignore",
    windowsHide: true,
    env: process.env,
  });
  child.unref();

  for (let attempt = 0; attempt < 20; attempt += 1) {
    await new Promise((resolveWait) => setTimeout(resolveWait, 150));
    if (await isHealthy()) {
      console.log(`model-diagnostics started at ${HEALTH_URL}`);
      process.exit(0);
    }
  }

  console.error(`model-diagnostics failed to become healthy at ${HEALTH_URL}`);
  process.exit(1);
}

main();
