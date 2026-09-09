import type { Locator, Page } from '@playwright/test'
import { expect, test } from '@playwright/test'
import { placePingTooltip } from '../../src/utils/pingTooltipPlacement'
import { installKomariFixture, PRIMARY_NODE_UUID } from './fixtures/komari'

test.use({ launchOptions: { ignoreDefaultArgs: ['--hide-scrollbars'] } })
const fractions = [5, 25, 49, 50, 51, 75, 95]
const names = [...Array.from({ length: 13 }, (_, i) => `Region ${i + 1}`), 'BandwagonHost / Cluster Logic Inc', '很长的中文任务名称 <unsafe>']

async function setup(page: Page, modal: boolean, count = 15) {
  await installKomariFixture(page, { hideEarth: true, nodeCount: 2, nodeCardPingFixture: { metric: 'valid' } })
  const calls: string[] = []
  const errors: string[] = []
  page.on('pageerror', e => errors.push(e.message))
  await page.route('**/rpc2', async (route) => {
    const { method, params = {}, id } = route.request().postDataJSON()
    if (!['public:getPublicPingTasks', 'public:getPingMetricStats', 'public:queryMetrics'].includes(method)
      || (method === 'public:queryMetrics' && !params.metric_keys?.includes('ping.latency_ms'))) {
      return route.fallback()
    }
    calls.push(method)
    const tasks = names.slice(0, count).map((name, i) => ({ id: 101 + i, name, clients: [PRIMARY_NODE_UUID, '00000000-0000-4000-8000-000000000002'], interval: 36, type: 'icmp' }))
    const end = Date.parse(params.end ?? '2026-07-25T12:00:00Z')
    const start = Date.parse(params.start ?? new Date(end - 3600000).toISOString())
    const result = method === 'public:getPublicPingTasks'
      ? tasks
      : method === 'public:getPingMetricStats'
        ? { stats: tasks.map(t => ({ ...t, entity_id: params.entity_id, task_id: String(t.id), total: 101, valid: 100, avg: 20, loss: 1 })) }
        : { series: tasks.flatMap((t, n) => ['ping.latency_ms', 'ping.loss'].map(metric_key => ({
            metric_key,
            entity_id: params.entity_id,
            tags: { task_id: String(t.id), task_name: t.name },
            interval_seconds: 36,
            count: 101,
            points: Array.from({ length: 101 }, (_, i) => ({ time: new Date(start + (end - start) * i / 100).toISOString(), value: metric_key === 'ping.loss' ? (i === 50 && n === count - 1 ? 1 : 0) : (i === 50 && n === count - 1 ? null : 20 + n + i % 5), count: 1 })),
          }))) }
    await route.fulfill({ json: { jsonrpc: '2.0', id, result } })
  })
  await page.goto(modal ? '/' : `/instance/${PRIMARY_NODE_UUID}`)
  if (modal)
    await page.locator(`[data-node-card-uuid="${PRIMARY_NODE_UUID}"] [data-node-ping-panel="latency"]`).first().click()
  const owner = modal ? page.getByRole('dialog').locator('[data-ping-chart]') : page.locator('[data-ping-chart]')
  await expect(owner).toHaveAttribute('data-ping-chart-visible-task-ids', names.slice(0, count).map((_, i) => 101 + i).join(','))
  return { owner, calls, errors }
}

async function api(owner: Locator, action = 'inspect', value = 50, axis = 0): Promise<any> {
  return owner.locator('x-vue-echarts').evaluate((el, { action, value, axis }) => {
    const find = (n: any): any => {
      if (!n)
        return null
      if (n.el === el && n.component?.exposed?.getOption)
        return n.component.exposed
      for (const child of [n.component?.subTree, n.suspense?.activeBranch, ...(Array.isArray(n.children) ? n.children : [])]) {
        const found = find(child)
        if (found)
          return found
      }
    }
    const chart = find((document.querySelector('#app') as any)._vnode)
    const o = chart.getOption()
    if (action === 'hide') {
      chart.dispatchAction({ type: 'hideTip' })
      chart.dispatchAction({ type: 'updateAxisPointer', currTrigger: 'leave' })
      return
    }
    const t = o.series[0].data[value][0]
    const x = chart.convertToPixel({ xAxisIndex: axis }, t)
    const box = el.getBoundingClientRect()
    const grid = o.grid[axis]
    const body = el.closest('[data-app-dialog-body]')?.getBoundingClientRect()
    const header = document.querySelector('[data-testid="header-actions"]')?.closest('.sticky')?.getBoundingClientRect().bottom ?? 0
    const top = Math.max(box.top + grid.top, body?.top ?? header, 0) + 4
    const bottom = Math.min(box.top + (grid.height ? grid.top + grid.height : box.height - grid.bottom), body?.bottom ?? innerHeight, innerHeight) - 4
    return { t, x: box.left + x, y: (top + bottom) / 2, hit: bottom > top, box: box.toJSON(), option: JSON.parse(JSON.stringify(o)) }
  }, { action, value, axis })
}

