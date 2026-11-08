import { expect, test } from '@playwright/test'
import { installKomariFixture, PRIMARY_NODE_UUID } from './fixtures/komari'

const triple = JSON.stringify({ schemaVersion: 3, global: { threeNetworkEnabled: true, taskIds: [101, 202, 303] }, nodes: {} })

test('the four densities size the same full card independently without reloading its history or globe', async ({ page }) => {
  const fixture = await installKomariFixture(page, { fakeTimers: true, earthRenderer: 'cobe', nodeCount: 3, nodeCardSize: 'comfortable', nodeCardPingFixture: { metric: 'valid', thirdSharedTask: true }, nodeCardPingDisplayConfigV3: triple })
  await page.setViewportSize({ width: 1353, height: 900 })
  await page.goto('/')
  const home = page.locator('.gmp-a2')
  const card = page.locator(`[data-node-card-uuid="${PRIMARY_NODE_UUID}"]`)
  const bars = card.locator('[data-node-ping-bar]')
  await expect(home).toHaveAttribute('data-density', 'comfortable')
  await expect(card.locator('[data-node-ping-status=data]')).toHaveCount(3)
  await expect(page.locator('.a2-overview canvas')).toBeVisible()
  await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1000))
  await fixture.waitForPingRefreshSettled()

  // Hold only the track's width constant, without scaling or clipping the card.
  // Real responsive column counts are checked without this test stylesheet below.
  const fixed = await page.addStyleTag({ content: '.a2-node-grid{grid-template-columns:400px!important}.a2-node,.a2-node *{transition:none!important}' })
  const canvas = await page.locator('.a2-overview canvas').elementHandle()
  const original = await bars.evaluateAll(list => list.map(b => [b.getAttribute('data-node-ping-bucket-start'), b.getAttribute('data-node-ping-state')]))
  const live = await bars.first().elementHandle()
  const calls = fixture.timeline.length
  const sizes = ['mini', 'compact', 'comfortable', 'large', 'invalid-size', null] as const
  const heights: number[] = []
  for (const size of sizes) {
    // Simulate a freshly delivered public setting, without saving preferences.
    await page.evaluate((next) => {
      const app = (document.querySelector('#app') as any).__vue_app__.config.globalProperties.$pinia._s.get('app')
      const settings = { ...app.publicSettings.theme_settings }
      if (next === null)
        delete settings.nodeCardSize
      else
        settings.nodeCardSize = next
      app.publicSettings = { ...app.publicSettings, theme_settings: settings }
    }, size)
    await expect(home).toHaveAttribute('data-density', size === null || size === 'invalid-size' ? 'compact' : size)
    const rect = await card.boundingBox()
    expect(rect!.width).toBe(400)
    heights.push(rect!.height)
    await expect(card.locator('.a2-resources [data-node-metric-icon]')).toHaveCount(size === 'mini' ? 0 : 4)
    expect(await bars.evaluateAll(list => list.map(b => [b.getAttribute('data-node-ping-bucket-start'), b.getAttribute('data-node-ping-state')]))).toEqual(original)
    expect(await live!.evaluate(b => b.isConnected)).toBe(true)
    expect(await canvas!.evaluate(c => c === document.querySelector('.a2-overview canvas'))).toBe(true)
  }
  expect(heights[0]!).toBeLessThan(heights[1]!)
  expect(heights[1]!).toBeLessThan(heights[2]!)
  expect(heights[2]!).toBeLessThan(heights[3]!)
  expect(heights.slice(4)).toEqual([heights[1], heights[1]])
  // A host without an explicit density marker must paint like default compact.
  await home.evaluate(h => h.removeAttribute('data-density'))
  expect((await card.boundingBox())!.height).toBe(heights[1])
  await fixed.evaluate(s => s.remove())
  for (const [width, count] of [[1353, 3], [768, 2], [390, 1], [320, 1]] as const) {
    await page.setViewportSize({ width, height: 900 })
    expect(await page.locator('.a2-node-grid').evaluate(g => getComputedStyle(g).gridTemplateColumns.split(' ').length)).toBe(count)
    expect(await card.evaluate(c => c.scrollWidth - c.clientWidth)).toBeLessThanOrEqual(1)
  }
  expect(fixture.timeline.length).toBe(calls)
  expect(fixture.getThemeSaveCount()).toBe(0)
})

test('default compact legacy rails keep two aligned interactive tracks after reopening the site', async ({ page }) => {
  const fixture = await installKomariFixture(page, { hideEarth: true, nodeCount: 3, nodeCardPingDisplayConfigV3: JSON.stringify({ schemaVersion: 3, global: { threeNetworkEnabled: false, taskIds: [null, null, null] }, nodes: {} }) })
  fixture.setThemeSetting('nodeCardSize', undefined)
  const home = page.locator('.gmp-a2')
  const group = page.locator(`[data-node-card-uuid="${PRIMARY_NODE_UUID}"] .a2-legacy-ping`)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  await expect(home).toHaveAttribute('data-density', 'compact')
  await expect(group).toHaveCSS('margin-block-start', '12px')
  for (const metric of ['latency', 'loss']) {
    const grid = group.locator(`[data-node-ping-bars="${metric}"]`)
    await expect(grid).toHaveCSS('column-gap', '2px')
    await expect(grid.locator('button')).toHaveCount(20)
    await expect(grid.locator('button').nth(9)).toHaveCSS('height', '14px')
    await expect(grid.locator('[data-node-ping-bucket-fill]').nth(9)).toHaveCSS('height', '8px')
    await expect(group.locator(`[data-node-ping-header="${metric}"] svg`)).toHaveCSS('width', '14px')
  }
  // Existing saved global density (set by the isolated backend), not a client override.
  fixture.setThemeSetting('nodeCardSize', 'comfortable')
  await page.reload()
  await expect(home).toHaveAttribute('data-density', 'comfortable')
  await expect(group).toHaveCSS('margin-block-start', '16px')
  await expect(group.locator('button[data-node-ping-bar]')).toHaveCount(40)
  expect(fixture.getThemeSaveCount()).toBe(0)
})
