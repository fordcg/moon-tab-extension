import { spawnSync } from "node:child_process";

const testCommands = [
  ["node", ["scripts/test_network_redaction.mjs"]],
  ["node", ["scripts/test_tool_registry.mjs"]],
  ["node", ["scripts/test_browser_control_queue.mjs"]],
  ["node", ["scripts/test_background_browser_queue_wiring.mjs"]],
  ["node", ["scripts/test_background_agent_tools_wiring.mjs"]],
  ["node", ["scripts/test_ai_preview_service.mjs"]],
  ["node", ["scripts/test_model_diagnostics_sink.mjs"]],
  ["node", ["--test", "src/pages/game/workers.test.mjs", "src/pages/game/sprite-runtime.test.mjs"]],
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
