import type { Locator, Page } from '@playwright/test'
import { expect, test } from '@playwright/test'
import { installKomariFixture, PRIMARY_NODE_UUID } from './fixtures/komari'

const config = JSON.stringify({ schemaVersion: 3, global: { threeNetworkEnabled: true, taskIds: [101, 202, 303] }, nodes: {} })

async function originalTheme(page: Page, options: Parameters<typeof installKomariFixture>[1] = {}) {
  const fixture = await installKomariFixture(page, { hideEarth: true, nodeCount: 3, nodeCardPingDisplayConfigV3: config, nodeCardPingFixture: { thirdSharedTask: true }, ...options })
  fixture.setThemeSetting('glassColorPreset', '翡翠')
  await page.goto('/')
  // Thirty real cards render 3,600 buckets; wait for that DOM rather than
  // mistaking slower WebKit initial rendering for an empty result.
  await expect(page.locator('.node-card')).toHaveCount(options?.nodeCount ?? 3, { timeout: options.nodeCount === 30 ? 15_000 : 5_000 })
  return fixture
}

async function chartState(owner: Locator) {
  return owner.locator('x-vue-echarts').evaluate((element) => {
    const find = (node: any): any => {
      if (!node)
        return null
      if (node.el === element && node.component?.exposed?.getOption)
        return node.component.exposed
      for (const child of [node.component?.subTree, node.suspense?.activeBranch, ...(Array.isArray(node.children) ? node.children : [])]) {
        const found = find(child)
        if (found)
          return found
      }
      return null
    }
    const chart = find((document.querySelector('#app') as any)._vnode)
    const option = chart.getOption()
    return { id: chart.chart.value.id, tooltip: option.tooltip[0], legend: option.legend[0], xAxis: option.xAxis, series: option.series.map((s: any) => ({ id: s.id, name: s.name, color: s.lineStyle?.color, type: s.lineStyle?.type })) }
  })
}

async function cssColor(page: Page, hex: string) {
  return page.evaluate((value) => {
    const probe = document.createElement('span')
    probe.style.backgroundColor = value
    document.body.append(probe)
    const result = getComputedStyle(probe).backgroundColor
    probe.remove()
    return result
  }, hex)
}

for (const dark of [false, true]) {
  test(`Original ${dark ? 'dark' : 'light'} actual surfaces, text, semantic colors and six rails`, async ({ page, browserName }, info) => {
    await page.setViewportSize({ width: 1440, height: 1050 })
    // Explicitly inspect full glass rendering, independent of the host OS setting.
    if (browserName === 'chromium') {
      const cdp = await page.context().newCDPSession(page)
      await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-transparency', value: 'no-preference' }] })
    }
    await originalTheme(page, { dark, hideEarth: false, earthRenderer: 'cobe' })
    await page.mouse.move(0, 0)
    const card = page.locator('.node-card').first()
    await expect(card).toHaveCSS('color', dark ? 'rgb(248, 250, 252)' : 'rgb(16, 21, 28)')
    await expect(card).toHaveCSS('background-color', await cssColor(page, dark ? '#0D111AD9' : '#F1F5F9BD'))
    await expect(card.locator('.node-card-info-surface').first()).toHaveCSS('background-color', dark ? 'rgba(255, 255, 255, 0.05)' : await cssColor(page, '#E2E8F0C2'))
    await expect(card.locator('.text-emerald-500').first()).toHaveCSS('color', await cssColor(page, 'oklch(69.6% 0.17 162.48)'))
    await expect(card.locator('.text-blue-600').first()).toHaveCSS('color', await cssColor(page, 'oklch(54.6% 0.245 262.881)'))
    await expect(page.getByRole('heading', { name: 'Komari Visual Lab', exact: true })).toHaveCSS('color', await cssColor(page, dark ? 'oklch(0.985 0 0)' : 'oklch(0.11 0.01 285.823)'))
    await expect(page.getByTestId('palette-entry')).toHaveCSS('background-color', dark ? 'rgb(39, 39, 42)' : 'rgb(244, 244, 245)')
    await expect(page.getByTestId('palette-entry')).toHaveCSS('color', dark ? 'rgb(250, 250, 250)' : 'rgb(24, 24, 27)')
    await expect(card.locator('[data-node-ping-bars]')).toHaveCount(6)
    expect(await card.locator('[data-node-ping-bucket-fill]').evaluateAll(elements => elements.every(e => getComputedStyle(e).backdropFilter === 'none'))).toBe(true)
    await expect(page.locator('canvas').first()).toBeVisible()
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
    await page.screenshot({ path: info.outputPath(`home-original-${dark ? 'dark' : 'light'}.png`), fullPage: true })
    await page.getByTestId('palette-entry').click()
    await page.getByTestId('palette-field').selectOption('Text')
    await page.locator('#palette-hex').fill('#CC7788')
    await expect(card).toHaveCSS('color', 'rgb(204, 119, 136)')
    await page.getByRole('button', { name: '取消', exact: true }).click()
    await expect(card).toHaveCSS('color', dark ? 'rgb(248, 250, 252)' : 'rgb(16, 21, 28)')
  })
}

