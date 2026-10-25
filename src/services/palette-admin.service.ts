import type { PublicSettings } from '@/utils/api'
import type { PaletteConfig } from '@/utils/paletteColors'
import { getAuthSessionRevision, isAuthenticated, verifyLogin } from '@/services/auth.service'
import { requestManager } from '@/services/request.service'
import { enqueueThemeSettingsSave, parseThemeSettingsForSave, settingsValueEqual } from '@/services/theme-settings-save.service'
import { resolveManagedPalette } from '@/utils/glassTheme'
import { isGlassColorPreset, PALETTE_PRESET_VALUES, paletteEquals, parseGlassColorPreset, parseManagedGlassColors, parsePaletteColors } from '@/utils/paletteColors'

const THEME = 'glassmorphism-plus'
let generation = 0
let sequence = 0
const activeKeys = new Set<string>()

export class PaletteSaveError extends Error {
  constructor(message: string, readonly status?: number, readonly pendingConfirmation = false) {
    super(message)
    this.name = 'PaletteSaveError'
  }
}

export interface SitePaletteSnapshot {
  palette: PaletteConfig
  publicSettings: PublicSettings
  settings: Record<string, unknown>
  sessionRevision: number
  generation: number
}

export function invalidatePaletteAdminSession(): void {
  generation++
  for (const key of activeKeys)
    requestManager.abort(key)
  activeKeys.clear()
}

function assertContext(expectedGeneration: number, revision: number): void {
  if (expectedGeneration !== generation || revision !== getAuthSessionRevision() || !isAuthenticated())
    throw new PaletteSaveError('管理会话已变更，请重新验证权限并读取站点配色。', 401)
}

async function jsonRequest(path: string, signal: AbortSignal, body?: Record<string, unknown>): Promise<unknown> {
  const response = await fetch(path, {
    method: body ? 'POST' : 'GET',
    credentials: 'same-origin',
    cache: 'no-store',
    signal,
    ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}),
  })
  if (!response.ok)
    throw new PaletteSaveError(`请求失败（${response.status}），未确认保存。`, response.status)
  let payload: unknown
  try {
    payload = await response.json()
  }
  catch {
    throw new PaletteSaveError('服务器未返回有效 JSON，未确认保存。')
  }
  if (payload && typeof payload === 'object' && 'status' in payload) {
    if (payload.status === 'error')
      throw new PaletteSaveError('服务器拒绝请求，未确认保存。')
    if (payload.status === 'success' && 'data' in payload)
      return payload.data
  }
  return payload
}

async function probeAdmin(signal: AbortSignal): Promise<void> {
  // Fixed Komari router protects this endpoint with RoleAdmin. Discard the data;
  // it is a permission probe, not a palette source. No polling is installed.
  if (!Array.isArray(await jsonRequest('/api/admin/ping', signal)))
    throw new PaletteSaveError('未能确认管理权限，已停止全站操作。')
}

async function readSnapshot(signal: AbortSignal, revision: number, expectedGeneration: number): Promise<SitePaletteSnapshot> {
  const value = await jsonRequest('/api/public', signal)
  assertContext(expectedGeneration, revision)
  if (!value || typeof value !== 'object' || !('theme' in value) || value.theme !== THEME)
    throw new PaletteSaveError('当前主题已切换或无法确认，请重新打开配色中心。')
  const publicSettings = value as PublicSettings
  const settings = parseThemeSettingsForSave(publicSettings.theme_settings)
  return { publicSettings, settings, palette: resolveManagedPalette(settings), sessionRevision: revision, generation: expectedGeneration }
}

async function run<T>(task: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const key = `palette-admin:${generation}:${++sequence}`
  activeKeys.add(key)
  try {
    return await requestManager.run(key, task, { timeout: 25_000, retryAttempts: 0, shouldRetry: () => false })
  }
  finally {
    activeKeys.delete(key)
  }
}

export async function loadSitePalette(): Promise<SitePaletteSnapshot> {
  const requestedGeneration = generation
  const session = await verifyLogin({ force: true })
  if (!session.authenticated || requestedGeneration !== generation)
    throw new PaletteSaveError('请先登录后台，再验证全站配色管理权限。', 401)
  const revision = getAuthSessionRevision()
  return run(async (signal) => {
    assertContext(requestedGeneration, revision)
    await probeAdmin(signal)
    return readSnapshot(signal, revision, requestedGeneration)
  })
}

/** Editor eligibility only; public viewing needs no probe. Editing/saving revalidate independently. */
export async function verifyPaletteAdminAccess(): Promise<number> {
  const requestedGeneration = generation
  const session = await verifyLogin()
  if (!session.authenticated || requestedGeneration !== generation)
    throw new PaletteSaveError('请先登录后台。', 401)
  const revision = getAuthSessionRevision()
  await run(async (signal) => {
    assertContext(requestedGeneration, revision)
    await probeAdmin(signal)
    assertContext(requestedGeneration, revision)
  })
  return revision
}

function colorSettingsEqual(left: Record<string, unknown>, right: Record<string, unknown>): boolean {
  return paletteEquals(
    { preset: parseGlassColorPreset(left.glassColorPreset), colors: parseManagedGlassColors(left) },
    { preset: parseGlassColorPreset(right.glassColorPreset), colors: parseManagedGlassColors(right) },
  )
}

function unrelatedSettings(settings: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(settings).filter(([key]) => key !== 'glassColorPreset' && key !== 'glassCustomColors'))
}

export async function saveSitePalette(baseline: SitePaletteSnapshot, draft: PaletteConfig): Promise<SitePaletteSnapshot> {
  const parsed = parsePaletteColors(draft.colors)
  if (!parsed.ok || !isGlassColorPreset(draft.preset))
    throw new PaletteSaveError(parsed.ok ? '配色方案无效。' : parsed.error)
  const requested = { preset: draft.preset, colors: parsed.colors }
  let postStarted = false
  try {
    return await enqueueThemeSettingsSave(async () => {
      assertContext(baseline.generation, baseline.sessionRevision)
      await verifyLogin({ force: true })
      assertContext(baseline.generation, baseline.sessionRevision)
      return run(async (signal) => {
        await probeAdmin(signal)
        const fresh = await readSnapshot(signal, baseline.sessionRevision, baseline.generation)
        if (!colorSettingsEqual(baseline.settings, fresh.settings))
          throw new PaletteSaveError('站点配色已被其他操作修改。请重新读取站点配色后再编辑；当前草稿未提交。')
        const merged = {
          ...fresh.settings,
          glassColorPreset: PALETTE_PRESET_VALUES[requested.preset],
          ...(requested.preset === 'custom' ? { glassCustomColors: JSON.stringify(requested.colors) } : {}),
        }
        assertContext(baseline.generation, baseline.sessionRevision)
        postStarted = true
        await jsonRequest(`/api/admin/theme/settings?theme=${encodeURIComponent(THEME)}`, signal, merged)
        const readback = await readSnapshot(signal, baseline.sessionRevision, baseline.generation)
        if (!colorSettingsEqual(merged, readback.settings)
          || !settingsValueEqual(unrelatedSettings(merged), unrelatedSettings(readback.settings))) {
          throw new PaletteSaveError('读回配色或其他设置与提交内容不一致。')
        }
        return readback
      })
    })
  }
  catch (error) {
    if (postStarted && !(error instanceof PaletteSaveError && (error.status === 401 || error.status === 403)))
      throw new PaletteSaveError('保存结果待确认：请求可能已经提交，请重新读取站点配色核对，不要重复提交。', undefined, true)
    throw error
  }
}
