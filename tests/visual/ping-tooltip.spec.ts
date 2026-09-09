import type { Page } from '@playwright/test'
import { expect, test } from '@playwright/test'
import { pingTooltipLoss } from '../../src/utils/pingChartPresentation'
import { installKomariFixture, PRIMARY_NODE_UUID } from './fixtures/komari'

// Headless Chromium normally hides native scrollbars; retain them for drag coverage.
test.use({ launchOptions: { ignoreDefaultArgs: ['--hide-scrollbars'] } })

const shortNames = ['AWS HK', 'Datawave TW']
const longNames = [...Array.from({ length: 13 }, (_, i) => `Region ${i + 1}`), 'BandwagonHost / Cluster Logic Inc', '很长的中文任务名称与安全标签 <img src=x onerror="alert(1)">'.repeat(3)]
const lossRatios = [0, 0.00001, 0.001, 0.2, 0.5, 1, null, null, 0.2]
const rtts = [13, 13, 999, 13, 8, null, null, 1000, null]
const initializedPages = new WeakSet<Page>()

async function setup(page: Page, names = shortNames) {
  if (!initializedPages.has(page)) {
    await installKomariFixture(page, { hideEarth: true, nodeCount: 2, nodeCardPingFixture: { metric: 'valid' } })
    initializedPages.add(page)
  }
  const calls: string[] = []
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.route('**/rpc2', async (route) => {
    const { method, params = {}, id } = route.request().postDataJSON()
    if (!['public:getPublicPingTasks', 'public:getPingMetricStats', 'public:queryMetrics'].includes(method)
      || (method === 'public:queryMetrics' && !params.metric_keys?.includes('ping.latency_ms'))) {
      return route.fallback()
    }
    calls.push(method)
    const node = params.entity_id ?? PRIMARY_NODE_UUID
    const tasks = names.map((name, i) => ({ id: 101 + i, name, clients: [PRIMARY_NODE_UUID, '00000000-0000-4000-8000-000000000002'], interval: 60, type: 'icmp' }))
    const end = Date.parse(params.end ?? '2026-07-25T12:00:00Z')
    const result = method === 'public:getPublicPingTasks'
      ? tasks
      : method === 'public:getPingMetricStats'
        ? { stats: tasks.map(task => ({ ...task, entity_id: node, task_id: String(task.id), total: 40, valid: 30, avg: 50, loss: 88 })) }
        : { series: tasks.flatMap(task => ['ping.latency_ms', 'ping.loss'].map(metric_key => ({
            metric_key,
            entity_id: node,
            tags: { task_id: String(task.id), task_name: task.name },
            count: lossRatios.length,
            interval_seconds: 60,
            downsampled: true,
            points: lossRatios.map((loss, i) => ({ time: new Date(end - (12 - i) * 60_000).toISOString(), count: 5, value: metric_key === 'ping.loss' ? loss : rtts[i] == null ? null : loss == null ? rtts[i] : rtts[i]! * (1 - loss) - loss })),
          }))) }
    await route.fulfill({ json: { jsonrpc: '2.0', id, result } })
  })
  await page.goto(`/instance/${PRIMARY_NODE_UUID}`)
  await expect(page.locator('[data-ping-chart]')).toHaveAttribute('data-ping-chart-visible-task-ids', names.map((_, i) => 101 + i).join(','))
  return { calls, errors }
}

async function chart(page: Page, action = 'inspect', value: any = null): Promise<any> {
  return page.locator('[data-ping-chart] x-vue-echarts').evaluate((el, { action, value }) => {
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
      return null
    }
    const api = find((document.querySelector('#app') as any)._vnode)
    const o = api.getOption()
    if (action === 'dispatch')
      return api.dispatchAction(value)
    if (action === 'html')
      return o.tooltip[0].formatter([{ axisValue: o.series[0].data[value][0] }])
    return { option: JSON.parse(JSON.stringify(o)), box: el.getBoundingClientRect().toJSON(), x: api.convertToPixel({ xAxisIndex: 0 }, o.series[0].data[value ?? 0][0]), viewportHeight: window.innerHeight, headerBottom: document.querySelector('[data-testid="header-actions"]')?.closest('.sticky')?.getBoundingClientRect().bottom ?? 0 }
  }, { action, value })
}

