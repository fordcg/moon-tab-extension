$ErrorActionPreference = "Stop"

$ProjectRoot = Split-Path -Parent $PSScriptRoot
$BridgeScript = Join-Path $ProjectRoot "scripts\run_grok_search_mcp_bridge.mjs"
$LogDir = Join-Path $ProjectRoot ".tmp"
$LogPath = Join-Path $LogDir "grok-search-mcp-bridge.log"
$StdoutLogPath = Join-Path $LogDir "grok-search-mcp-bridge.out.log"
$StderrLogPath = Join-Path $LogDir "grok-search-mcp-bridge.err.log"
$HealthUrl = "http://127.0.0.1:17333/health"
$ConfigDir = Join-Path $env:LOCALAPPDATA "MoonTab"
$ConfigPath = Join-Path $ConfigDir "grok-search-mcp-bridge.config.json"

New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
New-Item -ItemType Directory -Force -Path $ConfigDir | Out-Null

function Test-BridgeHealth {
  try {
    $health = Invoke-RestMethod -Uri $HealthUrl -Method Get -TimeoutSec 2
    return $health.ok -eq $true
  } catch {
    return $false
  }
}

if (Test-BridgeHealth) {
  "$(Get-Date -Format o) Grok Search MCP Bridge already running at $HealthUrl" | Out-File -FilePath $LogPath -Append -Encoding utf8
  Write-Host "Grok Search MCP Bridge is already running: $HealthUrl"
  exit 0
}

$node = (Get-Command node -ErrorAction Stop).Source
$env:GROK_SEARCH_MCP_BRIDGE_CONFIG_FILE = $ConfigPath

"$(Get-Date -Format o) Starting Grok Search MCP Bridge from $ProjectRoot" | Out-File -FilePath $LogPath -Append -Encoding utf8
"$(Get-Date -Format o) Node: $node" | Out-File -FilePath $LogPath -Append -Encoding utf8
"$(Get-Date -Format o) Config: $ConfigPath" | Out-File -FilePath $LogPath -Append -Encoding utf8

$process = Start-Process `
  -FilePath $node `
  -ArgumentList @($BridgeScript) `
  -WorkingDirectory $ProjectRoot `
  -WindowStyle Hidden `
  -RedirectStandardOutput $StdoutLogPath `
  -RedirectStandardError $StderrLogPath `
  -PassThru

"$(Get-Date -Format o) Started Grok Search MCP Bridge PID=$($process.Id)" | Out-File -FilePath $LogPath -Append -Encoding utf8
Write-Host "Grok Search MCP Bridge started in background, PID=$($process.Id)"
Write-Host "Health: $HealthUrl"
Write-Host "Log: $LogPath"
