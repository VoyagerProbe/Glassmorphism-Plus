import type { PaletteConfig } from '@/utils/paletteColors'
import { clonePalette, isGlassColorPreset, parsePaletteColors } from '@/utils/paletteColors'

/** Origin is isolated by browser storage; Vite's deployment base isolates siblings. */
export function paletteStorageKey(base: string): string {
  return `glassmorphism-plus:palette:v1:${encodeURIComponent(base)}`
}

export function readPalettePreference(key: string): PaletteConfig | null {
  try {
    const raw = localStorage.getItem(key)
    if (!raw)
      return null
    const value: unknown = JSON.parse(raw)
    if (!value || typeof value !== 'object' || Array.isArray(value))
      return null
    const record = value as Record<string, unknown>
    if (record.schemaVersion !== 1 || !isGlassColorPreset(record.preset))
      return null
    const parsed = parsePaletteColors(record.colors)
    return parsed.ok ? { preset: record.preset, colors: parsed.colors } : null
  }
  catch { return null }
}

export function writePalettePreference(key: string, palette: PaletteConfig | null): boolean {
  try {
    if (!palette) {
      localStorage.removeItem(key)
      return true
    }
    const parsed = parsePaletteColors(palette.colors)
    if (!isGlassColorPreset(palette.preset) || !parsed.ok)
      return false
    localStorage.setItem(key, JSON.stringify({ schemaVersion: 1, ...clonePalette({ preset: palette.preset, colors: parsed.colors }) }))
    return true
  }
  catch { return false }
}
