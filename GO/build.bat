@echo off
setlocal EnableExtensions

cd /d "%~dp0"

where go >nul 2>nul
if errorlevel 1 (
    echo [ERROR] Go is not installed or is not available in PATH.
    exit /b 1
)

if not exist "bin" mkdir "bin"
if not exist ".cache\go-build" mkdir ".cache\go-build"
if not exist ".cache\go-mod" mkdir ".cache\go-mod"
set "GOCACHE=%CD%\.cache\go-build"
set "GOMODCACHE=%CD%\.cache\go-mod"
set "GOTELEMETRY=off"

echo [1/4] Downloading Go modules...
call go mod download
if errorlevel 1 goto :failed

echo [2/4] Running tests...
call go test ./...
if errorlevel 1 goto :failed

echo [3/4] Building Windows AMD64...
set "GOOS=windows"
set "GOARCH=amd64"
set "CGO_ENABLED=0"
call go build -trimpath -ldflags="-s -w" -o "bin\iot-api-windows-amd64.exe" .\cmd\server
if errorlevel 1 goto :failed

echo [4/4] Building Linux AMD64...
set "GOOS=linux"
set "GOARCH=amd64"
set "CGO_ENABLED=0"
call go build -trimpath -ldflags="-s -w" -o "bin\iot-api-linux-amd64" .\cmd\server
if errorlevel 1 goto :failed

echo.
echo Build completed successfully.
echo Windows: bin\iot-api-windows-amd64.exe
echo Linux:   bin\iot-api-linux-amd64
exit /b 0

:failed
echo.
echo [ERROR] Build failed.
exit /b 1
