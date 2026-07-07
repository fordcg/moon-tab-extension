// @ts-check
import { access, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const defaultRootDir = path.resolve(__dirname, "..");

export const RELEASE_REQUIRED_ARTIFACT_PATHS = [
  "manifest.json",
  "build-info.json",
  "index.html",
  "src/devtools/network.html",
  "src/pages/newtab/index.html",
  "src/pages/game/index.html",
  "src/pages/game/vendor/matter.min.js",
  "background/index.js",
  "content/index.js",
];

const forbiddenArtifactPatterns = [
  /(?:^|\/)tests?(?:\/|$)/,
  /(?:^|\/)__tests__(?:\/|$)/,
  /\.(?:test|spec)\.[cm]?[jt]sx?$/,
  /(?:^|\/)src\/ai-assistant(?:\/|$)/,
  /(?:^|\/)src\/background\/service-worker\.js$/,
  /(?:^|\/)content\/index\.ts$/,
];

async function readJsonFile(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

async function fileExists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function listFiles(directory, baseDirectory = directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...await listFiles(entryPath, baseDirectory));
      continue;
    }
    files.push(path.relative(baseDirectory, entryPath).split(path.sep).join("/"));
  }
  return files;
}

function collectScriptIssues(packageJson) {
  const issues = [];
  const scripts = packageJson.scripts ?? {};
  const verifyRelease = scripts["verify:release"];
  if (!verifyRelease) {
    return ["package.json must define scripts.verify:release."];
  }
  if (!verifyRelease.includes("npm run check")) {
    issues.push("package.json scripts.verify:release must run npm run check.");
  }
  if (!verifyRelease.includes("npm run test:e2e")) {
    issues.push("package.json scripts.verify:release must run npm run test:e2e.");
  }
  if (!verifyRelease.includes("node scripts/verify-release-readiness.mjs")) {
    issues.push("package.json scripts.verify:release must run node scripts/verify-release-readiness.mjs.");
  }
  return issues;
}

function collectManifestIssues(manifest, label) {
  const issues = [];
  const permissions = Array.isArray(manifest.permissions) ? manifest.permissions : [];
  if (permissions.includes("debugger")) {
    issues.push(`${label} must not request debugger permission in the current release boundary.`);
  }
  if (manifest.background?.service_worker !== "background/index.js") {
    issues.push(`${label} must use background/index.js as the MV3 service worker.`);
  }
  if (manifest.side_panel?.default_path !== "index.html") {
    issues.push(`${label} must use index.html as the side panel entry.`);
  }
  if (manifest.devtools_page !== "src/devtools/network.html") {
    issues.push(`${label} must declare src/devtools/network.html as the DevTools page.`);
  }
  if (manifest.chrome_url_overrides?.newtab !== "src/pages/newtab/index.html") {
    issues.push(`${label} must declare src/pages/newtab/index.html as the newtab override.`);
  }
  const contentScripts = Array.isArray(manifest.content_scripts) ? manifest.content_scripts : [];
  if (!contentScripts.some((entry) => Array.isArray(entry.js) && entry.js.includes("content/index.js"))) {
    issues.push(`${label} must include content/index.js as a content script.`);
  }
  return issues;
}

export async function collectReleaseReadinessIssues(rootDir = defaultRootDir) {
  const issues = [];
  const packageRoot = path.join(rootDir, "artifacts", "chrome-extension");
  const packageJsonPath = path.join(rootDir, "package.json");
  const distManifestPath = path.join(rootDir, "dist", "manifest.json");
  const artifactManifestPath = path.join(packageRoot, "manifest.json");

  if (!await fileExists(packageJsonPath)) {
    issues.push("Missing package.json.");
  } else {
    issues.push(...collectScriptIssues(await readJsonFile(packageJsonPath)));
  }

  if (!await fileExists(distManifestPath)) {
    issues.push("Missing dist/manifest.json. Run npm run build:extension before release verification.");
  } else {
    issues.push(...collectManifestIssues(await readJsonFile(distManifestPath), "dist/manifest.json"));
  }

  if (!await fileExists(artifactManifestPath)) {
    issues.push("Missing artifacts/chrome-extension/manifest.json. Run npm run package:extension before release verification.");
  } else {
    issues.push(...collectManifestIssues(await readJsonFile(artifactManifestPath), "artifacts/chrome-extension/manifest.json"));
  }

  for (const relativePath of RELEASE_REQUIRED_ARTIFACT_PATHS) {
    if (!await fileExists(path.join(packageRoot, relativePath))) {
      issues.push(`Missing packaged artifact: artifacts/chrome-extension/${relativePath}`);
    }
  }

  if (await fileExists(packageRoot)) {
    const packagedFiles = await listFiles(packageRoot);
    for (const file of packagedFiles) {
      if (forbiddenArtifactPatterns.some((pattern) => pattern.test(file))) {
        issues.push(`Forbidden packaged artifact: artifacts/chrome-extension/${file}`);
      }
    }
  }

  return issues;
}

export async function verifyReleaseReadiness(rootDir = defaultRootDir) {
  const issues = await collectReleaseReadinessIssues(rootDir);
  if (issues.length > 0) {
    throw new Error(["Release readiness verification failed:", ...issues.map((issue) => `- ${issue}`)].join("\n"));
  }
}

if (process.argv[1] === __filename) {
  verifyReleaseReadiness().then(() => {
    console.log("Release readiness verification passed.");
  }).catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
