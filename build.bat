@echo off
setlocal enabledelayedexpansion

set PROJECT_ROOT=%~dp0
set FRONTEND_DIR=%PROJECT_ROOT%apps\frontend
set BACKEND_DIR=%PROJECT_ROOT%apps\backend
set LOG_FILE=%PROJECT_ROOT%log.txt

echo ======================================== > "%LOG_FILE%"
echo   DevSpace Autoplayer - Build Script >> "%LOG_FILE%"
echo ======================================== >> "%LOG_FILE%"
echo. >> "%LOG_FILE%"

echo ========================================
echo   DevSpace Autoplayer - Build Script
echo ========================================
echo.

echo [1/5] Checking environment...
echo [1/5] Checking environment... >> "%LOG_FILE%"
where python >nul 2>&1
if %errorlevel% neq 0 (
    echo ERROR: Python not found
    echo ERROR: Python not found >> "%LOG_FILE%"
    pause
    exit /b 1
)

where node >nul 2>&1
if %errorlevel% neq 0 (
    echo ERROR: Node.js not found
    echo ERROR: Node.js not found >> "%LOG_FILE%"
    pause
    exit /b 1
)

echo [2/5] Installing Python dependencies...
echo [2/5] Installing Python dependencies... >> "%LOG_FILE%"
cd /d "%BACKEND_DIR%"
python -m pip install pyinstaller -q >> "%LOG_FILE%" 2>&1
python -m pip install -e . -q >> "%LOG_FILE%" 2>&1

echo [3/5] Building Python backend...
echo [3/5] Building Python backend... >> "%LOG_FILE%"
if exist "dist" rmdir /s /q "dist" >> "%LOG_FILE%" 2>&1
if exist "build" rmdir /s /q "build" >> "%LOG_FILE%" 2>&1
python -m PyInstaller backend.spec --noconfirm --clean >> "%LOG_FILE%" 2>&1
if %errorlevel% neq 0 (
    echo ERROR: Backend build failed
    echo ERROR: Backend build failed >> "%LOG_FILE%"
    pause
    exit /b 1
)
echo Backend build complete!
echo Backend build complete! >> "%LOG_FILE%"

echo [4/5] Installing frontend dependencies...
echo [4/5] Installing frontend dependencies... >> "%LOG_FILE%"
cd /d "%FRONTEND_DIR%"

REM Clean release directory completely
echo Cleaning release directory...
if exist "release" (
    taskkill /f /im "meowfield-autoplayer-lite-backend.exe" >nul 2>&1
    taskkill /f /im "devspace-autoplayer-backend.exe" >nul 2>&1
    timeout /t 2 /nobreak >nul
    rmdir /s /q "release" >> "%LOG_FILE%" 2>&1
)

call npm install >> "%LOG_FILE%" 2>&1
if %errorlevel% neq 0 (
    echo ERROR: Frontend dependencies install failed
    echo ERROR: Frontend dependencies install failed >> "%LOG_FILE%"
    pause
    exit /b 1
)

echo [5/5] Building Electron app...
echo [5/5] Building Electron app... >> "%LOG_FILE%"
call npm run build:win >> "%LOG_FILE%" 2>&1
if %errorlevel% neq 0 (
    echo ERROR: Electron build failed
    echo ERROR: Electron build failed >> "%LOG_FILE%"
    pause
    exit /b 1
)

echo.
echo ========================================
echo   Build Complete!
echo ========================================
echo.
echo Output: %FRONTEND_DIR%\release
echo Log saved to: %LOG_FILE%
echo.
dir /b "%FRONTEND_DIR%\release\*.exe" 2>nul
echo.
echo ======================================== >> "%LOG_FILE%"
echo   Build Complete! >> "%LOG_FILE%"
echo ======================================== >> "%LOG_FILE%"
pause
