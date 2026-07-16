# One-time install: register moon-tab-log-sink:// protocol so the extension can
# auto-ensure the local log sink when "工作区请求日志" is enabled.
# Usage (from project root, PowerShell):
#   powershell -ExecutionPolicy Bypass -File scripts/install_log_sink_protocol.ps1

$ErrorActionPreference = "Stop"
$ProjectRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$CmdPath = Join-Path $ProjectRoot "scripts\start_model_diagnostics_sink.cmd"
if (-not (Test-Path $CmdPath)) {
  throw "Missing launcher: $CmdPath"
}

$Protocol = "moon-tab-log-sink"
$Command = "`"$CmdPath`" `"%1`""
$BaseKey = "HKCU:\Software\Classes\$Protocol"
New-Item -Path $BaseKey -Force | Out-Null
Set-ItemProperty -Path $BaseKey -Name "(default)" -Value "URL:Moon Tab Log Sink"
Set-ItemProperty -Path $BaseKey -Name "URL Protocol" -Value ""
New-Item -Path "$BaseKey\shell\open\command" -Force | Out-Null
Set-ItemProperty -Path "$BaseKey\shell\open\command" -Name "(default)" -Value $Command

Write-Host "Registered protocol: ${Protocol}://"
Write-Host "Launcher: $CmdPath"
Write-Host "When the extension enables workspace request logs, it will open ${Protocol}://ensure if the sink is down."
