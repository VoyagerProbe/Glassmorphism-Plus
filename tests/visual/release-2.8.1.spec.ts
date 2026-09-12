import type { Locator, Page } from '@playwright/test'
import { expect, test } from '@playwright/test'
import { installKomariFixture, PRIMARY_NODE_UUID } from './fixtures/komari'

const config = JSON.stringify({ schemaVersion: 3, global: { threeNetworkEnabled: true, taskIds: [101, 202, 303] }, nodes: {} })
const remarkSelector = '[data-node-public-remark]'
const privateNote = 'PRIVATE_NOTE_DO_NOT_RENDER'
const summarySelector = '[class*="h-[19px]"]'

// Exercise the existing metadata updater without adding a production test hook.
// The polling test below separately verifies the public RPC -> store route.
async function updateMetadata(page: Page, patch: Record<string, unknown>) {
  await page.evaluate(({ uuid, patch }) => {
    const app = (document.querySelector('#app') as any).__vue_app__
    const store = app.config.globalProperties.$pinia._s.get('nodes')
    const clients = Object.fromEntries(store.nodes.map((node: any) => [node.uuid, { ...node }]))
    Object.assign(clients[uuid], patch)
    store.updateNodeClients(clients)
  }, { uuid: PRIMARY_NODE_UUID, patch })
}

async function geometry(card: Locator) {
  return card.evaluate((element) => {
    const root = element.getBoundingClientRect()
    const bounds = (e: Element) => {
      const b = e.getBoundingClientRect()
      return [b.x - root.x, b.y - root.y, b.width, b.height]
    }
    return { card: [root.width, root.height], summary: bounds(element.querySelector('[class*="h-[19px]"]')!), panels: Array.from(element.querySelectorAll('.node-card-info-surface,.node-card-ping-task-strip'), bounds), bars: Array.from(element.querySelectorAll('[data-node-ping-bucket-fill]'), bounds) }
  })
}

test('public remark is one safe reactive text pill, never private fallback or extra requests', async ({ page }) => {
  const fixture = await installKomariFixture(page, { hideEarth: true, nodeCount: 2, nodeCardPingDisplayConfigV3: config, nodeCardPingFixture: { metric: 'valid', thirdSharedTask: true } })
  fixture.setClientMetadata(0, { public_remark: '1500M', remark: privateNote })
  fixture.setClientMetadata(1, { public_remark: '', remark: privateNote })
  const requests: string[] = []
  const errors: string[] = []
  page.on('request', r => requests.push(r.url()))
  page.on('pageerror', e => errors.push(e.message))
  await page.goto('/')
  const card = page.locator('.node-card').first()
  const pill = card.locator(remarkSelector)
  await expect(pill).toHaveText('1500M')
  await expect(card.locator('[data-node-ping-task-id="202"]')).toContainText('200')
  await expect(page.locator('.node-card').nth(1).locator(remarkSelector)).toHaveCount(0)
  // Initial lazy icon batches can finish after the Ping data. Establish a
  // settled startup boundary before asserting that metadata edits fetch nothing.
  await page.waitForLoadState('networkidle')
  const before = await geometry(card)
  const rails = await card.locator('[data-node-ping-bucket-fill]').elementHandles()
  const count = requests.length
  for (const value of ['2000M', '0', ' \n1500M\t Shared / 1Gbps \r\n', '<img src="/never-request-remark" onerror="alert(1)"><script>bad()</script>']) {
    await updateMetadata(page, { public_remark: value })
    await expect(pill).toHaveText(value.trim().replace(/\s+/g, ' '))
    await expect(pill.locator('*')).toHaveCount(0)
    await expect(pill).not.toHaveAttribute('title')
    expect(await geometry(card)).toEqual(before)
  }
  for (const value of ['', ' \n\t ', null, 0, false, {}, ['not', 'text']]) {
    await updateMetadata(page, { public_remark: value })
    await expect(pill).toHaveCount(0)
    expect(await geometry(card)).toEqual(before)
  }
  await updateMetadata(page, { public_remark: '1500M', weight: 99 })
  await expect(page.locator('.node-card').last().locator(remarkSelector)).toHaveText('1500M')
  await expect(page.locator('.node-card').first().locator(remarkSelector)).toHaveCount(0)
  // Metadata updates retain the same mounted Ping rails and do not fetch.
  for (const rail of rails)
    expect(await rail.evaluate(e => e.isConnected)).toBe(true)
  expect(requests.length).toBe(count)
  expect(requests.some(url => url.includes('/api/admin') || url.includes('never-request-remark'))).toBe(false)
  expect(await page.locator('body').textContent()).not.toContain(privateNote)
  expect(await page.locator('body').innerHTML()).not.toContain(privateNote)
  expect(await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }))).not.toContain(privateNote)
  expect(errors).toEqual([])
})