test('homepage full Ping modal enables existing dual chart', async ({ page }) => {
  const { owner, errors } = await setup(page, true)
  await expect(owner.getByRole('button', { name: '丢包数据', exact: true })).toBeVisible()
  await expect(owner).toHaveAttribute('data-ping-chart-loss', 'enabled')
  const state = await api(owner)
  expect(state.option.grid).toHaveLength(2)
  expect(state.option.yAxis[1]).toMatchObject({ min: 0, max: 100, interval: 20 })
  expect(state.option.legend).toHaveLength(1)
  expect(errors).toEqual([])
})

test.describe('mobile placement', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
  test('middle snapped time must not be covered by shared Tooltip', async ({ page }) => {
    const { owner } = await setup(page, false)
    await owner.locator('x-vue-echarts').scrollIntoViewIfNeeded()
    const p = await api(owner)
    expect(p.hit).toBe(true)
    await page.touchscreen.tap(p.x, p.y)
    const shell = owner.locator('.ping-shared-tooltip-shell')
    await expect(shell).toBeVisible()
    const box = (await shell.boundingBox())!
    const overlaps = box.x < p.x + 12 && box.x + box.width > p.x - 12 && box.y < p.box.y + p.box.height - 52 && box.y + box.height > p.box.y + 30
    expect(overlaps, 'Tooltip shell must not cover the snapped time band').toBe(false)
  })

  test('modal five cycles: docked scrolling, tap close, range retention, node isolation and cleanup', async ({ page, browserName }, info) => {
    await page.addInitScript(() => {
      const scrollListeners = new Set<EventListenerOrEventListenerObject>()
      const owners = new Map<HTMLElement, Set<EventListenerOrEventListenerObject>>()
      const add = EventTarget.prototype.addEventListener
      const remove = EventTarget.prototype.removeEventListener
      EventTarget.prototype.addEventListener = function (type, listener, options) {
        if (listener && type === 'scroll' && this === window)
          scrollListeners.add(listener)
        if (listener && type === 'pointerover' && this instanceof HTMLElement && this.classList.contains('ping-chart-host')) {
          if (!owners.has(this))
            owners.set(this, new Set())
          owners.get(this)!.add(listener)
        }
        return add.call(this, type, listener, options)
      }
      EventTarget.prototype.removeEventListener = function (type, listener, options) {
        if (listener && type === 'scroll' && this === window)
          scrollListeners.delete(listener)
        if (listener && type === 'pointerover' && this instanceof HTMLElement)
          owners.get(this)?.delete(listener)
        return remove.call(this, type, listener, options)
      }
      ;(window as any).__placementListeners = () => ({ scroll: scrollListeners.size, owners: Array.from(owners, ([el, set]) => ({ connected: el.isConnected, count: set.size })) })
    })
    const { owner, calls, errors } = await setup(page, true)
    const dialog = page.getByRole('dialog')
    let closedListeners: number | undefined
    const openAtMiddle = async () => {
      await owner.locator('x-vue-echarts').scrollIntoViewIfNeeded()
      let p = await api(owner)
      if (!p.hit)
        p = await api(owner, 'inspect', 50, 1)
      expect(p.hit).toBe(true)
      await page.touchscreen.tap(Math.round(p.x), Math.round(p.y))
      const shell = owner.locator('.ping-shared-tooltip-shell')
      await expect(shell).toHaveAttribute('data-ping-placement', 'docked')
      await expect(shell).toHaveAttribute('data-ping-time', String(p.t))
      return shell.locator('[data-ping-shared-tooltip]')
    }
    for (let cycle = 0; cycle < 5; cycle++) {
      if (cycle) {
        const uuid = cycle % 2 ? '00000000-0000-4000-8000-000000000002' : PRIMARY_NODE_UUID
        // Bucket taps intentionally open the mini bucket's own Tooltip. Use
        // the panel header to exercise the full-modal entry on touch devices.
        await page.locator(`[data-node-card-uuid="${uuid}"] [data-node-ping-header="latency"]`).first().tap()
      }
      await expect(owner).toHaveAttribute('data-ping-chart-loss', 'enabled')
      const tip = await openAtMiddle()
      const stamp = await tip.locator('.ping-tooltip-time').textContent()
      const requests = calls.length
      await tip.scrollIntoViewIfNeeded()
      await tip.hover()
      if (browserName === 'chromium') {
        await page.mouse.wheel(0, 700)
      }
      else {
        // Mobile WebKit has no Playwright wheel/touch-drag transport. Exercise
        // DOM scroll retention here; native touch dragging is Chromium-only.
        await tip.evaluate(el => el.scrollBy({ top: 700, behavior: 'instant' }))
      }
      await expect.poll(() => tip.evaluate(el => el.scrollTop)).toBeGreaterThan(20)
      await expect(tip.locator('.ping-tooltip-time')).toHaveText(stamp!)
      const last = tip.locator('.ping-tooltip-row:last-child [data-ping-loss]')
      await expect(last).toHaveText('100.0%')
      if (!cycle) {
        await dialog.screenshot({ path: info.outputPath('modal-docked-bottom.png') })
        if (browserName === 'chromium') {
          const session = await page.context().newCDPSession(page)
          const b = (await tip.boundingBox())!
          const x = b.x + b.width / 2
          const y = b.y + 45
          await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1 }] })
          for (let step = 1; step <= 10; step++) {
            await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y + step * 18, id: 1 }] })
            await page.waitForTimeout(16)
          }
          await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
          await page.waitForTimeout(600)
          await expect(tip).toBeVisible()
          await expect.poll(() => tip.evaluate(el => el.scrollTop)).toBe(0)
          await expect(tip.locator('.ping-tooltip-time')).toHaveText(stamp!)
          await session.detach()
        }
      }
      // A native content tap closes only this Tooltip, never the outer modal.
      const tapTarget = !cycle && browserName === 'chromium' ? tip.locator('.ping-tooltip-time') : last
      await tapTarget.scrollIntoViewIfNeeded()
      await page.waitForTimeout(160) // stop the deliberate scroll before tapping
      await tapTarget.tap()
      await expect(tip).toBeHidden()
      await expect(dialog).toBeVisible()
      expect((await api(owner)).option.xAxis.every((a: any) => a.axisPointer.status !== 'show')).toBe(true)
      await openAtMiddle()
      expect(calls.length).toBe(requests)
      if (cycle === 4) {
        for (const viewport of [{ width: 844, height: 390 }, { width: 390, height: 844 }]) {
          await page.setViewportSize(viewport)
          await expect(tip).toBeHidden()
          await openAtMiddle()
          const close = (await dialog.getByRole('button', { name: '关闭', exact: true }).boundingBox())!
          expect(close.y).toBeGreaterThanOrEqual(0)
          expect(close.y + close.height).toBeLessThanOrEqual(viewport.height)
        }
        expect(calls.length).toBe(requests)
      }
      if (!cycle) {
        await owner.getByRole('button', { name: '全不选', exact: true }).tap()
        await owner.locator('[data-ping-chart-task-id="101"]').tap()
        await owner.getByRole('button', { name: '丢包数据', exact: true }).tap()
        for (const range of ['6 小时', '12 小时']) {
          await owner.getByRole('tab', { name: range, exact: true }).tap()
          await expect(owner.locator('.animate-spin')).toHaveCount(0)
          await expect(owner).toHaveAttribute('data-ping-chart-visible-task-ids', '101')
          await expect(owner).toHaveAttribute('data-ping-chart-loss', 'disabled')
        }
        await owner.getByRole('button', { name: '全不选', exact: true }).tap()
        await owner.getByRole('tab', { name: '1 小时', exact: true }).tap()
        await expect(owner).toHaveAttribute('data-ping-chart-visible-task-ids', '')
        await owner.getByRole('button', { name: '全选', exact: true }).tap()
        await expect(owner).toHaveAttribute('data-ping-chart-visible-task-ids', names.map((_, i) => i + 101).join(','))
      }
      const oldHost = await owner.locator('.ping-chart-host').elementHandle()
      await dialog.getByRole('button', { name: '关闭', exact: true }).tap()
      await expect(dialog).toHaveCount(0)
      await expect(page.locator('.ping-shared-tooltip-shell')).toHaveCount(0)
      expect(await oldHost!.evaluate(el => el.isConnected)).toBe(false)
      const listeners = await page.evaluate(() => (window as any).__placementListeners())
      expect(listeners.owners.every((o: any) => o.count === 0)).toBe(true)
      closedListeners ??= listeners.scroll
      expect(listeners.scroll).toBe(closedListeners)
      const afterClose = calls.length
      await page.evaluate(() => window.scrollBy({ top: 30, behavior: 'instant' }))
      await page.waitForTimeout(150)
      expect(calls.length).toBe(afterClose)
    }
    await page.goto(`/instance/${PRIMARY_NODE_UUID}`)
    await expect(page.locator('[data-ping-chart]')).toHaveAttribute('data-ping-chart-loss', 'enabled')
    await page.getByRole('button', { name: '返回首页', exact: true }).tap()
    await expect(page.locator('[data-ping-chart]')).toHaveCount(0)
    expect(await page.evaluate(() => document.documentElement.style.getPropertyValue('overflow-anchor'))).toBe('')
    expect(errors).toEqual([])
  })

  for (const modal of [false, true]) {
    for (const width of [390, 360]) {
      for (const count of [2, 15]) {
        test(`${modal ? 'modal' : 'detail'} ${width}px ${count} tasks: seven real times, both plots, no overlap or additional RPC`, async ({ page }, info) => {
          await page.setViewportSize({ width, height: 844 })
          const { owner, calls, errors } = await setup(page, modal, count)
          const host = owner.locator('.ping-chart-host')
          const plot = owner.locator('x-vue-echarts')
          const shell = owner.locator('.ping-shared-tooltip-shell')
          const records: any[] = []
          for (const theme of ['深色模式', '浅色模式']) {
            if (modal)
              await page.getByRole('dialog').getByRole('button', { name: '关闭', exact: true }).click()
            await page.getByRole('button', { name: theme, exact: true }).click()
            if (modal)
              await page.locator(`[data-node-card-uuid="${PRIMARY_NODE_UUID}"] [data-node-ping-panel="latency"]`).first().click()
            await expect(owner).toHaveAttribute('data-ping-chart-loss', 'enabled')
            await plot.scrollIntoViewIfNeeded()
            const beforeCalls = calls.length
            const modes: string[] = []
            for (const i of fractions) {
              for (const axis of [0, 1]) {
                // Deliberate native page/modal scroll to expose the requested plot.
                await plot.evaluate((el, axis) => {
                  const parent = el.closest('[data-app-dialog-body]')
                  const offset = axis ? 296 : 30
                  const target = el.getBoundingClientRect().top + offset - 180
                  if (parent)
                    parent.scrollBy({ top: target - parent.getBoundingClientRect().top, behavior: 'instant' })
                  else window.scrollBy({ top: target, behavior: 'instant' })
                }, axis)
                // Close only before unrelated edge samples; central neighbours
                // stay open to test stability and retained snapped identity.
                if (![49, 50, 51].includes(i))
                  await api(owner, 'hide')
                await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
                const p = await api(owner, 'inspect', i, axis)
                expect(p.hit).toBe(true)
                const scroll = await page.evaluate(() => ({ page: scrollY, modal: document.querySelector('[data-app-dialog-body]')?.scrollTop }))
                // Playwright WebKit touch transport uses integer viewport
                // coordinates. Round to the nearest CSS pixel, not downward.
                await page.touchscreen.tap(Math.round(p.x), Math.round(p.y))
                await expect(shell).toHaveAttribute('data-ping-time', String(p.t))
                await expect(shell, `fraction ${i}, axis ${axis}`).toBeVisible()
                await expect(owner.locator('[data-ping-shared-tooltip]:visible')).toHaveCount(1)
                const afterScroll = await page.evaluate(() => ({ page: scrollY, modal: document.querySelector('[data-app-dialog-body]')?.scrollTop }))
                expect(afterScroll, `no auto scroll at ${i}/${axis}`).toEqual(scroll)
                const b = (await shell.boundingBox())!
                const current = await api(owner, 'inspect', i, axis)
                const mode = (await shell.getAttribute('data-ping-placement'))!
                expect(b.x).toBeGreaterThanOrEqual(0)
                expect(b.x + b.width).toBeLessThanOrEqual(width)
                expect(current.box.height).toBe(p.box.height)
                if (mode === 'docked') {
                  expect(b.y).toBeGreaterThanOrEqual(current.box.bottom + 8)
                  expect(await shell.evaluate(el => getComputedStyle(el).position)).toBe('relative')
                }
                else {
                  // Account for the visible shadow and the full time-band, not
                  // just a line rendered above the Tooltip.
                  const collision = b.x - 8 < current.x + 12 && b.x + b.width + 8 > current.x - 12 && b.y - 8 < current.box.bottom - 52 && b.y + b.height + 8 > current.box.top + 30
                  expect(collision, JSON.stringify({ i, axis, mode, b, current })).toBe(false)
                  expect(b.y - 8).toBeGreaterThanOrEqual(0)
                  expect(b.y + b.height + 8).toBeLessThanOrEqual(844)
                }
                if (i === 50) {
                  await expect(shell.locator(`[data-task-id="${100 + count}"] [data-ping-latency]`)).toHaveText('不可达')
                  await expect(shell.locator(`[data-task-id="${100 + count}"] [data-ping-loss]`)).toHaveText('100.0%')
                  expect(await shell.locator(`[data-task-id="${100 + count}"] .ping-tooltip-abnormal`).count()).toBe(2)
                }
                if ([49, 50, 51].includes(i))
                  modes.push(mode)
                records.push({ width, modal, count, theme, fraction: i, axis, mode, selectedT: p.t, shell: b, plot: current.box })
              }
            }
            expect(new Set(modes).size, 'central positions must not oscillate').toBe(1)
            expect(calls.length).toBe(beforeCalls)
            await api(owner, 'hide')
            await expect(shell).toBeHidden()
            expect(await host.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true)
          }
          await info.attach('geometry', { body: JSON.stringify(records, null, 2), contentType: 'application/json' })
          expect(errors).toEqual([])
        })
      }
    }
  }
})

