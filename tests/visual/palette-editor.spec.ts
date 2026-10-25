import type { Page } from '@playwright/test'
import { expect, test } from '@playwright/test'
import { installKomariFixture, PRIMARY_NODE_UUID } from './fixtures/komari'
import { CUSTOM_COLORS } from './fixtures/palette'

const STORAGE_KEY = 'glassmorphism-plus:palette:v1:%2F'
const config = JSON.stringify({ schemaVersion: 3, global: { threeNetworkEnabled: true, taskIds: [101, 202, 303] }, nodes: {} })
const fields = ['Card', 'Control', 'Text', 'MutedText', 'Border'] as const

async function setup(page: Page, admin = true, dark = false) {
  const fixture = await installKomariFixture(page, { themeShort: 'glassmorphism-plus', adminAccess: admin ? 'admin' : 'guest', hideEarth: true, nodeCount: 3, dark, preserveStorageOnReload: true, nodeCardPingDisplayConfigV3: config, nodeCardPingFixture: { thirdSharedTask: true } })
  fixture.setThemeSetting('glassColorPreset', '自定义')
  fixture.setThemeSetting('glassCustomColors', JSON.stringify(CUSTOM_COLORS))
  fixture.setThemeSetting('futureOpaqueSetting', { list: [1, false, null], nested: { preserve: 'fixture-only' } })
  await page.goto('/?retained=palette-test')
  await expect(page.locator('.node-card')).toHaveCount(3)
  return fixture
}

async function open(page: Page) {
  await page.getByTestId('palette-entry').click()
  await expect(page.getByTestId('palette-panel')).toBeVisible()
  await expect(page.getByTestId('palette-status')).toContainText('已验证管理权限')
  await expect(page.locator('#palette-heading')).toBeFocused()
}

async function syncSession(page: Page) {
  await page.evaluate(async () => {
    const app = (document.querySelector('#app') as any).__vue_app__.config.globalProperties.$pinia._s.get('app')
    await app.verifyLoginState({ force: true })
  })
}

test('guests and denied sessions cannot open an editable palette, including direct internal calls', async ({ page }) => {
  const requests: string[] = []
  page.on('request', request => requests.push(request.url()))
  const fixture = await setup(page, false)
  await expect(page.getByTestId('palette-entry')).toHaveCount(0)
  expect(requests.filter(url => url.includes('/api/admin/'))).toEqual([])
  const tryOpen = () => page.evaluate(() => (document.querySelector('#app') as any).__vue_app__.config.globalProperties.$pinia._s.get('app').openPaletteEditor())
  await tryOpen()
  await expect(page.getByTestId('palette-panel')).toHaveCount(0)
  fixture.setAdminAccess('forbidden')
  await syncSession(page)
  await expect.poll(() => requests.filter(url => url.endsWith('/api/admin/ping')).length).toBe(1)
  await expect(page.getByTestId('palette-entry')).toHaveCount(0)
  await tryOpen()
  await expect(page.getByTestId('palette-panel')).toHaveCount(0)
  expect(fixture.getThemeSaveCount()).toBe(0)
})

test('compact site editor has five swatch radio choices and presets, keyboard navigation and only cancel/save', async ({ page }) => {
  const fixture = await setup(page)
  await open(page)
  await expect(page.getByTestId('palette-scope')).toHaveCount(0)
  await expect(page.getByTestId('palette-field')).toHaveCount(0)
  expect((await page.getByRole('radio').allTextContents()).map(text => text.trim())).toEqual(['卡片', '控制区', '主文字', '次文字', '边框'])
  expect(await page.getByTestId('palette-preset').locator('option').allTextContents()).toEqual(['翡翠', '柔和', '高对比', '午夜', '自定义'])
  expect((await page.locator('.palette-footer button').allTextContents()).map(text => text.trim())).toEqual(['取消', '保存'])
  await expect(page.locator('.palette-advanced')).not.toHaveAttribute('open', '')
  await expect(page.getByTestId('palette-save-site')).toBeDisabled()
  const calls = fixture.timeline.length
  await page.getByTestId('palette-field-Card').focus()
  for (const [key, field] of [['ArrowRight', 'Control'], ['End', 'Border'], ['Space', 'Border'], ['Home', 'Card'], ['Enter', 'Card']]) {
    await page.keyboard.press(key!)
    await expect(page.getByTestId(`palette-field-${field}`)).toBeFocused()
    await expect(page.getByTestId(`palette-field-${field}`)).toHaveAttribute('aria-checked', 'true')
  }
  expect(fixture.timeline.length).toBe(calls)
  expect(fixture.getThemeSaveCount()).toBe(0)
  expect(await page.getByRole('radio').evaluateAll(buttons => buttons.every(button => button.getAttribute('type') === 'button' && button.querySelector('.palette-swatch')?.getAttribute('aria-hidden') === 'true'))).toBe(true)
})

