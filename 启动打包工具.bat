@echo off
setlocal
title App Pack Console

echo ============================================
echo   App Pack Console - Launcher
echo ============================================
echo.

REM --- Python check ---
where python >nul 2>nul
if errorlevel 1 (
    echo [ERROR] Python not found. Please install Python 3.10+ first.
    pause
    exit /b 1
)

REM --- Dependency check (auto install on first run) ---
python -c "from importlib.metadata import version; import fastapi, uvicorn; version('python-multipart')" >nul 2>nul
if errorlevel 1 (
    echo [INFO] First run: installing backend dependencies ^(fastapi, uvicorn^)...
    python -m pip install -r "%~dp0requirements.txt"
    if errorlevel 1 (
        echo [ERROR] Dependency install failed. Check your network and retry.
        pause
        exit /b 1
    )
)

REM --- Port 8765 check (only counts LISTENING sockets; TIME_WAIT leftovers would otherwise fake "already running") ---
netstat -ano | findstr ":8765" | findstr "LISTENING" >nul 2>nul
if not errorlevel 1 (
    echo Service may already be running. Opening browser...
    start http://127.0.0.1:8765/
    pause
    exit /b 0
)

echo Starting service, browser will open at http://127.0.0.1:8765/
echo Press Ctrl+C to stop.
echo.

pushd "%~dp0"
python -m server
popd

pause
