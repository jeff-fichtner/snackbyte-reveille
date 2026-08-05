@echo off
REM Shim so reveille runs as a bare command from any shell and any directory.
REM %~dp0 is this file's own folder, so it locates reveille.ps1 beside it with no
REM hardcoded path. ExecutionPolicy Bypass lets it run regardless of local policy.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0reveille.ps1" %*