test('every retired personal record is ignored without mutation, including storage events and matching managed custom', async ({ page }) => {
  await page.addInitScript((key) => {
    const host = window as any
    host.retiredPaletteAccess = []
    for (const method of ['getItem', 'setItem', 'removeItem'] as const) {
      const original = Storage.prototype[method]
      Storage.prototype[method] = function (name: string, value?: string) {
        if (name === key)
          host.retiredPaletteAccess.push(method)
        return original.call(this, name, value!)
      }
    }
  }, STORAGE_KEY)
  const fixture = await setup(page)
  const records = [null, '{', '[]', JSON.stringify({ schemaVersion: 99, preset: 'custom', colors: CUSTOM_COLORS }), ...['custom', 'soft', 'softFrost', '柔雾', '柔霧'].map(preset => JSON.stringify({ schemaVersion: 1, preset, colors: { ...CUSTOM_COLORS, lightText: '#123456' } })), JSON.stringify({ schemaVersion: 1, preset: 'custom', colors: CUSTOM_COLORS })]
  const mode = await page.evaluate(() => localStorage.getItem('themeMode'))
  await page.evaluate(() => {
    localStorage.setItem('unrelated-palette-sentinel', 'retained')
    localStorage.setItem('theme:favorite-nodes:v1', JSON.stringify(['synthetic-favorite']))
  })
  for (const raw of records) {
    await page.evaluate(({ key, raw }) => raw === null ? localStorage.removeItem(key) : localStorage.setItem(key, raw), { key: STORAGE_KEY, raw })
    await page.reload()
    await open(page)
    await page.getByTestId('palette-field-Text').click()
    await expect(page.locator('#palette-hex')).toHaveValue('#111111')
    await page.evaluate(({ key, raw }) => window.dispatchEvent(new StorageEvent('storage', { key, newValue: raw, storageArea: localStorage })), { key: STORAGE_KEY, raw })
    await expect(page.locator('.node-card').first()).toHaveCSS('color', 'rgb(17, 17, 17)')
    await page.keyboard.press('Escape')
    expect(await page.evaluate(() => (window as any).retiredPaletteAccess)).toEqual([])
    expect(await page.evaluate(key => localStorage.getItem(key), STORAGE_KEY)).toBe(raw)
  }
  expect(await page.evaluate(() => localStorage.getItem('unrelated-palette-sentinel'))).toBe('retained')
  expect(await page.evaluate(() => localStorage.getItem('theme:favorite-nodes:v1'))).toBe(JSON.stringify(['synthetic-favorite']))
  expect(await page.evaluate(() => localStorage.getItem('themeMode'))).toBe(mode)
  expect(fixture.getThemeSaveCount()).toBe(0)
})

