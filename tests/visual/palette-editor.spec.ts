import type { Page } from '@playwright/test'
import { expect, test } from '@playwright/test'
import { SOFT_FROST_COLORS } from '../../src/utils/paletteColors'
import { installKomariFixture, PRIMARY_NODE_UUID } from './fixtures/komari'

const STORAGE_KEY = 'glassmorphism-plus:palette:v1:%2F'
const config = JSON.stringify({ schemaVersion: 3, global: { threeNetworkEnabled: true, taskIds: [101, 202, 303] }, nodes: {} })

async function setup(page: Page, admin = false, dark = false) {
  const fixture = await installKomariFixture(page, { themeShort: 'glassmorphism-plus', adminAccess: admin ? 'admin' : 'guest', hideEarth: true, nodeCount: 3, dark, preserveStorageOnReload: true, nodeCardPingDisplayConfigV3: config, nodeCardPingFixture: { thirdSharedTask: true } })
  fixture.setThemeSetting('glassColorPreset', '柔雾')
  fixture.setThemeSetting('glassCustomColors', JSON.stringify(SOFT_FROST_COLORS))
  fixture.setThemeSetting('futureOpaqueSetting', { list: [1, false, null], nested: { preserve: 'fixture-only' } })
  await page.goto('/?retained=palette-test')
  await expect(page.locator('.node-card')).toHaveCount(3)
  return fixture
}

async function open(page: Page) {
  await page.getByTestId('palette-entry').click()
  await expect(page.getByTestId('palette-panel')).toBeVisible()
  await expect(page.locator('#palette-heading')).toBeFocused()
}

async function site(page: Page) {
  await open(page)
  await page.getByRole('button', { name: '验证权限并编辑全站配色' }).click()
  await expect(page.getByTestId('palette-status')).toContainText('已读取最新站点配色')
}

test('local preview keeps exact alpha, invalid raw fields, modes and monitoring state', async ({ page }) => {
  const adminRequests: string[] = []
  page.on('request', (request) => {
    if (request.url().includes('/api/admin/'))
      adminRequests.push(request.url())
  })
  const fixture = await setup(page)
  const initialColor = await page.locator('.node-card').first().evaluate(element => getComputedStyle(element).backgroundColor)
  await open(page)
  const modeBefore = await page.evaluate(() => localStorage.getItem('themeMode'))
  await expect(page.locator('#palette-hex')).toHaveValue('#F8FAFCE6')
  await page.getByRole('button', { name: '编辑深色', exact: true }).click()
  await expect(page.locator('#palette-hex')).toHaveValue('#1E2732E6')
  await page.locator('#palette-rgb').fill('RGB(11, 22, 33)')
  await expect(page.locator('#palette-hex')).toHaveValue('#0B1621E6')
  await page.locator('#palette-hex').fill('#ABCDEF')
  await page.locator('#palette-hex').blur()
  await expect(page.locator('#palette-hex')).toHaveValue('#ABCDEFE6')
  await page.locator('#palette-rgb').fill('rgb(999,0,0)')
  await expect(page.getByTestId('palette-apply-local')).toBeDisabled()
  await page.getByTestId('palette-field-Text').click()
  await page.getByTestId('palette-field-Card').click()
  await expect(page.locator('#palette-rgb')).toHaveValue('rgb(999,0,0)')
  await expect(page.locator('#palette-hex')).toHaveValue('#ABCDEFE6')
  await page.locator('#palette-rgb').fill('rgb(1,2,3)')
  await page.getByRole('button', { name: '编辑浅色', exact: true }).click()
  await expect(page.locator('#palette-hex')).toHaveValue('#F8FAFCE6')
  expect(await page.evaluate(() => localStorage.getItem('themeMode'))).toBe(modeBefore)
  const calls = fixture.timeline.length
  for (let index = 0; index < 12; index++)
    await page.locator('#palette-hex').fill(index % 2 ? '#112233E6' : '#445566E6')
  expect(fixture.timeline.length).toBe(calls)
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('palette-panel')).toHaveCount(0)
  await expect(page.getByTestId('palette-entry')).toBeFocused()
  expect(await page.evaluate(key => localStorage.getItem(key), STORAGE_KEY)).toBeNull()
  // Closing the panel moves the cards under the pointer; check base, not hover alpha.
  await page.mouse.move(0, 0)
  await expect(page.locator('.node-card').first()).toHaveCSS('background-color', initialColor)
  expect(adminRequests).toEqual([])
  expect(new URL(page.url()).searchParams.get('retained')).toBe('palette-test')
})

