import type { Page } from '@playwright/test'
import type { MetricSeries } from '../../src/utils/rpc'
import { expect, test } from '@playwright/test'
import { escapePingTooltip, pingChartTaskLabels, pingLossPercent } from '../../src/utils/pingChartPresentation'
import { normalizePingMetricSamples } from '../../src/utils/pingMetricSamples'
import { installKomariFixture, PRIMARY_NODE_UUID } from './fixtures/komari'

const ratios = [0, 0.2, 0.5, 1, 1, null, 0]
const latencies = [20, 100, 999, null, null, 1000, null]
const names = ['Edge', '1.1.1.1', 'Duplicate', 'Duplicate', '<img src=x onerror="alert(1)"> Long '.repeat(8)]

function metricSeries(uuid: string, id: number, end: number, spacing = 60_000): MetricSeries[] {
  const times = ratios.map((_, i) => new Date(end - (8 - i) * spacing).toISOString())
  return ['ping.latency_ms', 'ping.loss'].map(metric_key => ({
    metric_key,
    entity_id: uuid,
    tags: { task_id: String(id), task_name: names[(id - 101) / 101] ?? `Task ${id}` },
    interval_seconds: spacing / 1000,
    downsampled: true,
    count: times.length,
    points: times.map((time, i) => {
      const loss = ratios[i]
      const latency = latencies[i]
      return {
        time,
        value: metric_key === 'ping.loss' ? loss! : latency == null ? null : loss == null ? latency : latency * (1 - loss) - loss,
        count: loss == null && latency == null ? 0 : 5,
      }
    }),
  }))
}

test('loss display uses exact paired ratios, preserves gaps and does not mutate shared inputs', () => {
  const end = Date.parse('2026-07-25T12:00:00Z')
  const series = metricSeries(PRIMARY_NODE_UUID, 101, end)
  series.push(...metricSeries('different-node', 101, end), ...metricSeries(PRIMARY_NODE_UUID, 202, end + 1000))
  // A fill marker is layout, not an observation; out-of-contract loss is unknown.
  series[0]!.points.push({ time: new Date(end - 1000).toISOString(), value: null, count: 0 })
  series[1]!.points.push({ time: new Date(end - 1000).toISOString(), value: null, count: 0 })
  const before = JSON.stringify(series)
  const samples = normalizePingMetricSamples(series, { entityId: PRIMARY_NODE_UUID, start: end - 3600_000, end })
  const own = samples.filter(p => p.taskId === '101')
  expect(own.map(p => pingLossPercent(p.loss))).toEqual([0, 20, 50, 100, 100, null, 0, null])
  expect(own.slice(0, 7).map(p => p.latency)).toEqual(latencies)
  expect(own.at(-1)?.observed).toBe(false)
  expect(samples.every(p => p.entityId === PRIMARY_NODE_UUID)).toBe(true)
  expect(samples.filter(p => p.taskId === '202').map(p => p.timestamp)).not.toEqual(own.map(p => p.timestamp))
  expect([null, undefined, -1, 20, Number.NaN].map(pingLossPercent)).toEqual([null, null, null, null, null])
  expect(JSON.stringify(series)).toBe(before)
  const labels = pingChartTaskLabels([{ id: 1, name: 'same' }, { id: 2, name: 'same' }, { id: 3, name: 'same · #1' }])
  expect(new Set(labels.values()).size).toBe(3)
  expect(escapePingTooltip('<img onerror="x">')).toBe('&lt;img onerror=&quot;x&quot;&gt;')
})

