import type { TestInfo } from '@playwright/test'
import { expect, test } from '@playwright/test'
import { installKomariFixture } from './fixtures/komari'
import { CUSTOM_COLORS } from './fixtures/palette'

const changes = {
  lightCard: '#DDEAF1E6',
  lightControl: '#ABCBD8F2',
  lightText: '#152E40',
  lightMutedText: '#355A71',
  lightBorder: '#627F91FF',
  darkCard: '#22364BE6',
  darkControl: '#344D63F2',
  darkText: '#EDF3FF',
  darkMutedText: '#B3CADB',
  darkBorder: '#809BAFFF',
}
type Colors = typeof changes
type Sample = readonly [string, string, 'Card' | 'Control' | 'Text' | 'MutedText' | 'Border']
const home: Sample[] = [
  ['.a2-node', 'background-color', 'Card'],
  ['.a2-stats [data-general-card-key]', 'background-color', 'Card'],
  ['.a2-info-bar', 'background-color', 'Control'],
  ['.a2-node-title', 'color', 'Text'],
  ['.a2-stat-label', 'color', 'MutedText'],
  ['.a2-stats [data-general-card-key]', 'border-top-color', 'Border'],
]
const overview: Sample[] = [
  ['.ping-stat-grid .gp-surface', 'background-color', 'Card'],
  ['[data-testid="ping-center-public-task-101"]', 'background-color', 'Card'],
  ['[data-testid="ping-center-covered-nodes-101"]', 'background-color', 'Control'],
  ['[data-testid="ping-center-public-task-101"] h2', 'color', 'Text'],
  ['[data-testid="ping-center-public-task-101"] p', 'color', 'MutedText'],
  ['[data-testid="ping-center-public-task-101"]', 'border-top-color', 'Border'],
]
const config: Sample[] = [
  ['[data-testid="ping-center-global-config"]', 'background-color', 'Card'],
  ['[data-testid="ping-center-global-slot-1"]', 'background-color', 'Control'],
  ['[data-testid="ping-center-settings-search"]', 'color', 'Text'],
  ['[data-testid="ping-center-global-config"] .gp-muted', 'color', 'MutedText'],
  ['[data-testid="ping-center-settings-search"]', 'border-top-color', 'Border'],
]
const portal: Sample[] = [
  ['.gp-ping-dialog', 'background-color', 'Card'],
  ['.gp-ping-dialog select', 'background-color', 'Control'],
  ['.gp-ping-dialog select', 'color', 'Text'],
  ['.gp-ping-dialog .gp-muted', 'color', 'MutedText'],
  ['.gp-ping-dialog', 'border-top-color', 'Border'],
]
const sample: Sample[] = [
  ['.palette-sample', 'background-color', 'Card'],
  ['.palette-sample-control', 'background-color', 'Control'],
  ['.palette-sample strong', 'color', 'Text'],
  ['.palette-sample-meta', 'color', 'MutedText'],
  ['.palette-sample', 'border-top-color', 'Border'],
]

for (const mode of ['light', 'dark'] as const) {
  for (const phase of ['baseline', 'cancel', 'save'] as const) {
    test(`Scheme 2 ${mode} ten-key surfaces: ${phase} across real views and Portal`, async ({ page, isMobile }, info: TestInfo) => {
      const f = await installKomariFixture(page, { themeShort: 'glassmorphism-plus', dark: mode === 'dark', nodeCount: 3, adminAccess: 'admin', hideEarth: true, preserveStorageOnReload: true, nodeCardPingFixture: { thirdSharedTask: true } })
      f.setThemeSetting('glassColorPreset', '自定义')
      f.setThemeSetting('glassCustomColors', JSON.stringify(CUSTOM_COLORS))
      await page.setViewportSize({ width: isMobile ? 390 : 1353, height: 900 })
      await page.goto('/')
      const evidence: object[] = []
      async function measure(phase: string, specs: Sample[], colors: Colors, group = mode) {
        await page.mouse.move(0, 0)
        // Read a complete frame in one browser call; WebKit tracing each remote
        // locator separately would measure the harness rather than CSS propagation.
        let rows: { key: string, selector: string, property: string, source: string, actual: string | null, expected: string }[] = []
        await expect.poll(async () => {
          rows = await page.evaluate(({ specs, colors, group }) => {
            const probe = document.createElement('i')
            document.body.append(probe)
            try {
              return specs.map(([selector, property, part]) => {
                const key = `${group}${part}` as keyof Colors
                const el = document.querySelector(selector)
                probe.style.color = colors[key]
                return { key, selector, property, source: colors[key], expected: getComputedStyle(probe).color, actual: el ? getComputedStyle(el).getPropertyValue(property) : null }
              })
            }
            finally { probe.remove() }
          }, { specs, colors, group })
          return rows.filter(row => row.actual !== row.expected)
        }, { message: phase }).toEqual([])
        evidence.push({ phase, rows })
      }
      async function editor() {
        await page.getByTestId('palette-entry').click()
        await expect(page.getByTestId('palette-status')).toContainText('已验证管理权限')
      }
      async function importTen() {
        await page.locator('.palette-advanced summary').click()
        await page.locator('#palette-json').fill(JSON.stringify(changes))
        await page.getByRole('button', { name: '导入', exact: true }).click()
      }
      async function visitViews(phase: string, colors: Colors) {
        await page.getByTestId('ping-center-entry').click()
        await measure(`${phase}/overview`, overview, colors)
        await page.getByTestId('ping-center-tab-settings').click()
        await measure(`${phase}/configuration`, config, colors)
        await page.getByRole('button', { name: '单节点配置' }).first().click()
        await expect(page.locator('.gp-ping-dialog')).toBeVisible()
        expect(await page.locator('.gp-ping-dialog').evaluate(el => !el.closest('.gp-ping-center'))).toBe(true)
        await page.getByTestId('ping-center-node-mode-custom').click()
        await measure(`${phase}/portal`, portal, colors)
        await page.keyboard.press('Escape')
        await page.getByTestId('ping-center-close').click()
      }
      if (phase === 'baseline') {
        await measure('baseline/home', home, CUSTOM_COLORS)
        await visitViews('baseline', CUSTOM_COLORS)
      }
      await editor()
      await importTen()
      expect(f.getThemeSaveCount()).toBe(0)
      if (phase === 'baseline') {
        for (const edit of ['light', 'dark'] as const) {
          await page.getByRole('button', { name: edit === 'light' ? '编辑浅色' : '编辑深色' }).click()
          await measure(`sample/${edit}`, sample, changes, edit)
          expect(await page.locator('html').evaluate(el => el.classList.contains('dark'))).toBe(mode === 'dark')
        }
      }
      else if (phase === 'cancel') {
        await measure('preview/home', home, changes)
        await visitViews('preview', changes)
        await page.getByRole('button', { name: '取消', exact: true }).click()
        await measure('cancel/home', home, CUSTOM_COLORS)
        await visitViews('cancel', CUSTOM_COLORS)
        expect(f.getThemeSaveCount()).toBe(0)
      }
      else {
        await page.getByTestId('palette-save-site').click()
        await expect(page.getByTestId('palette-notice')).toContainText('已保存')
        expect(f.getThemeSaveCount()).toBe(1)
        await page.reload()
        await measure('saved-reload/home', home, changes)
        await visitViews('saved-reload', changes)
        await editor()
        await page.getByRole('button', { name: mode === 'light' ? '编辑浅色' : '编辑深色' }).click()
        await measure('reopened', sample, changes)
      }
      await info.attach('computed-palette-evidence', { body: JSON.stringify(evidence), contentType: 'application/json' })
    })
  }
}
