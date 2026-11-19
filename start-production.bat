@echo off
title AbeerSuite - Next.js Production Server (Port 3000)
cd /d "%~dp0"

echo ========================================================
echo Starting AbeerSuite Production Server on Port 3000...
echo Project Folder: %CD%
echo ========================================================
echo.

if not exist ".next" (
    echo [ERROR] No production build found in .next folder!
    echo Please run 'pnpm build' first before starting in production mode.
    echo.
    pause
    exit /b 1
)

set NODE_OPTIONS=--max-http-header-size=65536
call pnpm start -p 3000

if %ERRORLEVEL% NEQ 0 (
    echo.
    echo Server exited with error code %ERRORLEVEL%.
)

pause
