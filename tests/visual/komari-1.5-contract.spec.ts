import type { MetricSeries } from '../../src/utils/rpc'
import { expect, test } from '@playwright/test'
import { normalizePingMetricSamples } from '../../src/utils/pingMetricSamples'
import { installKomariFixture, PRIMARY_NODE_UUID } from './fixtures/komari'

// Synthetic contract shapes checked against the original Komari 1.4.3,
// 1.5.0 and 1.5.0-fix1 binaries. No recorded server response or credential.
// The 1.5 backends fix `gpu` itself; optional metadata must not override it.
for (const scenario of [
  { name: '1.4.3 absent GPU metadata', gpu: 0, metadata: {} },
  { name: '1.5 GPU average and device metadata', gpu: 42, metadata: { gpu_count: 1, gpu_average_usage: 42, gpu_detailed_info: [{ name: 'Synthetic GPU', utilization: 42, memory_total: 8 * 1024 ** 3, memory_used: 2 * 1024 ** 3, temperature: 45 }] } },
  { name: 'real zero GPU with optional empty metadata', gpu: 0, metadata: { gpu_count: 0, gpu_average_usage: 0, gpu_detailed_info: [] } },
  { name: 'nullable optional metadata', gpu: 0, metadata: { gpu_count: null, gpu_average_usage: null, gpu_detailed_info: null } },
]) {
  test(`Komari status preserves existing metrics: ${scenario.name}`, async ({ page }) => {
    const fixture = await installKomariFixture(page, { hideEarth: true, nodeCount: 1, nodeCardPingFixture: { metric: 'valid' } })
    fixture.setClientMetadata(0, { public_remark: 'Synthetic public note', gpu_name: scenario.gpu ? 'Synthetic GPU' : '', mem_total: 4 * 1024 ** 3, disk_total: 32 * 1024 ** 3 })
    const errors: string[] = []
    const requests: string[] = []
    page.on('pageerror', e => errors.push(e.message))
    page.on('request', r => requests.push(r.url()))
    await page.route('**/rpc2', async (route) => {
      const { method, id } = route.request().postDataJSON()
      if (method !== 'common:getNodesLatestStatus')
        return route.fallback()
      return route.fulfill({ json: { jsonrpc: '2.0', id, result: { [PRIMARY_NODE_UUID]: {
        client: PRIMARY_NODE_UUID,
        time: '2026-07-25T12:00:00.000Z',
        online: true,
        cpu: 17,
        gpu: scenario.gpu,
        ...scenario.metadata,
        ram: 1024 ** 3,
        ram_total: 4 * 1024 ** 3,
        swap: 0,
        swap_total: 0,
        load: 0.25,
        load5: 0.5,
        load15: 0.1,
        temp: 0,
        disk: 4 * 1024 ** 3,
        disk_total: 32 * 1024 ** 3,
        net_in: 8192,
        net_out: 4096,
        net_total_up: 1024 ** 3,
        net_total_down: 3 * 1024 ** 3,
        process: 42,
        connections: 15,
        connections_udp: 3,
        uptime: 86525,
      } } } })
    })
    await page.goto('/')
    await expect(page.locator('.node-card')).toHaveCount(1)
    await expect(page.locator('[data-node-public-remark]')).toHaveText('Synthetic public note')
    const status = () => page.evaluate(() => {
      const root = document.querySelector('#app') as Element & { __vue_app__: { config: { globalProperties: { $pinia: { _s: Map<string, { nodes: Record<string, unknown>[] }> } } } } }
      const node = root.__vue_app__.config.globalProperties.$pinia._s.get('nodes')!.nodes[0]!
      return { gpu: node.gpu, cpu: node.cpu, ram: node.ram, net_in: node.net_in, net_out: node.net_out, load: node.load, online: node.online }
    })
    await expect.poll(status).toEqual({ gpu: scenario.gpu, cpu: 17, ram: 1024 ** 3, net_in: 8192, net_out: 4096, load: 0.25, online: true })
    await expect(page.locator('.node-card')).toContainText('17.0%')
    await expect(page.locator('.node-card')).toContainText('25.0%')
    await expect(page.locator('.node-card')).toContainText('12.5%')
    await expect(page.locator('body')).not.toContainText('NaN')
    const allowedReadPaths = ['/api/rpc2', '/api/me', '/api/public', '/api/version']
    expect(requests.map(url => new URL(url).pathname).filter(path => path.startsWith('/api/') && !allowedReadPaths.includes(path))).toEqual([])
    expect(requests.some(url => url.includes('/api/clients/v2/') || url.includes('/api/admin/'))).toBe(false)
    expect(errors).toEqual([])
  })
}

test('Komari Metric envelope keeps RFC3339 timestamps, string task IDs, zero and loss units', () => {
  const times = ['2026-07-25T12:00:00Z', '2026-07-25T12:01:00Z', '2026-07-25T12:02:00Z', '2026-07-25T12:03:00Z']
  const series: MetricSeries[] = [
    ['ping.latency_ms', 'ms', [0, 9.5, -1, null]],
    ['ping.loss', 'ratio', [0, 0.5, 1, null]],
  ].map(([metric, unit, values]) => ({
    metric_key: String(metric),
    unit: String(unit),
    entity_id: PRIMARY_NODE_UUID,
    type: 'gauge',
    tags: { task_id: '301' },
    downsampled: true,
    downsample_algorithm: 'avg',
    interval_seconds: 60,
    points: (values as (number | null)[]).map((value, i) => ({ time: times[i]!, value, count: i === 3 ? 0 : 2 })),
  }))
  const samples = normalizePingMetricSamples(series, { entityId: PRIMARY_NODE_UUID, taskId: '301' })
  expect(samples.map(s => [s.timestamp, s.latency, s.loss, s.observed])).toEqual([
    [Date.parse(times[0]!), 0, 0, true],
    [Date.parse(times[1]!), 20, 0.5, true],
    [Date.parse(times[2]!), null, 1, true],
    [Date.parse(times[3]!), null, null, false],
  ])
  expect(normalizePingMetricSamples(series, { entityId: PRIMARY_NODE_UUID, taskId: '302' })).toEqual([])
})
