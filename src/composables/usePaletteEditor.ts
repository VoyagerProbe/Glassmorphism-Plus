import type { SitePaletteSnapshot } from '@/services/palette-admin.service'
import type { GlassColorKey, GlassColorPreset, PaletteConfig, RgbaBytes } from '@/utils/paletteColors'
import { computed, nextTick, onScopeDispose, ref, watch } from 'vue'
import { invalidatePaletteAdminSession, loadSitePalette, PaletteSaveError, saveSitePalette } from '@/services/palette-admin.service'
import { useAppStore } from '@/stores/app'
import { paletteForPreset } from '@/utils/glassTheme'
import { clonePalette, GLASS_COLOR_KEYS, parseAlphaPercent, parseHexColor, parsePaletteJson, parseRgbColor, serializeColor, SOFT_FROST_COLORS, softFrostPalette } from '@/utils/paletteColors'

type InputKind = 'hex' | 'rgb' | 'alpha'
interface FieldInput { hex: string, rgb: string, alpha: string, errors: Partial<Record<InputKind, string>> }
const FIELD_NAMES = { Card: '卡片', Control: '控制区', Text: '主文字', MutedText: '次文字', Border: '边框' } as const

function modelOf(value: string): RgbaBytes {
  const parsed = parseHexColor(value)
  if (!parsed.ok)
    throw new Error(parsed.error)
  return parsed.color
}

function inputsFor(value: string): FieldInput {
  const color = modelOf(value)
  return { hex: serializeColor(color), rgb: `rgb(${color.r}, ${color.g}, ${color.b})`, alpha: String(Number((color.alphaByte / 255 * 100).toFixed(2))), errors: {} }
}

