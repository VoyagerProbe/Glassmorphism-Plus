import type { Page } from '@playwright/test'
import { expect, test } from '@playwright/test'
import { installKomariFixture, PRIMARY_NODE_UUID } from './fixtures/komari'
import { CUSTOM_COLORS } from './fixtures/palette'

const STORAGE_KEY = 'glassmorphism-plus:palette:v1:%2F'
const config = JSON.stringify({ schemaVersion: 3, global: { threeNetworkEnabled: true, taskIds: [101, 202, 303] }, nodes: {} })
const fields = ['Card', 'Control', 'Text', 'MutedText', 'Border'] as const
const dialogs = new WeakMap<Page, string[]>()
const pageErrors = new WeakMap<Page, string[]>()

test.beforeEach(({ page }) => {
  const observed: string[] = []
  dialogs.set(page, observed)
  const errors: string[] = []
  pageErrors.set(page, errors)
  page.on('pageerror', error => errors.push(error.message))
  page.on('dialog', async (dialog) => {
    observed.push(dialog.type())
    await dialog.dismiss()
  })
})
test.afterEach(({ page }) => {
  expect(dialogs.get(page), 'Palette actions never require a native confirmation').toEqual([])
  expect(pageErrors.get(page), 'Palette lifecycle leaves no uncaught browser errors').toEqual([])
})

async function setup(page: Page, admin = true, dark = false, fakeTimers = false) {
  const fixture = await installKomariFixture(page, { themeShort: 'glassmorphism-plus', adminAccess: admin ? 'admin' : 'guest', hideEarth: true, nodeCount: 3, dark, fakeTimers, preserveStorageOnReload: true, nodeCardPingDisplayConfigV3: config, nodeCardPingFixture: { thirdSharedTask: true } })
  fixture.setThemeSetting('glassColorPreset', '自定义')
  fixture.setThemeSetting('glassCustomColors', JSON.stringify(CUSTOM_COLORS))
  fixture.setThemeSetting('futureOpaqueSetting', { list: [1, false, null], nested: { preserve: 'fixture-only' } })
  await page.goto('/?retained=palette-test')
  await expect(page.locator('.node-card')).toHaveCount(3)
  return fixture
}

async function open(page: Page) {
  await expect.poll(() => page.evaluate(() => (document.querySelector('#app') as any).__vue_app__.config.globalProperties.$pinia._s.get('app').paletteAdminAllowed)).toBe(true)
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

test('guests and denied sessions open readonly without admin requests or direct-action preview bypass', async ({ page }) => {
  const requests: string[] = []
  page.on('request', request => requests.push(request.url()))
  const fixture = await setup(page, false)
  await expect(page.getByTestId('palette-entry')).toBeVisible()
  expect(requests.filter(url => url.includes('/api/admin/'))).toEqual([])
  const tryOpen = () => page.evaluate(() => (document.querySelector('#app') as any).__vue_app__.config.globalProperties.$pinia._s.get('app').openPaletteEditor())
  await tryOpen()
  await expect(page.getByTestId('palette-readonly')).toBeVisible()
  await expect(page.getByTestId('palette-readonly-lightText')).toHaveText('#111111')
  await expect(page.getByTestId('palette-panel').locator('input, select, textarea, [contenteditable="true"]')).toHaveCount(0)
  await expect(page.getByTestId('palette-save-site')).toHaveCount(0)
  await page.evaluate(() => {
    const app = (document.querySelector('#app') as any).__vue_app__.config.globalProperties.$pinia._s.get('app')
    app.paletteDraft = { preset: 'custom', colors: { ...app.managedPalette.colors, lightText: '#ABCDEF' } }
  })
  await expect(page.locator('.node-card').first()).toHaveCSS('color', 'rgb(17, 17, 17)')
  await expect(page.getByTestId('palette-readonly-lightText')).toHaveText('#111111')
  await page.keyboard.press('Enter')
  expect(requests.filter(url => url.includes('/api/admin/'))).toEqual([])
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('palette-entry')).toBeFocused()
  fixture.setAdminAccess('forbidden')
  await syncSession(page)
  await expect.poll(() => requests.filter(url => url.endsWith('/api/admin/ping')).length).toBe(1)
  await expect(page.getByTestId('palette-entry')).toBeVisible()
  await expect.poll(() => page.evaluate(() => (document.querySelector('#app') as any).__vue_app__.config.globalProperties.$pinia._s.get('app').paletteAccessStatus)).toContain('未能确认')
  const adminRequests = requests.filter(url => url.includes('/api/admin/'))
  await tryOpen()
  await expect(page.getByTestId('palette-readonly')).toBeVisible()
  await expect(page.getByTestId('palette-save-site')).toHaveCount(0)
  await page.getByRole('button', { name: '关闭', exact: true }).click()
  await page.getByTestId('palette-entry').click()
  await expect(page.getByTestId('palette-readonly')).toBeVisible()
  expect(requests.filter(url => url.includes('/api/admin/'))).toEqual(adminRequests)
  expect(fixture.getThemeSaveCount()).toBe(0)
})

