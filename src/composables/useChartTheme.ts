import { computed } from 'vue'
import { useThemeVars } from '@/composables/useThemeVars'
import { useAppStore } from '@/stores/app'

/** Display-only options: no chart keys, selections, history or requests change. */
export function useChartTheme() {
  const theme = useThemeVars()
  const app = useAppStore()
  return computed(() => ({
    text: theme.value.textColor1,
    textSecondary: theme.value.textColor3,
    textTertiary: theme.value.textColor3,
    borderColor: theme.value.borderColor,
    splitLineColor: theme.value.borderColor,
    tooltipBg: theme.value.controlColor,
    tooltipShadow: app.isDark ? 'rgba(0, 0, 0, 0.22)' : 'rgba(23, 35, 52, 0.08)',
    crosshairColor: theme.value.textColor3,
  }))
}