for (const modal of [false, true]) {
  test(`desktop ${modal ? 'modal' : 'detail'} actual left, middle and right points keep a readable single Tooltip`, async ({ page }, info) => {
    const { owner, calls, errors } = await setup(page, modal)
    const plot = owner.locator('x-vue-echarts')
    const shell = owner.locator('.ping-shared-tooltip-shell')
    await plot.scrollIntoViewIfNeeded()
    const before = calls.length
    for (const i of fractions) {
      await api(owner, 'hide')
      const p = await api(owner, 'inspect', i)
      await page.mouse.move(p.x, p.y)
      await expect(shell).toHaveAttribute('data-ping-time', String(p.t))
      await expect(shell).toBeVisible()
      const b = (await shell.boundingBox())!
      expect(b.width).toBeLessThanOrEqual(440)
      const mode = await shell.getAttribute('data-ping-placement')
      expect(mode).not.toBe('docked')
      expect(b.x + b.width + 8 <= p.x - 12 || b.x - 8 >= p.x + 12).toBe(true)
      expect(b.x).toBeGreaterThanOrEqual(p.box.left)
      expect(b.x + b.width).toBeLessThanOrEqual(p.box.right)
      await expect(owner.locator('[data-ping-shared-tooltip]:visible')).toHaveCount(1)
    }
    await plot.screenshot({ path: info.outputPath('desktop-side-placement.png') })
    expect(calls.length).toBe(before)
    expect(errors).toEqual([])
  })
}

test('placement validates shadow, time label and both sides without clamping onto T', () => {
  const bounds = { left: 0, top: 0, right: 1000, bottom: 600 }
  const band = { left: 488, right: 512, top: 0, bottom: 550 }
  expect(placePingTooltip(bounds, [band], 500, 250, 250, 200, 'left').mode).toBe('left')
  expect(placePingTooltip(bounds, [band], 500, 250, 250, 200, 'right').mode).toBe('right')
  expect(placePingTooltip({ ...bounds, right: 390 }, [{ ...band, left: 183, right: 207 }], 195, 250, 250, 200).mode).toBe('docked')
  const label = { left: 400, right: 600, top: 200, bottom: 230 }
  expect(placePingTooltip(bounds, [band, label], 500, 250, 250, 200).mode).toBe('docked')
})
