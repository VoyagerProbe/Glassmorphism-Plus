import type { SitePaletteSnapshot } from '@/services/palette-admin.service'
import type { GlassColorKey, GlassColorPreset, PaletteConfig, RgbaBytes } from '@/utils/paletteColors'
import { computed, nextTick, onScopeDispose, ref, watch } from 'vue'
import { invalidatePaletteAdminSession, loadSitePalette, PaletteSaveError, saveSitePalette } from '@/services/palette-admin.service'
import { useAppStore } from '@/stores/app'
import { paletteForPreset } from '@/utils/glassTheme'
import { clonePalette, GLASS_COLOR_KEYS, paletteEquals, parseAlphaPercent, parseHexColor, parsePaletteJson, parseRgbColor, serializeColor } from '@/utils/paletteColors'

export type PaletteChoice = GlassColorPreset
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

function confirmPaletteAction(message: string): boolean {
  // Only explicit user actions reach this browser-owned confirmation. It stays
  // readable even when the user's preview makes application text invisible.
  // eslint-disable-next-line no-alert -- intentional single, native confirmation; no startup or background prompts
  return window.confirm(message)
}

export function usePaletteEditor() {
  const app = useAppStore()
  const group = ref<'light' | 'dark'>(app.resolvedThemeMode)
  const field = ref<keyof typeof FIELD_NAMES>('Card')
  const draft = computed(() => app.paletteDraft ?? app.managedPalette)
  const selectedPreset = computed<PaletteChoice>(() => draft.value.preset)
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
  const savingSite = ref(false)
  let operation = 0
  const invalid = computed(() => jsonDirty.value || Object.values(inputs.value).some(input => Object.keys(input.errors).length > 0))
  const ready = computed(() => Boolean(siteBaseline.value) && app.paletteOpen && app.paletteAdminAllowed)
  const dirty = computed(() => Boolean(siteBaseline.value) && (invalid.value || !paletteEquals(siteBaseline.value!.palette, draft.value)))

  function resetInputs(keys: readonly GlassColorKey[] = GLASS_COLOR_KEYS) {
    for (const key of keys)
      inputs.value[key] = inputsFor(draft.value.colors[key])
  }

  function setDraft(palette: PaletteConfig) {
    app.paletteDraft = clonePalette(palette)
    resetInputs()
    jsonText.value = JSON.stringify(palette.colors, null, 2)
    jsonDirty.value = false
    jsonError.value = ''
  }

  function setPreset(preset: PaletteChoice) {
    if (!ready.value || busy.value)
      return
    setDraft(paletteForPreset(preset, draft.value.colors))
  }

  function updateInput(kind: InputKind, value: string) {
    if (!ready.value || busy.value)
      return
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

  function importJson() {
    if (!ready.value || busy.value)
      return
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
    if (savingSite.value || pendingConfirmation.value)
      app.paletteNotice = '全站保存结果待确认；关闭不能撤回已发送请求，请稍后重新读取站点配色核对。'
    operation++
    invalidatePaletteAdminSession()
    app.closePaletteEditor()
    void nextTick(() => document.querySelector<HTMLButtonElement>('[data-testid="palette-entry"]')?.focus())
  }

  async function loadSite() {
    if (busy.value || !app.paletteOpen || !app.paletteAdminAllowed)
      return
    const currentOperation = ++operation
    busy.value = true
    siteBaseline.value = null
    app.paletteDraft = null
    try {
      const snapshot = await loadSitePalette()
      await app.verifyLoginState()
      if (currentOperation !== operation || !app.paletteOpen || !app.paletteAdminAllowed)
        return
      siteBaseline.value = snapshot
      setDraft(snapshot.palette)
      app.publicSettings = snapshot.publicSettings
      pendingConfirmation.value = false
      status.value = '已验证管理权限，正在编辑全站默认配色。'
    }
    catch (error) {
      if (currentOperation === operation) {
        status.value = error instanceof Error ? error.message : '无法读取站点配色。'
        if (error instanceof PaletteSaveError && (error.status === 401 || error.status === 403)) {
          app.paletteNotice = '管理权限失效，配色草稿已撤销。'
          app.revokePaletteAccess()
        }
      }
    }
    finally {
      if (currentOperation === operation)
        busy.value = false
    }
  }

  async function reloadSite() {
    if (!busy.value && (!dirty.value || confirmPaletteAction('重新读取将放弃未保存的草稿，是否继续？')))
      await loadSite()
  }

  async function saveSite() {
    if (!ready.value || !siteBaseline.value || !dirty.value || invalid.value || busy.value || pendingConfirmation.value)
      return
    if (!confirmPaletteAction('保存全站配色？这会更新站点默认配色，其他浏览器正常刷新或重新打开后可见。'))
      return
    const currentOperation = ++operation
    busy.value = true
    savingSite.value = true
    try {
      const snapshot = await saveSitePalette(siteBaseline.value, clonePalette(draft.value))
      if (currentOperation !== operation)
        return
      app.publicSettings = snapshot.publicSettings
      app.paletteNotice = '全站配色已保存。'
      savingSite.value = false
      cancel()
    }
    catch (error) {
      if (currentOperation === operation) {
        savingSite.value = false
        status.value = error instanceof Error ? error.message : '保存失败，草稿保留。'
        pendingConfirmation.value = error instanceof PaletteSaveError && error.pendingConfirmation
        if (error instanceof PaletteSaveError && (error.status === 401 || error.status === 403)) {
          app.paletteNotice = '管理权限失效，全站草稿已撤销。请重新登录并读取站点配色。'
          app.revokePaletteAccess()
        }
      }
    }
    finally {
      savingSite.value = false
      if (currentOperation === operation)
        busy.value = false
    }
  }

  watch(() => app.authSessionRevision, () => {
    cancel()
  }, { flush: 'sync' })
  watch(() => app.paletteAdminAllowed, (allowed) => {
    if (!allowed)
      cancel()
  }, { flush: 'sync' })
  onScopeDispose(() => {
    if (savingSite.value || pendingConfirmation.value)
      app.paletteNotice = '全站保存结果待确认；关闭不能撤回已发送请求，请稍后重新读取站点配色核对。'
    operation++
    invalidatePaletteAdminSession()
    app.closePaletteEditor()
  })
  // Loading may render the current safe managed values, but never exposes them
  // as an editable/savable baseline until the fresh authorized read succeeds.
  resetInputs()
  void loadSite()
  return {
    app,
    group,
    field,
    fields,
    draft,
    selectedPreset,
    selectedKey,
    selectedInput,
    pickerColor,
    jsonText,
    jsonDirty,
    jsonError,
    status,
    busy,
    pendingConfirmation,
    invalid,
    ready,
    dirty,
    setPreset,
    updateInput,
    normalizeInput,
    importJson,
    copyJson,
    cancel,
    reloadSite,
    saveSite,
  }
}
