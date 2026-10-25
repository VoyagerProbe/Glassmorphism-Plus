import type { Locator, Page } from '@playwright/test'
import { expect, test } from '@playwright/test'
import { installKomariFixture, PRIMARY_NODE_UUID } from './fixtures/komari'

const config = JSON.stringify({ schemaVersion: 3, global: { threeNetworkEnabled: true, taskIds: [101, 202, 303] }, nodes: {} })

async function frost(page: Page, options: Parameters<typeof installKomariFixture>[1] = {}) {
  const fixture = await installKomariFixture(page, { hideEarth: true, nodeCount: 3, nodeCardPingDisplayConfigV3: config, nodeCardPingFixture: { thirdSharedTask: true }, ...options })
  fixture.setThemeSetting('glassColorPreset', '柔雾')
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
  test(`Soft Frost ${dark ? 'dark' : 'light'} actual surfaces, text, semantic colors and six rails`, async ({ page, browserName }, info) => {
    await page.setViewportSize({ width: 1440, height: 1050 })
    // Explicitly inspect full glass rendering, independent of the host OS setting.
    if (browserName === 'chromium') {
      const cdp = await page.context().newCDPSession(page)
      await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-transparency', value: 'no-preference' }] })
    }
    await frost(page, { dark, hideEarth: false, earthRenderer: 'cobe' })
    await page.mouse.move(0, 0)
    const card = page.locator('.node-card').first()
    await expect(card).toHaveCSS('color', dark ? 'rgb(242, 245, 250)' : 'rgb(17, 17, 17)')
    await expect(card).toHaveCSS('background-color', await cssColor(page, dark ? '#1E2732E6' : '#F8FAFCE6'))
    await expect(card.locator('.node-card-info-surface').first()).toHaveCSS('background-color', await cssColor(page, dark ? '#2C3744E6' : '#E8EDF4E6'))
    await expect(card.locator('.text-upload').first()).toHaveCSS('color', dark ? 'rgb(102, 201, 190)' : 'rgb(7, 111, 102)')
    await expect(card.locator('.text-download').first()).toHaveCSS('color', dark ? 'rgb(139, 184, 255)' : 'rgb(32, 94, 175)')
    await expect(page.getByRole('heading', { name: 'Komari Visual Lab', exact: true })).toHaveCSS('color', dark ? 'rgb(242, 245, 250)' : 'rgb(17, 17, 17)')
    await expect(page.getByTestId('palette-entry')).toHaveCSS('background-color', dark ? 'rgb(44, 55, 68)' : 'rgb(232, 237, 244)')
    await expect(page.getByTestId('palette-entry')).toHaveCSS('color', dark ? 'rgb(242, 245, 250)' : 'rgb(17, 17, 17)')
    await expect(card.locator('[data-node-ping-bars]')).toHaveCount(6)
    expect(await card.locator('[data-node-ping-bucket-fill]').evaluateAll(elements => elements.every(e => getComputedStyle(e).backdropFilter === 'none'))).toBe(true)
    await expect(page.locator('canvas').first()).toBeVisible()
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
    await page.screenshot({ path: info.outputPath(`home-frost-${dark ? 'dark' : 'light'}.png`), fullPage: true })
    await page.getByTestId('palette-entry').click()
    await page.getByTestId('palette-field-Text').click()
    await page.locator('#palette-hex').fill('#CC7788')
    await expect(card).toHaveCSS('color', 'rgb(204, 119, 136)')
    await page.getByRole('button', { name: '取消', exact: true }).click()
    await expect(card).toHaveCSS('color', dark ? 'rgb(242, 245, 250)' : 'rgb(17, 17, 17)')
  })
}

