import type { Locator, Page } from '@playwright/test'
import { writeFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'
import { installKomariFixture, PRIMARY_NODE_UUID } from './fixtures/komari'

const secondNode = '00000000-0000-4000-8000-000000000002'

async function setup(page: Page, modal: boolean, touch: boolean, mode = 'regular') {
  await installKomariFixture(page, { dark: true, hideEarth: true, nodeCount: 2, nodeCardPingFixture: { metric: 'valid' } })
  const calls: string[] = []
  const errors: string[] = []
  page.on('pageerror', e => errors.push(e.message))
  await page.route('**/rpc2', async (route) => {
    const { method, params = {}, id } = route.request().postDataJSON()
    if (mode === 'empty' && method === 'common:getRecords' && params.type === 'ping') {
      calls.push(JSON.stringify({ method, params }))
      return route.fulfill({ json: { jsonrpc: '2.0', id, result: { records: [], tasks: [] } } })
    }
    if (!['public:getPublicPingTasks', 'public:getPingMetricStats', 'public:queryMetrics'].includes(method)
      || (method === 'public:queryMetrics' && !params.metric_keys?.includes('ping.latency_ms'))) {
      return route.fallback()
    }
    calls.push(JSON.stringify({ method, params }))
    const tasks = [PRIMARY_NODE_UUID, secondNode].flatMap((uuid, n) => [101, 202, 303].map((tid, i) => ({ id: tid + n * 1000, name: ['Edge HK', '1.1.1.1', 'Edge TW'][i], clients: [uuid], interval: 60, type: 'icmp' })))
    const selected = tasks.filter(t => t.clients.includes(params.entity_id ?? PRIMARY_NODE_UUID))
    const end = Date.parse(params.end ?? '2026-07-25T12:00:00Z')
    const start = Date.parse(params.start ?? new Date(end - 3600000).toISOString())
    const result = method === 'public:getPublicPingTasks'
      ? tasks
      : method === 'public:getPingMetricStats'
        ? { stats: selected.map(t => ({ ...t, entity_id: params.entity_id, task_id: String(t.id), total: 60, valid: 59, avg: 20 })) }
        : { series: selected.flatMap((t, n) => ['ping.latency_ms', 'ping.loss'].map(metric_key => ({
            metric_key,
            entity_id: params.entity_id,
            tags: { task_id: String(t.id), task_name: t.name },
            interval_seconds: 60,
            downsampled: true,
            count: 60,
            points: mode === 'empty'
              ? []
              : Array.from({ length: 60 }, (_, i) => {
                  const loss = mode === 'mixed' ? [0, 0.2, 1, null][i % 4]! : 0
                  const latency = mode === 'mixed' ? [0, 20, null, null][i % 4]! : 2 + n * 11 + i % 3
                  return { time: new Date(start + (end - start) * (i + 1) / 60).toISOString(), value: metric_key === 'ping.loss' ? loss : latency === null ? null : latency * (1 - loss!) - loss!, count: loss === null ? 0 : 5 }
                }),
          }))) }
    await route.fulfill({ json: { jsonrpc: '2.0', id, result } })
  })
  await page.goto(modal ? '/' : `/instance/${PRIMARY_NODE_UUID}`)
  if (modal) {
    const entry = page.locator(`[data-node-card-uuid="${PRIMARY_NODE_UUID}"] [data-node-ping-header="latency"]`).first()
    if (touch)
      await entry.tap()
    else await entry.click()
  }
  const owner = modal ? page.getByRole('dialog').locator('[data-ping-chart]') : page.locator('[data-ping-chart]')
  await expect(owner).toHaveAttribute('data-ping-chart-visible-task-ids', '101,202,303')
  await expect.poll(async () => (await inspect(owner)).series.length).toBe(6)
  return { owner, calls, errors }
}

// Observe input, the effective ECharts model, and the rendered axis view separately.
// No production debug global or mutations of chart options are involved.
async function inspect(owner: Locator, action = 'inspect', argument: any = null): Promise<any> {
  return owner.locator('x-vue-echarts').evaluate((element, { action, argument }) => {
    const find = (n: any): any => {
      if (!n)
        return null
      if (n.el === element && n.component?.exposed?.getOption)
        return n
      for (const child of [n.component?.subTree, n.suspense?.activeBranch, ...(Array.isArray(n.children) ? n.children : [])]) {
        const found = find(child)
        if (found)
          return found
      }
      return null
    }
    const node = find((document.querySelector('#app') as any)._vnode)
    const exposed = node.component.exposed
    let chart = exposed.chart.value
    if (action === 'dispatch') {
      exposed.dispatchAction(argument)
      return
    }
    exposed.dispatchAction({ type: 'hideTip' })
    exposed.dispatchAction({ type: 'updateAxisPointer', currTrigger: 'leave' })
    let freshHost: HTMLDivElement | undefined
    if (action === 'fresh-single') {
      // Isolated initial ECharts render of the exact single input; supplements,
      // never substitutes for, the real component's toggle/resize path above.
      freshHost = document.createElement('div')
      document.body.append(freshHost)
      chart = new chart.constructor(freshHost, {}, { renderer: 'canvas', width: exposed.getWidth(), height: exposed.getHeight() })
      chart.setOption(node.props.option)
    }
    const model = chart.getModel()
    const axes: any[] = []
    model.eachComponent('xAxis', (axis: any) => {
      const labels: any[] = []
      chart.getViewOfComponentModel(axis).group.traverse((el: any) => {
        if (el.type !== 'text')
          return
        let hidden = el.ignore || el.invisible
        for (let parent = el.parent; parent; parent = parent.parent)
          hidden ||= parent.ignore || parent.invisible
        const rect = el.getBoundingRect().clone()
        rect.applyTransform(el.getComputedTransform())
        labels.push({ text: el.style.text, hidden: Boolean(hidden), x: rect.x, y: rect.y, width: rect.width, height: rect.height })
      })
      axes.push({ id: axis.id, index: axis.componentIndex, gridIndex: axis.getCoordSysModel().componentIndex, hideOverlap: axis.get(['axisLabel', 'hideOverlap']), type: axis.get('type'), extent: axis.axis.scale.getExtent(), labels })
    })
    const grids: any[] = []
    model.eachComponent('grid', (grid: any) => grids.push({ id: grid.id, rect: grid.coordinateSystem.getRect() }))
    const yAxes: any[] = []
    model.eachComponent('yAxis', (axis: any) => yAxes.push({ id: axis.id, gridIndex: axis.get('gridIndex'), name: axis.get('name') }))
    const option = chart.getOption()
    const result = JSON.parse(JSON.stringify({
      id: chart.id,
      width: exposed.getWidth(),
      height: exposed.getHeight(),
      dpr: chart.getDevicePixelRatio(),
      host: element.getBoundingClientRect().toJSON(),
      input: node.props.option,
      grids,
      axes,
      yAxes,
      series: option.series,
      legend: option.legend,
      axisPointer: option.axisPointer,
      listeners: Object.fromEntries(Object.entries(chart._$handlers ?? {}).map(([key, value]: any) => [key, value.length])),
    }))
    if (freshHost) {
      chart.dispose()
      freshHost.remove()
    }
    return result
  }, { action, argument })
}

function assertLayout(state: any, dual: boolean) {
  expect(state.grids).toHaveLength(dual ? 2 : 1)
  expect(state.axes).toHaveLength(dual ? 2 : 1)
  expect(state.yAxes).toHaveLength(dual ? 2 : 1)
  expect(state.width).toBeCloseTo(state.host.width, 0)
  expect(state.height).toBeCloseTo(state.host.height, 0)
  for (const axis of state.axes) {
    expect(axis.type).toBe('time')
    expect(axis.gridIndex).toBe(axis.index)
    const labels = axis.labels.filter((label: any) => !label.hidden).sort((a: any, b: any) => a.x - b.x)
    const grid = state.grids[axis.gridIndex].rect
    // Date + time labels are wider than HH:mm. At 360px the existing dual
    // chart can fit only two of those; require an interior tick, not endpoints
    // only, and retain the stricter three-label floor for the reported 1h case.
    const dated = axis.extent[1] - axis.extent[0] >= 86400000
    expect(labels.length, 'usable visible time ticks').toBeGreaterThanOrEqual(dated && grid.width < 300 ? 2 : 3)
    expect(labels.some((label: any) => label.x + label.width / 2 > grid.x + grid.width * 0.1 && label.x + label.width / 2 < grid.x + grid.width * 0.9), 'intermediate tick remains visible').toBe(true)
    for (let i = 1; i < labels.length; i++) {
      expect(labels[i].x, `visible time labels overlap: ${labels[i - 1].text} / ${labels[i].text}`).toBeGreaterThanOrEqual(labels[i - 1].x + labels[i - 1].width - 0.5)
    }
  }
}

for (const width of [360, 390, 1280]) {
  test.describe(`Ping axis ${width}`, () => {
    test.use({ viewport: { width, height: 900 }, hasTouch: width < 500, isMobile: width < 500, deviceScaleFactor: width < 500 ? 3 : 1 })
    for (const modal of [false, true]) {
      test(`${modal ? 'modal' : 'detail'} dual to single keeps visible Canvas labels separated`, async ({ page }, info) => {
        // This scenario deliberately performs >30 native interactions, including
        // ten same-instance toggles and three range round trips on mobile WebKit.
        test.setTimeout(90000)
        const { owner, calls, errors } = await setup(page, modal, width < 500)
        await owner.locator('x-vue-echarts').scrollIntoViewIfNeeded()
        await page.mouse.move(0, 0)
        const initial = await inspect(owner)
        assertLayout(initial, true)
        writeFileSync(info.outputPath('dual-model.json'), JSON.stringify(initial, null, 2))
        await info.attach('dual-model', { body: JSON.stringify(initial, null, 2), contentType: 'application/json' })
        await owner.locator('x-vue-echarts').screenshot({ path: info.outputPath('dual.png') })
        const requests = [...calls]
        const button = owner.getByRole('button', { name: '丢包数据', exact: true })
        if (width < 500)
          await button.tap()
        else await button.click()
        await expect(button).toHaveAttribute('aria-pressed', 'false')
        await expect.poll(async () => (await inspect(owner)).height).toBe(288)
        await page.mouse.move(0, 0)
        const single = await inspect(owner)
        writeFileSync(info.outputPath('single-model.json'), JSON.stringify(single, null, 2))
        await info.attach('single-model', { body: JSON.stringify(single, null, 2), contentType: 'application/json' })
        await owner.locator('x-vue-echarts').screenshot({ path: info.outputPath('single.png') })
        expect(single.id).toBe(initial.id)
        expect(single.series.map((s: any) => s.data)).toEqual(initial.series.slice(0, 3).map((s: any) => s.data))
        expect(calls).toEqual(requests)
        assertLayout(single, false)
        const fresh = await inspect(owner, 'fresh-single')
        assertLayout(fresh, false)
        expect(fresh.axes.map((a: any) => a.labels)).toEqual(single.axes.map((a: any) => a.labels))
        expect(fresh.series.map((s: any) => s.data)).toEqual(single.series.map((s: any) => s.data))
        for (let i = 0; i < 10; i++) {
          if (width < 500)
            await button.tap()
          else await button.click()
          const dual = i % 2 === 0
          await expect.poll(async () => (await inspect(owner)).height).toBe(dual ? 528 : 288)
          const current = await inspect(owner)
          assertLayout(current, dual)
          expect(current.id).toBe(initial.id)
          expect(current.listeners).toEqual(single.listeners)
          expect(current.series.slice(0, 3).map((s: any) => s.data)).toEqual(single.series.map((s: any) => s.data))
        }
        expect(calls).toEqual(requests)
        for (const range of ['12 小时', '7 天', '自定义']) {
          await owner.getByRole('tab', { name: range, exact: true }).click()
          await expect(owner.locator('.animate-spin')).toHaveCount(0)
          const before = await inspect(owner)
          writeFileSync(info.outputPath(`range-${range}.json`), JSON.stringify(before, null, 2))
          assertLayout(before, false)
          const rangeRequests = [...calls]
          await button.click()
          await expect.poll(async () => (await inspect(owner)).height).toBe(528)
          const dual = await inspect(owner)
          assertLayout(dual, true)
          expect(dual.axes[0].extent).toEqual(dual.axes[1].extent)
          expect(dual.series.slice(0, 3).map((s: any) => s.data)).toEqual(before.series.map((s: any) => s.data))
          await button.click()
          await expect.poll(async () => (await inspect(owner)).height).toBe(288)
          assertLayout(await inspect(owner), false)
          expect(calls).toEqual(rangeRequests)
        }
        if (width < 500) {
          await page.setViewportSize({ width: 844, height: 390 })
          await expect.poll(async () => {
            const s = await inspect(owner)
            return Math.abs(s.width - s.host.width)
          }).toBeLessThan(1)
          assertLayout(await inspect(owner), false)
          await page.setViewportSize({ width, height: 900 })
          await expect.poll(async () => {
            const s = await inspect(owner)
            return Math.abs(s.width - s.host.width)
          }).toBeLessThan(1)
          assertLayout(await inspect(owner), false)
        }
        await owner.getByRole('tab', { name: '1 小时', exact: true }).click()
        await expect(owner.locator('.animate-spin')).toHaveCount(0)
        await owner.getByRole('button', { name: '全不选', exact: true }).click()
        await button.click()
        expect((await inspect(owner)).series).toHaveLength(0)
        await owner.locator('[data-ping-chart-task-id="202"]').click()
        await button.click()
        expect((await inspect(owner)).series.map((s: any) => s.id)).toEqual(['latency-202'])
        await owner.getByRole('button', { name: '全选', exact: true }).click()
        await inspect(owner, 'dispatch', { type: 'legendToggleSelect', name: 'Edge TW' })
        const selection = (await inspect(owner)).legend[0].selected
        await button.click()
        expect((await inspect(owner)).legend[0].selected).toEqual(selection)
        await inspect(owner, 'dispatch', { type: 'showTip', seriesIndex: 0, dataIndex: 20 })
        await expect(page.locator('[data-ping-shared-tooltip]')).toBeVisible()
        await button.click()
        await expect(page.locator('[data-ping-shared-tooltip]')).not.toBeVisible()
        await button.click()
        await inspect(owner, 'dispatch', { type: 'showTip', seriesIndex: 0, dataIndex: 21 })
        await expect(page.locator('[data-ping-shared-tooltip]')).toBeVisible()
        await inspect(owner)
        if (!modal) {
          await page.getByRole('button', { name: '浅色模式', exact: true }).click()
          assertLayout(await inspect(owner), true)
          await button.click()
          await expect.poll(async () => (await inspect(owner)).height).toBe(288)
          assertLayout(await inspect(owner), false)
          await page.getByRole('button', { name: '下一个节点', exact: true }).click()
          await expect(owner).toHaveAttribute('data-ping-chart-visible-task-ids', '1101,1202,1303')
          expect((await inspect(owner)).series.every((s: any) => /-(?:1101|1202|1303)$/.test(s.id))).toBe(true)
        }
        expect(errors).toEqual([])
      })
    }
  })
}

test.describe('Ping axis raw-data guards', () => {
  test.use({ viewport: { width: 390, height: 900 }, hasTouch: true })
  for (const modal of [false, true]) {
    for (const mode of ['empty', 'mixed']) {
      test(`${modal ? 'modal' : 'detail'} ${mode} history preserves zeros, loss and gaps during toggles`, async ({ page }) => {
        const { owner, calls } = await setup(page, modal, true, mode)
        const initial = await inspect(owner)
        const before = [...calls]
        const button = owner.getByRole('button', { name: '丢包数据', exact: true })
        if (mode === 'empty') {
          expect(initial.series.every((s: any) => s.data.length === 0)).toBe(true)
        }
        else {
          expect(initial.series[0].data.slice(0, 4).map((p: any) => p[1])).toEqual([0, 20, null, null])
          expect(initial.series[3].data.slice(0, 4).map((p: any) => p[1])).toEqual([0, 20, 100, null])
        }
        await button.tap()
        expect((await inspect(owner)).series.map((s: any) => s.data)).toEqual(initial.series.slice(0, 3).map((s: any) => s.data))
        await button.tap()
        expect((await inspect(owner)).series.map((s: any) => s.data)).toEqual(initial.series.map((s: any) => s.data))
        expect(calls).toEqual(before)
      })
    }
  }
})
