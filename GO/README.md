# IOT Go Backend

Go replacement for the Python API. The original `backend/main.py` remains unchanged.

## Structure

```text
GO/
  cmd/server/             application entry point
  internal/config/       environment configuration
  internal/database/     SQL Server connection
  internal/model/        API data models
  internal/repository/   SQL queries
  internal/service/      application and ping logic
  internal/httpapi/      routes, handlers, middleware, SSE
```

## Configure and run (PowerShell)

Copy `.env.example` to `.env` and fill in the deployment values. `.env` is ignored by Git, and operating-system environment variables take precedence over values in the file.

```powershell
go run ./cmd/server
```

The default internal API base is `http://localhost:5108/api`, matching the Python routes. The frontend continues to use the public IIS route `/api/RFID/api`; configure IIS to forward that route to the Go server in the same way as the Python server.

## Endpoints

- `GET /health`
- `GET {API_PREFIX}/iot-data?page=1&limit=10&search=...`
- `DELETE {API_PREFIX}/iot-data/{id}`
- `GET {API_PREFIX}/box-status`
- `GET {API_PREFIX}/iot-stream?last_id=0`

The SSE endpoint sends `new_rows` for inserts and `data_changed` whenever the database fingerprint changes, including updates and deletes. Detection frequency is controlled by `CHANGE_POLL_INTERVAL`.

## Verify and build

Build both Windows AMD64 and Linux AMD64 from Windows:

```powershell
.\build.bat
```

Build both targets from Linux:

```sh
chmod +x build.sh
./build.sh
```

Artifacts are written to `bin/iot-api-windows-amd64.exe` and `bin/iot-api-linux-amd64`.

Manual build commands:

```powershell
go mod download
go test ./...
go build -o bin/iot-api.exe ./cmd/server
```
