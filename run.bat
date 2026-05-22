@echo off
REM ============================================================
REM Apping God — Windows one-click launcher
REM Starts the Next.js dashboard and opens it in the browser.
REM (Backend Edge Functions run on Supabase cloud, not locally.)
REM ============================================================

setlocal

echo.
echo ============================================
echo   Apping God — starting local dashboard
echo ============================================
echo.

REM Sanity check
if not exist "frontend\package.json" (
  echo [ERROR] Run this from the apping-god repo root.
  echo Current dir: %CD%
  pause
  exit /b 1
)

if not exist "frontend\node_modules" (
  echo [INFO] Installing frontend dependencies (first run, ~2 min)...
  pushd frontend
  call npm install
  popd
)

echo [INFO] Starting Next.js dev server in a new window...
start "Apping God — Next.js" cmd /k "cd /d %CD%\frontend && npm run dev"

echo [INFO] Waiting for server to come up...
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
