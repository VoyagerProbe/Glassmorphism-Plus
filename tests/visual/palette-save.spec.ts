import { resolve } from 'node:path'
import { expect, test } from '@playwright/test'
import { createServer } from 'vite'
import { inspectNodeCardPingConfig } from '../../src/utils/nodeCardPingConfig'

type PaletteService = typeof import('../../src/services/palette-admin.service')
type AuthService = typeof import('../../src/services/auth.service')
type PingService = typeof import('../../src/services/node-card-ping-binding.service')
type QueueService = typeof import('../../src/services/theme-settings-save.service')
type ColorHelpers = typeof import('../../src/utils/paletteColors')
let palette: PaletteService
let auth: AuthService
let ping: PingService
let queue: QueueService
let colors: ColorHelpers
let close: () => Promise<void>
let settings: Record<string, unknown>
let theme = 'glassmorphism-plus'
let permission = 200
let publicOverride: unknown
let postCount = 0
let postFailure = false
let readbackFailure = false
let publicGate: Promise<void> | undefined
const calls: string[] = []
const originalFetch = globalThis.fetch
const identity = { logged_in: true, username: 'synthetic-palette-admin', uuid: '00000000-0000-4000-8000-000000000001' }

test.beforeAll(async () => {
  const server = await createServer({ appType: 'custom', configFile: false, envDir: false, logLevel: 'silent', optimizeDeps: { noDiscovery: true }, root: process.cwd(), resolve: { alias: { '@': resolve(process.cwd(), 'src') } }, server: { middlewareMode: true } })
  palette = await server.ssrLoadModule('/src/services/palette-admin.service.ts') as PaletteService
  auth = await server.ssrLoadModule('/src/services/auth.service.ts') as AuthService
  ping = await server.ssrLoadModule('/src/services/node-card-ping-binding.service.ts') as PingService
  queue = await server.ssrLoadModule('/src/services/theme-settings-save.service.ts') as QueueService
  colors = await server.ssrLoadModule('/src/utils/paletteColors.ts') as ColorHelpers
  close = () => server.close()
})

test.beforeEach(() => {
  theme = 'glassmorphism-plus'
  permission = 200
  publicOverride = undefined
  postCount = 0
  postFailure = false
  readbackFailure = false
  publicGate = undefined
  calls.length = 0
  settings = {
    glassColorPreset: '柔雾',
    glassCustomColors: JSON.stringify(colors.SOFT_FROST_COLORS),
    themeMode: 'beijing',
    unknownFuture: { keep: [null, 0, false, { nested: 'synthetic' }] },
    nodeCardPingTaskBindings: '{}',
    backgroundEnabled: true,
  }
  auth.setAuthSessionFromLogin(true, identity)
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const path = String(input)
    calls.push(`${init?.method ?? 'GET'} ${path}`)
    const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } })
    if (path.endsWith('/me'))
      return json(identity)
    if (path === '/api/admin/ping')
      return json(permission === 200 ? { status: 'success', data: [{ id: 101, clients: [], name: 'Synthetic', interval: 60 }] } : {}, permission)
    if (path === '/api/admin/client/list')
      return json([])
    if (path.endsWith('/rpc2')) {
      const request = JSON.parse(String(init?.body))
      return json({ jsonrpc: '2.0', id: request.id, result: { tasks: [{ id: 101, name: 'Synthetic', interval: 60 }] } })
    }
    if (path === '/api/public') {
      await publicGate
      if (postCount && readbackFailure)
        throw new Error('Synthetic readback failure')
      return json({ status: 'success', data: { theme, theme_settings: publicOverride ?? settings } })
    }
    if (path.startsWith('/api/admin/theme/settings?')) {
      postCount++
      if (postFailure)
        throw new Error('Synthetic response lost after send')
      settings = JSON.parse(String(init?.body))
      return json({ status: 'success' })
    }
    throw new Error(`Unexpected fixture request: ${path}`)
  }) as typeof fetch
})

test.afterEach(() => {
  palette.invalidatePaletteAdminSession()
  ping.invalidateNodeCardPingBindingAdminSession()
  globalThis.fetch = originalFetch
})
test.afterAll(async () => close())

test('full-object reader rejects malformed/absent settings instead of erasing unknown fields', async () => {
  for (const raw of ['{', 'null', '[]', '123', null, undefined, []])
    expect(() => queue.parseThemeSettingsForSave(raw)).toThrow()
  const hostile = queue.parseThemeSettingsForSave('{"__proto__":{"polluted":true},"future":{"x":1}}')
  expect(Object.hasOwn(hostile, '__proto__')).toBe(true)
  expect(({} as Record<string, unknown>).polluted).toBeUndefined()
  expect(queue.settingsValueEqual({ b: [null, 0], a: true }, { a: true, b: [null, 0] })).toBe(true)
  publicOverride = '{broken'
  await expect(palette.loadSitePalette()).rejects.toThrow('JSON')
  expect(postCount).toBe(0)
})

