import type { Locator, Page } from '@playwright/test'
import { expect } from '@playwright/test'
import { installKomariFixture, PRIMARY_NODE_UUID } from './komari'

export const firstNode = PRIMARY_NODE_UUID
export const secondNode = '00000000-0000-4000-8000-000000000002'
export const hour = 3_600_000
export const minute = 60_000
const iso = (ms: number) => new Date(ms).toISOString()
type Sample = [number, number | null, number]
export type Entry = 'home' | 'detail'
interface Call { node: string, start: string, end: string, hours: number, max: number, agg: string, fill: boolean, down: boolean, keys: string[] }
export interface ReadabilityFixture { main?: boolean, deny?: boolean, emptyTail?: boolean, emptyDayMain?: boolean, cold?: boolean }

/**
 * All variants see exactly the same synthetic response for a request. No
 * production recording, location, label, credentials or host is in this fixture.
 */
export async function frozenPing(page: Page, options: ReadabilityFixture = {}) {
  await installKomariFixture(page, { clockNow: '2026-08-13T07:59:30Z', dark: true, hideEarth: true, nodeCount: 2, pingRecordPreserveTime: 720, nodeCardPingFixture: { metric: 'valid' } })
  const calls: Call[] = []
  const catalog = [
    { id: 202, name: 'Established', clients: [firstNode, secondNode] },
    { id: 303, name: '32', clients: [firstNode, secondNode] },
    { id: 404, name: 'Singleton', clients: [firstNode, secondNode] },
    ...(options.main ? [{ id: 101, name: 'Main', clients: [firstNode] }] : []),
  ].map(t => ({ ...t, interval: 60, type: 'tcp', default_on: true }))
  let legacy = 0
  await page.route('**/rpc2', async (route) => {
    const { id, method, params = {} } = route.request().postDataJSON()
    const reply = (result: unknown) => route.fulfill({ json: { jsonrpc: '2.0', id, result } })
    if (method === 'public:getPublicPingTasks') {
      if (options.deny)
        return route.fulfill({ json: { jsonrpc: '2.0', id, error: { code: -32041, message: 'Permission denied' } } })
      return reply(catalog)
    }
    const uuid = params.entity_id ?? params.uuid
    if (method === 'common:getRecords' && params.type === 'ping' && params.uuid)
      legacy++
    if (!params.start || !params.end || ![firstNode, secondNode].includes(uuid) || params.tags || params.task_ids || params.task_id)
      return route.fallback()
    const start = Date.parse(params.start)
    const end = Date.parse(params.end)
    const hours = (end - start) / hour
    const assigned = catalog.filter(t => t.clients.includes(uuid))
    if (method === 'public:getPingMetricStats') {
      return reply({ stats: [...assigned, { id: 909, name: 'Retired', interval: 60, type: 'tcp' }].filter(t => t.id !== 101 || hours <= 24).map(t => ({
        task_id: String(t.id),
        entity_id: uuid,
        name: t.name,
        interval: t.interval,
        type: t.type,
        tags: {},
        total: 75,
        valid: 60,
        min: 0,
        max: 41,
        avg: 12,
        latest: 13,
        p50: 11,
        p99: 35,
        p99_p50_ratio: 3.18,
        stddev: 5,
        loss: 20,
      })) })
    }
    if (method !== 'public:queryMetrics' || !params.metric_keys?.includes('ping.latency_ms'))
      return route.fallback()
    calls.push({ node: uuid, start: params.start, end: params.end, hours, max: params.max_points, agg: params.aggregation, fill: params.fill_empty, down: params.downsample, keys: [...params.metric_keys] })
    const step = hours > 600 ? 24 * hour : hours > 24 ? hour : hours > 1 ? 5 * minute : minute
    const items: { entity_id: string, metric_key: string, tags: { task_id: string }, downsampled: boolean, interval_seconds: number, count: number, points: { time: string, value: number | null, count: number }[] }[] = []
    for (const t of [...assigned, { id: 909, name: 'Retired' }]) {
      for (const metric of ['ping.latency_ms', 'ping.loss']) {
        const isLoss = metric === 'ping.loss'
        const points: Sample[] = []
        if (t.id === 101) {
          if (!options.emptyTail && hours <= 24 && !(options.cold && hours === 1) && !(options.emptyDayMain && hours === 24))
            points.push([end - 3 * minute, isLoss ? 0 : 23, 1], [end - 2 * minute, isLoss ? 0 : 24, 1])
        }
        else if (t.id === 404) {
          points.push([end - 7 * minute, isLoss ? 1 : null, 1])
        }
        else if (t.id === 909) {
          points.push([end - 39 * minute, isLoss ? 0 : 91, 1])
        }
        else {
          for (let time = Math.ceil(start / step) * step; time < end; time += step) {
            const idx = Math.floor(time / step)
            if (idx % 29 === 0) {
              points.push([time, null, 0]) // own fill-empty gap, not a foreign task timestamp
              continue
            }
            const loss = idx % 11 === 0 ? 1 : 0
            points.push([time, isLoss ? loss : loss === 1 ? null : idx % 13 === 0 ? 0 : (t.id % 47) + idx % 8, 1])
          }
        }
        items.push({ entity_id: uuid, metric_key: metric, tags: { task_id: String(t.id) }, downsampled: true, interval_seconds: step / 1000, count: points.length, points: points.map(([time, value, count]) => ({ time: iso(time), value, count })) })
      }
    }
    return reply({ start: params.start, end: params.end, series: items, count: items.length })
  })
  return { calls, legacy: () => legacy }
}

