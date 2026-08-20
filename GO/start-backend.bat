@echo off
cd /d "%~dp0"

set EXE=%~dp0bin\iot-api-windows-amd64.exe
set LOG_DIR=%~dp0logs
set PID_FILE=%LOG_DIR%\server.pid
set STDOUT_LOG=%LOG_DIR%\server.stdout.log
set STDERR_LOG=%LOG_DIR%\server.stderr.log

if not exist "%LOG_DIR%" mkdir "%LOG_DIR%"

if not exist "%EXE%" goto NOT_FOUND

echo Port 5108 is in use by:
netstat -ano | findstr /R /C:":5108 .*LISTENING"
echo ---

if exist "%PID_FILE%" (
    set /p OLD_PID=<"%PID_FILE%"
    echo Old PID file: %OLD_PID%
)

echo Starting GO backend...
start "GO Backend" /B "%EXE%"
echo GO backend launched. Check logs in %LOG_DIR%.
pause
exit /b 0

:NOT_FOUND
echo ERROR: Executable not found: %EXE%
echo Run build.bat first.
pause
exit /b 1
