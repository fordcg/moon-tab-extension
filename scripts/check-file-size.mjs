// @ts-check
/**
 * Soft file-size guard for known hotspots.
 * Exit 0 with warnings when over soft limit; exit 1 when over hard limit.
 */
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** @typedef {{ file: string, soft: number, hard: number }} FileBudget */

/** @type {FileBudget[]} */
const budgets = [
  // soft = target after modularization; hard = fail gate for regressions on current main.
  { file: "src/background/browserControlMessageHandler.ts", soft: 1200, hard: 4500 },
  { file: "src/side-panel/state/appStore.ts", soft: 2000, hard: 4000 },
  { file: "src/side-panel/styles.css", soft: 3000, hard: 10000 },
  { file: "src/shared/toolArtifacts.ts", soft: 1200, hard: 2500 },
  { file: "src/side-panel/components/ChatComposer.tsx", soft: 1200, hard: 2500 },
  { file: "src/side-panel/components/MessageList.tsx", soft: 1200, hard: 2500 },
  { file: "src/background/browserControl/actions.ts", soft: 1000, hard: 2000 },
];

/**
 * @param {string} content
 * @returns {number}
 */
function countLines(content) {
  if (!content) return 0;
  const normalized = content.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  if (normalized.length === 0) return 0;
  const parts = normalized.split("\n");
  return parts[parts.length - 1] === "" ? parts.length - 1 : parts.length;
}

let warnings = 0;
let failures = 0;

for (const budget of budgets) {
  const abs = path.join(rootDir, budget.file);
  if (!existsSync(abs)) {
    console.log(`skip missing ${budget.file}`);
    continue;
  }
  const lines = countLines(readFileSync(abs, "utf8"));
  const status =
    lines > budget.hard ? "HARD" : lines > budget.soft ? "SOFT" : "ok";
  console.log(`${status.padEnd(4)} ${String(lines).padStart(5)} / soft ${budget.soft} hard ${budget.hard}  ${budget.file}`);
  if (status === "SOFT") warnings += 1;
  if (status === "HARD") failures += 1;
}

if (failures > 0) {
  console.error(`\ncheck-file-size: ${failures} file(s) over hard limit`);
  process.exit(1);
}

if (warnings > 0) {
  console.log(`\ncheck-file-size: ${warnings} file(s) over soft limit (warning only)`);
} else {
  console.log("\ncheck-file-size: all budgets within soft limits");
}