for (const width of [360, 390]) {
  for (const dark of [false, true]) {
    test(`anonymous readonly palette fits ${width}px ${dark ? 'dark' : 'light'} without storage or monitoring changes`, async ({ page }, info) => {
      await page.setViewportSize({ width, height: 844 })
      const fixture = await setup(page, false, dark)
      // Finish ordinary startup ingestion before attributing writes/traffic to
      // opening the readonly view. Monitoring is intentionally still running.
      await fixture.waitForPingRefreshSettled()
      await page.waitForLoadState('networkidle')
      const before = await page.evaluate(() => ({ ...localStorage }))
      const requests: string[] = []
      page.on('request', request => requests.push(request.url()))
      const calls = fixture.timeline.length
      const actions = page.getByTestId('header-actions').locator('button')
      const labels = await actions.evaluateAll(buttons => buttons.map(button => button.getAttribute('aria-label')))
      expect(labels.indexOf('配色中心')).toBe(labels.indexOf('延迟监测中心') + 1)
      expect(labels.indexOf('后台管理')).toBe(labels.indexOf('配色中心') + 1)
      await page.getByTestId('palette-entry').focus()
      await page.keyboard.press('Enter')
      await expect(page.getByTestId('palette-readonly')).toBeVisible()
      await expect(page.locator('#palette-heading')).toBeFocused()
      for (const [key, value] of Object.entries(CUSTOM_COLORS))
        await expect(page.getByTestId(`palette-readonly-${key}`)).toHaveText(value)
      await expect(page.getByTestId('palette-readonly').locator('dd')).toHaveCount(10)
      await expect(page.getByTestId('palette-panel').locator('button')).toHaveCount(2)
      await expect(page.getByTestId('palette-panel').locator('input,select,textarea,[role="radio"]')).toHaveCount(0)
      expect(await page.getByTestId('palette-readonly').locator('code').evaluateAll(values => values.every(value => value.getBoundingClientRect().height < Number.parseFloat(getComputedStyle(value).lineHeight) * 1.5))).toBe(true)
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      await page.getByTestId('palette-panel').screenshot({ path: info.outputPath('readonly-palette.png') })
      await page.getByRole('button', { name: '关闭', exact: true }).click()
      await expect(page.getByTestId('palette-entry')).toBeFocused()
      expect(await page.evaluate(() => ({ ...localStorage }))).toEqual(before)
      expect(requests.filter(url => url.includes('/api/admin/'))).toEqual([])
      expect(fixture.timeline.length).toBe(calls)
      expect(fixture.getThemeSaveCount()).toBe(0)
    })
  }
}

