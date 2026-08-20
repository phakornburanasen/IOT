@echo off
cd /d "%~dp0"

set LOG_DIR=%~dp0logs
set PID_FILE=%LOG_DIR%\server.pid

if not exist "%PID_FILE%" goto NO_PID_FILE

set /p OLD_PID=<"%PID_FILE%"
echo Stopping GO backend PID %OLD_PID%...
taskkill /F /PID %OLD_PID%
del /f /q "%PID_FILE%"
echo GO backend stopped.
pause
exit /b 0

:NO_PID_FILE
echo No PID file found. Checking port 5108...
for /f "tokens=5" %%I in ('netstat -ano ^| findstr /R /C:":5108 .*LISTENING"') do (
    echo Killing process on port 5108: PID %%I
    taskkill /F /PID %%I
    echo GO backend stopped.
    pause
    exit /b 0
)
echo No process found on port 5108. Backend is not running.
pause
exit /b 0