test('preview keeps alpha, invalid raw input, selected fields, swatches, page mode and monitoring state', async ({ page }) => {
  const fixture = await setup(page)
  await open(page)
  const mode = await page.evaluate(() => localStorage.getItem('themeMode'))
  await page.getByRole('button', { name: '编辑深色', exact: true }).click()
  await expect(page.locator('#palette-hex')).toHaveValue('#1E2732E6')
  await page.locator('#palette-rgb').fill('RGB(11, 22, 33)')
  await expect(page.locator('#palette-hex')).toHaveValue('#0B1621E6')
  await page.locator('#palette-hex').fill('#ABCDEF')
  await page.locator('#palette-hex').blur()
  await expect(page.locator('#palette-hex')).toHaveValue('#ABCDEFE6')
  await page.locator('#palette-rgb').fill('rgb(999,0,0)')
  await expect(page.getByTestId('palette-save-site')).toBeDisabled()
  await page.getByTestId('palette-field-Text').click()
  await page.getByTestId('palette-field-Card').click()
  await expect(page.locator('#palette-rgb')).toHaveValue('rgb(999,0,0)')
  await expect(page.locator('#palette-hex')).toHaveValue('#ABCDEFE6')
  await page.locator('#palette-rgb').fill('rgb(1,2,3)')
  await page.locator('#palette-alpha').fill('0')
  await expect(page.getByTestId('palette-field-Card').locator('.palette-swatch')).toHaveCSS('background-color', 'rgba(1, 2, 3, 0)')
  await expect(page.getByTestId('palette-field-Card').locator('.palette-swatch')).toHaveCSS('width', '14px')
  await page.getByTestId('palette-field-Border').click()
  await page.getByRole('button', { name: '编辑浅色', exact: true }).click()
  await expect(page.getByTestId('palette-field-Border')).toHaveAttribute('aria-checked', 'true')
  await expect(page.locator('#palette-hex')).toHaveValue('#102A431F')
  await page.getByTestId('palette-preset').selectOption('midnight')
  await expect(page.getByTestId('palette-field-Border')).toHaveAttribute('aria-checked', 'true')
  for (const key of fields) {
    await page.getByTestId(`palette-field-${key}`).click()
    const color = await page.locator('#palette-hex').inputValue()
    expect(await page.getByTestId(`palette-field-${key}`).locator('.palette-swatch').evaluate((e, value) => {
      const probe = document.createElement('i')
      probe.style.backgroundColor = value
      document.body.append(probe)
      const equal = getComputedStyle(e).backgroundColor === getComputedStyle(probe).backgroundColor
      probe.remove()
      return equal
    }, color)).toBe(true)
  }
  expect(await page.evaluate(() => localStorage.getItem('themeMode'))).toBe(mode)
  const calls = fixture.timeline.length
  for (let index = 0; index < 12; index++)
    await page.locator('#palette-hex').fill(index % 2 ? '#112233E6' : '#445566E6')
  expect(fixture.timeline.length).toBe(calls)
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('palette-entry')).toBeFocused()
  expect(await page.evaluate(key => localStorage.getItem(key), STORAGE_KEY)).toBeNull()
  expect(new URL(page.url()).searchParams.get('retained')).toBe('palette-test')
})

test('cancel reveals current managed values and external refresh does not erase invalid draft', async ({ page }) => {
  await setup(page)
  await open(page)
  await page.locator('#palette-hex').fill('#12345680')
  await page.locator('#palette-rgb').fill('invalid')
  await page.evaluate(() => {
    const app = (document.querySelector('#app') as any).__vue_app__.config.globalProperties.$pinia._s.get('app')
    app.publicSettings = { ...app.publicSettings, theme_settings: { ...app.publicSettings.theme_settings, glassColorPreset: '午夜' } }
  })
  await expect(page.locator('#palette-rgb')).toHaveValue('invalid')
  await expect(page.getByTestId('palette-save-site')).toBeDisabled()
  await page.keyboard.press('Escape')
  await page.mouse.move(0, 0)
  await expect(page.locator('.node-card').first()).toHaveCSS('background-color', 'rgba(234, 244, 255, 0.8)')
})

