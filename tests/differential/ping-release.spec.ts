import type { Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { extname, resolve, sep } from 'node:path'
import process from 'node:process'
import { expect, test } from '@playwright/test'
import { firstNode, frozenPing, hour, openPing, renderedPing, selectOnly, switchWindow } from '../visual/fixtures/ping-readability'

const layers = ['FORMAL', 'IDENTITY', 'COVERAGE', 'CANDIDATE'] as const
type Layer = typeof layers[number]
const mime: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.webp': 'image/webp' }
async function serveLayer(page: Page, layer: Layer) {
  const dir = process.env[`PLUS_PING_${layer}_DIST`]
  if (!dir)
    throw new Error(`Missing extracted/compiled ${layer} dist. All four layers are required.`)
  const root = resolve(dir)
  await page.route('http://127.0.0.1:4173/**', async (route) => {
    const path = decodeURIComponent(new URL(route.request().url()).pathname)
    if (route.request().method() !== 'GET' || path.startsWith('/api/') || path === '/rpc2')
      return route.fallback()
    const local = resolve(root, path === '/' || path.startsWith('/instance/') ? 'index.html' : `.${path}`)
    if (!local.startsWith(root + sep))
      throw new Error('Invalid fixture resource')
    try {
      return await route.fulfill({ body: await readFile(local), contentType: mime[extname(local)] ?? 'application/octet-stream' })
    }
    catch { return route.fulfill({ status: 404, body: '' }) }
  })
}
for (const entry of ['home', 'detail'] as const) {
  for (const withMain of [false, true]) {
    for (const days of [1, 7, 14, 30]) {
      test(`${entry} / ${days}d / ${withMain ? 'new Main' : 'ordinary node'}: protect both normal curves across four frozen builds`, async ({ context }, info) => {
        await context.route('**/*', route => new URL(route.request().url()).origin === 'http://127.0.0.1:4173' ? route.continue() : route.abort())
        const observations = new Map<Layer, Awaited<ReturnType<typeof renderedPing>>>()
        const requests = new Map<Layer, Awaited<ReturnType<typeof frozenPing>>['calls']>()
        for (const layer of layers) {
          const page = await context.newPage()
          try {
            await serveLayer(page, layer)
            const fixture = await frozenPing(page, { main: withMain, cold: true })
            const root = await openPing(page, entry, firstNode)
            await selectOnly(root, [202, 303])
            fixture.calls.length = 0
            await switchWindow(root, days)
            await expect(root).toHaveAttribute('data-ping-chart-loss', 'enabled')
            await expect(root).toHaveAttribute('data-ping-chart-smoothing', 'disabled')
            // Mounted ECharts retains each selected pair's insertion order.
            await expect.poll(async () => (await renderedPing(root)).series.map(s => s.id)).toEqual(['latency-202', 'loss-202', 'latency-303', 'loss-303'])
            const model = await renderedPing(root)
            observations.set(layer, model)
            requests.set(layer, [...fixture.calls])
            await info.attach(`${layer}-data`, { body: JSON.stringify({ requests: fixture.calls, model }), contentType: 'application/json' })
            await info.attach(`${layer}-plot`, { body: await root.locator('x-vue-echarts').screenshot({ animations: 'disabled' }), contentType: 'image/png' })
          }
          finally { await page.close() }
        }
        const official = observations.get('FORMAL')!
        const calls = requests.get('FORMAL')!
        expect(calls.map(c => c.hours)).toEqual(days === 30 ? [720, 600] : [days * 24])
        // Independent lattice from the frozen backend's actual official requests;
        // do not use the candidate's output as an oracle for missing nulls.
        const expectedTicks = new Set<number>()
        for (const q of calls) {
          const step = q.hours > 600 ? 24 * hour : q.hours > 24 ? hour : 5 * 60_000
          for (let t = Math.ceil(Date.parse(q.start) / step) * step; t < Date.parse(q.end); t += step)
            expectedTicks.add(t)
        }
        const ownTicks = [...expectedTicks].sort((a, b) => a - b)
        for (const layer of layers.slice(1)) {
          const model = observations.get(layer)!
          const got = requests.get(layer)!
          expect(got.slice(0, calls.length)).toEqual(calls)
          const extra = withMain && days > 1 && layer !== 'IDENTITY' ? [24] : []
          expect(got.slice(calls.length).map(q => q.hours)).toEqual(extra)
          for (const q of got)
            expect(q).toMatchObject({ node: firstNode, keys: ['ping.latency_ms', 'ping.loss'], max: 6000, agg: 'avg', fill: true, down: true, end: calls[0]!.end })
          expect([model.width, model.height, model.dpr, model.axes]).toEqual([official.width, official.height, official.dpr, official.axes])
          const end = Date.parse(calls[0]!.end)
          for (const old of official.series) {
            const cur = model.series.find(s => s.id === old.id)!
            const real = cur.points.filter(([,v]) => v !== null)
            expect(real).toEqual(old.points.filter(([,v]) => v !== null))
            expect(cur.xs).toEqual(old.xs)
            const ts = cur.points.map(([t]) => t)
            expect(ts).toEqual([...new Set(ts)].sort((a, b) => a - b))
            if (layer === 'CANDIDATE')
              expect(ts).toEqual(ownTicks)
            expect(cur.points.filter(([t]) => expectedTicks.has(t))).toEqual(old.points.filter(([t]) => expectedTicks.has(t)))
            expect(cur.points.filter(([t, v]) => v === null && expectedTicks.has(t))).toEqual(old.points.filter(([t, v]) => v === null && expectedTicks.has(t)))
            for (const span of [hour, 24 * hour])
              expect(real.filter(([t]) => t >= end - span)).toEqual(old.points.filter(([t, v]) => v !== null && t >= end - span))
            expect(cur).toMatchObject({ clip: true, smooth: false, showSymbol: false })
          }
        }
      })
    }
  }
}
