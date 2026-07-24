/**
 * Legacy unit-test runner (npm run test:legacy).
 *
 * Purpose: exercise pure Node .mjs still used outside the Vitest/TS tree, plus
 * lightweight source-wiring guards that are not duplicated under tests/unit.
 *
 * Do NOT re-add dual-track suites for shared modules that production already
 * consumes as TypeScript (mcp/*, chat/tokenUsage, models/toolRegistry,
 * automationPlaybooks, networkContext, security/redaction, browserControl).
 * Those are covered by Vitest against TypeScript sources under src/.
 *
 * Remaining suites:
 * - newtab ai-preview-service.mjs (live newtab runtime)
 * - scripts/model_diagnostics_sink.mjs (local diagnostics tooling)
 * - background/browserControl source-wiring smoke (string contracts)
 */
import { spawnSync } from "node:child_process";

const testCommands = [
  ["node", ["scripts/test_background_browser_queue_wiring.mjs"]],
  ["node", ["scripts/test_background_agent_tools_wiring.mjs"]],
  ["node", ["scripts/test_ai_preview_service.mjs"]],
  ["node", ["scripts/test_model_diagnostics_sink.mjs"]],
];

for (const [command, args] of testCommands) {
  const label = [command, ...args].join(" ");
  console.log(`\n> ${label}`);

  const result = spawnSync(command, args, {
    stdio: "inherit",
    shell: false,
  });

  if (result.error) {
    console.error(result.error.message);
    process.exit(1);
  }

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

console.log("\nunit tests passed");
