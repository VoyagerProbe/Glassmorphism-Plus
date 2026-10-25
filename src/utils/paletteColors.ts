/** The wire format remains the existing ten HEX keys; editor metadata stays outside it. */
export const GLASS_COLOR_KEYS = [
  'lightCard',
  'lightControl',
  'lightText',
  'lightMutedText',
  'lightBorder',
  'darkCard',
  'darkControl',
  'darkText',
  'darkMutedText',
  'darkBorder',
] as const

export type GlassColorKey = typeof GLASS_COLOR_KEYS[number]
export type GlassCustomColors = Record<GlassColorKey, string>
export type GlassColorPreset = 'emerald' | 'soft' | 'contrast' | 'midnight' | 'softFrost' | 'custom'
export interface PaletteConfig { preset: GlassColorPreset, colors: GlassCustomColors }
export interface RgbaBytes { r: number, g: number, b: number, alphaByte: number }
export type ColorResult = { ok: true, color: RgbaBytes } | { ok: false, error: string }
export type PaletteResult = { ok: true, colors: GlassCustomColors, ignoredKeys: number } | { ok: false, error: string }

const MANAGED_HEX = /^#[\da-f]{6}(?:[\da-f]{2})?$/i
const EDITOR_HEX = /^#?([\da-f]{6})([\da-f]{2})?$/i
const EDITOR_RGB = /^rgb\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*\)$/i
const ALPHA_PERCENT = /^(?:\d+(?:\.\d*)?|\.\d+)$/

export const SOFT_FROST_COLORS: Readonly<GlassCustomColors> = Object.freeze({
  lightCard: '#F8FAFCE6',
  lightControl: '#E8EDF4E6',
  lightText: '#111111',
  lightMutedText: '#4F5D70',
  lightBorder: '#102A431F',
  darkCard: '#1E2732E6',
  darkControl: '#2C3744E6',
  darkText: '#F2F5FA',
  darkMutedText: '#B2BFD1',
  darkBorder: '#D8E5F21A',
})

// Preserve the pre-v3 per-key fallback contract, distinct from strict editor import.
const LEGACY_DEFAULT_COLORS: Readonly<GlassCustomColors> = Object.freeze({
  lightCard: '#f1f5f9bd',
  lightControl: '#e2e8f0c2',
  lightText: '#14151a',
  lightMutedText: '#3f4552',
  lightBorder: '#cbd5e199',
  darkCard: '#0d111ad9',
  darkControl: '#101624cc',
  darkText: '#f7f8fb',
  darkMutedText: '#d6dae4',
  darkBorder: '#ffffff2e',
})

export function parseManagedGlassColors(settings: Record<string, unknown>): GlassCustomColors {
  let raw = settings.glassCustomColors
  if (typeof raw === 'string') {
    try {
      raw = JSON.parse(raw)
    }
    catch {
      raw = null
    }
  }
  const record = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : {}
  const read = (value: unknown, fallback: string) => typeof value === 'string' && MANAGED_HEX.test(value.trim()) ? value.trim() : fallback
  return Object.fromEntries(GLASS_COLOR_KEYS.map((key) => {
    const legacyKey = `glass${key[0]!.toUpperCase()}${key.slice(1)}Color`
    const fallback = read(settings[legacyKey], LEGACY_DEFAULT_COLORS[key])
    return [key, read(Object.hasOwn(record, key) ? record[key] : undefined, fallback)]
  })) as GlassCustomColors
}

export const PALETTE_PRESET_VALUES: Readonly<Record<GlassColorPreset, string>> = Object.freeze({
  emerald: '翡翠',
  soft: '柔和',
  contrast: '高对比',
  midnight: '午夜',
  softFrost: '柔雾',
  custom: '自定义',
})

const PRESET_ALIASES: Readonly<Record<string, GlassColorPreset>> = Object.freeze({
  emerald: 'emerald',
  翡翠: 'emerald',
  soft: 'soft',
  柔和: 'soft',
  contrast: 'contrast',
  高对比: 'contrast',
  midnight: 'midnight',
  午夜: 'midnight',
  softFrost: 'softFrost',
  柔雾: 'softFrost',
  柔霧: 'softFrost',
  custom: 'custom',
  自定义: 'custom',
})

export function parseGlassColorPreset(value: unknown): GlassColorPreset {
  const key = typeof value === 'string' ? value.trim() : ''
  return Object.hasOwn(PRESET_ALIASES, key) ? PRESET_ALIASES[key]! : 'emerald'
}

export function isGlassColorPreset(value: unknown): value is GlassColorPreset {
  return typeof value === 'string' && Object.hasOwn(PALETTE_PRESET_VALUES, value)
}

