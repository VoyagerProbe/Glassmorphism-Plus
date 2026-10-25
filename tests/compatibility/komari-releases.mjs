import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import process from 'node:process'
import { expect } from '@playwright/test'
import { chromium } from 'playwright'
import { createLab, delay, digest, download, project, zipFiles } from '../service-worker/lab.mjs'
import { verifyPaletteRoundtrip } from './palette-roundtrip.mjs'

const manifest = JSON.parse(readFileSync(resolve(project, 'komari-theme.json')))
const installer = process.env.PLUS_INSTALLER || resolve(project, '..', manifest.version, `Glassmorphism-Plus-release-${manifest.version}.zip`)
const files = zipFiles(installer)
const installerSha = digest(readFileSync(installer))
const workerSha = '472d42cd35619cde31ba3378b3c1b1ed12a7687152e37b7d131b67902814d527'
// Explicit old candidates may be supplied for same-version revision gates.
// SHA is mandatory: a moving same-name Release asset is never a trusted baseline.
const previousOverride = process.env.PLUS_PREVIOUS_INSTALLER || process.env.PLUS_PREVIOUS_URL
const oldSha = previousOverride ? process.env.PLUS_PREVIOUS_SHA : 'b044eefcd5df9124cdbb40061a9fab704c172142ac88df7cbf5d22930ba9c6a1'
assert.match(oldSha || '', /^[a-f0-9]{64}$/)
const versions = process.env.KOMARI_COMPAT_VERSIONS?.split(',') || ['1.6.0', '1.5.1', '1.5.0-fix1', '1.5.0', '1.4.3']
assert(versions.length && versions.every(v => ['1.6.0', '1.5.1', '1.5.0-fix1', '1.5.0', '1.4.3'].includes(v)))
const reports = []
const htmlMime = /text\/html/
const javascriptMime = /javascript/
const jsonMime = /json/
const accessibleClass = /color-vision-friendly/

