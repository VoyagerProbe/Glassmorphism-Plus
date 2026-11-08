import { expect, test } from '@playwright/test'
import { installKomariFixture } from './fixtures/komari'

test('A2 compact geometry stays tied to the actual homepage grid and palette', async ({ page }) => {
  const fixture = await installKomariFixture(page, { hideEarth: true, nodeCardSize: 'compact', nodeCount: 8, themeShort: 'glassmorphism-plus' })
  fixture.setThemeSetting('glassColorPreset', '自定义')
  await page.setViewportSize({ width: 1440, height: 920 })
  await page.goto('/')
  const home = page.locator('.gmp-a2')
  const card = home.locator('.a2-node').first()
  const grid = home.locator('.a2-node-grid')
  const title = card.locator('.a2-node-title')
  await expect(home).toHaveAttribute('data-density', 'compact')
  await expect(grid).toHaveCSS('column-gap', '20px')
  await expect(card).toHaveCSS('padding', '18px')
  await expect(card).toHaveCSS('border-radius', '20px')
  await expect(title).toHaveCSS('font-size', '16px')
  await expect(title).toHaveCSS('line-height', '22px')
  await expect(title).toHaveCSS('font-weight', '650')
  await expect(card.locator('.a2-badges > span').first()).toHaveCSS('line-height', '16px')
  await expect(card.locator('.a2-badges > span').first()).toHaveCSS('border-radius', '6px')
  await expect(card.locator('.a2-resources > div > .truncate').first()).toHaveCSS('font-size', '11.5px')
  await expect(card.locator('.a2-resources .justify-between > .tabular-nums').first()).toHaveCSS('font-size', '13px')
  const box = await card.boundingBox()
  expect(box!.width).toBeCloseTo((1360 - 2 * 32 - 2 * 20) / 3, 1)
  await expect(card.locator('.a2-info-bar')).toHaveCSS('border-radius', '12px')
  expect((await card.locator('.a2-info-bar').boundingBox())!.height).toBeGreaterThanOrEqual(54)
  const overview = home.locator('[data-general-card-key]').first()
  const tokenFill = await overview.evaluate((el) => {
    const swatch = document.createElement('span')
    swatch.style.backgroundColor = 'var(--a2-card)'
    el.append(swatch)
    const color = getComputedStyle(swatch).backgroundColor
    swatch.remove()
    return color
  })
  await expect(overview).toHaveCSS('background-color', tokenFill)
  await expect(page.locator('.default-background')).toHaveCSS('filter', 'none')
  const tools = page.getByTestId('header-actions')
  await expect(tools.getByRole('button', { name: '延迟监测中心' }).locator('.a2-action-label')).toBeVisible()
  await expect(tools.getByRole('button', { name: '配色中心' })).toHaveCSS('height', '36px')
  await expect(page.getByTestId('theme-mode-beijing')).toHaveCSS('height', '28px')
  await expect(page.getByTestId('theme-mode-beijing').locator('.a2-mode-label')).toBeVisible()
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 })
    await expect(card).toHaveCSS('padding', '16px')
    await expect(home.locator('.a2-toolbar')).toHaveCSS('flex-direction', 'row')
    const search = home.getByRole('textbox', { name: '搜索节点' })
    await search.fill('主控')
    await expect(card).toContainText('主控')
    const searchBox = (await search.boundingBox())!
    expect(searchBox.x).toBeGreaterThanOrEqual(0)
    expect(searchBox.x + searchBox.width).toBeLessThanOrEqual(width)
    await search.press('Escape')
    await expect(tools.getByRole('button', { name: '配色中心' })).toBeVisible()
    await expect(tools.getByRole('button', { name: '配色中心' }).locator('.a2-action-label')).toBeHidden()
    const metrics = home.locator('[data-general-card-key="disk"] .a2-stat-reading')
    await expect(metrics).toBeVisible()
    expect(await metrics.evaluate((el) => {
      const value = el.querySelector<HTMLElement>('.font-bold')!
      const unit = el.querySelector<HTMLElement>('.a2-stat-unit')!
      return value.scrollWidth <= value.clientWidth + 1 && unit.scrollWidth <= unit.clientWidth + 1 && document.documentElement.scrollWidth <= innerWidth
    })).toBe(true)
  }
  expect(fixture.getThemeSaveCount()).toBe(0)
})
