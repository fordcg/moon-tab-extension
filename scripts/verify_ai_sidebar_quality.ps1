$ErrorActionPreference = "Stop"

function Invoke-CheckedCommand {
  param(
    [Parameter(Mandatory = $true, Position = 0)]
    [string] $Executable,
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]] $CommandArguments
  )

  $resolvedCommand = Get-Command $Executable -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
  $commandPath = if ($null -ne $resolvedCommand) { $resolvedCommand.Source } else { $Executable }
  & $commandPath @CommandArguments
  $exitCode = $LASTEXITCODE
  if ($exitCode -ne 0) {
    exit $exitCode
  }
}

Write-Host "[1/14] typecheck: current source-owned sidebar/background/runtime"
Invoke-CheckedCommand npm run typecheck

Write-Host "[2/14] unit: legacy convergence suite"
Invoke-CheckedCommand npm run test:legacy

Write-Host "[3/14] syntax: shared modules"
Invoke-CheckedCommand node --check src\shared\network-redaction.mjs
Invoke-CheckedCommand node --check src\shared\agent-tool-registry.mjs
Invoke-CheckedCommand node --check src\shared\browser-control-contract.mjs
Invoke-CheckedCommand node --check src\shared\browser-control-queue.mjs
Invoke-CheckedCommand node --check examples\mcp-bridge\server.mjs

Write-Host "[4/14] unit: network redaction"
Invoke-CheckedCommand node scripts\test_network_redaction.mjs

Write-Host "[5/14] unit: tool registry"
Invoke-CheckedCommand node scripts\test_tool_registry.mjs

Write-Host "[6/14] unit: browser control queue"
Invoke-CheckedCommand node scripts\test_browser_control_queue.mjs

Write-Host "[7/14] unit: background browser queue wiring"
Invoke-CheckedCommand node scripts\test_background_browser_queue_wiring.mjs

Write-Host "[8/14] unit: background agent tools wiring"
Invoke-CheckedCommand node scripts\test_background_agent_tools_wiring.mjs

Write-Host "[9/14] build: extension bundle"
Invoke-CheckedCommand npm run build:extension

Write-Host "[10/14] smoke: AI sidebar core"
Invoke-CheckedCommand python scripts\verify_ai_sidebar_core.py

Write-Host "[11/14] smoke: browser control attach/detach"
Invoke-CheckedCommand python scripts\verify_browser_control_attach.py

Write-Host "[12/14] smoke: browser control tool loop"
Invoke-CheckedCommand python scripts\verify_browser_control_tool_loop.py

Write-Host "[13/14] smoke: MCP bridge tool loop"
Invoke-CheckedCommand python scripts\verify_mcp_bridge_tool_loop.py

Write-Host "[14/14] e2e: sidebar workflow tasks"
Invoke-CheckedCommand npm run test:e2e -- tests/e2e/workflow-tasks.spec.ts

Write-Host "AI sidebar quality checks passed."
