import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  RELEASE_REQUIRED_ARTIFACT_DIRECTORIES,
  RELEASE_REQUIRED_ARTIFACT_PATHS,
  collectReleaseReadinessIssues,
  verifyReleaseReadiness,
} from "./verify-release-readiness.mjs";

const tempRoots: string[] = [];

async function makeTempRoot(): Promise<string> {
  const root = join(tmpdir(), `moon-tab-release-readiness-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  await mkdir(root, { recursive: true });
  tempRoots.push(root);
  return root;
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function writeFileWithParents(root: string, relativePath: string, content = ""): Promise<void> {
  const absolutePath = join(root, relativePath);
  await mkdir(join(absolutePath, ".."), { recursive: true });
  await writeFile(absolutePath, content, "utf8");
}

async function createReadyRoot(): Promise<string> {
  const root = await makeTempRoot();
  const manifest = {
    manifest_version: 3,
    name: "月标签",
    version: "0.3.0",
    permissions: ["sidePanel", "storage", "contextMenus", "activeTab", "scripting", "alarms", "tabs", "debugger"],
    background: { service_worker: "background/index.js", type: "module" },
    side_panel: { default_path: "index.html" },
    devtools_page: "src/devtools/network.html",
    chrome_url_overrides: { newtab: "src/pages/newtab/index.html" },
    content_scripts: [{ matches: ["<all_urls>"], js: ["content/index.js"], run_at: "document_idle" }],
    web_accessible_resources: [{
      resources: ["index.html", "assets/*"],
      matches: ["<all_urls>"],
    }],
  };

  await writeJson(join(root, "package.json"), {
    name: "moon-tab-extension",
    version: "0.3.0",
    scripts: {
      check: "npm run typecheck && npm run build:extension && npm run test && npm run test:legacy && npm run check:package",
      "test:e2e": "playwright test",
      "verify:release": "npm run check && npm run test:e2e && node scripts/verify-release-readiness.mjs",
    },
  });
  await writeJson(join(root, "dist", "manifest.json"), manifest);
  await writeJson(join(root, "artifacts", "chrome-extension", "manifest.json"), manifest);
  await writeJson(join(root, "artifacts", "chrome-extension", "build-info.json"), {
    name: "moon-tab-extension",
    version: "0.3.0",
    builtAt: "2026-07-07T00:00:00.000Z",
  });

  for (const relativePath of RELEASE_REQUIRED_ARTIFACT_PATHS) {
    if (relativePath.endsWith(".json")) continue;
    await writeFileWithParents(join(root, "artifacts", "chrome-extension"), relativePath, "release artifact");
  }
  for (const relativePath of RELEASE_REQUIRED_ARTIFACT_DIRECTORIES) {
    await mkdir(join(root, "artifacts", "chrome-extension", relativePath), { recursive: true });
  }

  return root;
}

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("release readiness verifier", () => {
  it("accepts a built and packaged release candidate with the current MV3 permission boundary", async () => {
    const root = await createReadyRoot();

    await expect(collectReleaseReadinessIssues(root)).resolves.toEqual([]);
    await expect(verifyReleaseReadiness(root)).resolves.toBeUndefined();
  });

  it("reports missing packaged artifacts and missing debugger permission", async () => {
    const root = await createReadyRoot();
    const manifestPath = join(root, "artifacts", "chrome-extension", "manifest.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    manifest.permissions = manifest.permissions.filter((permission: string) => permission !== "debugger");
    await writeJson(manifestPath, manifest);
    await rm(join(root, "artifacts", "chrome-extension", "src", "devtools", "network.html"), { force: true });

    const issues = await collectReleaseReadinessIssues(root);

    expect(issues).toContain("artifacts/chrome-extension/manifest.json must request debugger permission for the full browser automation release boundary.");
    expect(issues).toContain("Missing packaged artifact: artifacts/chrome-extension/src/devtools/network.html");
    await expect(verifyReleaseReadiness(root)).rejects.toThrow("Release readiness verification failed");
  });

  it("reports missing debugger permission in built and packaged manifests", async () => {
    const root = await createReadyRoot();
    for (const manifestPath of [
      join(root, "dist", "manifest.json"),
      join(root, "artifacts", "chrome-extension", "manifest.json"),
    ]) {
      const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
      manifest.permissions = manifest.permissions.filter((permission: string) => permission !== "debugger");
      await writeJson(manifestPath, manifest);
    }

    const issues = await collectReleaseReadinessIssues(root);

    expect(issues).toContain("dist/manifest.json must request debugger permission for the full browser automation release boundary.");
    expect(issues).toContain("artifacts/chrome-extension/manifest.json must request debugger permission for the full browser automation release boundary.");
  });

  it("requires the release verification command to run check, E2E, and artifact verification", async () => {
    const root = await createReadyRoot();
    await writeJson(join(root, "package.json"), {
      name: "moon-tab-extension",
      version: "0.3.0",
      scripts: {
        check: "npm run typecheck && npm run build:extension",
        "test:e2e": "playwright test",
        "verify:release": "npm run check && node scripts/verify-release-readiness.mjs",
      },
    });

    await expect(collectReleaseReadinessIssues(root)).resolves.toContain(
      'package.json scripts.verify:release must equal "npm run check && npm run test:e2e && node scripts/verify-release-readiness.mjs".',
    );
  });

  it("rejects release verification commands that contain the required commands in the wrong order", async () => {
    const root = await createReadyRoot();
    await writeJson(join(root, "package.json"), {
      name: "moon-tab-extension",
      version: "0.3.0",
      scripts: {
        check: "npm run typecheck && npm run build:extension",
        "test:e2e": "playwright test",
        "verify:release": "npm run test:e2e && npm run check && node scripts/verify-release-readiness.mjs",
      },
    });

    await expect(collectReleaseReadinessIssues(root)).resolves.toContain(
      'package.json scripts.verify:release must equal "npm run check && npm run test:e2e && node scripts/verify-release-readiness.mjs".',
    );
  });

  it("requires packaged artifacts to be regular files", async () => {
    const root = await createReadyRoot();
    const artifactPath = join(root, "artifacts", "chrome-extension", "content", "index.js");
    await rm(artifactPath, { force: true });
    await mkdir(artifactPath, { recursive: true });

    await expect(collectReleaseReadinessIssues(root)).resolves.toContain(
      "Packaged artifact must be a file: artifacts/chrome-extension/content/index.js",
    );
  });

  it("requires every packaged A Dark Room runtime directory", async () => {
    const root = await createReadyRoot();
    const runtimeDirectory = join(root, "artifacts", "chrome-extension", "src", "pages", "game", "lang");
    await rm(runtimeDirectory, { recursive: true, force: true });
    await writeFileWithParents(join(root, "artifacts", "chrome-extension"), "src/pages/game/lang", "not a directory");

    await expect(collectReleaseReadinessIssues(root)).resolves.toContain(
      "Packaged artifact must be a directory: artifacts/chrome-extension/src/pages/game/lang",
    );
  });

  it("rejects exposing extension-only A Dark Room files to arbitrary websites", async () => {
    const root = await createReadyRoot();
    const manifestPath = join(root, "artifacts", "chrome-extension", "manifest.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    manifest.web_accessible_resources[0].resources.push("src/pages/game/audio/*");
    await writeJson(manifestPath, manifest);

    await expect(collectReleaseReadinessIssues(root)).resolves.toContain(
      "artifacts/chrome-extension/manifest.json must not expose extension-only A Dark Room resource src/pages/game/audio/*.",
    );
  });

  it("reports debugger permission in optional permissions", async () => {
    const root = await createReadyRoot();
    const manifestPath = join(root, "artifacts", "chrome-extension", "manifest.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    manifest.optional_permissions = ["debugger"];
    await writeJson(manifestPath, manifest);

    await expect(collectReleaseReadinessIssues(root)).resolves.toContain(
      "artifacts/chrome-extension/manifest.json must not put debugger in optional_permissions; this release uses an explicit debugger permission boundary.",
    );
  });
});
