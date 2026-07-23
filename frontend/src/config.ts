function positiveNumber(value: string | undefined, fallback: number): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

const configuredApiBase = import.meta.env.VITE_API_BASE_URL?.trim()

export const API_BASE_URL = (configuredApiBase || '/api/RFID/api').replace(/\/$/, '')
export const AUTO_REFRESH_MS = positiveNumber(import.meta.env.VITE_AUTO_REFRESH_MS, 15_000)
