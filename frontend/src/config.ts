function positiveNumber(value: string | undefined, fallback: number): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

const configuredApiBase = import.meta.env.VITE_API_BASE_URL?.trim()
const runtimeGatewayBase = `http://${window.location.hostname}:8000/api/RFID/api`
//const runtimeGatewayBase = `http://10.0.32.71:8000/api/RFID/api

export const API_BASE_URL = (configuredApiBase || runtimeGatewayBase).replace(/\/$/, '')
export const AUTO_REFRESH_MS = positiveNumber(import.meta.env.VITE_AUTO_REFRESH_MS, 15_000)
