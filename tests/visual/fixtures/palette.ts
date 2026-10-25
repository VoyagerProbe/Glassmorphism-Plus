import type { GlassCustomColors, PaletteConfig } from '../../../src/utils/paletteColors'

// Deliberately equal the retired design: genuine custom colors must remain valid.
// This fixture is test-only; production has no hidden retired preset or defaults.
export const CUSTOM_COLORS: Readonly<GlassCustomColors> = Object.freeze({
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

export function customPalette(): PaletteConfig {
  return { preset: 'custom', colors: { ...CUSTOM_COLORS } }
}
