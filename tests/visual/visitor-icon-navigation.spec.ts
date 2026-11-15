import { createRequire } from 'node:module'
import { expect, test } from '@playwright/test'
import { installKomariFixture, PRIMARY_NODE_UUID } from './fixtures/komari'

const require = createRequire(import.meta.url)
const glyphs = require('../../src/assets/visitor-icons.json') as typeof import('../../src/assets/visitor-icons.json')

const hosts = new Set(['api.iconify.design', 'api.simplesvg.com', 'api.unisvg.com'])
const fixedNames = ['android', 'apple', 'browser-chrome', 'close', 'earth', 'laptop', 'local', 'protect', 'time', 'user', 'windows']

test('the small visitor set is the original pinned artwork, including the missing mac result', () => {
  const source = require('@iconify/json/json/icon-park-outline.json')
  expect(Object.keys(glyphs.icons).sort()).toEqual(fixedNames)
  for (const [name, icon] of Object.entries(glyphs.icons))
    expect(icon).toEqual(source.icons[name])
  expect([glyphs.prefix, glyphs.width, glyphs.height]).toEqual([source.prefix, source.width, source.height])
  expect(glyphs.not_found).toEqual(['mac'])
  expect(source.icons.mac ?? source.aliases?.mac).toBeUndefined()
})

test('visitor glyphs render on three detail navigations without their external fetch or page errors', async ({ page }) => {
  const hits: string[] = []
  const errors: string[] = []
  page.on('pageerror', err => errors.push(err.message))
  await installKomariFixture(page, { hideEarth: true, nodeCount: 2, nodeCardPingFixture: { metric: 'valid' } })
  await page.route((url) => {
    if (!hosts.has(url.hostname) || url.pathname !== '/icon-park-outline.json')
      return false
    const names = (url.searchParams.get('icons') ?? '').split(',')
    return names.some(name => ['browser-chrome', 'protect', 'mac'].includes(name))
  }, async (route) => {
    hits.push(route.request().url())
    await route.abort('failed')
  })

  const closePath = /\sd="([^"]+)"/.exec(glyphs.icons.close.body)?.[1]
  const earthPath = /\sd="([^"]+)"/.exec(glyphs.icons.earth.body)?.[1]
  if (!closePath || !earthPath)
    throw new Error('Expected real paths in the original artwork')
  for (let visit = 0; visit < 3; visit++) {
    await page.goto(`/instance/${PRIMARY_NODE_UUID}`)
    await expect(page.locator('[data-ping-chart] x-vue-echarts')).toBeAttached()
    const close = page.locator('[aria-label="关闭访客信息"] svg')
    const strip = page.locator('.fixed.bottom-3').filter({ hasText: 'Your IP:' }).locator('svg')
    await expect(close).toHaveAttribute('viewBox', '0 0 48 48')
    await expect(close.locator('path').first()).toHaveAttribute('d', closePath)
    await expect(strip).toBeVisible()
    await expect(strip.locator('path').first()).toHaveAttribute('d', earthPath)
    expect(hits).toEqual([])
    expect(errors).toEqual([])
  }
})
