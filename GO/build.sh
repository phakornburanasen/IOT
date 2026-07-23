#!/usr/bin/env sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
cd "$SCRIPT_DIR"

if ! command -v go >/dev/null 2>&1; then
    echo "[ERROR] Go is not installed or is not available in PATH." >&2
    exit 1
fi

mkdir -p bin .cache/go-build .cache/go-mod
export GOCACHE="$SCRIPT_DIR/.cache/go-build"
export GOMODCACHE="$SCRIPT_DIR/.cache/go-mod"
export GOTELEMETRY=off

echo "[1/4] Downloading Go modules..."
go mod download

echo "[2/4] Running tests..."
go test ./...

echo "[3/4] Building Windows AMD64..."
GOOS=windows GOARCH=amd64 CGO_ENABLED=0 \
    go build -trimpath -ldflags="-s -w" -o bin/iot-api-windows-amd64.exe ./cmd/server

echo "[4/4] Building Linux AMD64..."
GOOS=linux GOARCH=amd64 CGO_ENABLED=0 \
    go build -trimpath -ldflags="-s -w" -o bin/iot-api-linux-amd64 ./cmd/server

echo
echo "Build completed successfully."
echo "Windows: bin/iot-api-windows-amd64.exe"
echo "Linux:   bin/iot-api-linux-amd64"