export function usePaletteEditor() {
  const app = useAppStore()
  const group = ref<'light' | 'dark'>(app.resolvedThemeMode)
  const field = ref<keyof typeof FIELD_NAMES>('Card')
  const scope = ref<'local' | 'site'>('local')
  const draft = computed(() => app.paletteDraft!)
  const selectedKey = computed(() => `${group.value}${field.value}` as GlassColorKey)
  const fields = computed(() => Object.entries(FIELD_NAMES).map(([key, label]) => ({ key: key as keyof typeof FIELD_NAMES, label })))
  const inputs = ref({} as Record<GlassColorKey, FieldInput>)
  const selectedInput = computed(() => inputs.value[selectedKey.value]!)
  const selectedColor = computed(() => modelOf(draft.value.colors[selectedKey.value]))
  const pickerColor = computed(() => serializeColor({ ...selectedColor.value, alphaByte: 255 }))
  const jsonText = ref('')
  const jsonDirty = ref(false)
  const jsonError = ref('')
  const status = ref('')
  const busy = ref(false)
  const pendingConfirmation = ref(false)
  const siteBaseline = ref<SitePaletteSnapshot | null>(null)
  const confirmation = ref(false)
  let operation = 0
  const invalid = computed(() => jsonDirty.value || Object.values(inputs.value).some(input => Object.keys(input.errors).length > 0))

  function resetInputs(keys: readonly GlassColorKey[] = GLASS_COLOR_KEYS) {
    for (const key of keys)
      inputs.value[key] = inputsFor(draft.value.colors[key])
    confirmation.value = false
  }

  function setDraft(palette: PaletteConfig) {
    app.paletteDraft = clonePalette(palette)
    resetInputs()
    jsonText.value = JSON.stringify(palette.colors, null, 2)
    jsonDirty.value = false
    jsonError.value = ''
  }

  function setPreset(preset: GlassColorPreset) {
    setDraft(paletteForPreset(preset, draft.value.colors))
  }

  function updateInput(kind: InputKind, value: string) {
    const key = selectedKey.value
    const input = inputs.value[key]
    input[kind] = value
    const previous = modelOf(draft.value.colors[key])
    const alpha = kind === 'alpha' ? parseAlphaPercent(value) : null
    const parsed = kind === 'hex'
      ? parseHexColor(value, previous.alphaByte)
      : kind === 'rgb'
        ? parseRgbColor(value, previous.alphaByte)
        : alpha === null ? { ok: false as const, error: '透明度必须为 0–100 的数字。' } : { ok: true as const, color: { ...previous, alphaByte: alpha } }
    confirmation.value = false
    if (!parsed.ok) {
      input.errors[kind] = parsed.error
      return
    }
    delete input.errors[kind]
    const colors = { ...draft.value.colors, [key]: serializeColor(parsed.color) }
    app.paletteDraft = { preset: 'custom', colors }
    const normalized = inputsFor(colors[key])
    for (const other of ['hex', 'rgb', 'alpha'] as const) {
      if (other !== kind && !input.errors[other])
        input[other] = normalized[other]
    }
    if (!jsonDirty.value)
      jsonText.value = JSON.stringify(colors, null, 2)
  }

  function normalizeInput(kind: InputKind) {
    if (!selectedInput.value.errors[kind])
      selectedInput.value[kind] = inputsFor(draft.value.colors[selectedKey.value])[kind]
  }

  function resetGroup() {
    const keys = GLASS_COLOR_KEYS.filter(key => key.startsWith(group.value))
    const colors = { ...draft.value.colors }
    for (const key of keys)
      colors[key] = SOFT_FROST_COLORS[key]
    app.paletteDraft = { preset: 'custom', colors }
    resetInputs(keys)
    if (!jsonDirty.value)
      jsonText.value = JSON.stringify(colors, null, 2)
  }

  function resetAll() {
    setDraft(softFrostPalette())
    status.value = '已在草稿中恢复全部柔雾预设，尚未保存。'
  }

  function importJson() {
    const parsed = parsePaletteJson(jsonText.value)
    if (!parsed.ok) {
      jsonError.value = parsed.error
      return
    }
    setDraft({ preset: 'custom', colors: parsed.colors })
    status.value = parsed.ignoredKeys ? `已导入十个颜色，忽略 ${parsed.ignoredKeys} 个非配色键。` : '已导入草稿，尚未保存。'
  }

  async function copyJson() {
    try {
      await navigator.clipboard.writeText(JSON.stringify(draft.value.colors, null, 2))
      status.value = '已复制十键配色，不包含站点设置或会话资料。'
    }
    catch { status.value = '无法自动复制，请在 JSON 文本框中手动选择并复制。' }
  }

  function cancel() {
    operation++
    invalidatePaletteAdminSession()
    app.closePaletteEditor()
    void nextTick(() => document.querySelector<HTMLButtonElement>('[data-testid="palette-entry"]')?.focus())
  }

  function applyLocal() {
    if (invalid.value || busy.value)
      return
    const saved = app.applyLocalPalette(draft.value)
    app.paletteNotice = saved ? '已套用到此浏览器；站点默认配色未改变。' : '已套用到当前页面，但浏览器禁止保存偏好；重新打开后可能恢复站点配色。'
    cancel()
  }

  function followSite() {
    if (busy.value)
      return
    const saved = app.followSitePalette()
    app.paletteNotice = saved ? '已跟随站点配色。' : '当前页面已跟随站点配色，但未能删除浏览器中的旧偏好。'
    cancel()
  }

  async function loadSite() {
    if (busy.value)
      return
    const currentOperation = ++operation
    busy.value = true
    confirmation.value = false
    try {
      if (!await app.verifyLoginState({ force: true }))
        throw new Error('请先登录后台，再验证全站配色管理权限。')
      if (currentOperation !== operation)
        return
      const snapshot = await loadSitePalette()
      if (currentOperation !== operation)
        return
      siteBaseline.value = snapshot
      scope.value = 'site'
      setDraft(snapshot.palette)
      app.publicSettings = snapshot.publicSettings
      pendingConfirmation.value = false
      status.value = '已读取最新站点配色。此草稿来自站点，不是本机覆盖；保存需另行确认。'
    }
    catch (error) {
      if (currentOperation === operation)
        status.value = error instanceof Error ? error.message : '无法读取站点配色。'
    }
    finally {
      if (currentOperation === operation)
        busy.value = false
    }
  }

  function editLocal() {
    operation++
    invalidatePaletteAdminSession()
    busy.value = false
    siteBaseline.value = null
    pendingConfirmation.value = false
    scope.value = 'local'
    setDraft(app.appliedLocalPalette ?? app.managedPalette)
    status.value = '正在编辑本机草稿，不会修改站点默认。'
  }

  function copyLocalToSite() {
    if (app.appliedLocalPalette && siteBaseline.value && !busy.value) {
      setDraft(app.appliedLocalPalette)
      status.value = '已复制本机配色到全站草稿，尚未保存。'
    }
  }

  async function saveSite() {
    if (!siteBaseline.value || invalid.value || busy.value || pendingConfirmation.value || !confirmation.value)
      return
    const currentOperation = ++operation
    busy.value = true
    try {
      const snapshot = await saveSitePalette(siteBaseline.value, clonePalette(draft.value))
      if (currentOperation !== operation)
        return
      app.publicSettings = snapshot.publicSettings
      app.paletteNotice = app.appliedLocalPalette ? '全站配色已保存并核对；本浏览器仍使用本机覆盖。' : '全站配色已保存并核对。'
      cancel()
    }
    catch (error) {
      if (currentOperation === operation) {
        status.value = error instanceof Error ? error.message : '保存失败，草稿保留。'
        pendingConfirmation.value = error instanceof PaletteSaveError && error.pendingConfirmation
        confirmation.value = false
        if (error instanceof PaletteSaveError && (error.status === 401 || error.status === 403)) {
          editLocal()
          status.value = '管理权限失效，全站草稿已撤销。请重新登录并读取站点配色。'
        }
      }
    }
    finally {
      if (currentOperation === operation)
        busy.value = false
    }
  }

  watch(() => app.authSessionRevision, () => {
    if (siteBaseline.value || scope.value === 'site') {
      editLocal()
      status.value = '登录会话已变更，全站草稿已撤销；本机设置未改变。'
    }
  }, { flush: 'sync' })
  onScopeDispose(() => {
    operation++
    invalidatePaletteAdminSession()
  })
  setDraft(draft.value)
  return {
    app,
    group,
    field,
    fields,
    scope,
    draft,
    selectedKey,
    selectedInput,
    pickerColor,
    jsonText,
    jsonDirty,
    jsonError,
    status,
    busy,
    pendingConfirmation,
    confirmation,
    invalid,
    setPreset,
    updateInput,
    normalizeInput,
    resetGroup,
    resetAll,
    importJson,
    copyJson,
    cancel,
    applyLocal,
    followSite,
    loadSite,
    editLocal,
    copyLocalToSite,
    saveSite,
  }
}