async function fixture(page: Page, options: { many?: boolean, legacy?: boolean, empty?: boolean } = {}) {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await installKomariFixture(page, { hideEarth: true, nodeCount: 2, nodeCardPingFixture: { metric: 'valid' } })
  const calls: Array<{ method: string, params: Record<string, any> }> = []
  const delayed: Array<() => Promise<void>> = []
  let delay = false
  let omit = false
  const ids = options.many ? [101, 202, 303, 404, 505, ...Array.from({ length: 15 }, (_, i) => 606 + i)] : [101, 202, 303, 404, 505]
  const second = '00000000-0000-4000-8000-000000000002'
  const task = (id: number, uuid: string) => ({ id, name: names[(id - 101) / 101] ?? `Task ${id}`, clients: [uuid], interval: 60, type: 'icmp', loss: 88 })
  await page.route('**/rpc2', async (route) => {
    const payload = route.request().postDataJSON()
    const { method, params = {} } = payload
    if (!['public:getPublicPingTasks', 'public:getPingMetricStats', 'public:queryMetrics', 'common:getRecords'].includes(method)
      || (method === 'common:getRecords' && params.type !== 'ping')
      || (method === 'public:queryMetrics' && !params.metric_keys?.includes('ping.latency_ms'))) {
      return route.fallback()
    }
    calls.push({ method, params })
    const nodeIds = params.entity_id && params.entity_id !== PRIMARY_NODE_UUID ? [801, 802] : ids
    const end = Date.parse(params.end ?? '2026-07-25T12:00:00Z')
    const hours = (end - Date.parse(params.start ?? '2026-07-25T11:00:00Z')) / 3600_000
    const spacing = hours > 24 ? 3600_000 : 60_000
    const active = omit ? nodeIds.filter(id => id !== 202) : nodeIds
    const result = method === 'public:getPublicPingTasks'
      ? [...ids.map(id => task(id, PRIMARY_NODE_UUID)), ...[801, 802].map(id => task(id, second))]
      : method === 'public:getPingMetricStats'
        ? { stats: active.map(id => ({ ...task(id, params.entity_id), entity_id: params.entity_id, task_id: String(id), total: 35, valid: 25, avg: 20 })) }
        : method === 'common:getRecords'
          ? { records: options.empty ? [] : [{ client: PRIMARY_NODE_UUID, task_id: 101, time: new Date(end - 60_000).toISOString(), value: 20 }], tasks: [task(101, PRIMARY_NODE_UUID)] }
          : { series: options.legacy || options.empty ? [] : active.flatMap(id => metricSeries(params.entity_id, id, end, spacing)) }
    const respond = async () => {
      await route.fulfill({ json: { jsonrpc: '2.0', id: payload.id, result } })
    }
    if (delay && method !== 'public:getPublicPingTasks')
      delayed.push(respond)
    else await respond()
  })
  return {
    calls,
    errors,
    omit: () => { omit = true },
    delay: () => { delay = true },
    resume: () => { delay = false },
    delayed,
  }
}

// Inspect the actual mounted VChart, with no application-only testing global.
async function chartAction(page: Page, action = 'inspect', argument: any = null): Promise<any> {
  return page.locator('[data-ping-chart] x-vue-echarts').evaluate((element, { action, argument }) => {
    const find = (node: any): any => {
      if (!node)
        return null
      if (node.el === element && node.component?.exposed?.getOption)
        return node.component.exposed
      for (const child of [node.component?.subTree, node.suspense?.activeBranch, ...(Array.isArray(node.children) ? node.children : [])]) {
        const result = find(child)
        if (result)
          return result
      }
      return null
    }
    const chart = find((document.querySelector('#app') as any)._vnode)
    const option = chart.getOption()
    if (action === 'dispatch')
      return chart.dispatchAction(argument)
    if (action === 'tooltip')
      return option.tooltip[0].formatter([{ axisValue: argument, value: [argument, null] }])
    const timestamp = option.series[0]?.data[2]?.[0]
    return {
      option: JSON.parse(JSON.stringify(option)),
      height: chart.getHeight(),
      bounds: element.getBoundingClientRect().toJSON(),
      pixels: option.xAxis.map((_: unknown, xAxisIndex: number) => [option.xAxis[0].min, timestamp, option.xAxis[0].max].map(time => chart.convertToPixel({ xAxisIndex }, time))),
    }
  }, { action, argument })
}

async function ready(page: Page, count = 10) {
  await expect(page.locator('[data-ping-chart]')).toHaveAttribute('data-ping-chart-loss', 'enabled')
  await expect.poll(async () => (await chartAction(page)).option.series.length).toBe(count)
}

