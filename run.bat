@echo off
REM Legacy alias - kept so old shortcuts still work.
REM The real launcher is start.bat (better error handling +
REM auto-kills stale dev servers on port 3939).
cd /d "%~dp0"
call start.bat
