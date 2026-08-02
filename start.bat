@echo off
title Project Launcher

REM === Configuration ===
set PROJECT_DIR=C:\Users\vpacalanog\Documents\GitHub\facts-attendance
set NGROK_PORT=3000

REM === Start Next.js ===
start "Next.js" cmd /k "cd /d %PROJECT_DIR% && npm run dev"

REM === Give Next.js a moment to start ===
timeout /t 3 >nul

REM === Start ngrok ===
start "ngrok" cmd /k "ngrok http %NGROK_PORT%"

echo Both services have been launched.
pause