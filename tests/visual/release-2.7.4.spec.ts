import type { Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'
import { installKomariFixture, PRIMARY_NODE_UUID } from './fixtures/komari'

const names = ['Neburst 中奖机', 'Bandwagonhost Megabox Pro', 'Boil 台中 Seednet 300M', `Long node ${'international edge '.repeat(5)}`.trim()]
const providers = ['Neburst Networks', 'BandwagonHost / Cluster Logic Inc', 'Seednet-TaipeiDP-S', `Long provider ${'global network '.repeat(8)}`.trim()]
const sizes = [[1280, 800], [1440, 900], [1920, 1080], [360, 800], [375, 667], [390, 844], [430, 932]]

for (const [width, height] of sizes) {
  test(`detail header geometry ${width}px keeps selector independent of long identities`, async ({ page, isMobile }, testInfo) => {
    test.skip(isMobile && width! >= 1024, 'Desktop geometry is covered by Chromium.')
    await page.setViewportSize({ width: width!, height: height! })
    page.on('pageerror', (error) => {
      throw error
    })
    const fixture = await installKomariFixture(page, { hideEarth: true, nodeCount: names.length, nodeNames: names, nodeCardPingFixture: { metric: 'valid' } })
    fixture.setThemeSetting('providerAliases', providers.map((provider, i) => `${provider}:${names[i]}`).join(';'))
    await page.goto(`/instance/${PRIMARY_NODE_UUID}`)
    const selector = page.getByRole('combobox', { name: '切换节点' })
    await expect(selector).toBeVisible()
    const uuids = await selector.locator('option').evaluateAll(options => options.map(option => (option as HTMLOptionElement).value))
    const measurements = []
    for (const [index, uuid] of uuids.entries()) {
      await selector.selectOption(uuid)
      const header = page.locator('.instance-detail > div').first()
      // getByText below also works with the original header for failing reproduction.
      await expect(header.getByText(providers[index]!, { exact: true }).first()).toBeVisible()
      const geometry = await header.evaluate((element, identity) => {
        const rect = (el: Element) => {
          const r = el.getBoundingClientRect()
          return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height }
        }
        const select = element.querySelector('select')!
        const providerText = Array.from(element.querySelectorAll('span')).find(el => el.textContent === identity.provider)!
        const name = Array.from(element.querySelectorAll('span')).find(el => el.textContent === identity.name)!
        const status = Array.from(element.querySelectorAll('[data-slot="badge"]')).find(el => el.textContent?.trim() === '在线')!
        const summary = element.nextElementSibling!
        const cards = Array.from(summary.children).map(rect)
        return { selector: rect(select.parentElement!), select: rect(select), provider: rect(providerText), name: rect(name), status: rect(status), back: rect(element.querySelector('button')!), flag: rect(element.querySelector('img')!), cards, overflow: document.documentElement.scrollWidth > innerWidth, nameOverflow: getComputedStyle(name).textOverflow, selectOverflow: getComputedStyle(select).textOverflow, providerOverflow: getComputedStyle(providerText).textOverflow }
      }, { name: names[index]!, provider: providers[index]! })
      measurements.push(geometry)
      expect(geometry.overflow).toBe(false)
      expect(geometry.selector.right).toBeLessThanOrEqual(Math.max(...geometry.cards.map(card => card.right)) + 1)
      expect(geometry.selector.left).toBeGreaterThanOrEqual(geometry.cards[0]!.left - 1)
      expect(geometry.provider.right).toBeLessThanOrEqual(width!)
      expect(geometry.back.width).toBeGreaterThanOrEqual(28)
      expect(geometry.flag.width).toBeGreaterThanOrEqual(24)
      expect(geometry.status.width).toBeGreaterThan(30)
      expect(geometry.nameOverflow).toBe('ellipsis')
      expect(geometry.selectOverflow).toBe('ellipsis')
      expect(geometry.providerOverflow).toBe('ellipsis')
      if (width! < 1024) {
        expect(geometry.selector.top).toBeGreaterThanOrEqual(geometry.status.bottom)
        expect(geometry.provider.top).toBeGreaterThanOrEqual(geometry.selector.bottom)
      }
      else {
        expect(geometry.provider.left).toBeGreaterThanOrEqual(geometry.status.right)
        expect(geometry.provider.right).toBeLessThanOrEqual(geometry.selector.left)
        expect(Math.abs(geometry.selector.right - measurements[0]!.selector.right)).toBeLessThanOrEqual(1)
      }
      expect(Math.abs(geometry.cards[0]!.top - measurements[0]!.cards[0]!.top)).toBeLessThanOrEqual(1)
      await page.getByRole('button', { name: index % 2 ? '深色模式' : '浅色模式', exact: true }).click()
      if (index === 1)
        await header.screenshot({ path: testInfo.outputPath('long-detail-header.png') })
    }
    await page.getByRole('button', { name: '收藏当前节点', exact: true }).click()
    await expect(page.getByRole('button', { name: '取消收藏当前节点', exact: true })).toBeVisible()
    await page.getByRole('button', { name: '下一个节点', exact: true }).click()
    await expect(selector).toHaveValue(uuids[0]!)
    await page.getByRole('button', { name: '上一个节点', exact: true }).click()
    await expect(selector).toHaveValue(uuids.at(-1)!)
    if (width! < 1024) {
      await expect(page.locator('meta[name="viewport"]')).toHaveAttribute('content', /viewport-fit=cover/)
      expect(readFileSync('src/styles/main.css', 'utf8')).toContain('padding-bottom: env(safe-area-inset-bottom)')
      await page.locator('footer').scrollIntoViewIfNeeded()
      const bottom = await page.evaluate(() => ({
        footer: document.querySelector('footer')!.getBoundingClientRect().bottom,
        app: document.querySelector('.app-viewport')!.getBoundingClientRect().bottom,
        overflow: document.documentElement.scrollWidth > innerWidth,
        background: getComputedStyle(document.body).backgroundColor,
      }))
      expect(bottom.footer).toBeLessThanOrEqual(bottom.app + 1)
      expect(bottom.overflow).toBe(false)
      expect(bottom.background).not.toBe('rgba(0, 0, 0, 0)')
    }
    await testInfo.attach('geometry', { body: JSON.stringify(measurements), contentType: 'application/json' })
  })
}

