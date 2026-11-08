import type { Locator } from '@playwright/test'
import { expect, test } from '@playwright/test'
import { installKomariFixture, PRIMARY_NODE_UUID } from './fixtures/komari'

const config = JSON.stringify({ schemaVersion: 3, global: { threeNetworkEnabled: true, taskIds: [101, 202, 303] }, nodes: {} })
const normalize = (family: string) => family.replace(/["'\s]/g, '').toLowerCase()

// Read the existing Vue-ECharts instance, not a separate chart or a test-only product hook.
async function charts(owners: Locator, showTip = false) {
  return owners.evaluateAll((els, hover) => {
    function find(v: any, el: Element): any {
      if (!v)
        return null
      if (v.el === el && v.component?.exposed?.getOption)
        return v.component.exposed
      for (const child of [v.component?.subTree, v.suspense?.activeBranch, ...(Array.isArray(v.children) ? v.children : [])]) {
        const found = find(child, el)
        if (found)
          return found
      }
    }
    return els.map((el) => {
      const api = find((document.querySelector('#app') as any)._vnode, el)
      const option = api.getOption()
      if (hover)
        api.dispatchAction({ type: 'showTip', seriesIndex: 0, dataIndex: 0 })
      const norm = (font: string) => (font ?? '').replace(/["'\s]/g, '').toLowerCase()
      const expected = norm(getComputedStyle(el).fontFamily)
      const missing: string[] = []
      function check(name: string, style: any) {
        if (!expected || norm(style?.fontFamily) !== expected)
          missing.push(name)
      }
      check('root', option.textStyle)
      check('HTML tooltip', option.tooltip[0].textStyle)
      for (const axis of [...option.xAxis, ...option.yAxis]) {
        check('ticks', axis.axisLabel)
        if (axis.name)
          check('axis name', axis.nameTextStyle)
        if (axis.axisPointer?.label?.show)
          check('pointer', axis.axisPointer.label)
      }
      for (const legend of option.legend ?? []) {
        check('legend', legend.textStyle)
        if (legend.type === 'scroll')
          check('legend page indicator', legend.pageTextStyle)
      }
      return {
        family: expected,
        missing,
        state: {
          id: api.chart.value.id,
          series: option.series.map((s: any) => [s.id, s.name, s.data, s.lineStyle.color]),
          domains: option.xAxis.map((a: any) => [a.min, a.max, a.axisLabel.hideOverlap]),
          legends: option.legend?.map((l: any) => l.selected),
        },
      }
    })
  }, showTip)
}

test('native UI and code fonts: document language reaches form, portal, canvas and real HTML hover without changing Ping data', async ({ page }) => {
  const fixture = await installKomariFixture(page, { nodeCount: 2, hideEarth: true, themeShort: 'glassmorphism-plus', adminAccess: 'admin', fakeTimers: true, nodeCardPingDisplayConfigV3: config, nodeCardPingFixture: { thirdSharedTask: true } })
  await page.goto('/')
  const title = page.locator('.a2-node-title').first()
  await expect(title).toBeVisible()
  const family = normalize(await title.evaluate(el => getComputedStyle(el).fontFamily))
  expect(family).toContain('pingfangsc')
  await page.getByTestId('palette-entry').click()
  await expect(page.getByTestId('palette-status')).toContainText('已验证管理权限')
  await page.locator('.palette-advanced summary').click()
  await expect(page.locator('#palette-json')).toHaveCSS('font-family', /monospace/)
  expect(normalize(await page.locator('#palette-hex').evaluate(el => getComputedStyle(el).fontFamily))).toBe(family)
  await page.getByRole('button', { name: '取消', exact: true }).click()
  await page.locator('[data-node-ping-header="latency"]').first().click()
  const dialog = page.getByRole('dialog')
  const owner = dialog.locator('x-vue-echarts')
  await expect.poll(async () => (await charts(owner))[0]?.state.series.length).toBe(6)
  const before = (await charts(owner))[0]!
  expect(before.missing).toEqual([])
  expect(before.family).toBe(family)
  const calls = fixture.timeline.length
  await page.evaluate(() => {
    document.documentElement.lang = 'zh-Hant-HK'
  })
  await expect.poll(async () => (await charts(owner))[0]?.missing).toEqual([])
  const after = (await charts(owner, true))[0]!
  expect(after.family).toContain('pingfanghk')
  expect(after.state).toEqual(before.state)
  expect(fixture.timeline.length).toBe(calls)
  const hover = dialog.locator('[data-ping-shared-tooltip]')
  await expect(hover).toBeVisible()
  expect(normalize(await hover.evaluate(el => getComputedStyle(el).fontFamily))).toBe(after.family)
  expect(normalize(await dialog.locator('h2').evaluate(el => getComputedStyle(el).fontFamily))).toBe(after.family)
})

test('detail chart text uses native UI font across enabled metric and load charts', async ({ page }) => {
  await installKomariFixture(page, { nodeCount: 1, hideEarth: true, fakeTimers: true })
  await page.goto(`/instance/${PRIMARY_NODE_UUID}`)
  const cpu = page.locator('[data-load-chart-card="cpu"] x-vue-echarts')
  await expect(cpu).toBeVisible()
  await expect.poll(async () => (await charts(cpu))[0]?.state.series.length).toBeGreaterThan(0)
  const result = await charts(page.locator('x-vue-echarts'))
  expect(result.length).toBeGreaterThan(1)
  for (const chart of result) {
    expect(chart.family).toContain('pingfangsc')
    expect(chart.missing).toEqual([])
  }
})
