import type { Locator } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'
import { installKomariFixture, PRIMARY_NODE_UUID } from './fixtures/komari'

const manifest = JSON.parse(readFileSync('komari-theme.json', 'utf8'))
const config = (three = true) => JSON.stringify({ schemaVersion: 3, global: { threeNetworkEnabled: three, taskIds: three ? [101, 202, 303] : [202, null, null] }, nodes: {} })
const stripSelector = `[data-node-card-uuid="${PRIMARY_NODE_UUID}"] [data-node-ping-task-id="202"]`
const description = 'Enhanced Komari Glassmorphism based on sanrokamlan’s original.'

async function labelGeometry(strip: Locator) {
  return strip.evaluate((element) => {
    const rect = (e: Element) => {
      const r = e.getBoundingClientRect()
      return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height }
    }
    const status = element.querySelector('.node-card-ping-status-dot')!
    return {
      height: rect(element).height,
      status: rect(status),
      labels: Array.from(element.querySelectorAll<HTMLElement>('.node-card-ping-trend-label'), (label) => {
        const icon = label.querySelector('svg')!
        const row = label.parentElement!
        const rail = row.querySelector('[data-node-ping-bars]')!
        const c = getComputedStyle(label)
        const shape = icon.querySelector('path, rect')!
        const wave = shape.tagName.toLowerCase() === 'path'
        const hidden = label.querySelector<HTMLElement>('.sr-only')!
        return {
          metric: label.dataset.nodePingHeader,
          text: hidden.textContent?.trim(),
          hiddenSize: rect(hidden),
          label: rect(label),
          icon: rect(icon),
          rail: rect(rail),
          row: rect(row),
          shape: wave ? shape.getAttribute('d') : Array.from(icon.querySelectorAll('rect'), r => r.getAttribute('height')),
          border: c.borderTopWidth,
          background: c.backgroundColor,
          padding: c.padding,
          color: wave ? getComputedStyle(shape).stroke : getComputedStyle(shape).fill,
          transform: getComputedStyle(icon).transform,
          ariaHidden: icon.getAttribute('aria-hidden'),
          focusable: icon.getAttribute('focusable'),
          interactive: Boolean(label.closest('button, [role="button"]') || label.querySelector('[tabindex], button, title') || label.hasAttribute('title')),
          gap: getComputedStyle(rail).columnGap,
          fills: Array.from(rail.querySelectorAll('[data-node-ping-bucket-fill]'), fill => ({ ...rect(fill), transform: getComputedStyle(fill).transform })),
        }
      }),
    }
  })
}

function checkGeometry(value: Awaited<ReturnType<typeof labelGeometry>>, size = 'compact') {
  expect(value.status.width).toBe(6)
  expect(value.status.height).toBe(6)
  expect(value.height).toBe(size === 'mini' ? 40 : size === 'compact' ? 52 : 58)
  expect(value.labels.map(l => l.metric)).toEqual(['latency', 'loss'])
  expect(value.labels.map(l => l.text)).toEqual(['延迟历史', '丢包历史'])
  expect(value.labels.map(l => l.shape)).toEqual(['M1.5 8h3l1.8-5 3.1 10 1.8-5h3.3', ['6', '12', '9']])
  expect(value.labels[0]!.rail.left).toBeCloseTo(value.labels[1]!.rail.left, 1)
  expect(value.labels[0]!.rail.right).toBeCloseTo(value.labels[1]!.rail.right, 1)
  expect(value.labels[0]!.color).not.toBe(value.labels[1]!.color)
  const iconSize = size === 'mini' ? 9 : size === 'compact' ? 10 : 11
  for (const label of value.labels) {
    expect(label.icon.width).toBe(iconSize)
    expect(label.icon.height).toBe(iconSize)
    expect(label.hiddenSize.width).toBe(1)
    expect(label.hiddenSize.height).toBe(1)
    expect(label.icon.left).toBeGreaterThanOrEqual(label.label.left)
    expect(label.icon.right).toBeLessThanOrEqual(label.label.right)
    expect(label.icon.top).toBeGreaterThanOrEqual(label.row.top)
    expect(label.icon.bottom).toBeLessThanOrEqual(label.row.bottom)
    expect((label.icon.top + label.icon.bottom) / 2).toBeCloseTo((label.rail.top + label.rail.bottom) / 2, 1)
    expect(label.transform).toBe('none')
    expect(label.ariaHidden).toBe('true')
    expect(label.focusable).toBe('false')
    expect(label.interactive).toBe(false)
    expect(label.border).toBe('0px')
    expect(label.background).toBe('rgba(0, 0, 0, 0)')
    expect(label.padding).toBe('0px')
    expect(label.label.width).toBe(size === 'mini' ? 12 : 14)
    expect(label.label.right).toBeLessThan(label.rail.left)
    expect(label.fills).toHaveLength(20)
    expect(label.gap).toBe(size === 'mini' ? '1px' : '2px')
    expect(label.fills[0]!.left).toBeCloseTo(label.rail.left, 1)
    expect(label.fills[19]!.right).toBeCloseTo(label.rail.right, 1)
    for (const fill of label.fills) {
      expect(fill.height).toBe(size === 'mini' ? 4 : size === 'compact' ? 5 : 6)
      expect(fill.transform).toBe('none')
    }
  }
}

