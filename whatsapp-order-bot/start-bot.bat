@echo off
cd /d "%~dp0"
:loop
node src\index.js
echo Bot stopped. Restarting in 10 seconds... (close this window to stop)
timeout /t 10 >nul
goto loop
