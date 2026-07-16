// @ts-check
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const defaultRootDir = path.resolve(__dirname, "..");
const REQUIRED_RELEASE_SCRIPT = "npm run check && npm run test:e2e && node scripts/verify-release-readiness.mjs";

export const RELEASE_REQUIRED_ARTIFACT_PATHS = [
  "manifest.json",
  "build-info.json",
  "index.html",
  "src/devtools/network.html",
  "src/pages/newtab/index.html",
  "src/pages/game/index.html",
  "src/pages/game/bootstrap.js",
  "src/pages/game/favicon.ico",
  "src/pages/game/LICENSE.md",
  "src/pages/game/UPSTREAM.md",
  "background/index.js",
  "content/index.js",
];

export const RELEASE_REQUIRED_ARTIFACT_DIRECTORIES = [
  "src/pages/game/script",
  "src/pages/game/lib",
  "src/pages/game/css",
  "src/pages/game/lang",
  "src/pages/game/audio",
  "src/pages/game/img",
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

async function getPathStats(filePath) {
  try {
    return await stat(filePath);
  } catch {
    return undefined;
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
  const scripts = packageJson.scripts ?? {};
  const verifyRelease = scripts["verify:release"];
  if (!verifyRelease) {
    return ["package.json must define scripts.verify:release."];
  }
  if (verifyRelease !== REQUIRED_RELEASE_SCRIPT) {
    return [`package.json scripts.verify:release must equal "${REQUIRED_RELEASE_SCRIPT}".`];
  }
  return [];
}

function collectManifestIssues(manifest, label) {
  const issues = [];
  const permissions = Array.isArray(manifest.permissions) ? manifest.permissions : [];
  const optionalPermissions = Array.isArray(manifest.optional_permissions) ? manifest.optional_permissions : [];
  if (!permissions.includes("debugger")) {
    issues.push(`${label} must request debugger permission for the full browser automation release boundary.`);
  }
  if (optionalPermissions.includes("debugger")) {
    issues.push(`${label} must not put debugger in optional_permissions; this release uses an explicit debugger permission boundary.`);
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
  const webAccessibleResources = Array.isArray(manifest.web_accessible_resources) ? manifest.web_accessible_resources : [];
  const exposedResources = webAccessibleResources.flatMap((entry) => Array.isArray(entry?.resources) ? entry.resources : []);
  for (const exposedResource of exposedResources) {
    if (typeof exposedResource === "string" && exposedResource.startsWith("src/pages/game/")) {
      issues.push(`${label} must not expose extension-only A Dark Room resource ${exposedResource}.`);
    }
  }
  return issues;
}

export async function collectReleaseReadinessIssues(rootDir = defaultRootDir) {
  const issues = [];
  const packageRoot = path.join(rootDir, "artifacts", "chrome-extension");
  const packageJsonPath = path.join(rootDir, "package.json");
  const distManifestPath = path.join(rootDir, "dist", "manifest.json");
  const artifactManifestPath = path.join(packageRoot, "manifest.json");
  const packageJsonStats = await getPathStats(packageJsonPath);
  const distManifestStats = await getPathStats(distManifestPath);
  const artifactManifestStats = await getPathStats(artifactManifestPath);

  if (!packageJsonStats) {
    issues.push("Missing package.json.");
  } else if (!packageJsonStats.isFile()) {
    issues.push("package.json must be a file.");
  } else {
    issues.push(...collectScriptIssues(await readJsonFile(packageJsonPath)));
  }

  if (!distManifestStats) {
    issues.push("Missing dist/manifest.json. Run npm run build:extension before release verification.");
  } else if (!distManifestStats.isFile()) {
    issues.push("dist/manifest.json must be a file.");
  } else {
    issues.push(...collectManifestIssues(await readJsonFile(distManifestPath), "dist/manifest.json"));
  }

  if (!artifactManifestStats) {
    issues.push("Missing artifacts/chrome-extension/manifest.json. Run npm run package:extension before release verification.");
  } else if (!artifactManifestStats.isFile()) {
    issues.push("artifacts/chrome-extension/manifest.json must be a file.");
  } else {
    issues.push(...collectManifestIssues(await readJsonFile(artifactManifestPath), "artifacts/chrome-extension/manifest.json"));
  }

  for (const relativePath of RELEASE_REQUIRED_ARTIFACT_PATHS) {
    const artifactStats = await getPathStats(path.join(packageRoot, relativePath));
    if (!artifactStats) {
      issues.push(`Missing packaged artifact: artifacts/chrome-extension/${relativePath}`);
    } else if (!artifactStats.isFile()) {
      issues.push(`Packaged artifact must be a file: artifacts/chrome-extension/${relativePath}`);
    }
  }

  for (const relativePath of RELEASE_REQUIRED_ARTIFACT_DIRECTORIES) {
    const artifactStats = await getPathStats(path.join(packageRoot, relativePath));
    if (!artifactStats) {
      issues.push(`Missing packaged artifact directory: artifacts/chrome-extension/${relativePath}`);
    } else if (!artifactStats.isDirectory()) {
      issues.push(`Packaged artifact must be a directory: artifacts/chrome-extension/${relativePath}`);
    }
  }

  const packageRootStats = await getPathStats(packageRoot);
  if (packageRootStats?.isDirectory()) {
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