test('palette changes update existing chart and portal colors without reloading history or changing selection', async ({ page }) => {
  const fixture = await frost(page)
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
  const fixture = await frost(page, { fakeTimers: true })
  await page.getByRole('button', { name: '列表视图', exact: true }).click()
  const row = page.getByRole('button', { name: '查看节点 主控-洛杉矶 详情', exact: true })
  await expect(row.locator('.text-foreground').first()).toHaveCSS('color', 'rgb(17, 17, 17)')
  await row.click()
  const owner = page.locator('[data-load-chart-card="cpu"]')
  await expect(owner.locator('x-vue-echarts')).toBeVisible()
  await expect.poll(async () => (await chartState(owner)).series.length).toBeGreaterThan(0)
  const before = await chartState(owner)
  const calls = fixture.timeline.length
  await page.evaluate(() => {
    const app = (document.querySelector('#app') as any).__vue_app__.config.globalProperties.$pinia._s.get('app')
    app.openPaletteEditor()
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
  await frost(page, { dark: true })
  await expect(page.locator('.node-card').first()).toHaveCSS('transition-duration', '0s')
  await expect(page.locator('[data-node-ping-bars]')).toHaveCount(18)
  await page.getByTestId('palette-entry').focus()
  await page.keyboard.press('Enter')
  await expect(page.locator('#palette-heading')).toBeFocused()
  await page.getByTestId('palette-field-Text').click()
  await page.locator('#palette-hex').fill('#FFFFFF')
  await page.getByTestId('palette-field-Card').click()
  await page.locator('#palette-hex').fill('#FFFFFF')
  await expect(page.getByTestId('palette-panel')).toHaveCSS('color', 'rgb(242, 245, 250)')
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('palette-panel')).toHaveCount(0)
  await expect(page.getByTestId('palette-entry')).toBeFocused()
  await expect(page.locator('.node-card').first()).toHaveCSS('color', 'rgb(242, 245, 250)')
})

for (const [density, height] of [['mini', 40], ['compact', 52], ['comfortable', 58], ['large', 58]] as const) {
  test(`frost ${density} density keeps every task and 20 buckets at 360px`, async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 900 })
    await frost(page, { nodeCardSize: density, dark: true })
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
    const fixture = await frost(page, { managedThemeMode: 'beijing', clockNow: '2026-10-26T18:59:30+08:00', fakeTimers: true })
    await page.getByTestId('theme-mode-beijing').click()
    await page.getByTestId('palette-entry').click()
    await page.getByRole('button', { name: '编辑浅色', exact: true }).click()
    await fixture.advanceTime(60_000)
    await expect(page.locator('html')).toHaveClass(/dark/)
    await expect(page.getByRole('button', { name: '编辑浅色', exact: true })).toHaveAttribute('aria-pressed', 'true')
    await expect(page.locator('#palette-hex')).toHaveValue('#F8FAFCE6')
    await expect(page.getByTestId('theme-mode-beijing')).toHaveAttribute('aria-pressed', 'true')
    expect(await page.evaluate(() => localStorage.getItem('themeMode'))).toBe('beijing')
    expect(fixture.getThemeSaveCount()).toBe(0)
  }
  finally { await context.close() }
})

test('small semantic text meets contrast on actual default nested surfaces and legacy dark retains dark tokens', async ({ page }, info) => {
  await frost(page)
  const results = await page.locator('.node-card-info-surface').first().evaluate((surface) => {
    const canvas = document.createElement('canvas').getContext('2d')!
    const rgba = (value: string) => {
      canvas.clearRect(0, 0, 1, 1)
      canvas.fillStyle = value
      canvas.fillRect(0, 0, 1, 1)
      return Array.from(canvas.getImageData(0, 0, 1, 1).data)
    }
    const over = (fg: number[], bg: number[]) => fg.slice(0, 3).map((c, i) => c * fg[3]! / 255 + bg[i]! * (1 - fg[3]! / 255)).concat(255)
    const luminance = (channels: number[]) => channels.slice(0, 3).reduce((sum, value, i) => {
      const channel = value / 255
      return sum + (channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4) * [0.2126, 0.7152, 0.0722][i]!
    }, 0)
    const card = surface.closest('.node-card')!
    const results: Array<{ name: string, ratio: number }> = []
    for (const background of [[0, 0, 0, 255], [255, 255, 255, 255]]) {
      const bg = over(rgba(getComputedStyle(surface).backgroundColor), over(rgba(getComputedStyle(card).backgroundColor), background))
      for (const name of ['foreground', 'muted-foreground', 'selection', 'success', 'warning', 'destructive', 'info', 'upload', 'download', 'loss', 'missing']) {
        const span = document.createElement('span')
        span.className = `text-${name}`
        span.textContent = '0 ms'
        surface.append(span)
        const fg = over(rgba(getComputedStyle(span).color), bg)
        const a = luminance(fg)
        const b = luminance(bg)
        results.push({ name, ratio: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05) })
        span.remove()
      }
    }
    return results
  })
  for (const result of results)
    expect(result.ratio, result.name).toBeGreaterThanOrEqual(4.5)
  await info.attach('computed-contrast', { body: JSON.stringify(results, null, 2), contentType: 'application/json' })
  await page.getByTestId('theme-mode-dark').click()
  await page.evaluate(() => document.documentElement.classList.add('legacy-webkit'))
  await expect(page.locator('.node-card').first()).toHaveCSS('color', 'rgb(242, 245, 250)')
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--control-surface').trim())).toBe('#2C3744E6')
  await page.evaluate(() => document.documentElement.classList.add('color-vision-friendly'))
  await expect(page.locator('.text-upload').first()).toHaveCSS('color', 'rgb(68, 199, 160)')
  expect(await page.evaluate(() => {
    const style = getComputedStyle(document.documentElement)
    return [style.getPropertyValue('--signal-1').trim(), style.getPropertyValue('--ping-latency-excellent').trim()]
  })).toEqual(['#56b4e9', '#56b4e9'])
})

test('thirty-node palette editing adds no monitoring request or interval and retains full density', async ({ page }, info) => {
  // This is a composite request/lifecycle guard, not a 60-second UI latency SLA.
  // Linux WebKit trace snapshots of 3,600 buckets took ~60s across all eight
  // cycles, exhausting the test before its final assertions. Keep every cycle,
  // input and invariant; allow bounded runner overhead and report elapsed time.
  test.setTimeout(90_000)
  const fixture = await frost(page, { nodeCount: 30, fakeTimers: true })
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
