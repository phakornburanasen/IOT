@echo off
setlocal EnableExtensions

cd /d "%~dp0"

where go >nul 2>nul
if errorlevel 1 (
    echo [ERROR] Go is not installed or is not available in PATH.
    exit /b 1
)

if not exist ".env" (
    echo [ERROR] GO\.env was not found. Create it before building deployment packages.
    exit /b 1
)

if not exist "bin" mkdir "bin"
if not exist "bin\windows-amd64" mkdir "bin\windows-amd64"
if not exist "bin\linux-amd64" mkdir "bin\linux-amd64"
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
call go build -trimpath -ldflags="-s -w" -o "bin\windows-amd64\iot-api-windows-amd64.exe" .\cmd\server
if errorlevel 1 goto :failed
copy /Y "bin\windows-amd64\iot-api-windows-amd64.exe" "bin\iot-api-windows-amd64.exe" >nul 2>nul
if errorlevel 1 (
    echo [WARNING] Windows deployment package was built, but the active executable was not updated because it is in use.
    echo           Stop the GO backend and run this script again to update bin\iot-api-windows-amd64.exe.
)
copy /Y ".env" "bin\windows-amd64\.env" >nul
copy /Y "README.md" "bin\windows-amd64\README.md" >nul

echo [4/4] Building Linux AMD64...
set "GOOS=linux"
set "GOARCH=amd64"
set "CGO_ENABLED=0"
call go build -trimpath -ldflags="-s -w" -o "bin\linux-amd64\iot-api-linux-amd64" .\cmd\server
if errorlevel 1 goto :failed
copy /Y "bin\linux-amd64\iot-api-linux-amd64" "bin\iot-api-linux-amd64" >nul
if errorlevel 1 goto :failed
copy /Y ".env" "bin\linux-amd64\.env" >nul
copy /Y "README.md" "bin\linux-amd64\README.md" >nul

where tar >nul 2>nul
if errorlevel 1 (
    echo [ERROR] tar is required to create deployment archives.
    goto :failed
)
tar -czf "bin\iot-api-windows-amd64.tar.gz" -C "bin\windows-amd64" .
if errorlevel 1 goto :failed
tar -czf "bin\iot-api-linux-amd64.tar.gz" -C "bin\linux-amd64" .
if errorlevel 1 goto :failed

echo.
echo Build completed successfully.
echo Windows deployment folder: bin\windows-amd64
echo Linux deployment folder:   bin\linux-amd64
echo Windows archive:           bin\iot-api-windows-amd64.tar.gz
echo Linux archive:             bin\iot-api-linux-amd64.tar.gz
echo Copy the entire target folder so the hidden .env file is included.
exit /b 0

:failed
echo.
echo [ERROR] Build failed.
exit /b 1
