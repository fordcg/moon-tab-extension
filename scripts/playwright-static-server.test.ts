import { spawn, type ChildProcess } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const projectRoot = process.cwd();
const serverScript = resolve(projectRoot, "scripts", "playwright-static-server.mjs");
const children = new Set<ChildProcess>();
const tempDirectories = new Set<string>();

afterEach(async () => {
  await Promise.all([...children].map(stopChild));
  children.clear();
  await Promise.all([...tempDirectories].map((directory) => rm(directory, { force: true, recursive: true })));
  tempDirectories.clear();
});

describe("Playwright static server", () => {
  it("uses an OS-assigned port and reports the owned URL over IPC", async () => {
    const workingDirectory = await mkdtemp(join(tmpdir(), "playwright-static-server-"));
    tempDirectories.add(workingDirectory);
    await mkdir(join(workingDirectory, "dist"));
    await writeFile(join(workingDirectory, "dist", "index.html"), "owned server", "utf8");

    const child = spawn(process.execPath, [serverScript], {
      cwd: workingDirectory,
      env: {
        ...process.env,
        PLAYWRIGHT_STATIC_HOST: "127.0.0.1",
        PLAYWRIGHT_STATIC_PORT: "0",
      },
      stdio: ["ignore", "ignore", "pipe", "ipc"],
    });
    children.add(child);

    const serverUrl = await waitForReadyMessage(child);
    expect(new URL(serverUrl).port).not.toBe("0");
    await expect(fetch(serverUrl).then((response) => response.text())).resolves.toBe("owned server");
  });
});

function waitForReadyMessage(child: ChildProcess): Promise<string> {
  return new Promise((resolvePromise, rejectPromise) => {
    const timeout = setTimeout(() => finish(rejectPromise, new Error("Timed out waiting for server IPC readiness.")), 10_000);
    const onError = (error: Error) => finish(rejectPromise, error);
    const onExit = (code: number | null) => finish(rejectPromise, new Error(`Server exited before readiness with code ${code}.`));
    const onMessage = (message: unknown) => {
      if (
        typeof message === "object"
        && message !== null
        && "type" in message
        && "url" in message
        && message.type === "playwright-static-server-ready"
        && typeof message.url === "string"
      ) {
        finish(resolvePromise, message.url);
      }
    };
    const finish = <T>(callback: (value: T) => void, value: T) => {
      clearTimeout(timeout);
      child.off("error", onError);
      child.off("exit", onExit);
      child.off("message", onMessage);
      callback(value);
    };

    child.once("error", onError);
    child.once("exit", onExit);
    child.on("message", onMessage);
  });
}

async function stopChild(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.killed) {
    return;
  }
  await new Promise<void>((resolvePromise) => {
    const timeout = setTimeout(resolvePromise, 2_000);
    child.once("exit", () => {
      clearTimeout(timeout);
      resolvePromise();
    });
    child.kill();
  });
}
