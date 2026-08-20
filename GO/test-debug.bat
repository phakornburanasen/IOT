@echo off
setlocal EnableExtensions EnableDelayedExpansion

for %%I in ("%~dp0.") do set "SCRIPT_DIR=%%~fI"
set "EXE=%SCRIPT_DIR%\bin\iot-api-windows-amd64.exe"
set "LOG_DIR=%SCRIPT_DIR%\logs"
set "PID_FILE=%LOG_DIR%\server.pid"
set "STDOUT_LOG=%LOG_DIR%\server.stdout.log"
set "STDERR_LOG=%LOG_DIR%\server.stderr.log"
set "APP_PORT=5108"
set "HEALTH_URL=http://127.0.0.1:%APP_PORT%/health"

echo A. SCRIPT_DIR=%SCRIPT_DIR%
echo B. EXE=%EXE%

if not exist "%LOG_DIR%" mkdir "%LOG_DIR%" >nul 2>&1
echo C. log dir ok

if not exist "%EXE%" (
    echo [ERROR] Executable not found
    pause
    exit /b 1
)
echo D. exe exists

echo E. checking port
for /f "tokens=5" %%I in ('netstat -ano ^| findstr /R /C:":%APP_PORT% .*LISTENING"') do (
    set "PORT_PID=%%I"
    echo F. port pid=%%I
    goto :port_done
)
:port_done
echo G. port check done

if defined PORT_PID (
    echo Port in use
    pause
    exit /b 0
)
echo H. port free

if exist "%PID_FILE%" (
    set /p CURRENT_PID=<"%PID_FILE%"
    echo I. existing pid=%CURRENT_PID%
)

echo J. start powershell
powershell -NoProfile -ExecutionPolicy Bypass -Command "Write-Output hello"
echo K. powershell ok

echo L. start actual powershell
powershell -NoProfile -ExecutionPolicy Bypass -Command "$proc = Start-Process -FilePath '%EXE%' -WorkingDirectory '%SCRIPT_DIR%' -RedirectStandardOutput '%STDOUT_LOG%' -RedirectStandardError '%STDERR_LOG%' -WindowStyle Hidden -PassThru; Set-Content -LiteralPath '%PID_FILE%' -Value $proc.Id; Write-Output $proc.Id"
echo M. started

pause
endlocal
exit /b 0
