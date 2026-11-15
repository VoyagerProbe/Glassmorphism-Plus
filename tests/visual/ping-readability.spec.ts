import type { MetricPoint, MetricSeries } from '../../src/utils/rpc'
import { expect, test } from '@playwright/test'
import { assignedChartTasks, currentPingId } from '../../src/utils/pingChartDirectory'
import { chartMetricSamples, chartSymbols } from '../../src/utils/pingChartProjection'
import { smoothPingChartDisplayRows } from '../../src/utils/pingChartSmoothing'
import { mergePingMetricCoverageResponses } from '../../src/utils/pingMetricCoverage'
import { createPingTimeWindow } from '../../src/utils/pingTime'
import { firstNode, frozenPing, hour, minute, openPing, renderedPing, secondNode, selectOnly, switchWindow } from './fixtures/ping-readability'

test('malformed directories are unknown; numeric display names are not task keys', () => {
  const row = { id: 17, name: '32', clients: [firstNode], loss: 0, interval: 60 }
  expect(assignedChartTasks([row, { ...row, id: 23, clients: [secondNode] }], firstNode)).toEqual([row])
  expect(assignedChartTasks([], firstNode)).toEqual([])
  expect(() => assignedChartTasks([row, row], firstNode)).toThrow()
  expect(() => assignedChartTasks([{ ...row, clients: undefined }], firstNode)).toThrow()
  for (const key of ['Main', '3e1', 0, 1.2])
    expect(currentPingId(key)).toBeNaN()
})

test('exact timestamps, ranking, peer conflicts, independent dimensions and real gaps survive projection', () => {
  const end = Date.parse('2026-08-13T08:00:00Z')
  const window = createPingTimeWindow(end - hour, end, 20)!
  const t = end - 10 * minute
  const point = (ms: number, value: number | null, count = 1): MetricPoint => ({ time: new Date(ms).toISOString(), value, count })
  const series = (metric_key: string, points: MetricPoint[], step: number, name: string, dims = {}): MetricSeries => ({
    metric_key,
    points,
    entity_id: firstNode,
    count: points.length,
    downsampled: true,
    interval_seconds: step,
    tags: { task_id: '27', task_name: name, ...dims },
  })
  const response = (items: MetricSeries[]) => ({ start: new Date(window.start).toISOString(), end: new Date(end).toISOString(), series: items, count: items.length })
  const latency = 'ping.latency_ms'
  const loss = 'ping.loss'
  const coarse = response([series(latency, [point(t, 0), point(t + minute, 40), point(t + 2 * minute, 20)], 3600, 'Old')])
  const fine = response([series(latency, [point(t, null, 0), point(t + minute, null), point(t + 2 * minute, 39), point(t + 2 * minute, 42), point(end, 98), point(window.start - 1, 98), { time: 'invalid', value: 98, count: 1 }], 60, 'Current'), series(loss, [point(t, 0), point(t + minute, 1), point(t + 2 * minute, 0)], 60, 'Current')])
  const read = (items: typeof coarse[]) => chartMetricSamples(mergePingMetricCoverageResponses(items).series, firstNode, window)
    .map(s => [s.timestamp, s.latency, s.loss])
  const expected = [[t, 0, 0], [t + minute, null, 1], [t + 2 * minute, null, 0]]
  expect(read([coarse, fine])).toEqual(expected)
  expect(read([coarse, { ...fine, series: fine.series.map(s => ({ ...s, points: [...s.points].reverse() })) }])).toEqual(expected)
  expect(read([coarse, fine, fine])).toEqual(expected)
  const zeroAndFailure = response([series(latency, [point(t, -0.5, 2)], 60, 'Current'), series(loss, [point(t, 0.5, 2)], 60, 'Current')])
  expect(read([zeroAndFailure])).toEqual([[t, 0, 0.5]])
  const incompatible = response([series(latency, [point(t, 40)], 60, 'New', { protocol: 'tcp' }), series(loss, [point(t, 1)], 60, 'New', { protocol: 'icmp' })])
  expect(read([incompatible])).toEqual([[t, null, null]])
  expect(chartSymbols([[t, 1], [t + 10, null], [t + 20, 0]])).toMatchObject({ showSymbol: false })
  expect(chartSymbols([[t, null], [t + 10, 0]])).toMatchObject({ showSymbol: true, symbolSize: 4 })
  expect(smoothPingChartDisplayRows([{ time: t, 27: 10 }, { time: t + 1, 99: 1 }, { time: t + 2, 27: 30 }, { time: t + 3, 27: null }, { time: t + 4, 27: 41 }], [27]).map(r => r[27])).toEqual([10, undefined, 17, null, 41])
})