test('existing public metadata polling updates 1500M to 2000M to absent without remounting Ping', async ({ page }) => {
  test.setTimeout(90_000)
  const fixture = await installKomariFixture(page, { hideEarth: true, nodeCount: 1, fakeTimers: true, nodeCardPingDisplayConfigV3: config, nodeCardPingFixture: { metric: 'valid', thirdSharedTask: true } })
  fixture.setClientMetadata(0, { public_remark: '1500M', remark: privateNote })
  await page.goto('/')
  const pill = page.locator(remarkSelector)
  await expect(pill).toHaveText('1500M')
  const group = await page.locator('.node-card-ping-group').elementHandle()
  for (const value of ['2000M', undefined]) {
    fixture.setClientMetadata(0, { public_remark: value })
    await fixture.advanceTime(65_000)
    if (value)
      await expect(pill).toHaveText(value)
    else
      await expect(pill).toHaveCount(0)
    expect(await group!.evaluate(e => e.isConnected)).toBe(true)
  }
  expect(await page.locator('body').textContent()).not.toContain(privateNote)
})

test('all card sizes preserve rows and rails; long remarks truncate and pills share styles in both themes', async ({ page, isMobile }, testInfo) => {
  test.setTimeout(90_000)
  await page.setViewportSize({ width: isMobile ? 390 : 1440, height: 900 })
  const fixture = await installKomariFixture(page, { hideEarth: true, nodeCount: 3, nodeCardPingDisplayConfigV3: config, nodeCardPingFixture: { metric: 'valid', thirdSharedTask: true } })
  fixture.setClientMetadata(0, { public_remark: '' })
  for (const size of ['mini', 'compact', 'comfortable', 'large']) {
    fixture.setThemeSetting('nodeCardSize', size)
    await page.goto('/')
    if (size !== 'mini')
      await page.reload()
    const card = page.locator('.node-card').first()
    await expect(card.locator('[data-node-ping-task-id="202"]')).toContainText('200')
    const before = await geometry(card)
    for (const theme of ['light', 'dark']) {
      await page.getByRole('button', { name: theme === 'light' ? '浅色模式' : '深色模式', exact: true }).dispatchEvent('click')
      await updateMetadata(page, { public_remark: '1500M' })
      const pill = card.locator(remarkSelector)
      await expect(pill).toHaveText('1500M')
      const styles = await card.locator(`${summarySelector} > span`).evaluateAll(elements => elements.map((e) => {
        const s = getComputedStyle(e)
        return [s.fontSize, s.fontFamily, s.fontWeight, s.lineHeight, s.borderRadius, s.padding, s.backgroundColor, s.color, e.getBoundingClientRect().height]
      }))
      expect(styles).toHaveLength(3)
      expect(styles[2]).toEqual(styles[0])
      expect(styles[2]).toEqual(styles[1])
      const short = await pill.boundingBox()
      const price = await card.locator(`${summarySelector} > span`).nth(1).boundingBox()
      expect(short!.width).toBeLessThan(100)
      await updateMetadata(page, { public_remark: '中文公开备注 Shared bandwidth 1500M / 多线路\n'.repeat(30) })
      const overflow = await pill.evaluate((e) => {
        const s = getComputedStyle(e)
        return { truncated: e.scrollWidth > e.clientWidth, wrap: s.whiteSpace, ellipsis: s.textOverflow, right: e.getBoundingClientRect().right }
      })
      expect(overflow.truncated).toBe(true)
      expect(overflow.wrap).toBe('nowrap')
      expect(overflow.ellipsis).toBe('ellipsis')
      expect(await card.locator(`${summarySelector} > span`).nth(1).boundingBox()).toEqual(price)
      expect(await geometry(card)).toEqual(before)
      expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false)
      const surfaces = await card.locator('.node-card-info-surface,.node-card-ping-task-strip').evaluateAll(elements => elements.map((e) => {
        const s = getComputedStyle(e)
        return { fill: s.backgroundColor, edge: s.boxShadow, opacity: s.opacity }
      }))
      expect(surfaces).toHaveLength(6)
      if (theme === 'light') {
        expect(new Set(surfaces.map(s => s.fill)).size).toBe(1)
        expect(surfaces.every(s => s.edge === 'none' && s.opacity === '1')).toBe(true)
        const expected = await card.evaluate((e) => {
          const sample = document.createElement('span')
          sample.style.backgroundColor = 'var(--glass-light-control)'
          e.appendChild(sample)
          const color = getComputedStyle(sample).backgroundColor
          sample.remove()
          return color
        })
        expect(surfaces[0]!.fill).toBe(expected)
      }
      if (size === 'compact')
        await card.screenshot({ path: testInfo.outputPath(`remark-${theme}.png`) })
      await updateMetadata(page, { public_remark: '' })
      expect(await geometry(card)).toEqual(before)
    }
  }
})

