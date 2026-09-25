import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import process from 'node:process'
import { expect } from '@playwright/test'
import { chromium } from 'playwright'
import { createLab, delay, digest, download, project, zipFiles } from '../service-worker/lab.mjs'

const manifest = JSON.parse(readFileSync(resolve(project, 'komari-theme.json')))
const installer = process.env.PLUS_INSTALLER || resolve(project, '..', manifest.version, `Glassmorphism-Plus-release-${manifest.version}.zip`)
const files = zipFiles(installer)
const installerSha = digest(readFileSync(installer))
const workerSha = '472d42cd35619cde31ba3378b3c1b1ed12a7687152e37b7d131b67902814d527'
const oldSha = '5f2395ef9dad6aa4280d951d60692200f712cf16eec9485c4f4b684f5d03541b'
const reports = []
const htmlMime = /text\/html/
const javascriptMime = /javascript/
const jsonMime = /json/

async function main() {
  const browser = await chromium.launch()

  try {
    for (const version of ['1.5.1', '1.5.0-fix1', '1.5.0', '1.4.3']) {
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
        if (version === '1.5.1') {
          assert.equal(redirect.status, 302)
          assert.equal(redirect.headers.get('location'), '/admin/dashboard')
        }
        const oldZip = await download('https://github.com/VoyagerProbe/Glassmorphism-Plus/releases/download/v2.8.3/Glassmorphism-Plus-release-2.8.3.zip', resolve(lab.root, 'previous.zip'), oldSha)
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
        const settings = { themeMode: 'dark', themeColor: '#00c99c', hideEarth: true, disablePageAnimation: true, rpcTransportMode: 'http', nodeCardPingDisplayConfigV3: JSON.stringify({ schemaVersion: 3, global: { threeNetworkEnabled: true, taskIds: tasks }, nodes: {} }) }
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
        await expect(page.locator('footer')).toContainText('v2.8.3 · VoyagerProbe')
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
        assert(await page.evaluate(() => document.cookie.includes('compat_sentinel=preserved') && localStorage.getItem('compat_sentinel') === 'preserved'))
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
          modePage.on('websocket', (ws) => {
            if (new URL(ws.url()).pathname === '/api/rpc2')
              ws.on('framereceived', () => frames++)
          })
          await modePage.goto(lab.base)
          await expect(modePage.locator('.node-card')).toHaveCount(1)
          await modePage.goto(`${lab.base}/instance/${client.uuid}`)
          await expect.poll(async () => Number(await modePage.locator('[data-ping-chart]').getAttribute('data-ping-chart-record-count'))).toBeGreaterThan(0)
          if (mode === 'websocket')
            await expect.poll(() => frames).toBeGreaterThan(0)
          modeEvidence.push({ mode, nonemptyPingHistory: true, websocketFrames: frames })
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
        if (version === '1.5.1') {
          await page.goto(`${lab.base}/admin`)
          await expect(page).toHaveURL(`${lab.base}/admin/dashboard`)
        }
        await page.goto(lab.base)
        await expect(page.locator('.node-card')).toHaveCount(1)
        assert.deepEqual(errors, [])
        assert.deepEqual(badResources, [])
        reports.push({ version, platform: process.platform, binarySha256: lab.binaryHash, installerSha256: installerSha, installedFiles: files.size, previousInstallerSha256: oldSha, sameProfileUpgrade: true, settingsBindingsFavoritesPreserved: true, liveCpu: 12, modalAndDetailHistory: true, transport: modeEvidence, adminStatus: redirect.status, adminLocation: redirect.headers.get('location'), loginGuestSaveReturn: true, workerSha256: workerSha, errors, badResources, physicalSafari: 'not-tested' })
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