test('fresh full-site baseline and confirmed write preserve unrelated settings and ignore old local preference', async ({ page }) => {
  const fixture = await setup(page)
  const raw = JSON.stringify({ schemaVersion: 1, preset: 'midnight', colors: CUSTOM_COLORS })
  await page.evaluate(({ key, raw }) => localStorage.setItem(key, raw), { key: STORAGE_KEY, raw })
  fixture.setThemeSetting('glassCustomColors', JSON.stringify({ ...CUSTOM_COLORS, lightText: '#123456' }))
  const original = structuredClone(fixture.getSavedThemeSettings())
  await open(page)
  await page.getByTestId('palette-field-Text').click()
  await expect(page.locator('#palette-hex')).toHaveValue('#123456')
  await page.locator('#palette-hex').fill('#273849')
  page.once('dialog', dialog => dialog.dismiss())
  await page.getByTestId('palette-save-site').click()
  expect(fixture.getThemeSaveCount()).toBe(0)
  page.once('dialog', dialog => dialog.accept())
  await page.getByTestId('palette-save-site').click()
  await expect(page.getByTestId('palette-notice')).toContainText('全站配色已保存。')
  const saved = fixture.getSavedThemeSettings()
  expect(saved.glassColorPreset).toBe('自定义')
  expect(typeof saved.glassCustomColors).toBe('string')
  expect(JSON.parse(String(saved.glassCustomColors)).lightText).toBe('#273849')
  for (const key of Object.keys(original).filter(key => !['glassColorPreset', 'glassCustomColors'].includes(key)))
    expect(saved[key], key).toEqual(original[key])
  expect(fixture.getThemeSaveCount()).toBe(1)
  expect(await page.evaluate(key => localStorage.getItem(key), STORAGE_KEY)).toBe(raw)
  await page.reload()
  await expect(page.locator('.node-card').first()).toHaveCSS('color', 'rgb(39, 56, 73)')
})

test('retired managed preset reads safely without automatic save; existing genuine custom is preserved', async ({ page }) => {
  const fixture = await setup(page)
  fixture.setThemeSetting('glassColorPreset', 'softFrost')
  await open(page)
  await expect(page.getByTestId('palette-preset')).toHaveValue('emerald')
  await expect(page.locator('#palette-hex')).toHaveValue('#F1F5F9BD')
  await expect(page.getByTestId('palette-save-site')).toBeDisabled()
  expect(fixture.getSavedThemeSettings().glassColorPreset).toBe('softFrost')
  await page.getByTestId('palette-preset').selectOption('soft')
  page.once('dialog', dialog => dialog.accept())
  await page.getByTestId('palette-save-site').click()
  await expect(page.getByTestId('palette-notice')).toContainText('全站配色已保存。')
  expect(fixture.getSavedThemeSettings().glassCustomColors).toBe(JSON.stringify(CUSTOM_COLORS))
  expect(fixture.getThemeSaveCount()).toBe(1)
})

test('conflict and permission loss cannot become successful saves or personal fallbacks', async ({ page }) => {
  const fixture = await setup(page)
  await open(page)
  await page.locator('#palette-hex').fill('#112233E6')
  fixture.setThemeSetting('glassColorPreset', '午夜')
  page.once('dialog', dialog => dialog.accept())
  await page.getByTestId('palette-save-site').click()
  await expect(page.getByTestId('palette-status')).toContainText('已被其他操作修改')
  await page.locator('.palette-advanced summary').click()
  page.once('dialog', dialog => dialog.accept())
  await page.getByRole('button', { name: '重新读取站点配色' }).click()
  await expect(page.getByTestId('palette-preset')).toHaveValue('midnight')
  await page.locator('#palette-hex').fill('#112233E6')
  fixture.setAdminAccess('forbidden')
  page.once('dialog', dialog => dialog.accept())
  await page.getByTestId('palette-save-site').click()
  await expect(page.getByTestId('palette-notice')).toContainText('管理权限失效')
  await expect(page.getByTestId('palette-panel')).toHaveCount(0)
  await expect(page.getByTestId('palette-entry')).toHaveCount(0)
  expect(fixture.getThemeSaveCount()).toBe(0)
})