test('360px boundary, custom transparent control colors and automatic light/dark use existing theme tokens', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 })
  const fixture = await installKomariFixture(page, { hideEarth: true, nodeCount: 1, managedThemeMode: 'beijing', clockNow: '2026-07-25T02:00:00Z', nodeCardPingDisplayConfigV3: config, nodeCardPingFixture: { metric: 'valid', thirdSharedTask: true } })
  fixture.setThemeSetting('glassColorPreset', 'custom')
  fixture.setThemeSetting('glassCustomColors', JSON.stringify({ lightCard: '#ddeeff80', lightControl: '#aabbcc40' }))
  fixture.setClientMetadata(0, { public_remark: '公开备注 Long text '.repeat(30) })
  await page.goto('/')
  const card = page.locator('.node-card').first()
  await expect(card.locator(remarkSelector)).toBeVisible()
  await expect(page.locator('html')).not.toHaveClass(/dark/)
  await expect(card.locator('.node-card-info-surface').first()).toHaveCSS('background-color', 'rgba(170, 187, 204, 0.25)')
  await expect(card).toHaveCSS('background-color', 'rgba(221, 238, 255, 0.5)')
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false)
  await page.getByRole('button', { name: '深色模式', exact: true }).dispatchEvent('click')
  await expect(card.locator('.node-card-info-surface').first()).toHaveCSS('background-color', 'rgba(255, 255, 255, 0.05)')
})

test('guest/admin visibility keeps private notes hidden and honors hidden-node and price rules', async ({ page }) => {
  const fixture = await installKomariFixture(page, { hideEarth: true, nodeCount: 3, adminAccess: 'guest' })
  fixture.setThemeSetting('hidePriceWhenLoggedOut', true)
  fixture.setClientMetadata(0, { public_remark: '1500M', remark: privateNote })
  fixture.setClientMetadata(1, { hidden: true, public_remark: 'HIDDEN_NODE_PUBLIC_NOTE', remark: privateNote })
  fixture.setClientMetadata(2, { public_remark: null, remark: privateNote })
  for (const access of ['guest', 'admin', 'guest'] as const) {
    fixture.setAdminAccess(access)
    await page.goto('/')
    await page.reload()
    await expect(page.locator('.node-card')).toHaveCount(access === 'admin' ? 3 : 2)
    const primary = page.locator('.node-card').first()
    await expect(primary.locator(remarkSelector)).toHaveText('1500M')
    await expect(primary.locator(`${summarySelector} > span`)).toHaveCount(access === 'admin' ? 3 : 2)
    const html = await page.locator('body').innerHTML()
    expect(html).not.toContain(privateNote)
    if (access === 'guest')
      expect(html).not.toContain('HIDDEN_NODE_PUBLIC_NOTE')
  }
})
