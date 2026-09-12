import type { Locator, Page } from '@playwright/test'
import { expect, test } from '@playwright/test'
import { installKomariFixture, PRIMARY_NODE_UUID } from './fixtures/komari'
import { attachTooltipEvents, observeTooltipEvents } from './fixtures/ping-tooltip-diagnostics'

test.beforeEach(observeTooltipEvents)
test.afterEach(attachTooltipEvents)

test.use({ launchOptions: { ignoreDefaultArgs: ['--hide-scrollbars'] } })
const fractions = [5, 50, 95]
const names = [...Array.from({ length: 13 }, (_, i) => `Region ${i + 1}`), 'BandwagonHost / Cluster Logic Inc', '很长的中文任务名称 <unsafe>']

async function setup(page: Page, modal: boolean, touch = false, count = 15) {
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
  if (modal) {
    const entry = page.locator(`[data-node-card-uuid="${PRIMARY_NODE_UUID}"] [data-node-ping-header="latency"]`).first()
    // WebKit may report maxTouchPoints=0 in a hasTouch context. Use this
    // test's explicit input mode, not a desktop click in mobile coverage.
    if (touch)
      await entry.tap()
    else await entry.click()
  }
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

// The avoidance/docked requirement was explicitly withdrawn. Keep the shared
// modal coverage, but verify the earlier floating shell instead of non-overlap.
async function openFloating(page: Page, owner: Locator, index: number, touch: boolean, axis = 0) {
  const shell = owner.locator('.ping-shared-tooltip-shell')
  await owner.locator('x-vue-echarts').scrollIntoViewIfNeeded()
  // Complete native scrolling/autoresize painting before deriving viewport
  // coordinates, including a newly reopened modal or a rotated viewport.
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
  // WebKit's automation cursor can stay over the modal-entry tap and seed
  // an unrelated hover after scrolling. Park it outside both plots before
  // the independent pointer/touch input; never hover the mobile tooltip.
  if (!touch || page.context().browser()?.browserType().name() === 'webkit')
    await page.mouse.move(0, 0)
  await api(owner, 'hide')
  await expect(shell).toBeHidden()
  let p = await api(owner, 'inspect', index, axis)
  if (!p.hit)
    p = await api(owner, 'inspect', index, axis ? 0 : 1)
  expect(p.hit).toBe(true)
  const scroll = await page.evaluate(() => ({ page: scrollY, modal: document.querySelector('[data-app-dialog-body]')?.scrollTop }))
  if (touch)
    await page.touchscreen.tap(Math.round(p.x), Math.round(p.y))
  else
    await page.mouse.move(p.x, p.y)
  await expect(shell).toBeVisible()
  const expectedTime = new Date(p.t).toLocaleTimeString('en-GB', { timeZone: 'Asia/Shanghai', hour12: false })
  await expect(shell.locator('.ping-tooltip-time')).toHaveText(expectedTime)
  expect(await page.evaluate(() => ({ page: scrollY, modal: document.querySelector('[data-app-dialog-body]')?.scrollTop }))).toEqual(scroll)
  const state = await shell.evaluate((el) => {
    const chart = el.closest('x-vue-echarts')
    const host = el.closest('.ping-chart-host')!
    return {
      insideChart: Boolean(chart),
      position: getComputedStyle(el).position,
      mode: el.getAttribute('data-ping-placement'),
      openOverride: el.getAttribute('data-ping-open'),
      height: host.getBoundingClientRect().height,
      directChart: host.firstElementChild === chart,
      anchor: host.style.getPropertyValue('overflow-anchor'),
      rect: el.getBoundingClientRect().toJSON(),
      plot: chart?.getBoundingClientRect().toJSON(),
    }
  })
  expect(state.insideChart).toBe(true)
  expect(state.position).toBe('absolute')
  expect(state.mode).toBeNull()
  expect(state.openOverride).toBeNull()
  expect(state.height).toBe(560)
  expect(state.directChart).toBe(true)
  expect(state.anchor).toBe('')
  expect(state.rect.left).toBeGreaterThanOrEqual(state.plot.left - 1)
  expect(state.rect.right).toBeLessThanOrEqual(state.plot.right + 1)
  expect(state.rect.top).toBeGreaterThanOrEqual(state.plot.top - 1)
  expect(state.rect.bottom).toBeLessThanOrEqual(state.plot.bottom + 1)
  await expect(owner.locator('[data-ping-shared-tooltip]:visible')).toHaveCount(1)
  const option = (await api(owner)).option
  expect(option.tooltip[0]).toMatchObject({ confine: true, enterable: true })
  expect(option.tooltip[0].appendTo).toBeUndefined()
  expect(option.tooltip[0].alwaysShowContent).not.toBe(true)
  if (index === 50) {
    await expect(shell.locator('[data-task-id="115"] [data-ping-latency]')).toHaveText('不可达')
    await expect(shell.locator('[data-task-id="115"] [data-ping-loss]')).toHaveText('100.0%')
    await expect(shell.locator('[data-task-id="115"] .ping-tooltip-abnormal')).toHaveCount(2)
  }
  return shell.locator('[data-ping-shared-tooltip]')
}

for (const touch of [false, true]) {
  test.describe(touch ? 'mobile restored Tooltip' : 'desktop restored Tooltip', () => {
    test.use(touch ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } : { viewport: { width: 1280, height: 800 } })
    for (const modal of [false, true]) {
      test(`${modal ? 'modal' : 'detail'} left, middle and right keep the original floating shell`, async ({ page }, info) => {
        const { owner, calls, errors } = await setup(page, modal, touch)
        const before = calls.length
        for (const i of fractions) {
          await openFloating(page, owner, i, touch)
          if (i === 50)
            await openFloating(page, owner, i, touch, 1)
        }
        await owner.locator('x-vue-echarts').screenshot({ path: info.outputPath('restored-floating.png') })
        await api(owner, 'hide')
        await expect(owner.locator('.ping-shared-tooltip-shell')).toBeHidden()
        expect(calls.length).toBe(before)
        expect(errors).toEqual([])
      })
    }
  })
}

