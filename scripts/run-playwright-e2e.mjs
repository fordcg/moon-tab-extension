// @ts-check
import { spawn } from "node:child_process";
import path from "node:path";

const host = "127.0.0.1";
const port = 4173;
const serverUrl = `http://${host}:${port}`;
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
      PLAYWRIGHT_STATIC_PORT: String(port),
    },
    stdio: ["ignore", "inherit", "inherit"],
  });
  serverProcess.once("exit", (code) => {
    if (code !== 0 && code !== null) {
      console.error(`Playwright static server exited early with code ${code}.`);
    }
  });
  await waitForServer(serverUrl);

  const playwrightCli = path.resolve(process.cwd(), "node_modules", "playwright", "cli.js");
  const exitCode = await runCommand(process.execPath, [playwrightCli, "test", ...process.argv.slice(2)], {
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

async function waitForServer(url) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 30_000) {
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
  if (serverProcess && !serverProcess.killed) {
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