test('failed permission probe keeps public colors and monitoring; later verified login edits without reload', async ({ page }) => {
  const fixture = await setup(page, false)
  const unavailable = (route: any) => route.fulfill({ status: 503, json: { status: 'error' } })
  await page.route('**/api/admin/ping', unavailable)
  fixture.setAdminAccess('admin')
  await syncSession(page)
  await page.getByTestId('palette-entry').click()
  await expect(page.getByTestId('palette-readonly')).toBeVisible()
  await expect(page.getByTestId('palette-panel')).toContainText('未能确认管理员权限')
  await expect(page.locator('.node-card')).toHaveCount(3)
  await expect(page.getByTestId('palette-save-site')).toHaveCount(0)
  await page.keyboard.press('Escape')
  await page.unroute('**/api/admin/ping', unavailable)
  fixture.setAdminAccess('guest')
  await syncSession(page)
  await expect(page.getByTestId('palette-entry')).toBeVisible()
  fixture.setAdminAccess('admin')
  await syncSession(page)
  await open(page)
  await page.locator('#palette-hex').fill('#10203080')
  await page.getByTestId('palette-save-site').click()
  await expect(page.getByTestId('palette-notice')).toContainText('全站配色已保存。')
  expect(fixture.getThemeSaveCount()).toBe(1)
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
  // Ten real reload/editor cycles share this test's budget. Keep every case,
  // per-assertion deadline and zero retries; slower WebKit CI needs the total.
  test.setTimeout(60_000)
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
    // Finish routed startup traffic before tearing down this document. WebKit
    // can otherwise let an unloading RPC escape the fixture into the dev proxy.
    await fixture.waitForPingRefreshSettled()
    await page.waitForLoadState('networkidle')
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

test('fresh full-site baseline and direct write preserve unrelated settings and ignore old local preference', async ({ page }) => {
  const fixture = await setup(page)
  const raw = JSON.stringify({ schemaVersion: 1, preset: 'midnight', colors: CUSTOM_COLORS })
  await page.evaluate(({ key, raw }) => localStorage.setItem(key, raw), { key: STORAGE_KEY, raw })
  fixture.setThemeSetting('glassCustomColors', JSON.stringify({ ...CUSTOM_COLORS, lightText: '#123456' }))
  const original = structuredClone(fixture.getSavedThemeSettings())
  await open(page)
  await page.getByTestId('palette-field-Text').click()
  await expect(page.locator('#palette-hex')).toHaveValue('#123456')
  await page.locator('#palette-hex').fill('#273849')
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
  await page.getByTestId('palette-save-site').click()
  await expect(page.getByTestId('palette-status')).toContainText('已被其他操作修改')
  await page.getByRole('button', { name: '取消', exact: true }).click()
  await open(page)
  await expect(page.getByTestId('palette-preset')).toHaveValue('midnight')
  await page.locator('#palette-hex').fill('#112233E6')
  fixture.setAdminAccess('forbidden')
  await page.getByTestId('palette-save-site').click()
  await expect(page.getByTestId('palette-notice')).toContainText('管理权限失效')
  await expect(page.getByTestId('palette-panel')).toHaveCount(0)
  await expect(page.getByTestId('palette-entry')).toBeVisible()
  await page.getByTestId('palette-entry').click()
  await expect(page.getByTestId('palette-readonly')).toBeVisible()
  expect(fixture.getThemeSaveCount()).toBe(0)
})

for (const saveInput of ['pointer', 'keyboard'] as const) {
  test(`readback failure blocks duplicate submission and close cannot claim to undo a sent request (${saveInput})`, async ({ page }) => {
    const fixture = await setup(page)
    await open(page)
    await page.locator('#palette-hex').fill('#112233E6')
    await page.route('**/api/public', async route => fixture.getThemeSaveCount() > 0 ? route.fulfill({ status: 503, json: { status: 'error' } }) : route.fallback())
    if (saveInput === 'keyboard') {
      await page.getByTestId('palette-save-site').focus()
      await page.keyboard.press('Enter')
    }
    else {
      await page.getByTestId('palette-save-site').click()
    }
    await expect(page.locator('#palette-heading')).toBeFocused()
    await expect(page.getByTestId('palette-status')).toContainText('保存结果待确认')
    await expect(page.getByTestId('palette-save-site')).toBeDisabled()
    expect(fixture.getThemeSaveCount()).toBe(1)
    // Escape is scoped to the editor. Direct save must retain enabled focus
    // without a test-induced focus change after submission.
    await expect.poll(() => page.getByTestId('palette-panel').evaluate(panel => ({
      within: panel.contains(document.activeElement),
      disabled: document.activeElement?.matches(':disabled'),
      focused: document.activeElement?.id || document.activeElement?.tagName,
    }))).toMatchObject({ within: true, disabled: false })
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('palette-panel')).toHaveCount(0)
    await expect(page.getByTestId('palette-notice')).toContainText('关闭不能撤回')
  })
}

test('logout removes preview; delayed permission result cannot reactivate it across login', async ({ page }) => {
  const fixture = await setup(page)
  await open(page)
  await page.locator('#palette-hex').fill('#010203E6')
  const release = fixture.pauseAdminResponses()
  const pending = page.waitForRequest(request => request.url().endsWith('/api/admin/ping'))
  await page.getByTestId('palette-save-site').click()
  await pending
  fixture.setAdminAccess('guest')
  await syncSession(page)
  await expect(page.getByTestId('palette-panel')).toHaveCount(0)
  await expect(page.getByTestId('palette-entry')).toBeVisible()
  await page.getByTestId('palette-entry').click()
  await expect(page.getByTestId('palette-readonly')).toBeVisible()
  await expect(page.getByTestId('palette-readonly-lightCard')).toHaveText('#F8FAFCE6')
  await page.keyboard.press('Escape')
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
  await expect(page.getByTestId('palette-entry')).toBeVisible()
  await page.getByTestId('palette-entry').click()
  await expect(page.getByTestId('palette-readonly')).toBeVisible()
})

test('repeated save while permission check is pending submits once', async ({ page }) => {
  const fixture = await setup(page)
  await open(page)
  await page.locator('#palette-hex').fill('#112233E6')
  const release = fixture.pauseAdminResponses()
  const pending = page.waitForRequest(request => request.url().endsWith('/api/admin/ping'))
  await page.getByTestId('palette-save-site').click()
  await pending
  await page.getByTestId('palette-save-site').dispatchEvent('click')
  await page.getByTestId('palette-save-site').dispatchEvent('click')
  await page.keyboard.press('Enter')
  await expect(page.locator('#palette-hex')).toBeDisabled()
  await expect(page.getByTestId('palette-save-site')).toBeDisabled()
  release()
  await expect(page.getByTestId('palette-notice')).toContainText('全站配色已保存。')
  expect(dialogs.get(page)).toEqual([])
  expect(fixture.getThemeSaveCount()).toBe(1)
})

test('advanced JSON remains atomic, ignores unknown keys and preserves mode on cancel', async ({ page }) => {
  const fixture = await setup(page)
  await open(page)
  const mode = await page.evaluate(() => localStorage.getItem('themeMode'))
  await page.getByText('高级：十键 JSON 导入／导出', { exact: true }).click()
  await page.locator('#palette-json').fill('{"lightText":"#ffffff"}')
  await page.getByRole('button', { name: '导入', exact: true }).click()
  await expect(page.getByTestId('palette-save-site')).toBeDisabled()
  await expect(page.locator('.node-card').first()).toHaveCSS('color', 'rgb(17, 17, 17)')
  await page.locator('#palette-json').fill(JSON.stringify({ ...CUSTOM_COLORS, lightText: '#FFFFFF', extra: 'discard' }))
  await page.getByRole('button', { name: '导入', exact: true }).click()
  await expect(page.getByTestId('palette-status')).toContainText('忽略 1')
  await expect(page.getByTestId('palette-preset')).toHaveValue('custom')
  await expect(page.getByTestId('palette-save-site')).toBeEnabled()
  await expect(page.getByTestId('palette-notice')).toHaveCount(0)
  expect(fixture.getThemeSaveCount()).toBe(0)
  await expect(page.getByTestId('palette-panel')).toHaveCSS('color', 'rgb(24, 24, 27)')
  await expect(page.getByTestId('palette-entry')).toHaveCSS('color', 'rgb(24, 24, 27)')
  expect(await page.evaluate(() => Boolean(document.activeElement?.closest('#palette-center'))), 'JSON import keeps keyboard ownership inside the palette').toBe(true)
  await page.keyboard.press('Escape')
  await expect(page.locator('.node-card').first()).toHaveCSS('color', 'rgb(17, 17, 17)')
  expect(await page.evaluate(() => localStorage.getItem('themeMode'))).toBe(mode)
  expect(fixture.getThemeSaveCount()).toBe(0)
})

test('feedback controls retain only atomic Import and ten-color Copy actions', async ({ page }) => {
  const fixture = await setup(page)
  await open(page)
  await page.locator('.palette-advanced summary').click()
  expect((await page.locator('.palette-advanced button').allTextContents()).map(value => value.trim())).toEqual(['导入', '复制当前十键配色'])
  await expect(page.getByRole('button', { name: '导入', exact: true })).toHaveAccessibleName('导入')
  await expect(page.getByRole('button', { name: /重新读取|重新加载|同步站点|刷新/ })).toHaveCount(0)
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (text: string) => {
      (window as any).copiedPalette = text
    } } })
  })
  await page.getByRole('button', { name: '复制当前十键配色', exact: true }).click()
  expect(JSON.parse(await page.evaluate(() => (window as any).copiedPalette))).toEqual(CUSTOM_COLORS)
  expect(fixture.getThemeSaveCount()).toBe(0)
})