test.describe('desktop leave lifecycle', () => {
  test.use({ viewport: { width: 1280, height: 800 }, hasTouch: false, isMobile: false })
  for (const modal of [false, true]) {
    test(`${modal ? 'modal' : 'detail'} real mouse leave hides and next hover opens`, async ({ page }) => {
      const { owner, calls, errors } = await setup(page, modal)
      const before = calls.length
      for (const index of [5, 50, 95]) {
        const tip = await openFloating(page, owner, index, false)
        await tip.hover()
        await page.mouse.move(0, 0)
        await expect(tip).toBeHidden()
      }
      expect(calls.length).toBe(before)
      expect(errors).toEqual([])
    })
  }
})

test.describe('mobile full modal retention', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
  for (const modal of [false, true]) {
    test(`${modal ? 'modal' : 'detail'} touch scrolling survives compatibility leave and returns to real mouse leave`, async ({ page, browserName }) => {
      const { owner, calls, errors } = await setup(page, modal, true)
      const tip = await openFloating(page, owner, 50, true)
      const host = owner.locator('.ping-chart-host')
      const stamp = await tip.locator('.ping-tooltip-time').textContent()
      const before = calls.length
      const box = (await tip.boundingBox())!
      const point = { x: box.x + box.width / 2, y: box.y + box.height - 35 }
      const session = browserName === 'chromium' ? await page.context().newCDPSession(page) : null
      const pointer = { pointerId: 81, pointerType: 'touch', isPrimary: true, clientX: point.x, clientY: point.y }
      const touch = { identifier: 81, clientX: point.x, clientY: point.y }
      if (session) {
        await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...point, id: 81 }] })
        for (let step = 1; step <= 6; step++) {
          await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: point.x, y: point.y - step * 20, id: 81 }] })
          await page.waitForTimeout(16)
        }
      }
      else {
        // WebKit has no CDP native drag transport: classify the touch sequence
        // and verify DOM scrolling, without claiming physical iPhone inertia.
        await tip.dispatchEvent('pointerdown', pointer)
        await tip.dispatchEvent('touchstart', { touches: [touch], changedTouches: [touch] })
        await tip.dispatchEvent('pointermove', { ...pointer, clientY: point.y - 120 })
        await tip.evaluate(el => el.scrollBy({ top: 120, behavior: 'instant' }))
      }
      await expect.poll(() => tip.evaluate(el => el.scrollTop)).toBeGreaterThan(20)
      const leave = async () => {
        // Target all three old hide entry points: renderer, HTML shell, owner.
        await owner.locator('canvas').first().dispatchEvent('mouseout', { clientX: 0, clientY: 0, relatedTarget: null })
        await owner.locator('.ping-shared-tooltip-shell').dispatchEvent('mouseleave', { clientX: 0, clientY: 0, relatedTarget: null })
        await host.dispatchEvent('mouseleave', { clientX: 0, clientY: 0, relatedTarget: null })
        await page.waitForTimeout(150) // observe beyond ECharts' existing 100ms hide delay
        await expect(tip).toBeVisible()
        await expect(tip.locator('.ping-tooltip-time')).toHaveText(stamp!)
      }
      await leave() // while a native gesture/scroll is still active
      if (session) {
        await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
        await session.detach()
      }
      else {
        await tip.dispatchEvent('pointerup', pointer)
        await tip.dispatchEvent('touchend', { touches: [], changedTouches: [touch] })
      }
      await leave() // queued compatibility events after release must also be safe
      await tip.locator('.ping-tooltip-row:last-child [data-ping-loss]').scrollIntoViewIfNeeded()
      await page.waitForTimeout(160)
      await tip.locator('.ping-tooltip-row:last-child [data-ping-loss]').tap()
      await expect(tip).toBeHidden()
      await openFloating(page, owner, 50, true)
      // A hybrid device's next REAL mouse pointer must end touch ownership.
      await tip.hover()
      await page.mouse.move(0, 0)
      await expect(tip).toBeHidden()
      // Ordinary hover is covered in a genuine desktop context above. ZRender's
      // pre-existing touch-browser 700ms compatibility timer ignores an immediate
      // single mousemove; it is not the product leave guard under test here.
      expect(calls.length).toBe(before)
      expect(errors).toEqual([])
    })
  }
  test('five modal cycles preserve dual chart, scroll, tap close, selection and cleanup', async ({ page, browserName }, info) => {
    // WebKit's native action checks accumulate across five cycles and rotation;
    // Linux reaches the final rotation at 59s. Keep a fixed 90s ceiling, no waits.
    if (browserName === 'webkit')
      test.setTimeout(90_000)
    await page.addInitScript(() => {
      const owners = new Map<HTMLElement, Set<EventListenerOrEventListenerObject>>()
      const windowListeners = new Map<string, Set<EventListenerOrEventListenerObject>>()
      const add = EventTarget.prototype.addEventListener
      const remove = EventTarget.prototype.removeEventListener
      EventTarget.prototype.addEventListener = function (type, listener, options) {
        if (listener && this === window && ['scroll', 'resize', 'pointerdown', 'touchstart'].includes(type)) {
          if (!windowListeners.has(type))
            windowListeners.set(type, new Set())
          windowListeners.get(type)!.add(listener)
        }
        if (listener && type === 'pointerdown' && this instanceof HTMLElement && this.classList.contains('ping-chart-host')) {
          if (!owners.has(this))
            owners.set(this, new Set())
          owners.get(this)!.add(listener)
        }
        return add.call(this, type, listener, options)
      }
      EventTarget.prototype.removeEventListener = function (type, listener, options) {
        if (listener && this === window)
          windowListeners.get(type)?.delete(listener)
        if (listener && type === 'pointerdown' && this instanceof HTMLElement)
          owners.get(this)?.delete(listener)
        return remove.call(this, type, listener, options)
      }
      ;(window as any).__restoredTooltipListeners = () => ({
        window: Object.fromEntries(Array.from(windowListeners, ([type, set]) => [type, set.size])),
        owners: Array.from(owners, ([el, set]) => ({ connected: el.isConnected, count: set.size })),
      })
    })
    const { owner, calls, errors } = await setup(page, true, true)
    const dialog = page.getByRole('dialog')
    let closedListeners: unknown
    for (let cycle = 0; cycle < 5; cycle++) {
      if (cycle) {
        const uuid = cycle % 2 ? '00000000-0000-4000-8000-000000000002' : PRIMARY_NODE_UUID
        await page.locator(`[data-node-card-uuid="${uuid}"] [data-node-ping-header="latency"]`).first().tap()
      }
      await expect(owner).toHaveAttribute('data-ping-chart-loss', 'enabled')
      await expect(owner).toHaveAttribute('data-ping-chart-visible-task-ids', names.map((_, i) => 101 + i).join(','))
      const tip = await openFloating(page, owner, 50, true)
      const stamp = await tip.locator('.ping-tooltip-time').textContent()
      const before = calls.length
      if (browserName === 'chromium') {
        const session = await page.context().newCDPSession(page)
        const b = (await tip.boundingBox())!
        const x = b.x + b.width / 2
        const y = Math.min(b.y + b.height - 30, 760)
        await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1 }] })
        for (let step = 1; step <= 10; step++) {
          await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y - step * 16, id: 1 }] })
          await page.waitForTimeout(16)
        }
        await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
        await page.waitForTimeout(600)
        await session.detach()
      }
      else {
        await tip.evaluate(el => el.scrollBy({ top: 700, behavior: 'instant' }))
      }
      // WebKit mobile has no native drag/wheel transport here; DOM scroll
      // retention plus browser tap is covered, not physical iPhone inertia.
      await expect.poll(() => tip.evaluate(el => el.scrollTop)).toBeGreaterThan(20)
      await expect(tip.locator('.ping-tooltip-time')).toHaveText(stamp!)
      const last = tip.locator('.ping-tooltip-row:last-child [data-ping-loss]')
      await expect(last).toHaveText('100.0%')
      if (!cycle)
        await dialog.screenshot({ path: info.outputPath('modal-floating-bottom.png') })
      await last.scrollIntoViewIfNeeded()
      await page.waitForTimeout(160) // allow the deliberate scroll to settle
      await last.tap()
      await expect(tip).toBeHidden()
      await expect(dialog).toBeVisible()
      expect((await api(owner)).option.xAxis.every((a: any) => a.axisPointer.status !== 'show')).toBe(true)
      await openFloating(page, owner, 50, true)
      expect(calls.length).toBe(before)
      if (cycle === 4) {
        for (const viewport of [{ width: 844, height: 390 }, { width: 390, height: 844 }]) {
          await page.setViewportSize(viewport)
          await expect(tip).toBeHidden()
          await openFloating(page, owner, 50, true)
          const close = (await dialog.getByRole('button', { name: '关闭', exact: true }).boundingBox())!
          expect(close.y).toBeGreaterThanOrEqual(0)
          expect(close.y + close.height).toBeLessThanOrEqual(viewport.height)
        }
        expect(calls.length).toBe(before)
      }
      const listeners = await page.evaluate(() => (window as any).__restoredTooltipListeners())
      expect(listeners.owners.filter((o: any) => o.count)).toEqual([{ connected: true, count: 1 }])
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
        await owner.getByRole('button', { name: '丢包数据', exact: true }).tap()
        await expect(owner).toHaveAttribute('data-ping-chart-loss', 'enabled')
        await owner.getByRole('button', { name: '全不选', exact: true }).tap()
        await owner.getByRole('tab', { name: '1 小时', exact: true }).tap()
        await expect(owner).toHaveAttribute('data-ping-chart-visible-task-ids', '')
        await owner.getByRole('button', { name: '全选', exact: true }).tap()
        await expect(owner).toHaveAttribute('data-ping-chart-visible-task-ids', names.map((_, i) => 101 + i).join(','))
      }
      const close = dialog.getByRole('button', { name: '关闭', exact: true })
      await expect(close).toBeVisible()
      await close.tap()
      await expect(dialog).toHaveCount(0)
      await expect(page.locator('.ping-shared-tooltip-shell')).toHaveCount(0)
      const after = await page.evaluate(() => (window as any).__restoredTooltipListeners())
      expect(after.owners.every((o: any) => !o.count && !o.connected)).toBe(true)
      closedListeners ??= after.window
      expect(after.window).toEqual(closedListeners)
      const afterClose = calls.length
      await page.evaluate(() => window.scrollBy({ top: 30, behavior: 'instant' }))
      await page.waitForTimeout(150)
      expect(calls.length).toBe(afterClose)
    }
    await page.goto(`/instance/${PRIMARY_NODE_UUID}`)
    await expect(page.locator('[data-ping-chart]')).toHaveAttribute('data-ping-chart-loss', 'enabled')
    await page.getByRole('button', { name: '返回首页', exact: true }).tap()
    await expect(page.locator('[data-ping-chart]')).toHaveCount(0)
    expect(errors).toEqual([])
  })
})