test('palette changes update existing chart and portal colors without reloading history or changing selection', async ({ page }) => {
  const fixture = await originalTheme(page)
  await page.locator('[data-node-ping-header="latency"]').first().click()
  const owner = page.getByRole('dialog').locator('[data-ping-chart]')
  await expect.poll(async () => (await chartState(owner)).series.length).toBe(6)
  const before = await chartState(owner)
  await owner.getByRole('button', { name: '丢包数据', exact: true }).click()
  await expect(owner).toHaveAttribute('data-ping-chart-loss', 'disabled')
  const calls = fixture.timeline.length
  // Header is inert behind the modal. Change the existing store's appearance only;
  // exercise the same Provider chain without introducing a production test hook.
  await page.evaluate(() => {
    const app = (document.querySelector('#app') as any).__vue_app__.config.globalProperties.$pinia._s.get('app')
    app.openPaletteEditor()
    app.paletteDraftFollowsSite = false
    app.paletteDraft = { preset: 'custom', colors: { ...app.paletteDraft.colors, lightText: '#234567', lightMutedText: '#456789', lightControl: '#DDEEFF', lightBorder: '#112233' } }
  })
  await expect.poll(async () => (await chartState(owner)).tooltip.backgroundColor).toBe('#DDEEFF')
  const changed = await chartState(owner)
  expect(changed.id).toBe(before.id)
  expect(changed.legend.textStyle.color).toBe('#456789')
  expect(changed.xAxis[0].axisLabel.color).toBe('#456789')
  expect(changed.xAxis[0].axisLabel.hideOverlap).toBe(true)
  expect(changed.tooltip.borderColor).toBe('#112233')
  expect(changed.tooltip.textStyle.color).toBe('#234567')
  await expect(owner).toHaveAttribute('data-ping-chart-loss', 'disabled')
  expect(fixture.timeline.length).toBe(calls)
})

test('list titles and existing Load charts consume effective text without new metric requests', async ({ page }) => {
  const fixture = await originalTheme(page, { fakeTimers: true })
  await page.getByRole('button', { name: '列表视图', exact: true }).click()
  const row = page.getByRole('button', { name: '查看节点 主控-洛杉矶 详情', exact: true })
  await expect(row.locator('.text-foreground').first()).toHaveCSS('color', await cssColor(page, 'oklch(0.11 0.01 285.823)'))
  await row.click()
  const owner = page.locator('[data-load-chart-card="cpu"]')
  await expect(owner.locator('x-vue-echarts')).toBeVisible()
  await expect.poll(async () => (await chartState(owner)).series.length).toBeGreaterThan(0)
  const before = await chartState(owner)
  const calls = fixture.timeline.length
  await page.evaluate(() => {
    const app = (document.querySelector('#app') as any).__vue_app__.config.globalProperties.$pinia._s.get('app')
    app.openPaletteEditor()
    app.paletteDraftFollowsSite = false
    app.paletteDraft = { preset: 'custom', colors: { ...app.paletteDraft.colors, lightText: '#123456', lightMutedText: '#456789', lightControl: '#DDEEFF', lightBorder: '#102030' } }
  })
  await expect.poll(async () => (await chartState(owner)).tooltip.backgroundColor).toBe('#DDEEFF')
  const after = await chartState(owner)
  expect(after.id).toBe(before.id)
  expect(after.xAxis[0].axisLabel.color).toBe('#456789')
  expect(after.tooltip.textStyle.color).toBe('#123456')
  expect(after.tooltip.borderColor).toBe('#102030')
  expect(fixture.timeline.length).toBe(calls)
})

test('reduced motion keeps complete content and the editor keyboard recovery remains visible', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await originalTheme(page, { dark: true })
  await expect(page.locator('.node-card').first()).toHaveCSS('transition-duration', '0s')
  await expect(page.locator('[data-node-ping-bars]')).toHaveCount(18)
  await page.getByTestId('palette-entry').focus()
  await page.keyboard.press('Enter')
  await expect(page.locator('#palette-heading')).toBeFocused()
  await page.getByTestId('palette-field').selectOption('Text')
  await page.locator('#palette-hex').fill('#FFFFFF')
  await page.getByTestId('palette-field').selectOption('Card')
  await page.locator('#palette-hex').fill('#FFFFFF')
  await expect(page.getByTestId('palette-panel')).toHaveCSS('color', 'rgb(250, 250, 250)')
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('palette-panel')).toHaveCount(0)
  await expect(page.getByTestId('palette-entry')).toBeFocused()
  await expect(page.locator('.node-card').first()).toHaveCSS('color', 'rgb(248, 250, 252)')
})

for (const [density, height] of [['mini', 40], ['compact', 52], ['comfortable', 58], ['large', 58]] as const) {
  test(`original ${density} density keeps every task and 20 buckets at 360px`, async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 900 })
    await originalTheme(page, { nodeCardSize: density, dark: true })
    const card = page.locator(`[data-node-card-uuid="${PRIMARY_NODE_UUID}"]`)
    const strips = card.locator('[data-node-ping-task-id]')
    await expect(strips).toHaveCount(3)
    for (const strip of await strips.all()) {
      expect((await strip.boundingBox())!.height).toBe(height)
      for (const rail of await strip.locator('[data-node-ping-bars]').all())
        await expect(rail.locator('[data-node-ping-bar]')).toHaveCount(20)
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360)
  })
}

