export interface LoadChartPalette {
  primary: string
  primaryAreaStrong: string
  primaryAreaFaint: string
  secondary: string
  tertiary: string
  tertiaryAreaStrong: string
  tertiaryAreaFaint: string
  quaternary: string
  quinary: string
  senary: string
}

const ACCESSIBLE_LOAD_CHART_PALETTE: LoadChartPalette = {
  primary: '#D55E00',
  primaryAreaStrong: 'rgba(213, 94, 0, 0.25)',
  primaryAreaFaint: 'rgba(213, 94, 0, 0.02)',
  secondary: '#E69F00',
  tertiary: '#009E73',
  tertiaryAreaStrong: 'rgba(0, 158, 115, 0.25)',
  tertiaryAreaFaint: 'rgba(0, 158, 115, 0.02)',
  quaternary: '#CC79A7',
  quinary: '#0072B2',
  senary: '#56B4E9',
}

const LIGHT_SERIES_PALETTE = ['#246BCE', '#087F74', '#7054A3', '#A86510', '#C6484C', '#4F5D70']
const DARK_SERIES_PALETTE = ['#8BB8FF', '#66C9BE', '#B5A1DF', '#E9B55F', '#F08086', '#B2BFD1']

const ACCESSIBLE_SERIES_PALETTE = [
  '#0072B2',
  '#E69F00',
  '#009E73',
  '#CC79A7',
  '#D55E00',
  '#56B4E9',
  '#F0C94A',
  '#6B7280',
]

export const ACCESSIBLE_LINE_TYPES = ['solid', 'dashed', 'dotted'] as const

export function getLoadChartPalette(accessible: boolean, dark = false): LoadChartPalette {
  if (accessible)
    return { ...ACCESSIBLE_LOAD_CHART_PALETTE }
  const colors = getChartSeriesPalette(false, dark)
  return {
    primary: colors[0]!,
    primaryAreaStrong: `${colors[0]}40`,
    primaryAreaFaint: `${colors[0]}05`,
    secondary: colors[1]!,
    tertiary: colors[2]!,
    tertiaryAreaStrong: `${colors[2]}40`,
    tertiaryAreaFaint: `${colors[2]}05`,
    quaternary: colors[3]!,
    quinary: colors[4]!,
    senary: colors[5]!,
  }
}

export function getChartSeriesPalette(accessible: boolean, dark = false): string[] {
  return [...(accessible ? ACCESSIBLE_SERIES_PALETTE : dark ? DARK_SERIES_PALETTE : LIGHT_SERIES_PALETTE)]
}