test('dual grids, raw loss, smoothing parity, ten toggles and exact shared tooltip', async ({ page, isMobile }, testInfo) => {
  const f = await fixture(page)
  await page.goto(`/instance/${PRIMARY_NODE_UUID}`)
  await ready(page)
  const initial = await chartAction(page)
  const o = initial.option
  expect(o.grid).toHaveLength(2)
  expect(o.legend).toHaveLength(1)
  expect(o.legend[0].data).toHaveLength(5)
  expect(new Set(o.legend[0].data).size).toBe(5)
  expect(o.yAxis[1]).toMatchObject({ min: 0, max: 100, interval: 20 })
  expect(initial.pixels[0]).toEqual(initial.pixels[1])
  expect(o.series[5].data.map((p: any) => p[1])).toEqual([0, 20, 50, 100, 100, null, 0])
  expect(o.series[0].data.map((p: any) => p[1])).toEqual(latencies)
  const timestamps = o.series[0].data.map((p: any) => p[0])
  for (const [i, latency] of latencies.entries()) {
    const html = await chartAction(page, 'tooltip', timestamps[i])
    expect(html).toContain(latency === null ? ratios[i] === 1 ? '不可达' : '—' : `${latency} ms`)
    expect(html).not.toContain('<img')
    expect(html).toContain('&lt;img')
    expect(html).toContain(ratios[i] === null ? '—' : `${(ratios[i]! * 100).toFixed(1)}%`)
  }
  const before = f.calls.length
  const button = page.getByRole('button', { name: '丢包数据', exact: true })
  for (let i = 0; i < 10; i++) {
    if (isMobile)
      await button.tap()
    else await button.click()
    await expect(button).toHaveAttribute('aria-pressed', i % 2 ? 'true' : 'false')
    await expect.poll(async () => (await chartAction(page)).option.grid.length).toBe(i % 2 ? 2 : 1)
    const current = await chartAction(page)
    expect(current.option.series).toHaveLength(i % 2 ? 10 : 5)
    expect(current.option.xAxis).toHaveLength(i % 2 ? 2 : 1)
    expect(current.option.yAxis).toHaveLength(i % 2 ? 2 : 1)
    expect(current.option.series[0].data).toEqual(o.series[0].data)
    if (!(i % 2))
      await expect.poll(async () => (await chartAction(page)).height).toBe(288)
  }
  await page.getByRole('button', { name: '平滑峰值', exact: true }).click()
  const smoothed = await chartAction(page)
  expect(smoothed.option.series[5].data).toEqual(o.series[5].data)
  expect(smoothed.option.series[5].smooth).toBe(false)
  expect(smoothed.option.series[5].connectNulls).toBe(false)
  await button.click()
  const singleSmooth = await chartAction(page)
  expect(singleSmooth.option.series[0].data).toEqual(smoothed.option.series[0].data)
  await button.click()
  expect(f.calls.length).toBe(before)
  expect(f.calls.filter(c => c.method === 'common:getRecords')).toHaveLength(0)
  for (const c of f.calls.filter(c => c.method === 'public:queryMetrics'))
    expect(c.params).toMatchObject({ metric_keys: ['ping.latency_ms', 'ping.loss'], entity_id: PRIMARY_NODE_UUID, downsample: true, fill_empty: true, aggregation: 'avg', max_points: 6000 })
  expect(f.errors).toEqual([])
  await page.locator('[data-ping-chart] x-vue-echarts').screenshot({ path: testInfo.outputPath('dual-ping.png') })
})

test('selection, all-none, catalog-only tasks, shared legend and UUID isolation', async ({ page }) => {
  const f = await fixture(page)
  await page.goto(`/instance/${PRIMARY_NODE_UUID}`)
  await ready(page)
  const root = page.locator('[data-ping-chart]')
  await root.getByRole('button', { name: '全不选', exact: true }).click()
  await root.locator('[data-ping-chart-task-id="202"]').click()
  for (const range of ['6 小时', '12 小时']) {
    await root.getByRole('tab', { name: range, exact: true }).click()
    await expect(root.locator('.animate-spin')).toHaveCount(0)
    await expect(root).toHaveAttribute('data-ping-chart-visible-task-ids', '202')
  }
  f.omit()
  await root.getByRole('tab', { name: '1 天', exact: true }).click()
  await expect(root.locator('.animate-spin')).toHaveCount(0)
  await expect(root).toHaveAttribute('data-ping-chart-visible-task-ids', '202')
  expect((await chartAction(page)).option.series[0].data.every((p: any) => p[1] === null)).toBe(true)
  await root.getByRole('button', { name: '全不选', exact: true }).click()
  await root.getByRole('tab', { name: '7 天', exact: true }).click()
  await expect(root.locator('.animate-spin')).toHaveCount(0)
  await expect(root).toHaveAttribute('data-ping-chart-visible-task-ids', '')
  expect((await chartAction(page)).option.series).toHaveLength(0)
  await root.getByRole('button', { name: '全选', exact: true }).click()
  await chartAction(page, 'dispatch', { type: 'legendToggleSelect', name: 'Duplicate · #303' })
  await expect(root).toHaveAttribute('data-ping-chart-visible-task-ids', '101,202,404,505')
  await page.getByRole('button', { name: '丢包数据', exact: true }).click()
  await page.getByRole('button', { name: '下一个节点', exact: true }).click()
  await ready(page, 4)
  await expect(root).toHaveAttribute('data-ping-chart-visible-task-ids', '801,802')
  expect(f.errors).toEqual([])
})