test('Beijing day boundary does not switch the edited group or overwrite preference in a different device timezone', async ({ browser, baseURL }) => {
  const context = await browser.newContext({ baseURL, timezoneId: 'America/Los_Angeles' })
  try {
    const page = await context.newPage()
    const fixture = await originalTheme(page, { managedThemeMode: 'beijing', clockNow: '2026-10-26T18:59:30+08:00', fakeTimers: true })
    await page.getByTestId('theme-mode-beijing').click()
    await page.getByTestId('palette-entry').click()
    await page.getByRole('button', { name: '编辑浅色', exact: true }).click()
    await fixture.advanceTime(60_000)
    await expect(page.locator('html')).toHaveClass(/dark/)
    await expect(page.getByRole('button', { name: '编辑浅色', exact: true })).toHaveAttribute('aria-pressed', 'true')
    await expect(page.locator('#palette-hex')).toHaveValue('#F1F5F9BD')
    await expect(page.getByTestId('theme-mode-beijing')).toHaveAttribute('aria-pressed', 'true')
    expect(await page.evaluate(() => localStorage.getItem('themeMode'))).toBe('beijing')
    expect(fixture.getThemeSaveCount()).toBe(0)
  }
  finally { await context.close() }
})

test('original standard and accessible Ping semantics remain distinct in legacy dark mode', async ({ page }) => {
  await originalTheme(page, { dark: true })
  await page.evaluate(() => document.documentElement.classList.add('legacy-webkit'))
  await expect(page.locator('.node-card').first()).toHaveCSS('color', 'rgb(248, 250, 252)')
  const tokens = () => page.evaluate(() => {
    const style = getComputedStyle(document.documentElement)
    return ['--ping-latency-excellent', '--ping-critical', '--ping-outage', '--signal-1'].map(key => style.getPropertyValue(key).trim())
  })
  expect(await tokens()).toEqual(['#2fc66e', '#f47067', '#e11d48e6', '#10b981'])
  await page.evaluate(() => document.documentElement.classList.add('color-vision-friendly'))
  expect(await tokens()).toEqual(['#2fc66e', '#f47067', '#e11d48e6', '#56b4e9'])
  const dots = page.locator('.node-card-ping-trend-dot')
  expect(await dots.nth(0).evaluate(e => getComputedStyle(e).backgroundColor)).not.toBe(await dots.nth(1).evaluate(e => getComputedStyle(e).backgroundColor))
  await page.getByTestId('palette-entry').click()
  await page.getByTestId('palette-field').selectOption('Text')
  await page.locator('#palette-hex').fill('#AABBCC')
  await expect(page.getByRole('heading', { name: 'Komari Visual Lab', exact: true })).toHaveCSS('color', 'rgb(170, 187, 204)')
  await page.keyboard.press('Escape')
  await expect(page.getByRole('heading', { name: 'Komari Visual Lab', exact: true })).toHaveCSS('color', 'rgb(250, 250, 250)')
})

test('thirty-node palette editing adds no monitoring request or interval and retains full density', async ({ page }, info) => {
  // This is a composite request/lifecycle guard, not a 60-second UI latency SLA.
  // Linux WebKit trace snapshots of 3,600 buckets took ~60s across all eight
  // cycles, exhausting the test before its final assertions. Keep every cycle,
  // input and invariant; allow bounded runner overhead and report elapsed time.
  test.setTimeout(90_000)
  const fixture = await originalTheme(page, { nodeCount: 30, fakeTimers: true })
  await fixture.waitForPingRefreshSettled()
  const calls = fixture.timeline.length
  await page.evaluate(() => {
    const host = window as any
    host.paletteIntervalCount = 0
    const original = window.setInterval.bind(window)
    window.setInterval = ((...args: Parameters<typeof window.setInterval>) => {
      host.paletteIntervalCount++
      return original(...args)
    }) as typeof window.setInterval
  })
  const start = Date.now()
  for (let cycle = 0; cycle < 8; cycle++) {
    await page.getByTestId('palette-entry').click()
    for (const value of ['#123456E6', '#ABCDEF80', '#F8FAFCE6'])
      await page.locator('#palette-hex').fill(value)
    await page.getByRole('button', { name: '取消', exact: true }).click()
  }
  await expect(page.locator('[data-node-ping-bars]')).toHaveCount(180)
  expect(fixture.timeline.length).toBe(calls)
  expect(await page.evaluate(() => (window as any).paletteIntervalCount)).toBe(0)
  await info.attach('palette-30-node-budget', { body: JSON.stringify({ elapsedMs: Date.now() - start, cycles: 8, colorInputs: 24, additionalMonitoringRequests: 0, additionalIntervals: 0 }), contentType: 'application/json' })
})
