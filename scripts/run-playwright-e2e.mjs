// @ts-check
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);

const host = "127.0.0.1";
let serverProcess;

process.on("SIGTERM", () => void shutdown(143));
process.on("SIGINT", () => void shutdown(130));

try {
  await runNpmScript("build:extension");
  serverProcess = spawn(process.execPath, ["scripts/playwright-static-server.mjs"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PLAYWRIGHT_STATIC_HOST: host,
      PLAYWRIGHT_STATIC_PORT: "0",
    },
    stdio: ["ignore", "inherit", "inherit", "ipc"],
  });
  serverProcess.once("exit", (code) => {
    if (code !== 0 && code !== null) {
      console.error(`Playwright static server exited early with code ${code}.`);
    }
  });
  const serverUrl = await waitForServerReady(serverProcess);
  await waitForServer(serverUrl, serverProcess);

  const playwrightPackagePath = require.resolve("playwright/package.json");
  const playwrightCli = path.join(path.dirname(playwrightPackagePath), "cli.js");
  const exitCode = await runCommand(process.execPath, [playwrightCli, "test", ...process.argv.slice(2)], {
    PLAYWRIGHT_BASE_URL: serverUrl,
    PLAYWRIGHT_SKIP_WEBSERVER: "1",
  });
  await shutdown(exitCode);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  await shutdown(1);
}

async function runCommand(command, args, env = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: process.cwd(),
      env: { ...process.env, ...env },
      stdio: "inherit",
    });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) {
        resolve(0);
        return;
      }
      reject(new Error(`${command} ${args.join(" ")} exited with code ${code ?? "null"}.`));
    });
  });
}

/**
 * @param {import("node:child_process").ChildProcess} server
 * @returns {Promise<string>}
 */
function waitForServerReady(server) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error("Timed out waiting for the Playwright static server to report its URL."));
    }, 30_000);

    const cleanup = () => {
      clearTimeout(timeout);
      server.off("error", onError);
      server.off("exit", onExit);
      server.off("message", onMessage);
    };
    const onError = (error) => {
      cleanup();
      reject(error);
    };
    const onExit = (code, signal) => {
      cleanup();
      reject(new Error(`Playwright static server exited before it was ready (code ${code ?? "null"}, signal ${signal ?? "none"}).`));
    };
    const onMessage = (message) => {
      if (
        typeof message !== "object"
        || message === null
        || !("type" in message)
        || !("url" in message)
        || message.type !== "playwright-static-server-ready"
        || typeof message.url !== "string"
      ) {
        return;
      }
      cleanup();
      resolve(message.url);
    };

    server.once("error", onError);
    server.once("exit", onExit);
    server.on("message", onMessage);
  });
}

/**
 * @param {string} url
 * @param {import("node:child_process").ChildProcess} server
 */
async function waitForServer(url, server) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 30_000) {
    if (server.exitCode !== null) {
      throw new Error(`Playwright static server exited with code ${server.exitCode} before accepting requests.`);
    }
    try {
      const response = await fetch(url);
      if (response.ok) {
        return;
      }
    } catch {
      // Server not ready yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for ${url}.`);
}

async function shutdown(exitCode) {
  if (serverProcess && serverProcess.exitCode === null && !serverProcess.killed) {
    await new Promise((resolve) => {
      const timer = setTimeout(resolve, 2_000);
      serverProcess.once("exit", () => {
        clearTimeout(timer);
        resolve(undefined);
      });
      serverProcess.kill();
    });
  }
  process.exit(exitCode);
}

function resolveNpmCommand() {
  return process.platform === "win32" ? "npm.cmd" : "npm";
}

function runNpmScript(scriptName) {
  if (process.env.npm_execpath) {
    return runCommand(process.execPath, [process.env.npm_execpath, "run", scriptName]);
  }
  return runCommand(resolveNpmCommand(), ["run", scriptName]);
}