export function parseHexColor(value: unknown, alphaByte = 255): ColorResult {
  const match = typeof value === 'string' && EDITOR_HEX.exec(value.trim())
  if (!match || !Number.isInteger(alphaByte) || alphaByte < 0 || alphaByte > 255)
    return { ok: false, error: '请输入 6 或 8 位 HEX，例如 #1E2732E6。' }
  return { ok: true, color: {
    r: Number.parseInt(match[1]!.slice(0, 2), 16),
    g: Number.parseInt(match[1]!.slice(2, 4), 16),
    b: Number.parseInt(match[1]!.slice(4, 6), 16),
    alphaByte: match[2] ? Number.parseInt(match[2], 16) : alphaByte,
  } }
}

export function parseRgbColor(value: unknown, alphaByte: number): ColorResult {
  const match = typeof value === 'string' && EDITOR_RGB.exec(value.trim())
  if (!match || match.slice(1).some(channel => Number(channel) > 255)
    || !Number.isInteger(alphaByte) || alphaByte < 0 || alphaByte > 255) {
    return { ok: false, error: 'RGB 必须是三个 0–255 的整数，例如 rgb(30, 39, 50)。' }
  }
  return { ok: true, color: { r: Number(match[1]), g: Number(match[2]), b: Number(match[3]), alphaByte } }
}

export function parseAlphaPercent(value: string): number | null {
  if (!ALPHA_PERCENT.test(value.trim()))
    return null
  const percent = Number(value)
  return Number.isFinite(percent) && percent >= 0 && percent <= 100 ? Math.round(percent * 255 / 100) : null
}

export function serializeColor(color: RgbaBytes): string {
  const channels = [color.r, color.g, color.b, color.alphaByte]
  if (channels.some(byte => !Number.isInteger(byte) || byte < 0 || byte > 255))
    throw new Error('Invalid RGBA bytes')
  return `#${channels.slice(0, color.alphaByte === 255 ? 3 : 4).map(byte => byte.toString(16).padStart(2, '0')).join('').toUpperCase()}`
}

export function parsePaletteColors(value: unknown): PaletteResult {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return { ok: false, error: '请提供包含完整十个配色键的 JSON 对象。' }
  const colors = {} as GlassCustomColors
  for (const key of GLASS_COLOR_KEYS) {
    const parsed = Object.hasOwn(value, key) && parseHexColor((value as Record<string, unknown>)[key])
    if (!parsed || !parsed.ok)
      return { ok: false, error: `${key} 缺失或不是有效 HEX；未导入任何颜色。` }
    colors[key] = serializeColor(parsed.color)
  }
  return { ok: true, colors, ignoredKeys: Object.keys(value).filter(key => !(GLASS_COLOR_KEYS as readonly string[]).includes(key)).length }
}

export function parsePaletteJson(text: string): PaletteResult {
  try {
    return parsePaletteColors(JSON.parse(text))
  }
  catch {
    return { ok: false, error: 'JSON 格式无效；未导入任何颜色。' }
  }
}

export function clonePalette(palette: PaletteConfig): PaletteConfig {
  return { preset: palette.preset, colors: Object.fromEntries(GLASS_COLOR_KEYS.map(key => [key, palette.colors[key]])) as GlassCustomColors }
}

export function softFrostPalette(): PaletteConfig {
  return { preset: 'softFrost', colors: { ...SOFT_FROST_COLORS } }
}

export function withHoverAlpha(value: string): string {
  const parsed = parseHexColor(value)
  return parsed.ok ? serializeColor({ ...parsed.color, alphaByte: Math.min(255, parsed.color.alphaByte + 10) }) : value
}

/** Composite once for reduced-transparency/no-blur surfaces, retaining custom RGB. */
export function opaqueColorOver(value: string, background: string): string {
  const front = parseHexColor(value)
  const back = parseHexColor(background)
  if (!front.ok || !back.ok)
    throw new Error('Invalid composite colors')
  const alpha = front.color.alphaByte / 255
  const blend = (channel: 'r' | 'g' | 'b') => Math.round(front.color[channel] * alpha + back.color[channel] * (1 - alpha))
  return serializeColor({ r: blend('r'), g: blend('g'), b: blend('b'), alphaByte: 255 })
}

export function paletteEquals(left: PaletteConfig, right: PaletteConfig): boolean {
  return left.preset === right.preset && GLASS_COLOR_KEYS.every((key) => {
    const a = parseHexColor(left.colors[key])
    const b = parseHexColor(right.colors[key])
    return a.ok && b.ok && serializeColor(a.color) === serializeColor(b.color)
  })
}
