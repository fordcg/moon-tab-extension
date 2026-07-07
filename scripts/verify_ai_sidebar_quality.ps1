$ErrorActionPreference = "Stop"

Write-Host "[1/12] typecheck: current source-owned sidebar/background/runtime"
npm run typecheck

Write-Host "[2/12] unit: legacy convergence suite"
npm run test:legacy

Write-Host "[3/12] syntax: shared modules"
node --check src\shared\network-redaction.mjs
node --check src\shared\agent-tool-registry.mjs
node --check src\shared\browser-control-contract.mjs
node --check src\shared\browser-control-queue.mjs
node --check examples\mcp-bridge\server.mjs

Write-Host "[4/12] unit: network redaction"
node scripts\test_network_redaction.mjs

Write-Host "[5/12] unit: tool registry"
node scripts\test_tool_registry.mjs

Write-Host "[6/12] unit: browser control queue"
node scripts\test_browser_control_queue.mjs

Write-Host "[7/12] unit: background browser queue wiring"
node scripts\test_background_browser_queue_wiring.mjs

Write-Host "[8/12] unit: background agent tools wiring"
node scripts\test_background_agent_tools_wiring.mjs

Write-Host "[9/12] smoke: AI sidebar core"
python scripts\verify_ai_sidebar_core.py

Write-Host "[10/12] smoke: browser control attach/detach"
python scripts\verify_browser_control_attach.py

Write-Host "[11/12] smoke: browser control tool loop"
python scripts\verify_browser_control_tool_loop.py

Write-Host "[12/12] smoke: MCP bridge tool loop"
python scripts\verify_mcp_bridge_tool_loop.py

Write-Host "AI sidebar quality checks passed."
