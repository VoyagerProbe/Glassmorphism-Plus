import type { Page } from '@playwright/test'
import { expect, test } from '@playwright/test'
import { installKomariFixture, PRIMARY_NODE_UUID } from './fixtures/komari'
import { CUSTOM_COLORS } from './fixtures/palette'

const changed = {
  lightCard: '#DDEAF1EA',
  lightControl: '#ABCDD8FA',
  lightText: '#172E40',
  lightMutedText: '#355A70',
  lightBorder: '#627F91CC',
  darkCard: '#22364BEA',
  darkControl: '#344D63FA',
  darkText: '#EDF3FF',
  darkMutedText: '#B3CADB',
  darkBorder: '#809BAFCC',
}

type Role = 'Card' | 'Control' | 'Text' | 'MutedText' | 'Border'
type Sample = [string, string, Role]
const detail: Sample[] = [
  ['.gp-detail .gp-surface', 'backgroundColor', 'Card'],
  ['.gp-detail .detail-field', 'backgroundColor', 'Control'],
  ['.detail-selector', 'backgroundColor', 'Control'],
  ['.detail-identity', 'color', 'Text'],
  ['.gp-detail .gp-surface .text-muted-foreground', 'color', 'MutedText'],
  ['[data-load-chart-card="cpu"]', 'borderTopColor', 'Border'],
  ['.gp-detail .ping-chart-host', 'backgroundColor', 'Card'],
]
const modal: Sample[] = [
  ['.gp-ping-viewer', 'backgroundColor', 'Card'],
  ['.gp-ping-viewer [data-ping-chart-task-id]', 'backgroundColor', 'Control'],
  ['.gp-ping-viewer [role="tablist"]', 'backgroundColor', 'Control'],
  ['.gp-ping-viewer h2', 'color', 'Text'],
  ['.gp-ping-viewer [data-app-dialog-header] p', 'color', 'MutedText'],
  ['.gp-ping-viewer .ping-chart-host', 'borderTopColor', 'Border'],
]

async function paletteMatches(page: Page, mode: 'light' | 'dark', colors: typeof CUSTOM_COLORS, samples: Sample[]) {
  await expect.poll(() => page.evaluate(({ samples, colors, mode }) => {
    const reference = document.createElement('span')
    document.body.append(reference)
    try {
      return samples.flatMap(([selector, property, part]) => {
        reference.style.color = colors[`${mode}${part}`]
        const el = document.querySelector(selector)
        const actual = el && getComputedStyle(el)[property as 'color']
        const expected = getComputedStyle(reference).color
        return actual === expected ? [] : [{ selector, property, actual, expected }]
      })
    }
    finally { reference.remove() }
  }, { samples, colors, mode })).toEqual([])
}

type Mode = 'light' | 'dark'

async function openPaletteFixture(page: Page, mode: Mode) {
  await page.setViewportSize({ width: mode === 'light' ? 1353 : 390, height: 844 })
  const fixture = await installKomariFixture(page, { themeShort: 'glassmorphism-plus', dark: mode === 'dark', nodeCount: 3, hideEarth: true, adminAccess: 'admin', preserveStorageOnReload: true, nodeCardPingFixture: { metric: 'valid', thirdSharedTask: true } })
  fixture.setThemeSetting('glassColorPreset', '自定义')
  fixture.setThemeSetting('glassCustomColors', JSON.stringify(CUSTOM_COLORS))
  await page.goto('/')
  const card = page.locator(`[data-node-card-uuid="${PRIMARY_NODE_UUID}"]`)
  async function importDraft() {
    await page.getByTestId('palette-entry').click()
    await expect(page.getByTestId('palette-status')).toContainText('已验证管理权限')
    await page.locator('.palette-advanced summary').click()
    await page.locator('#palette-json').fill(JSON.stringify(changed))
    await page.getByRole('button', { name: '导入', exact: true }).click()
  }
  async function openAndClose(colors: typeof changed) {
    await card.locator('[data-node-ping-header="latency"]').first().click()
    const viewer = page.locator('.gp-ping-viewer')
    await expect(viewer).toBeVisible()
    expect(await viewer.evaluate(el => !el.closest('#app'))).toBe(true)
    await paletteMatches(page, mode, colors, modal)
    await page.keyboard.press('Escape')
    await expect(viewer).toHaveCount(0)
  }
  return { card, fixture, importDraft, openAndClose }
}

for (const mode of ['light', 'dark'] as const) {
  test(`Ping viewer previews and cancels the unsaved ${mode} palette`, async ({ page }, info) => {
    const { fixture, importDraft, openAndClose } = await openPaletteFixture(page, mode)
    await importDraft()
    // Opening this body-mounted viewer must not leave the editor or save the draft.
    await openAndClose(changed)
    await page.getByRole('button', { name: '取消', exact: true }).click()
    expect(fixture.getThemeSaveCount()).toBe(0)
    await openAndClose(CUSTOM_COLORS)
    expect(fixture.getThemeSaveCount()).toBe(0)
    await info.attach('palette-coverage', { body: JSON.stringify({ mode, modal }), contentType: 'application/json' })
  })

  test(`Ping viewer and both node detail pages read back the saved ${mode} palette`, async ({ page }, info) => {
    const { card, fixture, importDraft, openAndClose } = await openPaletteFixture(page, mode)
    await importDraft()
    await page.getByTestId('palette-save-site').click()
    await expect(page.getByTestId('palette-notice')).toContainText('已保存')
    expect(fixture.getThemeSaveCount()).toBe(1)
    await page.reload()
    await openAndClose(changed)
    await page.goto(`/instance/${PRIMARY_NODE_UUID}`)
    await paletteMatches(page, mode, changed, detail)
    await page.getByRole('button', { name: '下一个节点' }).click()
    await expect(page).not.toHaveURL(new RegExp(PRIMARY_NODE_UUID))
    await paletteMatches(page, mode, changed, detail)
    await page.getByRole('button', { name: '返回首页' }).click()
    await expect(card).toBeVisible()
    expect(fixture.getThemeSaveCount()).toBe(1)
    await info.attach('palette-coverage', { body: JSON.stringify({ mode, modal, detail }), contentType: 'application/json' })
  })
}