test.describe('localized rail markers and protected footer', () => {
  for (const variant of [
    { name: 'desktop dark', width: 1280, size: 'compact', dark: true, three: true },
    { name: 'desktop light', width: 1280, size: 'compact', dark: false, three: true },
    { name: 'mobile single', width: 390, size: 'compact', dark: true, three: false },
    { name: 'narrow color vision', width: 360, size: 'compact', dark: false, three: true, colorVisionFriendly: true },
    { name: 'mini', width: 390, size: 'mini', dark: true, three: true },
    { name: 'comfortable', width: 390, size: 'comfortable', dark: false, three: true },
    { name: 'large', width: 390, size: 'large', dark: true, three: true },
  ] as const) {
    test(`${variant.name}: accessible metric icons preserve fixed rails`, async ({ page }, info) => {
      await page.setViewportSize({ width: variant.width, height: 900 })
      await installKomariFixture(page, {
        hideEarth: true,
        nodeCount: 1,
        nodeCardSize: variant.size,
        dark: variant.dark,
        colorVisionFriendly: 'colorVisionFriendly' in variant && variant.colorVisionFriendly,
        nodeCardPingDisplayConfigV3: config(variant.three),
        nodeCardPingFixture: { metric: 'valid', thirdSharedTask: true, task202Name: '合成长任务名称 · 三网线路边界验证', task202Latency: 999, task202Loss: 100 },
      })
      await page.goto('/')
      const strip = page.locator(stripSelector)
      await expect(strip).toHaveAttribute('data-node-ping-status', 'data')
      checkGeometry(await labelGeometry(strip), variant.size)
      await expect(strip.locator('[data-node-ping-header]')).toHaveCount(2)
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      // Synthetic review artifact, not a new cross-platform golden baseline.
      await info.attach('card-labels', { body: await page.locator('.node-card').first().screenshot(), contentType: 'image/png' })
    })
  }

  test('metric colors stay independent across pending, loss, unreachable, missing and errors', async ({ page }) => {
    const fixture = await installKomariFixture(page, { hideEarth: true, nodeCount: 1, dark: true, fakeTimers: true, nodeCardPingDisplayConfigV3: config(false), nodeCardPingFixture: { metric: 'valid', legacy: 'valid', task202Latency: 9, task202Loss: 0 } })
    const resume = fixture.pausePingResponses()
    await page.goto('/')
    const strip = page.locator(stripSelector)
    await expect(strip).toHaveAttribute('data-node-ping-status', 'pending')
    const pending = await labelGeometry(strip)
    checkGeometry(pending)
    const colors = pending.labels.map(l => l.color)
    resume()
    for (const sample of [{ task202Latency: 9, task202Loss: 0 }, { task202Latency: 999, task202Loss: 25 }, { task202Latency: null, task202Loss: 100 }]) {
      fixture.setNodeCardPingFixture({ metric: 'valid', legacy: 'valid', ...sample })
      await page.reload()
      await expect(strip).toHaveAttribute('data-node-ping-status', 'data')
      const current = await labelGeometry(strip)
      checkGeometry(current)
      expect(current.labels.map(l => l.color)).toEqual(colors)
    }
    for (const state of ['selected-empty', 'error'] as const) {
      fixture.setNodeCardPingFixture({ metric: state, legacy: state })
      await page.reload()
      await expect(strip.locator(`[data-node-ping-state="${state === 'error' ? 'error' : 'confirmed-missing'}"]`)).not.toHaveCount(0)
      const current = await labelGeometry(strip)
      checkGeometry(current)
      expect(current.labels.map(l => l.color)).toEqual(colors)
    }
  })

  test('metric kinds keep their colors in light, dark and automatic mode with custom secondary text', async ({ page }) => {
    const fixture = await installKomariFixture(page, { hideEarth: true, nodeCount: 1, managedThemeMode: 'beijing', nodeCardPingDisplayConfigV3: config(false), nodeCardPingFixture: { metric: 'valid' } })
    await page.goto('/')
    const label = page.locator(stripSelector).locator('.node-card-ping-trend-label').first()
    await expect(label).toBeVisible()
    for (const mode of ['light', 'dark', 'beijing']) {
      fixture.setThemeSetting('themeMode', mode)
      await page.reload()
      // The summary retains the theme's secondary color; icon kinds do not inherit it.
      const summary = page.locator(stripSelector).locator('[data-node-ping-summary="latency"] > span')
      await summary.evaluate((e) => {
        const parent = e.parentElement!
        parent.style.setProperty('--glass-light-muted-text', 'rgb(94, 123, 145)')
        parent.style.setProperty('--glass-dark-muted-text', 'rgb(94, 123, 145)')
      })
      await expect(summary).toHaveCSS('color', 'rgb(94, 123, 145)')
      const dark = await page.locator('html').evaluate(e => e.classList.contains('dark'))
      await expect(label.locator('path')).toHaveCSS('stroke', dark ? 'rgb(56, 189, 248)' : 'rgb(3, 105, 161)')
      await expect(page.locator(stripSelector).locator('[data-node-ping-header="loss"] rect').first()).toHaveCSS('fill', dark ? 'rgb(192, 132, 252)' : 'rgb(126, 34, 206)')
    }
  })

  test('footer tooltip keeps version and links without a commit suffix', async ({ page, isMobile }) => {
    await installKomariFixture(page, { hideEarth: true, nodeCount: 1 })
    await page.goto('/')
    // Wait for the async homepage layout, not just the early-mounted footer.
    await expect(page.locator('.node-card')).toHaveCount(1)
    await page.evaluate(() => document.fonts.ready)
    const footer = page.locator('footer')
    const identity = `v${manifest.version} · VoyagerProbe`
    const version = footer.getByText(identity, { exact: true })
    await expect(version).toBeVisible()
    // Reka closes on scroll. Finish scrolling before the first pointer entry,
    // otherwise hover's auto-scroll event can immediately close the new tip.
    await footer.scrollIntoViewIfNeeded()
    await page.evaluate(() => new Promise<void>(done => requestAnimationFrame(() => requestAnimationFrame(() => done()))))
    await expect(footer.getByRole('link', { name: 'Glassmorphism Plus', exact: true })).toHaveAttribute('href', manifest.url)
    const backend = footer.getByRole('link', { name: 'Komari Monitor', exact: true })
    await expect(backend).toHaveAttribute('href', 'https://github.com/komari-monitor/komari')
    if (isMobile) {
      await version.tap()
      // Footer has never enabled openOnClick: a touch must not add a pinned tip.
      await expect(page.locator('[data-slot="data-tooltip-content"]')).toHaveCount(0)
      await expect(footer).toContainText(identity)
    }
    await version.hover()
    const tooltip = page.locator('[data-slot="data-tooltip-content"]').last()
    // Reka also renders an accessible text copy; neither copy may contain a hash.
    await expect.poll(async () => (await tooltip.textContent())?.replaceAll(identity, '').trim()).toBe('')
    await expect(tooltip).toContainText(identity)
    expect(await footer.locator('[title],[aria-label]').evaluateAll(elements => elements.map(e => `${e.getAttribute('title') || ''} ${e.getAttribute('aria-label') || ''}`).join(' '))).not.toMatch(/\b[0-9a-f]{7,40}\b/)
    await page.keyboard.press('Escape')
    await backend.hover()
    await expect(page.locator('[data-slot="data-tooltip-content"]').last()).toContainText('1.2.6-visual')
  })

  test('manifest identity and build provenance contracts stay explicit', () => {
    expect(manifest.version).toBe('3.0.2')
    expect(manifest.version).toBe(JSON.parse(readFileSync('package.json', 'utf8')).version)
    expect(manifest.description).toBe(description)
    expect(manifest.short).toBe('glassmorphism-plus')
    expect(manifest.configuration.type).toBe('managed')
    expect(manifest.author).toBe('VoyagerProbe')
    expect(manifest.name).toBe('Komari Glassmorphism Plus')
    expect(readFileSync('vite.config.ts', 'utf8')).toContain('__BUILD_GIT_HASH__')
    expect(readFileSync('src/components/Footer.vue', 'utf8')).not.toContain('__BUILD_GIT_HASH__')
  })
})
