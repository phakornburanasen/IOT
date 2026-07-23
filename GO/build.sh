#!/usr/bin/env sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
cd "$SCRIPT_DIR"

if ! command -v go >/dev/null 2>&1; then
    echo "[ERROR] Go is not installed or is not available in PATH." >&2
    exit 1
fi

if [ ! -f .env ]; then
    echo "[ERROR] GO/.env was not found. Create it before building deployment packages." >&2
    exit 1
fi

mkdir -p bin/windows-amd64 bin/linux-amd64 .cache/go-build .cache/go-mod
export GOCACHE="$SCRIPT_DIR/.cache/go-build"
export GOMODCACHE="$SCRIPT_DIR/.cache/go-mod"
export GOTELEMETRY=off

echo "[1/4] Downloading Go modules..."
go mod download

echo "[2/4] Running tests..."
go test ./...

echo "[3/4] Building Windows AMD64..."
GOOS=windows GOARCH=amd64 CGO_ENABLED=0 \
    go build -trimpath -ldflags="-s -w" -o bin/windows-amd64/iot-api-windows-amd64.exe ./cmd/server
cp bin/windows-amd64/iot-api-windows-amd64.exe bin/iot-api-windows-amd64.exe
cp .env README.md bin/windows-amd64/

echo "[4/4] Building Linux AMD64..."
GOOS=linux GOARCH=amd64 CGO_ENABLED=0 \
    go build -trimpath -ldflags="-s -w" -o bin/linux-amd64/iot-api-linux-amd64 ./cmd/server
cp bin/linux-amd64/iot-api-linux-amd64 bin/iot-api-linux-amd64
cp .env README.md bin/linux-amd64/
chmod 600 bin/linux-amd64/.env
chmod +x bin/linux-amd64/iot-api-linux-amd64

tar -czf bin/iot-api-windows-amd64.tar.gz -C bin/windows-amd64 .
tar -czf bin/iot-api-linux-amd64.tar.gz -C bin/linux-amd64 .

echo
echo "Build completed successfully."
echo "Windows deployment folder: bin/windows-amd64"
echo "Linux deployment folder:   bin/linux-amd64"
echo "Windows archive:           bin/iot-api-windows-amd64.tar.gz"
echo "Linux archive:             bin/iot-api-linux-amd64.tar.gz"
echo "Copy the entire target folder so the hidden .env file is included."