export async function openPing(page: Page, entry: Entry, node = firstNode) {
  await page.goto(entry === 'home' ? '/' : `/instance/${node}`)
  if (entry === 'home')
    await page.locator(`[data-node-card-uuid="${node}"] button[data-node-ping-panel="latency"]`).click()
  const owner = (entry === 'home' ? page.getByRole('dialog') : page).locator('[data-ping-chart]')
  await expect(owner.locator('[data-ping-chart-task-id="202"]')).toBeVisible()
  return owner
}

export async function selectOnly(owner: Locator, ids: number[]) {
  await owner.getByRole('button', { name: '全不选', exact: true }).click()
  for (const id of ids)
    await owner.locator(`[data-ping-chart-task-id="${id}"]`).click()
  await expect(owner).toHaveAttribute('data-ping-chart-visible-task-ids', ids.join(','))
}

interface ModelSeries { id: string, data: [number, number | null][], clip: boolean, smooth: boolean | number, showSymbol: boolean, symbolSize: number }
interface Axis { type: string, min: number, max: number }
interface Plot { getOption: () => { series: ModelSeries[], xAxis: Axis[] }, getWidth: () => number, getHeight: () => number, convertToPixel: (finder: { xAxisIndex: number }, t: number) => number }
interface VNode { el?: Element, component?: { exposed?: { chart?: { value?: Plot } }, subTree?: VNode }, children?: VNode[], suspense?: { activeBranch?: VNode } }
export async function renderedPing(owner: Locator) {
  return owner.locator('x-vue-echarts').evaluate((el) => {
    function find(n?: VNode): Plot | undefined {
      if (!n)
        return
      if (n.el === el && n.component?.exposed?.chart?.value)
        return n.component.exposed.chart.value
      for (const child of [n.component?.subTree, n.suspense?.activeBranch, ...(Array.isArray(n.children) ? n.children : [])]) {
        const plot = find(child)
        if (plot)
          return plot
      }
    }
    const plot = find((document.querySelector('#app') as unknown as { _vnode: VNode })._vnode)
    if (!plot)
      throw new Error('Mounted ECharts model is unavailable')
    const opt = plot.getOption()
    return { width: plot.getWidth(), height: plot.getHeight(), dpr: devicePixelRatio, axes: opt.xAxis.map(a => ({ type: a.type, min: a.min, max: a.max })), series: opt.series.map(s => ({ id: s.id, points: s.data, clip: s.clip, smooth: s.smooth, showSymbol: s.showSymbol, size: s.symbolSize, xs: s.data.filter(([,v]) => v !== null).map(([t]) => plot.convertToPixel({ xAxisIndex: s.id.startsWith('loss-') ? 1 : 0 }, t)) })) }
  })
}

export async function switchWindow(owner: Locator, days: number) {
  await owner.getByRole('tab', { name: `${days} 天`, exact: true }).click()
  await expect.poll(async () => Number(await owner.getAttribute('data-ping-chart-window-end')) - Number(await owner.getAttribute('data-ping-chart-window-start'))).toBe(days * 24 * hour)
  await expect(owner.locator('.animate-spin')).toHaveCount(0)
}
