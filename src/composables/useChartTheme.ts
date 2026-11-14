import { computed } from 'vue'
import { useThemeVars } from '@/composables/useThemeVars'
import { useAppStore } from '@/stores/app'

/** Display-only options: no chart keys, selections, history or requests change. */
export function useChartTheme(kind: 'ping' | 'load' = 'ping') {
  const theme = useThemeVars()
  const app = useAppStore()
  return computed(() => {
    const dark = app.isDark
    const custom = app.glassColorPreset === 'custom'
    return {
      text: custom ? theme.value.textColor1 : dark ? 'rgba(255, 255, 255, 0.85)' : 'rgba(0, 0, 0, 0.85)',
      textSecondary: custom ? theme.value.textColor3 : dark ? 'rgba(255, 255, 255, 0.55)' : 'rgba(0, 0, 0, 0.55)',
      textTertiary: custom ? theme.value.textColor3 : dark ? 'rgba(255, 255, 255, 0.35)' : 'rgba(0, 0, 0, 0.35)',
      borderColor: custom ? theme.value.borderColor : dark ? 'rgba(255, 255, 255, 0.1)' : kind === 'load' ? 'rgba(0, 0, 0, 0.1)' : 'rgba(0, 0, 0, 0.06)',
      splitLineColor: custom ? theme.value.borderColor : dark ? 'rgba(255, 255, 255, 0.06)' : 'rgba(0, 0, 0, 0.06)',
      tooltipBg: custom ? theme.value.controlColor : dark ? 'rgba(40, 40, 40, 0.95)' : 'rgba(255, 255, 255, 0.8)',
      tooltipShadow: dark ? 'rgba(0, 0, 0, 0.4)' : 'rgba(0, 0, 0, 0.06)',
      crosshairColor: custom ? theme.value.textColor3 : dark ? 'rgba(255, 255, 255, 0.15)' : 'rgba(0, 0, 0, 0.1)',
    }
  })
}