test('coarse/fine and custom windows share pixel bounds; hover and themes stay bounded', async ({ page }, testInfo) => {
  const f = await fixture(page, { many: true })
  await page.goto(`/instance/${PRIMARY_NODE_UUID}`)
  await ready(page, 40)
  const root = page.locator('[data-ping-chart]')
  for (const range of ['12 小时', '7 天', '自定义']) {
    await root.getByRole('tab', { name: range, exact: true }).click()
    await expect(root.locator('.animate-spin')).toHaveCount(0)
    const actual = await chartAction(page)
    expect(actual.pixels[0]).toEqual(actual.pixels[1])
    expect(actual.option.xAxis[0].min).toBe(actual.option.xAxis[1].min)
    expect(actual.option.xAxis[0].max).toBe(actual.option.xAxis[1].max)
  }
  await root.getByRole('tab', { name: '1 小时', exact: true }).click()
  await expect(root.locator('.animate-spin')).toHaveCount(0)
  for (const theme of ['深色模式', '浅色模式']) {
    await page.getByRole('button', { name: theme, exact: true }).click()
    await root.locator('x-vue-echarts').scrollIntoViewIfNeeded()
    const actual = await chartAction(page)
    await page.mouse.move(actual.bounds.left + actual.pixels[0][1], actual.bounds.top + 350)
    await expect(page.locator('[data-ping-shared-tooltip]')).toBeVisible()
    const measure = await page.locator('[data-ping-shared-tooltip]').evaluate(el => ({ width: el.getBoundingClientRect().width, height: el.getBoundingClientRect().height, viewport: innerWidth, imgs: el.querySelectorAll('img').length }))
    expect(measure.width).toBeLessThan(measure.viewport)
    expect(measure.height).toBeLessThanOrEqual(320)
    expect(measure.imgs).toBe(0)
    const pointer = (await chartAction(page)).option.xAxis.map((axis: any) => axis.axisPointer.value)
    expect(pointer[0]).toBe(pointer[1])
    await root.locator('x-vue-echarts').screenshot({ path: testInfo.outputPath(`${theme}-tooltip.png`) })
    await page.mouse.move(0, 0)
    await expect(page.locator('[data-ping-shared-tooltip]')).not.toBeVisible()
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false)
  expect(f.errors).toEqual([])
})

test('Legacy and empty results never synthesize loss', async ({ page }) => {
  const f = await fixture(page, { legacy: true })
  await page.goto(`/instance/${PRIMARY_NODE_UUID}`)
  await ready(page)
  const actual = await chartAction(page)
  expect(actual.option.series.slice(5).every((s: any) => s.data.every((p: any) => p[1] === null))).toBe(true)
  expect(f.calls.some(c => c.method === 'common:getRecords')).toBe(true)
  expect(f.errors).toEqual([])
})

test('empty history stays empty and all-none does not get reinitialized', async ({ page }) => {
  const f = await fixture(page, { empty: true })
  await page.goto(`/instance/${PRIMARY_NODE_UUID}`)
  await ready(page)
  const actual = await chartAction(page)
  expect(actual.option.series.every((s: any) => s.data.length === 0)).toBe(true)
  await page.locator('[data-ping-chart]').getByRole('button', { name: '全不选', exact: true }).click()
  await page.locator('[data-ping-chart]').getByRole('tab', { name: '6 小时', exact: true }).click()
  await expect(page.locator('[data-ping-chart] .animate-spin')).toHaveCount(0)
  expect((await chartAction(page)).option.series).toHaveLength(0)
  expect(f.errors).toEqual([])
})

test('reversed range responses and late node A cannot replace the accepted chart', async ({ page }) => {
  const f = await fixture(page)
  await page.goto(`/instance/${PRIMARY_NODE_UUID}`)
  await ready(page)
  const root = page.locator('[data-ping-chart]')
  f.delay()
  await root.getByRole('tab', { name: '6 小时', exact: true }).click()
  await expect.poll(() => f.delayed.length).toBe(2)
  await root.getByRole('tab', { name: '12 小时', exact: true }).click()
  await expect.poll(() => f.delayed.length).toBe(4)
  await root.getByRole('tab', { name: '1 小时', exact: true }).click()
  f.resume()
  // The warm 1h cache is intentionally allowed to answer without a request.
  for (const respond of f.delayed.splice(0).reverse()) await respond()
  await expect(root.locator('.animate-spin')).toHaveCount(0)
  const accepted = await chartAction(page)
  expect(accepted.option.xAxis[0].max - accepted.option.xAxis[0].min).toBeLessThanOrEqual(3600_000)
  await expect(root).toHaveAttribute('data-ping-chart-visible-task-ids', '101,202,303,404,505')
  f.delay()
  await root.getByRole('tab', { name: '1 天', exact: true }).click()
  await expect.poll(() => f.delayed.length).toBe(2)
  f.resume()
  await page.getByRole('button', { name: '下一个节点', exact: true }).click()
  await ready(page, 4)
  const nodeB = await chartAction(page)
  for (const respond of f.delayed.splice(0).reverse()) await respond()
  await expect(root).toHaveAttribute('data-ping-chart-visible-task-ids', '801,802')
  expect((await chartAction(page)).option.series).toEqual(nodeB.option.series)
  expect(f.errors).toEqual([])
})