async function open(page: Page, index = 0, touch = false) {
  // Each existing formatting/gesture scenario selects an independent sample.
  // The enterable shell now lives outside the canvas, so clear the previous
  // sample before teleporting test input through an area it may occupy.
  await chart(page, 'dispatch', { type: 'hideTip' })
  const el = page.locator('[data-ping-chart] x-vue-echarts')
  await el.scrollIntoViewIfNeeded()
  const state = await chart(page, 'inspect', index)
  const x = state.box.left + state.x
  // A landscape viewport can fit only the lower plot after native scrolling.
  // Target a visible plot, not a clipped point behind the sticky site header.
  const plot = state.option.grid.map((grid: any) => ({
    top: Math.max(state.box.top + grid.top, state.headerBottom + 12, 12),
    bottom: Math.min(state.box.top + (typeof grid.height === 'number' ? grid.top + grid.height : state.box.height - grid.bottom), state.viewportHeight - 30),
  })).find((grid: any) => grid.bottom - grid.top > 12)
  expect(plot, 'an actual chart plot must be visible before pointer input').toBeTruthy()
  const y = (plot.top + plot.bottom) / 2
  const hit = await el.evaluate((el, point) => el.contains(document.elementFromPoint(point.x, point.y)), { x, y })
  expect(hit, `touch coordinates must hit the chart: ${JSON.stringify({ x, y, box: state.box, plot, viewportHeight: state.viewportHeight, headerBottom: state.headerBottom })}`).toBe(true)
  if (touch)
    await page.touchscreen.tap(x, y)
  else await page.mouse.move(x, y)
  await expect(page.locator('[data-ping-shared-tooltip]')).toBeVisible()
  return page.locator('[data-ping-shared-tooltip]')
}

test('shared tooltip short names shrink the actual shell and keep number columns intact', async ({ page }) => {
  const f = await setup(page)
  const tip = await open(page)
  const m = await tip.evaluate(el => ({ content: el.getBoundingClientRect().width, shell: el.parentElement!.getBoundingClientRect().width, font: getComputedStyle(el).fontSize }))
  expect(m.shell).toBeLessThan(340)
  expect(m.content).toBeLessThan(320)
  expect(Number.parseFloat(m.font)).toBeGreaterThanOrEqual(12)
  expect(f.errors).toEqual([])
})

test('loss text uses finite percentages, including tiny positives, without renormalizing', () => {
  expect([0, 0.001, 0.1, 20, 33.3, 50, 100, null, -1, 101, Number.NaN, Infinity].map(pingTooltipLoss)).toEqual([
    { text: '0.0%', abnormal: false },
    { text: '<0.1%', abnormal: true },
    { text: '0.1%', abnormal: true },
    { text: '20.0%', abnormal: true },
    { text: '33.3%', abnormal: true },
    { text: '50.0%', abnormal: true },
    { text: '100.0%', abnormal: true },
    ...Array.from({ length: 5 }).fill({ text: '—', abnormal: false }),
  ])
})

test('shared tooltip highlights only exact abnormal cells and restores normal colors in both themes', async ({ page }, testInfo) => {
  const f = await setup(page)
  for (const theme of ['深色模式', '浅色模式']) {
    await page.getByRole('button', { name: theme, exact: true }).click()
    for (const index of [0, 1, 2, 3, 4, 5, 6, 7, 8, 0]) {
      const tip = await open(page, index)
      const row = tip.locator('[data-task-id="101"]')
      const loss = lossRatios[index]
      await expect(row.locator('[data-ping-loss]')).toHaveText(pingTooltipLoss(loss === null ? null : loss! * 100).text)
      expect(await row.locator('[data-ping-loss]').evaluate(el => el.classList.contains('ping-tooltip-abnormal'))).toBe(loss !== null && loss! > 0)
      expect(await row.locator('[data-ping-latency]').evaluate(el => el.classList.contains('ping-tooltip-abnormal'))).toBe(index === 5)
      await expect(row.locator('[data-ping-latency]')).toHaveText(rtts[index] === null ? index === 5 ? '不可达' : '—' : `${rtts[index]} ms`)
      const colors = await row.evaluate((el) => {
        const probe = document.createElement('span')
        probe.style.color = 'var(--destructive)'
        el.append(probe)
        const red = getComputedStyle(probe).color
        probe.remove()
        return { red, name: getComputedStyle(el.querySelector('.ping-tooltip-name')!).color, loss: getComputedStyle(el.querySelector('[data-ping-loss]')!).color }
      })
      expect(colors.name).not.toBe(colors.red)
      if (loss !== null && loss! > 0)
        expect(colors.loss).toBe(colors.red)
      else expect(colors.loss).toBe(colors.name)
    }
    await open(page, 5)
    await page.locator('[data-ping-shared-tooltip]').screenshot({ path: testInfo.outputPath(`${theme}-abnormal.png`) })
  }
  expect(f.errors).toEqual([])
})

