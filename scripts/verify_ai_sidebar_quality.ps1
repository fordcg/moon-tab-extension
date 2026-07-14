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

Write-Host "[1/16] typecheck: current source-owned sidebar/background/runtime"
Invoke-CheckedCommand npm run typecheck

Write-Host "[2/16] unit: full Vitest suite"
Invoke-CheckedCommand npm test

Write-Host "[3/16] unit: legacy convergence suite"
Invoke-CheckedCommand npm run test:legacy

Write-Host "[4/16] syntax: shared modules"
Invoke-CheckedCommand node --check src\shared\network-redaction.mjs
Invoke-CheckedCommand node --check src\shared\agent-tool-registry.mjs
Invoke-CheckedCommand node --check src\shared\browser-control-contract.mjs
Invoke-CheckedCommand node --check src\shared\browser-control-queue.mjs
Invoke-CheckedCommand node --check examples\mcp-bridge\server.mjs

Write-Host "[5/16] unit: network redaction"
Invoke-CheckedCommand node scripts\test_network_redaction.mjs

Write-Host "[6/16] unit: tool registry"
Invoke-CheckedCommand node scripts\test_tool_registry.mjs

Write-Host "[7/16] unit: browser control queue"
Invoke-CheckedCommand node scripts\test_browser_control_queue.mjs

Write-Host "[8/16] unit: background browser queue wiring"
Invoke-CheckedCommand node scripts\test_background_browser_queue_wiring.mjs

Write-Host "[9/16] unit: background agent tools wiring"
Invoke-CheckedCommand node scripts\test_background_agent_tools_wiring.mjs

Write-Host "[10/16] build: extension bundle"
Invoke-CheckedCommand npm run build:extension

Write-Host "[11/16] package: extension release artifact"
Invoke-CheckedCommand npm run check:package

Write-Host "[12/16] smoke: AI sidebar core"
Invoke-CheckedCommand python scripts\verify_ai_sidebar_core.py

Write-Host "[13/16] smoke: browser control attach/detach"
Invoke-CheckedCommand python scripts\verify_browser_control_attach.py

Write-Host "[14/16] smoke: browser control tool loop"
Invoke-CheckedCommand python scripts\verify_browser_control_tool_loop.py

Write-Host "[15/16] smoke: MCP bridge tool loop"
Invoke-CheckedCommand python scripts\verify_mcp_bridge_tool_loop.py

Write-Host "[16/16] e2e: all web preview and Chrome extension flows"
Invoke-CheckedCommand npm run test:e2e

Write-Host "AI sidebar quality checks passed."