async function installSelectionFixture(page: Page) {
  page.on('pageerror', (error) => {
    throw error
  })
  await installKomariFixture(page, { hideEarth: true, nodeCount: 2, nodeCardPingFixture: { metric: 'valid', thirdSharedTask: true } })
  const calls: Array<{ method: string, params: Record<string, unknown> }> = []
  let available = [101, 202, 303]
  const idsFor = (uuid: string) => uuid === PRIMARY_NODE_UUID ? available : [401, 402]
  await page.route('**/rpc2', async (route) => {
    const payload = route.request().postDataJSON()
    const { method, params = {} } = payload
    if (!['public:getPublicPingTasks', 'public:getPingMetricStats', 'public:queryMetrics'].includes(method)
      || (method === 'public:queryMetrics' && !params.metric_keys?.includes('ping.latency_ms'))) {
      return route.fallback()
    }
    calls.push({ method, params })
    const ids = idsFor(params.entity_id)
    const task = (id: number) => ({ id, name: `Task ${id}`, interval: 60, loss: 0, type: 'icmp', clients: [params.entity_id] })
    const end = Date.parse(params.end ?? '2026-07-25T12:00:00Z')
    const points = [3, 2, 1].map(minute => ({ time: new Date(end - minute * 60_000).toISOString(), value: 20, count: 1 }))
    const result = method === 'public:getPublicPingTasks'
      ? [...available, 401, 402].map(task)
      : method === 'public:getPingMetricStats'
        ? { stats: ids.map(id => ({ ...task(id), task_id: String(id), entity_id: params.entity_id, total: 3, valid: 3, avg: 20, latest: 20 })) }
        : { series: ids.map(id => ({ metric_key: 'ping.latency_ms', entity_id: params.entity_id, tags: { task_id: String(id), task_name: `Task ${id}` }, interval_seconds: 60, points })) }
    await route.fulfill({ json: { jsonrpc: '2.0', id: payload.id, result } })
  })
  return {
    calls,
    setAvailable: (ids: number[]) => {
      available = ids
    },
  }
}

async function expectSelection(page: Page, ids: number[]) {
  const chart = page.locator('[data-ping-chart]')
  await expect(chart).toHaveAttribute('data-ping-chart-visible-task-ids', ids.join(','))
  const selected = await chart.locator('[data-ping-chart-task-id]:not(.opacity-30)').evaluateAll(elements => elements.map(el => Number(el.getAttribute('data-ping-chart-task-id'))))
  expect(selected).toEqual(ids)
  // Inspect the actual ECharts series, not only the task-card state.
  await expect.poll(() => chart.locator('x-vue-echarts').evaluate((element) => {
    interface VNode {
      el?: Element
      children?: VNode[]
      component?: { exposed?: { getOption?: () => { series?: Array<{ name: string }> } }, subTree?: VNode }
      suspense?: { activeBranch?: VNode }
    }
    const find = (node?: VNode): number[] | undefined => {
      if (!node)
        return
      if (node.el === element && node.component?.exposed?.getOption)
        return node.component.exposed.getOption().series?.map(series => Number(series.name.replace('Task ', ''))) ?? []
      for (const child of [node.component?.subTree, node.suspense?.activeBranch, ...(Array.isArray(node.children) ? node.children : [])]) {
        const result = find(child)
        if (result)
          return result
      }
    }
    return find((document.querySelector('#app') as unknown as { _vnode: VNode })._vnode)
  })).toEqual(ids)
}