test('permission, theme, and concurrent color changes stop before POST', async () => {
  permission = 403
  await expect(palette.loadSitePalette()).rejects.toMatchObject({ status: 403 })
  expect(calls.some(call => call.includes('/api/public'))).toBe(false)
  permission = 200
  const snapshot = await palette.loadSitePalette()
  theme = 'another-theme'
  await expect(palette.saveSitePalette(snapshot, colors.softFrostPalette())).rejects.toThrow('主题已切换')
  theme = 'glassmorphism-plus'
  settings.glassCustomColors = JSON.stringify({ ...colors.SOFT_FROST_COLORS, darkText: '#112233' })
  await expect(palette.saveSitePalette(snapshot, colors.softFrostPalette())).rejects.toThrow('其他操作')
  expect(postCount).toBe(0)
})

test('preset-only saves retain original custom JSON; custom saves write exactly ten safe keys', async () => {
  settings.glassCustomColors = ' { "lightText": "#345678" } '
  let baseline = await palette.loadSitePalette()
  const original = settings.glassCustomColors
  await palette.saveSitePalette(baseline, colors.softFrostPalette())
  expect(settings.glassCustomColors).toBe(original)
  baseline = await palette.loadSitePalette()
  await palette.saveSitePalette(baseline, { preset: 'custom', colors: { ...colors.SOFT_FROST_COLORS, lightText: '#123456E6' } })
  expect(settings.glassColorPreset).toBe('自定义')
  expect(Object.keys(JSON.parse(String(settings.glassCustomColors)))).toEqual([...colors.GLASS_COLOR_KEYS])
  expect(settings.themeMode).toBe('beijing')
  expect(settings.unknownFuture).toEqual({ keep: [null, 0, false, { nested: 'synthetic' }] })
})

for (const lostResponse of [true, false]) {
  test(`uncertain ${lostResponse ? 'POST' : 'readback'} is pending confirmation with one submission`, async () => {
    const baseline = await palette.loadSitePalette()
    postFailure = lostResponse
    readbackFailure = !lostResponse
    await expect(palette.saveSitePalette(baseline, colors.softFrostPalette())).rejects.toMatchObject({ pendingConfirmation: true })
    expect(postCount).toBe(1)
  })
}

test('identity change invalidates queued and in-flight manager responses without global aborts', async () => {
  const baseline = await palette.loadSitePalette()
  let release!: () => void
  publicGate = new Promise<void>((resolve) => {
    release = resolve
  })
  const loading = palette.loadSitePalette()
  await expect.poll(() => calls.filter(call => call === 'GET /api/public').length).toBe(2)
  auth.setAuthSessionFromLogin(false)
  release()
  await expect(loading).rejects.toMatchObject({ status: 401 })
  await expect(palette.saveSitePalette(baseline, colors.softFrostPalette())).rejects.toMatchObject({ status: 401 })
  expect(postCount).toBe(0)
})

test('Palette and Ping share serialization and merge fresh unknown settings in either order', async () => {
  for (const paletteFirst of [true, false]) {
    const baseline = await palette.loadSitePalette()
    const savePalette = () => palette.saveSitePalette(baseline, { preset: 'custom', colors: { ...colors.SOFT_FROST_COLORS, lightText: '#233445' } })
    const savePing = () => ping.saveNodeCardPingDisplayConfigV3({ theme, config: { schemaVersion: 3, global: { threeNetworkEnabled: false, taskIds: [101, null, null] }, nodes: {} } })
    const results = paletteFirst ? [savePalette(), savePing()] : [savePing(), savePalette()]
    await Promise.all(results)
    expect(JSON.parse(String(settings.glassCustomColors)).lightText).toBe('#233445')
    expect(inspectNodeCardPingConfig(settings.nodeCardPingDisplayConfigV3).config?.global.taskIds).toEqual([101, null, null])
    expect(settings.unknownFuture).toEqual({ keep: [null, 0, false, { nested: 'synthetic' }] })
    expect(settings.nodeCardPingTaskBindings).toBe('{}')
  }
  expect(postCount).toBe(4)
})

test('save coordinator bounds pending work and continues after a failed operation', async () => {
  let release!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  const order: number[] = []
  const tasks = Array.from({ length: 8 }, (_, index) => queue.enqueueThemeSettingsSave(async () => {
    await gate
    order.push(index)
    if (index === 3)
      throw new Error('Synthetic save failure')
    return index
  }))
  await expect(queue.enqueueThemeSettingsSave(async () => 99)).rejects.toThrow('队列已满')
  release()
  const settled = await Promise.allSettled(tasks)
  expect(order).toEqual([0, 1, 2, 3, 4, 5, 6, 7])
  expect(settled.filter(item => item.status === 'rejected')).toHaveLength(1)
  await expect(queue.enqueueThemeSettingsSave(async () => 10)).resolves.toBe(10)
})
