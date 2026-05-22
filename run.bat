@echo off
REM ============================================================
REM Apping God - Windows one-click launcher
REM Starts the Next.js dashboard and opens it in the browser.
REM (Backend Edge Functions run on Supabase cloud, not locally.)
REM
REM DO NOT add parens "(" inside if-blocks or em-dashes here -
REM cmd.exe will crash with "... was unexpected at this time."
REM ============================================================

setlocal

REM Always run from the script's own directory.
cd /d "%~dp0"

echo.
echo ============================================
echo   Apping God - starting local dashboard
echo ============================================
echo.
echo Working dir: %CD%
echo.

if not exist "frontend\package.json" goto :nopkg
if not exist "frontend\node_modules" goto :install
goto :launch

:nopkg
echo [ERROR] frontend\package.json not found in %CD%.
echo This script must live in the apping-god repo root.
pause
exit /b 1

:install
echo [INFO] Installing frontend dependencies. First run, takes about 2 minutes.
pushd frontend
call npm install
popd
goto :launch

:launch
echo [INFO] Starting Next.js dev server in a new window...
start "Apping God - Next.js" cmd /k "cd /d %CD%\frontend && npm run dev"

echo [INFO] Waiting 8 seconds for server to come up...
timeout /t 8 /nobreak >nul

echo [INFO] Opening dashboard in default browser...
start "" "http://localhost:3000"

echo.
echo ============================================
echo   Dashboard launched at http://localhost:3000
echo   Close the Next.js window to stop the server.
echo ============================================
echo.
endlocal
