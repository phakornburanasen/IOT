@echo off
setlocal EnableExtensions EnableDelayedExpansion

set "SCRIPT_DIR=%~dp0"
if "%SCRIPT_DIR:~-1%"=="\" set "SCRIPT_DIR=%SCRIPT_DIR:~0,-1%"
set "EXE=%SCRIPT_DIR%\bin\iot-api-windows-amd64.exe"
set "LOG_DIR=%SCRIPT_DIR%\logs"
set "PID_FILE=%LOG_DIR%\server.pid"
set "STDOUT_LOG=%LOG_DIR%\server.stdout.log"
set "STDERR_LOG=%LOG_DIR%\server.stderr.log"
set "APP_PORT=5108"
set "HEALTH_URL=http://127.0.0.1:%APP_PORT%/health"

if not exist "%LOG_DIR%" mkdir "%LOG_DIR%" >nul 2>&1

set "ACTION=%~1"
if "%ACTION%"=="" set "ACTION=restart"

if /I "%ACTION%"=="start" goto :start
if /I "%ACTION%"=="stop" goto :stop
if /I "%ACTION%"=="restart" goto :restart
if /I "%ACTION%"=="status" goto :status
if /I "%ACTION%"=="health" goto :health

echo Usage: %~nx0 [start^|stop^|restart^|status^|health]
exit /b 1

:read_pid
set "CURRENT_PID="
if exist "%PID_FILE%" (
    set /p CURRENT_PID=<"%PID_FILE%"
)
exit /b 0

:pid_is_running
set "PID_RUNNING="
call :read_pid
if not defined CURRENT_PID exit /b 0
for /f %%I in ('powershell -NoProfile -Command "$p = Get-Process -Id %CURRENT_PID% -ErrorAction SilentlyContinue; if ($p) { Write-Output 1 }"') do set "PID_RUNNING=%%I"
exit /b 0

:port_owner
set "PORT_PID="
for /f "tokens=5" %%I in ('netstat -ano ^| findstr /R /C:":%APP_PORT% .*LISTENING"') do (
    set "PORT_PID=%%I"
    goto :eof
)
exit /b 0

:stop
call :pid_is_running
if defined PID_RUNNING (
    echo Stopping GO backend PID %CURRENT_PID%...
    powershell -NoProfile -Command "Stop-Process -Id %CURRENT_PID% -Force -ErrorAction SilentlyContinue" >nul 2>&1
    timeout /t 2 /nobreak >nul
) else (
    call :port_owner
    if defined PORT_PID (
        echo PID file not usable. Stopping process on port %APP_PORT%: PID %PORT_PID%...
        powershell -NoProfile -Command "$p = Get-CimInstance Win32_Process -Filter \"ProcessId = %PORT_PID%\" -ErrorAction SilentlyContinue; if ($p -and $p.Name -eq 'iot-api-windows-amd64.exe') { Stop-Process -Id %PORT_PID% -Force }"
        timeout /t 2 /nobreak >nul
    ) else (
        echo GO backend is not running.
    )
)

call :port_owner
if defined PORT_PID (
    echo Failed to stop backend on port %APP_PORT%.
    exit /b 1
)

if exist "%PID_FILE%" del /f /q "%PID_FILE%" >nul 2>&1
echo GO backend stopped.
exit /b 0

:start
if not exist "%EXE%" (
    echo Executable not found: "%EXE%"
    exit /b 1
)

call :port_owner
if defined PORT_PID (
    echo Port %APP_PORT% is already in use by PID %PORT_PID%.
    exit /b 1
)

echo Starting GO backend...
powershell -NoProfile -Command "$proc = Start-Process -FilePath '%EXE%' -WorkingDirectory '%SCRIPT_DIR%' -RedirectStandardOutput '%STDOUT_LOG%' -RedirectStandardError '%STDERR_LOG%' -WindowStyle Hidden -PassThru; Set-Content -LiteralPath '%PID_FILE%' -Value $proc.Id; Write-Output $proc.Id"
if errorlevel 1 (
    echo Failed to start GO backend.
    exit /b 1
)

timeout /t 2 /nobreak >nul
call :health >nul 2>&1
if errorlevel 1 (
    echo GO backend started but health check failed. See logs in "%LOG_DIR%".
    exit /b 1
)

call :read_pid
echo GO backend started successfully. PID %CURRENT_PID%
exit /b 0

:restart
call :stop
call :start
exit /b %errorlevel%

:status
call :read_pid
call :port_owner
if defined PORT_PID (
    echo GO backend is running on port %APP_PORT% with PID %PORT_PID%.
    if defined CURRENT_PID echo PID file: %CURRENT_PID%
    exit /b 0
)

if defined CURRENT_PID (
    echo GO backend is not listening, but PID file exists: %CURRENT_PID%.
    exit /b 1
)

echo GO backend is stopped.
exit /b 1

:health
powershell -NoProfile -Command "try { $resp = Invoke-WebRequest -UseBasicParsing '%HEALTH_URL%' -TimeoutSec 10; Write-Output $resp.Content; exit 0 } catch { Write-Error $_.Exception.Message; exit 1 }"
exit /b %errorlevel%