test('readback failure blocks duplicate submission and close cannot claim to undo a sent request', async ({ page }) => {
  const fixture = await setup(page)
  await open(page)
  await page.locator('#palette-hex').fill('#112233E6')
  await page.route('**/api/public', async route => fixture.getThemeSaveCount() > 0 ? route.fulfill({ status: 503, json: { status: 'error' } }) : route.fallback())
  page.once('dialog', dialog => dialog.accept())
  await page.getByTestId('palette-save-site').click()
  await expect(page.getByTestId('palette-status')).toContainText('保存结果待确认')
  await expect(page.getByTestId('palette-save-site')).toBeDisabled()
  expect(fixture.getThemeSaveCount()).toBe(1)
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('palette-notice')).toContainText('关闭不能撤回')
})

test('logout removes preview; delayed permission result cannot reactivate it across login', async ({ page }) => {
  const fixture = await setup(page)
  await open(page)
  await page.locator('#palette-hex').fill('#010203E6')
  const release = fixture.pauseAdminResponses()
  page.once('dialog', dialog => dialog.accept())
  const pending = page.waitForRequest(request => request.url().endsWith('/api/admin/ping'))
  await page.getByTestId('palette-save-site').click()
  await pending
  fixture.setAdminAccess('guest')
  await syncSession(page)
  await expect(page.getByTestId('palette-panel')).toHaveCount(0)
  await expect(page.getByTestId('palette-entry')).toHaveCount(0)
  fixture.setAdminAccess('admin')
  release()
  await syncSession(page)
  await open(page)
  await expect(page.locator('#palette-hex')).toHaveValue('#F8FAFCE6')
  expect(fixture.getThemeSaveCount()).toBe(0)
})

test('failed or late opening read cannot create an editable fallback', async ({ page }) => {
  const fixture = await setup(page)
  await expect(page.getByTestId('palette-entry')).toBeVisible()
  const block = async (route: any) => route.fulfill({ json: { status: 'success', data: { theme: 'glassmorphism-plus', theme_settings: '{broken' } } })
  await page.route('**/api/public', block)
  await page.getByTestId('palette-entry').click()
  await expect(page.getByTestId('palette-status')).toContainText('JSON')
  await expect(page.locator('#palette-hex')).toBeDisabled()
  await expect(page.getByTestId('palette-save-site')).toBeDisabled()
  await page.keyboard.press('Escape')
  await page.unroute('**/api/public', block)
  const release = fixture.pauseAdminResponses()
  const pending = page.waitForRequest(request => request.url().endsWith('/api/admin/ping'))
  await page.getByTestId('palette-entry').click()
  await pending
  await expect(page.locator('#palette-hex')).toBeDisabled()
  await page.getByRole('button', { name: '取消', exact: true }).click()
  release()
  await open(page)
  await expect(page.locator('#palette-hex')).toHaveValue('#F8FAFCE6')
  expect(fixture.getThemeSaveCount()).toBe(0)
})

test('session identity and active theme transitions discard preview without reviving stale access', async ({ page }) => {
  await setup(page)
  await open(page)
  await page.locator('#palette-hex').fill('#12345680')
  await page.evaluate(() => {
    const app = (document.querySelector('#app') as any).__vue_app__.config.globalProperties.$pinia._s.get('app')
    app.updateLoginState(true, { logged_in: true, username: 'synthetic-replacement' })
  })
  await expect(page.getByTestId('palette-panel')).toHaveCount(0)
  await expect(page.getByTestId('palette-entry')).toBeVisible()
  await syncSession(page)
  await open(page)
  await expect(page.locator('#palette-hex')).toHaveValue('#F8FAFCE6')
  await page.evaluate(() => {
    const app = (document.querySelector('#app') as any).__vue_app__.config.globalProperties.$pinia._s.get('app')
    app.publicSettings = { ...app.publicSettings, theme: 'other-theme' }
  })
  await expect(page.getByTestId('palette-panel')).toHaveCount(0)
  await expect(page.getByTestId('palette-entry')).toHaveCount(0)
})

