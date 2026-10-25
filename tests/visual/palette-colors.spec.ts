import { expect, test } from '@playwright/test'
import {
  clonePalette,
  GLASS_COLOR_KEYS,
  opaqueColorOver,
  paletteEquals,
  parseAlphaPercent,
  parseGlassColorPreset,
  parseHexColor,
  parseManagedGlassColors,
  parsePaletteColors,
  parsePaletteJson,
  parseRgbColor,
  serializeColor,
  withHoverAlpha,
} from '../../src/utils/paletteColors'
import { CUSTOM_COLORS, customPalette } from './fixtures/palette'

test('palette byte parsers preserve alpha and reject non-colors without clamping', () => {
  for (const alphaByte of [0, 1, 26, 127, 230, 242, 255]) {
    expect(parseHexColor(' #aBcDeF ', alphaByte)).toEqual({ ok: true, color: { r: 171, g: 205, b: 239, alphaByte } })
    expect(parseRgbColor(' RGB( 000, 10, 255 ) ', alphaByte)).toEqual({ ok: true, color: { r: 0, g: 10, b: 255, alphaByte } })
    expect(parseHexColor('#010203F2', alphaByte)).toEqual({ ok: true, color: { r: 1, g: 2, b: 3, alphaByte: 242 } })
    const color = { r: 1, g: 20, b: 255, alphaByte }
    expect(parseHexColor(serializeColor(color))).toEqual({ ok: true, color })
  }
  for (const input of ['', ' ', 'rgb(256,0,0)', 'rgb(-1,0,0)', 'rgb(1.2,0,0)', 'rgb(1%,0,0)', 'rgb(NaN,0,0)', 'rgb(Infinity,0,0)', 'rgba(1,2,3,1)', 'rgb(1,2)', 'rgb(1,2,3,4)', 'rgb(1 2 3)', 'rgb(1,2,3);color:red', 'rgb(0000,2,3)'])
    expect(parseRgbColor(input, 230).ok, input).toBe(false)
  for (const input of ['', '#fff', '#1122334', '#112233445', 'red', 'var(--x)', 'url(x)', '<script>', '#112233;'])
    expect(parseHexColor(input).ok, input).toBe(false)
  expect(parseAlphaPercent('90.2')).toBe(230)
  expect(parseAlphaPercent('0')).toBe(0)
  expect(parseAlphaPercent('100')).toBe(255)
  for (const input of ['', ' ', '-1', '101', 'Infinity', 'NaN', '0x10', '1e1', '90%'])
    expect(parseAlphaPercent(input), input).toBeNull()
  expect(() => serializeColor({ r: 256, g: 0, b: 0, alphaByte: 255 })).toThrow()
})

test('reduced-transparency compositing preserves chosen RGB and storage rejects future or corrupt data without rewriting it', async () => {
  expect(opaqueColorOver('#123456FF', '#FFFFFF')).toBe('#123456')
  expect(opaqueColorOver('#12345600', '#FFFFFF')).toBe('#FFFFFF')
  expect(opaqueColorOver('#00000080', '#FFFFFF')).toBe('#7F7F7F')
  const { paletteStorageKey, readPalettePreference, writePalettePreference } = await import('../../src/services/palette-preference.service')
  const key = paletteStorageKey('/tenant/')
  expect(key).not.toBe(paletteStorageKey('/'))
  const data = new Map<string, string>()
  const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: (name: string) => data.get(name) ?? null,
    setItem: (name: string, value: string) => data.set(name, value),
    removeItem: (name: string) => data.delete(name),
  } })
  try {
    for (const raw of ['{', '[]', JSON.stringify({ schemaVersion: 2, ...customPalette() }), JSON.stringify({ schemaVersion: 1, preset: 'custom', colors: {} })]) {
      data.set(key, raw)
      expect(readPalettePreference(key)).toBeNull()
      expect(data.get(key)).toBe(raw)
    }
    expect(writePalettePreference(key, customPalette())).toBe(true)
    expect(readPalettePreference(key)).toEqual(customPalette())
    data.set('unrelated', 'preserved')
    expect(writePalettePreference(key, null)).toBe(true)
    expect([...data.entries()]).toEqual([['unrelated', 'preserved']])
  }
  finally {
    if (original)
      Object.defineProperty(globalThis, 'localStorage', original)
    else Reflect.deleteProperty(globalThis, 'localStorage')
  }
})

