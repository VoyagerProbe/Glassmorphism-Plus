import type { Locator } from '@playwright/test'
import { expect, test } from '@playwright/test'
import { installKomariFixture, PRIMARY_NODE_UUID } from './fixtures/komari'

const triple = JSON.stringify({ schemaVersion: 3, global: { threeNetworkEnabled: true, taskIds: [101, 202, 303] }, nodes: {} })

test('aligned pending buckets keep their real button identity through first samples and rollover', async ({ page }) => {
  const fixture = await installKomariFixture(page, { nodeCount: 1, hideEarth: true, fakeTimers: true, nodeCardPingDisplayConfigV3: triple, nodeCardPingFixture: { metric: 'valid', thirdSharedTask: true } })
  const release = fixture.pausePingResponses()
  const strip = page.locator('[data-node-ping-task-id="202"]')
  const cells = strip.locator('[data-node-ping-bar]')
  const refs = await (async () => {
    try {
      await page.goto('/', { waitUntil: 'domcontentloaded' })
      await expect(strip).toHaveAttribute('data-node-ping-status', 'pending')
      await expect(strip).toHaveAttribute('data-node-ping-window-start', /T/)
      await expect(cells).toHaveCount(40)
      await expect.poll(async () => (await fixture.getPingRefreshDiagnostics()).pendingRpcRoutes).toBeGreaterThan(0)
      expect(await cells.evaluateAll(list => list.every(el => !el.hasAttribute('data-node-ping-bucket-start') && el.getAttribute('data-node-ping-state') === 'pending'))).toBe(true)
      return await strip.evaluateHandle(el => [...el.querySelectorAll('[data-node-ping-bar]')])
    }
    finally {
      release()
    }
  })()
  try {
    await expect(strip).toHaveAttribute('data-node-ping-status', 'data')
    const windowStart = Date.parse((await strip.getAttribute('data-node-ping-window-start'))!)
    const iso = (index: number) => new Date(windowStart + index * 180_000).toISOString()
    expect(await cells.evaluateAll((list, originals) => list.every((el, i) => el.isSameNode(originals[i]!)), refs)).toBe(true)
    expect(await cells.evaluateAll(list => list.map(el => el.getAttribute('data-node-ping-bucket-start')))).toEqual(Array.from({ length: 40 }, (_, i) => iso(i % 20)))
    await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1000))
    await page.clock.fastForward(180_000)
    await expect(cells.first()).toHaveAttribute('data-node-ping-bucket-start', iso(1))
    expect(await cells.evaluateAll((list, originals) => list.every((el, i) => i % 20 === 19 ? !originals.includes(el) : el.isSameNode(originals[i + 1]!)), refs)).toBe(true)
    await expect(cells.last()).toHaveAttribute('data-node-ping-bucket-start', iso(20))
  }
  finally {
    await refs.dispose()
  }
})

async function bounds(track: Locator) {
  return track.evaluate((el) => {
    const trackRect = el.getBoundingClientRect()
    return {
      left: trackRect.left,
      right: trackRect.right,
      width: trackRect.width,
      gap: Number.parseFloat(getComputedStyle(el).columnGap),
      cells: Array.from(el.querySelectorAll<HTMLElement>(':scope > [data-node-ping-bar]'), (cell) => {
        const hit = cell.getBoundingClientRect()
        const fill = cell.querySelector<HTMLElement>('[data-node-ping-bucket-fill]')!.getBoundingClientRect()
        return {
          left: hit.left,
          right: hit.right,
          width: hit.width,
          height: hit.height,
          fillHeight: fill.height,
          start: cell.dataset.nodePingBucketStart,
          end: cell.dataset.nodePingBucketEnd,
        }
      }),
    }
  })
}

test('roomy summaries have distinct decorative keys; narrow and outage readings stay uncluttered', async ({ page }) => {
  const fixture = await installKomariFixture(page, {
    nodeCount: 1,
    hideEarth: true,
    nodeCardSize: 'compact',
    nodeCardPingDisplayConfigV3: triple,
    nodeCardPingFixture: { metric: 'valid', thirdSharedTask: true, task202Latency: 999, task202Loss: 25 },
  })
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/')
  const strip = page.locator('[data-node-ping-task-id="202"]').first()
  const keys = strip.locator('.node-card-ping-summary > span')
  await expect(keys).toHaveCount(2)
  const appearance = () => keys.evaluateAll(items => items.map((el) => {
    const s = getComputedStyle(el, '::before')
    return { content: s.content, width: s.width, color: s.backgroundColor }
  }))
  const dots = await appearance()
  expect(dots.map(d => d.width)).toEqual(['4px', '4px'])
  expect(dots[0]!.color).not.toBe(dots[1]!.color)
  await page.setViewportSize({ width: 320, height: 844 })
  await expect.poll(async () => (await appearance()).map(d => d.content)).toEqual(['none', 'none'])
  await page.setViewportSize({ width: 1440, height: 900 })
  fixture.setNodeCardPingFixture({ metric: 'valid', thirdSharedTask: true, task202Latency: null, task202Loss: 100 })
  await page.reload()
  await expect(strip).toHaveAttribute('data-node-ping-outage', 'true')
  expect((await appearance()).map(d => d.content)).toEqual(['none', 'none'])
})

