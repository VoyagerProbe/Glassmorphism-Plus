import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import process from 'node:process'
import { expect } from '@playwright/test'
import { chromium } from 'playwright'
import { createLab, digest, download, project, zipFiles } from './lab.mjs'
import { compatibility } from './migration.mjs'

// Genuine versioned installer imports into the official disposable fix1 binary.
// No production instance, route mocking, data deletion or Latest update button.
const manifest = JSON.parse(readFileSync(resolve(project, 'komari-theme.json')))
const installer = process.env.PLUS_INSTALLER || resolve(project, '..', manifest.version, `Glassmorphism-Plus-release-${manifest.version}.zip`)
const oldSha = '622ac4455b2d674886380dda6219b1dc5442703d8a1a24145cb29d20d4363b08'
const workerSha = '472d42cd35619cde31ba3378b3c1b1ed12a7687152e37b7d131b67902814d527'
const description = 'Enhanced Komari Glassmorphism based on sanrokamlan’s original.'
const javascriptPattern = /javascript/

async function main() {
  const lab = await createLab()
  let browser
  try {
    const oldZip = await download('https://github.com/VoyagerProbe/Glassmorphism-Plus/releases/download/v2.8.2/Glassmorphism-Plus-release-2.8.2.zip', resolve(lab.root, 'v2.8.2.zip'), oldSha)
    const files = zipFiles(installer)
    const installedManifest = JSON.parse(files.get('komari-theme.json'))
    assert.equal(installedManifest.version, manifest.version)
    assert.equal(installedManifest.short, 'glassmorphism-plus')
    assert.equal(installedManifest.description, description)
    const oldManifest = JSON.parse(zipFiles(oldZip).get('komari-theme.json'))
    for (const key of ['name', 'short', 'author', 'url', 'preview', 'configuration'])
      assert.deepEqual(installedManifest[key], oldManifest[key], `Preserved manifest ${key}`)
    assert.equal(digest(files.get('LICENSE')), digest(readFileSync(resolve(project, 'LICENSE'))))
    assert.equal(digest(files.get('preview.png')), digest(zipFiles(oldZip).get('preview.png')))
    assert.equal(digest(files.get('dist/sw.js')), workerSha)
    assert(![...files.keys()].some(name => name.includes('plus-recovery')))
    await lab.upload(oldZip)
    await lab.setTheme('glassmorphism-plus')
    let rpcId = 0
    const rpc = async (method, params, auth = false) => {
      const response = await lab.request('/api/rpc2', { auth, body: { jsonrpc: '2.0', id: ++rpcId, method, params } })
      assert(!response.error, `Synthetic RPC failed: ${method}`)
      return response.result
    }
    const client = await rpc('admin:addClient', { name: 'Synthetic upgrade node' }, true)
    await rpc('admin:editClient', { uuid: client.uuid, name: 'Synthetic upgrade node', cpu_name: 'Synthetic CPU', cpu_cores: 4, arch: 'amd64', os: 'Debian', region: 'US', mem_total: 4 * 1024 ** 3, disk_total: 32 * 1024 ** 3 }, true)
    const tasks = []
    for (let i = 0; i < 3; i++) {
      const task = await rpc('admin:addPingTask', { name: `Synthetic Ping ${i + 1}`, target: 'example.invalid', type: 'icmp', interval: 60, default_on: false, clients: [client.uuid] }, true)
      tasks.push(task.task_id)
    }
    const feed = async () => {
      const agent = async (method, params) => {
        const response = await lab.request(`/api/clients/v2/rpc?token=${encodeURIComponent(client.token)}`, { body: { jsonrpc: '2.0', id: ++rpcId, method, params } })
        assert(!response.error, 'Synthetic agent report failed')
      }
      await agent('agent.report', { report: { cpu: { usage: 12 }, ram: { used: 1024 ** 3, total: 4 * 1024 ** 3 }, disk: { used: 4 * 1024 ** 3, total: 32 * 1024 ** 3 }, network: { up: 4096, down: 8192, totalUp: 1024 ** 3, totalDown: 3 * 1024 ** 3 }, uptime: 86400, load: { load1: 0.2, load5: 0.2, load15: 0.2 }, connections: { tcp: 3, udp: 1 }, process: 42 } })
      for (const [i, id] of tasks.entries())
        await agent('agent.pingResult', { task_id: id, value: i === 2 ? -1 : 9 + i })
    }
    await feed()
    const settings = { themeMode: 'dark', themeColor: '#00c99c', nodeCardSize: 'compact', hideEarth: true, disablePageAnimation: true, rpcTransportMode: 'http', nodeCardPingDisplayConfigV3: JSON.stringify({ schemaVersion: 3, global: { threeNetworkEnabled: true, taskIds: tasks }, nodes: {} }) }
    await lab.request('/api/admin/theme/settings?theme=glassmorphism-plus', { auth: true, body: settings })
    const beforeSettings = (await rpc('public:getPublicSettings')).theme_settings
    browser = await chromium.launch()
    const context = await browser.newContext({ locale: 'zh-CN', serviceWorkers: 'allow', viewport: { width: 1280, height: 900 } })
    const split = lab.cookie.indexOf('=')
    await context.addCookies([{ name: lab.cookie.slice(0, split), value: lab.cookie.slice(split + 1), url: lab.base }])
    const admin = await context.newPage()
    await admin.goto(`${lab.base}/admin/settings/site`)
    await expect(admin.getByRole('button', { name: '保存', exact: true }).first()).toBeVisible()
    await expect.poll(() => admin.evaluate(async () => (await navigator.serviceWorker.getRegistration('/'))?.active?.state), { timeout: 30000 }).toBe('activated')
    const input = admin.locator('input').first()
    await input.fill('Synthetic unsaved upgrade form')
    let adminNavigations = 0
    admin.on('framenavigated', (frame) => {
      if (frame === admin.mainFrame())
        adminNavigations++
    })
    const page = await context.newPage()
    await page.goto(lab.base)
    await expect.poll(() => compatibility(page), { timeout: 30000 }).toBe('plus-online-v1')
    await expect(page.locator('footer')).toContainText('v2.8.2 · VoyagerProbe')
    const beforeEntry = await page.locator('script[type="module"][src]').first().getAttribute('src')
    await page.getByRole('button', { name: '收藏 Synthetic upgrade node', exact: true }).click()
    await expect.poll(() => page.evaluate(() => localStorage.getItem('theme:favorite-nodes:v1'))).toBe(JSON.stringify([client.uuid]))
    await page.evaluate(() => {
      localStorage.setItem('themeMode', 'dark')
      document.cookie = 'upgrade_sentinel=preserve; Path=/; SameSite=Lax'
    })
    const beforeStorage = await page.evaluate(() => ({ favorites: localStorage.getItem('theme:favorite-nodes:v1'), themeMode: localStorage.getItem('themeMode') }))
    await lab.upload(installer)
    await feed()
    assert.deepEqual((await rpc('public:getPublicSettings')).theme_settings, beforeSettings)
    assert.deepEqual(readdirSync(resolve(lab.root, 'data/theme')).filter(name => name.toLowerCase() === 'glassmorphism-plus'), ['glassmorphism-plus'])
    for (const [name, bytes] of files)
      assert.equal(digest(readFileSync(resolve(lab.root, 'data/theme/glassmorphism-plus', name))), digest(bytes), `Installed file parity: ${name}`)
    const nav = await page.reload()
    assert.equal(nav.fromServiceWorker(), false)
    await expect(page.locator('footer')).toContainText(`v${manifest.version} · VoyagerProbe`)
    assert.notEqual(await page.locator('script[type="module"][src]').first().getAttribute('src'), beforeEntry)
    await expect(page.getByRole('button', { name: '取消收藏 Synthetic upgrade node', exact: true })).toBeVisible()
    assert.deepEqual(await page.evaluate(() => ({ favorites: localStorage.getItem('theme:favorite-nodes:v1'), themeMode: localStorage.getItem('themeMode') })), beforeStorage)
    assert(await page.evaluate(() => document.cookie.includes('upgrade_sentinel=preserve')))
    await expect(page.locator('[data-node-ping-task-id]')).toHaveCount(3)
    await expect(page.locator('.node-card-ping-trend-dot')).toHaveCount(6)
    await page.locator('[data-node-ping-header="latency"]').first().click()
    await expect(page.getByRole('dialog').locator('[data-ping-chart]')).toHaveAttribute('data-ping-chart-loss', 'enabled')
    await expect.poll(async () => Number(await page.getByRole('dialog').locator('[data-ping-chart]').getAttribute('data-ping-chart-record-count'))).toBeGreaterThan(0)
    await page.getByRole('dialog').getByRole('button', { name: '关闭', exact: true }).click()
    assert.equal(adminNavigations, 0)
    const upgradeNavigations = adminNavigations
    await expect(input).toHaveValue('Synthetic unsaved upgrade form')
    await admin.getByRole('button', { name: '保存', exact: true }).first().click()
    await expect.poll(async () => (await lab.request('/api/admin/settings/', { auth: true })).data.sitename).toBe('Synthetic unsaved upgrade form')
    await admin.goto(`${lab.base}/admin/theme`)
    await expect(admin.getByRole('button', { name: 'glassmorphism-plus设置', exact: true })).toBeVisible()
    await admin.getByText('Komari Glassmorphism Plus', { exact: true }).click()
    await expect(admin.getByRole('dialog')).toContainText(description)
    const sw = await fetch(`${lab.base}/sw.js`)
    assert.match(sw.headers.get('content-type'), javascriptPattern)
    assert.equal(digest(Buffer.from(await sw.arrayBuffer())), workerSha)
    assert.equal(await compatibility(page), 'plus-online-v1')
    const result = { platform: process.platform, binarySha256: lab.binaryHash, oldInstallerSha256: oldSha, installerSha256: digest(readFileSync(installer)), version: manifest.version, short: manifest.short, installedFiles: files.size, sameOriginAndProfile: true, identityAndSchemaPreserved: true, settingsBindingsFavoritesColorAndCookiePreserved: true, adminNavigationsDuringUpgrade: upgradeNavigations, realAdminDescription: true, adminButtonUsesSettingsTheme: true, fullPingModalWithRealRecords: true, workerSha256: workerSha, physicalSafari: 'not-tested' }
    writeFileSync(resolve(lab.root, 'release-upgrade.json'), JSON.stringify(result, null, 2))
    process.stdout.write(`${JSON.stringify(result)}\n`)
  }
  finally {
    await browser?.close()
    await lab.stop()
  }
}
main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