test('complete JSON import is atomic, allowlisted and semantically round trips', () => {
  const original = customPalette()
  const parsed = parsePaletteJson(JSON.stringify(original.colors))
  expect(parsed.ok).toBe(true)
  if (!parsed.ok)
    throw new Error(parsed.error)
  expect(Object.keys(parsed.colors)).toEqual([...GLASS_COLOR_KEYS])
  expect(parsed.colors).toEqual(original.colors)
  expect(parsePaletteColors({ ...original.colors, lightCard: '#ABCDEF' })).toMatchObject({ ok: true, colors: { lightCard: '#ABCDEF' } })
  const hostile = `${JSON.stringify(original.colors).slice(0, -1)},"__proto__":{"polluted":true},"constructor":{},"extra":"url(x)"}`
  const sanitized = parsePaletteJson(hostile)
  expect(sanitized).toMatchObject({ ok: true, ignoredKeys: 3, colors: original.colors })
  expect(({} as Record<string, unknown>).polluted).toBeUndefined()
  for (const input of ['null', '[]', 'true', '{}', '{', JSON.stringify({ ...original.colors, darkText: 'rgb(0,0,0)' })])
    expect(parsePaletteJson(input).ok, input).toBe(false)
  const inherited = Object.create(original.colors)
  expect(parsePaletteColors(inherited).ok).toBe(false)
  const copied = clonePalette(original)
  copied.colors.lightText = '#FFFFFF'
  expect(original.colors.lightText).toBe('#111111')
  expect(Object.isFrozen(CUSTOM_COLORS)).toBe(true)
  expect(customPalette().colors).toEqual(CUSTOM_COLORS)
  expect(paletteEquals(original, { preset: 'custom', colors: { ...original.colors, lightText: '#111111ff' } })).toBe(true)
})

test('hover is monotonic for every alpha byte and keeps RGB; preset aliases are own-only', () => {
  for (let alphaByte = 0; alphaByte <= 255; alphaByte++) {
    const base = { r: 12, g: 123, b: 234, alphaByte }
    const hover = parseHexColor(withHoverAlpha(serializeColor(base)))
    expect(hover).toEqual({ ok: true, color: { ...base, alphaByte: Math.min(255, alphaByte + 10) } })
  }
  expect(withHoverAlpha('#123456')).toBe('#123456')
  expect(withHoverAlpha('#123456E6')).toBe('#123456F0')
  expect(withHoverAlpha('#123456F2')).toBe('#123456FC')
  expect(withHoverAlpha('#123456FF')).toBe('#123456')
  for (const alias of ['softFrost', '柔雾', '柔霧'])
    expect(parseGlassColorPreset(alias)).toBe('emerald')
  for (const alias of ['__proto__', 'constructor', 'unknown', null])
    expect(parseGlassColorPreset(alias)).toBe('emerald')
  expect(parseGlassColorPreset('柔和')).toBe('soft')
})

test('managed legacy reader retains partial per-key fallbacks rather than strict import rules', () => {
  const colors = parseManagedGlassColors({ glassCustomColors: '{"lightText":"#112233e6","darkCard":"invalid"}', glassDarkCardColor: '#12345678' })
  expect(colors.lightText).toBe('#112233e6')
  expect(colors.darkCard).toBe('#12345678')
  expect(colors.lightCard).toBe('#f1f5f9bd')
  expect(parseManagedGlassColors({ glassCustomColors: '{' }).darkText).toBe('#f7f8fb')
  expect(parseManagedGlassColors({ glassCustomColors: Object.create({ lightText: '#ffffff' }) }).lightText).toBe('#14151a')
})