async function main() {
  const browser = await chromium.launch()

  try {
    for (const version of versions) {
      const lab = await createLab({ version })
      try {
        let id = 0
        const rpc = async (method, params, auth = false) => {
          const response = await lab.request('/api/rpc2', { auth, body: { jsonrpc: '2.0', id: ++id, method, params } })
          assert(!response.error, `Lab RPC failed: ${method}`)
          return response.result
        }
        assert.equal((await rpc('public:getVersion')).version, version)
        const redirect = await fetch(`${lab.base}/admin`, { redirect: 'manual' })
        if (version === '1.6.0' || version === '1.5.1') {
          assert.equal(redirect.status, 302)
          assert.equal(redirect.headers.get('location'), '/admin/dashboard')
        }
        if (version === '1.6.0') {
          await lab.upload(installer)
          await lab.setTheme('glassmorphism-plus')
          const fresh = await browser.newContext()
          const freshPage = await fresh.newPage()
          await freshPage.goto(lab.base)
          await expect(freshPage.locator('footer')).toContainText(`v${manifest.version} · VoyagerProbe`)
          await freshPage.getByTestId('palette-entry').click()
          await expect(freshPage.getByTestId('palette-panel')).toBeVisible()
          assert.equal(await freshPage.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).length), 0)
          // Finish the independent fresh-install check before replacing its files.
          // Closing while large lazy assets are still streaming can retain a file
          // handle briefly on Windows; this is not part of the upgrade profile.
          await freshPage.waitForLoadState('networkidle')
          await fresh.close()
        }
        const oldZip = process.env.PLUS_PREVIOUS_INSTALLER || await download(process.env.PLUS_PREVIOUS_URL || 'https://github.com/VoyagerProbe/Glassmorphism-Plus/releases/download/v2.8.4/Glassmorphism-Plus-release-2.8.4.zip', resolve(lab.root, 'previous.zip'), oldSha)
        assert.equal(digest(readFileSync(oldZip)), oldSha)
        const previousManifest = JSON.parse(zipFiles(oldZip).get('komari-theme.json'))
        assert.equal(previousManifest.short, manifest.short)
        const sameVersionRevision = previousManifest.version === manifest.version
        await lab.upload(oldZip)
        await lab.setTheme('glassmorphism-plus')
        const client = await rpc('admin:addClient', { name: 'Synthetic compatibility node' }, true)
        await rpc('admin:editClient', { uuid: client.uuid, name: 'Synthetic compatibility node', cpu_name: 'Synthetic CPU', cpu_cores: 4, arch: 'amd64', os: 'Debian', region: 'US', mem_total: 4 * 1024 ** 3, disk_total: 32 * 1024 ** 3 }, true)
        const tasks = []
        for (let i = 0; i < 3; i++) {
          const t = await rpc('admin:addPingTask', { name: `Synthetic Ping ${i + 1}`, target: 'example.invalid', type: 'icmp', interval: 60, default_on: false, clients: [client.uuid] }, true)
          tasks.push(t.task_id)
        }
        const feed = async () => {
          const agent = async (method, params) => {
            const response = await lab.request(`/api/clients/v2/rpc?token=${encodeURIComponent(client.token)}`, { body: { jsonrpc: '2.0', id: ++id, method, params } })
            assert(!response.error, 'Synthetic agent report failed')
          }
          await agent('agent.report', { report: { cpu: { usage: 12 }, ram: { used: 1024 ** 3, total: 4 * 1024 ** 3 }, disk: { used: 4 * 1024 ** 3, total: 32 * 1024 ** 3 }, network: { up: 4096, down: 8192, totalUp: 1024 ** 3, totalDown: 3 * 1024 ** 3 }, uptime: 86400, load: { load1: 0.2, load5: 0.2, load15: 0.2 }, connections: { tcp: 3, udp: 1 }, process: 42 } })
          for (const [i, task] of tasks.entries())
            await agent('agent.pingResult', { task_id: task, value: i === 2 ? -1 : 9 + i })
        }
        await feed()
        // Official backends batch agent samples before history is queryable.
        // Establish genuine persisted history before a browser warms its cache.
        await expect.poll(async () => {
          const end = new Date(Date.now() + 60000).toISOString()
          const start = new Date(Date.now() - 3600000).toISOString()
          const history = await rpc('common:getRecords', { type: 'ping', uuid: client.uuid, start, end })
          return new Set(history.records?.map(record => record.task_id)).size
        }, { timeout: 15000, intervals: [250, 500, 1000] }).toBe(3)
        const settings = { themeMode: 'dark', themeColor: '#00c99c', hideEarth: true, disablePageAnimation: true, rpcTransportMode: 'http', glassColorPreset: '自定义', glassCustomColors: '{"lightText":"#123456","darkText":"#E1E2E3"}', backgroundEnabled: false, lightBackgroundUrl: 'https://example.invalid/preserved.png', colorVisionMode: '色觉友好', futureOpaqueSetting: { array: [false, null, 17], nested: { preserve: 'synthetic' } }, nodeCardPingDisplayConfigV3: JSON.stringify({ schemaVersion: 3, global: { threeNetworkEnabled: true, taskIds: tasks }, nodes: {} }) }
        if (sameVersionRevision)
          settings.glassColorPreset = 'softFrost'
        const saveSettings = body => lab.request('/api/admin/theme/settings?theme=glassmorphism-plus', { auth: true, body })
        await saveSettings(settings)
        const beforeSettings = (await rpc('public:getPublicSettings')).theme_settings
        const context = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'zh-CN' })
        const page = await context.newPage()
        const errors = []
        const badResources = []
        page.on('pageerror', e => errors.push(e.message))
        page.on('response', (r) => {
          if (r.url().startsWith(lab.base) && ['script', 'stylesheet'].includes(r.request().resourceType()) && (!r.ok() || htmlMime.test(r.headers()['content-type'] || '')))
            badResources.push({ path: new URL(r.url()).pathname, status: r.status() })
        })
        await page.goto(lab.base)
        await expect(page.locator('footer')).toContainText(`v${previousManifest.version} · VoyagerProbe`)
        const retiredPreference = sameVersionRevision
          ? await page.evaluate(() => {
              const app = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('app')
              const raw = JSON.stringify({ schemaVersion: 1, preset: 'softFrost', colors: app.managedPalette.colors })
              localStorage.setItem('glassmorphism-plus:palette:v1:%2F', raw)
              return raw
            })
          : null
        if (sameVersionRevision) {
          await page.reload()
          await expect.poll(() => page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('app').appliedLocalPalette?.preset)).toBe('softFrost')
        }
        // Model an existing registration from a prior backend visit without clearing it.
        await page.evaluate(async () => {
          const registration = await navigator.serviceWorker.register('/sw.js')
          await navigator.serviceWorker.ready
          if (!registration.active)
            throw new Error('Previous compatibility Worker failed to activate')
        })
        await expect.poll(() => page.evaluate(() => navigator.serviceWorker.controller?.scriptURL)).toBe(`${lab.base}/sw.js`)
        await page.getByRole('button', { name: '收藏 Synthetic compatibility node', exact: true }).click()
        await page.evaluate(() => {
          document.cookie = 'compat_sentinel=preserved; Path=/'
          localStorage.setItem('compat_sentinel', 'preserved')
        })
        const entry = await page.locator('script[type="module"][src]').first().getAttribute('src')
        const uploaded = await lab.upload(installer)
        assert.equal(uploaded.sha256, installerSha)
        assert.deepEqual((await rpc('public:getPublicSettings')).theme_settings, beforeSettings)
        for (const [name, bytes] of files)
          assert.equal(digest(readFileSync(resolve(lab.root, 'data/theme/glassmorphism-plus', name))), digest(bytes), `Installed parity: ${name}`)
        await feed()
        await page.reload()
        await expect(page.locator('footer')).toContainText(`v${manifest.version} · VoyagerProbe`)
        assert.notEqual(await page.locator('script[type="module"][src]').first().getAttribute('src'), entry)
        await expect(page.getByRole('button', { name: '取消收藏 Synthetic compatibility node', exact: true })).toBeVisible()
        await expect(page.locator('html')).toHaveClass(accessibleClass)
        assert(await page.evaluate(() => document.cookie.includes('compat_sentinel=preserved') && localStorage.getItem('compat_sentinel') === 'preserved'))
        assert.equal(await page.evaluate(() => navigator.serviceWorker.controller?.scriptURL), `${lab.base}/sw.js`)
        if (sameVersionRevision) {
          assert.equal(await page.evaluate(() => localStorage.getItem('glassmorphism-plus:palette:v1:%2F')), retiredPreference)
          await page.getByTestId('palette-entry').click()
          await expect(page.getByTestId('palette-preset')).toHaveValue('site-default')
          await expect(page.locator('#palette-hex')).toHaveValue('#0D111AD9')
          await page.getByRole('button', { name: '取消', exact: true }).click()
          assert.deepEqual((await rpc('public:getPublicSettings')).theme_settings, beforeSettings)
        }
        await expect.poll(() => page.evaluate(uuid => document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('nodes').nodes.find(n => n.uuid === uuid)?.cpu, client.uuid)).toBe(12)
        await page.locator('[data-node-ping-header="latency"]').first().click()
        const modal = page.getByRole('dialog').locator('[data-ping-chart]')
        await expect.poll(async () => Number(await modal.getAttribute('data-ping-chart-record-count'))).toBeGreaterThan(0)
        await modal.getByRole('button', { name: '丢包数据', exact: true }).click()
        await expect(modal).toHaveAttribute('data-ping-chart-loss', 'disabled')
        await page.getByRole('dialog').getByRole('button', { name: '关闭', exact: true }).click()
        await page.goto(`${lab.base}/instance/${client.uuid}`)
        const chart = page.locator('[data-ping-chart]')
        await expect.poll(async () => Number(await chart.getAttribute('data-ping-chart-record-count'))).toBeGreaterThan(0)
        await chart.getByRole('button', { name: '丢包数据', exact: true }).click()
        await expect(chart).toHaveAttribute('data-ping-chart-loss', 'disabled')
        const sw = await fetch(`${lab.base}/sw.js`)
        assert.match(sw.headers.get('content-type'), javascriptMime)
        assert.equal(digest(Buffer.from(await sw.arrayBuffer())), workerSha)
        const publicManifest = await fetch(`${lab.base}/themes/glassmorphism-plus/komari-theme.json`)
        assert.match(publicManifest.headers.get('content-type'), jsonMime)
        assert.equal((await publicManifest.json()).version, manifest.version)
        const modeEvidence = []
        for (const mode of ['http', 'websocket']) {
          await saveSettings({ ...settings, rpcTransportMode: mode })
          await feed()
          const modeContext = await browser.newContext()
          const modePage = await modeContext.newPage()
          let frames = 0
          let sockets = 0
          modePage.on('websocket', (ws) => {
            if (new URL(ws.url()).pathname === '/api/rpc2') {
              sockets++
              ws.on('framereceived', () => frames++)
            }
          })
          await modePage.goto(lab.base)
          await expect(modePage.locator('.node-card')).toHaveCount(1)
          await modePage.goto(`${lab.base}/instance/${client.uuid}`)
          await expect.poll(async () => Number(await modePage.locator('[data-ping-chart]').getAttribute('data-ping-chart-record-count'))).toBeGreaterThan(0)
          if (mode === 'websocket') {
            await expect.poll(() => frames).toBeGreaterThan(0)
            const firstFrames = frames
            const firstSockets = sockets
            await lab.restart()
            await feed()
            await expect.poll(() => sockets, { timeout: 15000 }).toBeGreaterThan(firstSockets)
            await expect.poll(() => frames, { timeout: 15000 }).toBeGreaterThan(firstFrames)
          }
          modeEvidence.push({ mode, nonemptyPingHistory: true, websocketFrames: frames, websocketReconnect: mode === 'websocket' })
          await modeContext.close()
        }
        await saveSettings(settings)
        assert.deepEqual((await rpc('public:getPublicSettings')).theme_settings, beforeSettings)
        assert.equal((await rpc('public:getMe')).logged_in, false)
        assert.equal((await rpc('public:getMe', undefined, true)).logged_in, true)
        const split = lab.cookie.indexOf('=')
        await context.addCookies([{ name: lab.cookie.slice(0, split), value: lab.cookie.slice(split + 1), url: lab.base }])
        await page.goto(`${lab.base}/admin/settings/site`)
        await expect(page.getByRole('button', { name: '保存', exact: true }).first()).toBeVisible()
        await page.locator('input').first().fill('Synthetic compatibility saved')
        await page.getByRole('button', { name: '保存', exact: true }).first().click()
        await expect.poll(async () => (await lab.request('/api/admin/settings/', { auth: true })).data.sitename).toBe('Synthetic compatibility saved')
        if (version === '1.6.0' || version === '1.5.1') {
          await page.goto(`${lab.base}/admin`)
          await expect(page).toHaveURL(`${lab.base}/admin/dashboard`)
        }
        await page.goto(lab.base)
        await expect(page.locator('.node-card')).toHaveCount(1)
        const paletteEvidence = await verifyPaletteRoundtrip({ page, lab, settings, tasks, clientUuid: client.uuid, version, files })
        assert.deepEqual(errors, [])
        assert.deepEqual(badResources, [])
        reports.push({ version, platform: process.platform, binarySha256: lab.binaryHash, installerSha256: installerSha, installedFiles: files.size, previousInstallerSha256: oldSha, previousVersion: previousManifest.version, sameVersionRevision, retiredPreferenceReadOnlyFallback: Boolean(retiredPreference), sameProfileUpgrade: true, existingWorkerRetained: true, freshInstallation: version === '1.6.0', settingsBindingsFavoritesPreserved: true, liveCpu: 12, modalAndDetailHistory: true, transport: modeEvidence, palette: paletteEvidence, adminStatus: redirect.status, adminLocation: redirect.headers.get('location'), loginGuestSaveReturn: true, workerSha256: workerSha, errors, badResources, physicalSafari: 'not-tested' })
        writeFileSync(process.env.PLUS_COMPAT_REPORT || resolve(lab.root, 'komari-compatibility.json'), JSON.stringify(reports, null, 2))
        process.stdout.write(`${JSON.stringify(reports.at(-1))}\n`)
        await context.close()
        await delay(100)
      }
      finally { await lab.stop() }
    }
  }
  finally { await browser.close() }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