test('same-node selection survives all ranges and custom range without extra queries', async ({ page }) => {
  const fixture = await installSelectionFixture(page)
  await page.goto(`/instance/${PRIMARY_NODE_UUID}`)
  await expectSelection(page, [101, 202, 303])
  // Let the existing asynchronous finance cache initialize before observing storage.
  await expect.poll(() => page.evaluate(() => localStorage.getItem('komari_finance_exchange_rates_cny_v1'))).not.toBeNull()
  await page.locator('[data-ping-chart-task-id="101"]').click()
  await page.locator('[data-ping-chart-task-id="303"]').click()
  await expectSelection(page, [202])
  const storage = await page.evaluate(() => JSON.stringify(localStorage))
  for (const range of ['6 小时', '12 小时', '1 小时', '1 天', '7 天', '14 天', '30 天', '自定义']) {
    const before = fixture.calls.length
    await page.locator('[data-ping-chart]').getByRole('tab', { name: range, exact: true }).click()
    await expect(page.locator('[data-ping-chart] .animate-spin')).toHaveCount(0)
    await expectSelection(page, [202])
    const requests = fixture.calls.slice(before)
    // Unchanged data path: one range stats query + one paired raw query; warm cache may serve either.
    expect(requests.filter(call => call.method === 'public:queryMetrics').length).toBeLessThanOrEqual(1)
    expect(requests.filter(call => call.method === 'public:getPingMetricStats').length).toBeLessThanOrEqual(1)
    expect(requests.filter(call => call.method === 'public:getPublicPingTasks')).toHaveLength(0)
    for (const call of requests.filter(call => call.method === 'public:queryMetrics')) {
      expect(call.params).toMatchObject({ entity_id: PRIMARY_NODE_UUID, metric_keys: ['ping.latency_ms', 'ping.loss'], downsample: true, fill_empty: true, aggregation: 'avg' })
      expect(call.params).not.toHaveProperty('tags')
    }
  }
  expect(await page.evaluate(() => JSON.stringify(localStorage))).toBe(storage)
  await page.getByRole('button', { name: '全不选', exact: true }).click()
  await page.locator('[data-ping-chart]').getByRole('tab', { name: '6 小时', exact: true }).click()
  await expectSelection(page, [])
  await page.reload()
  await expectSelection(page, [101, 202, 303])
})

test('UUID navigation resets selection and task removal prunes only unavailable IDs', async ({ page }) => {
  const fixture = await installSelectionFixture(page)
  await page.goto(`/instance/${PRIMARY_NODE_UUID}`)
  await expectSelection(page, [101, 202, 303])
  await page.locator('[data-ping-chart-task-id="101"]').click()
  fixture.setAvailable([101, 202])
  await page.locator('[data-ping-chart]').getByRole('tab', { name: '6 小时', exact: true }).click()
  await expectSelection(page, [202])
  fixture.setAvailable([101])
  await page.locator('[data-ping-chart]').getByRole('tab', { name: '12 小时', exact: true }).click()
  await expectSelection(page, [101])
  await page.getByRole('button', { name: '下一个节点', exact: true }).click()
  await expectSelection(page, [401, 402])
  await expect(page.locator('[data-ping-chart-task-id="202"]')).toHaveCount(0)
  await page.locator('[data-ping-chart-task-id="401"]').click()
  await page.locator('[data-ping-chart]').getByRole('tab', { name: '1 天', exact: true }).click()
  await expectSelection(page, [402])
  await page.getByRole('button', { name: '上一个节点', exact: true }).click()
  await expectSelection(page, [101])
})

test('new release workflow defaults to prerelease without promoting or editing existing releases', () => {
  const workflow = readFileSync('.github/workflows/release-on-version-bump.yml', 'utf8')
  expect(workflow).toContain('--prerelease --latest=false')
  expect(workflow).toContain('gh release create "' + '${' + 'RELEASE_TAG}" --verify-tag --title "' + '${' + 'RELEASE_TAG}"')
  expect(workflow).not.toContain('gh release edit')
  for (const file of ['AGENTS.md', 'CODEX.md', 'AIAGENTREADME.md', 'CLAUDE.md'])
    expect(readFileSync(file, 'utf8')).toContain('Pre-release')
})