for (const dpr of [1, 2]) {
  test.describe(`A2 exact point targets at DPR ${dpr}`, () => {
    test.use({ deviceScaleFactor: dpr, hasTouch: true })

    test('paired time slots retain their endpoints and keyboard/touch targets when rotated', async ({ page }) => {
      await installKomariFixture(page, {
        hideEarth: true,
        nodeCount: 1,
        nodeCardSize: 'compact',
        nodeCardPingDisplayConfigV3: triple,
        nodeCardPingFixture: { metric: 'valid', thirdSharedTask: true, task202Latency: 999, task202Loss: 25 },
      })
      await page.goto('/')
      const task = page.locator(`[data-node-card-uuid="${PRIMARY_NODE_UUID}"] [data-node-ping-task-id="202"]`)
      const latency = task.locator('[data-node-ping-bars="latency"]')
      const loss = task.locator('[data-node-ping-bars="loss"]')
      const hits = latency.locator('[data-node-ping-bar]')
      await expect(hits.first()).toHaveAttribute('data-node-ping-bucket-start', /T/)
      for (const size of [{ width: 390, height: 844 }, { width: 844, height: 390 }, { width: 320, height: 844 }]) {
        await page.setViewportSize(size)
        await task.evaluate(async (el) => {
          await new Promise<void>(done => requestAnimationFrame(() => requestAnimationFrame(() => done())))
          const card = el.closest('.node-card')!
          await Promise.allSettled(card.getAnimations({ subtree: true })
            .filter(a => a.effect?.getComputedTiming().endTime !== Infinity)
            .map(a => a.finished))
        })
        const [a, b] = await Promise.all([bounds(latency), bounds(loss)])
        expect(a.cells).toHaveLength(20)
        expect(b.cells).toEqual(a.cells)
        expect(a.gap).toBe(2)
        expect(a.cells[0]!.left).toBeCloseTo(a.left, 1)
        expect(a.cells[19]!.right).toBeCloseTo(a.right, 1)
        for (const [i, cell] of a.cells.entries()) {
          expect(cell.height).toBe(14)
          expect(cell.fillHeight).toBe(8)
          expect(Math.abs(cell.width - (a.width - 19 * 2) / 20)).toBeLessThan(0.1)
          expect(Date.parse(cell.end!) - Date.parse(cell.start!)).toBe(180_000)
          if (i)
            expect(a.cells[i - 1]!.end).toBe(cell.start)
        }
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      }
      // Resizing crosses the mobile padding breakpoint. Finish the original
      // card's finite CSS transition before isolating pointer hover geometry.
      await latency.evaluate(async (el) => {
        el.scrollIntoView({ block: 'center' })
        const card = el.closest('.node-card')!
        getComputedStyle(card).getPropertyValue('padding')
        await Promise.allSettled(card.getAnimations({ subtree: true })
          .filter(animation => animation.effect?.getComputedTiming().endTime !== Infinity)
          .map(animation => animation.finished))
      })
      const tip = page.locator('.node-card-ping-bucket-tooltip:visible .node-card-ping-tooltip-time')
      for (const i of [0, 9, 19]) {
        const cell = hits.nth(i)
        const expected = (await cell.getAttribute('aria-label'))!.split('\n')[0]!
        const original = await bounds(latency)
        await cell.hover()
        await expect(tip).toHaveText(expected)
        expect(await bounds(latency)).toEqual(original)
        await page.mouse.move(0, 0)
        await cell.tap()
        await expect(tip).toHaveText(expected)
        await page.keyboard.press('Escape')
        await expect(tip).toHaveCount(0)
      }
      const a = await hits.nth(9).boundingBox()
      const b = await hits.nth(10).boundingBox()
      const gap = { x: (a!.x + a!.width + b!.x) / 2, y: a!.y + a!.height / 2 }
      expect(await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.matches('[data-node-ping-bars]'), gap)).toBe(true)
      await page.touchscreen.tap(gap.x, gap.y)
      await expect(tip).toHaveCount(0)
      await expect(page.getByRole('dialog')).toHaveCount(0)
      await hits.first().focus()
      for (let i = 0; i < 9; i++)
        await page.keyboard.press('ArrowRight')
      await expect(hits.nth(9)).toBeFocused()
      await expect(tip).toHaveText((await hits.nth(9).getAttribute('aria-label'))!.split('\n')[0]!)
      await page.keyboard.press('End')
      await expect(hits.nth(19)).toBeFocused()
      await page.keyboard.press('Home')
      await expect(hits.first()).toBeFocused()
    })
  })
}
