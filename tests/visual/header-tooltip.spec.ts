import type { Locator, Page } from '@playwright/test'
import { expect, test } from '@playwright/test'
import { installKomariFixture, PRIMARY_NODE_UUID } from './fixtures/komari'

const bubbles = (page: Page) => page.locator('[data-header-tooltip]:visible')

async function expectBubble(page: Page, name: string) {
  await expect(bubbles(page)).toHaveCount(1)
  await expect(bubbles(page)).toContainText(name)
  await expect(bubbles(page)).toHaveAttribute('data-side', 'bottom')
}

async function noNativeTitle(button: Locator) {
  expect(await button.evaluate((element) => {
    const nodes = [element, ...element.querySelectorAll('*')]
    for (let parent = element.parentElement; parent; parent = parent.parentElement)
      nodes.push(parent)
    return nodes.filter(node => node.getAttribute('title')?.trim() || node.tagName.toLowerCase() === 'title').length
  })).toBe(0)
}

for (const scenario of [
  { name: 'dark', mode: 'dark' as const, dark: true, time: '2026-09-04T00:30:00Z' },
  { name: 'light', mode: 'light' as const, dark: false, time: '2026-09-04T12:30:00Z' },
  { name: 'automatic night', mode: 'beijing' as const, dark: true, time: '2026-09-04T12:30:00Z' },
  { name: 'automatic day', mode: 'beijing' as const, dark: false, time: '2026-09-04T00:30:00Z' },
]) {
  test(`Header Tooltip: ${scenario.name} uses one custom bubble without a native title`, async ({ page }, info) => {
    await installKomariFixture(page, { managedThemeMode: scenario.mode, clockNow: scenario.time, hideEarth: true, adminAccess: 'admin' })
    await page.goto('/')
    for (const name of ['显示首页工具', '延迟监测中心', '后台管理']) {
      const button = page.getByRole('button', { name, exact: true })
      await button.hover()
      await expectBubble(page, name)
      await noNativeTitle(button)
      if (scenario.name === 'dark' && name === '显示首页工具') {
        await page.waitForTimeout(2500)
        await expectBubble(page, name)
        await noNativeTitle(button)
      }
      const style = await bubbles(page).evaluate((element) => {
        const s = getComputedStyle(element)
        const arrow = element.querySelector('svg')!
        const a = getComputedStyle(arrow)
        const ctx = document.createElement('canvas').getContext('2d')!
        const rgb = (color: string) => {
          ctx.fillStyle = color
          ctx.fillRect(0, 0, 1, 1)
          return Array.from(ctx.getImageData(0, 0, 1, 1).data)
        }
        const r = element.getBoundingClientRect()
        return { background: rgb(s.backgroundColor), text: rgb(s.color), arrow: rgb(a.fill), radius: Number.parseFloat(s.borderRadius), padding: Number.parseFloat(s.paddingLeft), opacity: s.opacity, left: r.left, right: r.right, width: r.width, viewport: innerWidth }
      })
      expect(style.background[0]! > style.text[0]!).toBe(scenario.dark)
      expect(Math.abs(style.background[0]! - style.text[0]!)).toBeGreaterThan(140)
      expect(style.arrow).toEqual(style.background)
      expect(style.radius).toBeGreaterThan(0)
      expect(style.padding).toBeGreaterThan(0)
      expect(style.background[3]).toBe(255)
      await expect(bubbles(page)).toHaveCSS('opacity', '1')
      expect(style.left).toBeGreaterThanOrEqual(7)
      expect(style.right).toBeLessThanOrEqual(style.viewport - 7)
      expect(style.width).toBeLessThan(240)
      const description = await button.getAttribute('aria-describedby')
      expect(description).toBeTruthy()
      await expect(page.locator(`[id="${description}"]`)).toContainText(name)
      await page.screenshot({ path: info.outputPath(`${scenario.name}-${name}.png`) })
      await bubbles(page).hover()
      await expectBubble(page, name)
      await page.mouse.move(10, 300)
      await expect(bubbles(page)).toHaveCount(0)
    }
  })
}

