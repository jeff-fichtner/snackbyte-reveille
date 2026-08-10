@echo off
REM Shim so `reveille` runs as a bare command from any shell and any directory.
REM %~dp0 is this file's own folder, so it locates the repo root beside it with no
REM hardcoded path — which is why this works from anywhere without walking parents.
REM
REM --env-file is how every process in this repo reads configuration, and it fails
REM loud on its own if orchestrator\.env is missing. The console reads TENANTS from
REM it; it never contacts the orchestrator, so every target command works while the
REM bot is stopped.
node --env-file="%~dp0..\orchestrator\.env" "%~dp0..\orchestrator\src\console\index.ts" %*