test('local application survives reload; follow site and failed storage do not modify the server', async ({ page }) => {
  const fixture = await setup(page)
  await open(page)
  await page.getByTestId('palette-field-Text').click()
  await page.locator('#palette-hex').fill('#123456')
  await page.getByTestId('palette-apply-local').click()
  await page.reload()
  await expect(page.locator('.node-card').first()).toHaveCSS('color', 'rgb(18, 52, 86)')
  await open(page)
  await page.getByRole('button', { name: '跟随站点配色', exact: true }).click()
  await expect(page.locator('.node-card').first()).toHaveCSS('color', 'rgb(17, 17, 17)')
  await page.evaluate((key) => {
    const original = Storage.prototype.setItem
    Storage.prototype.setItem = function (name, value) {
      if (name === key)
        throw new DOMException('Synthetic storage restriction', 'SecurityError')
      return original.call(this, name, value)
    }
  }, STORAGE_KEY)
  await open(page)
  await page.getByTestId('palette-field-Text').click()
  await page.locator('#palette-hex').fill('#654321')
  await page.getByTestId('palette-apply-local').click()
  await expect(page.getByTestId('palette-notice')).toContainText('禁止保存偏好')
  await expect(page.locator('.node-card').first()).toHaveCSS('color', 'rgb(101, 67, 33)')
  expect(fixture.getThemeSaveCount()).toBe(0)
})

test('site baseline is independent of personal override; verified writes preserve every unrelated setting', async ({ page }) => {
  const fixture = await setup(page, true)
  await open(page)
  await page.getByTestId('palette-field-Text').click()
  await page.locator('#palette-hex').fill('#123456')
  await page.getByTestId('palette-apply-local').click()
  const original = structuredClone(fixture.getSavedThemeSettings())
  await site(page)
  await page.getByTestId('palette-field-Text').click()
  await expect(page.locator('#palette-hex')).toHaveValue('#111111')
  await page.locator('#palette-hex').fill('#273849')
  await page.getByLabel('确认设为全站默认').check()
  await page.getByTestId('palette-save-site').click()
  await expect(page.getByTestId('palette-notice')).toContainText('本浏览器仍使用本机覆盖')
  const saved = fixture.getSavedThemeSettings()
  expect(saved.glassColorPreset).toBe('自定义')
  expect(typeof saved.glassCustomColors).toBe('string')
  expect(JSON.parse(String(saved.glassCustomColors)).lightText).toBe('#273849')
  for (const key of Object.keys(original).filter(key => !['glassColorPreset', 'glassCustomColors'].includes(key)))
    expect(saved[key], key).toEqual(original[key])
  await expect(page.locator('.node-card').first()).toHaveCSS('color', 'rgb(18, 52, 86)')
  expect(fixture.getThemeSaveCount()).toBe(1)
})

test('site conflict and permission denial cannot become successful saves', async ({ page }) => {
  const fixture = await setup(page, true)
  await site(page)
  await page.locator('#palette-hex').fill('#112233E6')
  fixture.setThemeSetting('glassColorPreset', '午夜')
  await page.getByLabel('确认设为全站默认').check()
  await page.getByTestId('palette-save-site').click()
  await expect(page.getByTestId('palette-status')).toContainText('已被其他操作修改')
  expect(fixture.getThemeSaveCount()).toBe(0)
  await page.getByRole('button', { name: '重新读取站点配色' }).click()
  await expect(page.getByTestId('palette-preset')).toHaveValue('midnight')
  fixture.setAdminAccess('forbidden')
  await page.getByLabel('确认设为全站默认').check()
  await page.getByTestId('palette-save-site').click()
  await expect(page.getByTestId('palette-status')).toContainText('管理权限失效')
  await expect(page.getByTestId('palette-save-site')).toHaveCount(0)
  expect(fixture.getThemeSaveCount()).toBe(0)
})

