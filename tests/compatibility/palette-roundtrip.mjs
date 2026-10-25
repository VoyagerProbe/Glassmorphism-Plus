import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { expect } from '@playwright/test'
import { digest } from '../service-worker/lab.mjs'

const assetUrl = /\/assets\/[^?]+\.(?:js|css)(?:\?|$)/
const paletteChunk = /PalettePanel-/
const javascriptMime = /javascript/
const stylesheetMime = /text\/css/

// Real production UI and official HTTP handlers, not intercepted fixture responses.
export async function verifyPaletteRoundtrip({ page, lab, settings, version, files }) {
  const readSettings = async () => (await lab.request('/api/public')).data.theme_settings
  const before = await readSettings()
  // /api/public adds manifest defaults. Preserve those too, not just seed keys.
  for (const [key, value] of Object.entries(settings))
    assert.deepEqual(before[key], value, `Seed setting retained: ${key}`)
  const visitor = await page.context().browser().newContext()
  const visitorPage = await visitor.newPage()
  await visitorPage.goto(lab.base)
  await visitorPage.getByTestId('theme-mode-light').click()
  const oldPersonal = await visitorPage.evaluate(() => {
    const app = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('app')
    const raw = JSON.stringify({ schemaVersion: 1, preset: 'custom', colors: { ...app.managedPalette.colors, lightText: '#ABCDEF' } })
    localStorage.setItem('glassmorphism-plus:palette:v1:%2F', raw)
    localStorage.setItem('palette_unrelated_sentinel', 'preserved')
    return raw
  })
  await visitorPage.reload()
  await expect(visitorPage.getByTestId('palette-entry')).toHaveCount(0)
  const auditCalls = []
  page.on('request', (request) => {
    if (request.postData()?.includes('public:recordVisitorEvent'))
      auditCalls.push('recordVisitorEvent')
  })
  await page.getByTestId('palette-entry').click()
  await expect(page.getByTestId('palette-status')).toContainText('已验证管理权限')
  await page.getByTestId('palette-preset').selectOption('soft')
  page.once('dialog', dialog => dialog.accept())
  await page.getByTestId('palette-save-site').click()
  await expect(page.getByTestId('palette-notice')).toContainText('全站配色已保存。')
  const presetSaved = await readSettings()
  assert.equal(presetSaved.glassColorPreset, '柔和')
  assert.equal(presetSaved.glassCustomColors, before.glassCustomColors)
  for (const key of Object.keys(before).filter(key => key !== 'glassColorPreset'))
    assert.deepEqual(presetSaved[key], before[key], `Preset save preserved: ${key}`)

  await page.getByTestId('palette-entry').click()
  await expect(page.getByTestId('palette-status')).toContainText('已验证管理权限')
  await page.getByRole('button', { name: '编辑浅色', exact: true }).click()
  await page.getByTestId('palette-field-Text').click()
  await page.locator('#palette-hex').fill('#234567')
  page.once('dialog', dialog => dialog.accept())
  await page.getByTestId('palette-save-site').click()
  await expect(page.getByTestId('palette-notice')).toContainText('全站配色已保存。')
  const customSaved = await readSettings()
  assert.equal(customSaved.glassColorPreset, '自定义')
  const colors = JSON.parse(customSaved.glassCustomColors)
  assert.equal(Object.keys(colors).length, 10)
  assert.equal(colors.lightText, '#234567')
  for (const key of Object.keys(before).filter(key => !['glassColorPreset', 'glassCustomColors'].includes(key)))
    assert.deepEqual(customSaved[key], before[key], `Custom save preserved: ${key}`)
  await visitorPage.reload()
  await expect(visitorPage.locator('.node-card').first()).toHaveCSS('color', 'rgb(35, 69, 103)')
  assert.equal(await visitorPage.evaluate(() => localStorage.getItem('glassmorphism-plus:palette:v1:%2F')), oldPersonal)
  assert.equal(await visitorPage.evaluate(() => localStorage.getItem('palette_unrelated_sentinel')), 'preserved')
  await expect(visitorPage.getByTestId('palette-entry')).toHaveCount(0)
  await visitor.close()

  // Inspect actual lazy-load requests and compare served bytes with the installer.
  const urls = await page.evaluate(() => performance.getEntriesByType('resource').map(entry => entry.name))
  const assets = [...new Set(urls)].filter(url => url.startsWith(lab.base) && assetUrl.test(url))
  assert(assets.some(url => paletteChunk.test(url)), 'Lazy palette chunk must really load')
  for (const url of assets) {
    const name = `dist${new URL(url).pathname}`
    assert(files.has(name), `Requested asset belongs to installer: ${name}`)
    const response = await fetch(url)
    assert.equal(response.status, 200)
    assert.match(response.headers.get('content-type'), name.endsWith('.js') ? javascriptMime : stylesheetMime)
    assert.equal(digest(Buffer.from(await response.arrayBuffer())), digest(files.get(name)), `HTTP payload parity: ${name}`)
  }
  for (const name of ['dist/index.html', 'dist/sw.js', 'preview.png']) {
    const response = await fetch(`${lab.base}/themes/glassmorphism-plus/${name}`)
    assert.equal(response.status, 200)
    assert.equal(digest(Buffer.from(await response.arrayBuffer())), digest(files.get(name)), `Direct theme route: ${name}`)
  }
  // The official backup form must read and write exactly the same two fields.
  // Exercise its normal UI, never patch the bundled admin application.
  await page.goto(`${lab.base}/admin/settings/theme`)
  const skipTour = page.getByRole('button', { name: '跳过', exact: true }).first()
  if (await skipTour.isVisible())
    await skipTour.click()
  await page.getByRole('button', { name: 'glassmorphism-plus设置', exact: true }).click()
  const presetRow = page.getByText('毛玻璃配色方案', { exact: true }).locator('../..')
  await expect(presetRow.getByRole('button')).toHaveText('自定义')
  const customInput = page.getByText('自定义毛玻璃颜色 JSON', { exact: true }).locator('xpath=ancestor::div[.//textarea][1]').locator('textarea')
  await expect(customInput).toHaveValue(customSaved.glassCustomColors)
  const backendColors = { ...colors, lightText: '#345678' }
  await customInput.fill(JSON.stringify(backendColors))
  await page.getByRole('button', { name: '保存', exact: true }).first().click()
  await expect.poll(async () => JSON.parse((await readSettings()).glassCustomColors).lightText).toBe('#345678')
  const backendSaved = await readSettings()
  // The older official form serializes manifest fields only. This is an upstream
  // limitation, not permission to discard unknown fields in our palette/Ping flow.
  const officialFormRemovedUnknownKeys = Object.keys(customSaved).filter(key => !(key in backendSaved))
  assert.deepEqual(officialFormRemovedUnknownKeys, version === '1.6.0' ? [] : ['futureOpaqueSetting', 'themeColor'])
  for (const key of Object.keys(customSaved).filter(key => key !== 'glassCustomColors' && !officialFormRemovedUnknownKeys.includes(key)))
    assert.deepEqual(backendSaved[key], customSaved[key], `Official form preserved: ${key}`)
  // Re-seed only the synthetic unknown sentinel so the subsequent Plus writer
  // must preserve it too. Do not hide the official form's removal in the report.
  for (const key of officialFormRemovedUnknownKeys)
    backendSaved[key] = customSaved[key]
  if (officialFormRemovedUnknownKeys.length)
    await lab.request('/api/admin/theme/settings?theme=glassmorphism-plus', { auth: true, body: backendSaved })
  await page.goto(`${lab.base}/?view=pingsettings&pingtab=config`)
  await expect(page.getByTestId('ping-center-three-network-switch')).toHaveAttribute('aria-checked', 'true')
  await page.getByTestId('ping-center-three-network-switch').click()
  await page.getByTestId('ping-center-save-preview').click()
  await page.getByTestId('ping-center-save-confirm').click()
  await expect.poll(async () => (await readSettings()).nodeCardPingDisplayConfigV3).not.toBe(backendSaved.nodeCardPingDisplayConfigV3)
  const pingSaved = await readSettings()
  const wire = pingSaved.nodeCardPingDisplayConfigV3
  const ping = JSON.parse(wire.startsWith('v3:') ? Buffer.from(wire.slice(3), 'base64').toString('utf8') : wire)
  assert.equal(ping.global.threeNetworkEnabled, false)
  for (const key of Object.keys(backendSaved).filter(key => key !== 'nodeCardPingDisplayConfigV3'))
    assert.deepEqual(pingSaved[key], backendSaved[key], `Ping save preserved palette and other settings: ${key}`)
  await page.goto(lab.base)
  await page.getByTestId('palette-entry').click()
  await expect(page.getByTestId('palette-status')).toContainText('已验证管理权限')
  await page.getByRole('button', { name: '编辑浅色', exact: true }).click()
  await page.getByTestId('palette-field-Text').click()
  await expect(page.locator('#palette-hex')).toHaveValue('#345678')
  await page.getByRole('button', { name: '取消', exact: true }).click()
  if (version === '1.6.0') {
    const publicSettings = (await lab.request('/api/public')).data
    assert.equal(publicSettings.visitor_audit_enabled, undefined)
    assert.deepEqual(auditCalls, [])
  }
  // Return the full original settings for the remaining installation assertions.
  await lab.request('/api/admin/theme/settings?theme=glassmorphism-plus', { auth: true, body: before })
  assert.deepEqual(await readSettings(), before)
  return { presetCanonical: true, customTenKeyString: true, unknownSettingsPreserved: true, guestReloadUsesSitePalette: true, oldPersonalRecordIgnoredAndPreserved: true, officialFormRoundtrip: true, officialFormRemovedUnknownKeys, pingSavePreservesPalette: true, realLazyAssets: assets.length, directThemeRoutes: true, removedAuditNotCalled: version === '1.6.0' }
}
