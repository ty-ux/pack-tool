@echo off
setlocal
title Build Frontend

echo ============================================
echo   Build Frontend (npm ci + npm run build)
echo   Output: web\dist (served by backend)
echo ============================================
echo.

cd /d "%~dp0web"

where node >nul 2>nul
if errorlevel 1 (
    echo [ERROR] Node.js not found. Please install a supported Node.js LTS release first.
    pause
    exit /b 1
)

echo [1/2] Installing dependencies...
call npm ci
if errorlevel 1 (
    echo [ERROR] npm ci failed. Check your network.
    pause
    exit /b 1
)

echo [2/2] Building...
call npm run build
if errorlevel 1 (
    echo [ERROR] Build failed.
    pause
    exit /b 1
)

echo.
echo Build complete: web\dist
pause