for (const entry of ['home', 'detail'] as const) {
  test(`${entry}: shared recovery does not change healthy density, summary, outages or marker policy`, async ({ page, hasTouch }) => {
    const fixture = await frozenPing(page, { main: true, cold: true })
    const owner = await openPing(page, entry)
    await expect(owner.locator('[data-ping-chart-task-id="101"]')).toContainText('Main')
    await expect(owner.locator('[data-ping-chart-task-id="303"]')).toContainText('32')
    await expect(owner.locator('[data-ping-chart-task-id="909"]')).toHaveCount(0)
    fixture.calls.length = 0
    await switchWindow(owner, 14)
    await expect.poll(async () => (await renderedPing(owner)).series.find(s => s.id === 'latency-101')?.points.length).toBe(2)
    const end = Number(await owner.getAttribute('data-ping-chart-window-end'))
    const chart = await renderedPing(owner)
    expect(chart.series.find(s => s.id === 'latency-101')?.points).toEqual([[end - 3 * minute, 23], [end - 2 * minute, 24]])
    for (const id of ['latency-202', 'loss-202', 'latency-303', 'loss-303']) {
      const s = chart.series.find(s => s.id === id)!
      expect(s.points).toHaveLength(336)
      expect(s.points.filter(([t]) => t >= end - hour)).toHaveLength(1)
      expect(s.points.filter(([t]) => t >= end - 24 * hour)).toHaveLength(24)
      expect(s.showSymbol).toBe(false)
      expect(s.clip).toBe(true)
      expect(s.points.some(([, y]) => y === (id.startsWith('loss') ? 100 : null))).toBe(true)
      expect(s.points.some(([, y]) => y === 0)).toBe(true)
    }
    expect(chart.series.find(s => s.id === 'loss-404')).toMatchObject({ showSymbol: true, size: 4, points: [[end - 7 * minute, 100]] })
    expect(chart.series.find(s => s.id === 'latency-404')?.showSymbol).toBe(false)
    expect(fixture.calls.map(c => c.hours)).toEqual([336, 24])
    expect(fixture.legacy()).toBe(0)
    const info = owner.locator('[data-ping-chart-task-id="202"] button')
    // A touch-capable Windows host is not necessarily a touch-enabled Playwright context.
    const clickToToggle = await page.evaluate(() => navigator.maxTouchPoints > 0 || matchMedia('(pointer: coarse)').matches)
    if (hasTouch)
      await info.tap()
    else if (clickToToggle)
      await info.click()
    else
      await info.hover()
    const tip = page.locator('[data-slot="tooltip-content"]:visible').last()
    await expect(tip).toContainText('最新')
    await expect(tip).toContainText('13 ms')
    if (hasTouch)
      await info.tap()
    else if (clickToToggle)
      await info.click()
    await selectOnly(owner, [101])
    for (const days of [1, 7, 30]) {
      await switchWindow(owner, days)
      await expect(owner).toHaveAttribute('data-ping-chart-visible-task-ids', '101')
      await expect.poll(async () => (await renderedPing(owner)).series.map(s => [s.id, s.points.length])).toEqual([['latency-101', 2], ['loss-101', 2]])
    }
  })
}

test('an empty day is authoritative, a missing long series reuses real points, and reopening an hour reads it again', async ({ page }) => {
  const f = await frozenPing(page, { main: true, emptyDayMain: true })
  const owner = await openPing(page, 'detail')
  await selectOnly(owner, [101])
  const points = async () => (await renderedPing(owner)).series.find(s => s.id === 'latency-101')?.points
  const end = Number(await owner.getAttribute('data-ping-chart-window-end'))
  const recent = [[end - 3 * minute, 23], [end - 2 * minute, 24]]
  await expect.poll(points).toEqual(recent)
  f.calls.length = 0
  await switchWindow(owner, 1)
  await expect.poll(points).toEqual([])
  expect(f.calls.map(c => c.hours)).toEqual([24])
  f.calls.length = 0
  await switchWindow(owner, 14)
  await expect.poll(points).toEqual(recent)
  expect(f.calls.map(c => c.hours)).toEqual([336])
  f.calls.length = 0
  await owner.getByRole('tab', { name: '1 小时', exact: true }).click()
  await expect.poll(() => f.calls.map(c => c.hours)).toEqual([1])
  await expect.poll(async () => Number(await owner.getAttribute('data-ping-chart-window-end')) - Number(await owner.getAttribute('data-ping-chart-window-start'))).toBe(hour)
  await expect.poll(points).toEqual(recent)
  expect(f.legacy()).toBe(0)
})

test('covered cold budgets, bounded empty rescue, and permission denial have distinct outcomes', async ({ browser }) => {
  for (const mode of ['covered', 'empty', 'deny'] as const) {
    const page = await browser.newPage({ baseURL: 'http://127.0.0.1:4173' })
    try {
      const state = await frozenPing(page, { main: mode === 'empty', emptyTail: true, deny: mode === 'deny' })
      if (mode === 'deny') {
        await page.goto(`/instance/${firstNode}`)
        await expect(page.locator('[data-ping-chart]')).toContainText('Permission denied')
        expect(state.calls).toHaveLength(0)
      }
      else {
        const owner = await openPing(page, 'detail')
        state.calls.length = 0
        await switchWindow(owner, 30)
        expect(state.calls.map(c => c.hours)).toEqual(mode === 'covered' ? [720, 600] : [720, 600, 24])
        if (mode === 'empty')
          expect((await renderedPing(owner)).series.find(s => s.id === 'latency-101')?.points).toEqual([])
        expect(new Set(state.calls.map(c => JSON.stringify(c))).size).toBe(state.calls.length)
      }
      expect(state.legacy()).toBe(0)
    }
    finally { await page.close() }
  }
})

test('rapid windows and node changes retain no retired or cross-node series', async ({ page }) => {
  await frozenPing(page, { main: true })
  const owner = await openPing(page, 'detail')
  await owner.getByRole('tab', { name: '30 天', exact: true }).click()
  await owner.getByRole('tab', { name: '14 天', exact: true }).click()
  await switchWindow(owner, 1)
  // Use the in-app selector so the same mounted component must drop old IDs.
  await page.getByRole('button', { name: '下一个节点', exact: true }).click()
  await expect(page).toHaveURL(new RegExp(secondNode))
  await expect(owner.locator('[data-ping-chart-task-id="101"]')).toHaveCount(0)
  await expect.poll(async () => (await renderedPing(owner)).series.map(s => s.id)).toEqual(['latency-202', 'latency-303', 'latency-404', 'loss-202', 'loss-303', 'loss-404'])
})