test('intrinsic tracks include bottom long names, protect all numbers and stay stable while scrolling', async ({ page }, testInfo) => {
  await setup(page)
  let tip = await open(page)
  const shortWidth = await tip.evaluate(el => el.parentElement!.getBoundingClientRect().width)
  await setup(page, ['AWS HK', 'BandwagonHost / Cluster Logic Inc'])
  tip = await open(page, 7)
  const englishWidth = await tip.evaluate(el => el.parentElement!.getBoundingClientRect().width)
  expect(englishWidth).toBeGreaterThan(shortWidth + 20)
  const f = await setup(page, longNames)
  tip = await open(page, 7)
  const beforeCalls = f.calls.length
  const measure = () => tip.evaluate((el) => {
    const shell = el.parentElement!.getBoundingClientRect()
    const box = el.getBoundingClientRect()
    const grid = el.querySelector('.ping-tooltip-grid')!
    const right = (node: Element) => node.getBoundingClientRect().right
    return { shell: shell.toJSON(), width: box.width, scrollWidth: el.scrollWidth, clientWidth: el.clientWidth, height: el.clientHeight, scrollHeight: el.scrollHeight, scroll: el.scrollTop, headers: [right(grid.children[1]!), right(grid.children[2]!)], values: Array.from(el.querySelectorAll('[data-ping-latency]'), node => [right(node), right(node.nextElementSibling!)]), contentRight: box.left + el.clientLeft + el.clientWidth, images: el.querySelectorAll('img').length, lastName: el.querySelector('.ping-tooltip-row:last-child .ping-tooltip-name > span')!.getBoundingClientRect().width }
  })
  const before = await measure()
  expect(before.shell.width).toBeLessThanOrEqual(441)
  expect(before.scrollWidth).toBeLessThanOrEqual(before.clientWidth + 1)
  expect(before.scrollHeight).toBeGreaterThan(before.height)
  expect(before.images).toBe(0)
  expect(before.lastName).toBeGreaterThan(30)
  for (const values of before.values) {
    expect(Math.abs(values[0] - before.headers[0]!)).toBeLessThanOrEqual(1)
    expect(Math.abs(values[1] - before.headers[1]!)).toBeLessThanOrEqual(1)
    expect(values[1]).toBeLessThanOrEqual(before.contentRight + 1)
  }
  const time = await tip.locator('.ping-tooltip-time').textContent()
  await tip.hover()
  await page.mouse.wheel(0, 650)
  await expect.poll(async () => (await measure()).scroll).toBeGreaterThan(0)
  await expect(tip).toBeVisible()
  expect((await measure()).width).toBe(before.width)
  await expect(tip.locator('.ping-tooltip-time')).toHaveText(time!)
  await page.mouse.wheel(0, -650)
  await expect.poll(async () => (await measure()).scroll).toBe(0)
  const bar = await tip.evaluate((el) => {
    const box = el.getBoundingClientRect()
    return { x: box.right - (el.offsetWidth - el.clientWidth) / 2, top: box.top, height: box.height, gutter: el.offsetWidth - el.clientWidth }
  })
  if (bar.gutter > 0) {
    await page.mouse.move(bar.x, bar.top + 30)
    await page.mouse.down()
    await page.mouse.move(bar.x, bar.top + bar.height - 15, { steps: 8 })
    await page.mouse.up()
    await expect.poll(async () => (await measure()).scroll).toBeGreaterThan(0)
    await expect(tip).toBeVisible()
    await expect(tip.locator('.ping-tooltip-time')).toHaveText(time!)
    await tip.hover()
    await page.mouse.wheel(0, -650)
    await expect.poll(async () => (await measure()).scroll).toBe(0)
  }
  else {
    testInfo.annotations.push({ type: 'limitation', description: 'This WebKit platform exposes no reserved scrollbar hit area; wheel is verified here, native scrollbar drag is verified on Chromium.' })
  }
  await tip.getByText('Region 1', { exact: true }).click()
  await expect(tip).toBeVisible() // desktop mouse click is not touch dismissal
  for (const index of [2, 3, 5, 7]) {
    await open(page, index)
    expect((await measure()).width).toBeCloseTo(before.width, 2)
  }
  const current = await chart(page)
  for (const x of [current.box.left + 58, current.box.right - 26]) {
    await page.mouse.move(x, current.box.top + 120)
    await expect.poll(async () => (await measure()).shell.right).toBeLessThanOrEqual(current.box.right + 1)
    expect((await measure()).shell.left).toBeGreaterThanOrEqual(current.box.left - 1)
  }
  await tip.screenshot({ path: testInfo.outputPath('long-name-tracks.png') })
  expect(f.calls.length).toBe(beforeCalls)
  expect(f.errors).toEqual([])
})

