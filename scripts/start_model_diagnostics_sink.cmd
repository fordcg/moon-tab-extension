@echo off
setlocal
cd /d "%~dp0\.."
node "scripts\ensure_model_diagnostics_sink.mjs"
exit /b %ERRORLEVEL%