async function pausePaletteClock(page: Page) {
  await page.clock.pauseAt(new Date(await page.evaluate(() => Date.now()) + 1000))
}

async function saveChangedColor(page: Page, value = '#273849') {
  await page.getByTestId('palette-field-Text').click()
  await page.locator('#palette-hex').fill(value)
  await page.getByTestId('palette-save-site').click()
  await expect(page.getByTestId('palette-notice')).toContainText('全站配色已保存。')
  await expect(page.getByTestId('palette-panel')).toHaveCount(0)
  await expect(page.getByRole('dialog')).toHaveCount(0)
}

for (const width of [360, 390]) {
  for (const dark of [false, true]) {
    test(`feedback direct save expires only after verified success plus 5000ms at ${width}px ${dark ? 'dark' : 'light'}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 844 })
      const fixture = await setup(page, true, dark, true)
      await open(page)
      await pausePaletteClock(page)
      const original = structuredClone(fixture.getSavedThemeSettings())
      await saveChangedColor(page)
      const saved = structuredClone(fixture.getSavedThemeSettings())
      expect(fixture.getThemeSaveCount()).toBe(1)
      for (const key of Object.keys(original).filter(key => !['glassColorPreset', 'glassCustomColors'].includes(key)))
        expect(saved[key], key).toEqual(original[key])
      await expect(page.getByTestId('palette-entry')).toBeFocused()
      await page.clock.runFor(4999)
      await expect(page.getByTestId('palette-notice')).toBeVisible()
      await page.clock.runFor(1)
      await expect(page.getByTestId('palette-notice')).toHaveCount(0)
      await expect(page.getByTestId('palette-entry')).toBeFocused()
      expect(fixture.getSavedThemeSettings()).toEqual(saved)
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    })
  }
}

test('feedback slow POST and readback start no success timer until both finish', async ({ page }) => {
  const fixture = await setup(page, true, false, true)
  await open(page)
  await pausePaletteClock(page)
  let releasePost!: () => void
  let releaseRead!: () => void
  const postGate = new Promise<void>((resolve) => {
    releasePost = resolve
  })
  const readGate = new Promise<void>((resolve) => {
    releaseRead = resolve
  })
  let posts = 0
  let reads = 0
  await page.route('**/api/admin/theme/settings?*', async (route) => {
    posts++
    await postGate
    await route.fallback()
  })
  await page.route('**/api/public', async (route) => {
    if (fixture.getThemeSaveCount()) {
      reads++
      await readGate
    }
    await route.fallback()
  })
  await page.locator('#palette-hex').fill('#12345680')
  await page.getByTestId('palette-save-site').click()
  await expect.poll(() => posts).toBe(1)
  await page.clock.runFor(6000)
  await expect(page.getByTestId('palette-notice')).toHaveCount(0)
  releasePost()
  await expect.poll(() => reads).toBe(1)
  await page.clock.runFor(6000)
  await expect(page.getByTestId('palette-notice')).toHaveCount(0)
  await expect(page.getByTestId('palette-save-site')).toBeDisabled()
  releaseRead()
  await expect(page.getByTestId('palette-notice')).toContainText('全站配色已保存。')
  await page.clock.runFor(4999)
  await expect(page.getByTestId('palette-notice')).toBeVisible()
  await page.clock.runFor(1)
  await expect(page.getByTestId('palette-notice')).toHaveCount(0)
  expect(fixture.getThemeSaveCount()).toBe(1)
})

test('feedback manual dismissal clears its timer without later mutation', async ({ page }) => {
  await setup(page, true, false, true)
  await open(page)
  await pausePaletteClock(page)
  await saveChangedColor(page)
  await page.clock.runFor(2000)
  await page.getByRole('button', { name: '关闭提示', exact: true }).click()
  await expect(page.getByTestId('palette-notice')).toHaveCount(0)
  await page.clock.runFor(10000)
  await expect(page.getByTestId('palette-notice')).toHaveCount(0)
})

test('feedback second real save receives its own complete five seconds', async ({ page }) => {
  const fixture = await setup(page, true, false, true)
  await open(page)
  await pausePaletteClock(page)
  await saveChangedColor(page)
  await page.clock.runFor(2000)
  await open(page)
  await saveChangedColor(page, '#345678')
  await page.clock.runFor(3000)
  await expect(page.getByTestId('palette-notice')).toBeVisible()
  await page.clock.runFor(1999)
  await expect(page.getByTestId('palette-notice')).toBeVisible()
  await page.clock.runFor(1)
  await expect(page.getByTestId('palette-notice')).toHaveCount(0)
  expect(fixture.getThemeSaveCount()).toBe(2)
})

test('feedback replacement errors never inherit a success timer or keyword heuristic', async ({ page }) => {
  await setup(page, true, false, true)
  await open(page)
  await pausePaletteClock(page)
  await saveChangedColor(page)
  await page.clock.runFor(2000)
  // Exercise the same store action used by permission/pending-result producers;
  // no fake lifecycle events, and the preceding success came from real UI save.
  await page.evaluate(() => (document.querySelector('#app') as any).__vue_app__.config.globalProperties.$pinia._s.get('app').showPaletteNotice('保存失败：管理权限失效，结果待确认。'))
  await page.clock.runFor(10000)
  await expect(page.getByTestId('palette-notice')).toContainText('保存失败：管理权限失效，结果待确认。')
})

test('feedback notice lifecycle ends on home deactivation and store disposal', async ({ page }) => {
  // Detail navigation also performs geolocation. Keep that unrelated lookup
  // synthetic so this lifecycle gate never depends on public provider CORS.
  await page.route('https://api.ip.sb/**', route => route.fulfill({
    json: { latitude: 34, longitude: -118, city: 'Fixture', country_code: 'US' },
  }))
  await setup(page, true, false, true)
  await open(page)
  await pausePaletteClock(page)
  await saveChangedColor(page)
  await page.getByRole('button', { name: '查看节点 主控-洛杉矶 详情', exact: true }).click()
  await expect(page).toHaveURL(new RegExp(`/instance/${PRIMARY_NODE_UUID}`))
  await page.clock.runFor(10000)
  await page.goBack()
  await expect(page.locator('.node-card')).toHaveCount(3)
  await expect(page.getByTestId('palette-notice')).toHaveCount(0)
  await open(page)
  await saveChangedColor(page, '#345678')
  await page.evaluate(() => {
    const app = (document.querySelector('#app') as any).__vue_app__.config.globalProperties.$pinia._s.get('app')
    app.$dispose()
  })
  await expect(page.getByTestId('palette-notice')).toHaveCount(0)
  await page.clock.runFor(10000)
  await expect(page.getByTestId('palette-notice')).toHaveCount(0)
})

for (const status of [401, 403, 500]) {
  test(`feedback rejected POST ${status} never reports success or expires its error`, async ({ page }) => {
    const fixture = await setup(page, true, false, true)
    await open(page)
    await pausePaletteClock(page)
    await page.route('**/api/admin/theme/settings?*', route => route.fulfill({ status, json: { status: 'error' } }))
    await page.locator('#palette-hex').fill('#12345680')
    await page.getByTestId('palette-save-site').click()
    const error = status === 500 ? page.getByTestId('palette-status') : page.getByTestId('palette-notice')
    await expect(error).toContainText(status === 500 ? '结果待确认' : '管理权限失效')
    await page.clock.runFor(10000)
    await expect(error).toBeVisible()
    if (status === 500)
      await expect(page.getByTestId('palette-notice')).toHaveCount(0)
    else
      await expect(page.getByTestId('palette-notice')).not.toContainText('全站配色已保存。')
    expect(fixture.getThemeSaveCount()).toBe(0)
  })
}

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
