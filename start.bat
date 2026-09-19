@echo off
setlocal
cd /d "%~dp0"

echo ============================================
echo  Bound - starting backend + frontend
echo ============================================

where python >nul 2>&1
if errorlevel 1 (
  echo [ERROR] Python was not found on PATH. Install Python 3.11+ and try again.
  pause
  exit /b 1
)

where npm >nul 2>&1
if errorlevel 1 (
  echo [ERROR] npm was not found on PATH. Install Node.js 18+ and try again.
  pause
  exit /b 1
)

python -c "import uvicorn, fastapi" >nul 2>&1
if errorlevel 1 (
  echo Installing backend dependencies...
  python -m pip install -r backend\requirements.txt
  if errorlevel 1 (
    echo [ERROR] Failed to install backend dependencies.
    pause
    exit /b 1
  )
)

if not exist "node_modules" (
  echo Installing frontend dependencies...
  call npm install
  if errorlevel 1 (
    echo [ERROR] Failed to install frontend dependencies.
    pause
    exit /b 1
  )
)

rem Local dev: allow the frontend on any local origin (Vite may hop ports
rem e.g. 3000 -^> 3001 when 3000 is busy). The backend disables
rem allow-credentials when "*" is used, which is fine for plain JSON fetch.
set CORS_ORIGINS=*

echo Starting backend on http://localhost:4000 ...
start "Bound Backend :4000" cmd /k "python -m uvicorn backend.main:app --host 0.0.0.0 --port 4000 --reload"

echo Starting frontend on http://localhost:3000 ...
start "Bound Frontend :3000" cmd /k "npm run dev"

echo.
echo Backend:  http://localhost:4000/health
echo Frontend: http://localhost:3000
echo Two new windows were opened, one per server. Close them to stop.
echo.
pause