test('readback failure reports pending confirmation and blocks duplicate submission', async ({ page }) => {
  const fixture = await setup(page, true)
  await site(page)
  await page.locator('#palette-hex').fill('#112233E6')
  await page.route('**/api/public', async (route) => {
    if (fixture.getThemeSaveCount() > 0)
      return route.fulfill({ status: 503, json: { status: 'error' } })
    return route.fallback()
  })
  await page.getByLabel('确认设为全站默认').check()
  await page.getByTestId('palette-save-site').click()
  await expect(page.getByTestId('palette-status')).toContainText('保存结果待确认')
  await expect(page.getByTestId('palette-save-site')).toBeDisabled()
  expect(fixture.getThemeSaveCount()).toBe(1)
})

test('logout revokes a site draft and an old delayed response cannot restore it after login', async ({ page }) => {
  const fixture = await setup(page, true)
  await site(page)
  await page.locator('#palette-hex').fill('#010203E6')
  const release = fixture.pauseAdminResponses()
  await page.getByLabel('确认设为全站默认').check()
  const pendingPermission = page.waitForRequest(request => request.url().endsWith('/api/admin/ping'))
  await page.getByTestId('palette-save-site').click()
  await pendingPermission
  fixture.setAdminAccess('guest')
  await page.evaluate(async () => {
    const app = (document.querySelector('#app') as any).__vue_app__.config.globalProperties.$pinia._s.get('app')
    await app.verifyLoginState({ force: true })
  })
  await expect(page.getByTestId('palette-status')).toContainText('会话已变更')
  await expect(page.getByTestId('palette-save-site')).toHaveCount(0)
  fixture.setAdminAccess('admin')
  release()
  await page.evaluate(async () => {
    const app = (document.querySelector('#app') as any).__vue_app__.config.globalProperties.$pinia._s.get('app')
    await app.verifyLoginState({ force: true })
  })
  await page.getByRole('button', { name: '验证权限并编辑全站配色' }).click()
  await expect(page.getByTestId('palette-status')).toContainText('已读取最新站点配色')
  await expect(page.locator('#palette-hex')).toHaveValue('#F8FAFCE6')
  expect(fixture.getThemeSaveCount()).toBe(0)
})

test('advanced JSON import is atomic and editing either group never rewrites theme mode', async ({ page }) => {
  await setup(page)
  await open(page)
  await page.getByText('高级：十键 JSON 导入／导出', { exact: true }).click()
  await page.locator('#palette-json').fill('{"lightText":"#ffffff"}')
  await page.getByRole('button', { name: '导入到草稿' }).click()
  await expect(page.getByTestId('palette-apply-local')).toBeDisabled()
  await expect(page.locator('.node-card').first()).toHaveCSS('color', 'rgb(17, 17, 17)')
  await page.locator('#palette-json').fill(JSON.stringify({ ...SOFT_FROST_COLORS, lightText: '#FFFFFF', extra: 'discard' }))
  await page.getByRole('button', { name: '导入到草稿' }).click()
  await expect(page.getByTestId('palette-status')).toContainText('忽略 1')
  await expect(page.getByTestId('palette-panel')).toHaveCSS('color', 'rgb(17, 17, 17)')
  await expect(page.getByTestId('palette-entry')).toHaveCSS('color', 'rgb(17, 17, 17)')
  await page.getByRole('button', { name: '恢复全部柔雾预设' }).click()
  await expect(page.getByTestId('palette-preset')).toHaveValue('softFrost')
  await page.getByTestId('palette-apply-local').click()
  const stored = await page.evaluate(key => JSON.parse(localStorage.getItem(key)!), STORAGE_KEY)
  expect(stored.colors).toEqual(SOFT_FROST_COLORS)
  expect(stored).not.toHaveProperty('themeMode')
})

for (const width of [1440, 1280, 768, 390, 360, 320]) {
  test(`palette Header position and safe panel fit ${width}px without hiding existing controls`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 900 })
    await setup(page, true, width < 768)
    const actions = page.getByTestId('header-actions')
    await expect(actions.locator('button')).toHaveCount(7)
    const labels = await actions.locator('button').evaluateAll(buttons => buttons.map(button => button.getAttribute('aria-label')))
    expect(labels).toEqual(['浅色模式', '北京时间自动', '深色模式', '显示首页工具', '延迟监测中心', '配色中心', '后台管理'])
    const bounds = await actions.boundingBox()
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width)
    await open(page)
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width)
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
