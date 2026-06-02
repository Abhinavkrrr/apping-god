@echo off
REM ============================================================
REM DingDing - one-click launcher
REM
REM Double-click this file to:
REM   1. Verify Node.js is installed
REM   2. Kill any stale dev server on port 3939
REM   3. Install dependencies if first run (~2 min once)
REM   4. Start the Next.js dev server in a separate window
REM   5. Wait for the server to come up
REM   6. Open the dashboard in your default browser
REM
REM Backend (Edge Functions, GitHub Actions cron) all run in the
REM cloud - nothing else needs to be started locally.
REM
REM HARD RULE for editing this file: no parens "(" inside
REM if-blocks, no em-dashes - cmd.exe will crash with
REM "... was unexpected at this time."
REM ============================================================

setlocal EnableDelayedExpansion
title DingDing launcher

REM Always run from the script's own directory so relative paths work
cd /d "%~dp0"

echo.
echo ============================================
echo   DingDing  -  starting local dashboard
echo ============================================
echo.
echo Working dir: %CD%
echo.

REM ---------- Step 1: Verify Node.js -------------------------------
where node >nul 2>&1
if errorlevel 1 goto :no_node

for /f "tokens=*" %%v in ('node --version 2^>nul') do set NODE_VERSION=%%v
echo [OK] Node.js !NODE_VERSION! found.
echo.

REM ---------- Step 2: Verify repo layout ---------------------------
if not exist "frontend\package.json" goto :no_pkg

REM ---------- Step 3: Kill any stale dev server on port 3939 -------
echo [INFO] Checking port 3939 for stale dev server...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr :3939 ^| findstr LISTENING') do (
    echo [INFO] Killing stale dev server PID %%a
    taskkill /F /PID %%a >nul 2>&1
)
echo.

REM ---------- Step 4: Install deps if missing ----------------------
if not exist "frontend\node_modules" goto :install
goto :launch

:install
echo [INFO] First run detected. Installing frontend dependencies...
echo [INFO] This takes about 2 minutes. Subsequent launches are fast.
echo.
pushd frontend
call npm install
if errorlevel 1 goto :install_failed
popd
echo.
echo [OK] Dependencies installed.
echo.
goto :launch

:install_failed
popd
echo.
echo [ERROR] npm install failed. Check the output above.
pause
exit /b 1

:launch
echo [INFO] Starting Next.js dev server in a new window...
start "DingDing - Next.js dev server" cmd /k "cd /d %CD%\frontend && npm run dev"

echo [INFO] Waiting 10 seconds for server to come up...
timeout /t 10 /nobreak >nul

echo [INFO] Opening dashboard in default browser...
start "" "http://localhost:3939"

echo.
echo ============================================
echo   DingDing is live at http://localhost:3939
echo ============================================
echo.
echo Next steps:
echo   - The dashboard is now running in the cloud-backed mode.
echo   - Close the "DingDing - Next.js dev server" window to stop it.
echo   - Sends, replies, bounces all run on GitHub Actions cron
echo     even when this window is closed.
echo.
echo This launcher window will auto-close in 30 seconds...
timeout /t 30 /nobreak >nul
endlocal
exit /b 0

REM ---------- Error branches ---------------------------------------

:no_node
echo.
echo [ERROR] Node.js is not installed or not on PATH.
echo.
echo Install Node.js 22 LTS from https://nodejs.org/  (the "LTS" button)
echo Then re-run this launcher.
echo.
pause
exit /b 1

:no_pkg
echo.
echo [ERROR] frontend\package.json not found in %CD%.
echo This launcher must live in the apping-god repo root.
echo Expected layout:
echo   %CD%\start.bat   ^<-- this file
echo   %CD%\frontend\
echo   %CD%\backend\
echo   %CD%\scripts\
echo.
pause
exit /b 1