test.describe('touch content', () => {
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } })
  test('tap dismisses the shared tooltip and both pointers without reopening', async ({ page }) => {
    const f = await setup(page)
    const tip = await open(page, 3, true)
    const before = f.calls.length
    await tip.getByText('AWS HK', { exact: true }).tap()
    await expect(tip).not.toBeVisible()
    await page.waitForTimeout(400)
    await expect(tip).not.toBeVisible()
    const state = await chart(page)
    expect(state.option.xAxis.every((axis: any) => axis.axisPointer.status !== 'show')).toBe(true)
    await open(page, 0, true)
    expect(f.calls.length).toBe(before)
    expect(f.errors).toEqual([])
  })

  test('time, header, name, both values and padding tap close; ten cycles preserve chart state', async ({ page }) => {
    await page.addInitScript(() => {
      const owners = new Map<HTMLElement, Set<EventListenerOrEventListenerObject>>()
      const windowPointers = new Set<EventListenerOrEventListenerObject>()
      const add = EventTarget.prototype.addEventListener
      const remove = EventTarget.prototype.removeEventListener
      EventTarget.prototype.addEventListener = function (type, listener, options) {
        if (type === 'pointerdown' && listener && this === window)
          windowPointers.add(listener)
        if (type === 'pointerdown' && listener && this instanceof HTMLElement && this.classList.contains('ping-chart-host')) {
          if (!owners.has(this))
            owners.set(this, new Set())
          owners.get(this)!.add(listener)
        }
        return add.call(this, type, listener, options)
      }
      EventTarget.prototype.removeEventListener = function (type, listener, options) {
        if (type === 'pointerdown' && listener && this === window)
          windowPointers.delete(listener)
        if (type === 'pointerdown' && listener && this instanceof HTMLElement)
          owners.get(this)?.delete(listener)
        return remove.call(this, type, listener, options)
      }
      ;(window as any).__tooltipListenerCounts = () => Array.from(owners, ([el, listeners]) => ({ connected: el.isConnected, count: listeners.size }))
      ;(window as any).__tooltipWindowPointerCount = () => windowPointers.size
    })
    const listenerCounts = () => page.evaluate(() => (window as any).__tooltipListenerCounts() as Array<{ connected: boolean, count: number }>)
    const f = await setup(page)
    const root = page.locator('[data-ping-chart]')
    await open(page, 3, true)
    const before = await chart(page)
    const windowPointerCount = await page.evaluate(() => (window as any).__tooltipWindowPointerCount())
    const requests = f.calls.length
    const selectors = ['.ping-tooltip-time', '.ping-tooltip-grid > span:first-child', '.ping-tooltip-name > span', '[data-ping-latency]', '[data-ping-loss]']
    for (let i = 0; i < 10; i++) {
      const tip = await open(page, 3, true)
      if (i % 6 === 5)
        await page.locator('.ping-shared-tooltip-shell').tap({ position: { x: 3, y: 3 } })
      else await tip.locator(selectors[i % 6]!).first().tap()
      await expect(tip).not.toBeVisible()
      await page.waitForTimeout(40)
      await expect(tip).not.toBeVisible()
      const current = await chart(page)
      expect(current.option.series).toEqual(before.option.series)
      expect(current.option.legend).toEqual(before.option.legend)
      expect(current.option.xAxis.every((axis: any) => axis.axisPointer.status !== 'show')).toBe(true)
      expect(await listenerCounts()).toEqual([{ connected: true, count: 1 }])
      expect(await page.evaluate(() => (window as any).__tooltipWindowPointerCount())).toBe(windowPointerCount)
    }
    expect(f.calls.length).toBe(requests)
    await root.getByRole('button', { name: '全不选', exact: true }).tap()
    await root.locator('[data-ping-chart-task-id="101"]').tap()
    for (const range of ['6 小时', '12 小时']) {
      await root.getByRole('tab', { name: range, exact: true }).tap()
      await expect(root.locator('.animate-spin')).toHaveCount(0)
      await expect(root).toHaveAttribute('data-ping-chart-visible-task-ids', '101')
    }
    await root.getByRole('button', { name: '全不选', exact: true }).tap()
    await root.getByRole('tab', { name: '1 小时', exact: true }).tap()
    await expect(root).toHaveAttribute('data-ping-chart-visible-task-ids', '')
    await root.getByRole('button', { name: '全选', exact: true }).tap()
    await open(page, 3, true)
    await page.getByRole('button', { name: '丢包数据', exact: true }).tap()
    await expect(page.locator('.ping-shared-tooltip-shell')).toBeHidden()
    // The opted-in full chart uses the same placement/touch owner in single
    // mode too; it must retain exactly one listener, not accumulate another.
    expect(await listenerCounts()).toEqual([{ connected: true, count: 1 }])
    await page.getByRole('button', { name: '丢包数据', exact: true }).tap()
    await open(page, 0, true)
    expect(await listenerCounts()).toEqual([{ connected: true, count: 1 }])
    await page.getByRole('button', { name: '下一个节点', exact: true }).tap()
    await expect(page.locator('[data-ping-shared-tooltip]')).not.toBeVisible()
    await open(page, 0, true)
    await page.locator('[data-ping-shared-tooltip] .ping-tooltip-time').tap()
    await expect(page.locator('[data-ping-shared-tooltip]')).not.toBeVisible()
    expect((await listenerCounts()).filter(owner => owner.count)).toEqual([{ connected: true, count: 1 }])
    await page.getByRole('button', { name: '返回首页', exact: true }).tap()
    await expect(page.locator('[data-ping-chart]')).toHaveCount(0)
    expect((await listenerCounts()).every(owner => owner.count === 0)).toBe(true)
    expect(f.errors).toEqual([])
  })

  test('gesture guards reject out-and-back, cancellation, multi-touch, scrolling and long presses', async ({ page }) => {
    const f = await setup(page, longNames)
    const tip = await open(page, 3, true)
    const requests = f.calls.length
    const target = tip.locator('.ping-tooltip-time')
    const box = await target.boundingBox()
    const point = { identifier: 71, clientX: box!.x + 10, clientY: box!.y + 10 }
    const pointer = { pointerId: 71, pointerType: 'touch', isPrimary: true, clientX: point.clientX, clientY: point.clientY }
    const start = async () => {
      await target.dispatchEvent('pointerdown', pointer)
      await target.dispatchEvent('touchstart', { touches: [point], changedTouches: [point] })
    }
    const end = async () => {
      await target.dispatchEvent('pointerup', pointer)
      await target.dispatchEvent('touchend', { touches: [], changedTouches: [point] })
      await expect(tip).toBeVisible()
    }
    // Synthetic event paths validate classification on Chromium AND WebKit.
    // Native browser scrolling is separately exercised by the Chromium CDP test.
    await start()
    await target.dispatchEvent('pointermove', { ...pointer, clientY: point.clientY + 30 })
    await target.dispatchEvent('pointermove', pointer)
    await end()
    await start()
    await target.dispatchEvent('pointercancel', pointer)
    await end()
    await start()
    await target.dispatchEvent('touchcancel', { touches: [], changedTouches: [point] })
    await end()
    await start()
    await target.dispatchEvent('pointerdown', { ...pointer, pointerId: 72, isPrimary: false })
    await end()
    await start()
    // Multi-finger contact outside the owner still appears in touchend.touches.
    await target.dispatchEvent('touchend', { touches: [{ ...point, identifier: 72 }], changedTouches: [point] })
    await expect(tip).toBeVisible()
    await start()
    // A second finger may start AND finish outside the tooltip before the first lifts.
    await page.locator('body').dispatchEvent('pointerdown', { ...pointer, pointerId: 72, isPrimary: false })
    await page.locator('body').dispatchEvent('touchstart', { touches: [point, { ...point, identifier: 72 }], changedTouches: [{ ...point, identifier: 72 }] })
    await page.locator('body').dispatchEvent('touchend', { touches: [point], changedTouches: [{ ...point, identifier: 72 }] })
    await end()
    await start()
    await page.waitForTimeout(450)
    await end()
    await target.evaluate((el) => {
      const selection = window.getSelection()!
      const range = document.createRange()
      range.selectNodeContents(el)
      selection.removeAllRanges()
      selection.addRange(range)
    })
    await start()
    await end() // text selection is not a dismissal gesture
    await page.evaluate(() => window.getSelection()?.removeAllRanges())
    await start()
    await tip.evaluate((el) => {
      el.scrollTop = 70
      el.dispatchEvent(new Event('scroll'))
      el.scrollTop = 0
      el.dispatchEvent(new Event('scroll'))
    })
    await end()
    await page.waitForTimeout(160)
    // A replacement formatter root cannot inherit the previous DOM's gesture.
    await start()
    await chart(page, 'dispatch', { type: 'hideTip' })
    await open(page, 4, true)
    await end()
    await target.tap()
    await expect(tip).not.toBeVisible()
    expect(f.calls.length).toBe(requests)
    expect(f.errors).toEqual([])
  })

  test('native Chromium touch drags and release scroll a long list without dismissing or changing time', async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', 'Public Playwright touch-drag injection is Chromium CDP only; WebKit classification is tested separately, not claimed as native iPhone inertia.')
    const f = await setup(page, longNames)
    const tip = await open(page, 3, true)
    const requests = f.calls.length
    const stamp = await tip.locator('.ping-tooltip-time').textContent()
    // In-flow data is intentionally not auto-scrolled into view by the app.
    // Expose it explicitly before native viewport-coordinate touch injection.
    await tip.scrollIntoViewIfNeeded()
    const session = await page.context().newCDPSession(page)
    const drag = async (delta: number) => {
      const box = await tip.boundingBox()
      const x = box!.x + box!.width / 2
      const y = box!.y + (delta < 0 ? box!.height - 40 : 45)
      await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1 }] })
      for (let step = 1; step <= 10; step++) {
        await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y + delta * step / 10, id: 1 }] })
        await page.waitForTimeout(16)
      }
      await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
      await expect(tip).toBeVisible()
      await expect(tip.locator('.ping-tooltip-time')).toHaveText(stamp!)
    }
    await drag(-180)
    await expect.poll(() => tip.evaluate(el => el.scrollTop)).toBeGreaterThan(20)
    await drag(-180) // lower boundary, including release/fling
    await expect.poll(() => tip.evaluate(el => el.scrollHeight - el.clientHeight - el.scrollTop)).toBeLessThanOrEqual(1)
    await tip.locator('.ping-tooltip-row:last-child [data-ping-loss]').isVisible().then(visible => expect(visible).toBe(true))
    await drag(180)
    await drag(180) // upper boundary must not become a tap
    await expect.poll(() => tip.evaluate(el => el.scrollTop)).toBe(0)
    await page.waitForTimeout(600) // release/inertia observation; no synthetic scrollTop in this test
    await expect(tip).toBeVisible()
    await tip.locator('.ping-tooltip-time').tap()
    await expect(tip).not.toBeVisible()
    await open(page, 3, true)
    expect(f.calls.length).toBe(requests)
    expect(f.errors).toEqual([])
    await session.detach()
  })

  test('mobile long-list numeric columns stay within chart and viewport before and after rotation', async ({ page }, testInfo) => {
    const f = await setup(page, longNames)
    for (const viewport of [{ width: 390, height: 844 }, { width: 844, height: 390 }, { width: 360, height: 800 }]) {
      await page.setViewportSize(viewport)
      await page.waitForTimeout(200) // finish the resize/hide cycle before the next independent input
      const tip = await open(page, 5, true)
      const bounds = await tip.evaluate((el) => {
        const box = el.getBoundingClientRect()
        const shell = el.parentElement!.getBoundingClientRect()
        return { shell: shell.toJSON(), horizontal: el.scrollWidth - el.clientWidth, right: box.left + el.clientLeft + el.clientWidth, cells: Array.from(el.querySelectorAll('[data-ping-loss]'), cell => ({ right: cell.getBoundingClientRect().right, width: cell.clientWidth, scroll: cell.scrollWidth })),
        }
      })
      const current = await chart(page)
      expect(bounds.shell.right).toBeLessThanOrEqual(Math.min(viewport.width, current.box.right) + 1)
      expect(bounds.shell.left).toBeGreaterThanOrEqual(Math.max(0, current.box.left) - 1)
      expect(bounds.horizontal).toBeLessThanOrEqual(1)
      for (const cell of bounds.cells) {
        expect(cell.right).toBeLessThanOrEqual(bounds.right + 1)
        expect(cell.scroll).toBeLessThanOrEqual(cell.width + 1)
      }
      await page.screenshot({ path: testInfo.outputPath(`mobile-${viewport.width}-tooltip.png`) })
    }
    expect(f.errors).toEqual([])
  })
})