test('Header Tooltip: keyboard order, dynamic tools and single action audit', async ({ page }) => {
  await installKomariFixture(page, { adminAccess: 'admin', hideEarth: true, visitorAuditEnabled: true })
  const events: Array<{ event: string, target?: string }> = []
  await page.route('**/rpc2', async (route) => {
    const request = route.request().postDataJSON()
    if (request?.method !== 'public:recordVisitorEvent')
      return route.fallback()
    events.push({ event: request.params.event, target: request.params.target })
    return route.fulfill({ json: { jsonrpc: '2.0', id: request.id, result: { status: 'success' } } })
  })
  await page.goto('/?retained=fixture')
  const actions = page.getByTestId('header-actions')
  const names = ['浅色模式', '北京时间自动', '深色模式', '显示首页工具', '延迟监测中心', '后台管理']
  await expect(actions.locator('button')).toHaveCount(6)
  await page.getByTestId('theme-mode-light').focus()
  for (const [i, name] of names.entries()) {
    const button = actions.getByRole('button', { name, exact: true })
    await expect(button).toBeFocused()
    await expectBubble(page, name)
    await noNativeTitle(button)
    await page.keyboard.press('Escape')
    await expect(bubbles(page)).toHaveCount(0)
    if (i < names.length - 1)
      await page.keyboard.press('Tab')
  }
  await page.getByTestId('theme-mode-dark').focus()
  await page.keyboard.press('Enter')
  await expect(page.getByTestId('theme-mode-dark')).toHaveAttribute('aria-pressed', 'true')
  await expect.poll(() => events.filter(e => e.event === 'theme_mode_change')).toEqual([{ event: 'theme_mode_change', target: 'dark' }])
  const tools = actions.getByRole('button', { name: '显示首页工具', exact: true })
  await tools.focus()
  await page.keyboard.press('Space')
  const collapse = actions.getByRole('button', { name: '收起首页工具', exact: true })
  await expect(collapse).toHaveAttribute('aria-pressed', 'true')
  await page.mouse.move(10, 300)
  await collapse.hover()
  await expectBubble(page, '收起首页工具')
  await collapse.click()
  await expect(tools).toHaveAttribute('aria-pressed', 'false')
  await page.getByTestId('ping-center-entry').click()
  await expect(page).toHaveURL(/retained=fixture.*view=pingsettings.*pingtab=overview/)
  await expect(bubbles(page)).toHaveCount(0)
  await expect(page.getByTestId('ping-center-overview')).toBeVisible()
  await page.getByRole('button', { name: '返回首页', exact: true }).click()
  await expect(bubbles(page)).toHaveCount(0)
  let adminRequests = 0
  await page.route('**/admin', (route) => {
    adminRequests++
    // Keep this synthetic document alive to observe the existing fire-and-forget
    // audit call; a real navigation can cancel its network delivery on unload.
    return route.fulfill({ status: 204 })
  })
  await actions.getByRole('button', { name: '后台管理', exact: true }).click()
  await expect.poll(() => adminRequests).toBe(1)
  await expect.poll(() => events.filter(e => e.event === 'admin_entry_click')).toHaveLength(1)
})

for (const width of [360, 390]) {
  test(`Header Tooltip: ${width}px touch actions and hybrid input have no ghost bubble`, async ({ browser, baseURL }) => {
    const context = await browser.newContext({ baseURL, viewport: { width, height: 844 }, hasTouch: true, isMobile: true })
    const page = await context.newPage()
    try {
      await installKomariFixture(page, { hideEarth: true, adminAccess: 'admin' })
      await page.goto('/')
      await page.getByTestId('theme-mode-dark').tap()
      await expect(page.getByTestId('theme-mode-dark')).toHaveAttribute('aria-pressed', 'true')
      await page.getByRole('button', { name: '显示首页工具', exact: true }).tap()
      await expect(page.getByRole('button', { name: '收起首页工具', exact: true })).toHaveAttribute('aria-pressed', 'true')
      await expect(bubbles(page)).toHaveCount(0)
      await page.getByTestId('ping-center-entry').tap()
      await expect(page.getByTestId('ping-center-overview')).toBeVisible()
      await expect(bubbles(page)).toHaveCount(0)
      await page.getByRole('button', { name: '返回首页', exact: true }).tap()
      await expect(bubbles(page)).toHaveCount(0)
      const dark = page.getByTestId('theme-mode-dark')
      await dark.hover()
      await expectBubble(page, '深色模式')
      await page.mouse.move(10, 300)
      await expect(bubbles(page)).toHaveCount(0)
      await page.getByTestId('theme-mode-light').focus()
      await expectBubble(page, '浅色模式')
      await page.keyboard.press('Escape')
      await expect(bubbles(page)).toHaveCount(0)
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      await expect(page.getByTestId('header-actions').locator('button')).toHaveCount(6)
      await noNativeTitle(dark)
    }
    finally {
      await context.close()
    }
  })
}

test('Header Tooltip: hidden guest entries and detail route stay scoped', async ({ page }) => {
  await installKomariFixture(page, { hideEarth: true, hideAdminEntryWhenLoggedOut: true, hidePingTaskBindingEntry: true })
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Komari Visual Lab', exact: true })).toBeVisible()
  await expect(page.getByTestId('header-actions').locator('button')).toHaveCount(4)
  await expect(page.getByTestId('ping-center-entry')).toHaveCount(0)
  await expect(page.getByRole('button', { name: '后台管理', exact: true })).toHaveCount(0)
  await page.goto(`/instance/${PRIMARY_NODE_UUID}`)
  await expect(page.getByTestId('header-actions').locator('button')).toHaveCount(3)
  await page.getByTestId('theme-mode-dark').hover()
  await expectBubble(page, '深色模式')
  await page.goBack()
  await expect(bubbles(page)).toHaveCount(0)
})