test('repeated save while permission check is pending submits once', async ({ page }) => {
  const fixture = await setup(page)
  await open(page)
  await page.locator('#palette-hex').fill('#112233E6')
  const release = fixture.pauseAdminResponses()
  let confirmations = 0
  page.on('dialog', async (dialog) => {
    confirmations++
    await dialog.accept()
  })
  const pending = page.waitForRequest(request => request.url().endsWith('/api/admin/ping'))
  await page.getByTestId('palette-save-site').click()
  await pending
  await page.getByTestId('palette-save-site').dispatchEvent('click')
  release()
  await expect(page.getByTestId('palette-notice')).toContainText('全站配色已保存。')
  expect(confirmations).toBe(1)
  expect(fixture.getThemeSaveCount()).toBe(1)
})

test('advanced JSON remains atomic, ignores unknown keys and preserves mode on cancel', async ({ page }) => {
  const fixture = await setup(page)
  await open(page)
  const mode = await page.evaluate(() => localStorage.getItem('themeMode'))
  await page.getByText('高级：十键 JSON 导入／导出', { exact: true }).click()
  await page.locator('#palette-json').fill('{"lightText":"#ffffff"}')
  await page.getByRole('button', { name: '导入到草稿' }).click()
  await expect(page.getByTestId('palette-save-site')).toBeDisabled()
  await expect(page.locator('.node-card').first()).toHaveCSS('color', 'rgb(17, 17, 17)')
  await page.locator('#palette-json').fill(JSON.stringify({ ...CUSTOM_COLORS, lightText: '#FFFFFF', extra: 'discard' }))
  await page.getByRole('button', { name: '导入到草稿' }).click()
  await expect(page.getByTestId('palette-status')).toContainText('忽略 1')
  await expect(page.getByTestId('palette-panel')).toHaveCSS('color', 'rgb(24, 24, 27)')
  await expect(page.getByTestId('palette-entry')).toHaveCSS('color', 'rgb(24, 24, 27)')
  await page.keyboard.press('Escape')
  await expect(page.locator('.node-card').first()).toHaveCSS('color', 'rgb(17, 17, 17)')
  expect(await page.evaluate(() => localStorage.getItem('themeMode'))).toBe(mode)
  expect(fixture.getThemeSaveCount()).toBe(0)
})

for (const width of [1440, 1280, 768, 390, 360, 320]) {
  for (const dark of [false, true]) {
    test(`Header and five swatches fit ${width}px ${dark ? 'dark' : 'light'}`, async ({ page }, info) => {
      await page.setViewportSize({ width, height: 900 })
      await setup(page, true, dark)
      const actions = page.getByTestId('header-actions')
      await expect(actions.locator('button')).toHaveCount(7)
      expect(await actions.locator('button').evaluateAll(buttons => buttons.map(button => button.getAttribute('aria-label')))).toEqual(['浅色模式', '北京时间自动', '深色模式', '显示首页工具', '延迟监测中心', '配色中心', '后台管理'])
      await open(page)
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width)
      await expect(page.getByRole('radio')).toHaveCount(5)
      for (const key of fields) {
        const button = page.getByTestId(`palette-field-${key}`)
        await expect(button).toBeVisible()
        const bounds = (await button.boundingBox())!
        expect(bounds.x).toBeGreaterThanOrEqual(0)
        expect(bounds.x + bounds.width).toBeLessThanOrEqual(width)
        expect(bounds.height).toBeLessThanOrEqual(36)
      }
      await expect(page.locator(`[data-node-card-uuid="${PRIMARY_NODE_UUID}"] [data-node-ping-bars]`)).toHaveCount(6)
      const screenshot = info.outputPath('palette-product.png')
      await page.screenshot({ path: screenshot, fullPage: true })
      await info.attach('palette-product', { path: screenshot, contentType: 'image/png' })
      await page.getByRole('button', { name: '取消', exact: true }).click()
      await page.getByRole('button', { name: '查看节点 主控-洛杉矶 详情', exact: true }).click()
      await expect(page).toHaveURL(new RegExp(`/instance/${PRIMARY_NODE_UUID}`))
      await page.goBack()
      await expect(page.locator('.node-card')).toHaveCount(3)
    })
  }
}
