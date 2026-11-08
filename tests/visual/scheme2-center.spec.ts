import { expect, test } from '@playwright/test'
import { installKomariFixture } from './fixtures/komari'

const overview = '/?view=pingsettings&pingtab=overview'
const config = '/?view=pingsettings&pingtab=config'

test('Scheme 2 task directory stays a public, scrollable catalog without sampling history', async ({ page }) => {
  const admin: string[] = []
  page.on('request', (request) => {
    const path = new URL(request.url()).pathname
    if (path.startsWith('/api/admin/'))
      admin.push(path)
  })
  const fixture = await installKomariFixture(page, { adminAccess: 'guest', nodeCount: 30, nodeCardPingFixture: { metric: 'valid', thirdSharedTask: true } })
  await page.goto(overview)
  const cards = page.getByTestId('ping-center-overview')
  const task = page.getByTestId('ping-center-public-task-101')
  const chips = page.getByTestId('ping-center-covered-nodes-101').getByRole('list')
  await expect(cards.locator('.ping-stat-grid > .gp-surface')).toHaveCount(4)
  await expect(chips.getByRole('listitem')).toHaveCount(30)
  await expect(task.locator('h2')).toHaveCSS('font-size', '16px')
  await expect(page.getByTestId('ping-center-tab-settings')).toHaveCount(0)
  for (const [width, columnCount] of [[1440, 3], [768, 2], [390, 1], [320, 1]]) {
    await page.setViewportSize({ width, height: 844 })
    expect(await task.evaluate(el => getComputedStyle(el.parentElement!).gridTemplateColumns.split(' ').length)).toBe(columnCount)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  }
  await chips.focus()
  await expect(chips).toBeFocused()
  const last = chips.getByRole('listitem').last()
  await chips.press('End')
  await expect.poll(() => chips.evaluate(el => el.scrollTop)).toBeGreaterThan(0)
  await expect(last).toBeInViewport()
  expect(admin).toEqual([])
  expect(fixture.timeline).toEqual([])
})

test('Scheme 2 keeps public loading, empty and error states distinct', async ({ page }) => {
  await installKomariFixture(page, { adminAccess: 'guest' })
  let resolveCatalog!: () => void
  const gate = new Promise<void>(resolve => resolveCatalog = resolve)
  let fail = false
  await page.route('**/api/rpc2', async (route) => {
    const payload = route.request().postDataJSON()
    if (payload?.method !== 'public:getPublicPingTasks')
      return route.fallback()
    await gate
    const response = fail ? { error: { code: -32602, message: 'Catalog temporarily unavailable' } } : { result: [] }
    return route.fulfill({ json: { jsonrpc: '2.0', id: payload.id, ...response } })
  })
  await page.goto(overview)
  await expect(page.getByTestId('ping-center-public-loading')).toBeVisible()
  resolveCatalog()
  await expect(page.getByText('当前没有公开 Ping 任务。')).toBeVisible()
  fail = true
  await page.reload()
  await expect(page.getByTestId('ping-center-public-error')).toBeVisible()
  await expect(page.getByText('当前没有公开 Ping 任务。')).toHaveCount(0)
  await expect(page.getByTestId('ping-center-tab-settings')).toHaveCount(0)
})

test('Scheme 2 admin controls and portalled editor fit a narrow viewport and keep native inputs', async ({ page }) => {
  const fixture = await installKomariFixture(page, {
    adminAccess: 'admin',
    nodeCount: 6,
    nodeCardPingFixture: { metric: 'valid', thirdSharedTask: true },
    nodeCardPingDisplayConfigV3: JSON.stringify({ schemaVersion: 3, global: { threeNetworkEnabled: true, taskIds: [101, 202, 303] }, nodes: {} }),
  })
  await page.setViewportSize({ width: 320, height: 744 })
  await page.goto(config)
  const global = page.getByTestId('ping-center-global-config')
  await expect(global.getByRole('combobox')).toHaveCount(3)
  await expect(global.getByRole('combobox').first()).toHaveCSS('height', '38px')
  expect(await global.getByRole('combobox').first().evaluate(el => el.tagName)).toBe('SELECT')
  const filter = page.getByTestId('ping-center-settings-filter')
  await filter.getByRole('button').last().focus()
  await expect(filter.getByRole('button').last()).toBeFocused()
  await page.getByRole('button', { name: '单节点配置' }).first().click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toHaveClass(/gp-ping-dialog/)
  expect(await dialog.evaluate(el => el.closest('.gp-ping-center') === null)).toBe(true)
  await page.getByTestId('ping-center-node-mode-custom').click()
  await expect(dialog.getByRole('combobox')).toHaveCount(3)
  for (const width of [320, 390, 768]) {
    await page.setViewportSize({ width, height: 844 })
    expect(await dialog.evaluate(el => el.getBoundingClientRect().left >= 0 && el.getBoundingClientRect().right <= innerWidth && el.scrollWidth <= el.clientWidth)).toBe(true)
  }
  await dialog.getByRole('button', { name: '取消' }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  expect(fixture.getThemeSaveCount()).toBe(0)
})
